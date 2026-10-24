"""Settings: CLI > explicitly set env > TOML file > default (plan §28.2, §44.1).

An unset environment variable never masks the file; a set one (even "0")
does.  Settings are frozen once loaded.
"""

from __future__ import annotations

import os
import tomllib
from dataclasses import dataclass, field, replace
from pathlib import Path
from typing import Mapping

from .api.errors import CmfError

ENV = {
    "enabled": "DS4_CMF_ENABLED",
    "store_root": "DS4_CMF_STORE_ROOT",
    "socket_path": "DS4_CMF_SOCKET",
    "tokens_file": "DS4_CMF_TOKENS_FILE",
}


def _default_runtime() -> Path:
    xdg = os.environ.get("XDG_RUNTIME_DIR")
    return Path(xdg) / "ds4-cmf" if xdg else Path.home() / ".local/run/ds4-cmf"


@dataclass(frozen=True)
class Limits:
    max_text_bytes: int = 1_048_576
    max_body_bytes: int = 8 * 1_048_576
    max_ds4_bytes: int = 1_048_576
    episode_prefix_bytes: int = 16_384
    max_query_bytes: int = 4096
    max_recall_limit: int = 64
    max_response_bytes: int = 16 * 1_048_576
    request_timeout_s: float = 2.0
    busy_timeout_ms: int = 2000
    projection_batch: int = 64


@dataclass(frozen=True)
class Settings:
    enabled: bool = False
    store_root: Path = field(default_factory=lambda: Path.home() / ".local/share/ds4-cmf")
    socket_path: Path = field(default_factory=lambda: _default_runtime() / "cmf.sock")
    tokens_file: Path = field(default_factory=lambda: Path.home() / ".config/ds4/cmf-tokens.json")
    # project_id -> DS4 context-blob root (the base_dir given to ds4_context_blob_put_text).
    ds4_blob_roots: tuple[tuple[str, Path], ...] = ()
    network_egress: str = "deny"
    limits: Limits = field(default_factory=Limits)

    def ds4_root_for(self, project_id: str) -> Path | None:
        for pid, root in self.ds4_blob_roots:
            if pid == project_id:
                return root
        return None

    @property
    def db_path(self) -> Path:
        return self.store_root / "cmf.sqlite"


def _bool(value: object, name: str) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str) and value.strip().lower() in ("1", "true", "yes", "on"):
        return True
    if isinstance(value, str) and value.strip().lower() in ("0", "false", "no", "off", ""):
        return False
    raise CmfError("SCHEMA", f"{name}: expected a boolean")


def _path(value: object, name: str) -> Path:
    if not isinstance(value, str) or not value:
        raise CmfError("SCHEMA", f"{name}: expected a path")
    p = Path(value).expanduser()
    if not p.is_absolute():
        raise CmfError("SCHEMA", f"{name}: path must be absolute")
    return p


def _apply_file(s: Settings, data: Mapping) -> Settings:
    known = {"core", "auth", "limits", "ds4"}
    if set(data) - known:
        raise CmfError("SCHEMA", f"unknown config sections: {sorted(set(data) - known)}")
    core = data.get("core", {})
    if set(core) - {"enabled", "store_root", "socket_path", "network_egress"}:
        raise CmfError("SCHEMA", "unknown keys in [core]")
    if "enabled" in core:
        s = replace(s, enabled=_bool(core["enabled"], "core.enabled"))
    if "store_root" in core:
        s = replace(s, store_root=_path(core["store_root"], "core.store_root"))
    if "socket_path" in core:
        s = replace(s, socket_path=_path(core["socket_path"], "core.socket_path"))
    if "network_egress" in core:
        if core["network_egress"] != "deny":
            # M1 has no provider at all; anything else is a misconfiguration.
            raise CmfError("SCHEMA", "core.network_egress: only 'deny' is supported")
    auth = data.get("auth", {})
    if set(auth) - {"tokens_file"}:
        raise CmfError("SCHEMA", "unknown keys in [auth]")
    if "tokens_file" in auth:
        s = replace(s, tokens_file=_path(auth["tokens_file"], "auth.tokens_file"))
    limits = data.get("limits", {})
    fields = Limits.__dataclass_fields__
    if set(limits) - set(fields):
        raise CmfError("SCHEMA", "unknown keys in [limits]")
    lim = s.limits
    for key, value in limits.items():
        expected = type(getattr(lim, key))
        if isinstance(value, bool) or not isinstance(value, (int, float)) or value <= 0:
            raise CmfError("SCHEMA", f"limits.{key}: expected a positive number")
        lim = replace(lim, **{key: expected(value)})
    if lim.max_text_bytes > 1_048_576 or lim.max_ds4_bytes > 1_048_576:
        raise CmfError("SCHEMA", "limits: M1 caps text and DS4 sources at 1 MiB")
    if lim.episode_prefix_bytes > lim.max_text_bytes:
        raise CmfError("SCHEMA", "limits.episode_prefix_bytes exceeds max_text_bytes")
    s = replace(s, limits=lim)
    ds4 = data.get("ds4", {})
    if set(ds4) - {"blob_roots"}:
        raise CmfError("SCHEMA", "unknown keys in [ds4]")
    roots = ds4.get("blob_roots", {})
    if not isinstance(roots, dict):
        raise CmfError("SCHEMA", "ds4.blob_roots must be a table")
    s = replace(s, ds4_blob_roots=tuple(sorted(
        (str(pid), _path(root, f"ds4.blob_roots.{pid}")) for pid, root in roots.items())))
    return s


def load_settings(path: Path | None = None, *, env: Mapping[str, str] | None = None,
                  overrides: Mapping[str, object] | None = None) -> Settings:
    env = os.environ if env is None else env
    s = Settings()
    if path is not None:
        try:
            with open(path, "rb") as fh:
                s = _apply_file(s, tomllib.load(fh))
        except OSError as exc:
            raise CmfError("SCHEMA", f"cannot read config: {exc.strerror}") from None
        except tomllib.TOMLDecodeError as exc:
            raise CmfError("SCHEMA", f"invalid TOML: {exc}") from None
    for key, var in ENV.items():
        if var not in env:
            continue
        value = env[var]
        s = replace(s, **{key: _bool(value, var) if key == "enabled" else _path(value, var)})
    for key, value in (overrides or {}).items():
        if value is None:
            continue
        if key not in ENV:
            raise CmfError("SCHEMA", f"unknown override {key}")
        s = replace(s, **{key: _bool(value, key) if key == "enabled" else _path(str(value), key)})
    return s
