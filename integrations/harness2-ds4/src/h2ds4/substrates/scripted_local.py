"""Model-free substrate: the deterministic scripted solver inside the real sandbox.

Used for algorithm conformance (L4) and for every security test that needs an executor.
Its results say nothing about model benefit and are labelled `usage_source = none`.
"""

from __future__ import annotations

import json
from pathlib import Path

from ..evidence.normalize import parse_opencode_jsonl
from ..fixtures import TaskFixture
from ..model.proxy import ProxyContext
from ..sandbox.bwrap import BwrapSandbox, SandboxRequest
from .base import ExecutionResult

SOLVER_PY = Path(__file__).with_name('scripted_solver.py')


class ScriptedLocalSubstrate:
    name = 'scripted_local'

    def __init__(self, sandbox: BwrapSandbox):
        self.sandbox = sandbox

    def preflight(self) -> dict:
        return {'ready': True, 'blockers': [], 'model_backed': False}

    def execute(self, fixture: TaskFixture, harness: dict[str, bytes], run_id: str, *,
                proxy: ProxyContext | None = None) -> ExecutionResult:
        op = fixture.scripted.get('op')
        if not isinstance(op, dict):
            raise ValueError('fixture has no scripted op')
        extra = {f'/opt/harness/{rel}': data for rel, data in harness.items()}
        extra['/opt/h2ds4/scripted_solver.py'] = SOLVER_PY.read_bytes()
        res = self.sandbox.run(SandboxRequest(
            run_id=run_id, fixture=fixture.workspace, extra_ro=extra,
            argv=['python3', '/opt/h2ds4/scripted_solver.py', json.dumps(op)]))
        events = list(parse_opencode_jsonl(res.stdout.splitlines(), execution_id=run_id))
        return ExecutionResult(run_id=run_id, sandbox=res, events=events,
                               usage={'model_calls': 0, 'input_tokens': 0, 'output_tokens': 0,
                                      'usage_source': 'none'})
