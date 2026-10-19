"""Backend operations behind the UDS API: a finite set of actions, policy-checked here.

Mode policy (plan §1.1, WP07): `off` refuses every mutation, `observe` is read-only,
`lab` allows lab experiments, `propose` adds propose experiments, `approved` adds overlay
activation. Approval/activation/rollback additionally need the admin role.
"""

from __future__ import annotations

import json
import uuid
from pathlib import Path

from .canonical import digest_obj
from .errors import Code, H2DS4Error
from .models import ExperimentCreate
from .orchestration.budgets import estimate
from .overlay.approve import OverlayService
from .settings import Mode, Settings
from .store.blobs import BlobStore
from .store.sqlite import SqliteStore, utcnow
from .substrates.ds4_native import Ds4NativeSubstrate
from .substrates.opencode_local import OpencodeLocalSubstrate

_MUTATING_MODES = {
    'create:lab': (Mode.LAB, Mode.PROPOSE, Mode.APPROVED),
    'create:propose': (Mode.PROPOSE, Mode.APPROVED),
    'run': (Mode.LAB, Mode.PROPOSE, Mode.APPROVED),
    'cancel': (Mode.LAB, Mode.PROPOSE, Mode.APPROVED, Mode.OBSERVE),
    'approve': (Mode.PROPOSE, Mode.APPROVED),
    'validate': (Mode.LAB, Mode.PROPOSE, Mode.APPROVED),
    'activate': (Mode.APPROVED,),
    'rollback': (Mode.PROPOSE, Mode.APPROVED, Mode.OBSERVE, Mode.LAB),
}
MAINTENANCE_ACK = 'I confirm no DS4 chat or agent session is active'
# Pessimistic model calls one OpenCode rollout may make (agent turns). A planning bound for
# refusing jobs up front, to be calibrated by the first L5 run, not a measured value.
CALLS_PER_MODEL_ROLLOUT = 4


class Service:
    def __init__(self, settings: Settings, store: SqliteStore, blobs: BlobStore,
                 fixtures_root: Path):
        self.s = settings
        self.store = store
        self.blobs = blobs
        self.fixtures_root = fixtures_root
        self.overlays = OverlayService(store, settings.data_dir)

    def _require_mode(self, action: str) -> None:
        if self.s.service.mode not in _MUTATING_MODES[action]:
            raise H2DS4Error(Code.POLICY_DENIED,
                             f'service mode {self.s.service.mode} forbids {action}')

    # -- read --------------------------------------------------------------------------
    def capabilities(self) -> dict:
        oc = OpencodeLocalSubstrate(None, model_id=self.s.ds4.model_id)  # type: ignore[arg-type]
        ocp = oc.preflight()
        return {'protocol': 1, 'mode': str(self.s.service.mode),
                'substrates': {
                    'scripted_local': {'ready': True, 'model_backed': False},
                    'opencode_local': {'ready': ocp['ready'], 'status': ocp['status'],
                                       'blockers': ocp['blockers']},
                    'ds4_native': Ds4NativeSubstrate().preflight()},
                'native_ds4': False, 'max_inflight': 1, 'max_k': self.s.experiment.max_k}

    def get_experiment(self, exp_id: str) -> dict:
        with self.store.read() as db:
            row = db.execute('SELECT id, task_id, mode, substrate, k, state, revision, seed, '
                             'error_code, decision_json, budget_json, created_utc, updated_utc '
                             'FROM experiments WHERE id=?', (exp_id,)).fetchone()
            if row is None:
                raise H2DS4Error(Code.NOT_FOUND, 'experiment not found')
            runs = [dict(r) for r in db.execute(
                'SELECT label, status, model_calls, tool_calls, token_in, token_out, '
                'usage_source, duration_ms FROM runs WHERE experiment_id=? ORDER BY rowid',
                (exp_id,))]
        out = dict(row)
        dec = json.loads(out.pop('decision_json') or 'null')
        out['budget'] = json.loads(out.pop('budget_json'))
        out['decision'] = {k: dec.get(k) for k in ('decision', 'reason', 'overlay')} \
            if dec else None
        out['runs'] = runs
        return out

    def list_experiments(self, limit: int = 50) -> list[dict]:
        with self.store.read() as db:
            return [dict(r) for r in db.execute(
                'SELECT id, task_id, state, mode, substrate, k, updated_utc FROM experiments '
                'ORDER BY created_utc DESC LIMIT ?', (min(limit, 200),))]

    def candidates(self, exp_id: str) -> list[dict]:
        self.get_experiment(exp_id)
        with self.store.read() as db:
            return [{**dict(r), 'validation': json.loads(r['validation_json'])} for r in
                    db.execute('SELECT id, overlay_digest, parent_digest, status, '
                               'validation_json, evidence_digest, created_utc FROM candidates '
                               'WHERE experiment_id=?', (exp_id,))]

    def evidence(self, exp_id: str) -> dict:
        self.get_experiment(exp_id)
        with self.store.read() as db:
            row = db.execute('SELECT decision_json FROM experiments WHERE id=?',
                             (exp_id,)).fetchone()
            evals = [dict(r) for r in db.execute(
                'SELECT r.label, e.verdict, e.metric_json, e.provenance_digest '
                'FROM evaluations e JOIN runs r ON r.id = e.run_id WHERE e.experiment_id=?',
                (exp_id,))]
        dec = json.loads(row['decision_json'] or 'null') or {}
        for e in evals:
            m = json.loads(e.pop('metric_json'))
            e['metrics'] = {k: m[k] for k in ('success', 'quality', 'hard_failures',
                                              'security_violations', 'tool_calls')}
        return {'decision': dec.get('decision'), 'reason': dec.get('reason'),
                'baseline': dec.get('baseline'), 'candidate': dec.get('candidate'),
                'ledger': dec.get('ledger'), 'proxy': dec.get('proxy'), 'evaluations': evals}

    def audit(self, *, after: int = 0, limit: int = 100) -> dict:
        with self.store.read() as db:
            rows = [dict(r) for r in db.execute(
                'SELECT seq, timestamp_utc, actor, action, target, outcome, entry_hash '
                'FROM audit_events WHERE seq > ? ORDER BY seq LIMIT ?', (after, min(limit, 500)))]
        return {'events': rows, 'next': rows[-1]['seq'] if rows else after}

    # -- mutate --------------------------------------------------------------------------
    def create_experiment(self, req: ExperimentCreate, idem: str) -> dict:
        self._require_mode(f'create:{req.mode}')
        if req.substrate == 'ds4_native':
            raise H2DS4Error(Code.BLOCKED_API, 'ds4_native substrate is BLOCKED_API')
        if req.k > self.s.experiment.max_k:
            raise H2DS4Error(Code.POLICY_DENIED, 'k above configured max_k')
        est = estimate(req.k, selection_policy='trivial' if req.k == 1 else 'selector',
                       reflection_enabled=False)
        if req.substrate == 'opencode_local' and \
                est['max_proposer_calls'] + est['rollouts'] * CALLS_PER_MODEL_ROLLOUT > \
                self.s.experiment.max_model_calls:
            raise H2DS4Error(Code.BUDGET_EXCEEDED,
                             'estimated model calls exceed max_model_calls; refuse before start')
        req_digest = digest_obj(req.model_dump())
        with self.store.tx() as db:
            prior = self.store.idempotent(db, idem, 'create', req_digest)
            if prior is not None:
                return prior
            fx = db.execute('SELECT family, spec_json FROM task_fixtures WHERE id=?',
                            (req.task_id,)).fetchone()
            if fx is None:
                raise H2DS4Error(Code.NOT_FOUND, 'task fixture not registered')
            if req.workspace_fixture_id != req.task_id or fx['family'] != req.task_family:
                raise H2DS4Error(Code.INVALID_INPUT, 'fixture id/family mismatch')
            if json.loads(fx['spec_json'])['evaluator_digest'] != req.evaluation_profile_id:
                raise H2DS4Error(Code.INVALID_INPUT, 'evaluation profile not bound to fixture')
            for table, value in (('harnesses', req.baseline_harness_id),
                                 ('model_profiles', req.model_profile_id),
                                 ('evaluation_profiles', req.evaluation_profile_id)):
                if db.execute(f'SELECT 1 FROM {table} WHERE id=?', (value,)).fetchone() is None:
                    raise H2DS4Error(Code.NOT_FOUND, f'{table[:-1]} not registered')
            exp_id = str(uuid.uuid4())
            now = utcnow()
            db.execute('INSERT INTO experiments (id, task_id, profile_id, evaluator_id, '
                       'base_overlay_id, substrate, mode, k, state, revision, seed, budget_json,'
                       ' created_utc, updated_utc) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
                       (exp_id, req.task_id, req.model_profile_id, req.evaluation_profile_id,
                        req.baseline_harness_id, req.substrate, req.mode, req.k, 'CREATED', 1,
                        req.run_seed, json.dumps(est), now, now))
            self.store.audit(db, actor='operator', action='job-created', target=exp_id,
                             outcome='CREATED', detail={'task': req.task_id, 'k': req.k})
            resp = {'schema_version': 1, 'id': exp_id, 'status': 'CREATED', 'revision': 1,
                    'approval_required': True, 'budget': est,
                    'capabilities': {'native_ds4': False, 'opencode_local': False,
                                     'scripted_local': True}}
            self.store.remember(db, idem, 'create', req_digest, resp)
        return resp

    def queue_run(self, exp_id: str, idem: str, *, maintenance_ack: str) -> dict:
        self._require_mode('run')
        if maintenance_ack != MAINTENANCE_ACK:
            raise H2DS4Error(Code.POLICY_DENIED,
                             f'maintenance window not acknowledged; send exactly: '
                             f'"{MAINTENANCE_ACK}"')
        req_digest = digest_obj({'exp': exp_id})
        with self.store.tx() as db:
            prior = self.store.idempotent(db, idem, 'run', req_digest)
            if prior is not None:
                return prior
            row = db.execute('SELECT state, revision FROM experiments WHERE id=?',
                             (exp_id,)).fetchone()
            if row is None:
                raise H2DS4Error(Code.NOT_FOUND, 'experiment not found')
            busy = db.execute("SELECT COUNT(*) FROM jobs WHERE status IN ('QUEUED','LEASED')"
                              ).fetchone()[0]
            if busy >= self.s.inference.max_queued:
                raise H2DS4Error(Code.MODEL_BUSY, 'queue full (max_queued=1)')
            self.store.compare_swap_state(db, exp_id, row['state'], row['revision'], 'QUEUED')
            db.execute('INSERT INTO jobs (id, experiment_id, status, maintenance_ack, '
                       'created_utc) VALUES (?,?,?,?,?)',
                       (str(uuid.uuid4()), exp_id, 'QUEUED', maintenance_ack, utcnow()))
            self.store.audit(db, actor='operator', action='job-queued', target=exp_id,
                             outcome='QUEUED', detail={'maintenance_ack': True})
            resp = {'id': exp_id, 'status': 'QUEUED'}
            self.store.remember(db, idem, 'run', req_digest, resp)
        return resp

    def cancel(self, exp_id: str) -> dict:
        self._require_mode('cancel')
        with self.store.tx() as db:
            row = db.execute('SELECT state, revision FROM experiments WHERE id=?',
                             (exp_id,)).fetchone()
            if row is None:
                raise H2DS4Error(Code.NOT_FOUND, 'experiment not found')
            state = row['state']
            if state in ('CANCELLED', 'CANCEL_REQUESTED', 'FAILED', 'REJECTED', 'QUARANTINED'):
                return {'id': exp_id, 'status': state}  # idempotent
            db.execute('UPDATE jobs SET cancel_requested=1 WHERE experiment_id=?', (exp_id,))
            leased = db.execute("SELECT 1 FROM jobs WHERE experiment_id=? AND status='LEASED'",
                                (exp_id,)).fetchone()
            self.store.audit(db, actor='operator', action='job-cancelled', target=exp_id,
                             outcome='requested')
            if leased:
                return {'id': exp_id, 'status': 'CANCEL_REQUESTED'}  # worker finishes it
            rev = self.store.compare_swap_state(db, exp_id, state, row['revision'],
                                                'CANCEL_REQUESTED')
            self.store.compare_swap_state(db, exp_id, 'CANCEL_REQUESTED', rev, 'CANCELLED')
            db.execute("UPDATE jobs SET status='DONE' WHERE experiment_id=?", (exp_id,))
        return {'id': exp_id, 'status': 'CANCELLED'}

    def validate_overlay(self, overlay_id: str) -> dict:
        self._require_mode('validate')
        from .overlay.validate import validate_overlay
        from .sandbox.bwrap import BwrapSandbox, Limits
        sb = self.s.sandbox
        sandbox = BwrapSandbox(self.s.cache_dir, Limits(
            wall_s=float(self.s.experiment.max_task_wall_s), memory_mib=sb.memory_max_mib,
            pids_max=sb.pids_max, cpu_quota_pct=sb.cpu_quota_pct,
            workspace_mib=sb.workspace_max_mib))
        res = validate_overlay(self, overlay_id, sandbox=sandbox)
        return {k: v for k, v in res.items() if k != 'rows'} | {
            'rows': [{k: r[k] for k in ('task', 'base', 'candidate')} for r in res['rows']]}

    def approve(self, overlay_id: str, *, expected_active_digest: str, reason: str) -> dict:
        self._require_mode('approve')
        return self.overlays.approve(overlay_id, expected_active_digest=expected_active_digest,
                                     reason=reason)

    def activate(self, overlay_id: str, *, expected_revision: int, reason: str) -> dict:
        self._require_mode('activate')
        return self.overlays.activate(overlay_id, expected_revision=expected_revision,
                                      reason=reason)

    def rollback(self, *, expected_revision: int, reason: str) -> dict:
        self._require_mode('rollback')
        return self.overlays.rollback(expected_revision=expected_revision, reason=reason)
