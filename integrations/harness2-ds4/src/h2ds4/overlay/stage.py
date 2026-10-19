"""Crash-safe materialisation of overlay trees outside DS4 (plan §25.1, §32.3)."""

from __future__ import annotations

import json
import os
import shutil
import tempfile
from pathlib import Path

from ..canonical import canonical_json, tree_digest
from ..errors import Code, H2DS4Error
from ..policy.paths import ensure_private_dir, read_tree_nofollow, write_tree_nofollow
from . import manifest as M


def _fsync_dir(path: Path) -> None:
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def publish_tree(parent: Path, name: str, tree: dict[str, bytes],
                 extra: dict[str, bytes] | None = None) -> Path:
    """Write `tree` into parent/name atomically: private tmp dir, fsync, rename, fsync."""
    ensure_private_dir(parent)
    final = parent / name
    if final.exists():
        got = read_tree_nofollow(final, max_files=10000, max_bytes=1 << 30)
        for k in (extra or {}):
            got.pop(k, None)
        if tree_digest(got) != tree_digest(tree):
            raise H2DS4Error(Code.INTEGRITY_FAILURE, 'existing staged tree differs')
        return final
    tmp = Path(tempfile.mkdtemp(prefix=f'.{name}.', dir=parent))
    try:
        os.chmod(tmp, 0o700)
        write_tree_nofollow(tmp, {**tree, **(extra or {})})
        got = read_tree_nofollow(tmp, max_files=10000, max_bytes=1 << 30)
        for k in (extra or {}):
            got.pop(k, None)
        if tree_digest(got) != tree_digest(tree):
            raise H2DS4Error(Code.INTEGRITY_FAILURE, 'staged tree digest mismatch')
        os.rename(tmp, final)
        _fsync_dir(parent)
    except BaseException:
        shutil.rmtree(tmp, ignore_errors=True)
        raise
    return final


def stage_overlay(data_dir: Path, tree: dict[str, bytes], manifest: dict) -> Path:
    M.validate(manifest, tree)
    name = manifest['overlay_digest'][7:]
    return publish_tree(data_dir / 'overlays', name, tree,
                        {'.manifest.json': canonical_json(manifest)})


def load_overlay(data_dir: Path, digest: str) -> tuple[dict[str, bytes], dict]:
    d = data_dir / 'overlays' / digest[7:]
    got = read_tree_nofollow(d, max_files=10000, max_bytes=1 << 30)
    manifest = json.loads(got.pop('.manifest.json'))
    M.validate(manifest, got)
    return got, manifest


def write_pointer(path: Path, payload: dict) -> None:
    ensure_private_dir(path.parent)
    tmp = path.with_name(f'.{path.name}.{os.getpid()}.tmp')
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'wb') as f:
        f.write(canonical_json(payload) + b'\n')
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, path)
    _fsync_dir(path.parent)
