"""Append-only event log with idempotent, authenticated observe (plan §6, §8).

Ordering per observe: authorize -> idempotency precheck -> redact -> durable
blob (fsync) -> BEGIN IMMEDIATE {recheck, event, outbox} COMMIT -> ACK.
A crash before COMMIT can leave an orphan blob, never an ACKed event whose
source is missing.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import secrets
import sqlite3
import stat
import uuid
from dataclasses import dataclass, field
from pathlib import Path

from ..api.errors import CmfError
from ..config import Settings
from ..domain.events import ACTOR_FOR_EVENT, BlobRef, EventInput, ObserveResult, utc_now
from ..domain.identity import Principal, ensure_scope
from ..ingest import redact
from . import blobs
from .migrations import check_current
from .sqlite import StoreLock, connect, ensure_store_dir

# Test hooks: called inside observe() at the named point.
_FAULT_AFTER_BLOB = None
_FAULT_AFTER_EVENT_INSERT = None


@dataclass
class Context:
    """Server-side state.  Never built from, or serialized to, a client."""
    settings: Settings
    db: sqlite3.Connection
    idem_key: bytes = field(repr=False)
    lock: StoreLock | None = None
    schema_version: int = 0

    @property
    def blob_root(self) -> Path:
        return self.settings.store_root / "blobs"

    def close(self) -> None:
        self.db.close()
        if self.lock is not None:
            self.lock.release()


def _load_or_create_key(root: Path, *, create: bool) -> bytes:
    kdir = root / "keys"
    path = kdir / "idempotency.key"
    if create and not path.exists():
        os.makedirs(kdir, mode=0o700, exist_ok=True)
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        try:
            os.write(fd, secrets.token_bytes(32))
            os.fsync(fd)
        finally:
            os.close(fd)
    try:
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    except FileNotFoundError:
        raise CmfError("DEGRADED", "idempotency key missing (run: cmf admin init)") from None
    try:
        st = os.fstat(fd)
        if not stat.S_ISREG(st.st_mode) or st.st_mode & 0o077 or st.st_uid != os.getuid():
            raise CmfError("DEGRADED", "idempotency key has unsafe ownership or mode")
        key = os.read(fd, 64)
    finally:
        os.close(fd)
    if len(key) != 32:
        raise CmfError("DEGRADED", "idempotency key is malformed")
    return key


def open_store(settings: Settings, *, create: bool = False, lock: bool = True,
               readonly: bool = False) -> Context:
    """Open an initialized, current store.  `create` only makes directories
    and the key; schema changes go through migrations.migrate()."""
    ensure_store_dir(settings.store_root, create=create)
    held = StoreLock(settings.store_root).acquire() if lock else None
    try:
        key = _load_or_create_key(settings.store_root, create=create)
        if not settings.db_path.exists():
            raise CmfError("DEGRADED", "store not initialized (run: cmf admin init)")
        db = connect(settings.db_path, readonly=readonly,
                     busy_timeout_ms=settings.limits.busy_timeout_ms)
        try:
            if db.execute("PRAGMA quick_check").fetchone()[0] != "ok":
                raise CmfError("DEGRADED", "UNAVAILABLE_CORRUPT: integrity check failed")
            version = check_current(db)
        except BaseException:
            db.close()
            raise
    except BaseException:
        if held is not None:
            held.release()
        raise
    return Context(settings, db, key, held, version)


def request_digest(ctx: Context, p: Principal, e: EventInput) -> str:
    """Keyed digest of the whole validated request, original text included.

    Keyed so a stolen DB does not allow guessing short redacted secrets
    offline; computed before redaction so two retries that differ only in a
    secret are still a conflict, and a new redaction revision is not."""
    canonical = json.dumps({
        "schema_version": 1, "event_key": e.event_key, "project_id": e.project_id,
        "session_id": e.session_id, "agent_id": p.agent_id, "event_type": e.event_type,
        "occurred_at": e.occurred_at, "text": e.text, "ds4_blob_id": e.ds4_blob_id,
    }, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hmac.new(ctx.idem_key, canonical.encode("utf-8"), hashlib.sha256).hexdigest()


def _check_binding(db: sqlite3.Connection, e: EventInput, agent_id: str) -> None:
    row = db.execute("SELECT project_id, agent_id, state FROM sessions WHERE session_id=?",
                     (e.session_id,)).fetchone()
    if row is None or (row[0], row[1]) != (e.project_id, agent_id) or row[2] != "ACTIVE":
        raise CmfError("NOT_VISIBLE", "session binding")


def _existing(db: sqlite3.Connection, e: EventInput, agent_id: str, digest: str):
    row = db.execute("SELECT event_id, seq, request_digest FROM events "
                     "WHERE project_id=? AND agent_id=? AND event_key=?",
                     (e.project_id, agent_id, e.event_key)).fetchone()
    if row is None:
        return None
    if not hmac.compare_digest(row[2], digest):
        raise CmfError("IDEMPOTENCY_CONFLICT")
    return ObserveResult(row[0], int(row[1]), True)


def observe(ctx: Context, p: Principal, e: EventInput) -> ObserveResult:
    agent_id = p.agent_id
    if agent_id is None:
        raise CmfError("SCOPE", "observe needs an agent principal")
    ensure_scope(p, e.project_id, "observe", agent_id)
    ds4_root = None
    if e.ds4_blob_id is not None:
        ensure_scope(p, e.project_id, "source.raw", agent_id)
        ds4_root = ctx.settings.ds4_root_for(e.project_id)
        if ds4_root is None:
            raise CmfError("SOURCE_UNAVAILABLE", "no DS4 blob root configured for project")
    db = ctx.db
    _check_binding(db, e, agent_id)
    digest = request_digest(ctx, p, e)
    found = _existing(db, e, agent_id, digest)
    if found is not None:
        return found

    ds4_ref: BlobRef | None = None
    if ds4_root is not None:
        ds4_ref, original = blobs.resolve_ds4_blob(ds4_root, e.ds4_blob_id,
                                                   max_bytes=ctx.settings.limits.max_ds4_bytes)
    else:
        original = e.text
    redacted = redact.redact_text(original)
    if len(redacted.encode("utf-8")) > ctx.settings.limits.max_text_bytes:
        raise CmfError("LIMIT", "redacted text exceeds limit")
    cmf_ref = blobs.put_text(ctx.blob_root, redacted)
    if _FAULT_AFTER_BLOB is not None:
        _FAULT_AFTER_BLOB()

    now = utc_now()
    db.execute("BEGIN IMMEDIATE")
    try:
        _check_binding(db, e, agent_id)
        found = _existing(db, e, agent_id, digest)
        if found is not None:
            db.execute("ROLLBACK")
            return found
        db.execute("INSERT OR IGNORE INTO source_blobs"
                   "(blob_sha256,storage_uri,byte_len,media_type,source_kind,created_at) "
                   "VALUES (?,?,?,?,?,?)",
                   (cmf_ref.sha256, f"cmf-blob:sha256/{cmf_ref.sha256}.txt", cmf_ref.byte_len,
                    "text/plain; charset=utf-8", "REDACTED_TEXT", now))
        event_id = str(uuid.uuid4())
        cur = db.execute(
            "INSERT INTO events(event_id,event_key,project_id,session_id,agent_id,actor_type,"
            "event_type,source_blob_sha256,ds4_blob_id,ds4_blob_sha256,ds4_byte_len,"
            "occurred_at,recorded_at,content_sha256,request_digest,redaction_revision) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (event_id, e.event_key, e.project_id, e.session_id, agent_id,
             ACTOR_FOR_EVENT[e.event_type], e.event_type, cmf_ref.sha256,
             ds4_ref.root_id if ds4_ref else None, ds4_ref.sha256 if ds4_ref else None,
             ds4_ref.byte_len if ds4_ref else None, e.occurred_at, now, cmf_ref.sha256,
             digest, redact.REVISION))
        seq = int(cur.lastrowid)
        if _FAULT_AFTER_EVENT_INSERT is not None:
            _FAULT_AFTER_EVENT_INSERT()
        db.execute("INSERT INTO projection_outbox(event_seq, projection) VALUES (?, 'fts')", (seq,))
        db.execute("COMMIT")
    except BaseException:
        if db.in_transaction:
            db.execute("ROLLBACK")
        raise
    return ObserveResult(event_id, seq, False)


def get_source(ctx: Context, p: Principal, event_id: str) -> dict:
    """Full redacted text of one event.  Unknown and invisible ids answer the
    same NOT_VISIBLE; knowing a digest grants nothing."""
    row = ctx.db.execute(
        "SELECT e.seq, e.project_id, e.agent_id, e.event_type, e.occurred_at, "
        "e.source_blob_sha256, b.byte_len, e.redaction_revision, e.ds4_blob_id, "
        "e.ds4_blob_sha256, e.ds4_byte_len FROM events e "
        "JOIN source_blobs b ON b.blob_sha256 = e.source_blob_sha256 WHERE e.event_id=?",
        (event_id,)).fetchone()
    if row is None or not p.allowed(row[1], "source.read", row[2]):
        raise CmfError("NOT_VISIBLE")
    text = blobs.read_text(ctx.blob_root, BlobRef(row[5], row[6], "REDACTED_TEXT"),
                           max_bytes=ctx.settings.limits.max_text_bytes)
    return {
        "event_id": event_id, "seq": row[0], "project_id": row[1], "agent_id": row[2],
        "event_type": row[3], "occurred_at": row[4],
        "source": {"kind": "REDACTED_TEXT", "sha256": row[5], "byte_len": row[6],
                   "redaction_revision": row[7]},
        "ds4_source": None if row[8] is None else
            {"blob_id": row[8], "sha256": row[9], "byte_len": row[10]},
        "trust": "UNTRUSTED", "verification": "UNVERIFIED",
        "text": text,
    }
