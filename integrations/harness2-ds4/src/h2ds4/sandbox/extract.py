"""Safe extraction of the sandbox workspace tar into memory (plan §26.4, SEC-027).

Only regular files and directories are accepted; symlinks, hardlinks, devices, FIFOs,
absolute or escaping names are refused. Sizes are capped before reading.
"""

from __future__ import annotations

import io
import tarfile

from ..policy.paths import PathDenied, validate_relpath


def extract_tree(data: bytes, *, max_files: int, max_bytes: int,
                 skip_prefixes: tuple[str, ...] = ('.home/', '.h2ds4/')) -> dict[str, bytes]:
    out: dict[str, bytes] = {}
    total = 0
    with tarfile.open(fileobj=io.BytesIO(data), mode='r:') as tf:
        for m in tf:
            name = m.name
            while name.startswith('./'):
                name = name[2:]
            if name in ('', '.'):
                continue
            if m.isdir():
                continue
            if not m.isreg():
                raise PathDenied(f'non-regular member in workspace: {m.type!r}')
            validate_relpath(name, max_len=400)
            if any(name.startswith(p) for p in skip_prefixes):
                continue
            total += m.size
            if total > max_bytes:
                raise PathDenied('workspace output too large')
            if len(out) >= max_files:
                raise PathDenied('too many files in workspace output')
            f = tf.extractfile(m)
            assert f is not None
            out[name] = f.read()
    return out
