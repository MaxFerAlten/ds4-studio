"""WP15/WP16 (SEC-022, UT-020, pointer recovery, export collisions) and WP08 gate/budget
(UT-013, UT-015, CT-012)."""

import json
import threading
import time
import uuid

import pytest

from h2ds4.canonical import tree_digest
from h2ds4.errors import Code, H2DS4Error
from h2ds4.model.inference_gate import InferenceGate
from h2ds4.orchestration.budgets import Budget, estimate
from h2ds4.overlay import manifest as M
from h2ds4.overlay.approve import BASELINE, OverlayService
from h2ds4.overlay.export import export_skills
from h2ds4.overlay.stage import load_overlay, stage_overlay
from h2ds4.registry import load_base_harness
from h2ds4.store.sqlite import SqliteStore, utcnow

D = 'sha256:' + 'c' * 64
BASE = load_base_harness()


def _cand(name='json-repair'):
    t = dict(BASE)
    t[f'skills/{name}/SKILL.md'] = f'---\nname: {name}\ndescription: d\n---\n- r\n'.encode()
    t['systemprompt.md'] = BASE['systemprompt.md'] + f'- load the `{name}` skill.\n'.encode()
    return t


def _quarantine(store, data_dir, tree, decision='QUARANTINE_CANDIDATE', holdout=True):
    man = M.build(tree, parent_digest=tree_digest(BASE), ds4_snapshot_digest=D,
                  model_profile_digest=D, evidence_digest=D, experiment_id='e')
    stage_overlay(data_dir, tree, man)
    oid = 'ov-' + man['overlay_digest'][7:23]
    with store.tx() as db:
        db.execute("INSERT INTO overlay_versions (id, digest, state, manifest_json, created_utc) "
                   "VALUES (?,?,'QUARANTINED',?,?)", (oid, man['overlay_digest'],
                                                     json.dumps(man), utcnow()))
        if db.execute("SELECT 1 FROM experiments WHERE id='e'").fetchone() is None:
            db.execute("INSERT INTO task_fixtures VALUES ('t','f','{}','d','now')")
            db.execute('INSERT INTO model_profiles VALUES (?,?,?)', (D, '{}', 'now'))
            db.execute('INSERT INTO evaluation_profiles VALUES (?,?,?)', (D, '{}', 'now'))
            db.execute('INSERT INTO harnesses VALUES (?,?,?)', (D, D, 'now'))
            db.execute("INSERT INTO experiments (id, task_id, profile_id, evaluator_id, "
                       "base_overlay_id, substrate, mode, k, state, revision, seed, "
                       "budget_json, created_utc, updated_utc) VALUES ('e','t',?,?,?,"
                       "'scripted_local','lab',1,'QUARANTINED',1,1,'{}','now','now')",
                       (D, D, D))
        db.execute("INSERT INTO candidates VALUES (?,?,?,?,'VALID',?,?,?)",
                   (str(uuid.uuid4()), 'e', man['overlay_digest'], tree_digest(BASE),
                    json.dumps({'decision': decision, 'holdout': {'passed': holdout}}), D,
                    utcnow()))
    return oid, man


@pytest.fixture
def svc(private):
    data = private / 'data'
    data.mkdir(mode=0o700)
    store = SqliteStore(data / 's.sqlite3').initialize()
    return OverlayService(store, data), store, data


def test_manifest_validation_rejects_tampering():
    tree = _cand()
    man = M.build(tree, parent_digest=D, ds4_snapshot_digest=D, model_profile_digest=D,
                  evidence_digest=D, experiment_id='e')
    M.validate(man, tree)
    for mutate in (lambda m: m.update(allowed_tools=['bash']),
                   lambda m: m.update(approval_required=False),
                   lambda m: m.update(engine_commit='main'),
                   lambda m: m['files'][0].update(sha256='0' * 64),
                   lambda m: m.update(extra=1)):
        bad = json.loads(json.dumps(man))
        mutate(bad)
        with pytest.raises(ValueError):
            M.validate(bad, tree)


def test_stage_is_verified_and_idempotent(svc):
    _o, store, data = svc
    tree = _cand()
    oid, man = _quarantine(store, data, tree)
    got, m2 = load_overlay(data, man['overlay_digest'])
    assert got == tree and m2 == man
    stage_overlay(data, tree, man)  # idempotent
    assert not [p for p in (data / 'overlays').iterdir() if p.name.startswith('.')]


def test_approval_requires_valid_candidate_and_cas(svc):
    o, store, data = svc
    oid, _ = _quarantine(store, data, _cand())
    with pytest.raises(H2DS4Error) as e:  # SEC-022 stale expected digest
        o.approve(oid, expected_active_digest=D, reason='looks good')
    assert e.value.code == Code.CONFLICT
    with pytest.raises(H2DS4Error):
        o.approve(oid, expected_active_digest=BASELINE, reason='  ')
    res = o.approve(oid, expected_active_digest=BASELINE, reason='reviewed diff')
    assert res['state'] == 'APPROVED' and res['applied_status'] == 'NOT_APPLIED'
    with pytest.raises(H2DS4Error):
        o.approve(oid, expected_active_digest=BASELINE, reason='again')
    bad_oid, _ = _quarantine(store, data, _cand('other-skill'), decision='KEEP_BASE')
    with pytest.raises(H2DS4Error) as e:
        o.approve(bad_oid, expected_active_digest=BASELINE, reason='x')
    assert e.value.code == Code.POLICY_DENIED


def test_approval_requires_holdout_validation(svc):
    o, store, data = svc
    oid, _ = _quarantine(store, data, _cand('no-holdout'), holdout=False)
    with pytest.raises(H2DS4Error) as e:
        o.approve(oid, expected_active_digest=BASELINE, reason='skip holdout')
    assert e.value.code == Code.POLICY_DENIED and 'holdout' in e.value.detail


def test_activate_is_pointer_only_and_rollback_atomic(svc):
    o, store, data = svc
    oid, man = _quarantine(store, data, _cand())
    with pytest.raises(H2DS4Error):  # QUARANTINED cannot be activated
        o.activate(oid, expected_revision=0, reason='r')
    o.approve(oid, expected_active_digest=BASELINE, reason='ok')
    a = o.activate(oid, expected_revision=0, reason='go')
    assert a['applied_status'] == 'APPROVED_NOT_APPLIED'
    ptr = json.loads((data / 'approved' / 'current.json').read_text())
    assert ptr['digest'] == man['overlay_digest'] and ptr['applied_status'] == 'APPROVED_NOT_APPLIED'
    with pytest.raises(H2DS4Error):  # stale revision
        o.activate(oid, expected_revision=0, reason='again')
    r = o.rollback(expected_revision=1, reason='regression report')
    assert r['active_overlay_id'] is None
    assert json.loads((data / 'approved' / 'current.json').read_text())['digest'] == BASELINE
    assert store.verify_audit()['ok']


def test_pointer_reconciled_after_crash(svc):
    o, store, data = svc
    oid, man = _quarantine(store, data, _cand())
    o.approve(oid, expected_active_digest=BASELINE, reason='ok')
    o.activate(oid, expected_revision=0, reason='go')
    (data / 'approved' / 'current.json').write_text('{"torn":')  # crash mid-write
    assert o.reconcile()['digest'] == man['overlay_digest']
    assert json.loads((data / 'approved' / 'current.json').read_text())['revision'] == 1


def test_ut020_retirement_keeps_approved_manifests(svc):
    o, store, data = svc
    oid, man = _quarantine(store, data, _cand())
    o.approve(oid, expected_active_digest=BASELINE, reason='ok')
    from h2ds4.memory.library import ExperienceLibrary
    lib = ExperienceLibrary(store, ttl_days=-1)
    lib.expire()
    assert load_overlay(data, man['overlay_digest'])[1] == man


def test_export_skills_collision_and_isolation(private):
    canon = private / 'canon'
    (canon / 'soul').mkdir(parents=True)
    (canon / 'soul' / 'SKILL.md').write_text('---\nname: soul\ndescription: s\n---\n')
    stage = private / 'staged'
    tree = _cand('json-repair')
    res = export_skills(canonical_dir=canon, overlay_tree=tree, staging_root=stage,
                        protected_roots=[private / 'ds4'])
    assert res['changes'] == [{'skill': 'json-repair', 'action': 'add'}]
    assert sorted(p.name for p in (stage / res['digest'][7:]).iterdir()) == ['json-repair', 'soul']
    assert (canon / 'soul' / 'SKILL.md').read_text().startswith('---')  # canonical untouched
    clash = _cand('soul')
    with pytest.raises(H2DS4Error) as e:
        export_skills(canonical_dir=canon, overlay_tree=clash, staging_root=stage,
                      protected_roots=[])
    assert e.value.code == Code.CONFLICT
    rep = export_skills(canonical_dir=canon, overlay_tree=clash, staging_root=stage,
                        protected_roots=[], replace=frozenset({'soul'}))
    assert rep['changes'][0]['action'] == 'replace' and rep['changes'][0]['diff']
    with pytest.raises(H2DS4Error):
        export_skills(canonical_dir=canon, overlay_tree=tree, staging_root=canon / 'x',
                      protected_roots=[canon])
    again = export_skills(canonical_dir=canon, overlay_tree=tree, staging_root=stage,
                          protected_roots=[])
    assert again['digest'] == res['digest']  # idempotent


def test_budget_estimates_and_enforcement():
    assert estimate(1)['rollouts'] == 4 and estimate(1)['improvement_sessions'] == 3
    assert estimate(2)['rollouts'] == 8 and estimate(2, selection_policy='selector')[
        'selector_sessions'] == 1
    b = Budget.from_limits(wall_s=60, model_calls=2, tool_calls=1, input_tokens=100,
                           output_tokens=10)
    b.before_model(50, 5)
    with pytest.raises(H2DS4Error):
        b.before_model(60, 1)  # UT-013 input over budget
    b.before_model(10, 5)
    with pytest.raises(H2DS4Error):
        b.before_model(1, 1)  # call budget
    b.before_tool()
    with pytest.raises(H2DS4Error):
        b.before_tool()
    expired = Budget.from_limits(wall_s=-1, model_calls=5, tool_calls=5, input_tokens=5,
                                 output_tokens=5)
    with pytest.raises(H2DS4Error) as e:
        expired.before_model(1, 1)
    assert e.value.code == Code.DEADLINE_EXCEEDED


def test_ut015_gate_releases_on_error_but_blocks_when_uncertain():
    g = InferenceGate()
    with pytest.raises(RuntimeError):
        with g.permit('e', 'p'):
            raise RuntimeError('client error')
    with g.permit('e', 'p'):
        pass  # released after an ordinary exception
    with pytest.raises(H2DS4Error):
        with g.permit('e', 'p'):
            raise H2DS4Error(Code.DEADLINE_EXCEEDED, 'timeout mid-request')
    assert g.uncertain
    with pytest.raises(H2DS4Error) as e:
        g.acquire('e', 'p', timeout_s=0.1)
    assert 'MODEL_UNCERTAIN' in e.value.detail
    g.reset_uncertain()
    g.release(g.acquire('e', 'p'))
    with pytest.raises(ValueError):
        InferenceGate(inflight=2)


def test_ct012_gate_serialises_threads():
    g = InferenceGate()
    active, peak = [0], [0]
    lock = threading.Lock()

    def work():
        with g.permit('e', 'p', timeout_s=10):
            with lock:
                active[0] += 1
                peak[0] = max(peak[0], active[0])
            time.sleep(0.02)
            with lock:
                active[0] -= 1

    ts = [threading.Thread(target=work) for _ in range(8)]
    for t in ts:
        t.start()
    for t in ts:
        t.join()
    assert peak[0] == 1 and g.max_observed_inflight == 1
