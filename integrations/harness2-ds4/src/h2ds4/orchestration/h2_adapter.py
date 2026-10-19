"""Bridge from h2ds4 fixtures/substrates to the pinned Harness² core (plan §16.5, WP12).

Uses only the extension points upstream itself uses in `harness2/demo.py`: a
`BenchmarkAdapter` implementation and `Proposer` subclasses. No monkeypatching, no edits
to the vendored tree.

H2_INTERFACE_GAP notes (documented in docs/ARCHITECTURE.md):
- OPENCODE_SURFACE auto-triggers skills by appending to guardrails.md, which DS4 phase 1
  keeps immutable; DS4_SURFACE is the same surface with the trigger file set to
  systemprompt.md (lines land after the H2DS4_DYNAMIC_GUIDANCE marker).
- The upstream OpenCode/Claude proposer is a subprocess with file access; a local model
  over HTTP cannot read files, so Ds4LocalProposer inlines the context tree (capped) and
  parses `<file path="...">` blocks back into the harvested workspace.
"""

from __future__ import annotations

import dataclasses
import hashlib
import json
import re
import shutil
import tempfile
import threading
from collections.abc import Callable
from pathlib import Path

from harness2.core import tree as HT
from harness2.core.proposer import Proposer, ProposerError, Reply
from harness2.core.spec import BenchPrompts, BenchSpec, ChannelSpec
from harness2.substrate.opencode import OPENCODE_SURFACE

from ..errors import H2DS4Error
from ..evidence import normalize
from ..fixtures import TaskFixture
from ..model.inference_gate import InferenceGate
from ..model.openai_client import OpenAIClient
from ..orchestration.budgets import Budget, estimate_tokens
from ..policy import mutation
from ..policy.paths import PathDenied, validate_relpath
from ..substrates.base import ExecutionResult

DS4_SURFACE = dataclasses.replace(
    OPENCODE_SURFACE,
    # Same name: harness2 prompts are keyed by surface name. The regex cache is keyed by
    # (name, skill_dir, plugin_dir), and plugin_dir differs, so patterns do not collide.
    autotrigger_file=mutation.SYSTEMPROMPT,
    plugin_dir=None,
    trigger_hint=('Add a line naming `{name}` to systemprompt.md AFTER the '
                  f'{mutation.DYNAMIC_MARKER} marker, e.g. "When <situation>, load the '
                  '`{name}` skill."'),
)


class Ds4Surface:
    name = 'ds4oc'

    def surface(self) -> HT.SurfaceSpec:
        return DS4_SURFACE


class Cancelled(RuntimeError):
    pass


def label_of(run_id: str) -> str:
    return run_id.rsplit('/', 1)[-1]


def sandbox_run_id(run_id: str) -> str:
    return 'r' + hashlib.sha256(run_id.encode()).hexdigest()[:20]


def tree_to_bytes(tree: dict[str, str]) -> dict[str, bytes]:
    return {k: v.encode('utf-8') for k, v in tree.items()}


class Ds4BenchAdapter:
    """One fixture as a one-task benchmark, executed through an h2ds4 substrate."""

    def __init__(self, *, fixture: TaskFixture, base_tree: dict[str, str], work_root: Path,
                 executor: Callable[[TaskFixture, dict[str, bytes], str], ExecutionResult],
                 on_rollout: Callable[[str, ExecutionResult, dict[str, bytes]], None],
                 progress: Callable[[str], None], cancelled: Callable[[], bool],
                 model_channel: str = 'ds4/local'):
        self.fixture = fixture
        self.substrate = Ds4Surface()
        self.root = work_root
        self._base_tree = dict(base_tree)
        self._executor = executor
        self._on_rollout = on_rollout
        self._progress = progress
        self._cancelled = cancelled
        self._lock = threading.Lock()
        channel = ChannelSpec('opencode', model_channel)
        self.spec = BenchSpec(
            name='h2ds4', runs_root=work_root / 'runs', install_mode='workspace_agents_md',
            prompts=BenchPrompts(work=fixture.work),
            channels={'proposer': channel, 'selector': channel},
            leak_globs=('*evaluator*', '*gold*', 'expected*'),
        )
        HT.write_tree(DS4_SURFACE, self._base_tree, self.base_harness(), stubs=False)
        src = self.task_files(fixture.id)
        src.mkdir(parents=True, exist_ok=True)
        for rel, data in fixture.workspace.items():
            p = src / validate_relpath(rel)
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_bytes(data)
        self.results: dict[str, ExecutionResult] = {}

    # -- BenchmarkAdapter ----------------------------------------------------------------
    def tasks(self, split: str = 'all') -> list[str]:
        return [self.fixture.id]

    def domain_of(self, task_id: str) -> str:
        return self.fixture.family

    def task_prompt(self, task_id: str) -> str:
        return self.fixture.prompt

    def task_files(self, task_id: str) -> Path:
        return self.root / 'sources' / task_id

    def base_harness(self) -> Path:
        return self.root / 'base'

    def validate_tree(self, harness: HT.Tree) -> None:
        try:
            mutation.check_tree(tree_to_bytes(harness), tree_to_bytes(self._base_tree))
        except mutation.MutationDenied as e:
            raise ValueError(str(e)) from e

    def execute(self, task_id: str, harness_dir: Path | None, run_id: str, *,
                timeout: int | None = None) -> Path:
        if self._cancelled():
            raise Cancelled('cancel requested')
        label = label_of(run_id)
        run_dir = self.root / 'executions' / sandbox_run_id(run_id)
        if (run_dir / 'meta.json').is_file():
            return run_dir  # idempotent by run_id: never re-run a finished rollout
        tree = HT.read_tree(DS4_SURFACE, harness_dir) if harness_dir else dict(self._base_tree)
        harness = tree_to_bytes(tree)
        self._progress(label)
        with self._lock:  # rollouts are serialised: one sandbox, one model call at a time
            result = self._executor(self.fixture, harness, sandbox_run_id(run_id))
        run_dir.mkdir(parents=True, exist_ok=True)
        out = run_dir / 'output'
        for rel, data in result.sandbox.workspace.items():
            if rel.startswith('.'):
                continue
            p = out / validate_relpath(rel, max_len=400)
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_bytes(data)
        (run_dir / 'events.jsonl').write_text(
            ''.join(json.dumps(e, sort_keys=True) + '\n' for e in result.events), encoding='utf-8')
        self.results[run_id] = result
        self._on_rollout(run_id, result, harness)
        (run_dir / 'meta.json').write_text(json.dumps({
            'run_id': run_id, 'label': label, 'returncode': result.sandbox.returncode,
            'timed_out': result.sandbox.timed_out, 'usage': result.usage}), encoding='utf-8')
        return run_dir

    def delivered(self, run_dir: Path) -> bool:
        return all((run_dir / 'output' / d).is_file() for d in self.fixture.deliverables)

    def trajectory(self, run_dir: Path, *, obs_trunc: int) -> str:
        events = [json.loads(ln) for ln in
                  (run_dir / 'events.jsonl').read_text(encoding='utf-8').splitlines() if ln]
        return normalize.render(events, max_chars=max(obs_trunc, 10_000))

    def deliverable_files(self, run_dir: Path) -> dict[str, str]:
        out = {}
        for d in self.fixture.deliverables:
            p = run_dir / 'output' / d
            if p.is_file():
                out[d] = p.read_text(encoding='utf-8', errors='replace')[:20000]
        return out

    def deliverable_text(self, run_dir: Path) -> str:
        return '\n\n'.join(f'## {k}\n{v}' for k, v in self.deliverable_files(run_dir).items())

    def score(self, run_dir: Path, task_id: str) -> dict | None:
        return None  # scoring is h2ds4's post-selection gate, never the H2 judge


# -- proposers ---------------------------------------------------------------------------

def _harvest_copy(context_dir: Path) -> Path:
    ws = Path(tempfile.mkdtemp(prefix='h2ds4-harvest-'))
    src = context_dir / 'harness'
    if src.is_dir():
        shutil.copytree(src, ws, dirs_exist_ok=True)
    return ws


class ScriptedProposer(Proposer):
    """Deterministic editor driven by the fixture's `scripted.edit` block (no model).

    INV adds the first rule, DOM all rules, the composition all rules: enough to exercise
    propose -> probe -> compose -> gate with real validation and real sandbox rollouts.
    """

    def __init__(self, spec: ChannelSpec, edit: dict, *, on_call: Callable[[str], None],
                 cancelled: Callable[[], bool]):
        super().__init__(spec)
        self.edit = edit
        self.on_call = on_call
        self.cancelled = cancelled

    def call(self, mission, context_dir, label, **kwargs) -> Reply:
        if self.cancelled():
            raise ProposerError('cancel requested', attempts=0)
        self.on_call(label)
        if label.startswith('select.'):
            cands = sorted(p.stem for p in (Path(context_dir) / 'candidates').glob('*.md'))
            text = (f'<why>scripted: first candidate</why>\n```choice\n{cands[0]}\n```'
                    if cands else 'NO_CHOICE')
            reply = Reply(label=label, text=text, ok=True, attempts=1)
            self._calls.append(reply)
            return reply
        if label.startswith('experience.'):
            reply = Reply(label=label, text='NO_ENTRY', ok=True, attempts=1)
            self._calls.append(reply)
            return reply
        ws = _harvest_copy(Path(context_dir))
        rules = list(self.edit.get('rules', []))
        if label.startswith('inv'):
            rules = rules[:1]
        name = self.edit['skill']
        skill = ws / 'skills' / name / 'SKILL.md'
        skill.parent.mkdir(parents=True, exist_ok=True)
        skill.write_text(
            f"---\nname: {name}\ndescription: {self.edit['description']}\n---\n\n"
            + ''.join(f'- H2DS4-RULE: {r}\n' for r in rules), encoding='utf-8')
        sp = ws / mutation.SYSTEMPROMPT
        text = sp.read_text(encoding='utf-8') if sp.is_file() else ''
        if name not in text:
            sp.write_text(text.rstrip('\n') + f'\n- {self.edit["trigger"]}, load the '
                          f'`{name}` skill.\n', encoding='utf-8')
        reply = Reply(label=label, text=f'<notes>{label}: rules {rules}</notes>', ok=True,
                      attempts=1, workspace=ws)
        self._calls.append(reply)
        return reply


_FILE_BLOCK = re.compile(r'<file path="([^"\n]{1,200})">\n?(.*?)</file>', re.S)


class Ds4LocalProposer(Proposer):
    """Improver session against the local DS4 model through the inference gate + budget."""

    def __init__(self, spec: ChannelSpec, client: OpenAIClient, *, gate: InferenceGate,
                 budget: Budget, experiment_id: str, profile_digest: str,
                 max_context_chars: int, max_output_tokens: int,
                 on_call: Callable[[str], None], cancelled: Callable[[], bool]):
        super().__init__(spec)
        self.client = client
        self.gate = gate
        self.budget = budget
        self.experiment_id = experiment_id
        self.profile_digest = profile_digest
        self.max_context_chars = max_context_chars
        self.max_output_tokens = max_output_tokens
        self.on_call = on_call
        self.cancelled = cancelled
        self.usage: list[dict] = []

    def _inline_context(self, context_dir: Path) -> str:
        parts, used = [], 0
        for p in sorted(context_dir.rglob('*')):
            if not p.is_file() or p.is_symlink():
                continue
            rel = str(p.relative_to(context_dir))
            try:
                body = p.read_text(encoding='utf-8')
            except UnicodeDecodeError:
                continue
            room = self.max_context_chars - used
            if room <= 200:
                parts.append('[... further context files omitted: context cap reached]')
                break
            if len(body) > room:
                body = body[:room] + f'\n[... clipped {len(body) - room} chars]'
            parts.append(f'<context path="{rel}">\n{body}\n</context>')
            used += len(body)
        return '\n'.join(parts)

    def call(self, mission, context_dir, label, *, system: str = '', timeout=None,
             max_attempts=None, harvest=None) -> Reply:
        if self.cancelled():
            raise ProposerError('cancel requested', attempts=0)
        self.on_call(label)
        ctx = Path(context_dir) if context_dir else None
        protocol = (
            '\n\n# HOW TO REPLY\nYou cannot open files: their contents are inlined above as '
            '<context> blocks. To edit the harness, reply with one block per changed file:\n'
            '<file path="harness/RELATIVE/PATH">\nFULL NEW CONTENT\n</file>\n'
            'Omitted files are inherited unchanged. End with <notes>why</notes>.')
        content = (self._inline_context(ctx) if ctx else '') + '\n\n' + mission + protocol
        messages = ([{'role': 'system', 'content': system}] if system else []) + \
            [{'role': 'user', 'content': content}]
        try:
            self.budget.before_model(estimate_tokens(content), self.max_output_tokens)
            with self.gate.permit(self.experiment_id, self.profile_digest, timeout_s=600):
                resp = self.client.chat(messages, max_tokens=self.max_output_tokens)
        except H2DS4Error as e:
            raise ProposerError(f'[{label}] {e.code}', attempts=1) from e
        self.usage.append({'label': label, 'input_tokens': resp.usage.input_tokens,
                           'output_tokens': resp.usage.output_tokens,
                           'usage_source': resp.usage.source})
        if not resp.content.strip():
            raise ProposerError(f'[{label}] empty reply', attempts=1)
        reply = Reply(label=label, text=resp.content, ok=True, attempts=1, channel='ds4')
        if harvest and ctx is not None:
            ws = _harvest_copy(ctx)
            for path, body in _FILE_BLOCK.findall(resp.content):
                if not path.startswith('harness/'):
                    continue
                rel = path[len('harness/'):]
                try:
                    validate_relpath(rel)
                except PathDenied:
                    continue  # unsafe names never reach disk; validation reports the gap
                if not HT.is_allowed(DS4_SURFACE, rel):
                    continue
                dest = ws / rel
                dest.parent.mkdir(parents=True, exist_ok=True)
                dest.write_text(body if body.endswith('\n') else body + '\n', encoding='utf-8')
            reply.workspace = ws
        self._calls.append(reply)
        return reply
