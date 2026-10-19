"""Paired A/B protocol (plan §36): BASE vs H2-K1 (and K2), per task, per domain.

Two measurements, kept separate:

1. in-task recursion: H2 runs on each task of the split; we compare the base rollout with
   the selected candidate (`raw`) and with what the gate would deploy (`gated`);
2. transfer to holdout: overlays quarantined on `dev` tasks are applied, unchanged, to
   `holdout` tasks of the same domain. Skills are never generated on the tasks that
   certify them.

Deltas are paired per task; the 95% interval is a paired bootstrap (1000 resamples, fixed
seed). With the scripted substrate this measures the algorithm and the gate, not any
model: every report says so (`executor`).
"""

from __future__ import annotations

import csv
import io
import json
import random
import tempfile
from pathlib import Path

from ..errors import Code, H2DS4Error
from ..fixtures import list_fixtures, load_fixture
from ..lab import evaluate_harness, make_lab, run_experiment
from ..overlay.stage import load_overlay
from ..registry import load_base_harness
from ..settings import Ds4Cfg
from ..upstream import fingerprint

DS4_DEFAULT_ROOTS = (Ds4Cfg().root, '/mnt/crucial_ai/COPARATOR/riconciliazione-ds4-studio/ds4-studio')

BOOTSTRAP = 1000
SEED = 7


def paired_bootstrap(deltas: list[float], *, n: int = BOOTSTRAP, seed: int = SEED) -> dict:
    if not deltas:
        return {'n': 0, 'mean': None, 'ci95': None}
    rng = random.Random(seed)
    means = sorted(sum(rng.choice(deltas) for _ in deltas) / len(deltas) for _ in range(n))
    return {'n': len(deltas), 'mean': round(sum(deltas) / len(deltas), 6),
            'median': round(sorted(deltas)[len(deltas) // 2], 6),
            'worst': round(min(deltas), 6),
            'ci95': [round(means[int(0.025 * n)], 6), round(means[int(0.975 * n) - 1], 6)]}


def _metric(o: dict | None, key: str) -> float:
    if not isinstance(o, dict) or key not in o or o[key] is None:
        raise H2DS4Error(Code.INTERNAL_ERROR, f'A/B evidence is missing metric {key}')
    try:
        return float(o[key])
    except (TypeError, ValueError) as exc:
        raise H2DS4Error(Code.INTERNAL_ERROR, f'A/B evidence has invalid metric {key}') from exc


def _require_completed(result: dict, task_id: str) -> None:
    if result.get('state') == 'DONE':
        return
    decision = result.get('decision')
    reason = decision.get('reason', '') if isinstance(decision, dict) else ''
    code = (Code.SANDBOX_UNAVAILABLE if isinstance(reason, str)
            and reason.startswith('SANDBOX_UNAVAILABLE') else Code.INTERNAL_ERROR)
    state = result.get('state')
    safe_state = state if isinstance(state, str) and state in {
        'FAILED', 'CANCELLED', 'QUEUED', 'RUNNING', 'UNKNOWN'} else 'UNKNOWN'
    raise H2DS4Error(code, f'A/B experiment for {task_id} did not complete ({safe_state})')


def _require_evidence(evidence: dict, task_id: str) -> None:
    if (evidence.get('decision') not in {'KEEP_BASE', 'QUARANTINE_CANDIDATE'}
            or not isinstance(evidence.get('baseline'), dict)
            or not isinstance(evidence.get('candidate'), dict)
            or not isinstance(evidence.get('ledger'), dict)
            or not isinstance(evidence.get('evaluations'), list)
            or not evidence['evaluations']):
        raise H2DS4Error(Code.INTERNAL_ERROR,
                         f'A/B evidence for {task_id} is incomplete; refusing zero-filled result')
    ledger = evidence['ledger']
    if any(type(ledger.get(key)) is not int or ledger[key] < 0 for key in ('R', 'P')):
        raise H2DS4Error(Code.INTERNAL_ERROR,
                         f'A/B evidence for {task_id} has an invalid rollout ledger')


def run_ab(*, split: str = 'holdout', k_values: tuple[int, ...] = (1,), output: Path | None = None,
           limit: int | None = None, root: Path | None = None) -> dict:
    with tempfile.TemporaryDirectory(prefix='h2ds4-ab-') as tmp:
        # Upstream integrity is proven once around the whole run instead of per experiment.
        roots = [r for r in (Path(x) for x in (DS4_DEFAULT_ROOTS)) if (r / '.git').exists()]
        before = [fingerprint(r) for r in roots]
        lab = make_lab(root or Path(tmp) / 'lab', upstream_roots=[])
        ids = list_fixtures(lab.fixtures_root)
        by_split = {t: load_fixture(lab.fixtures_root, t) for t in ids}
        pick = [t for t in ids if split == 'all' or by_split[t].split == split][:limit]
        rows: list[dict] = []
        for k in k_values:
            for t in pick:
                r = run_experiment(lab, t, k=k)
                _require_completed(r, t)
                dec = lab.service.evidence(r['id'])
                _require_evidence(dec, t)
                base = dec.get('baseline') or {}
                cand = dec.get('candidate') or {}
                gated = cand if dec.get('decision') == 'QUARANTINE_CANDIDATE' else base
                rows.append({
                    'task': t, 'domain': by_split[t].family, 'k': k, 'kind': 'in_task',
                    'trap': 'trap' in by_split[t].tags, 'decision': dec.get('decision'),
                    'base_pass': _metric(base, 'pass_rate'),
                    'raw_pass': _metric(cand, 'pass_rate'), 'gated_pass': _metric(gated, 'pass_rate'),
                    'base_quality': _metric(base, 'quality'),
                    'raw_quality': _metric(cand, 'quality'),
                    'gated_quality': _metric(gated, 'quality'),
                    'rollouts': (dec.get('ledger') or {}).get('R'),
                    'sessions': (dec.get('ledger') or {}).get('P'),
                    'tool_calls': sum(e['metrics']['tool_calls'] for e in dec['evaluations']),
                })
        # Transfer: dev-learned overlays -> holdout tasks of the same domain.
        transfer: list[dict] = []
        if split in ('holdout', 'all'):
            dev_overlays: dict[str, str] = {}
            for t in [x for x in ids if by_split[x].split == 'dev']:
                r = run_experiment(lab, t, k=1, seed=43)
                ov = (r.get('decision') or {}).get('overlay')
                if ov:
                    dev_overlays.setdefault(by_split[t].family, ov['digest'])
            base_tree = load_base_harness()
            for t in [x for x in ids if by_split[x].split == 'holdout'][:limit]:
                fx = by_split[t]
                digest = dev_overlays.get(fx.family)
                if digest is None:
                    continue
                tree, _ = load_overlay(lab.settings.data_dir, digest)
                b = evaluate_harness(lab, fx, base_tree, f'tb-{t}')
                c = evaluate_harness(lab, fx, tree, f'tc-{t}')
                # The overlay was gated on dev evidence; deploying it is the gated arm.
                # Holdout results never feed back into the decision.
                transfer.append({
                    'task': t, 'domain': fx.family, 'k': 1, 'kind': 'transfer',
                    'trap': 'trap' in fx.tags, 'overlay': digest,
                    'base_pass': b.success, 'raw_pass': c.success,
                    'gated_pass': c.success,
                    'base_quality': b.quality, 'raw_quality': c.quality,
                    'gated_quality': c.quality,
                    'decision': 'TRANSFER', 'rollouts': 2, 'sessions': 0,
                    'tool_calls': b.tool_calls + c.tool_calls})
        all_rows = rows + transfer
        summary = summarize(all_rows)
        summary['executor'] = ('scripted_local (deterministic, model-free): measures the '
                               'Harness² recursion and the DS4 gate, NOT model benefit')
        summary['split'] = split
        after = [fingerprint(r) for r in roots]
        summary['upstream'] = {'roots': [f['root'] for f in before],
                               'unchanged': before == after}
        result = {'summary': summary, 'rows': all_rows}
        if output:
            output.parent.mkdir(parents=True, exist_ok=True)
            output.with_suffix('.json').write_text(json.dumps(result, indent=2) + '\n')
            output.with_suffix('.csv').write_text(to_csv(all_rows))
            output.with_suffix('.md').write_text(to_markdown(summary))
        return result


def summarize(rows: list[dict]) -> dict:
    out: dict = {'groups': {}}
    keys = sorted({(r['kind'], r['k']) for r in rows})
    for kind, k in keys:
        grp = [r for r in rows if r['kind'] == kind and r['k'] == k]
        domains = {}
        for d in sorted({r['domain'] for r in grp}):
            g = [r for r in grp if r['domain'] == d]
            domains[d] = {
                'n': len(g),
                'base_pass': round(sum(r['base_pass'] for r in g) / len(g), 4),
                'raw_pass': round(sum(r['raw_pass'] for r in g) / len(g), 4),
                'gated_pass': round(sum(r['gated_pass'] for r in g) / len(g), 4),
                'raw_regressions': sum(1 for r in g if r['raw_pass'] < r['base_pass']),
                'gated_regressions': sum(1 for r in g if r['gated_pass'] < r['base_pass']),
            }
        out['groups'][f'{kind}-k{k}'] = {
            'domains': domains,
            'delta_pass_raw': paired_bootstrap([r['raw_pass'] - r['base_pass'] for r in grp]),
            'delta_pass_gated': paired_bootstrap([r['gated_pass'] - r['base_pass'] for r in grp]),
            'delta_quality_gated': paired_bootstrap(
                [r['gated_quality'] - r['base_quality'] for r in grp]),
            'decisions': {d: sum(1 for r in grp if r['decision'] == d)
                          for d in sorted({r['decision'] for r in grp})},
            'critical_regressions_gated': sum(1 for r in grp if r['gated_pass'] < r['base_pass']),
            'rollouts_total': sum(r['rollouts'] or 0 for r in grp),
            'sessions_total': sum(r['sessions'] or 0 for r in grp),
        }
    return out


def to_csv(rows: list[dict]) -> str:
    buf = io.StringIO()
    cols = ['kind', 'k', 'task', 'domain', 'trap', 'decision', 'base_pass', 'raw_pass',
            'gated_pass', 'base_quality', 'raw_quality', 'gated_quality', 'rollouts',
            'sessions', 'tool_calls']
    w = csv.DictWriter(buf, fieldnames=cols, extrasaction='ignore')
    w.writeheader()
    for r in rows:
        w.writerow(r)
    return buf.getvalue()


def to_markdown(summary: dict) -> str:
    lines = [f"# A/B report ({summary.get('split')})", '', f"Executor: {summary['executor']}", '']
    for name, g in summary['groups'].items():
        lines += [f'## {name}', '', '| Domain | n | Base pass | Raw pass | Gated pass | '
                  'Raw regressions | Gated regressions |', '|---|---:|---:|---:|---:|---:|---:|']
        for d, v in g['domains'].items():
            lines.append(f"| {d} | {v['n']} | {v['base_pass']} | {v['raw_pass']} | "
                         f"{v['gated_pass']} | {v['raw_regressions']} | {v['gated_regressions']} |")
        lines += ['', f"- Δ pass (raw): {g['delta_pass_raw']}",
                  f"- Δ pass (gated): {g['delta_pass_gated']}",
                  f"- Δ quality (gated): {g['delta_quality_gated']}",
                  f"- decisions: {g['decisions']}",
                  f"- critical regressions after gate: {g['critical_regressions_gated']}",
                  f"- rollouts {g['rollouts_total']}, improvement sessions {g['sessions_total']}",
                  '']
    return '\n'.join(lines)
