"""Strictly typed configuration (plan §11, §30.2).

Unknown keys are rejected, defaults are the conservative ones, and environment overrides
come only from a fixed `H2DS4_*` allowlist without shell expansion. `DS4_*` variables are
never read.
"""

from __future__ import annotations

import ipaddress
import os
import tomllib
from dataclasses import dataclass, field, fields, replace
from enum import StrEnum
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

DEFAULT_CONFIG = Path(__file__).resolve().parents[2] / 'config' / 'default.toml'


class Mode(StrEnum):
    OFF = 'off'
    OBSERVE = 'observe'
    LAB = 'lab'
    PROPOSE = 'propose'
    APPROVED = 'approved'


class PolicyError(ValueError):
    pass


@dataclass(frozen=True)
class ServiceCfg:
    enabled: bool = False
    mode: Mode = Mode.OFF
    uds_name: str = 'h2ds4.sock'
    expose_tcp: bool = False
    api_version: int = 1


@dataclass(frozen=True)
class Ds4Cfg:
    root: str = '/mnt/crucial_ai/COPARATOR/ds4'
    base_url: str = 'http://127.0.0.1:8002'
    model_id: str = ''
    use_native_agent: bool = False
    allow_runtime_restart: bool = False
    allow_session_switch: bool = False
    allow_skill_hot_reload: bool = False
    protected_roots: tuple[str, ...] = ()


@dataclass(frozen=True)
class InferenceCfg:
    provider: str = 'openai_compatible_local'
    max_inflight: int = 1
    max_queued: int = 1
    request_timeout_s: int = 1800
    max_request_bytes: int = 4194304
    retry_non_idempotent: bool = False
    allow_remote_provider: bool = False


@dataclass(frozen=True)
class ExperimentCfg:
    default_k: int = 1
    max_k: int = 2
    max_task_wall_s: int = 3600
    max_model_calls: int = 16
    max_tool_calls: int = 64
    max_total_input_tokens: int = 100000
    max_total_output_tokens: int = 24000
    max_trace_bytes: int = 2000000
    max_file_bytes: int = 10485760
    max_candidate_files: int = 24
    max_workspace_bytes: int = 1073741824
    allow_auto_promotion: bool = False


@dataclass(frozen=True)
class SandboxCfg:
    backend: str = 'bwrap'
    required: bool = True
    network: str = 'none'
    user_namespace_required: bool = True
    cpu_quota_pct: int = 100
    memory_max_mib: int = 2048
    pids_max: int = 96
    workspace_max_mib: int = 256
    ro_toolchain_paths: tuple[str, ...] = ()


@dataclass(frozen=True)
class PolicyCfg:
    allowed_components: tuple[str, ...] = ('c1', 'c3', 'c4', 'c6')
    allow_generated_scripts: bool = False
    allow_generated_plugins: bool = False
    allow_generated_subagents: bool = False
    require_explicit_approval: bool = True
    minimum_success_delta: float = 0.0
    regression_tolerance: float = 0.0
    minimum_quality_gain: float = 0.01
    max_token_ratio: float = 2.0
    baseline_must_be_in_pool: bool = True


@dataclass(frozen=True)
class MemoryCfg:
    max_retrieved_items: int = 5
    max_context_chars: int = 6000
    max_index_entries: int = 2000
    ttl_days: int = 90
    cross_model_transfer: str = 'evaluate_only'


@dataclass(frozen=True)
class AuditCfg:
    store_raw_prompts: bool = False
    store_raw_tool_outputs: bool = False
    hash_sensitive_artifacts: bool = True
    retention_days: int = 30


@dataclass(frozen=True)
class PathsCfg:
    """Empty means the XDG default. Every non-empty value must be absolute."""

    runtime_dir: str = ''
    data_dir: str = ''
    cache_dir: str = ''


@dataclass(frozen=True)
class Settings:
    service: ServiceCfg = field(default_factory=ServiceCfg)
    ds4: Ds4Cfg = field(default_factory=Ds4Cfg)
    inference: InferenceCfg = field(default_factory=InferenceCfg)
    experiment: ExperimentCfg = field(default_factory=ExperimentCfg)
    sandbox: SandboxCfg = field(default_factory=SandboxCfg)
    policy: PolicyCfg = field(default_factory=PolicyCfg)
    memory: MemoryCfg = field(default_factory=MemoryCfg)
    audit: AuditCfg = field(default_factory=AuditCfg)
    paths: PathsCfg = field(default_factory=PathsCfg)

    # -- derived locations -------------------------------------------------------------
    @property
    def runtime_dir(self) -> Path:
        return _xdg(self.paths.runtime_dir, 'XDG_RUNTIME_DIR', None)

    @property
    def data_dir(self) -> Path:
        return _xdg(self.paths.data_dir, 'XDG_DATA_HOME', '.local/share')

    @property
    def cache_dir(self) -> Path:
        return _xdg(self.paths.cache_dir, 'XDG_CACHE_HOME', '.cache')

    @property
    def uds_path(self) -> Path:
        return self.runtime_dir / self.service.uds_name

    @property
    def inference_uds_path(self) -> Path:
        return self.runtime_dir / 'h2ds4-inference.sock'

    @property
    def db_path(self) -> Path:
        return self.data_dir / 'state.sqlite3'

    # -- validation ----------------------------------------------------------------------
    def validate(self) -> Settings:
        if self.inference.max_inflight != 1:
            raise PolicyError('single DS4 model: max_inflight must be exactly 1')
        if self.inference.max_queued != 1:
            raise PolicyError('max_queued must be 1 in phase 1')
        if self.inference.allow_remote_provider:
            raise PolicyError('remote provider forbidden (ADR-009)')
        if self.inference.provider != 'openai_compatible_local':
            raise PolicyError('only openai_compatible_local is supported')
        if self.inference.retry_non_idempotent:
            raise PolicyError('retry_non_idempotent is forbidden')
        if self.service.expose_tcp:
            raise PolicyError('TCP exposure is forbidden; UDS only')
        if self.service.api_version != 1:
            raise PolicyError('api_version must be 1')
        if '/' in self.service.uds_name or not self.service.uds_name.endswith('.sock'):
            raise PolicyError('uds_name must be a bare *.sock name')
        if self.experiment.max_k not in (1, 2) or not 1 <= self.experiment.default_k <= self.experiment.max_k:
            raise PolicyError('k out of phase-1 bounds')
        if self.experiment.allow_auto_promotion:
            raise PolicyError('auto promotion is forbidden')
        if not self.sandbox.required or self.sandbox.network != 'none':
            raise PolicyError('unsandboxed or networked execution forbidden')
        if self.sandbox.backend not in ('bwrap', 'podman'):
            raise PolicyError('sandbox backend must be bwrap or podman')
        if not set(self.policy.allowed_components) <= {'c1', 'c3', 'c4', 'c6'}:
            raise PolicyError('phase 1 allows only c1, c3, c4, c6')
        if (self.policy.allow_generated_scripts or self.policy.allow_generated_plugins
                or self.policy.allow_generated_subagents):
            raise PolicyError('generated scripts/plugins/subagents are disabled in phase 1')
        if not self.policy.require_explicit_approval or not self.policy.baseline_must_be_in_pool:
            raise PolicyError('explicit approval and baseline-in-pool are mandatory')
        if self.memory.cross_model_transfer != 'evaluate_only':
            raise PolicyError('cross-model transfer must be evaluate_only')
        if self.audit.store_raw_prompts or self.audit.store_raw_tool_outputs:
            raise PolicyError('raw prompt/tool-output storage is disabled in phase 1')
        if self.ds4.use_native_agent or self.ds4.allow_runtime_restart \
                or self.ds4.allow_session_switch or self.ds4.allow_skill_hot_reload:
            raise PolicyError('native agent / restart / session switch / hot reload: BLOCKED_API')
        validate_model_url(self.ds4.base_url)
        ds4_root = Path(self.ds4.root)
        if not ds4_root.is_absolute():
            raise PolicyError('ds4.root must be absolute')
        for p in (self.paths.runtime_dir, self.paths.data_dir, self.paths.cache_dir,
                  *self.ds4.protected_roots, *self.sandbox.ro_toolchain_paths):
            if p and not Path(p).is_absolute():
                raise PolicyError('configured paths must be absolute')
        protected = [ds4_root, *(Path(p) for p in self.ds4.protected_roots)]
        for own in (self.runtime_dir, self.data_dir, self.cache_dir):
            for prot in protected:
                if _is_within(own, prot):
                    raise PolicyError('sidecar state may not live inside a DS4 checkout')
        return self


def validate_model_url(url: str) -> None:
    u = urlsplit(url)
    if u.scheme != 'http' or u.username or u.password or u.query or u.fragment:
        raise PolicyError('unsupported model URL')
    try:
        port = u.port
    except ValueError as e:
        raise PolicyError('invalid port') from e
    if u.path not in ('', '/') or not u.hostname or port is None:
        raise PolicyError('model URL must be http://numeric-loopback:port')
    try:
        ip = ipaddress.ip_address(u.hostname)
    except ValueError as e:
        raise PolicyError('numeric loopback only, no DNS aliases') from e
    if not ip.is_loopback:
        raise PolicyError('non-loopback model endpoint denied')


def _is_within(child: Path, parent: Path) -> bool:
    try:
        Path(os.path.realpath(child)).relative_to(os.path.realpath(parent))
        return True
    except ValueError:
        return False


def _xdg(explicit: str, var: str, home_rel: str | None) -> Path:
    if explicit:
        return Path(explicit) if explicit.endswith('h2ds4') else Path(explicit) / 'h2ds4'
    base = os.environ.get(var, '')
    if base and Path(base).is_absolute():
        return Path(base) / 'h2ds4'
    if home_rel is None:
        raise PolicyError(f'{var} must be set by the user session')
    return Path.home() / home_rel / 'h2ds4'


# -- loading ------------------------------------------------------------------------------

_SECTIONS: dict[str, type] = {
    'service': ServiceCfg, 'ds4': Ds4Cfg, 'inference': InferenceCfg,
    'experiment': ExperimentCfg, 'sandbox': SandboxCfg, 'policy': PolicyCfg,
    'memory': MemoryCfg, 'audit': AuditCfg, 'paths': PathsCfg,
}

# Allowlisted environment overrides: name -> (section, key). Values are literal strings.
ENV_OVERRIDES: dict[str, tuple[str, str]] = {
    'H2DS4_MODE': ('service', 'mode'),
    'H2DS4_DS4_BASE_URL': ('ds4', 'base_url'),
    'H2DS4_MODEL_ID': ('ds4', 'model_id'),
    'H2DS4_DATA_DIR': ('paths', 'data_dir'),
    'H2DS4_RUNTIME_DIR': ('paths', 'runtime_dir'),
    'H2DS4_CACHE_DIR': ('paths', 'cache_dir'),
}


def _coerce(cls: type, key: str, value: Any) -> Any:
    f = {x.name: x for x in fields(cls)}.get(key)
    if f is None:
        raise PolicyError(f'unknown config key {cls.__name__}.{key}')
    default = getattr(cls(), key)
    if isinstance(default, Mode):
        try:
            return Mode(value)
        except ValueError as e:
            raise PolicyError(f'invalid mode {value!r}') from e
    if isinstance(default, bool):
        if not isinstance(value, bool):
            raise PolicyError(f'{key} must be a boolean')
        return value
    if isinstance(default, int):
        if isinstance(value, bool) or not isinstance(value, int):
            raise PolicyError(f'{key} must be an integer')
        return value
    if isinstance(default, float):
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise PolicyError(f'{key} must be a number')
        return float(value)
    if isinstance(default, tuple):
        if not isinstance(value, list) or not all(isinstance(x, str) for x in value):
            raise PolicyError(f'{key} must be a list of strings')
        return tuple(value)
    if not isinstance(value, str):
        raise PolicyError(f'{key} must be a string')
    return value


def from_mapping(data: dict[str, Any]) -> Settings:
    kwargs: dict[str, Any] = {}
    for section, body in data.items():
        cls = _SECTIONS.get(section)
        if cls is None:
            raise PolicyError(f'unknown config section {section!r}')
        if not isinstance(body, dict):
            raise PolicyError(f'section {section!r} must be a table')
        kwargs[section] = cls(**{k: _coerce(cls, k, v) for k, v in body.items()})
    return Settings(**kwargs)


def load(path: Path | None = None, *, environ: dict[str, str] | None = None) -> Settings:
    env = os.environ if environ is None else environ
    if path is None:
        explicit = env.get('H2DS4_CONFIG', '')
        if explicit:
            path = Path(explicit)
        else:
            user = Path(env.get('XDG_CONFIG_HOME') or Path.home() / '.config') / 'h2ds4' / 'config.toml'
            path = user if user.is_file() else DEFAULT_CONFIG
    if not path.is_absolute():
        raise PolicyError('config path must be absolute')
    with open(path, 'rb') as f:
        settings = from_mapping(tomllib.load(f))
    for var, (section, key) in ENV_OVERRIDES.items():
        if var in env:
            sec = getattr(settings, section)
            settings = replace(settings, **{section: replace(
                sec, **{key: _coerce(type(sec), key, env[var])})})
    return settings.validate()


def json_schema() -> dict:
    """JSON Schema of the TOML config, derived from the dataclasses (config/h2ds4.schema.json).

    Types and enums only: the cross-field policy lives in Settings.validate().
    """
    def prop(default: Any) -> dict:
        if isinstance(default, Mode):
            return {'type': 'string', 'enum': [m.value for m in Mode]}
        if isinstance(default, bool):
            return {'type': 'boolean'}
        if isinstance(default, int):
            return {'type': 'integer'}
        if isinstance(default, float):
            return {'type': 'number'}
        if isinstance(default, tuple):
            return {'type': 'array', 'items': {'type': 'string'}}
        return {'type': 'string'}

    sections = {}
    for name, cls in _SECTIONS.items():
        inst = cls()
        sections[name] = {'type': 'object', 'additionalProperties': False,
                          'properties': {f.name: {**prop(getattr(inst, f.name)),
                                                  'default': (list(getattr(inst, f.name))
                                                              if isinstance(getattr(inst, f.name), tuple)
                                                              else getattr(inst, f.name))}
                                         for f in fields(cls)}}
    return {'$schema': 'https://json-schema.org/draft/2020-12/schema', 'title': 'h2ds4 config',
            'type': 'object', 'additionalProperties': False, 'properties': sections}
