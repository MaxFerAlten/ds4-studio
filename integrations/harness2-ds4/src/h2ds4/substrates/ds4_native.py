"""DS4 native-agent substrate: BLOCKED_API (plan §17, WP17; see docs/DS4_NATIVE_BLOCKERS.md).

The feasibility equation (plan §A.3) needs a public stable run API, per-task config
injection, workspace isolation, trace export, cancellation, a clear concurrency policy
and prompt-independent safety. WP17 discovery on the live checkout found the run
status/cancel routes but not the rest, so this substrate refuses to run. It is not
simulated, and no DS4 endpoint is created to work around it.
"""

from __future__ import annotations

from ..errors import Code, H2DS4Error

# Evidence: file:line in the DS4 Studio checkout at the WP00 fingerprint.
BLOCKERS: tuple[dict, ...] = (
    {'requirement': 'per-task harness/skill injection',
     'finding': 'DS4_SKILLS_DIR is read from the process env when a session skill state is '
                'created (frontend/server/agentSystemText.mjs createSessionSkillState); no '
                'per-request override exists',
     'status': 'BLOCKED_API'},
    {'requirement': 'isolated task workspace, not bound to a UI conversation',
     'finding': 'POST /api/agent/chat and the run ingress bind runs to a session key / '
                'thread owner (frontend/server/index.mjs createRunIngress); no workspace '
                'isolation contract',
     'status': 'BLOCKED_API'},
    {'requirement': 'trace export per run',
     'finding': 'GET /api/runs/:runId returns owner-scoped status; no documented trajectory '
                'export contract with tool events',
     'status': 'BLOCKED_API'},
    {'requirement': 'cancellation',
     'finding': 'POST /api/runs/:runId/cancel exists (owner-scoped)',
     'status': 'PRESENT_UNVERIFIED'},
    {'requirement': 'busy/idle reservation',
     'finding': 'model_busy is internal to ds4_server.c; no HTTP reservation endpoint',
     'status': 'BLOCKED_API'},
    {'requirement': 'no wrapper mode switch during an experiment',
     'finding': 'POST /api/wrapper/switch-mode exists; nothing prevents a switch mid-run',
     'status': 'BLOCKED_API'},
)


class Ds4NativeSubstrate:
    name = 'ds4_native'

    def preflight(self) -> dict:
        return {'ready': False, 'status': 'BLOCKED_API', 'blockers': list(BLOCKERS)}

    def execute(self, *_a: object, **_kw: object) -> None:
        raise H2DS4Error(Code.BLOCKED_API, 'DS4 native agent has no isolated per-task API')
