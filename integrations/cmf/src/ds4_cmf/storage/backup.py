"""Online snapshot and verified restore (plan §29.7, §36 M1-06).

snapshot: SQLite online backup API (consistent even with a live writer),
then the blobs that copy references, the idempotency key, and a manifest
whose high-water mark comes from the copy.  Built in a sibling '.partial'
directory and published with one rename.  restore: verifies everything
before writing, writes into a new directory only, publishes with a rename.
Manifest metadata is capped at 16 MiB; file copying uses 128 KiB buffers.
Linux renameat2 prevents even a racing empty destination from being replaced.
"""

from __future__ import annotations

import ctypes
import errno
import hashlib
import json
import os
import secrets
import shutil
import sqlite3
import stat
from pathlib import Path

from ..api.errors import CmfError
from ..config import Settings
from ..domain.events import BlobRef, check_id, normalize_utc, utc_now
from ..domain.identity import Principal
from . import blobs, migrations
from .eventlog import Context

MANIFEST_VERSION = 1
_TOP_LEVEL = {"manifest.json", "cmf.sqlite", "blobs", "keys"}
MAX_MANIFEST_BYTES = 16 * 1024 * 1024
COPY_CHUNK_BYTES = 128 * 1024
_DIR_FLAGS = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC


def _open_directory(path: Path) -> int:
    """Walk each component without following a symlink; return an owned fd."""
    fd = os.open("/" if path.is_absolute() else ".", _DIR_FLAGS)
    try:
        for component in path.parts:
            if component in ("/", "."):
                continue
            if component == "..":
                raise CmfError("SCHEMA", "parent traversal is not allowed")
            child = os.open(component, _DIR_FLAGS, dir_fd=fd)
            os.close(fd)
            fd = child
        return fd
    except BaseException:
        os.close(fd)
        raise


def _open_entry(root_fd: int, path: Path, *, directory: bool = False) -> int:
    if path.is_absolute() or not path.parts or ".." in path.parts:
        raise CmfError("SCHEMA", "invalid snapshot entry")
    parent = os.dup(root_fd)
    try:
        for component in path.parts[:-1]:
            child = os.open(component, _DIR_FLAGS, dir_fd=parent)
            os.close(parent)
            parent = child
        flags = _DIR_FLAGS if directory else os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC | os.O_NONBLOCK
        fd = os.open(path.name, flags, dir_fd=parent)
        if not directory:
            try:
                info = os.fstat(fd)
                if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
                    raise CmfError("SOURCE_UNAVAILABLE", "snapshot entry is not a single-link regular file")
            except BaseException:
                os.close(fd)
                raise
        return fd
    finally:
        os.close(parent)


def _check_entries(directory_fd: int, expected: set[str]) -> None:
    # An untrusted directory may contain millions of unlisted files. Reject
    # its first unexpected entry without materializing the entire listing.
    count = 0
    with os.scandir(directory_fd) as entries:
        for entry in entries:
            if entry.name not in expected:
                raise CmfError("SCHEMA", "unexpected snapshot layout")
            count += 1
    if count != len(expected):
        raise CmfError("SCHEMA", "unexpected snapshot layout")


def _read_small(root_fd: int, path: Path, max_bytes: int) -> bytes:
    fd = _open_entry(root_fd, path)
    try:
        if os.fstat(fd).st_size > max_bytes:
            raise CmfError("LIMIT", "snapshot entry exceeds its limit")
        result = bytearray()
        while chunk := os.read(fd, min(COPY_CHUNK_BYTES, max_bytes - len(result) + 1)):
            result.extend(chunk)
            if len(result) > max_bytes:
                raise CmfError("LIMIT", "snapshot entry exceeds its limit")
        return bytes(result)
    finally:
        os.close(fd)


def _stream_verified(path: Path, sha: str, byte_len: int, *, root_fd: int,
                     output_fd: int | None = None) -> None:
    fd = _open_entry(root_fd, path)
    try:
        if os.fstat(fd).st_size != byte_len:
            raise CmfError("SOURCE_UNAVAILABLE", "snapshot length mismatch")
        digest, total = hashlib.sha256(), 0
        while chunk := os.read(fd, min(COPY_CHUNK_BYTES, byte_len - total + 1)):
            total += len(chunk)
            if total > byte_len:
                raise CmfError("SOURCE_UNAVAILABLE", "snapshot entry grew while reading")
            digest.update(chunk)
            if output_fd is not None:
                view = memoryview(chunk)
                while view:
                    count = os.write(output_fd, view)
                    if count <= 0:
                        raise OSError(errno.EIO, "snapshot write failed")
                    view = view[count:]
        if total != byte_len or digest.hexdigest() != sha:
            raise CmfError("SOURCE_UNAVAILABLE", "snapshot checksum or length mismatch")
    finally:
        os.close(fd)


def _copy_verified(root_fd: int, source: Path, target: Path, sha: str, byte_len: int) -> None:
    parent = _open_directory(target.parent)
    try:
        fd = os.open(target.name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                     0o600, dir_fd=parent)
    finally:
        os.close(parent)
    try:
        _stream_verified(source, sha, byte_len, root_fd=root_fd, output_fd=fd)
        os.fsync(fd)
    finally:
        os.close(fd)


def _publish(tmp: Path, destination: Path) -> None:
    """Linux atomic publish with no replacement, including a racing empty dir."""
    parent = _open_directory(destination.parent)
    try:
        libc = ctypes.CDLL(None, use_errno=True)
        rename = getattr(libc, "renameat2", None)
        if rename is None:
            raise CmfError("DEGRADED", "atomic no-replace rename is unavailable")
        rename.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]
        rename.restype = ctypes.c_int
        if rename(parent, os.fsencode(tmp.name), parent, os.fsencode(destination.name), 1):
            error = ctypes.get_errno()
            if error == errno.EEXIST:
                raise CmfError("SCHEMA", "destination already exists")
            raise OSError(error, "snapshot publish failed")
        os.fsync(parent)
    finally:
        os.close(parent)


def _sha256_file(path: Path) -> tuple[str, int]:
    h, n = hashlib.sha256(), 0
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
            n += len(chunk)
    return h.hexdigest(), n


def _fsync_dir(path: Path) -> None:
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def _write_file(path: Path, data: bytes) -> None:
    parent = _open_directory(path.parent)
    try:
        fd = os.open(path.name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                     0o600, dir_fd=parent)
    finally:
        os.close(parent)
    try:
        view = memoryview(data)
        while view:
            count = os.write(fd, view)
            if count <= 0:
                raise OSError(errno.EIO, "snapshot write failed")
            view = view[count:]
        os.fsync(fd)
    finally:
        os.close(fd)


def _fresh_destination(destination: Path) -> Path:
    parent = destination.parent
    fd = _open_directory(parent)
    try:
        try:
            os.stat(destination.name, dir_fd=fd, follow_symlinks=False)
        except FileNotFoundError:
            pass
        else:
            raise CmfError("SCHEMA", "destination already exists")
        name = f".{destination.name}.partial-{secrets.token_hex(6)}"
        os.mkdir(name, 0o700, dir_fd=fd)
        return parent / name
    finally:
        os.close(fd)


def snapshot(ctx: Context, owner: Principal, destination: Path) -> Path:
    if not owner.store_owner:
        raise CmfError("SCOPE")
    tmp = None
    try:
        tmp = _fresh_destination(destination)
        copy_path = tmp / "cmf.sqlite"
        out = sqlite3.connect(copy_path)
        try:
            ctx.db.backup(out)
            out.execute("PRAGMA journal_mode = DELETE")
            if out.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
                raise CmfError("DEGRADED", "snapshot copy failed integrity check")
            high_water = out.execute("SELECT COALESCE(MAX(seq),0) FROM events").fetchone()[0]
            # The manifest itself is bounded, as are the metadata lists used to
            # construct it. Refuse a larger backup rather than exhausting RAM.
            refs, ds4, metadata_bytes = [], [], 0
            for sha, byte_len in out.execute("SELECT blob_sha256, byte_len FROM source_blobs ORDER BY 1"):
                entry = {"sha256": sha, "byte_len": byte_len}
                metadata_bytes += len(json.dumps(entry))
                if metadata_bytes > MAX_MANIFEST_BYTES:
                    raise CmfError("LIMIT", "snapshot manifest exceeds its limit")
                refs.append(entry)
            for p, b, s, n in out.execute(
                    "SELECT DISTINCT project_id, ds4_blob_id, ds4_blob_sha256, ds4_byte_len "
                    "FROM events WHERE ds4_blob_id IS NOT NULL ORDER BY 1, 2"):
                entry = {"project_id": p, "blob_id": b, "sha256": s, "byte_len": n}
                metadata_bytes += len(json.dumps(entry))
                if metadata_bytes > MAX_MANIFEST_BYTES:
                    raise CmfError("LIMIT", "snapshot manifest exceeds its limit")
                ds4.append(entry)
            schema = migrations.check_current(out)
        finally:
            out.close()
        os.chmod(copy_path, 0o600)
        fd = os.open(copy_path, os.O_RDONLY | os.O_NOFOLLOW)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)
        os.makedirs(tmp / "blobs" / "sha256", mode=0o700)
        for entry in refs:
            sha, byte_len = entry["sha256"], entry["byte_len"]
            text = blobs.read_text(ctx.blob_root, BlobRef(sha, byte_len, "REDACTED_TEXT"),
                                   max_bytes=ctx.settings.limits.max_text_bytes)
            _write_file(tmp / "blobs" / "sha256" / f"{sha}.txt", text.encode("utf-8"))
        _fsync_dir(tmp / "blobs" / "sha256")
        _fsync_dir(tmp / "blobs")
        os.mkdir(tmp / "keys", 0o700)
        if len(ctx.idem_key) != 32:
            raise CmfError("SOURCE_UNAVAILABLE", "idempotency key length mismatch")
        _write_file(tmp / "keys" / "idempotency.key", ctx.idem_key)
        _fsync_dir(tmp / "keys")
        db_sha, db_len = _sha256_file(copy_path)
        manifest = {
            "manifest_version": MANIFEST_VERSION,
            "created_at": utc_now(),
            "schema_version": schema,
            "high_water_seq": high_water,
            "database": {"path": "cmf.sqlite", "sha256": db_sha, "byte_len": db_len},
            "blobs": refs,
            "key": {"path": "keys/idempotency.key",
                    "sha256": hashlib.sha256(ctx.idem_key).hexdigest()},
            # Raw DS4 sources are referenced, not exported: restore needs them.
            "portable": not ds4,
            "ds4_dependencies": ds4,
        }
        encoded = json.dumps(manifest, indent=2, sort_keys=True).encode("utf-8")
        if len(encoded) > MAX_MANIFEST_BYTES:
            raise CmfError("LIMIT", "snapshot manifest exceeds its limit")
        _write_file(tmp / "manifest.json", encoded)
        _fsync_dir(tmp)
        _publish(tmp, destination)
    except BaseException as exc:
        if tmp is not None:
            shutil.rmtree(tmp, ignore_errors=True)
        if isinstance(exc, (OSError, sqlite3.Error)):
            raise CmfError("DEGRADED", "snapshot operation failed") from None
        raise
    return destination


def _load_manifest(snapshot_dir: Path, *, root_fd: int | None = None) -> dict:
    def object_fields(value, fields):
        if not isinstance(value, dict) or set(value) != set(fields):
            raise CmfError("SCHEMA", "invalid manifest object")

    def integer(value, minimum=0):
        if type(value) is not int or value < minimum:
            raise CmfError("SCHEMA", "invalid manifest integer")

    def digest(value):
        if not isinstance(value, str):
            raise CmfError("SCHEMA", "invalid manifest digest")
        blobs._check_hex(value)

    def pairs(items):
        value = {}
        for key, item in items:
            if key in value:
                raise CmfError("SCHEMA", "duplicate manifest key")
            value[key] = item
        return value

    fd = root_fd if root_fd is not None else _open_directory(snapshot_dir)
    try:
        _check_entries(fd, _TOP_LEVEL)
        try:
            m = json.loads(_read_small(fd, Path("manifest.json"), MAX_MANIFEST_BYTES).decode("utf-8"),
                           object_pairs_hook=pairs)
        except (ValueError, RecursionError):
            raise CmfError("SCHEMA", "unreadable manifest") from None
    finally:
        if root_fd is None:
            os.close(fd)
    object_fields(m, {"manifest_version", "created_at", "schema_version", "high_water_seq",
                      "database", "blobs", "key", "portable", "ds4_dependencies"})
    integer(m["manifest_version"], 1)
    if m["manifest_version"] != MANIFEST_VERSION:
        raise CmfError("VERSION_CONFLICT", "manifest version")
    integer(m["schema_version"], 1)
    integer(m["high_water_seq"])
    normalize_utc(m["created_at"])
    object_fields(m["database"], {"path", "sha256", "byte_len"})
    object_fields(m["key"], {"path", "sha256"})
    if m["database"]["path"] != "cmf.sqlite" or m["key"]["path"] != "keys/idempotency.key":
        raise CmfError("SCHEMA", "manifest paths")
    digest(m["database"]["sha256"])
    digest(m["key"]["sha256"])
    integer(m["database"]["byte_len"])
    if not isinstance(m["blobs"], list) or not isinstance(m["ds4_dependencies"], list):
        raise CmfError("SCHEMA", "invalid manifest lists")
    seen = set()
    for entry in m["blobs"]:
        object_fields(entry, {"sha256", "byte_len"})
        digest(entry["sha256"])
        integer(entry["byte_len"])
        if entry["sha256"] in seen:
            raise CmfError("SCHEMA", "duplicate manifest blob")
        seen.add(entry["sha256"])
    seen.clear()
    for dep in m["ds4_dependencies"]:
        object_fields(dep, {"project_id", "blob_id", "sha256", "byte_len"})
        check_id(dep["project_id"], field="project_id")
        digest(dep["sha256"])
        integer(dep["byte_len"])
        identity = (dep["project_id"], dep["blob_id"])
        if dep["blob_id"] != f"sha256:{dep['sha256']}" or identity in seen:
            raise CmfError("SCHEMA", "invalid or duplicate DS4 dependency")
        seen.add(identity)
    if type(m["portable"]) is not bool or m["portable"] != (not m["ds4_dependencies"]):
        raise CmfError("SCHEMA", "manifest portability mismatch")
    return m


def _verify_regular(path: Path, sha: str, byte_len: int, *, root_fd: int | None = None) -> None:
    fd = root_fd if root_fd is not None else _open_directory(path.parent)
    try:
        _stream_verified(path if root_fd is not None else Path(path.name), sha, byte_len, root_fd=fd)
    finally:
        if root_fd is None:
            os.close(fd)


def _validate_database(root_fd: int, manifest: dict, listed_refs: set[tuple[str, int]]) -> int:
    db_fd = _open_entry(root_fd, Path("cmf.sqlite"))
    try:
        # /proc/self/fd pins the opened, non-symlink inode. Immutable mode
        # prevents SQLite from looking for attacker-controlled WAL files.
        db = sqlite3.connect(f"file:/proc/self/fd/{db_fd}?mode=ro&immutable=1", uri=True)
        try:
            db.execute("PRAGMA query_only=ON")
            if migrations.check_current(db) != manifest["schema_version"]:
                raise CmfError("VERSION_CONFLICT", "snapshot schema mismatch")
            if db.execute("PRAGMA integrity_check").fetchone()[0] != "ok" or \
                    db.execute("PRAGMA foreign_key_check").fetchone() is not None:
                raise CmfError("DEGRADED", "snapshot database failed integrity check")
            hw = db.execute("SELECT COALESCE(MAX(seq),0) FROM events").fetchone()[0]
            if hw != manifest["high_water_seq"]:
                raise CmfError("SOURCE_UNAVAILABLE", "high-water mismatch")
            count = 0
            for row in db.execute("SELECT blob_sha256, byte_len FROM source_blobs"):
                if row not in listed_refs:
                    raise CmfError("SOURCE_UNAVAILABLE", "snapshot blobs differ from database references")
                count += 1
            if count != len(listed_refs):
                raise CmfError("SOURCE_UNAVAILABLE", "snapshot blobs differ from database references")
            declared = {(d["project_id"], d["blob_id"], d["sha256"], d["byte_len"])
                        for d in manifest["ds4_dependencies"]}
            count = 0
            for row in db.execute("SELECT DISTINCT project_id, ds4_blob_id, ds4_blob_sha256, ds4_byte_len "
                                  "FROM events WHERE ds4_blob_id IS NOT NULL"):
                if row not in declared:
                    raise CmfError("SOURCE_UNAVAILABLE", "DS4 dependencies differ from database references")
                count += 1
            if count != len(declared):
                raise CmfError("SOURCE_UNAVAILABLE", "DS4 dependencies differ from database references")
            return hw
        finally:
            db.close()
    finally:
        os.close(db_fd)


def restore(snapshot_dir: Path, destination: Path, *, settings: Settings,
            owner: Principal, dry_run: bool = False) -> dict:
    if not owner.store_owner:
        raise CmfError("SCOPE")
    root_fd, tmp = None, None
    try:
        root_fd = _open_directory(snapshot_dir)
        m = _load_manifest(snapshot_dir, root_fd=root_fd)
        _verify_regular(Path("cmf.sqlite"), m["database"]["sha256"], m["database"]["byte_len"], root_fd=root_fd)
        key = _read_small(root_fd, Path("keys/idempotency.key"), 32)
        if len(key) != 32 or hashlib.sha256(key).hexdigest() != m["key"]["sha256"]:
            raise CmfError("SOURCE_UNAVAILABLE", "snapshot key mismatch")
        listed_refs = {(e["sha256"], e["byte_len"]) for e in m["blobs"]}
        expected_dirs = [("keys", {"idempotency.key"}), ("blobs", {"sha256"}),
                         ("blobs/sha256", {f"{sha}.txt" for sha, _ in listed_refs})]
        for name, expected in expected_dirs:
            fd = _open_entry(root_fd, Path(name), directory=True)
            try:
                _check_entries(fd, expected)
            finally:
                os.close(fd)
        for sha, length in listed_refs:
            _verify_regular(Path("blobs/sha256") / f"{sha}.txt", sha, length, root_fd=root_fd)

        hw = _validate_database(root_fd, m, listed_refs)
        for dep in m["ds4_dependencies"]:
            root = settings.ds4_root_for(dep["project_id"])
            if root is None:
                raise CmfError("SOURCE_UNAVAILABLE", "DS4 dependency has no configured root")
            ref, _ = blobs.resolve_ds4_blob(root, dep["blob_id"], max_bytes=settings.limits.max_ds4_bytes)
            if (ref.sha256, ref.byte_len) != (dep["sha256"], dep["byte_len"]):
                raise CmfError("SOURCE_UNAVAILABLE", "DS4 dependency changed")
        report = {"high_water_seq": hw, "blobs": len(listed_refs), "portable": m["portable"], "dry_run": dry_run}
        if dry_run:
            parent = _open_directory(destination.parent)
            try:
                try:
                    os.stat(destination.name, dir_fd=parent, follow_symlinks=False)
                except FileNotFoundError:
                    return report
                raise CmfError("SCHEMA", "destination already exists")
            finally:
                os.close(parent)
        tmp = _fresh_destination(destination)
        _copy_verified(root_fd, Path("cmf.sqlite"), tmp / "cmf.sqlite",
                       m["database"]["sha256"], m["database"]["byte_len"])
        copied_fd = _open_directory(tmp)
        try:
            # The source can change between its checksum and schema checks.
            # Validate the private bytes actually copied before publishing.
            _validate_database(copied_fd, m, listed_refs)
        finally:
            os.close(copied_fd)
        os.makedirs(tmp / "blobs" / "sha256", mode=0o700)
        for sha, length in sorted(listed_refs):
            source = Path("blobs/sha256") / f"{sha}.txt"
            _copy_verified(root_fd, source, tmp / source, sha, length)
        _fsync_dir(tmp / "blobs" / "sha256")
        _fsync_dir(tmp / "blobs")
        os.mkdir(tmp / "keys", 0o700)
        _write_file(tmp / "keys" / "idempotency.key", key)
        _fsync_dir(tmp / "keys")
        _fsync_dir(tmp)
        _publish(tmp, destination)
        return report
    except BaseException as exc:
        if tmp is not None:
            shutil.rmtree(tmp, ignore_errors=True)
        if isinstance(exc, (OSError, sqlite3.Error)):
            raise CmfError("SOURCE_UNAVAILABLE", "invalid or unavailable snapshot") from None
        if isinstance(exc, (ValueError, TypeError, KeyError, OverflowError, RecursionError)):
            raise CmfError("SCHEMA", "invalid snapshot") from None
        raise
    finally:
        if root_fd is not None:
            os.close(root_fd)
