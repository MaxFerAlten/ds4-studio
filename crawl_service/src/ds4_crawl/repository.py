from __future__ import annotations

import json
import sqlite3
from datetime import UTC, datetime
from pathlib import Path
from typing import Any


_TRANSITIONS = {
    "queued": {"starting", "cancelled"},
    "starting": {"running", "cancelling", "failed"},
    "running": {"cancelling", "cancelled", "succeeded", "partially_succeeded", "failed"},
    "cancelling": {"cancelled", "failed"},
    "cancelled": set(),
    "succeeded": set(),
    "partially_succeeded": set(),
    "failed": set(),
}


def _utc_now() -> str:
    return datetime.now(UTC).isoformat()


class Repository:
    def __init__(self, database_path: Path | str):
        self.database_path = Path(database_path)
        self.database_path.parent.mkdir(parents=True, exist_ok=True)
        self.connection = sqlite3.connect(self.database_path)
        self.connection.row_factory = sqlite3.Row
        self.connection.execute("PRAGMA foreign_keys = ON")
        self.connection.execute("PRAGMA journal_mode = WAL")
        self.migrate()

    def close(self) -> None:
        self.connection.close()

    def __enter__(self) -> "Repository":
        return self

    def __exit__(self, *_args: object) -> None:
        self.close()

    def _table_exists(self, name: str) -> bool:
        row = self.connection.execute(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
            (name,),
        ).fetchone()
        return row is not None

    def migrate(self) -> None:
        migration_path = Path(__file__).with_name("migrations") / "001_initial.sql"
        statements = ["BEGIN IMMEDIATE;"]
        if self._table_exists("crawl_cache") and not self._table_exists(
            "legacy_crawl_cache_backup"
        ):
            statements.append(
                "CREATE TABLE legacy_crawl_cache_backup AS SELECT * FROM crawl_cache;"
            )
        statements.append(migration_path.read_text(encoding="utf-8"))
        statements.append(
            "INSERT OR IGNORE INTO schema_version(version, applied_at) "
            f"VALUES (1, {json.dumps(_utc_now())});"
        )
        statements.append("COMMIT;")
        try:
            self.connection.executescript("\n".join(statements))
        except Exception:
            if self.connection.in_transaction:
                self.connection.rollback()
            raise

    def table_names(self) -> set[str]:
        rows = self.connection.execute(
            "SELECT name FROM sqlite_master WHERE type = 'table'"
        ).fetchall()
        return {row["name"] for row in rows}

    def create_job(self, job_id: str, request: dict[str, Any]) -> None:
        now = _utc_now()
        request_json = json.dumps(
            request, ensure_ascii=False, sort_keys=True, separators=(",", ":")
        )
        with self.connection:
            self.connection.execute(
                """
                INSERT INTO jobs(id, state, request_json, created_at, updated_at)
                VALUES (?, 'queued', ?, ?, ?)
                """,
                (job_id, request_json, now, now),
            )

    def get_job(self, job_id: str) -> dict[str, Any] | None:
        row = self.connection.execute(
            "SELECT * FROM jobs WHERE id = ?", (job_id,)
        ).fetchone()
        return dict(row) if row is not None else None

    def transition_job(self, job_id: str, expected: str, target: str) -> bool:
        if expected not in _TRANSITIONS or target not in _TRANSITIONS[expected]:
            raise ValueError(f"invalid job transition {expected!r} -> {target!r}")
        with self.connection:
            cursor = self.connection.execute(
                """
                UPDATE jobs
                   SET state = ?, updated_at = ?
                 WHERE id = ? AND state = ?
                """,
                (target, _utc_now(), job_id, expected),
            )
        return cursor.rowcount == 1

    def commit_result(self, job_id: str, state: str, manifest: dict[str, object]) -> None:
        with self.connection:
            self.connection.execute(
                """
                UPDATE jobs
                   SET state = ?, result_manifest_json = ?, updated_at = ?
                 WHERE id = ?
                """,
                (state, json.dumps(manifest, ensure_ascii=False, sort_keys=True), _utc_now(), job_id),
            )

    def list_pages(self, job_id: str) -> list[dict[str, Any]]:
        rows = self.connection.execute(
            "SELECT * FROM pages WHERE job_id = ? ORDER BY page_index",
            (job_id,),
        ).fetchall()
        return [dict(row) for row in rows]

    def create_session(self, session_id: str, metadata: dict[str, Any] | None = None) -> dict[str, Any]:
        now = _utc_now()
        meta_json = json.dumps(metadata or {}, ensure_ascii=False, sort_keys=True)
        with self.connection:
            self.connection.execute(
                """
                INSERT OR REPLACE INTO sessions(id, state, created_at, updated_at, metadata_json)
                VALUES (?, 'open', ?, ?, ?)
                """,
                (session_id, now, now, meta_json),
            )
        return {"id": session_id, "state": "open", "metadata": metadata or {}}

    def get_session(self, session_id: str) -> dict[str, Any] | None:
        row = self.connection.execute(
            "SELECT * FROM sessions WHERE id = ?", (session_id,)
        ).fetchone()
        if row is None:
            return None
        result = dict(row)
        result["metadata"] = json.loads(result.get("metadata_json", "{}"))
        return result

    def close_session(self, session_id: str) -> bool:
        with self.connection:
            cursor = self.connection.execute(
                """
                UPDATE sessions SET state = 'closed', updated_at = ?
                 WHERE id = ? AND state = 'open'
                """,
                (_utc_now(), session_id),
            )
        return cursor.rowcount == 1
