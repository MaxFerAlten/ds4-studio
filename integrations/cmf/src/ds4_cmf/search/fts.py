"""Scoped lexical recall over memory_fts (plan §10.3).

User text never reaches FTS5 as syntax: it is split into Unicode word terms,
each quoted as a literal, and bound with `MATCH ?`.  Scope (project, agents)
is part of the same WHERE as MATCH, so LIMIT applies after the filter and a
better-ranked row from another scope cannot take a top-k slot.  Recall
writes nothing.
"""

from __future__ import annotations

import re

from ..api.errors import CmfError
from ..domain.events import BlobRef, SearchHit, SearchResult, check_id
from ..domain.identity import Principal, visible_agents
from ..storage import blobs
from ..storage.eventlog import Context

MAX_FTS_TERMS = 12
MAX_TERM_CHARS = 96
_TERM = re.compile(r"\w+", re.UNICODE)


def query_terms(query: str) -> list[str]:
    terms = []
    for t in _TERM.findall(query):
        if len(t) <= MAX_TERM_CHARS and t not in terms:
            terms.append(t)
        if len(terms) == MAX_FTS_TERMS:
            break
    return terms


def _literal(term: str) -> str:
    return '"' + term.replace('"', '""') + '"'


def build_match(query: str, *, mode: str = "phrase") -> str | None:
    """FTS5 expression of quoted literals, or None when there is no term.

    'phrase' keeps the terms adjacent and ordered (paths, error ids);
    'or' is the bounded recall fallback for longer questions."""
    terms = query_terms(query)
    if not terms:
        return None
    if mode == "phrase":
        return _literal(" ".join(terms))
    if mode == "or":
        return " OR ".join(_literal(t) for t in terms)
    raise ValueError(mode)


def _run(db, expr: str, project_id: str, agents: frozenset[str] | None, limit: int):
    sql = ("SELECT m.memory_id, l.event_seq, e.event_id, m.text, m.source_sha256, "
           "m.full_byte_len, m.truncated, m.verification, m.trust_taint "
           "FROM memory_fts f JOIN memory_units m ON m.memory_id = f.memory_id "
           "JOIN evidence_links l ON l.memory_id = m.memory_id AND l.support_type='OBSERVED_IN' "
           "JOIN events e ON e.seq = l.event_seq "
           "WHERE memory_fts MATCH ? AND f.project_id = ? AND m.project_id = ? "
           "AND e.project_id = ? AND m.retired_at IS NULL")
    params: list = [expr, project_id, project_id, project_id]
    if agents is not None:
        marks = ",".join("?" * len(agents))
        sql += f" AND m.owner_agent_id IN ({marks}) AND e.agent_id IN ({marks})"
        params += sorted(agents) * 2
    sql += " ORDER BY bm25(memory_fts), m.memory_id LIMIT ?"
    params.append(limit)
    return db.execute(sql, params).fetchall()


def search(ctx: Context, p: Principal, *, project_id: str, query: str,
           limit: int = 10) -> SearchResult:
    check_id(project_id, field="project_id")
    if not isinstance(query, str):
        raise CmfError("SCHEMA", "query")
    try:
        query_len = len(query.encode("utf-8"))
    except UnicodeEncodeError:  # lone surrogate from JSON \ud800
        raise CmfError("SCHEMA", "query is not valid Unicode") from None
    if query_len > ctx.settings.limits.max_query_bytes:
        raise CmfError("LIMIT", "query")
    if isinstance(limit, bool) or not isinstance(limit, int) or not 1 <= limit <= ctx.settings.limits.max_recall_limit:
        raise CmfError("SCHEMA", "limit")
    agents = visible_agents(p, project_id, "search")
    db = ctx.db
    # One read transaction: hits and watermark come from the same snapshot.
    db.execute("BEGIN")
    try:
        rows: list = []
        for mode in ("phrase", "or"):
            expr = build_match(query, mode=mode)
            if expr is None:
                break
            seen = {r[0] for r in rows}
            rows += [r for r in _run(db, expr, project_id, agents, limit) if r[0] not in seen]
            if len(rows) >= limit or mode == "phrase" and len(query_terms(query)) == 1:
                break
        rows = rows[:limit]
        scope_sql = "FROM events e WHERE e.project_id = ?"
        scope_params: list = [project_id]
        if agents is not None:
            scope_sql += f" AND e.agent_id IN ({','.join('?' * len(agents))})"
            scope_params += sorted(agents)
        # Watermarks are computed on this scope's events only, so nothing
        # about other projects' backlog leaks through them.
        lag, first_pending = db.execute(
            "SELECT COUNT(*), MIN(e.seq) FROM projection_outbox o JOIN events e ON e.seq=o.event_seq "
            f"WHERE o.projection='fts' AND o.state!='DONE' AND e.seq IN (SELECT e.seq {scope_sql})",
            scope_params).fetchone()
        done_sql = ("SELECT COALESCE(MAX(e.seq),0) FROM events e JOIN projection_outbox o "
                    "ON o.event_seq=e.seq AND o.projection='fts' AND o.state='DONE' "
                    f"WHERE e.seq IN (SELECT e.seq {scope_sql})")
        as_of = db.execute(done_sql, scope_params).fetchone()[0]
        checkpoint = as_of if first_pending is None else db.execute(
            done_sql + " AND e.seq < ?", scope_params + [first_pending]).fetchone()[0]
    finally:
        db.execute("COMMIT")
    items, warnings = [], []
    for memory_id, seq, event_id, text, sha, full_len, truncated, verification, taint in rows:
        if not blobs.source_ok(ctx.blob_root, BlobRef(sha, full_len, "REDACTED_TEXT")):
            warnings.append(f"source_unavailable:{memory_id}")
            continue
        items.append(SearchHit(memory_id, event_id, seq, text, sha, bool(truncated),
                               verification, taint))
    return SearchResult(tuple(items), as_of, checkpoint, lag, tuple(warnings))
