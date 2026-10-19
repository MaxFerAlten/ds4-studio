"""Deterministic evaluator (plan §22). Runs on the host after the artefact is frozen.

The solver never sees the evaluation profile. Scores come only from checks computed here
over the extracted workspace bytes; any score-like file the candidate writes is ignored.
`python_check` scripts run in their own sandbox with the frozen output mounted read-only.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field

from ..canonical import digest_obj
from ..fixtures import EvaluationProfile
from ..sandbox.bwrap import BwrapSandbox, SandboxRequest
from ..substrates.base import ExecutionResult


@dataclass
class EvalOutcome:
    verdict: str  # PASS | FAIL | INCONCLUSIVE
    success: float
    quality: float
    hard_failures: int
    security_violations: int
    tool_calls: int
    checks: list[dict] = field(default_factory=list)
    reasons: list[str] = field(default_factory=list)

    def metrics(self) -> dict:
        return {'success': self.success, 'quality': round(self.quality, 6),
                'hard_failures': self.hard_failures,
                'security_violations': self.security_violations,
                'tool_calls': self.tool_calls, 'checks': self.checks, 'reasons': self.reasons}

    def provenance(self, profile: EvaluationProfile, result: ExecutionResult) -> str:
        return digest_obj({'evaluator': profile.digest, 'run_id': result.run_id,
                           'workspace': sorted((k, len(v)) for k, v in
                                               result.sandbox.workspace.items()),
                           'metrics': self.metrics()})


def _file(ws: dict[str, bytes], path: str) -> bytes | None:
    return ws.get(path)


def _check(c: dict, ws: dict[str, bytes], result: ExecutionResult,
           profile: EvaluationProfile, sandbox: BwrapSandbox | None) -> tuple[bool, str]:
    kind = c['type']
    if kind == 'file_exists':
        return _file(ws, c['path']) is not None, ''
    if kind == 'json_equals':
        data = _file(ws, c['path'])
        if data is None:
            return False, 'missing'
        try:
            return json.loads(data) == c['expected'], ''
        except (json.JSONDecodeError, UnicodeDecodeError):
            return False, 'invalid json'
    if kind == 'text_equals':
        data = _file(ws, c['path'])
        if data is None:
            return False, 'missing'
        text = data.decode('utf-8', errors='replace')
        exp = c['expected']
        return (text.strip() == exp.strip()) if c.get('strip', True) else text == exp, ''
    if kind == 'regex':
        data = _file(ws, c['path'])
        if data is None:
            return False, 'missing'
        return bool(re.search(c['pattern'], data.decode('utf-8', errors='replace'), re.M)), ''
    if kind == 'python_check':
        if sandbox is None or profile.check_script is None:
            return False, 'check sandbox unavailable'
        res = sandbox.run(SandboxRequest(
            run_id=f'{result.run_id}-eval', fixture=ws,
            extra_ro={'/opt/eval/check.py': profile.check_script},
            argv=['python3', '/opt/eval/check.py']))
        return (not res.timed_out and res.returncode == 0), f'rc={res.returncode}'
    if kind == 'max_tool_calls':
        n = sum(1 for e in result.events if e.get('kind') == 'tool_request')
        return n <= int(c['max']), f'{n} calls'
    if kind == 'no_forbidden_calls':
        return True, ''  # handled as a security gate below
    return False, 'unknown check'


def evaluate(profile: EvaluationProfile, result: ExecutionResult, *,
             sandbox: BwrapSandbox | None = None) -> EvalOutcome:
    ws = result.sandbox.workspace
    tool_calls = sum(1 for e in result.events if e.get('kind') == 'tool_request')
    security = 0
    reasons: list[str] = []
    denied = [e for e in result.events if e.get('kind') == 'policy_denied']
    if denied:
        security += len(denied)
        reasons.append('policy_denied events in trace')
    if profile.allowed_tools is not None and any(
            c.get('type') == 'no_forbidden_calls' for c in profile.checks):
        bad = sorted({e.get('tool_name', '') for e in result.events
                      if e.get('kind') == 'tool_request'
                      and e.get('tool_name') not in profile.allowed_tools})
        if bad:
            security += 1
            reasons.append(f'forbidden tools used: {bad[:5]}')
    if result.sandbox.workspace_error:
        reasons.append(result.sandbox.workspace_error)
    checks, hard_fail, weight_total, weight_ok = [], 0, 0.0, 0.0
    for c in profile.checks:
        if c['type'] == 'no_forbidden_calls':
            continue
        ok, note = _check(c, ws, result, profile, sandbox)
        hard = bool(c.get('hard', True))
        w = float(c.get('weight', 1.0))
        weight_total += w
        weight_ok += w if ok else 0.0
        if hard and not ok:
            hard_fail += 1
        checks.append({'type': c['type'], 'path': c.get('path'), 'ok': ok, 'hard': hard,
                       'note': note})
    if result.sandbox.timed_out:
        hard_fail += 1
        reasons.append('timed out')
    quality = weight_ok / weight_total if weight_total else 0.0
    if not profile.checks:
        verdict = 'INCONCLUSIVE'
        reasons.append('no checks declared')
    else:
        verdict = 'PASS' if hard_fail == 0 and security == 0 else 'FAIL'
    return EvalOutcome(verdict=verdict, success=1.0 if verdict == 'PASS' else 0.0,
                       quality=quality, hard_failures=hard_fail, security_violations=security,
                       tool_calls=tool_calls, checks=checks, reasons=reasons)
