# Derived from DeepInfer (https://github.com/deepseek-ai/DeepInfer) commit 9bd9cf2,
# deepinfer/worker/decode_perf_cache.py, Apache-2.0. Modified for DS4-Studio.
"""Decode perf profile store, schema_version 1 (plan §3.1 refinement).

Differences from DeepInfer's DecodePerfCache: no torch.distributed broadcast
(DS4 is a single process), an identity that also covers backend, device,
quantization, context and MTP, a content digest, 0600 files in a 0700
directory, flock-serialised writers and a directory fsync after rename.
Each numeric measurement includes its positive ctx_tokens, bounded by the
identity's context_length and unique with num_sequences and draft_length.
Filenames order writes by nanoseconds; payload timestamps remain in seconds.
This refines the unpersisted v1 schema, so its version remains 1.
Only numeric measurements are accepted, so no prompt text can be stored.
"""

from __future__ import annotations

import contextlib
import fcntl
import hashlib
import json
import logging
import math
import os
import time
import uuid
from dataclasses import asdict, dataclass, field
from typing import Any

logger = logging.getLogger(__name__)

SCHEMA_VERSION = 1
DEFAULT_TTL_S = 7 * 24 * 3600
# Files expire for readers first and are deleted 2h later, so a concurrent
# reader never sees a file vanish halfway (same margin as DeepInfer).
STALE_GRACE_S = 2 * 3600
LOCK_NAME = ".lock"
NS_PER_S = 1_000_000_000

IDENTITY_FIELDS = (
    "model_sha256", "runtime_commit", "overlay_commit", "backend", "device_id",
    "quantization", "context_length", "kv_dtype", "mtp_max",
)
MEASUREMENT_FIELDS = ("num_sequences", "draft_length", "ctx_tokens", "p50_ms", "p95_ms", "samples")


@dataclass(frozen=True)
class PerfIdentity:
    model_sha256: str
    runtime_commit: str
    overlay_commit: str
    backend: str
    device_id: str
    quantization: str
    context_length: int
    kv_dtype: str
    mtp_max: int
    config_label: str = ""
    extra: dict[str, Any] = field(default_factory=dict)

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> PerfIdentity:
        missing = [k for k in IDENTITY_FIELDS if k not in d]
        if missing:
            raise ValueError(f"identity missing fields: {missing}")
        unknown = set(d) - set(IDENTITY_FIELDS) - {"config_label", "extra"}
        if unknown:
            raise ValueError(f"identity unknown fields: {sorted(unknown)}")
        ident = cls(**d)
        for k in ("context_length", "mtp_max"):
            v = getattr(ident, k)
            if not isinstance(v, int) or isinstance(v, bool) or v < 0:
                raise ValueError(f"identity {k} must be a non-negative integer")
        if not isinstance(ident.extra, dict):
            raise ValueError("identity extra must be an object")
        return ident

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    def key(self) -> str:
        return hashlib.sha256(canonical_json(self.to_dict()).encode()).hexdigest()


def canonical_json(obj: Any) -> str:
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), allow_nan=False)


def _digest(payload: dict[str, Any]) -> str:
    return hashlib.sha256(canonical_json(payload).encode()).hexdigest()


def _is_hex(s: str, length: int) -> bool:
    return len(s) == length and all(c in "0123456789abcdef" for c in s)


def _is_int(v: Any) -> bool:
    return isinstance(v, int) and not isinstance(v, bool)


def validate_measurement(m: Any) -> dict[str, Any]:
    if not isinstance(m, dict) or set(m) != set(MEASUREMENT_FIELDS):
        raise ValueError(f"measurement must have exactly {MEASUREMENT_FIELDS}")
    for k in ("num_sequences", "draft_length", "ctx_tokens", "samples"):
        if not _is_int(m[k]) or m[k] < 0:
            raise ValueError(f"{k} must be a non-negative integer")
    if m["samples"] == 0 or m["num_sequences"] == 0 or m["ctx_tokens"] == 0:
        raise ValueError("samples, num_sequences and ctx_tokens must be > 0")
    p50, p95 = m["p50_ms"], m["p95_ms"]
    for v in (p50, p95):
        if not isinstance(v, (int, float)) or isinstance(v, bool) or not math.isfinite(v) or v < 0:
            raise ValueError("p50_ms/p95_ms must be finite and >= 0")
    if p50 > p95:
        raise ValueError("p50_ms > p95_ms")
    return {**m, "p50_ms": float(p50), "p95_ms": float(p95)}


def parse_filename(filename: str) -> tuple[str, int, bool] | None:
    """`<sha256>.<uuid4 hex>.<unix ns, at least 19 digits>[.tmp]`, else None.

    Returns (key, timestamp_ns, is_tmp); legacy seconds-only names are dirty.
    """
    parts = filename.split(".")
    is_tmp = len(parts) == 4 and parts[-1] == "tmp"
    if is_tmp:
        parts = parts[:-1]
    if len(parts) != 3:
        return None
    key, file_uuid, ts = parts
    if not _is_hex(key, 64) or not _is_hex(file_uuid, 32) or len(ts) < 19 or not ts.isdigit():
        return None
    return key, int(ts), is_tmp


class PerfProfileStore:
    def __init__(self, directory: str, ttl_s: int = DEFAULT_TTL_S) -> None:
        if ttl_s <= 0:
            raise ValueError("ttl_s must be > 0")
        self.directory = directory
        self.ttl_s = ttl_s

    def _ensure_dir(self) -> None:
        os.makedirs(self.directory, mode=0o700, exist_ok=True)
        os.chmod(self.directory, 0o700)

    @contextlib.contextmanager
    def _locked(self):
        fd = os.open(os.path.join(self.directory, LOCK_NAME), os.O_RDWR | os.O_CREAT, 0o600)
        try:
            fcntl.flock(fd, fcntl.LOCK_EX)
            yield
        finally:
            os.close(fd)  # closing releases the flock

    def cleanup(self, now_s: int | None = None) -> None:
        """Remove stale profiles and dirty files. A `.tmp` is removed only once
        it is stale, so a writer that is mid-write is never disturbed."""
        now_s = int(time.time()) if now_s is None else now_s
        try:
            names = os.listdir(self.directory)
        except OSError as e:
            logger.warning("perf profile: cannot list %s: %s", self.directory, e)
            return
        for name in names:
            if name == LOCK_NAME:
                continue
            parsed = parse_filename(name)
            if parsed is not None and now_s - parsed[1] // NS_PER_S <= self.ttl_s + STALE_GRACE_S:
                continue
            path = os.path.join(self.directory, name)
            try:
                if os.path.isfile(path):
                    os.remove(path)
            except OSError as e:
                logger.warning("perf profile: cannot remove %s: %s", path, e)

    def write(self, identity: PerfIdentity, measurements: list[dict[str, Any]],
              now_s: int | None = None) -> str:
        if not measurements:
            raise ValueError("at least one measurement is required")
        clean = [validate_measurement(m) for m in measurements]
        seen = set()
        for m in clean:
            if m["ctx_tokens"] > identity.context_length:
                raise ValueError(f"ctx_tokens {m['ctx_tokens']} exceeds identity context_length {identity.context_length}")
            measurement_key = (m["num_sequences"], m["draft_length"], m["ctx_tokens"])
            if measurement_key in seen:
                raise ValueError(f"duplicate (num_sequences, draft_length, ctx_tokens) key: {measurement_key}")
            seen.add(measurement_key)
        now_ns = time.time_ns() if now_s is None else now_s * NS_PER_S
        now_s = now_ns // NS_PER_S
        body = {
            "schema_version": SCHEMA_VERSION,
            "identity": identity.to_dict(),
            "created_at_unix": now_s,
            "measurements": clean,
        }
        payload = {**body, "digest": _digest(body)}
        data = (canonical_json(payload) + "\n").encode()

        self._ensure_dir()
        key = identity.key()
        with self._locked():
            # Persist the tie-break under flock so separate writers and frozen
            # clocks still order writes in the same second by publication order.
            for existing in os.listdir(self.directory):
                parsed = parse_filename(existing)
                if parsed is not None and parsed[0] == key and parsed[1] // NS_PER_S == now_s:
                    now_ns = max(now_ns, parsed[1] + 1)
            name = f"{key}.{uuid.uuid4().hex}.{now_ns:019d}"
            tmp = os.path.join(self.directory, name + ".tmp")
            final = os.path.join(self.directory, name)
            fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            try:
                with os.fdopen(fd, "wb") as f:
                    f.write(data)
                    f.flush()
                    os.fsync(f.fileno())
                os.replace(tmp, final)
            except BaseException:
                with contextlib.suppress(OSError):
                    os.remove(tmp)
                raise
            dfd = os.open(self.directory, os.O_RDONLY)
            try:
                os.fsync(dfd)
            finally:
                os.close(dfd)
        return final

    def _load(self, path: str, identity: PerfIdentity) -> dict[str, Any]:
        with open(path, encoding="utf-8") as f:
            obj = json.load(f)
        if not isinstance(obj, dict) or obj.get("schema_version") != SCHEMA_VERSION:
            raise ValueError("schema_version mismatch")
        if set(obj) != {"schema_version", "identity", "created_at_unix", "measurements", "digest"}:
            raise ValueError("unexpected top-level fields")
        body = {k: v for k, v in obj.items() if k != "digest"}
        if obj["digest"] != _digest(body):
            raise ValueError("digest mismatch")
        if obj["identity"] != identity.to_dict():
            raise ValueError("identity mismatch")
        if not isinstance(obj["measurements"], list) or not obj["measurements"]:
            raise ValueError("no measurements")
        obj["measurements"] = [validate_measurement(m) for m in obj["measurements"]]
        return obj

    def read(self, identity: PerfIdentity, now_s: int | None = None) -> dict[str, Any] | None:
        """Newest valid, unexpired profile for `identity`; never raises on bad files."""
        now_s = int(time.time()) if now_s is None else now_s
        key = identity.key()
        try:
            names = os.listdir(self.directory)
        except OSError:
            return None
        candidates = []
        for name in names:
            parsed = parse_filename(name)
            if parsed is None:
                continue
            file_key, ts, is_tmp = parsed
            if is_tmp or file_key != key or now_s - ts // NS_PER_S > self.ttl_s:
                continue
            candidates.append((ts, name))
        for _, name in sorted(candidates, reverse=True):
            path = os.path.join(self.directory, name)
            try:
                return self._load(path, identity)
            except (OSError, ValueError, TypeError, KeyError) as e:
                logger.warning("perf profile: skipping %s: %s", path, e)
        return None
