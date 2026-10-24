"""Deterministic FTS projection of events into EPISODE memory units (§5.2, §46).

One event -> one memory unit `episode:<event_id>` + one OBSERVED_IN link +
one FTS row, written in the same transaction that marks the outbox row DONE
and advances the checkpoint.  The checkpoint is the highest seq such that
every committed event at or below it is projected: an earlier failure blocks
it, numeric gaps in AUTOINCREMENT do not.
"""

from __future__ import annotations

import sqlite3
from datetime import datetime, timedelta, timezone

from ..api.errors import CmfError
from ..domain.events import BlobRef, ProjectionResult, utc_now
from ..domain.identity import Principal, ensure_scope
from . import blobs
from .eventlog import Context

PROJECTION = "fts"
BUILD_REVISION = "episode-v1"
RETRY_BASE_S = 1
RETRY_MAX_S = 300

# Test hook: called after the unit/link/FTS rows, before the outbox update.
_FAULT_BEFORE_DONE = None


def utf8_prefix(text: str, max_bytes: int) -> tuple[str, int]:
    """Longest prefix of at most `max_bytes` UTF-8 bytes that does not split
    a character.  Returns (prefix, its byte length)."""
    data = text.encode("utf-8")
    if len(data) <= max_bytes:
        return text, len(data)
    cut = max_bytes
    while cut > 0 and (data[cut] & 0xC0) == 0x80:
        cut -= 1
    return data[:cut].decode("utf-8"), cut


def _materialize(ctx: Context, db: sqlite3.Connection, seq: int) -> None:
    row = db.execute(
        "SELECT e.event_id, e.project_id, e.agent_id, e.source_blob_sha256, b.byte_len, "
        "e.recorded_at FROM events e JOIN source_blobs b ON b.blob_sha256=e.source_blob_sha256 "
        "WHERE e.seq=?", (seq,)).fetchone()
    if row is None:
        raise CmfError("INTERNAL", f"outbox points at missing event {seq}")
    event_id, project_id, agent_id, sha, byte_len, recorded_at = row
    text = blobs.read_text(ctx.blob_root, BlobRef(sha, byte_len, "REDACTED_TEXT"),
                           max_bytes=ctx.settings.limits.max_text_bytes)
    prefix, prefix_len = utf8_prefix(text, ctx.settings.limits.episode_prefix_bytes)
    memory_id = f"episode:{event_id}"
    db.execute("DELETE FROM memory_fts WHERE memory_id=?", (memory_id,))
    db.execute("DELETE FROM memory_units WHERE memory_id=?", (memory_id,))
    db.execute(
        "INSERT INTO memory_units(memory_id,project_id,owner_agent_id,memory_kind,text,truncated,"
        "full_byte_len,source_sha256,created_at,updated_at,extractor_fingerprint) "
        "VALUES (?,?,?,'EPISODE',?,?,?,?,?,?,?)",
        (memory_id, project_id, agent_id, prefix, int(prefix_len < byte_len), byte_len, sha,
         recorded_at, recorded_at, f"{BUILD_REVISION};prefix={ctx.settings.limits.episode_prefix_bytes}"))
    db.execute("INSERT INTO evidence_links(memory_id,event_seq,support_type,excerpt_start,excerpt_end) "
               "VALUES (?,?,'OBSERVED_IN',0,?)", (memory_id, seq, prefix_len))
    if prefix:
        db.execute("INSERT INTO memory_fts(memory_id,project_id,owner_agent_id,text) VALUES (?,?,?,?)",
                   (memory_id, project_id, agent_id, prefix))


def _checkpoint_value(db: sqlite3.Connection) -> int:
    blocked = db.execute("SELECT MIN(event_seq) FROM projection_outbox "
                         "WHERE projection=? AND state!='DONE'", (PROJECTION,)).fetchone()[0]
    if blocked is None:
        checkpoint = db.execute("SELECT COALESCE(MAX(seq),0) FROM events").fetchone()[0]
    else:
        # A real committed seq, not blocked-1: AUTOINCREMENT may leave gaps.
        checkpoint = db.execute("SELECT COALESCE(MAX(seq),0) FROM events WHERE seq<?",
                                (blocked,)).fetchone()[0]
    return checkpoint


def _advance_checkpoint(db: sqlite3.Connection) -> int:
    checkpoint = _checkpoint_value(db)
    db.execute("INSERT INTO projection_checkpoints(projection,seq_committed,build_revision,updated_at) "
               "VALUES (?,?,?,?) ON CONFLICT(projection) DO UPDATE SET "
               "seq_committed=excluded.seq_committed, build_revision=excluded.build_revision, "
               "updated_at=excluded.updated_at", (PROJECTION, checkpoint, BUILD_REVISION, utc_now()))
    return checkpoint


def _retry_at(attempts: int) -> str:
    delay = min(RETRY_BASE_S * 2 ** (attempts - 1), RETRY_MAX_S)
    return (datetime.now(timezone.utc) + timedelta(seconds=delay)).strftime("%Y-%m-%dT%H:%M:%S.%fZ")


def _status(db: sqlite3.Connection) -> ProjectionResult:
    row = db.execute("SELECT seq_committed FROM projection_checkpoints WHERE projection=?",
                     (PROJECTION,)).fetchone()
    pending, blocked = db.execute(
        "SELECT COUNT(*), MIN(event_seq) FROM projection_outbox WHERE projection=? AND state!='DONE'",
        (PROJECTION,)).fetchone()
    return ProjectionResult(row[0] if row else 0, pending, blocked)


def project_pending(ctx: Context, *, max_events: int | None = None) -> ProjectionResult:
    """Project up to `max_events` pending events, one transaction each.

    A failing event keeps its PENDING row (attempts/last_error updated),
    blocks the checkpoint and is retried after an exponential backoff; later
    events are still projected."""
    db = ctx.db
    limit = max_events or ctx.settings.limits.projection_batch
    now = utc_now()
    rows = db.execute("SELECT outbox_id, event_seq, attempts FROM projection_outbox "
                      "WHERE projection=? AND state='PENDING' "
                      "AND (next_retry_at IS NULL OR next_retry_at<=?) "
                      "ORDER BY event_seq LIMIT ?",
                      (PROJECTION, now, limit)).fetchall()
    for outbox_id, seq, attempts in rows:
        db.execute("BEGIN IMMEDIATE")
        try:
            _materialize(ctx, db, seq)
            if _FAULT_BEFORE_DONE is not None:
                _FAULT_BEFORE_DONE(seq)
            db.execute("UPDATE projection_outbox SET state='DONE', attempts=attempts+1, "
                       "last_error=NULL WHERE outbox_id=?", (outbox_id,))
            _advance_checkpoint(db)
            db.execute("COMMIT")
        except CmfError as exc:
            db.execute("ROLLBACK")
            db.execute("BEGIN IMMEDIATE")
            db.execute("UPDATE projection_outbox SET attempts=attempts+1, last_error=?, "
                       "next_retry_at=? WHERE outbox_id=?", (exc.code, _retry_at(attempts + 1), outbox_id))
            _advance_checkpoint(db)
            db.execute("COMMIT")
        except BaseException:
            if db.in_transaction:
                db.execute("ROLLBACK")
            raise
    if not rows and _checkpoint_value(db) != _status(db).checkpoint:
        db.execute("BEGIN IMMEDIATE")
        try:
            _advance_checkpoint(db)
            db.execute("COMMIT")
        except BaseException:
            db.execute("ROLLBACK")
            raise
    return _status(db)


def rebuild_fts(ctx: Context, p: Principal, *, project_id: str,
                dry_run: bool = False) -> dict:
    """Re-derive one project's units, links and FTS rows from the log.

    Runs as a single transaction: readers keep the old view until COMMIT, a
    verification failure rolls everything back, and the single writer means
    no event can be acquired meanwhile.  Other projects are untouched."""
    ensure_scope(p, project_id, "admin")
    db = ctx.db
    seqs = [r[0] for r in db.execute(
        "SELECT e.seq FROM events e JOIN projection_outbox o ON o.event_seq=e.seq "
        "AND o.projection=? AND o.state='DONE' WHERE e.project_id=? ORDER BY e.seq",
        (PROJECTION, project_id))]
    if dry_run:
        current = db.execute("SELECT COUNT(*) FROM memory_units WHERE project_id=?",
                             (project_id,)).fetchone()[0]
        return {"project_id": project_id, "events": len(seqs), "current_units": current,
                "dry_run": True}
    db.execute("BEGIN IMMEDIATE")
    try:
        before = {r[0]: r[1:] for r in db.execute(
            "SELECT memory_id, text, source_sha256 FROM memory_units WHERE project_id=?",
            (project_id,))}
        db.execute("DELETE FROM memory_fts WHERE project_id=?", (project_id,))
        db.execute("DELETE FROM memory_units WHERE project_id=?", (project_id,))
        for seq in seqs:
            _materialize(ctx, db, seq)
        after = {r[0]: r[1:] for r in db.execute(
            "SELECT memory_id, text, source_sha256 FROM memory_units WHERE project_id=?",
            (project_id,))}
        links = db.execute("SELECT COUNT(*) FROM evidence_links l JOIN memory_units m "
                           "ON m.memory_id=l.memory_id WHERE m.project_id=?",
                           (project_id,)).fetchone()[0]
        if len(after) != len(seqs) or links != len(seqs):
            raise CmfError("INTERNAL", "rebuild verification failed")
        changed = sorted(k for k in after if before.get(k) not in (None, after[k]))
        db.execute("COMMIT")
    except BaseException:
        if db.in_transaction:
            db.execute("ROLLBACK")
        raise
    return {"project_id": project_id, "events": len(seqs), "units": len(after),
            "changed": len(changed), "dry_run": False}
