"""Skill staging outside DS4 for a voluntary restart (plan §25, WP16).

The staged root is a verified COPY: canonical DS4 skills (read-only, never modified)
merged with the approved overlay's skills. A name collision is refused unless the caller
explicitly asks for `replace`, which records the diff. Nothing is symlinked into DS4 and
nothing is launched: the command to start DS4 with the staged root is printed only.
"""

from __future__ import annotations

import difflib
from pathlib import Path

from ..canonical import tree_digest
from ..errors import Code, H2DS4Error
from ..policy.paths import is_within, read_tree_nofollow
from .stage import publish_tree


def merge_skills(canonical: dict[str, bytes], overlay: dict[str, bytes], *,
                 replace: frozenset[str] = frozenset()) -> tuple[dict[str, bytes], list[dict]]:
    merged = dict(canonical)
    changes: list[dict] = []
    canon_names = {p.split('/')[0].casefold(): p.split('/')[0] for p in canonical}
    for rel, data in sorted(overlay.items()):
        if not (rel.startswith('skills/') and rel.endswith('/SKILL.md')):
            continue
        name = rel.split('/')[1]
        dest = f'{name}/SKILL.md'
        existing = canon_names.get(name.casefold())
        if existing is not None:
            if existing != name:
                raise H2DS4Error(Code.POLICY_DENIED, f'skill {name!r} collides by case')
            if name not in replace:
                raise H2DS4Error(Code.CONFLICT, f'skill {name!r} exists in DS4; pass --replace '
                                 f'{name} to replace it after reviewing the diff')
            diff = ''.join(difflib.unified_diff(
                canonical[dest].decode().splitlines(True), data.decode().splitlines(True),
                f'canonical/{dest}', f'overlay/{dest}'))
            changes.append({'skill': name, 'action': 'replace', 'diff': diff})
        else:
            changes.append({'skill': name, 'action': 'add'})
        merged[dest] = data
    return merged, changes


def export_skills(*, canonical_dir: Path, overlay_tree: dict[str, bytes], staging_root: Path,
                  protected_roots: list[Path], replace: frozenset[str] = frozenset(),
                  srun_path: Path | None = None) -> dict:
    for prot in protected_roots:
        if is_within(staging_root, prot):
            raise H2DS4Error(Code.POLICY_DENIED, 'staging root may not be inside DS4')
    canonical = read_tree_nofollow(canonical_dir, max_files=2000, max_bytes=64 << 20)
    merged, changes = merge_skills(canonical, overlay_tree, replace=replace)
    digest = tree_digest(merged)
    dest = publish_tree(staging_root, digest[7:], merged)
    cmd = (f'DS4_SKILLS_DIR="{dest}" {srun_path or "<DS4_ROOT>/srun.sh"}'
           if changes else '')
    return {'staged_dir': str(dest), 'digest': digest, 'changes': changes,
            'canonical_skills': sorted({p.split("/")[0] for p in canonical}),
            'manual_start_command': cmd,
            'warning': 'Run only after ending active DS4 sessions; h2ds4 never starts, stops '
                       'or restarts DS4. Whether the selected agent loop consumes '
                       'DS4_SKILLS_DIR is backend-specific (WP16 loader note).'}
