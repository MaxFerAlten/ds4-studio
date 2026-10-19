"""Approval, activation of the external pointer, and rollback (plan §13.2, §21.3, §32.4).

Three distinct operations, never conflated:

- approve:  QUARANTINED -> APPROVED, CAS on the active digest inside the DB lock;
- activate: moves the external `production` pointer. DS4 exposes no per-task or hot-reload
  API (BLOCKED_API), so the status is APPROVED_NOT_APPLIED, never ACTIVE;
- rollback: pointer back to the previous overlay (or the canonical baseline).

`current.json` is written only after commit; `reconcile()` repairs it idempotently after a
crash between the two.
"""

from __future__ import annotations

import json
import os
import uuid
from pathlib import Path

from ..errors import Code, H2DS4Error
from ..store.sqlite import SqliteStore, utcnow
from .stage import write_pointer

BASELINE = 'baseline'
APPLIED_STATUS = 'APPROVED_NOT_APPLIED'


def os_actor() -> str:
    return f'uid:{os.getuid()}'


class OverlayService:
    def __init__(self, store: SqliteStore, data_dir: Path):
        self.store = store
        self.pointer = data_dir / 'approved' / 'current.json'

    @staticmethod
    def _active(db) -> tuple[str, str | None, str | None, int]:
        row = db.execute('SELECT a.overlay_id, a.previous_overlay_id, a.revision, o.digest '
                         'FROM active_overlay a LEFT JOIN overlay_versions o '
                         'ON o.id = a.overlay_id WHERE slot=\'production\'').fetchone()
        if row is None or row['overlay_id'] is None:
            return BASELINE, None, row['previous_overlay_id'] if row else None, \
                row['revision'] if row else 0
        return row['digest'], row['overlay_id'], row['previous_overlay_id'], row['revision']

    def status(self) -> dict:
        with self.store.read() as db:
            digest, oid, prev, rev = self._active(db)
            overlays = [dict(r) for r in db.execute(
                'SELECT id, digest, state, created_utc, approved_utc, approved_by '
                'FROM overlay_versions ORDER BY created_utc')]
        return {'active_digest': digest, 'active_overlay_id': oid, 'previous_overlay_id': prev,
                'revision': rev, 'applied_status': APPLIED_STATUS if oid else 'BASELINE',
                'applied_note': 'DS4 has no per-task/hot-reload skill API: an activated '
                                'pointer takes effect only via a manual, voluntary DS4 start '
                                'with DS4_SKILLS_DIR (see `overlay export-skills`).',
                'overlays': overlays}

    def approve(self, overlay_id: str, *, expected_active_digest: str, reason: str,
                actor: str | None = None) -> dict:
        actor = actor or os_actor()
        if not reason.strip() or len(reason) > 1000:
            raise H2DS4Error(Code.INVALID_INPUT, 'approval reason required')
        with self.store.tx() as db:
            ov = db.execute('SELECT * FROM overlay_versions WHERE id=?', (overlay_id,)).fetchone()
            if ov is None:
                raise H2DS4Error(Code.NOT_FOUND, 'overlay not found')
            if ov['state'] != 'QUARANTINED':
                raise H2DS4Error(Code.CONFLICT, f'overlay is {ov["state"]}, not QUARANTINED')
            cand = db.execute('SELECT status, validation_json FROM candidates WHERE '
                              'overlay_digest=? ORDER BY created_utc DESC LIMIT 1',
                              (ov['digest'],)).fetchone()
            validation = json.loads(cand['validation_json']) if cand else {}
            if cand is None or cand['status'] != 'VALID' or \
                    validation.get('decision') != 'QUARANTINE_CANDIDATE':
                raise H2DS4Error(Code.POLICY_DENIED, 'candidate did not pass every gate')
            if not (validation.get('holdout') or {}).get('passed'):
                raise H2DS4Error(Code.POLICY_DENIED, 'holdout validation missing or failed: run '
                                 '`h2ds4 overlay validate` (plan §36.4)')
            active, *_ = self._active(db)
            if active != expected_active_digest:
                raise H2DS4Error(Code.CONFLICT, 'stale expected active digest (CAS failed)')
            now = utcnow()
            db.execute('INSERT INTO approvals VALUES (?,?,?,?,?,?,?)',
                       (str(uuid.uuid4()), overlay_id, expected_active_digest, actor,
                        'APPROVE', reason, now))
            db.execute('UPDATE overlay_versions SET state=\'APPROVED\', approved_utc=?, '
                       'approved_by=? WHERE id=? AND state=\'QUARANTINED\'',
                       (now, actor, overlay_id))
            db.execute('UPDATE candidates SET status=\'APPROVED\' WHERE overlay_digest=?',
                       (ov['digest'],))
            self.store.audit(db, actor=actor, action='overlay-approved', target=overlay_id,
                             outcome='ok', detail={'digest': ov['digest'], 'reason': reason})
        return {'overlay_id': overlay_id, 'state': 'APPROVED', 'applied_status': 'NOT_APPLIED'}

    def activate(self, overlay_id: str, *, expected_revision: int, reason: str,
                 actor: str | None = None) -> dict:
        actor = actor or os_actor()
        with self.store.tx() as db:
            ov = db.execute('SELECT * FROM overlay_versions WHERE id=?', (overlay_id,)).fetchone()
            if ov is None or ov['state'] != 'APPROVED':
                raise H2DS4Error(Code.POLICY_DENIED, 'only APPROVED overlays can be activated')
            active, active_id, _prev, rev = self._active(db)
            if rev != expected_revision:
                raise H2DS4Error(Code.CONFLICT, 'stale pointer revision (CAS failed)')
            self._move(db, overlay_id, active_id, rev)
            db.execute('INSERT INTO approvals VALUES (?,?,?,?,?,?,?)',
                       (str(uuid.uuid4()), overlay_id, active, actor, 'ACTIVATE', reason,
                        utcnow()))
            self.store.audit(db, actor=actor, action='overlay-activated', target=overlay_id,
                             outcome=APPLIED_STATUS, detail={'from': active, 'revision': rev + 1})
        self.reconcile()
        return {'overlay_id': overlay_id, 'revision': rev + 1, 'applied_status': APPLIED_STATUS}

    def rollback(self, *, expected_revision: int, reason: str, actor: str | None = None) -> dict:
        actor = actor or os_actor()
        if not reason.strip():
            raise H2DS4Error(Code.INVALID_INPUT, 'rollback reason required')
        with self.store.tx() as db:
            active, active_id, prev, rev = self._active(db)
            if rev != expected_revision:
                raise H2DS4Error(Code.CONFLICT, 'stale pointer revision (CAS failed)')
            if active_id is None:
                raise H2DS4Error(Code.CONFLICT, 'already at baseline')
            self._move(db, prev, None, rev)
            db.execute('INSERT INTO approvals VALUES (?,?,?,?,?,?,?)',
                       (str(uuid.uuid4()), active_id, active, actor, 'ROLLBACK', reason,
                        utcnow()))
            self.store.audit(db, actor=actor, action='overlay-rollback', target=active_id,
                             outcome='ok', detail={'to': prev or BASELINE, 'revision': rev + 1})
        self.reconcile()
        return {'active_overlay_id': prev, 'revision': rev + 1}

    @staticmethod
    def _move(db, new_id: str | None, previous_id: str | None, rev: int) -> None:
        if rev == 0 and db.execute('SELECT 1 FROM active_overlay').fetchone() is None:
            db.execute('INSERT INTO active_overlay VALUES (\'production\', ?, ?, 1, ?)',
                       (new_id, previous_id, utcnow()))
            return
        cur = db.execute('UPDATE active_overlay SET overlay_id=?, previous_overlay_id=?, '
                         'revision=revision+1, updated_utc=? WHERE slot=\'production\' '
                         'AND revision=?', (new_id, previous_id, utcnow(), rev))
        if cur.rowcount != 1:
            raise H2DS4Error(Code.CONFLICT, 'pointer CAS failed')

    def reconcile(self) -> dict:
        with self.store.read() as db:
            digest, oid, _prev, rev = self._active(db)
        payload = {'slot': 'production', 'overlay_id': oid, 'digest': digest, 'revision': rev,
                   'applied_status': APPLIED_STATUS if oid else 'BASELINE'}
        try:
            current = json.loads(self.pointer.read_text(encoding='utf-8'))
        except (OSError, ValueError):
            current = None
        if current != payload:
            write_pointer(self.pointer, payload)
        return payload
