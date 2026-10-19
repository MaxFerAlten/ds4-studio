"""Task fixtures and evaluation profiles: files on disk, identified by digest (plan §12, §36.5).

A fixture holds only what the solver may see. Evaluation profiles (gold answers, check
scripts) live in a separate directory that is never mounted into a solver sandbox and
never copied into proposer context.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path

from .canonical import digest_obj, tree_digest
from .errors import Code, H2DS4Error
from .models import safe_id
from .policy.paths import read_tree_nofollow, validate_relpath

MAX_FIXTURE_FILES = 256
MAX_FIXTURE_BYTES = 8 * 1024 * 1024
_FIXTURE_KEYS = {'schema_version', 'id', 'family', 'work', 'prompt_file', 'workspace_dir',
                 'deliverables', 'evaluator_id', 'scripted', 'split', 'tags'}
_EVAL_KEYS = {'schema_version', 'id', 'checks', 'scored_metrics', 'quality_gate', 'check_script',
              'holdout_only_score', 'allowed_tools'}
CHECK_TYPES = {'file_exists', 'json_equals', 'text_equals', 'regex', 'python_check',
               'no_forbidden_calls', 'max_tool_calls'}


@dataclass(frozen=True)
class TaskFixture:
    id: str
    family: str
    work: str
    prompt: str
    workspace: dict[str, bytes]
    deliverables: tuple[str, ...]
    evaluator_id: str
    split: str = 'dev'
    tags: tuple[str, ...] = ()
    scripted: dict = field(default_factory=dict)

    @property
    def source_digest(self) -> str:
        return digest_obj({'id': self.id, 'family': self.family, 'work': self.work,
                           'prompt': self.prompt, 'workspace': tree_digest(self.workspace),
                           'deliverables': list(self.deliverables),
                           'evaluator_id': self.evaluator_id, 'scripted': self.scripted})


@dataclass(frozen=True)
class EvaluationProfile:
    id: str
    checks: tuple[dict, ...]
    scored_metrics: tuple[dict, ...]
    quality_gate: dict
    check_script: bytes | None
    allowed_tools: tuple[str, ...] | None = None

    @property
    def digest(self) -> str:
        return digest_obj({'id': self.id, 'checks': list(self.checks),
                           'scored_metrics': list(self.scored_metrics),
                           'quality_gate': self.quality_gate,
                           'check_script': (self.check_script or b'').decode('utf-8'),
                           'allowed_tools': list(self.allowed_tools or ())})


def _load_json(path: Path, keys: set[str]) -> dict:
    try:
        data = json.loads(path.read_text(encoding='utf-8'))
    except (OSError, json.JSONDecodeError) as e:
        raise H2DS4Error(Code.INVALID_INPUT, f'unreadable spec {path.name}') from e
    if not isinstance(data, dict) or data.get('schema_version') != 1:
        raise H2DS4Error(Code.INVALID_INPUT, 'spec must be an object with schema_version 1')
    extra = set(data) - keys
    if extra:
        raise H2DS4Error(Code.INVALID_INPUT, f'unknown spec fields {sorted(extra)}')
    return data


def load_fixture(root: Path, task_id: str) -> TaskFixture:
    safe_id(task_id)
    d = root / 'tasks' / task_id
    spec = _load_json(d / 'task.json', _FIXTURE_KEYS)
    if spec.get('id') != task_id:
        raise H2DS4Error(Code.INVALID_INPUT, 'fixture id does not match its directory')
    prompt_file = validate_relpath(spec.get('prompt_file', 'task.md'))
    ws_dir = validate_relpath(spec.get('workspace_dir', 'workspace'))
    deliverables = tuple(validate_relpath(x) for x in spec.get('deliverables', []))
    if not deliverables:
        raise H2DS4Error(Code.INVALID_INPUT, 'fixture must declare deliverables')
    workspace = read_tree_nofollow(d / ws_dir, max_files=MAX_FIXTURE_FILES,
                                   max_bytes=MAX_FIXTURE_BYTES) if (d / ws_dir).is_dir() else {}
    for rel in workspace:
        if rel.split('/')[0] in ('.harness', '.home', '.h2ds4', '.opencode') or \
                rel in ('AGENTS.md', 'opencode.json'):
            raise H2DS4Error(Code.INVALID_INPUT, 'fixture uses a reserved workspace path')
    return TaskFixture(
        id=task_id, family=safe_id(spec['family']), work=str(spec['work'])[:400],
        prompt=(d / prompt_file).read_text(encoding='utf-8'), workspace=workspace,
        deliverables=deliverables, evaluator_id=safe_id(spec['evaluator_id']),
        split=str(spec.get('split', 'dev')), tags=tuple(spec.get('tags', [])),
        scripted=dict(spec.get('scripted') or {}))


def load_evaluator(root: Path, eval_id: str) -> EvaluationProfile:
    safe_id(eval_id)
    d = root / 'evaluators' / eval_id
    spec = _load_json(d / 'evaluator.json', _EVAL_KEYS)
    if spec.get('id') != eval_id:
        raise H2DS4Error(Code.INVALID_INPUT, 'evaluator id does not match its directory')
    checks = tuple(spec.get('checks', []))
    for c in checks:
        if not isinstance(c, dict) or c.get('type') not in CHECK_TYPES:
            raise H2DS4Error(Code.INVALID_INPUT, 'unknown check type')
        if 'path' in c:
            validate_relpath(c['path'])
    script = None
    if spec.get('check_script'):
        script = (d / validate_relpath(spec['check_script'])).read_bytes()
    tools = spec.get('allowed_tools')
    return EvaluationProfile(
        id=eval_id, checks=checks, scored_metrics=tuple(spec.get('scored_metrics', [])),
        quality_gate=dict(spec.get('quality_gate', {})), check_script=script,
        allowed_tools=tuple(tools) if tools is not None else None)


def list_fixtures(root: Path) -> list[str]:
    base = root / 'tasks'
    return sorted(p.name for p in base.iterdir() if (p / 'task.json').is_file()) \
        if base.is_dir() else []
