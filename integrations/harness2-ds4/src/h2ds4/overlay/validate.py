"""Holdout validation of a quarantined overlay before approval (plan §21.2, §36.4).

A win on the task that generated a skill is not evidence the skill is good. The A/B run
showed it: dev-learned skills applied to holdout trap tasks regress. So approval requires
a paired comparison on the held-out tasks of the same domain (the generating task
excluded): zero critical regressions and a non-negative bootstrap lower bound.
"""

from __future__ import annotations

import json
from dataclasses import dataclass

from ..benchmarks.ab import paired_bootstrap
from ..errors import Code, H2DS4Error
from ..evidence.evaluator import evaluate
from ..fixtures import list_fixtures, load_evaluator, load_fixture
from ..registry import resolve_harness
from ..sandbox.bwrap import BwrapSandbox
from ..store.sqlite import utcnow
from ..substrates.scripted_local import ScriptedLocalSubstrate
from .stage import load_overlay


@dataclass(frozen=True)
class HoldoutRule:
    tolerance: float = 0.0
    min_tasks: int = 1


def validate_overlay(service, overlay_id: str, *, sandbox: BwrapSandbox,
                     rule: HoldoutRule | None = None) -> dict:
    rule = rule or HoldoutRule()
    with service.store.read() as db:
        ov = db.execute('SELECT * FROM overlay_versions WHERE id=?', (overlay_id,)).fetchone()
        if ov is None:
            raise H2DS4Error(Code.NOT_FOUND, 'overlay not found')
        cand = db.execute('SELECT c.id, c.validation_json, e.task_id, e.base_overlay_id, '
                          'e.substrate FROM candidates c JOIN experiments e ON '
                          'e.id = c.experiment_id WHERE c.overlay_digest=? ORDER BY '
                          'c.created_utc DESC LIMIT 1', (ov['digest'],)).fetchone()
    if cand is None:
        raise H2DS4Error(Code.NOT_FOUND, 'no candidate record for overlay')
    if cand['substrate'] != 'scripted_local':
        raise H2DS4Error(Code.CAPABILITY_MISSING,
                         'holdout validation for model-backed substrates needs the L5 path')
    root = service.fixtures_root
    source = load_fixture(root, cand['task_id'])
    tasks = [t for t in list_fixtures(root) if t != source.id]
    holdout = [fx for fx in (load_fixture(root, t) for t in tasks)
               if fx.split == 'holdout' and fx.family == source.family]
    if len(holdout) < rule.min_tasks:
        raise H2DS4Error(Code.POLICY_DENIED, 'not enough holdout tasks for this domain')
    tree, _manifest = load_overlay(service.s.data_dir, ov['digest'])
    base = resolve_harness(service.store, service.blobs, cand['base_overlay_id'])
    sub = ScriptedLocalSubstrate(sandbox)
    rows: list[dict] = []
    for fx in holdout:
        ev = load_evaluator(root, fx.evaluator_id)
        b = evaluate(ev, sub.execute(fx, base, f'hv-b-{fx.id}'), sandbox=sandbox)
        c = evaluate(ev, sub.execute(fx, tree, f'hv-c-{fx.id}'), sandbox=sandbox)
        rows.append({'task': fx.id, 'base': b.success, 'candidate': c.success,
                     'base_quality': round(b.quality, 6), 'candidate_quality': round(c.quality, 6),
                     'security_violations': c.security_violations})
    deltas = [float(r['candidate']) - float(r['base']) for r in rows]
    ci = paired_bootstrap(deltas)
    regressions = [r['task'] for r in rows if r['candidate'] < r['base']]
    security = sum(int(r['security_violations']) for r in rows)
    passed = not regressions and not security and ci['ci95'] is not None \
        and ci['ci95'][0] >= -rule.tolerance
    result = {'split': 'holdout', 'domain': source.family, 'n': len(rows),
              'delta_pass': ci, 'critical_regressions': regressions,
              'security_violations': security, 'passed': passed, 'rows': rows,
              'validated_utc': utcnow()}
    with service.store.tx() as db:
        val = json.loads(cand['validation_json'])
        val['holdout'] = {k: v for k, v in result.items() if k != 'rows'}
        db.execute('UPDATE candidates SET validation_json=? WHERE id=?',
                   (json.dumps(val, sort_keys=True), cand['id']))
        service.store.audit(db, actor='operator', action='overlay-holdout-validated',
                            target=overlay_id, outcome='PASS' if passed else 'FAIL',
                            detail={'n': len(rows), 'regressions': regressions})
    return result
