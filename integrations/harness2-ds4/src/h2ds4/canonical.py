"""Canonical JSON and digests (plan §14.1): one encoding, one hash, everywhere."""

from __future__ import annotations

import hashlib
import json
import math
import re
from typing import Any

DIGEST_RE = re.compile(r'^sha256:[a-f0-9]{64}$')


def _check_finite(value: Any) -> None:
    if isinstance(value, float) and not math.isfinite(value):
        raise ValueError('non-finite number in canonical JSON')
    if isinstance(value, dict):
        for k, v in value.items():
            if not isinstance(k, str):
                raise ValueError('canonical JSON keys must be strings')
            _check_finite(v)
    elif isinstance(value, (list, tuple)):
        for v in value:
            _check_finite(v)


def canonical_json(value: Any) -> bytes:
    _check_finite(value)
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False,
                      allow_nan=False).encode('utf-8')


def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def digest_bytes(data: bytes) -> str:
    return 'sha256:' + sha256_hex(data)


def digest_obj(value: Any) -> str:
    return digest_bytes(canonical_json(value))


def is_digest(value: object) -> bool:
    return isinstance(value, str) and bool(DIGEST_RE.fullmatch(value))


def require_digest(value: object, what: str = 'digest') -> str:
    if not is_digest(value):
        raise ValueError(f'{what} must be sha256:<64 lowercase hex>')
    return value  # type: ignore[return-value]


def tree_digest(tree: dict[str, bytes]) -> str:
    """Digest of a file tree: sorted (path, sha256(content)) pairs, canonical JSON."""
    return digest_obj(sorted((p, sha256_hex(b)) for p, b in tree.items()))
