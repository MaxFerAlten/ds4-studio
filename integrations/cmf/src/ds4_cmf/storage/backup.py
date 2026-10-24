"""Online snapshot and verified restore (plan §29.7, §36 M1-06).

snapshot: SQLite online backup API (consistent even with a live writer),
then the blobs that copy references, the idempotency key, and a manifest
whose high-water mark comes from the copy.  Built in a sibling '.partial'
directory and published with one rename.  restore: verifies everything
before writing, writes into a new directory only, publishes with a rename.
"""

from __future__ import annotations

import hashlib
import json
import os
import secrets
import shutil
import sqlite3
from pathlib import Path

from ..api.errors import CmfError
from ..config import Settings
from ..domain.events import BlobRef, utc_now
from ..domain.identity import Principal
from . import blobs
from .eventlog import Context

MANIFEST_VERSION = 1
_TOP_LEVEL = {"manifest.json", "cmf.sqlite", "blobs", "keys"}


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
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    try:
        view = memoryview(data)
        while view:
            view = view[os.write(fd, view):]
        os.fsync(fd)
    finally:
        os.close(fd)


def _fresh_destination(destination: Path) -> Path:
    if destination.exists() or destination.is_symlink():
        raise CmfError("SCHEMA", "destination already exists")
    parent = destination.parent
    if not parent.is_dir():
        raise CmfError("SCHEMA", "destination parent missing")
    tmp = parent / f".{destination.name}.partial-{secrets.token_hex(6)}"
    os.mkdir(tmp, 0o700)
    return tmp


def snapshot(ctx: Context, owner: Principal, destination: Path) -> Path:
    if not owner.store_owner:
        raise CmfError("SCOPE")
    tmp = _fresh_destination(destination)
    try:
        copy_path = tmp / "cmf.sqlite"
        out = sqlite3.connect(copy_path)
        try:
            ctx.db.backup(out)
            out.execute("PRAGMA journal_mode = DELETE")
            if out.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
                raise CmfError("DEGRADED", "snapshot copy failed integrity check")
            high_water = out.execute("SELECT COALESCE(MAX(seq),0) FROM events").fetchone()[0]
            refs = out.execute("SELECT blob_sha256, byte_len FROM source_blobs ORDER BY 1").fetchall()
            ds4 = out.execute("SELECT DISTINCT project_id, ds4_blob_id, ds4_blob_sha256, ds4_byte_len "
                              "FROM events WHERE ds4_blob_id IS NOT NULL ORDER BY 1, 2").fetchall()
            schema = out.execute("SELECT MAX(version) FROM schema_migrations").fetchone()[0]
        finally:
            out.close()
        os.chmod(copy_path, 0o600)
        os.makedirs(tmp / "blobs" / "sha256", mode=0o700)
        for sha, byte_len in refs:
            text = blobs.read_text(ctx.blob_root, BlobRef(sha, byte_len, "REDACTED_TEXT"),
                                   max_bytes=byte_len)
            _write_file(tmp / "blobs" / "sha256" / f"{sha}.txt", text.encode("utf-8"))
        _fsync_dir(tmp / "blobs" / "sha256")
        os.mkdir(tmp / "keys", 0o700)
        _write_file(tmp / "keys" / "idempotency.key", ctx.idem_key)
        db_sha, db_len = _sha256_file(copy_path)
        manifest = {
            "manifest_version": MANIFEST_VERSION,
            "created_at": utc_now(),
            "schema_version": schema,
            "high_water_seq": high_water,
            "database": {"path": "cmf.sqlite", "sha256": db_sha, "byte_len": db_len},
            "blobs": [{"sha256": s, "byte_len": n} for s, n in refs],
            "key": {"path": "keys/idempotency.key",
                    "sha256": hashlib.sha256(ctx.idem_key).hexdigest()},
            # Raw DS4 sources are referenced, not exported: restore needs them.
            "portable": not ds4,
            "ds4_dependencies": [{"project_id": p, "blob_id": b, "sha256": s, "byte_len": n}
                                 for p, b, s, n in ds4],
        }
        _write_file(tmp / "manifest.json",
                    json.dumps(manifest, indent=2, sort_keys=True).encode("utf-8"))
        _fsync_dir(tmp)
        os.rename(tmp, destination)
        _fsync_dir(destination.parent)
    except BaseException:
        shutil.rmtree(tmp, ignore_errors=True)
        raise
    return destination


def _load_manifest(snapshot_dir: Path) -> dict:
    if snapshot_dir.is_symlink() or not snapshot_dir.is_dir():
        raise CmfError("SCHEMA", "snapshot is not a directory")
    names = {p.name for p in snapshot_dir.iterdir()}
    if names - _TOP_LEVEL or not {"manifest.json", "cmf.sqlite"} <= names:
        raise CmfError("SCHEMA", "unexpected snapshot layout")
    try:
        m = json.loads((snapshot_dir / "manifest.json").read_text("utf-8"))
    except (OSError, ValueError):
        raise CmfError("SCHEMA", "unreadable manifest") from None
    if not isinstance(m, dict) or m.get("manifest_version") != MANIFEST_VERSION:
        raise CmfError("VERSION_CONFLICT", "manifest version")
    if (m.get("database") or {}).get("path") != "cmf.sqlite" or \
            (m.get("key") or {}).get("path") != "keys/idempotency.key":
        raise CmfError("SCHEMA", "manifest paths")
    return m


def _verify_regular(path: Path, sha: str, byte_len: int) -> None:
    if path.is_symlink() or not path.is_file():
        raise CmfError("SOURCE_UNAVAILABLE", "snapshot entry is not a regular file")
    got = _sha256_file(path)
    if got != (sha, byte_len):
        raise CmfError("SOURCE_UNAVAILABLE", "snapshot checksum or length mismatch")


def restore(snapshot_dir: Path, destination: Path, *, settings: Settings,
            owner: Principal, dry_run: bool = False) -> dict:
    if not owner.store_owner:
        raise CmfError("SCOPE")
    m = _load_manifest(snapshot_dir)
    _verify_regular(snapshot_dir / "cmf.sqlite", m["database"]["sha256"], m["database"]["byte_len"])
    key_path = snapshot_dir / "keys" / "idempotency.key"
    if key_path.is_symlink() or not key_path.is_file() or \
            hashlib.sha256(key_path.read_bytes()).hexdigest() != m["key"]["sha256"]:
        raise CmfError("SOURCE_UNAVAILABLE", "snapshot key mismatch")
    listed, listed_refs = set(), set()
    for entry in m.get("blobs", []):
        sha, n = entry.get("sha256"), entry.get("byte_len")
        if not isinstance(sha, str) or len(sha) != 64 or not isinstance(n, int):
            raise CmfError("SCHEMA", "manifest blob entry")
        blobs._check_hex(sha)
        _verify_regular(snapshot_dir / "blobs" / "sha256" / f"{sha}.txt", sha, n)
        listed.add(f"{sha}.txt")
        listed_refs.add((sha, n))
    blob_dir = snapshot_dir / "blobs" / "sha256"
    present = {p.name for p in blob_dir.iterdir()} if blob_dir.is_dir() else set()
    if present != listed:
        raise CmfError("SCHEMA", "snapshot blobs differ from manifest")
    for dep in m.get("ds4_dependencies", []):
        root = settings.ds4_root_for(str(dep.get("project_id")))
        if root is None:
            raise CmfError("SOURCE_UNAVAILABLE", "DS4 dependency has no configured root")
        ref, _ = blobs.resolve_ds4_blob(root, dep.get("blob_id"), max_bytes=settings.limits.max_ds4_bytes)
        if (ref.sha256, ref.byte_len) != (dep.get("sha256"), dep.get("byte_len")):
            raise CmfError("SOURCE_UNAVAILABLE", "DS4 dependency changed")
    db = sqlite3.connect(f"file:{snapshot_dir / 'cmf.sqlite'}?mode=ro", uri=True)
    try:
        if db.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
            raise CmfError("DEGRADED", "snapshot database failed integrity check")
        hw = db.execute("SELECT COALESCE(MAX(seq),0) FROM events").fetchone()[0]
        # The manifest is not trusted on its own: what the database references
        # must be exactly what the snapshot carries and declares.
        refs = set(db.execute("SELECT blob_sha256, byte_len FROM source_blobs").fetchall())
        deps = set(db.execute("SELECT DISTINCT project_id, ds4_blob_id, ds4_blob_sha256, ds4_byte_len "
                              "FROM events WHERE ds4_blob_id IS NOT NULL").fetchall())
    finally:
        db.close()
    if hw != m.get("high_water_seq"):
        raise CmfError("SOURCE_UNAVAILABLE", "high-water mismatch")
    if refs != listed_refs:
        raise CmfError("SOURCE_UNAVAILABLE", "snapshot blobs differ from database references")
    declared = {(d.get("project_id"), d.get("blob_id"), d.get("sha256"), d.get("byte_len"))
                for d in m.get("ds4_dependencies", [])}
    if deps != declared:
        raise CmfError("SOURCE_UNAVAILABLE", "DS4 dependencies differ from database references")
    report = {"high_water_seq": hw, "blobs": len(listed), "portable": m.get("portable"),
              "dry_run": dry_run}
    if dry_run:
        if destination.exists() or destination.is_symlink():
            raise CmfError("SCHEMA", "destination already exists")
        return report
    tmp = _fresh_destination(destination)
    try:
        _write_file(tmp / "cmf.sqlite", (snapshot_dir / "cmf.sqlite").read_bytes())
        os.makedirs(tmp / "blobs" / "sha256", mode=0o700)
        for name in sorted(listed):
            _write_file(tmp / "blobs" / "sha256" / name, (blob_dir / name).read_bytes())
        _fsync_dir(tmp / "blobs" / "sha256")
        os.mkdir(tmp / "keys", 0o700)
        _write_file(tmp / "keys" / "idempotency.key", key_path.read_bytes())
        _verify_regular(tmp / "cmf.sqlite", m["database"]["sha256"], m["database"]["byte_len"])
        _fsync_dir(tmp)
        os.rename(tmp, destination)
        _fsync_dir(destination.parent)
    except BaseException:
        shutil.rmtree(tmp, ignore_errors=True)
        raise
    return report
