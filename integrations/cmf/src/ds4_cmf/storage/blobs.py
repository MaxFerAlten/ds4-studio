"""Content-addressed blobs: the CMF redacted store and read-only DS4 refs.

Layout is the one ds4_context_blob.c uses: <root>/sha256/<64 hex>.txt.  Every
open walks from the root with dir_fd + O_NOFOLLOW, so a symlinked directory
or file, a hardlink (nlink > 1) or a swap during the walk is refused instead
of followed.  The DS4 root is never written.
"""

from __future__ import annotations

import errno
import hashlib
import os
import secrets
import stat
from pathlib import Path

from ..api.errors import CmfError
from ..domain.events import DS4_BLOB_ID, BlobRef

_HEX64 = frozenset("0123456789abcdef")
_DIR_FLAGS = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC


def _check_hex(sha: str) -> str:
    if len(sha) != 64 or not set(sha) <= _HEX64:
        raise CmfError("SCHEMA", "bad sha256")
    return sha


def _open_dir(root: Path, *, create: bool) -> int:
    """fd of <root>/sha256.  `root` itself must be a real directory."""
    try:
        st = os.lstat(root)
    except FileNotFoundError:
        if not create:
            raise CmfError("SOURCE_UNAVAILABLE", "blob root missing") from None
        os.makedirs(root, mode=0o700, exist_ok=True)
        st = os.lstat(root)
    if not stat.S_ISDIR(st.st_mode):
        raise CmfError("SOURCE_UNAVAILABLE", "blob root is not a directory")
    rfd = os.open(root, _DIR_FLAGS)
    try:
        try:
            return os.open("sha256", _DIR_FLAGS, dir_fd=rfd)
        except FileNotFoundError:
            if not create:
                raise CmfError("SOURCE_UNAVAILABLE", "blob directory missing") from None
            try:
                os.mkdir("sha256", 0o700, dir_fd=rfd)
            except FileExistsError:
                pass
            return os.open("sha256", _DIR_FLAGS, dir_fd=rfd)
        except OSError as exc:
            if exc.errno in (errno.ELOOP, errno.ENOTDIR):
                raise CmfError("SOURCE_UNAVAILABLE", "blob directory is a link") from None
            raise
    finally:
        os.close(rfd)


def _read_verified(dfd: int, sha: str, *, max_bytes: int, expected_len: int | None) -> bytes:
    try:
        fd = os.open(f"{sha}.txt", os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=dfd)
    except FileNotFoundError:
        raise CmfError("SOURCE_UNAVAILABLE", "blob missing") from None
    except OSError as exc:
        if exc.errno == errno.ELOOP:
            raise CmfError("SOURCE_UNAVAILABLE", "blob is a symlink") from None
        raise
    try:
        st = os.fstat(fd)
        if not stat.S_ISREG(st.st_mode) or st.st_nlink != 1:
            raise CmfError("SOURCE_UNAVAILABLE", "blob is not a single-link regular file")
        if st.st_size > max_bytes:
            raise CmfError("LIMIT", "blob exceeds read limit")
        if expected_len is not None and st.st_size != expected_len:
            raise CmfError("SOURCE_UNAVAILABLE", "blob length mismatch")
        chunks, total = [], 0
        while True:
            part = os.read(fd, 1 << 16)
            if not part:
                break
            total += len(part)
            if total > max_bytes:
                raise CmfError("LIMIT", "blob grew past read limit")
            chunks.append(part)
    finally:
        os.close(fd)
    data = b"".join(chunks)
    if hashlib.sha256(data).hexdigest() != sha:
        raise CmfError("SOURCE_UNAVAILABLE", "blob digest mismatch")
    return data


def put_text(root: Path, text: str) -> BlobRef:
    """Store already-redacted text durably (file + directory fsync).

    An existing intact blob is reused; a corrupt one is replaced atomically."""
    data = text.encode("utf-8")
    sha = hashlib.sha256(data).hexdigest()
    dfd = _open_dir(root, create=True)
    try:
        try:
            _read_verified(dfd, sha, max_bytes=len(data), expected_len=len(data))
            return BlobRef(sha, len(data), "REDACTED_TEXT")
        except CmfError:
            pass
        tmp = f".tmp-{secrets.token_hex(8)}"
        fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC,
                     0o600, dir_fd=dfd)
        try:
            view = memoryview(data)
            while view:
                view = view[os.write(fd, view):]
            os.fsync(fd)
        except BaseException:
            os.close(fd)
            os.unlink(tmp, dir_fd=dfd)
            raise
        os.close(fd)
        try:
            os.rename(tmp, f"{sha}.txt", src_dir_fd=dfd, dst_dir_fd=dfd)
        except BaseException:
            os.unlink(tmp, dir_fd=dfd)
            raise
        os.fsync(dfd)
    finally:
        os.close(dfd)
    return BlobRef(sha, len(data), "REDACTED_TEXT")


def read_text(root: Path, ref: BlobRef, *, max_bytes: int) -> str:
    dfd = _open_dir(root, create=False)
    try:
        data = _read_verified(dfd, _check_hex(ref.sha256), max_bytes=max_bytes,
                              expected_len=ref.byte_len)
    finally:
        os.close(dfd)
    return data.decode("utf-8")


def resolve_ds4_blob(root: Path, blob_id: str, *, max_bytes: int) -> tuple[BlobRef, str]:
    """Verify and read a DS4 context blob (id 'sha256:<hex>', ds4_context_blob.h).

    Read-only: nothing under the DS4 root is created or modified.  Content
    that is not valid UTF-8 is refused rather than lossily decoded."""
    if not isinstance(blob_id, str) or not DS4_BLOB_ID.fullmatch(blob_id):
        raise CmfError("SCHEMA", "bad ds4 blob id")
    sha = blob_id.split(":", 1)[1]
    dfd = _open_dir(root, create=False)
    try:
        data = _read_verified(dfd, sha, max_bytes=max_bytes, expected_len=None)
    finally:
        os.close(dfd)
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError:
        raise CmfError("SOURCE_UNAVAILABLE", "ds4 blob is not UTF-8") from None
    return BlobRef(sha, len(data), "DS4_CONTEXT_BLOB", root_id=blob_id), text


def source_ok(root: Path, ref: BlobRef) -> bool:
    """Search-hit source check: present, regular, single link, length and
    digest verified (same checks as source.read, without returning content)."""
    try:
        dfd = _open_dir(root, create=False)
    except (CmfError, OSError):
        return False
    try:
        _read_verified(dfd, _check_hex(ref.sha256), max_bytes=ref.byte_len,
                       expected_len=ref.byte_len)
        return True
    except (CmfError, OSError):
        return False
    finally:
        os.close(dfd)
