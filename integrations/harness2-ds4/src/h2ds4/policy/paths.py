"""Path hardening (plan §8 T02, §19.1, §26.4).

Logical-name validation plus dirfd/O_NOFOLLOW file operations. Logical validation alone
never authorises a write: every materialisation goes through `write_tree_nofollow`.
"""

from __future__ import annotations

import os
import stat
import unicodedata
from pathlib import Path, PurePosixPath


class PathDenied(ValueError):
    pass


def validate_relpath(name: str, *, max_len: int = 180, max_part: int = 100) -> str:
    if not isinstance(name, str) or not name:
        raise PathDenied('empty path')
    if '\\' in name or '\x00' in name or name.startswith('/'):
        raise PathDenied('unsafe separators')
    if name != name.strip() or any(p != p.strip() for p in name.split('/')):
        raise PathDenied('ambiguous whitespace')
    if any(ord(c) < 0x20 or ord(c) == 0x7f for c in name):
        raise PathDenied('control characters')
    if unicodedata.normalize('NFC', name) != name:
        raise PathDenied('path not NFC-normalised')
    parts = name.split('/')
    if any(p in ('', '.', '..') for p in parts) or str(PurePosixPath(name)) != name:
        raise PathDenied('path not canonical')
    if len(name) > max_len or any(len(p) > max_part for p in parts):
        raise PathDenied('path too long')
    return name


def assert_no_casefold_collisions(names: list[str]) -> None:
    seen: dict[str, str] = {}
    for n in names:
        key = unicodedata.normalize('NFC', n).casefold()
        if key in seen and seen[key] != n:
            raise PathDenied('case/NFC collision between paths')
        if key in seen:
            raise PathDenied('duplicate path')
        seen[key] = n


def _open_dir_nofollow(parent_fd: int, name: str, *, create: bool) -> int:
    if create:
        try:
            os.mkdir(name, 0o700, dir_fd=parent_fd)
        except FileExistsError:
            pass
    fd = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent_fd)
    st = os.fstat(fd)
    if not stat.S_ISDIR(st.st_mode) or st.st_uid != os.getuid():
        os.close(fd)
        raise PathDenied('directory ownership/type invalid')
    return fd


def write_tree_nofollow(root: Path, tree: dict[str, bytes], *, mode: int = 0o600) -> None:
    """Create every file with O_EXCL|O_NOFOLLOW relative to dirfds; `root` must be a
    private empty directory owned by us. Symlinks anywhere on the path make it fail."""
    root_fd = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        st = os.fstat(root_fd)
        if st.st_uid != os.getuid() or stat.S_IMODE(st.st_mode) & 0o077:
            raise PathDenied('staging root must be private (0700) and owned by us')
        for rel, data in sorted(tree.items()):
            validate_relpath(rel)
            parts = rel.split('/')
            fds = [root_fd]
            try:
                for comp in parts[:-1]:
                    fds.append(_open_dir_nofollow(fds[-1], comp, create=True))
                fd = os.open(parts[-1], os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                             mode, dir_fd=fds[-1])
                with os.fdopen(fd, 'wb') as f:
                    f.write(data)
                    f.flush()
                    os.fsync(f.fileno())
                os.fsync(fds[-1])
            finally:
                for d in fds[1:]:
                    os.close(d)
    finally:
        os.close(root_fd)


def read_tree_nofollow(root: Path, *, max_files: int, max_bytes: int) -> dict[str, bytes]:
    """Read a tree refusing symlinks, hardlinks, devices and anything non-regular."""
    out: dict[str, bytes] = {}
    total = 0
    root_fd = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)

    def walk(dir_fd: int, prefix: str) -> None:
        nonlocal total
        for entry in sorted(os.listdir(dir_fd)):
            rel = f'{prefix}{entry}'
            st = os.stat(entry, dir_fd=dir_fd, follow_symlinks=False)
            if stat.S_ISDIR(st.st_mode):
                sub = os.open(entry, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=dir_fd)
                try:
                    walk(sub, rel + '/')
                finally:
                    os.close(sub)
                continue
            if not stat.S_ISREG(st.st_mode):
                raise PathDenied('non-regular file in tree')
            if st.st_nlink != 1:
                raise PathDenied('hardlinked file in tree')
            validate_relpath(rel)
            fd = os.open(entry, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=dir_fd)
            with os.fdopen(fd, 'rb') as f:
                data = f.read(max_bytes - total + 1)
            total += len(data)
            if total > max_bytes:
                raise PathDenied('tree too large')
            out[rel] = data
            if len(out) > max_files:
                raise PathDenied('too many files')

    try:
        walk(root_fd, '')
    finally:
        os.close(root_fd)
    return out


def ensure_private_dir(path: Path) -> Path:
    """Create (0700) or verify an owned private directory; refuse symlinks."""
    if not path.is_absolute():
        raise PathDenied('absolute directory required')
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    try:
        os.mkdir(path, 0o700)
    except FileExistsError:
        pass
    st = path.lstat()
    if not stat.S_ISDIR(st.st_mode) or st.st_uid != os.getuid():
        raise PathDenied('invalid directory ownership/type')
    if stat.S_IMODE(st.st_mode) != 0o700:
        raise PathDenied('directory must be mode 0700')
    return path


def is_within(child: Path, parent: Path) -> bool:
    try:
        Path(os.path.realpath(child)).relative_to(os.path.realpath(parent))
        return True
    except ValueError:
        return False
