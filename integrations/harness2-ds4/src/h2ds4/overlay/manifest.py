"""Immutable overlay manifests (plan §19.1)."""

from __future__ import annotations

from ..canonical import is_digest, sha256_hex, tree_digest
from ..evidence.fingerprint import H2_COMMIT
from ..policy.mutation import component_of
from ..policy.paths import assert_no_casefold_collisions, validate_relpath

_KEYS = {'schema_version', 'overlay_digest', 'parent_digest', 'engine_commit',
         'ds4_snapshot_digest', 'model_profile_digest', 'files', 'allowed_tools',
         'evidence_digest', 'approval_required', 'experiment_id'}


def build(tree: dict[str, bytes], *, parent_digest: str, ds4_snapshot_digest: str,
          model_profile_digest: str, evidence_digest: str, experiment_id: str) -> dict:
    files = [{'path': p, 'sha256': sha256_hex(b), 'surface': component_of(p),
              'size_bytes': len(b)} for p, b in sorted(tree.items())]
    m = {'schema_version': 1, 'overlay_digest': tree_digest(tree),
         'parent_digest': parent_digest, 'engine_commit': H2_COMMIT,
         'ds4_snapshot_digest': ds4_snapshot_digest,
         'model_profile_digest': model_profile_digest, 'files': files, 'allowed_tools': [],
         'evidence_digest': evidence_digest, 'approval_required': True,
         'experiment_id': experiment_id}
    validate(m, tree)
    return m


def validate(m: dict, tree: dict[str, bytes] | None = None) -> None:
    if set(m) != _KEYS or m.get('schema_version') != 1:
        raise ValueError('manifest fields invalid')
    for k in ('overlay_digest', 'parent_digest', 'ds4_snapshot_digest',
              'model_profile_digest', 'evidence_digest'):
        if not is_digest(m[k]):
            raise ValueError(f'manifest {k} must be a sha256 digest')
    if m['engine_commit'] != H2_COMMIT:
        raise ValueError('manifest engine commit is not the pinned Harness² commit')
    if m['allowed_tools'] != [] or m['approval_required'] is not True:
        raise ValueError('overlays never grant tools and always need approval')
    paths = [f['path'] for f in m['files']]
    for p in paths:
        validate_relpath(p)
    assert_no_casefold_collisions(paths)
    if tree is not None:
        if sorted(tree) != sorted(paths):
            raise ValueError('manifest file list does not match the tree')
        for f in m['files']:
            if sha256_hex(tree[f['path']]) != f['sha256'] or len(tree[f['path']]) != f['size_bytes']:
                raise ValueError('manifest file digest mismatch')
        if tree_digest(tree) != m['overlay_digest']:
            raise ValueError('manifest overlay digest mismatch')
