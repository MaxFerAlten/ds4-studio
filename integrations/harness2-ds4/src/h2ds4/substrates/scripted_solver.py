"""Deterministic, model-free solver run INSIDE the sandbox (standalone stdlib script).

It exercises the whole Harness² pipeline without inference: behaviour depends only on the
harness text it is given. A rule counts only if it appears in always-on text, or in a skill
whose name the always-on text mentions (an untriggered skill is dead weight, as in H2).
Rules are lines `H2DS4-RULE: <name>`. Events go to stdout in OpenCode `--format json` shape.

    python3 scripted_solver.py <op-json>
"""

import json
import os
import re
import sys

HARNESS = '/opt/harness'
ALWAYS_ON = ('systemprompt.md', 'guardrails.md', 'LongTermMEMORY.md',
             'tool_descriptions/tool_guidance.md')
_seq = [0]


def emit(tool, inp, out, status='completed'):
    _seq[0] += 1
    print(json.dumps({'type': 'tool_use', 'part': {
        'type': 'tool', 'tool': tool, 'callID': f'call_{_seq[0]:04d}',
        'state': {'status': status, 'input': inp, 'output': out}}}), flush=True)


def read(path):
    try:
        with open(path, encoding='utf-8') as f:
            return f.read()
    except OSError:
        return ''


def active_rules():
    body = '\n'.join(read(os.path.join(HARNESS, a)) for a in ALWAYS_ON)
    texts = [body]
    sdir = os.path.join(HARNESS, 'skills')
    if os.path.isdir(sdir):
        for name in sorted(os.listdir(sdir)):
            if re.search(r'(?<![\w-])' + re.escape(name) + r'(?![\w-])', body):
                texts.append(read(os.path.join(sdir, name, 'SKILL.md')))
                emit('skill', {'name': name}, 'loaded')
    rules = set()
    for t in texts:
        rules.update(m.group(1) for m in re.finditer(r'^\s*[-*]?\s*H2DS4-RULE:\s*([a-z0-9-]+)',
                                                     t, re.M))
    return rules


def json_repair(op, rules):
    src = read(op['input'])
    emit('read', {'filePath': op['input']}, src[:2000])
    text = src
    if 'strip-comments' in rules:
        text = re.sub(r'//[^\n]*', '', text)
    if 'single-quotes' in rules:
        text = re.sub(r"'([^'\\]*)'", r'"\1"', text)
    if 'bare-keys' in rules:
        text = re.sub(r'([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:', r'\1"\2":', text)
    if 'strip-trailing-commas' in rules:
        text = re.sub(r',\s*([}\]])', r'\1', text)
    try:
        value = json.loads(text)
    except json.JSONDecodeError as e:
        emit('write', {'filePath': op['output']}, f'parse failed: {e.msg}', status='error')
        return 1
    with open(op['output'], 'w', encoding='utf-8') as f:
        json.dump(value, f, indent=2, sort_keys=True)
        f.write('\n')
    emit('write', {'filePath': op['output']}, 'ok')
    return 0


def ledger_sum(op, rules):
    src = read(op['input'])
    emit('read', {'filePath': op['input']}, src[:2000])
    total = 0
    for line in src.splitlines()[1:]:
        cell = line.split(',')[op.get('column', 0)].strip() if line.strip() else ''
        if not cell:
            continue
        if cell.startswith('(') and cell.endswith(')'):
            if 'parenthesised-negatives' not in rules:
                continue
            cell = '-' + cell[1:-1]
        cents = int(round(float(cell) * 100))
        if cents < 0 and 'signed-amounts' not in rules:
            continue
        total += cents
    with open(op['output'], 'w', encoding='utf-8') as f:
        f.write(f'Total: {total / 100:.2f}\n')
    emit('write', {'filePath': op['output']}, 'ok')
    return 0


def kv_extract(op, rules):
    src = read(op['input'])
    emit('read', {'filePath': op['input']}, src[:2000])
    out = {}
    for line in src.splitlines():
        if 'skip-comment-lines' in rules and line.lstrip().startswith('#'):
            continue
        sep = '=' if '=' in line else (':' if 'colon-separator' in rules and ':' in line else None)
        if sep is None:
            continue
        k, v = line.split(sep, 1)
        k, v = k.strip(), v.strip()
        if 'lowercase-keys' in rules:
            k = k.lower()
        if 'strip-quotes' in rules and len(v) >= 2 and v[0] == v[-1] and v[0] in '"\'':
            v = v[1:-1]
        out[k] = v
    with open(op['output'], 'w', encoding='utf-8') as f:
        json.dump(out, f, indent=2, sort_keys=True)
        f.write('\n')
    emit('write', {'filePath': op['output']}, 'ok')
    return 0


OPS = {'json_repair': json_repair, 'ledger_sum': ledger_sum, 'kv_extract': kv_extract}


def main():
    op = json.loads(sys.argv[1])
    rules = active_rules()
    print(json.dumps({'type': 'text', 'part': {'type': 'text',
                                               'text': f'rules: {sorted(rules)}'}}), flush=True)
    fn = OPS.get(op.get('op'))
    if fn is None:
        print(json.dumps({'error': {'message': 'unknown op'}}))
        return 2
    return fn(op, rules)


if __name__ == '__main__':
    sys.exit(main())
