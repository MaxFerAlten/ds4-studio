"""SQLite store: WAL, one writer, short connections, checksummed migrations (plan §13, §31.1)."""

from __future__ import annotations

import datetime as dt
import json
import os
import sqlite3
import stat
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any

from ..canonical import canonical_json, sha256_hex
from ..errors import Code, H2DS4Error

SCHEMA_SQL = (Path(__file__).with_name('schema.sql')).read_text(encoding='utf-8')
MIGRATIONS: tuple[tuple[int, str], ...] = ((1, SCHEMA_SQL),)
GENESIS_HASH = '0' * 64


def utcnow() -> str:
    return dt.datetime.now(dt.UTC).strftime('%Y-%m-%dT%H:%M:%S.%fZ')


def utc_after(seconds: float) -> str:
    return (dt.datetime.now(dt.UTC) + dt.timedelta(seconds=seconds)).strftime(
        '%Y-%m-%dT%H:%M:%S.%fZ')


class SqliteStore:
    def __init__(self, db_path: Path):
        self.path = db_path
        parent = self.path.parent
        st = parent.lstat() if parent.exists() else None
        if st is None or not stat.S_ISDIR(st.st_mode) or st.st_uid != os.getuid() \
                or stat.S_IMODE(st.st_mode) != 0o700:
            raise H2DS4Error(Code.POLICY_DENIED, 'data directory must be provisioned with mode 0700')

    # -- bootstrap ---------------------------------------------------------------------
    def initialize(self) -> SqliteStore:
        self._ensure_file()
        db = sqlite3.connect(self.path, timeout=5, isolation_level=None)
        try:
            db.execute('PRAGMA busy_timeout=5000')
            mode = db.execute('PRAGMA journal_mode=WAL').fetchone()[0]
            if str(mode).lower() != 'wal':
                raise H2DS4Error(Code.INTEGRITY_FAILURE, 'WAL journal unavailable')
            check = db.execute('PRAGMA quick_check').fetchone()[0]
            if check != 'ok':
                raise H2DS4Error(Code.INTEGRITY_FAILURE, 'database quick_check failed')
        finally:
            db.close()
        self._migrate()
        return self

    def _ensure_file(self) -> None:
        try:
            st = self.path.lstat()
        except FileNotFoundError:
            fd = os.open(self.path, os.O_RDWR | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
            os.close(fd)
            return
        if not stat.S_ISREG(st.st_mode) or st.st_uid != os.getuid() \
                or stat.S_IMODE(st.st_mode) != 0o600:
            raise H2DS4Error(Code.INTEGRITY_FAILURE, 'database file must be a 0600 regular file')

    def _migrate(self) -> None:
        with self.tx() as db:
            db.execute('CREATE TABLE IF NOT EXISTS schema_versions (version INTEGER PRIMARY KEY, '
                       'applied_utc TEXT NOT NULL, checksum TEXT NOT NULL)')
            applied = {r['version']: r['checksum'] for r in
                       db.execute('SELECT version, checksum FROM schema_versions')}
            for version, sql in MIGRATIONS:
                checksum = sha256_hex(sql.encode())
                if version in applied:
                    if applied[version] != checksum:
                        raise H2DS4Error(Code.INTEGRITY_FAILURE,
                                         f'schema v{version} checksum mismatch; refusing to run')
                    continue
                for stmt in _split_sql(sql):
                    db.execute(stmt)
                db.execute('INSERT INTO schema_versions VALUES (?,?,?)',
                           (version, utcnow(), checksum))
            known = {v for v, _ in MIGRATIONS}
            if set(applied) - known:
                raise H2DS4Error(Code.INTEGRITY_FAILURE, 'database is newer than this build')

    # -- transactions ------------------------------------------------------------------
    @contextmanager
    def tx(self) -> Iterator[sqlite3.Connection]:
        db = sqlite3.connect(self.path, timeout=5, isolation_level=None)
        db.row_factory = sqlite3.Row
        try:
            db.execute('PRAGMA foreign_keys=ON')
            db.execute('PRAGMA busy_timeout=5000')
            db.execute('PRAGMA synchronous=FULL')
            db.execute('BEGIN IMMEDIATE')
            yield db
            db.execute('COMMIT')
        except Exception:
            if db.in_transaction:
                db.execute('ROLLBACK')
            raise
        finally:
            db.close()

    @contextmanager
    def read(self) -> Iterator[sqlite3.Connection]:
        db = sqlite3.connect(f'file:{self.path}?mode=ro', uri=True, timeout=5)
        db.row_factory = sqlite3.Row
        try:
            yield db
        finally:
            db.close()

    # -- experiment state CAS ----------------------------------------------------------
    def compare_swap_state(self, db: sqlite3.Connection, exp_id: str, old: str, rev: int,
                           new: str, *, error_code: str | None = None) -> int:
        from ..orchestration.state_machine import assert_transition
        assert_transition(old, new)
        cur = db.execute(
            'UPDATE experiments SET state=?, revision=revision+1, updated_utc=?, '
            'error_code=COALESCE(?, error_code) WHERE id=? AND state=? AND revision=?',
            (new, utcnow(), error_code, exp_id, old, rev))
        if cur.rowcount != 1:
            raise H2DS4Error(Code.CONFLICT, 'STATE_CONFLICT')
        return rev + 1

    # -- idempotency -------------------------------------------------------------------
    @staticmethod
    def idempotent(db: sqlite3.Connection, key: str, scope: str,
                   request_digest: str) -> dict | None:
        row = db.execute('SELECT scope, request_digest, response_json FROM idempotency_keys '
                         'WHERE key=?', (key,)).fetchone()
        if row is None:
            return None
        if row['scope'] != scope or row['request_digest'] != request_digest:
            raise H2DS4Error(Code.CONFLICT, 'idempotency key reused with a different payload')
        return json.loads(row['response_json'])

    @staticmethod
    def remember(db: sqlite3.Connection, key: str, scope: str, request_digest: str,
                 response: dict) -> None:
        db.execute('INSERT INTO idempotency_keys VALUES (?,?,?,?,?)',
                   (key, scope, request_digest, json.dumps(response, sort_keys=True), utcnow()))

    # -- audit hash chain (plan §13.3, §28) --------------------------------------------
    @staticmethod
    def audit(db: sqlite3.Connection, *, actor: str, action: str, target: str, outcome: str,
              detail: dict[str, Any] | None = None) -> str:
        row = db.execute('SELECT entry_hash FROM audit_events ORDER BY seq DESC LIMIT 1').fetchone()
        prev = row['entry_hash'] if row else GENESIS_HASH
        ts = utcnow()
        detail_json = canonical_json(detail or {}).decode()
        entry = sha256_hex(canonical_json(
            [prev, ts, actor, action, target, outcome, detail_json]))
        db.execute('INSERT INTO audit_events (timestamp_utc, actor, action, target, outcome, '
                   'prev_hash, entry_hash, detail_json) VALUES (?,?,?,?,?,?,?,?)',
                   (ts, actor, action, target, outcome, prev, entry, detail_json))
        return entry

    def verify_audit(self) -> dict:
        prev = GENESIS_HASH
        n = 0
        with self.read() as db:
            for r in db.execute('SELECT * FROM audit_events ORDER BY seq'):
                expect = sha256_hex(canonical_json(
                    [prev, r['timestamp_utc'], r['actor'], r['action'], r['target'],
                     r['outcome'], r['detail_json']]))
                if r['prev_hash'] != prev or r['entry_hash'] != expect:
                    return {'ok': False, 'broken_at_seq': r['seq'], 'checked': n}
                prev = r['entry_hash']
                n += 1
        return {'ok': True, 'checked': n, 'head': prev}


def _split_sql(sql: str) -> list[str]:
    body = '\n'.join(line for line in sql.splitlines() if not line.strip().startswith('--'))
    return [s.strip() for s in body.split(';') if s.strip()]
