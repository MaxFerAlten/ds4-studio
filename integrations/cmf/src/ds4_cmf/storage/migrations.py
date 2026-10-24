"""Forward-only migrations with checksums (plan §36 M1-02, §52.3).

Each migration runs as one transaction together with its schema_migrations
row, so a crash leaves either the old schema or the new one.  Before any
migration touches an existing database, a verified copy is written next to
it; rollback means restoring that copy, never DROP TABLE.
"""

from __future__ import annotations

import hashlib
import re
import sqlite3
from dataclasses import dataclass
from pathlib import Path

from ..api.errors import CmfError
from ..domain.events import utc_now
from .sqlite import connect

_NAME = re.compile(r"(\d{4})_([a-z0-9_]+)\.sql")
MIGRATIONS_DIR = Path(__file__).resolve().parents[3] / "migrations"

# Test hook: called after a migration's DDL and before its COMMIT.
_FAULT_BEFORE_COMMIT = None


@dataclass(frozen=True)
class Migration:
    version: int
    name: str
    sql: str
    checksum: str


def load_migrations(directory: Path = MIGRATIONS_DIR) -> tuple[Migration, ...]:
    out = []
    for path in sorted(directory.iterdir()):
        m = _NAME.fullmatch(path.name)
        if not m:
            continue
        raw = path.read_bytes()
        out.append(Migration(int(m.group(1)), m.group(2), raw.decode("utf-8"),
                             hashlib.sha256(raw).hexdigest()))
    versions = [m.version for m in out]
    if versions != list(range(1, len(out) + 1)):
        raise CmfError("INTERNAL", "migration versions must be contiguous from 1")
    return tuple(out)


def _applied(db: sqlite3.Connection) -> dict[int, str]:
    if db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='schema_migrations'"
                  ).fetchone() is None:
        return {}
    return {v: c for v, c in db.execute("SELECT version, checksum FROM schema_migrations")}


def plan(db: sqlite3.Connection | None, migrations: tuple[Migration, ...]) -> tuple[int, ...]:
    applied = _applied(db) if db is not None else {}
    known = {m.version: m for m in migrations}
    for version, checksum in applied.items():
        if version not in known:
            raise CmfError("VERSION_CONFLICT", f"database has unknown migration {version}")
        if known[version].checksum != checksum:
            raise CmfError("VERSION_CONFLICT", f"checksum drift in migration {version}")
    return tuple(m.version for m in migrations if m.version not in applied)


def _backup_copy(db: sqlite3.Connection, path: Path, target_version: int) -> Path:
    dest = path.with_name(f"{path.name}.pre-{target_version:04d}.bak")
    if dest.exists():
        dest.unlink()
    out = sqlite3.connect(dest)
    try:
        db.backup(out)
        if out.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
            raise CmfError("DEGRADED", "pre-migration copy failed integrity check")
    finally:
        out.close()
    dest.chmod(0o600)
    return dest


def migrate(path: Path, migrations_dir: Path = MIGRATIONS_DIR, *,
            dry_run: bool = False) -> tuple[int, ...]:
    """Apply pending migrations; return the versions applied (or planned)."""
    migrations = load_migrations(migrations_dir)
    if dry_run:
        if not path.exists():
            return tuple(m.version for m in migrations)
        db = connect(path, readonly=True)
        try:
            return plan(db, migrations)
        finally:
            db.close()
    existed = path.exists()
    db = connect(path)
    path.chmod(0o600)
    try:
        pending = plan(db, migrations)
        if pending and existed and _applied(db):
            _backup_copy(db, path, pending[0])
        for m in migrations:
            if m.version not in pending:
                continue
            script = (f"BEGIN IMMEDIATE;\n{m.sql}\n"
                      f"INSERT INTO schema_migrations(version,name,checksum,applied_at) "
                      f"VALUES ({m.version},'{m.name}','{m.checksum}','{utc_now()}');\n")
            try:
                db.executescript(script)
                if _FAULT_BEFORE_COMMIT is not None:
                    _FAULT_BEFORE_COMMIT(m.version)
                db.execute("COMMIT")
            except BaseException:
                if db.in_transaction:
                    db.execute("ROLLBACK")
                raise
        return pending
    finally:
        db.close()


def schema_version(db: sqlite3.Connection) -> int:
    applied = _applied(db)
    return max(applied) if applied else 0


def check_current(db: sqlite3.Connection, migrations_dir: Path = MIGRATIONS_DIR) -> int:
    """Refuse to serve a store whose schema is behind, ahead or drifted."""
    migrations = load_migrations(migrations_dir)
    if plan(db, migrations):
        raise CmfError("VERSION_CONFLICT", "store needs migration (run: cmf admin migrate)")
    return schema_version(db)
