"""OpenCode executor in the sandbox, talking to DS4 only through the inference proxy (plan §16).

Install mode `workspace_agents_md`: the always-on files are composed into the sandbox
workspace's AGENTS.md, skills are staged under `.opencode/skills/`, and the OpenCode
config points at the in-sandbox loopback bridge. Home, config, data and cache are all
inside the ephemeral workspace tmpfs; the user's ~/.config/opencode is never mounted.

Status: VERIFIED only for the exact installed OpenCode v2.0.32 artifact whose SHA-256
is allowlisted below and whose proxy-only L5 smoke passed. Other binaries remain blocked.
"""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import subprocess
from pathlib import Path

from ..errors import Code, H2DS4Error
from ..evidence.normalize import parse_opencode_jsonl
from ..fixtures import TaskFixture
from ..model.proxy import ProxyContext
from ..policy.mutation import GUARDRAILS, MEMORY, SYSTEMPROMPT, TOOL_GUIDANCE
from ..sandbox.bwrap import BwrapSandbox, SandboxRequest
from .base import ExecutionResult

H2_PINNED_OPENCODE = '23fb5e0516c99ac04a1aa46c193efda2e1b9bb24'  # v1.14.18 (harness2/config.py)
APPROVED_OPENCODE_VERSION = '2.0.32'
APPROVED_OPENCODE_SHA256 = '489b51816a77809e841310e80c88e834c28c19ad1639e12ba8a19f08b47ab607'
BRIDGE_PORT = 18080
PROMPT = ('Read AGENTS.md first and follow it. Then do the task in TASK.md using only files '
          'in the current directory. Write the deliverables it asks for.')


def compose_agents_md(harness: dict[str, bytes]) -> str:
    parts = [harness[a].decode('utf-8').strip() for a in
             (SYSTEMPROMPT, GUARDRAILS, MEMORY, TOOL_GUIDANCE)
             if a in harness and harness[a].strip()]
    skills = sorted(r for r in harness if r.startswith('skills/') and r.endswith('/SKILL.md'))
    if skills:
        lines = []
        for rel in skills:
            name = rel.split('/')[1]
            body = harness[rel].decode('utf-8')
            desc = next((ln.split(':', 1)[1].strip() for ln in body.splitlines()[:20]
                         if ln.startswith('description:')), '(no description)')
            lines.append(f'- `{name}`: {desc}')
        parts.append('# AVAILABLE SKILLS\nLoad with the `skill` tool when the situation '
                     'matches:\n' + '\n'.join(lines))
    return '\n\n---\n\n'.join(parts) + '\n'


class OpencodeLocalSubstrate:
    name = 'opencode_local'

    def __init__(self, sandbox: BwrapSandbox, *, model_id: str, binary: str | None = None,
                 max_output_tokens: int = 4096):
        self.sandbox = sandbox
        self.model_id = model_id
        found = binary or shutil.which('opencode')
        self.binary = os.path.realpath(found) if found else ''
        self.max_output_tokens = max_output_tokens

    def toolchain(self) -> tuple[str, ...]:
        if not self.binary:
            return ()
        # The standalone binary's package directory, read-only; nothing else of $HOME.
        return (str(Path(self.binary).parent.parent),)

    def version(self) -> str:
        if not self.binary:
            return ''
        try:
            p = subprocess.run([self.binary, '--version'], capture_output=True, text=True,
                               timeout=20, env={'PATH': '/usr/bin:/bin', 'HOME': '/nonexistent'})
            return (p.stdout or p.stderr).strip().splitlines()[-1][:60]
        except (OSError, subprocess.SubprocessError, IndexError):
            return ''

    def preflight(self) -> dict:
        blockers = []
        if not self.binary:
            blockers.append('opencode binary not found')
        if not self.model_id:
            blockers.append('ds4.model_id not configured (read it from /v1/models)')
        actual_digest = ''
        if self.binary:
            try:
                with open(self.binary, 'rb') as binary_file:
                    actual_digest = hashlib.file_digest(binary_file, 'sha256').hexdigest()
            except OSError:
                blockers.append('opencode binary cannot be read for digest verification')
        if actual_digest != APPROVED_OPENCODE_SHA256:
            blockers.append(f'OpenCode binary digest is not approved ({actual_digest or "unreadable"})')
        return {'ready': not blockers, 'blockers': blockers, 'model_backed': True,
                'opencode_version': APPROVED_OPENCODE_VERSION
                if actual_digest == APPROVED_OPENCODE_SHA256 else None,
                'opencode_sha256': actual_digest,
                'status': 'VERIFIED' if not blockers else 'UNVERIFIED'}

    def config(self) -> dict:
        return {
            '$schema': 'https://opencode.ai/config.json',
            'autoupdate': False,
            'share': 'disabled',
            'model': f'ds4/{self.model_id}',
            'provider': {'ds4': {
                'npm': '@ai-sdk/openai-compatible', 'name': 'DS4 local (via h2ds4 proxy)',
                'options': {'baseURL': f'http://127.0.0.1:{BRIDGE_PORT}/v1', 'apiKey': 'local'},
                'models': {self.model_id: {
                    'name': self.model_id,
                    'limit': {'context': 550000, 'output': self.max_output_tokens},
                }}}},
        }

    def execute(self, fixture: TaskFixture, harness: dict[str, bytes], run_id: str, *,
                proxy: ProxyContext | None) -> ExecutionResult:
        if proxy is None or self.sandbox is None:
            raise H2DS4Error(Code.CAPABILITY_MISSING, 'opencode_local needs the inference proxy')
        if not self.binary:
            raise H2DS4Error(Code.CAPABILITY_MISSING, 'opencode binary not found')
        socket_path = getattr(proxy, 'socket_path', None)
        if socket_path is None:
            raise H2DS4Error(Code.CAPABILITY_MISSING, 'proxy socket path missing')
        files = dict(fixture.workspace)
        files['TASK.md'] = fixture.prompt.encode('utf-8')
        files['AGENTS.md'] = compose_agents_md(harness).encode('utf-8')
        files['opencode.json'] = json.dumps(self.config(), indent=2).encode('utf-8')
        for rel, data in harness.items():
            if rel.startswith('skills/') and rel.endswith('/SKILL.md'):
                files[f'.opencode/{rel}'] = data
        perm = {'external_directory': {'*': 'deny', '/work': 'allow', '/work/**': 'allow'}}
        res = self.sandbox.run(SandboxRequest(
            run_id=run_id, fixture=files, inference_socket=Path(socket_path),
            bridge_port=BRIDGE_PORT, ro_toolchains=self.toolchain(),
            env={'OPENCODE_PERMISSION': json.dumps(perm),
                 'OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX': str(self.max_output_tokens),
                 'OPENCODE_DISABLE_AUTOUPDATE': '1'},
            argv=[self.binary, 'run', PROMPT, '--format', 'json', '--model',
                  f'ds4/{self.model_id}']))
        events = list(parse_opencode_jsonl(res.stdout.splitlines(), execution_id=run_id))
        return ExecutionResult(run_id=run_id, sandbox=res, events=events, usage=proxy.totals())
