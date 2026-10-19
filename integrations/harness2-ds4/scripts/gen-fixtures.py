#!/usr/bin/env python3
"""Generate the deterministic local task set (plan §36.1, §36.5) into fixtures/.

40 tasks in three families (json repair, ledger reconciliation, key/value extraction),
each with a natural-language task.md usable by any executor, a workspace, a hidden
evaluator, and a `scripted` block for the model-free solver. Some tasks are traps where
the family skill makes things worse, so the gate must keep the baseline.

The generator self-checks every task against the scripted solver: with the family rules
it must pass (or, for traps, the baseline must pass and the rules must fail).
Deterministic: fixed seed, stable split. Re-running produces identical bytes.
"""

from __future__ import annotations

import importlib.util
import json
import random
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'fixtures'
SEED = 20261019
spec = importlib.util.spec_from_file_location(
    'solver', ROOT / 'src' / 'h2ds4' / 'substrates' / 'scripted_solver.py')
solver = importlib.util.module_from_spec(spec)
spec.loader.exec_module(solver)  # type: ignore[union-attr]
solver.emit = lambda *a, **k: None

FAMILIES = {
    'json': {'skill': 'json-repair', 'rules': ['strip-trailing-commas', 'single-quotes',
                                               'bare-keys', 'strip-comments'],
             'description': 'Repair malformed JSON before parsing it',
             'trigger': 'When an input JSON file does not parse',
             'work': 'repair malformed JSON configuration files into valid, equivalent JSON'},
    'ledger': {'skill': 'ledger-reconcile', 'rules': ['signed-amounts', 'parenthesised-negatives'],
               'description': 'Sum ledgers with debits, credits and accounting negatives',
               'trigger': 'When a ledger mixes credits and debits',
               'work': 'reconcile transaction ledgers into a single signed total'},
    'kv': {'skill': 'kv-extract', 'rules': ['skip-comment-lines', 'strip-quotes',
                                            'colon-separator', 'lowercase-keys'],
           'description': 'Extract settings from loosely formatted key/value files',
           'trigger': 'When settings files mix separators, quotes or comments',
           'work': 'extract settings from loosely formatted configuration text into JSON'},
}


def run_solver(op: dict, files: dict[str, str], rules: set[str], tmp: Path) -> str | None:
    shutil.rmtree(tmp, ignore_errors=True)
    tmp.mkdir(parents=True)
    for k, v in files.items():
        (tmp / k).write_text(v, encoding='utf-8')
    op = dict(op, input=str(tmp / op['input']), output=str(tmp / op['output']))
    try:
        solver.OPS[op['op']](op, rules)
    except Exception:
        return None
    out = Path(op['output'])
    return out.read_text(encoding='utf-8') if out.exists() else None


def json_task(rng: random.Random, defects: list[str]) -> tuple[dict, str, object]:
    obj = {f'k{rng.randint(10, 99)}_{i}': rng.choice([rng.randint(0, 999), f'v{rng.randint(1, 9)}x'])
           for i in range(rng.randint(3, 6))}
    obj['nested'] = {'items': [rng.randint(0, 9) for _ in range(3)], 'name': 'svc'}
    text = json.dumps(obj, indent=2)
    if 'single-quotes' in defects:
        text = text.replace('"', "'")
    if 'bare-keys' in defects:
        import re
        text = re.sub(r"""(['"])([A-Za-z_][A-Za-z0-9_]*)\1(\s*:)""", r'\2\3', text)
    if 'strip-trailing-commas' in defects:
        text = text.replace('\n}', ',\n}').replace(']', ',]')
    if 'strip-comments' in defects:
        text = text.replace('{\n', '{\n  // generated settings\n', 1)
    return {'op': 'json_repair', 'input': 'broken.json', 'output': 'fixed.json'}, text, obj


def ledger_task(rng: random.Random, defects: list[str], trap: bool) -> tuple[dict, str, str]:
    rows, total = [], 0
    for _ in range(rng.randint(5, 9)):
        cents = rng.randint(100, 50000)
        neg = rng.random() < 0.4 and ('signed-amounts' in defects or trap)
        if neg:
            if 'parenthesised-negatives' in defects:
                rows.append(f'({cents / 100:.2f})')
            else:
                rows.append(f'-{cents / 100:.2f}')
            if not trap:
                total -= cents
        else:
            rows.append(f'{cents / 100:.2f}')
            total += cents
    if trap and not any(r.startswith(('-', '(')) for r in rows):
        rows.append('-1.00')
    csv = 'amount\n' + '\n'.join(rows) + '\n'
    return ({'op': 'ledger_sum', 'input': 'ledger.csv', 'output': 'total.txt', 'column': 0},
            csv, f'Total: {total / 100:.2f}')


def kv_task(rng: random.Random, defects: list[str], trap: bool) -> tuple[dict, str, dict]:
    expected, lines = {}, []
    for i in range(rng.randint(4, 7)):
        key = f'Opt{i}{rng.choice("ABC")}' if ('lowercase-keys' in defects or trap) \
            else f'opt{i}{rng.choice("abc")}'
        val = f'val{rng.randint(1, 99)}'
        sep = ':' if 'colon-separator' in defects and i % 2 else '='
        shown = f'"{val}"' if 'strip-quotes' in defects and i % 3 == 0 else val
        lines.append(f'{key} {sep} {shown}')
        expected[key if trap else key.lower() if 'lowercase-keys' in defects else key] = val
    if 'skip-comment-lines' in defects:
        lines.insert(1, '# maintained by ops = do not edit')
    return ({'op': 'kv_extract', 'input': 'settings.conf', 'output': 'settings.json'},
            '\n'.join(lines) + '\n', expected)


PROMPTS = {
    'json': ('`broken.json` is a hand-edited configuration file that may not parse. Write '
             '`fixed.json` containing the same data as valid JSON (same keys and values).'),
    'ledger': ('`ledger.csv` lists transaction amounts, one per row under the `amount` header. '
               'Write `total.txt` with a single line `Total: <amount>` (two decimals) for the '
               'signed sum of every amount; negative amounts may be written as -x or (x).'),
    'ledger_trap': ('`ledger.csv` lists receipts and refunds. Write `total.txt` with a single '
                    'line `Total: <amount>` (two decimals) summing ONLY the positive receipts; '
                    'refunds (negative rows) are excluded.'),
    'kv': ('`settings.conf` holds settings as `key = value` lines (some may use `:` or quotes, '
           'and `#` lines are comments). Write `settings.json` as a flat JSON object mapping '
           'each key, lower-cased, to its unquoted value.'),
    'kv_trap': ('`settings.conf` holds settings as `key = value` lines. Write `settings.json` '
                'as a flat JSON object mapping each key, with its ORIGINAL letter case, to its '
                'value.'),
}


def main() -> int:
    rng = random.Random(SEED)
    for sub in ('tasks', 'evaluators'):
        shutil.rmtree(OUT / sub, ignore_errors=True)
    plan = ([('json', d, False) for d in (
        [], ['strip-trailing-commas'], ['strip-trailing-commas'], ['single-quotes'],
        ['single-quotes', 'bare-keys'], ['bare-keys'], ['strip-comments'],
        ['strip-trailing-commas', 'strip-comments'], ['single-quotes', 'strip-trailing-commas'],
        ['bare-keys', 'strip-trailing-commas'], ['strip-trailing-commas', 'single-quotes',
                                                 'bare-keys', 'strip-comments'],
        ['strip-comments', 'bare-keys'])]
        + [('ledger', d, False) for d in (
            [], ['signed-amounts'], ['signed-amounts'], ['signed-amounts'],
            ['signed-amounts', 'parenthesised-negatives'],
            ['signed-amounts', 'parenthesised-negatives'], [], ['signed-amounts'],
            ['signed-amounts', 'parenthesised-negatives'], ['signed-amounts'])]
        + [('ledger', [], True)] * 4
        + [('kv', d, False) for d in (
            [], ['skip-comment-lines'], ['strip-quotes'], ['colon-separator'],
            ['lowercase-keys'], ['skip-comment-lines', 'strip-quotes'],
            ['colon-separator', 'lowercase-keys'], ['skip-comment-lines', 'strip-quotes',
                                                    'colon-separator', 'lowercase-keys'],
            ['strip-quotes', 'lowercase-keys'], ['skip-comment-lines', 'colon-separator'])]
        + [('kv', [], True)] * 4)
    assert len(plan) == 40, len(plan)
    # Stratified split: within each family, each kind (traps / clean / defective) rotates
    # through its own fixed cycle, so every split sees every kind (~50/20/30 overall).
    cycle = ('holdout', 'dev', 'val', 'dev', 'holdout', 'dev', 'dev', 'val', 'holdout', 'dev')
    split_of: dict[int, str] = {}
    for fam_name in FAMILIES:
        idx = [i for i, (f, _d, _t) in enumerate(plan) if f == fam_name]
        for group in ([i for i in idx if plan[i][2]],
                      [i for i in idx if not plan[i][1] and not plan[i][2]],
                      [i for i in idx if plan[i][1] and not plan[i][2]]):
            for pos, i in enumerate(group):
                split_of[i] = cycle[pos % len(cycle)]
    counters: dict[str, int] = {}
    splits: dict[str, list[str]] = {'dev': [], 'val': [], 'holdout': []}
    tmp = OUT / '.gen-tmp'
    lines = []
    for i_plan, (family, defects, trap) in enumerate(plan):
        n = counters[family] = counters.get(family, 0) + 1
        tid = f'{family}-{"trap-" if trap else ""}{n:03d}'
        fam = FAMILIES[family]
        if family == 'json':
            op, src, expected = json_task(rng, defects)
            files, check = {'broken.json': src}, {'type': 'json_equals', 'path': 'fixed.json',
                                                  'expected': expected}
            prompt = PROMPTS['json']
        elif family == 'ledger':
            op, src, expected = ledger_task(rng, defects, trap)
            files = {'ledger.csv': src}
            check = {'type': 'text_equals', 'path': 'total.txt', 'expected': expected}
            prompt = PROMPTS['ledger_trap' if trap else 'ledger']
        else:
            op, src, expected = kv_task(rng, defects, trap)
            files = {'settings.conf': src}
            check = {'type': 'json_equals', 'path': 'settings.json', 'expected': expected}
            prompt = PROMPTS['kv_trap' if trap else 'kv']
        # self-check against the scripted solver
        def passes(rules: set[str]) -> bool:
            got = run_solver(op, files, rules, tmp)
            if got is None:
                return False
            if check['type'] == 'json_equals':
                try:
                    return json.loads(got) == check['expected']
                except json.JSONDecodeError:
                    return False
            return got.strip() == check['expected'].strip()
        full = set(fam['rules'])
        if trap:
            assert passes(set()) and not passes(full), tid
        else:
            assert passes(full), tid
            assert passes(set()) == (not defects), tid
        split = split_of[i_plan]
        splits[split].append(tid)
        d = OUT / 'tasks' / tid
        (d / 'workspace').mkdir(parents=True)
        for name, body in files.items():
            (d / 'workspace' / name).write_text(body, encoding='utf-8')
        (d / 'task.md').write_text(prompt + '\n', encoding='utf-8')
        eid = f'eval-{tid}'
        (d / 'task.json').write_text(json.dumps({
            'schema_version': 1, 'id': tid, 'family': family, 'work': fam['work'],
            'prompt_file': 'task.md', 'workspace_dir': 'workspace',
            'deliverables': [check['path']], 'evaluator_id': eid, 'split': split,
            'tags': sorted(set(defects) | ({'trap'} if trap else set())),
            'scripted': {'op': op, 'edit': {k2: fam[k2] for k2 in
                                            ('skill', 'rules', 'description', 'trigger')}},
        }, indent=2, sort_keys=True) + '\n', encoding='utf-8')
        e = OUT / 'evaluators' / eid
        e.mkdir(parents=True)
        (e / 'evaluator.json').write_text(json.dumps({
            'schema_version': 1, 'id': eid,
            'checks': [{'type': 'file_exists', 'path': check['path'], 'weight': 0.2},
                       {**check, 'weight': 0.7},
                       {'type': 'max_tool_calls', 'max': 12, 'hard': False, 'weight': 0.1}],
            'scored_metrics': [{'key': 'success', 'maximize': True, 'weight': 0.7},
                               {'key': 'tool_efficiency', 'maximize': True, 'weight': 0.3}],
            'quality_gate': {'min_improvement': 0.01, 'no_hard_regression': True},
            'holdout_only_score': split == 'holdout',
        }, indent=2, sort_keys=True) + '\n', encoding='utf-8')
        lines.append(json.dumps({'id': tid, 'family': family, 'split': split, 'trap': trap,
                                 'evaluator_id': eid}, sort_keys=True))
    shutil.rmtree(tmp, ignore_errors=True)
    (ROOT / 'benchmarks').mkdir(exist_ok=True)
    (ROOT / 'benchmarks' / 'tasks.jsonl').write_text('\n'.join(lines) + '\n', encoding='utf-8')
    (ROOT / 'benchmarks' / 'splits.json').write_text(
        json.dumps({'seed': SEED, **splits}, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({k: len(v) for k, v in splits.items()}))
    return 0


if __name__ == '__main__':
    sys.exit(main())
