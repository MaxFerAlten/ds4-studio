"""SQLite connections, the store lock and session provisioning (plan §5).

One logical writer per store: the service (or an offline admin command)
holds an exclusive flock on <store>/lock for its whole lifetime.
"""

from __future__ import annotations

import fcntl
import os
import sqlite3
import stat
from pathlib import Path

from ..api.errors import CmfError
from ..domain.events import SessionBinding, check_id, utc_now
from ..domain.identity import Principal, ensure_scope


def connect(path: Path, *, readonly: bool = False, busy_timeout_ms: int = 2000) -> sqlite3.Connection:
    if readonly:
        db = sqlite3.connect(path.absolute().as_uri() + "?mode=ro", uri=True, isolation_level=None,
                             check_same_thread=False)
        db.execute("PRAGMA query_only = ON")
    else:
        db = sqlite3.connect(path, isolation_level=None, check_same_thread=False)
        if db.execute("PRAGMA journal_mode = WAL").fetchone()[0].lower() != "wal":
            db.close()
            raise CmfError("DEGRADED", "cannot enable WAL")
        db.execute("PRAGMA synchronous = FULL")
    db.execute(f"PRAGMA busy_timeout = {int(busy_timeout_ms)}")
    db.execute("PRAGMA foreign_keys = ON")
    if db.execute("PRAGMA foreign_keys").fetchone()[0] != 1:
        db.close()
        raise CmfError("DEGRADED", "foreign keys unavailable")
    return db


def fts5_available() -> bool:
    db = sqlite3.connect(":memory:")
    try:
        db.execute("CREATE VIRTUAL TABLE t USING fts5(x)")
        return True
    except sqlite3.OperationalError:
        return False
    finally:
        db.close()


def ensure_store_dir(root: Path, *, create: bool) -> None:
    if create:
        os.makedirs(root, mode=0o700, exist_ok=True)
    try:
        st = os.lstat(root)
    except FileNotFoundError:
        raise CmfError("DEGRADED", "store root missing") from None
    if not stat.S_ISDIR(st.st_mode):
        raise CmfError("DEGRADED", "store root is not a directory")
    if st.st_uid != os.getuid():
        raise CmfError("DEGRADED", "store root owned by another user")
    if st.st_mode & 0o077:
        raise CmfError("DEGRADED", "store root is accessible to other users (want 0700)")


class StoreLock:
    """Exclusive, non-blocking flock; a second writer fails fast."""

    def __init__(self, root: Path):
        self.path = root / "lock"
        self.fd: int | None = None

    def acquire(self) -> "StoreLock":
        fd = os.open(self.path, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW | os.O_CLOEXEC, 0o600)
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            os.close(fd)
            raise CmfError("DEGRADED", "store is locked by another CMF process") from None
        self.fd = fd
        return self

    def release(self) -> None:
        if self.fd is not None:
            fcntl.flock(self.fd, fcntl.LOCK_UN)
            os.close(self.fd)
            self.fd = None

    def __enter__(self) -> "StoreLock":
        return self.acquire()

    def __exit__(self, *exc) -> None:
        self.release()


def provision_project(db: sqlite3.Connection, p: Principal, project_id: str,
                      display_name: str) -> None:
    if not p.store_owner:
        raise CmfError("SCOPE")
    check_id(project_id, field="project_id")
    db.execute("BEGIN IMMEDIATE")
    try:
        row = db.execute("SELECT owner_id FROM projects WHERE project_id=?", (project_id,)).fetchone()
        if row is None:
            db.execute("INSERT INTO projects(project_id,owner_id,display_name,created_at) "
                       "VALUES (?,?,?,?)", (project_id, p.user_id, display_name, utc_now()))
        db.execute("COMMIT")
    except BaseException:
        db.execute("ROLLBACK")
        raise


def provision_session(db: sqlite3.Connection, p: Principal, binding: SessionBinding) -> None:
    """Bind a session to exactly one (project, agent).  Idempotent; a session
    that already exists with another binding is refused, never rebound."""
    ensure_scope(p, binding.project_id, "admin", binding.agent_id)
    for value, name in ((binding.project_id, "project_id"), (binding.session_id, "session_id"),
                        (binding.agent_id, "agent_id")):
        check_id(value, field=name)
    db.execute("BEGIN IMMEDIATE")
    try:
        if db.execute("SELECT 1 FROM projects WHERE project_id=?",
                      (binding.project_id,)).fetchone() is None:
            raise CmfError("NOT_VISIBLE", "project not provisioned")
        row = db.execute("SELECT project_id, agent_id FROM sessions WHERE session_id=?",
                         (binding.session_id,)).fetchone()
        if row is None:
            db.execute("INSERT INTO sessions(session_id,project_id,agent_id,started_at) "
                       "VALUES (?,?,?,?)",
                       (binding.session_id, binding.project_id, binding.agent_id, utc_now()))
        elif tuple(row) != (binding.project_id, binding.agent_id):
            raise CmfError("IDEMPOTENCY_CONFLICT", "session bound elsewhere")
        db.execute("COMMIT")
    except BaseException:
        db.execute("ROLLBACK")
        raise
