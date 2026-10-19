"""Persistent single-worker scheduler (plan §31.4, WP10).

Jobs live in SQLite. One worker claims QUEUED jobs with BEGIN IMMEDIATE and holds a lease
refreshed by a heartbeat. On startup, a lease left by a dead worker is ABANDONED and its
experiment FAILED (WORKER_LOST): tools with side effects are never re-run automatically.
The single-writer guarantee across processes comes from the data-dir lock in serve.py.
"""

from __future__ import annotations

import os
import threading
import uuid

from ..store.sqlite import SqliteStore, utc_after, utcnow
from .engine import Engine

LEASE_S = 60
HEARTBEAT_S = 10


class Worker:
    def __init__(self, store: SqliteStore, engine: Engine, *, poll_s: float = 0.5):
        self.store = store
        self.engine = engine
        self.poll_s = poll_s
        self.owner = f'{os.getpid()}:{uuid.uuid4().hex[:8]}'
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    def recover(self) -> list[str]:
        """Reconcile after a crash: abandon expired leases, fail their experiments."""
        failed = []
        now = utcnow()
        with self.store.tx() as db:
            for job in db.execute("SELECT * FROM jobs WHERE status='LEASED'").fetchall():
                if job['lease_expires_utc'] and job['lease_expires_utc'] > now \
                        and job['lease_owner'] == self.owner:
                    continue
                db.execute("UPDATE jobs SET status='ABANDONED' WHERE id=?", (job['id'],))
                exp = db.execute('SELECT state, revision FROM experiments WHERE id=?',
                                 (job['experiment_id'],)).fetchone()
                if exp and exp['state'] not in ('FAILED', 'CANCELLED', 'REJECTED',
                                                'QUARANTINED'):
                    target = 'CANCELLED' if exp['state'] == 'CANCEL_REQUESTED' else 'FAILED'
                    db.execute('UPDATE experiments SET state=?, revision=revision+1, '
                               "error_code='WORKER_LOST', updated_utc=? WHERE id=?",
                               (target, now, job['experiment_id']))
                    failed.append(job['experiment_id'])
                self.store.audit(db, actor='h2ds4', action='lease-recovered',
                                 target=job['experiment_id'], outcome='WORKER_LOST',
                                 detail={'note': 'not re-run: tools may have side effects'})
        return failed

    def claim(self) -> dict | None:
        with self.store.tx() as db:
            job = db.execute("SELECT * FROM jobs WHERE status='QUEUED' ORDER BY created_utc "
                             'LIMIT 1').fetchone()
            if job is None:
                return None
            if job['cancel_requested']:
                db.execute("UPDATE jobs SET status='DONE' WHERE id=?", (job['id'],))
                return None
            cur = db.execute("UPDATE jobs SET status='LEASED', lease_owner=?, "
                             "lease_expires_utc=?, heartbeat_utc=? WHERE id=? AND status='QUEUED'",
                             (self.owner, utc_after(LEASE_S), utcnow(), job['id']))
            if cur.rowcount != 1:
                return None
            return dict(job)

    def _heartbeat(self, job_id: str, done: threading.Event) -> None:
        while not done.wait(HEARTBEAT_S):
            with self.store.tx() as db:
                db.execute('UPDATE jobs SET lease_expires_utc=?, heartbeat_utc=? WHERE id=? '
                           'AND lease_owner=?', (utc_after(LEASE_S), utcnow(), job_id, self.owner))

    def run_once(self) -> dict | None:
        job = self.claim()
        if job is None:
            return None
        done = threading.Event()
        hb = threading.Thread(target=self._heartbeat, args=(job['id'], done), daemon=True)
        hb.start()
        try:
            result = self.engine.execute(job['experiment_id'])
        finally:
            done.set()
            hb.join(timeout=5)
            with self.store.tx() as db:
                db.execute("UPDATE jobs SET status='DONE' WHERE id=? AND lease_owner=?",
                           (job['id'], self.owner))
        return result

    def serve(self) -> None:
        self.recover()
        while not self._stop.is_set():
            if self.run_once() is None:
                self._stop.wait(self.poll_s)

    def start(self) -> Worker:
        self._thread = threading.Thread(target=self.serve, name='h2ds4-worker', daemon=True)
        self._thread.start()
        return self

    def stop(self, timeout: float = 30) -> None:
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout=timeout)
