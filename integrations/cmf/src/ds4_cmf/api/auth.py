"""Host-derived principals: peer UID + bearer token -> Principal (plan §29.2).

The tokens file (0600, owned by the service user) maps sha256(token) to a
principal and its grants; plaintext tokens never live on the server side.
Nothing in a request body can add a grant, an agent or an origin.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import secrets
import stat
from pathlib import Path

from ..domain.events import check_id
from ..domain.identity import OPERATIONS, Grant, Principal
from .errors import CmfError

TOKENS_VERSION = 1


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _read_private(path: Path) -> bytes:
    try:
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    except FileNotFoundError:
        return b""
    try:
        st = os.fstat(fd)
        if not stat.S_ISREG(st.st_mode) or st.st_mode & 0o077 or st.st_uid != os.getuid():
            raise CmfError("DEGRADED", "tokens file must be a 0600 regular file owned by the service user")
        return os.read(fd, 1 << 20)
    finally:
        os.close(fd)


def _parse_principal(entry: dict) -> tuple[str, Principal]:
    allowed = {"token_sha256", "principal_id", "user_id", "agent_id", "instance_id",
               "grants", "store_owner"}
    if not isinstance(entry, dict) or set(entry) - allowed:
        raise CmfError("DEGRADED", "tokens file: bad principal entry")
    digest = entry.get("token_sha256")
    if not isinstance(digest, str) or len(digest) != 64:
        raise CmfError("DEGRADED", "tokens file: bad token_sha256")
    agent = entry.get("agent_id")
    grants = set()
    for g in entry.get("grants", []):
        if not isinstance(g, dict) or set(g) - {"project_id", "operation", "agent_id"} \
                or g.get("operation") not in OPERATIONS:
            raise CmfError("DEGRADED", "tokens file: bad grant")
        g_agent = g.get("agent_id")
        grants.add(Grant(check_id(g.get("project_id"), field="project_id"), g["operation"],
                         None if g_agent is None else check_id(g_agent, field="agent_id")))
    return digest, Principal(
        principal_id=check_id(entry.get("principal_id"), field="principal_id"),
        user_id=check_id(entry.get("user_id"), field="user_id"),
        agent_id=None if agent is None else check_id(agent, field="agent_id"),
        instance_id=check_id(entry.get("instance_id", "local"), field="instance_id"),
        grants=frozenset(grants),
        store_owner=entry.get("store_owner") is True,
    )


def load_tokens(path: Path) -> dict[str, Principal]:
    raw = _read_private(path)
    if not raw:
        return {}
    try:
        data = json.loads(raw)
    except ValueError:
        raise CmfError("DEGRADED", "tokens file is not JSON") from None
    if not isinstance(data, dict) or data.get("version") != TOKENS_VERSION:
        raise CmfError("DEGRADED", "tokens file version")
    out: dict[str, Principal] = {}
    for entry in data.get("principals", []):
        digest, principal = _parse_principal(entry)
        out[digest] = principal
    return out


def authenticate(peer_uid: int, authorization: str | None,
                 tokens: dict[str, Principal]) -> Principal:
    """401 unless the peer is this service's own UID *and* presents a known
    bearer token.  Same-UID hostile processes that can read the token file
    are out of scope for the single-user profile (docs/M1-acceptance.md)."""
    if peer_uid != os.getuid():
        raise CmfError("AUTH_REQUIRED")
    if not authorization or not authorization.startswith("Bearer "):
        raise CmfError("AUTH_REQUIRED")
    token = authorization[len("Bearer "):].strip()
    if not 16 <= len(token) <= 256:
        raise CmfError("AUTH_REQUIRED")
    digest = token_hash(token)
    found = None
    for known, principal in tokens.items():
        if hmac.compare_digest(known, digest):
            found = principal
    if found is None:
        raise CmfError("AUTH_REQUIRED")
    return found


def add_principal(path: Path, *, principal_id: str, user_id: str, agent_id: str | None,
                  grants: list[dict], store_owner: bool = False) -> str:
    """Append a principal and return its new token (shown once, never stored)."""
    raw = _read_private(path)
    data = json.loads(raw) if raw else {"version": TOKENS_VERSION, "principals": []}
    token = secrets.token_urlsafe(32)
    entry = {"token_sha256": token_hash(token), "principal_id": principal_id,
             "user_id": user_id, "agent_id": agent_id, "instance_id": "local",
             "grants": grants, "store_owner": store_owner}
    _parse_principal(entry)
    if any(p.get("principal_id") == principal_id for p in data["principals"]):
        raise CmfError("SCHEMA", "principal_id already present")
    data["principals"].append(entry)
    os.makedirs(path.parent, mode=0o700, exist_ok=True)
    tmp = path.with_name(f".{path.name}.{secrets.token_hex(4)}")
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    try:
        os.write(fd, json.dumps(data, indent=2, sort_keys=True).encode("utf-8"))
        os.fsync(fd)
    finally:
        os.close(fd)
    os.rename(tmp, path)
    return token
