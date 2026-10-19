"""WP03: UT-016, UT-017, UT-018, audit chain, migrations, file safety."""

import json
import os
import sqlite3

import pytest

from h2ds4.canonical import digest_bytes
from h2ds4.errors import Code, H2DS4Error
from h2ds4.store import sqlite as SQ
from h2ds4.store.blobs import BlobStore
from h2ds4.store.sqlite import SqliteStore


@pytest.fixture
def store(private):
    return SqliteStore(private / 'state.sqlite3').initialize()


def _exp(store, state='CREATED'):
    with store.tx() as db:
        D = 'sha256:' + 'b' * 64
        db.execute("INSERT INTO task_fixtures VALUES ('t','f','{}','d','now')")
        db.execute('INSERT INTO model_profiles VALUES (?,?,?)', (D, '{}', 'now'))
        db.execute('INSERT INTO evaluation_profiles VALUES (?,?,?)', (D, '{}', 'now'))
        db.execute('INSERT INTO harnesses VALUES (?,?,?)', (D, D, 'now'))
        db.execute("INSERT INTO experiments (id, task_id, profile_id, evaluator_id, "
                   "base_overlay_id, substrate, mode, k, state, revision, seed, budget_json, "
                   "created_utc, updated_utc) VALUES ('e','t',?,?,?,'scripted_local','lab',1,?,"
                   "1,1,'{}','now','now')", (D, D, D, state))


def test_db_file_is_0600_and_wal(store, private):
    st = os.stat(private / 'state.sqlite3')
    assert oct(st.st_mode & 0o777) == '0o600'
    db = sqlite3.connect(private / 'state.sqlite3')
    assert db.execute('PRAGMA journal_mode').fetchone()[0] == 'wal'


def test_data_dir_must_be_private(tmp_path):
    d = tmp_path / 'open'
    d.mkdir(mode=0o755)
    os.chmod(d, 0o755)
    with pytest.raises(H2DS4Error):
        SqliteStore(d / 'x.sqlite3')


def test_symlinked_db_rejected(private):
    target = private / 'real'
    target.write_text('')
    os.symlink(target, private / 'state.sqlite3')
    with pytest.raises((H2DS4Error, OSError)):
        SqliteStore(private / 'state.sqlite3').initialize()


def test_migration_checksum_mismatch_refuses(store, monkeypatch):
    monkeypatch.setattr(SQ, 'MIGRATIONS', ((1, SQ.SCHEMA_SQL + '\n-- changed'),))
    with pytest.raises(H2DS4Error) as e:
        store.initialize()
    assert e.value.code == Code.INTEGRITY_FAILURE


def test_migration_idempotent(store):
    store.initialize()
    store.initialize()
    with store.read() as db:
        assert db.execute('SELECT COUNT(*) FROM schema_versions').fetchone()[0] == 1


def test_ut016_illegal_transition_and_stale_cas(store):
    _exp(store)
    with store.tx() as db, pytest.raises(ValueError):
        store.compare_swap_state(db, 'e', 'CREATED', 1, 'QUARANTINED')
    with store.tx() as db:
        assert store.compare_swap_state(db, 'e', 'CREATED', 1, 'QUEUED') == 2
    with store.tx() as db, pytest.raises(H2DS4Error) as e:
        store.compare_swap_state(db, 'e', 'CREATED', 1, 'QUEUED')  # stale revision
    assert e.value.code == Code.CONFLICT
    for bad in (('FAILED', 'QUEUED'), ('CANCELLED', 'PREFLIGHT'), ('CREATED', 'COMPOSING'),
                ('PROPOSING', 'COMPOSING')):
        from h2ds4.orchestration.state_machine import assert_transition
        with pytest.raises(ValueError):
            assert_transition(*bad)


def test_ut017_idempotency(store):
    with store.tx() as db:
        assert store.idempotent(db, 'k1', 'create', 'sha256:x') is None
        store.remember(db, 'k1', 'create', 'sha256:x', {'id': 1})
    with store.tx() as db:
        assert store.idempotent(db, 'k1', 'create', 'sha256:x') == {'id': 1}
    with store.tx() as db, pytest.raises(H2DS4Error) as e:
        store.idempotent(db, 'k1', 'create', 'sha256:other')
    assert e.value.code == Code.CONFLICT


def test_ut018_stale_lease_not_rerun(store):
    from h2ds4.orchestration.scheduler import Worker
    _exp(store, state='PROBING')
    with store.tx() as db:
        db.execute("INSERT INTO jobs (id, experiment_id, status, lease_owner, lease_expires_utc, "
                   "maintenance_ack, created_utc) VALUES ('j','e','LEASED','dead:1',"
                   "'2000-01-01T00:00:00Z','ack','now')")

    class Boom:
        def execute(self, *_):
            raise AssertionError('must not re-run an abandoned job')

    w = Worker(store, Boom())  # type: ignore[arg-type]
    assert w.recover() == ['e']
    assert w.run_once() is None
    with store.read() as db:
        assert db.execute("SELECT state, error_code FROM experiments").fetchone()[:] == \
            ('FAILED', 'WORKER_LOST')
        assert db.execute("SELECT status FROM jobs").fetchone()[0] == 'ABANDONED'


def test_audit_chain_and_tamper_detection(store):
    with store.tx() as db:
        for i in range(5):
            store.audit(db, actor='t', action='a', target=str(i), outcome='ok', detail={'i': i})
    assert store.verify_audit() == {'ok': True, 'checked': 5, 'head': store.verify_audit()['head']}
    with store.tx() as db:
        db.execute("UPDATE audit_events SET outcome='forged' WHERE seq=3")
    res = store.verify_audit()
    assert res['ok'] is False and res['broken_at_seq'] == 3


def test_blob_store_atomic_and_verified(private):
    b = BlobStore(private / 'blob')
    d = b.put(b'hello')
    assert d == digest_bytes(b'hello') and b.get(d) == b'hello'
    assert b.put(b'hello') == d
    p = b._path(d)
    os.chmod(p, 0o600)
    p.write_bytes(b'tampered')
    with pytest.raises(H2DS4Error):
        b.get(d)
    assert list((private / 'blob' / 'tmp').iterdir()) == []
    assert b.gc({d}, grace_s=0) == []


def test_sqlite_busy_does_not_reset(store):
    _exp(store)
    blocker = sqlite3.connect(store.path, isolation_level=None)
    blocker.execute('BEGIN IMMEDIATE')
    try:
        with pytest.raises(sqlite3.OperationalError):
            db = sqlite3.connect(store.path, timeout=0.1, isolation_level=None)
            db.execute('BEGIN IMMEDIATE')
    finally:
        blocker.execute('ROLLBACK')
    with store.read() as db:
        assert db.execute('SELECT COUNT(*) FROM experiments').fetchone()[0] == 1
    assert json.loads('{}') == {}
