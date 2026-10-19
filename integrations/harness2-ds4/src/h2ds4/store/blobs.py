"""Content-addressed blob store with crash-safe publication (plan §13.2).

tmp in the same filesystem -> fsync(fd) -> os.replace -> fsync(dirfd). A blob exists
before any DB row references it; GC only removes unreferenced blobs past a grace period.
"""

from __future__ import annotations

import os
import time
from pathlib import Path

from ..canonical import DIGEST_RE, digest_bytes
from ..errors import Code, H2DS4Error
from ..policy.paths import ensure_private_dir


class BlobStore:
    def __init__(self, root: Path):
        self.root = ensure_private_dir(root)
        self.tmp = ensure_private_dir(root / 'tmp')

    def _path(self, digest: str) -> Path:
        if not DIGEST_RE.fullmatch(digest):
            raise H2DS4Error(Code.INVALID_INPUT, 'bad digest')
        hexd = digest[7:]
        return self.root / 'sha256' / hexd[:2] / hexd

    def put(self, data: bytes) -> str:
        digest = digest_bytes(data)
        final = self._path(digest)
        if final.exists():
            if digest_bytes(final.read_bytes()) != digest:
                raise H2DS4Error(Code.INTEGRITY_FAILURE, 'existing blob corrupted')
            return digest
        ensure_private_dir(final.parent.parent)
        ensure_private_dir(final.parent)
        tmp = self.tmp / f'{digest[7:]}.{os.getpid()}.{time.monotonic_ns()}'
        fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        try:
            with os.fdopen(fd, 'wb') as f:
                f.write(data)
                f.flush()
                os.fsync(f.fileno())
            os.replace(tmp, final)
            dfd = os.open(final.parent, os.O_RDONLY | os.O_DIRECTORY)
            try:
                os.fsync(dfd)
            finally:
                os.close(dfd)
        except BaseException:
            tmp.unlink(missing_ok=True)
            raise
        return digest

    def get(self, digest: str) -> bytes:
        p = self._path(digest)
        try:
            fd = os.open(p, os.O_RDONLY | os.O_NOFOLLOW)
        except FileNotFoundError as e:
            raise H2DS4Error(Code.NOT_FOUND, 'blob missing') from e
        with os.fdopen(fd, 'rb') as f:
            data = f.read()
        if digest_bytes(data) != digest:
            raise H2DS4Error(Code.INTEGRITY_FAILURE, 'blob digest mismatch')
        return data

    def exists(self, digest: str) -> bool:
        return self._path(digest).is_file()

    def gc(self, referenced: set[str], *, grace_s: float = 86400.0) -> list[str]:
        removed: list[str] = []
        now = time.time()
        base = self.root / 'sha256'
        if not base.is_dir():
            return removed
        for p in base.glob('*/*'):
            digest = 'sha256:' + p.name
            if digest in referenced or now - p.stat().st_mtime < grace_s:
                continue
            p.unlink()
            removed.append(digest)
        return removed
