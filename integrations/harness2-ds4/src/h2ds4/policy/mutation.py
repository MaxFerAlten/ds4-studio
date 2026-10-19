"""Phase-1 mutation policy over the c1..c8 tree (plan §19, §32.1).

Run *after* `harness2.core.tree.validate`: this is the stricter DS4 gate. It enforces
semantic invariants, not just syntax:

- c1 `systemprompt.md`: the base text is an immutable prefix; additions only after the
  `H2DS4_DYNAMIC_GUIDANCE` marker.
- c2 `guardrails.md`: byte-identical to the base (phase 2 only).
- c3/c4: editable, size-capped, security-scanned.
- c6 skills: frontmatter `name` matches the directory, `description` present, size cap.
- c5/c7/c8 (sub_agents, scripts, skill scripts, plugins, hooks): rejected.
"""

from __future__ import annotations

import re
import unicodedata

from . import security
from .paths import PathDenied, assert_no_casefold_collisions, validate_relpath

SYSTEMPROMPT = 'systemprompt.md'
GUARDRAILS = 'guardrails.md'
MEMORY = 'LongTermMEMORY.md'
TOOL_GUIDANCE = 'tool_descriptions/tool_guidance.md'
DYNAMIC_MARKER = '<!-- H2DS4_DYNAMIC_GUIDANCE -->'

COMPONENT_OF = {SYSTEMPROMPT: 'c1', GUARDRAILS: 'c2', MEMORY: 'c3', TOOL_GUIDANCE: 'c4'}
_SKILL = re.compile(r'^skills/([a-z0-9][a-z0-9_-]{0,63})/SKILL\.md$')
MAX_SKILL_BYTES = 16384


class MutationDenied(ValueError):
    pass


def component_of(rel: str) -> str:
    if rel in COMPONENT_OF:
        return COMPONENT_OF[rel]
    if _SKILL.fullmatch(rel):
        return 'c6'
    if rel.startswith('sub_agents/'):
        return 'c5'
    if rel.startswith('scripts/') or re.match(r'^skills/[^/]+/scripts/', rel):
        return 'c7'
    if rel.startswith('plugin/'):
        return 'c8'
    return 'unknown'


def _text(rel: str, data: bytes) -> str:
    if not isinstance(data, bytes) or b'\x00' in data:
        raise MutationDenied(f'{rel}: non-text/invalid bytes')
    try:
        decoded = data.decode('utf-8', errors='strict')
    except UnicodeError as e:
        raise MutationDenied(f'{rel}: not utf-8') from e
    if '\r' in decoded:
        raise MutationDenied(f'{rel}: non-LF line endings denied')
    return decoded


def check_tree(
    tree: dict[str, bytes],
    base: dict[str, bytes],
    *,
    allowed_components: tuple[str, ...] = ('c1', 'c3', 'c4', 'c6'),
    max_files: int = 24,
    max_bytes: int = 262144,
) -> dict:
    """Raise MutationDenied listing every problem; return a census of changes."""
    errs: list[str] = []
    if len(tree) > max_files:
        raise MutationDenied('too many files')
    if sum(len(b) for b in tree.values()) > max_bytes:
        raise MutationDenied('tree too large')
    try:
        assert_no_casefold_collisions(list(tree))
    except PathDenied as e:
        raise MutationDenied(str(e)) from e
    skill_keys: dict[str, str] = {}
    changed: list[str] = []
    for rel in sorted(tree):
        try:
            validate_relpath(rel)
        except PathDenied as e:
            errs.append(f'{rel!r}: {e}')
            continue
        comp = component_of(rel)
        text = _text(rel, tree[rel])
        is_change = base.get(rel) != tree[rel]
        if is_change:
            changed.append(rel)
        if comp in ('c5', 'c7', 'c8', 'unknown'):
            errs.append(f'{rel}: component {comp} not allowed in phase 1')
            continue
        if comp == 'c2':
            if is_change:
                errs.append(f'{GUARDRAILS} is immutable in phase 1 (baseline byte-for-byte)')
            continue
        if is_change and comp not in allowed_components:
            errs.append(f'{rel}: component {comp} not enabled by policy')
            continue
        if comp == 'c1' and is_change:
            base_text = base.get(rel, b'').decode('utf-8', errors='strict')
            head, sep, _ = text.partition(DYNAMIC_MARKER)
            base_head = base_text.partition(DYNAMIC_MARKER)[0]
            if not sep or head != base_head:
                errs.append(f'{SYSTEMPROMPT}: the base text is immutable; add guidance only '
                            f'after the {DYNAMIC_MARKER} marker')
        if comp == 'c6':
            m = _SKILL.fullmatch(rel)
            assert m
            name = m.group(1)
            key = unicodedata.normalize('NFC', name).casefold().replace('_', '-')
            if key in skill_keys:
                errs.append(f'skills {skill_keys[key]!r} and {name!r} collide')
            skill_keys[key] = name
            if len(tree[rel]) > MAX_SKILL_BYTES:
                errs.append(f'{rel}: over {MAX_SKILL_BYTES} bytes')
            fm = text[:800]
            if not re.search(rf'^name:\s*{re.escape(name)}\s*$', fm, re.M):
                errs.append(f'{rel}: frontmatter `name: {name}` required')
            if not re.search(r'^description:\s*\S', fm, re.M):
                errs.append(f'{rel}: frontmatter `description:` required')
        if is_change:
            errs.extend(f'{rel}: {f}' for f in security.scan_text(text))
    for rel in base:
        if rel not in tree and component_of(rel) in ('c1', 'c2'):
            errs.append(f'{rel}: always-on base file may not be removed')
    if errs:
        raise MutationDenied(' | '.join(errs))
    return {'changed': changed, 'n_files': len(tree),
            'components': sorted({component_of(r) for r in changed})}


def to_bytes(tree: dict[str, str]) -> dict[str, bytes]:
    return {k: v.encode('utf-8') for k, v in tree.items()}
