#!/usr/bin/env python3
"""Startup tuning dialog for ./srun.sh.

Exit codes:
  0  OK: save config and continue startup
  20 Save: save config and stop srun.sh before launch
  30 Cancel: do not save and stop srun.sh before launch
"""

from __future__ import annotations

import argparse
import copy
import json
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any


sys.path.insert(0, str(Path(__file__).resolve().parent))
from srun_reconcile import DERIVED as DERIVED_KEYS  # noqa: E402

EXIT_OK = 0
EXIT_SAVE_ONLY = 20
EXIT_CANCEL = 30
EXIT_ERROR = 2


REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CONFIG_EXPORTER = REPO_ROOT / "frontend" / "scripts" / "printDefaultConfig.mjs"

sys.path.insert(0, str(Path(__file__).resolve().parent))
from srun_model_scan import (  # noqa: E402
    recommend as recommend_settings,
    scan as scan_models,
)


def load_canonical_defaults() -> dict[str, Any]:
    """The defaults, read from the one place that owns them.

    frontend/server/defaultConfig.mjs is the control plane's single source of
    application defaults. Keeping a second copy here is exactly the drift this
    dialog used to create, so there is no Python fallback on purpose: without
    node, srun.sh could not start the frontend anyway, and a loud error beats a
    dialog quietly offering stale numbers.
    """
    completed = subprocess.run(
        ["node", str(DEFAULT_CONFIG_EXPORTER)],
        check=True,
        capture_output=True,
        text=True,
    )
    parsed = json.loads(completed.stdout)
    if not isinstance(parsed, dict):
        raise RuntimeError("default config exporter did not return an object")
    return parsed


DEFAULT_CONFIG: dict[str, Any] = load_canonical_defaults()


@dataclass(frozen=True)
class Field:
    path: str
    label: str
    kind: str
    tab: str


FIELDS: list[Field] = [
    Field("server.binary", "Backend binary", "string", "Server"),
    Field("server.modelsDir", "Models directory (scanned at startup)", "string", "Server"),
    Field("server.model", "Model GGUF", "string", "Server"),
    Field("server.vision", "Vision encoder GGUF", "string", "Server"),
    Field("server.mtp", "MTP / DSpark support model", "string", "Server"),
    Field("server.mtpDraft", "MTP draft tokens", "positive_int", "Server"),
    Field("server.mtpMargin", "MTP margin", "float", "Server"),
    Field("server.ctx", "Context tokens", "positive_int", "Server"),
    Field("server.tokens", "Default generation tokens", "positive_int", "Server"),
    Field("server.threads", "CPU threads (0 auto)", "nonnegative_int", "Server"),
    Field("server.backend", "Backend", "backend", "Server"),
    Field("server.quality", "Quality mode", "bool", "Server"),
    Field("server.warmWeights", "Warm weights", "bool", "Server"),
    Field("server.host", "Backend host", "string", "Server"),
    Field("server.port", "Backend port", "port", "Server"),
    Field("server.maxQueuedJobs", "Max queued jobs", "positive_int", "Server"),
    Field("server.power", "GPU duty cycle %", "positive_int", "Server"),
    Field("server.trace", "Trace file", "string", "Server"),
    # Streaming is a loss whenever the weights fit in RAM: measured 9.12 t/s
    # streamed against 15.32 t/s resident on the same model and prompt.
    Field("server.ssdStreaming", "Stream experts from SSD", "bool", "Streaming/DSpark"),
    Field("server.ssdStreamingCacheExperts", "Expert cache budget (count or NGB)", "string", "Streaming/DSpark"),
    Field("server.ssdStreamingCold", "Stream without warming the cache", "bool", "Streaming/DSpark"),
    Field("server.ssdStreamingFullLayers", "Whole layers kept resident", "nonnegative_int", "Streaming/DSpark"),
    Field("server.ssdStreamingPreloadExperts", "Experts preloaded at startup", "nonnegative_int", "Streaming/DSpark"),
    # DSpark draft depth comes from the support model's own block_size, so
    # mtpDraft/mtpMargin above are inert once dspark is on.
    Field("server.dspark", "Enable DSpark speculative decode", "bool", "Streaming/DSpark"),
    Field("server.dsparkConfidence", "DSpark confidence 0..1 (ROCm default 0.7)", "optional_float", "Streaming/DSpark"),
    Field("server.dsparkStrict", "Load DSpark support but decode target-only", "bool", "Streaming/DSpark"),
    Field("server.mtpExactSampling", "Exact stochastic p/q acceptance", "bool", "Streaming/DSpark"),
    Field("requestDefaults.max_tokens", "Request max_tokens (auto or fixed)", "auto_or_positive_int", "Request"),
    Field("requestDefaults.max_tokens_safety_cap", "Auto max_tokens safety cap", "positive_int", "Request"),
    Field("requestDefaults.context_margin", "Auto context margin", "nonnegative_int", "Request"),
    Field("server.dirSteeringFile", "Directional steering file", "string", "Server"),
    Field("server.dirSteeringFfn", "Directional FFN strength", "optional_float", "Server"),
    Field("server.dirSteeringAttn", "Directional attention strength", "optional_float", "Server"),
    Field("server.kvDiskDir", "KV disk directory", "string", "KV/Tools"),
    Field("server.kvDiskSpaceMb", "KV disk space MiB", "positive_int", "KV/Tools"),
    Field("server.kvCacheMinTokens", "KV min tokens", "positive_int", "KV/Tools"),
    Field("server.kvCacheColdMaxTokens", "KV cold max tokens (0 off)", "nonnegative_int", "KV/Tools"),
    Field("server.kvCacheContinuedIntervalTokens", "KV continued interval tokens", "nonnegative_int", "KV/Tools"),
    Field("server.kvCacheBoundaryTrimTokens", "KV boundary trim tokens", "nonnegative_int", "KV/Tools"),
    Field("server.kvCacheBoundaryAlignTokens", "KV boundary align tokens", "nonnegative_int", "KV/Tools"),
    Field("server.kvCacheRejectDifferentQuant", "Reject different quant", "bool", "KV/Tools"),
    Field("server.disableExactDsmlToolReplay", "Disable exact DSML tool replay", "bool", "KV/Tools"),
    Field("server.toolMemoryMaxIds", "Tool memory max ids", "positive_int", "KV/Tools"),
    Field("wrapper.enabled", "Enable wrapper backend (server/agent switch)", "bool", "Wrapper"),
    Field("wrapper.binary", "Wrapper binary", "string", "Wrapper"),
    Field("wrapper.startupMode", "Startup mode", "startup_mode", "Wrapper"),
    Field("wrapper.freezeOnSwitch", "Freeze on switch", "bool", "Wrapper"),
    Field("wrapper.freeInactiveSession", "Free inactive session", "bool", "Wrapper"),
    Field("wrapper.ramFreezeMaxMb", "RAM freeze max MiB", "nonnegative_int", "Wrapper"),
    # Off means the agent's google_search/visit_page fail: the browser consent
    # prompt has no UI to answer it. On means the model can drive a visible
    # Chrome that carries your logged-in sessions.
    Field("wrapper.agentAllowBrowser", "Let the agent open a visible Chrome (web search)",
          "bool", "Wrapper"),
    Field("contextWiki.enabled", "Enable ContextWiki capsule injection", "bool", "ContextWiki"),
    Field("contextWiki.previewOnly", "Preview only (build/log, never inject)", "bool", "ContextWiki"),
    # Lean config is resolved once when the Node UI server boots: saving here
    # changes the file, not the running process (R13).
    Field("lean.enabled", "Enable Lean 4 lean_check tool (restart UI server)", "bool", "Lean"),
    Field("lean.policyAuto", "Auto-load Lean policy at session build", "bool", "Lean"),
    Field("lean.defaultProfile", "Lean default profile (core/mathlib)", "string", "Lean"),
    # Autonomous proof budget. Clamped server-side by
    # resolveLeanOrchestrationConfig (attempts 1-10, same-failure 1-3,
    # wall clock 30s-15m), so an out-of-range value here is coerced, not obeyed.
    Field("lean.orchestration.maxAttempts", "Max lean_check attempts per proof", "positive_int", "Lean"),
    Field("lean.orchestration.maxSameFailure", "Identical failures before strategy change", "positive_int", "Lean"),
    Field("lean.orchestration.maxPrematureFinalizations", "Premature finalizations tolerated", "positive_int", "Lean"),
    Field("lean.orchestration.maxWallClockMs", "Proof wall-clock budget (ms)", "positive_int", "Lean"),
    # Autonomous Sage budget. Clamped server-side by
    # resolveSageOrchestrationConfig, which also raises maxTotalToolCalls if the
    # phase budgets do not fit inside it.
    Field("sage.orchestration.maxComputeAttempts", "Max compute calls per run", "positive_int", "Sage"),
    Field("sage.orchestration.maxRepairAttempts", "Max candidate repairs per run", "positive_int", "Sage"),
    Field("sage.orchestration.maxValidationAttempts", "Max validations per run", "positive_int", "Sage"),
    Field("sage.orchestration.maxPlotAttempts", "Max plot attempts per run", "positive_int", "Sage"),
    Field("sage.orchestration.maxPrematureFinalizations", "Premature finalizations tolerated", "positive_int", "Sage"),
    Field("sage.orchestration.maxSameFailure", "Identical failures before strategy change", "positive_int", "Sage"),
    Field("sage.orchestration.maxWallClockMs", "Run wall-clock budget (ms)", "positive_int", "Sage"),
    Field("sage.orchestration.maxTotalToolCalls", "Total sage tool calls per run", "positive_int", "Sage"),
    # The six switches below used to live in server.env as strings. They are
    # typed fields now; semanticConfig.mjs is the only bridge back to the
    # DS4_* variables the Node modules and the C backend read.
    # All six are resolved once at boot: saving updates the file, the new value
    # takes effect at the next UI server start.
    Field("lean.orchestration.enabled", "Enable Lean autonomous orchestration (restart UI server)", "bool", "Lean"),
    Field("lean.orchestration.prompt", "Inject Lean autonomous prompt fragment (restart UI server)", "bool", "Lean"),
    Field("sage.policyAuto", "Auto-load Sage policy at startup (restart UI server)", "bool", "Sage"),
    Field("sage.orchestration.enabled", "Enable Sage autonomous orchestration (restart UI server)", "bool", "Sage"),
    Field("sage.orchestration.prompt", "Inject Sage autonomous prompt fragment (restart UI server)", "bool", "Sage"),
    # ContextWiki capsule limits. readContextConfig resolves them as
    # env > this file > default, so an A/B benchmark can still override them.
    Field("contextWiki.softTokens", "Capsule soft token budget", "positive_int", "ContextWiki"),
    Field("contextWiki.hardTokens", "Capsule hard token budget", "positive_int", "ContextWiki"),
    Field("contextWiki.maxGrowthPct", "Max capsule growth per turn (%)", "positive_int", "ContextWiki"),
    Field("contextWiki.maxEvidence", "Max evidence entries", "positive_int", "ContextWiki"),
    Field("contextWiki.deltaRequired", "Require a delta before rewriting", "bool", "ContextWiki"),
    Field("contextWiki.telemetry", "Log capsule telemetry", "bool", "ContextWiki"),
    Field("contextWiki.maxLedgerEvents", "Max ledger events kept", "positive_int", "ContextWiki"),
]


ENV_FIELDS: list[Field] = [
    Field("server.env.DS4_SKILL_AUTO", "Auto-load default skills at startup", "env_toggle", "Wrapper"),
    Field("server.env.DS4_METAL_PREFILL_CHUNK", "Prefill chunk tokens", "env_int", "CUDA/Prefill"),
    Field("server.env.DS4_CUDA_Q8_F16_CACHE_MB", "Q8/F16 cache MiB", "env_string", "CUDA/Prefill"),
    Field("server.env.DS4_CUDA_Q8_F16_CACHE_RESERVE_MB", "Q8/F16 reserve MiB", "env_string", "CUDA/Prefill"),
    Field("server.env.DS4_CUDA_WEIGHT_ARENA_CHUNK_MB", "Weight arena chunk MiB", "env_string", "CUDA/Prefill"),
    Field("server.env.DS4_CUDA_COPY_MODEL_CHUNKED", "Chunked model copy", "env_flag", "CUDA/Prefill"),
    Field("server.env.DS4_CUDA_DIRECT_MODEL", "Direct model access", "env_flag", "CUDA/Prefill"),
    Field("server.env.DS4_CUDA_NO_FD_CACHE", "Disable fd cache", "env_flag", "CUDA/Prefill"),
    Field("server.env.DS4_CUDA_MOE_PROFILE", "Profile CUDA MoE", "env_flag", "Profiling"),
    Field("server.env.DS4_METAL_GRAPH_PREFILL_PROFILE", "Profile graph prefill", "env_flag", "Profiling"),
    Field("server.env.DS4_CUDA_MOE_NO_EXPERT_TILES", "Disable expert tiles", "env_flag", "MoE Kernel"),
    Field("server.env.DS4_CUDA_MOE_TILE4", "Use tile4", "env_flag", "MoE Kernel"),
    Field("server.env.DS4_CUDA_MOE_WRITE_GATE_UP", "Write gate/up debug tensors", "env_flag", "MoE Kernel"),
    Field("server.env.DS4_CUDA_MOE_NO_P2", "Disable P2 sorted path", "env_flag", "MoE Kernel"),
    Field("server.env.DS4_CUDA_MOE_ATOMIC_DOWN", "Force atomic down", "env_flag", "MoE Kernel"),
    Field("server.env.DS4_CUDA_MOE_NO_ATOMIC_DOWN", "Disable atomic down", "env_flag", "MoE Kernel"),
    Field("server.env.DS4_CUDA_MOE_NO_DOWN_TILE16", "Disable down tile16", "env_flag", "MoE Kernel"),
    Field("server.env.DS4_CUDA_MOE_NO_DECODE_LUT_GATE", "Disable decode LUT gate", "env_flag", "MoE Kernel"),
    Field("server.env.DS4_CUDA_MOE_NO_DIRECT_DOWN_SUM6", "Disable direct down sum6", "env_flag", "MoE Kernel"),
    Field("server.env.DS4_CUDA_MOE_GATE_ROW512", "Gate row 512", "env_flag", "MoE Rows"),
    Field("server.env.DS4_CUDA_MOE_GATE_ROW2048", "Gate row 2048", "env_flag", "MoE Rows"),
    Field("server.env.DS4_CUDA_MOE_GATE_ROW256", "Gate row 256", "env_flag", "MoE Rows"),
    Field("server.env.DS4_CUDA_MOE_GATE_ROW128", "Gate row 128", "env_flag", "MoE Rows"),
    Field("server.env.DS4_CUDA_MOE_NO_GATE_ROW2048", "Disable gate row 2048", "env_flag", "MoE Rows"),
    Field("server.env.DS4_CUDA_MOE_NO_GATE_ROW256", "Disable gate row 256", "env_flag", "MoE Rows"),
    Field("server.env.DS4_CUDA_MOE_NO_GATE_ROW128", "Disable gate row 128", "env_flag", "MoE Rows"),
    Field("server.env.DS4_CUDA_MOE_DOWN_ROW512", "Down row 512", "env_flag", "MoE Rows"),
    Field("server.env.DS4_CUDA_MOE_DOWN_ROW1024", "Down row 1024", "env_flag", "MoE Rows"),
    Field("server.env.DS4_CUDA_MOE_DOWN_ROW2048", "Down row 2048", "env_flag", "MoE Rows"),
    Field("server.env.DS4_CUDA_MOE_DOWN_ROW256", "Down row 256", "env_flag", "MoE Rows"),
    Field("server.env.DS4_CUDA_MOE_DOWN_ROW128", "Down row 128", "env_flag", "MoE Rows"),
    Field("server.env.DS4_CUDA_MOE_DOWN_ROW64", "Down row 64", "env_flag", "MoE Rows"),
    Field("server.env.DS4_CUDA_MOE_NO_DOWN_ROW2048", "Disable down row 2048", "env_flag", "MoE Rows"),
    Field("server.env.DS4_CUDA_MOE_NO_DOWN_ROW256", "Disable down row 256", "env_flag", "MoE Rows"),
    Field("server.env.DS4_CUDA_MOE_NO_DOWN_ROW128", "Disable down row 128", "env_flag", "MoE Rows"),
    Field("server.env.DS4_CUDA_MOE_NO_DOWN_ROW64", "Disable down row 64", "env_flag", "MoE Rows"),
]


ALL_FIELDS = FIELDS + ENV_FIELDS

# Preferred left-to-right order. Tabs named by a field but missing here are
# still shown, appended at the end — no field can ever be dropped or crash the
# GUI just because this list was not updated.
TAB_ORDER = [
    "Server", "Streaming/DSpark", "Request", "Wrapper", "ContextWiki", "Lean", "KV/Tools",
    "CUDA/Prefill", "Profiling", "MoE Kernel", "MoE Rows", "Sage", "Extra Env",
]


KIND_FALLBACK = {
    "bool": False, "env_toggle": False, "env_flag": "",
    "positive_int": 0, "nonnegative_int": 0, "port": 0, "env_int": 0,
    "float": 0.0, "optional_float": "", "auto_or_positive_int": "auto",
    "backend": "auto", "startup_mode": "server",
}


def field_value(config: dict[str, Any], field: Field) -> Any:
    """The widget's starting value, for a config that may predate the field.

    Adding a Field used to be enough to kill the whole startup window with a
    KeyError on any config written before it existed - which is every config,
    the first time. Resolution order: the user's file, then the canonical
    defaults, then a value shaped like the field's kind.
    """
    try:
        return get_path(config, field.path)
    except (KeyError, TypeError):
        pass
    try:
        return get_path(DEFAULT_CONFIG, field.path)
    except (KeyError, TypeError):
        pass
    return KIND_FALLBACK.get(field.kind, "")


def tab_names() -> list[str]:
    """Every tab the fields need, ordered by TAB_ORDER first."""
    used = list(dict.fromkeys([field.tab for field in ALL_FIELDS] + ["Extra Env"]))
    return [t for t in TAB_ORDER if t in used] + [t for t in used if t not in TAB_ORDER]
FIELD_BY_PATH = {field.path: field for field in ALL_FIELDS}
KNOWN_ENV_KEYS = {field.path.split(".")[-1] for field in ENV_FIELDS}
PRESENCE_ENV_KEYS = {field.path.split(".")[-1] for field in ENV_FIELDS if field.kind == "env_flag"}
TOGGLE_ENV_KEYS = {field.path.split(".")[-1] for field in ENV_FIELDS if field.kind == "env_toggle"}


def deep_merge(base: Any, patch: Any) -> Any:
    if isinstance(base, dict) and isinstance(patch, dict):
        merged = copy.deepcopy(base)
        for key, value in patch.items():
            merged[key] = deep_merge(merged[key], value) if key in merged else copy.deepcopy(value)
        return merged
    return copy.deepcopy(patch)


# env key -> typed path, mirroring frontend/server/semanticConfig.mjs.
# Remove after all supported ds4-ui.config.json files have been saved once
# with the typed schema.
SEMANTIC_ENV_BINDINGS: list[tuple[str, tuple[str, ...], tuple[str, ...]]] = [
    ("DS4_LEAN_POLICY_AUTO", ("lean", "policyAuto"), ("DS4_LEAN_SKILL_AUTO",)),
    ("DS4_SAGE_POLICY_AUTO", ("sage", "policyAuto"), ("DS4_SAGE_SKILL_AUTO",)),
    ("DS4_LEAN_AUTONOMOUS_ORCHESTRATION", ("lean", "orchestration", "enabled"), ()),
    ("DS4_LEAN_AUTONOMOUS_PROMPT", ("lean", "orchestration", "prompt"), ()),
    # The deprecated V2 spellings of this switch are handled by
    # frontend/server/semanticConfig.mjs; they were never GUI fields, so an
    # old ds4-ui.config.json written by this dialog cannot contain them.
    ("DS4_SAGE_AUTONOMOUS_ORCHESTRATION", ("sage", "orchestration", "enabled"), ()),
    ("DS4_SAGE_AUTONOMOUS_PROMPT", ("sage", "orchestration", "prompt"), ()),
]
LEGACY_SEMANTIC_ENV_KEYS = {
    key for env_key, _, aliases in SEMANTIC_ENV_BINDINGS for key in (env_key, *aliases)
}

TRUE_TEXT = {"1", "true", "yes", "on"}
FALSE_TEXT = {"0", "false", "no", "off"}


def parse_boolean_text(value: Any) -> bool | None:
    """Tri-state parse; None means "not a boolean", never a silent default."""
    if isinstance(value, bool):
        return value
    if value is None:
        return None
    text = str(value).strip().lower()
    if text in TRUE_TEXT:
        return True
    if text in FALSE_TEXT:
        return False
    return None


def _read_path(config: dict[str, Any], path: tuple[str, ...]) -> Any:
    node: Any = config
    for key in path:
        if not isinstance(node, dict):
            return None
        node = node.get(key)
    return node


def _write_path(config: dict[str, Any], path: tuple[str, ...], value: Any) -> None:
    node = config
    for key in path[:-1]:
        child = node.get(key)
        if not isinstance(child, dict):
            child = {}
            node[key] = child
        node = child
    node[path[-1]] = value


def migrate_config_aliases(config: dict[str, Any]) -> dict[str, Any]:
    """Return canonical env names and typed Lean/Sage fields.

    Same rules as normalizeLegacySemanticEnv in Node: an explicit typed field
    wins over server.env, the canonical key wins over its aliases, and a value
    that is not a boolean is left where it is so validation can reject it.
    """
    migrated = copy.deepcopy(config)
    env = migrated.setdefault("server", {}).setdefault("env", {})
    if not isinstance(env, dict):
        return migrated

    for env_key, path, aliases in SEMANTIC_ENV_BINDINGS:
        present = [key for key in (env_key, *aliases) if key in env]
        if not present:
            continue
        typed = _read_path(migrated, path)
        if isinstance(typed, bool):
            for key in present:
                env.pop(key, None)
            continue
        parsed = parse_boolean_text(env[present[0]])
        if parsed is None:
            continue
        _write_path(migrated, path, parsed)
        for key in present:
            env.pop(key, None)
    return migrated


def load_config(config_path: Path) -> dict[str, Any]:
    if config_path.exists():
        with config_path.open("r", encoding="utf-8") as fh:
            raw = json.load(fh)
    else:
        raw = {}
    return deep_merge(DEFAULT_CONFIG, migrate_config_aliases(raw))


def save_config(config_path: Path, config: dict[str, Any]) -> None:
    config_path.parent.mkdir(parents=True, exist_ok=True)
    with config_path.open("w", encoding="utf-8") as fh:
        json.dump(config, fh, indent=2, ensure_ascii=False)
        fh.write("\n")


def get_path(config: dict[str, Any], dotted: str) -> Any:
    cur: Any = config
    for part in dotted.split("."):
        cur = cur[part]
    return cur


def get_path_or(config: dict[str, Any], dotted: str, default: Any = None) -> Any:
    """get_path for keys a config predating them may simply not have.

    The picker reads settings this dialog itself introduces (modelsDir, dspark),
    so an older ds4-ui.config.json must not crash the startup window.
    """
    try:
        return get_path(config, dotted)
    except (KeyError, TypeError):
        return default


ATTACH_STUB = "./scripts/halogen_attach_stub.sh"

# Sampling keys an endpoint may override, and that apply_local must put back.
SAMPLING_KEYS = ("temperature", "top_p", "top_k", "min_p", "seed",
                 "max_tokens_safety_cap")


@dataclass(frozen=True)
class Endpoint:
    """An OpenAI-compatible server DS4 Studio points at instead of launching."""
    name: str
    base_url: str
    model: str = ""
    # Sampling this backend needs, which is not the local engine's. Qwen3
    # thinking models collapse into endless repetition under greedy decoding,
    # and requestDefaults ships temperature 0 for DeepSeek V4 Flash.
    request_defaults: tuple[tuple[str, Any], ...] = ()

    kind = "endpoint"

    @property
    def label(self) -> str:
        return f"{self.name}   {self.base_url}"


def endpoint_target(base_url: str) -> tuple[str, int]:
    """(host, port) for an OpenAI-compatible base URL.

    backendBase() in frontend/server/index.mjs builds the backend origin as
    `http://${host}:${port}` and every caller appends its own /v1/... path. The
    config can therefore carry a host and a port and nothing else: a path prefix
    other than /v1, https, or credentials cannot survive the round trip. Refuse
    them instead of silently dropping the part that will not be sent.
    """
    from urllib.parse import urlparse
    parsed = urlparse(base_url.strip())
    if parsed.scheme != "http":
        raise ValueError("only http:// is supported (got %r)" % (parsed.scheme or "no scheme"))
    if not parsed.hostname:
        raise ValueError("no host in base URL")
    if parsed.username or parsed.password or parsed.query:
        raise ValueError("credentials and query strings are not supported")
    path = (parsed.path or "").rstrip("/")
    if path not in ("", "/v1"):
        raise ValueError("path %r cannot be represented: the frontend only sends "
                         "/v1/... to host:port" % path)
    return parsed.hostname, parsed.port or 80


def probe_endpoint(base_url: str, timeout: float = 4.0) -> list[str]:
    """Model ids the endpoint advertises. Raises if it is not reachable."""
    import urllib.request
    host, port = endpoint_target(base_url)
    with urllib.request.urlopen("http://%s:%d/v1/models" % (host, port), timeout=timeout) as fh:
        payload = json.load(fh)
    data = payload.get("data") if isinstance(payload, dict) else None
    if not isinstance(data, list):
        raise ValueError("/v1/models did not return an OpenAI model list")
    return [str(m["id"]) for m in data if isinstance(m, dict) and m.get("id")]


def apply_endpoint(config: dict[str, Any], endpoint: Endpoint, model_id: str) -> None:
    host, port = endpoint_target(endpoint.base_url)
    server = config.setdefault("server", {})
    attach = dict(server.get("attach") or {})
    if attach.get("mode") != "endpoint":
        # Remember the local backend verbatim. Restoring it later by guessing
        # "./ds4-wrapper with wrapper.enabled" would overwrite a deliberate
        # plain-ds4-server setup.
        attach = {"savedLocal": {
            "binary": server.get("binary"),
            # host/port are overwritten with the endpoint's own. Without saving
            # them, going back to local left the engine bound to the endpoint's
            # port -- ./ds4-wrapper --port 8731, straight onto the server it had
            # just detached from.
            "host": server.get("host"),
            "port": server.get("port"),
            "wrapperEnabled": bool((config.get("wrapper") or {}).get("enabled")),
            "requestDefaults": {k: v for k, v in (config.get("requestDefaults") or {}).items()
                                if k in SAMPLING_KEYS},
        }}
    attach.update(mode="endpoint", name=endpoint.name,
                  baseUrl=endpoint.base_url, model=model_id)
    server["attach"] = attach
    server["host"] = host
    server["port"] = port
    # index.mjs spawns server.binary unconditionally at boot; there is nothing
    # to launch here, so the stub stands in and stays alive.
    server["binary"] = ATTACH_STUB
    # Readiness then falls back from /api/wrapper/status to GET /v1/models.
    config.setdefault("wrapper", {})["enabled"] = False
    defaults = config.setdefault("requestDefaults", {})
    defaults["model"] = model_id
    for key, value in endpoint.request_defaults:
        defaults[key] = value


def apply_local(config: dict[str, Any]) -> None:
    server = config.setdefault("server", {})
    attach = dict(server.get("attach") or {})
    if attach.get("mode") == "endpoint":
        saved = attach.get("savedLocal") or {}
        if saved.get("binary"):
            server["binary"] = saved["binary"]
        if saved.get("host"):
            server["host"] = saved["host"]
        if saved.get("port"):
            server["port"] = saved["port"]
        if "wrapperEnabled" in saved:
            config.setdefault("wrapper", {})["enabled"] = bool(saved["wrapperEnabled"])
        for key, value in (saved.get("requestDefaults") or {}).items():
            config.setdefault("requestDefaults", {})[key] = value
    server["attach"] = {"mode": "local"}


def config_endpoints(config: dict[str, Any]) -> list[Endpoint]:
    out: list[Endpoint] = []
    for raw in (get_path_or(config, "server.endpoints", []) or []):
        if not isinstance(raw, dict) or not raw.get("baseUrl"):
            continue
        rd = raw.get("requestDefaults")
        out.append(Endpoint(name=str(raw.get("name") or raw["baseUrl"]),
                            base_url=str(raw["baseUrl"]),
                            model=str(raw.get("model") or ""),
                            request_defaults=tuple(sorted(rd.items())) if isinstance(rd, dict) else ()))
    return out


def pin_per_model_overrides(config: dict[str, Any], before: dict[str, Any]) -> list[str]:
    """Record hand-edited model-dependent keys under server.perModel[<file>].

    srun_reconcile.py re-derives DERIVED on every launch, so a value typed into
    this dialog was handed straight back to the recommendation on the next
    ./srun.sh -- ctx 131072 became 550000 again, a 78GB expert cache became
    38GB. perModel is the "the user said so" escape hatch reconcile already
    honours; nothing ever wrote to it, which is what "Save does not save all
    parameters" actually was.
    """
    server = config.setdefault("server", {})
    model = str(server.get("model") or "").strip()
    if not model:
        return []
    name = Path(model).name
    old_server = (before or {}).get("server", {}) or {}
    if Path(str(old_server.get("model") or "")).name != name:
        # The model changed inside this dialog: the values on screen belong to
        # the recommendation for the new model, not to a user decision about it.
        return []
    per = server.setdefault("perModel", {})
    bucket = dict(per.get(name) or {})
    changed: list[str] = []
    for key in DERIVED_KEYS:
        if key in server and server.get(key) != old_server.get(key):
            bucket[key] = server[key]
            changed.append(key)
    if bucket:
        per[name] = bucket
    else:
        per.pop(name, None)
    if not per:
        server.pop("perModel", None)
    return changed


def set_path(config: dict[str, Any], dotted: str, value: Any) -> None:
    parts = dotted.split(".")
    cur: Any = config
    for part in parts[:-1]:
        cur = cur.setdefault(part, {})
    cur[parts[-1]] = value


def parse_bool(value: str) -> bool:
    return value.strip().lower() in {"1", "true", "yes", "on"}


def parse_value(path: str, raw: str) -> Any:
    field = FIELD_BY_PATH.get(path)
    kind = field.kind if field else ("env_string" if path.startswith("server.env.") else "string")
    text = raw.strip()
    if kind == "bool":
        return parse_bool(text)
    if kind == "auto_or_positive_int":
        return "auto" if text.lower() == "auto" else int(text)
    if kind in {"positive_int", "nonnegative_int", "port"}:
        return int(text)
    if kind in {"float", "optional_float"}:
        if kind == "optional_float" and text == "":
            return ""
        return float(text) if any(ch in text for ch in ".eE") else int(text)
    if kind.startswith("env_"):
        return raw
    return raw


def apply_sets(config: dict[str, Any], sets: list[str]) -> None:
    for item in sets:
        if "=" not in item:
            raise ValueError(f"--set requires path=value, got: {item}")
        path, raw = item.split("=", 1)
        set_path(config, path, parse_value(path, raw))


def is_int_like(value: Any) -> bool:
    if isinstance(value, bool):
        return False
    if isinstance(value, int):
        return value >= 0
    if isinstance(value, str) and value.isdecimal():
        return True
    return False


def int_value(value: Any) -> int | None:
    if is_int_like(value):
        return int(value)
    return None


def validate_config(config: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    server = config.get("server", {})
    for key in ["binary", "model", "host"]:
        if not str(server.get(key, "")).strip():
            errors.append(f"server.{key} is required")
    for key in ["ctx", "tokens", "mtpDraft", "kvDiskSpaceMb", "kvCacheMinTokens", "toolMemoryMaxIds", "maxQueuedJobs"]:
        n = int_value(server.get(key))
        if n is None or n <= 0:
            errors.append(f"server.{key} must be a positive integer")
    for key in ["threads", "kvCacheColdMaxTokens", "kvCacheContinuedIntervalTokens", "kvCacheBoundaryTrimTokens", "kvCacheBoundaryAlignTokens"]:
        if int_value(server.get(key)) is None:
            errors.append(f"server.{key} must be a non-negative integer")
    port = int_value(server.get("port"))
    if port is None or port < 1 or port > 65535:
        errors.append("server.port must be between 1 and 65535")
    if server.get("backend") not in {"auto", "metal", "cuda", "cpu"}:
        errors.append("server.backend must be one of auto, metal, cuda, cpu")
    env = server.get("env", {})
    if not isinstance(env, dict):
        errors.append("server.env must be an object")
    else:
        for key, value in env.items():
            if not key.startswith("DS4_"):
                errors.append(f"unsupported env key: {key}")
            if not isinstance(value, str):
                errors.append(f"{key} must be a string")
        chunk = env.get("DS4_METAL_PREFILL_CHUNK", "")
        if chunk:
            n = int_value(chunk)
            if n is None or n < 1 or n > 131072:
                errors.append("DS4_METAL_PREFILL_CHUNK must be between 1 and 131072 tokens")
        for key in PRESENCE_ENV_KEYS:
            value = env.get(key, "")
            if value not in {"", "1"}:
                errors.append(f"{key} must be empty or 1")
        for key in TOGGLE_ENV_KEYS:
            value = env.get(key, "")
            if value not in {"0", "1"}:
                errors.append(f"{key} must be 0 or 1")
    request_defaults = config.get("requestDefaults", {})
    if not isinstance(request_defaults, dict):
        errors.append("requestDefaults must be an object")
    else:
        max_tokens = request_defaults.get("max_tokens")
        if not (isinstance(max_tokens, str) and max_tokens.strip().lower() == "auto"):
            n = int_value(max_tokens)
            if n is None or n <= 0:
                errors.append("requestDefaults.max_tokens must be auto or a positive integer")
        n = int_value(request_defaults.get("max_tokens_safety_cap"))
        if n is None or n <= 0:
            errors.append("requestDefaults.max_tokens_safety_cap must be a positive integer")
        if int_value(request_defaults.get("context_margin")) is None:
            errors.append("requestDefaults.context_margin must be a non-negative integer")

    wrapper = config.get("wrapper", {})
    if not isinstance(wrapper, dict):
        errors.append("wrapper must be an object")
    else:
        if not str(wrapper.get("binary", "")).strip():
            errors.append("wrapper.binary is required")
        if wrapper.get("startupMode") not in {"server", "agent"}:
            errors.append("wrapper.startupMode must be server or agent")
        if int_value(wrapper.get("ramFreezeMaxMb")) is None:
            errors.append("wrapper.ramFreezeMaxMb must be a non-negative integer")
    # The six semantic switches are typed fields now; anything still sitting in
    # server.env is a value migrate_config_aliases could not parse.
    if isinstance(env, dict):
        for key in env:
            if key in LEGACY_SEMANTIC_ENV_KEYS:
                errors.append(f"{key} must be configured through the typed Lean/Sage fields")
    for path in (
        "lean.enabled",
        "lean.policyAuto",
        "lean.orchestration.enabled",
        "lean.orchestration.prompt",
        "sage.policyAuto",
        "sage.orchestration.enabled",
        "sage.orchestration.prompt",
        "contextWiki.enabled",
        "contextWiki.previewOnly",
        "contextWiki.deltaRequired",
        "contextWiki.telemetry",
    ):
        value = get_path(config, path)
        if value is not None and not isinstance(value, bool):
            errors.append(f"{path} must be boolean")
    for path in (
        "contextWiki.softTokens",
        "contextWiki.hardTokens",
        "contextWiki.maxGrowthPct",
        "contextWiki.maxEvidence",
        "contextWiki.maxLedgerEvents",
        "lean.orchestration.maxAttempts",
        "lean.orchestration.maxSameFailure",
        "lean.orchestration.maxPrematureFinalizations",
        "lean.orchestration.maxWallClockMs",
        "sage.orchestration.maxComputeAttempts",
        "sage.orchestration.maxRepairAttempts",
        "sage.orchestration.maxValidationAttempts",
        "sage.orchestration.maxPlotAttempts",
        "sage.orchestration.maxPrematureFinalizations",
        "sage.orchestration.maxSameFailure",
        "sage.orchestration.maxWallClockMs",
        "sage.orchestration.maxTotalToolCalls",
    ):
        value = get_path(config, path)
        if value is None:
            continue
        n = int_value(value)
        if n is None or n <= 0:
            errors.append(f"{path} must be positive integer")
    soft = int_value(get_path(config, "contextWiki.softTokens"))
    hard = int_value(get_path(config, "contextWiki.hardTokens"))
    if soft is not None and hard is not None and soft > hard:
        errors.append("contextWiki.softTokens must not exceed contextWiki.hardTokens")
    return errors


class ModelPickerDialog:
    """Step 1: pick a GGUF from the models directory.

    Selecting one previews the parameters srun_model_scan derives from the
    file's own size and metadata; confirming writes them into the config so
    the tuning screen opens with the recommendation already applied.
    """

    def __init__(self, config_path: Path, config: dict[str, Any]):
        import tkinter as tk
        from tkinter import ttk, filedialog

        self.tk = tk
        self.ttk = ttk
        self.filedialog = filedialog
        self.config_path = config_path
        self.config = config
        self.models: list[Any] = []
        self.rows: list[Any] = []
        self.recommendation: dict[str, Any] | None = None
        self.exit_code = EXIT_CANCEL
        self.root = tk.Tk()
        self.root.title("DS4 Studio - select model")
        self.root.geometry("1040x660")
        self.root.protocol("WM_DELETE_WINDOW", self.cancel)
        self.build()
        self.rescan()

    def build(self) -> None:
        tk, ttk = self.tk, self.ttk

        top = ttk.Frame(self.root)
        top.pack(fill="x", padx=10, pady=(10, 4))
        ttk.Label(top, text="Models directory").pack(side="left")
        self.dir_var = tk.StringVar(value=str(get_path_or(self.config, "server.modelsDir", "") or ""))
        ttk.Entry(top, textvariable=self.dir_var).pack(side="left", fill="x", expand=True, padx=8)
        ttk.Button(top, text="Browse", command=self.browse).pack(side="left")
        ttk.Button(top, text="Rescan", command=self.rescan).pack(side="left", padx=(8, 0))

        body = ttk.Frame(self.root)
        body.pack(fill="both", expand=True, padx=10, pady=4)

        cols = ("kind", "size", "name")
        self.tree = ttk.Treeview(body, columns=cols, show="headings", height=12)
        for col, title, width in (("kind", "Kind", 130), ("size", "Size", 90), ("name", "File", 700)):
            self.tree.heading(col, text=title)
            self.tree.column(col, width=width, anchor="w")
        self.tree.pack(side="left", fill="both", expand=True)
        bar = ttk.Scrollbar(body, orient="vertical", command=self.tree.yview)
        bar.pack(side="left", fill="y")
        self.tree.configure(yscrollcommand=bar.set)
        self.tree.bind("<<TreeviewSelect>>", lambda _e: self.preview())
        self.tree.bind("<Double-1>", lambda _e: self.ok())

        opts = ttk.Frame(self.root)
        opts.pack(fill="x", padx=10)
        self.dspark_var = tk.BooleanVar(value=bool(get_path_or(self.config, "server.dspark", False)))
        ttk.Checkbutton(opts, text="Use DSpark support model when present "
                                   "(+4.8% decode, costs 5.6 GiB and context)",
                        variable=self.dspark_var,
                        command=self.preview).pack(side="left")
        self.reset_var = tk.BooleanVar(value=False)
        ttk.Checkbutton(opts, text="Forget my saved values for this model",
                        variable=self.reset_var,
                        command=self.preview).pack(side="left", padx=(16, 0))
        ttk.Label(opts, text="Endpoint model").pack(side="left", padx=(16, 4))
        self.ep_model_var = tk.StringVar(value="")
        self.ep_model = ttk.Combobox(opts, textvariable=self.ep_model_var,
                                     values=[], state="readonly", width=34)
        self.ep_model.pack(side="left")
        ttk.Button(opts, text="Add endpoint", command=self.add_endpoint).pack(side="left", padx=(8, 0))

        ttk.Label(self.root, text="Recommended parameters").pack(anchor="w", padx=10, pady=(8, 0))
        self.detail = tk.Text(self.root, height=11, wrap="word")
        self.detail.pack(fill="both", expand=False, padx=10, pady=(2, 4))
        self.detail.configure(state="disabled")

        buttons = ttk.Frame(self.root)
        buttons.pack(fill="x", padx=10, pady=(0, 10))
        ttk.Button(buttons, text="Use these and continue",
                   command=self.ok).pack(side="right", padx=(8, 0))
        ttk.Button(buttons, text="Skip (keep current config)",
                   command=self.skip).pack(side="right", padx=(8, 0))
        ttk.Button(buttons, text="Cancel", command=self.cancel).pack(side="right")

    def browse(self) -> None:
        chosen = self.filedialog.askdirectory(title="Models directory",
                                              initialdir=self.dir_var.get() or str(Path.home()))
        if chosen:
            self.dir_var.set(chosen)
            self.rescan()

    def set_detail(self, text: str) -> None:
        self.detail.configure(state="normal")
        self.detail.delete("1.0", "end")
        self.detail.insert("1.0", text)
        self.detail.configure(state="disabled")

    def rescan(self) -> None:
        raw = self.dir_var.get().strip()
        self.tree.delete(*self.tree.get_children())
        self.models = []
        self.rows = []
        self.recommendation = None
        note = ""

        # Endpoints are listed even with no models directory: a machine that
        # only ever attaches to a remote backend has no .gguf to scan.
        for endpoint in config_endpoints(self.config):
            self.rows.append(endpoint)
            self.tree.insert("", "end", values=("endpoint", "-", endpoint.label))

        if not raw:
            note = "Pick the directory that holds your .gguf files."
        else:
            path = Path(raw).expanduser()
            if not path.is_dir():
                note = f"Not a directory: {path}"
            else:
                try:
                    self.models = scan_models(path)
                except Exception as err:
                    note = f"Scan failed: {err}"
                if not note and not self.models:
                    note = f"No .gguf files in {path}"
        for model in self.models:
            self.rows.append(model)
            self.tree.insert("", "end", values=(model.kind, f"{model.gib:.2f} GiB", model.label))

        if not self.rows:
            self.set_detail(note or "Nothing to launch: no endpoints and no .gguf files.")
            return

        current = str(get_path_or(self.config, "server.model", "") or "")
        attached = get_path_or(self.config, "server.attach", {}) or {}
        index = None
        for i, row in enumerate(self.rows):
            if isinstance(row, Endpoint):
                if attached.get("mode") == "endpoint" and attached.get("baseUrl") == row.base_url:
                    index = i
            elif attached.get("mode") != "endpoint" and str(row.path) == current:
                index = i
        if index is None:
            index = next((i for i, r in enumerate(self.rows)
                          if not isinstance(r, Endpoint) and r.kind == "target"), 0)
        item = self.tree.get_children()[index]
        self.tree.selection_set(item)
        self.tree.see(item)
        if note:
            self.set_detail(note)
        self.preview()

    def selected_row(self) -> Any:
        sel = self.tree.selection()
        if not sel:
            return None
        return self.rows[self.tree.index(sel[0])]

    def add_endpoint(self) -> None:
        from tkinter import simpledialog, messagebox
        url = simpledialog.askstring("Add endpoint",
                                     "Base URL of the OpenAI-compatible server\n"
                                     "(e.g. http://127.0.0.1:8731/v1)",
                                     parent=self.root)
        if not url:
            return
        try:
            endpoint_target(url)
        except ValueError as err:
            messagebox.showerror("Unusable endpoint", str(err))
            return
        name = simpledialog.askstring("Add endpoint", "Name for this endpoint",
                                      parent=self.root) or url
        listed = list(get_path_or(self.config, "server.endpoints", []) or [])
        listed.append({"name": name, "baseUrl": url})
        set_path(self.config, "server.endpoints", listed)
        self.rescan()

    def preview_endpoint(self, endpoint: Endpoint) -> None:
        self.recommendation = None
        try:
            models = probe_endpoint(endpoint.base_url)
        except Exception as err:
            self.ep_model["values"] = []
            self.set_detail(f"{endpoint.label}\n\nUNREACHABLE\n\n{err}\n\n"
                            f"Start the server, or remove it from server.endpoints.")
            return
        self.ep_model["values"] = models
        wanted = endpoint.model or str(get_path_or(self.config, "server.attach.model", "") or "")
        self.ep_model_var.set(wanted if wanted in models else (models[0] if models else ""))
        host, port = endpoint_target(endpoint.base_url)
        lines = [f"{endpoint.label}", "",
                 f"  backend origin                     http://{host}:{port}",
                 f"  models advertised                  {len(models)}"]
        lines += [f"    - {m}" for m in models[:12]]
        lines += ["",
                  "  DS4 Studio will not launch an engine: it points the frontend at this",
                  "  server. Chat, streaming and tool calling go through /v1/chat/completions.",
                  "",
                  "  ! Wrapper-only features stay unavailable: native agent mode",
                  "    (/v1/ds4/stateful/chat/completions), wrapper status, engine metrics,",
                  "    /v1/token-count and /v1/cancel are not part of the OpenAI API."]
        self.set_detail("\n".join(lines))

    def preview(self) -> None:
        model = self.selected_row()
        if isinstance(model, Endpoint):
            self.preview_endpoint(model)
            return
        if model is None:
            self.set_detail("Select a model.")
            return
        if model.kind != "target":
            self.recommendation = None
            self.set_detail(
                f"{model.label}\n\nThis is a {model.kind} sidecar, not a model you launch. "
                f"Pick the target it belongs to; the matching sidecar is attached automatically.")
            return
        rec = recommend_settings(model, self.models, want_dspark=self.dspark_var.get())
        if rec.get("blocked"):
            # Refuse to seed a config this machine cannot launch.
            self.recommendation = None
            self.set_detail(f"{model.label}   ({model.gib:.2f} GiB, arch {model.arch})\n\n"
                            f"THIS MACHINE CANNOT RUN THIS MODEL\n\n{rec['blocked']}")
            return
        self.recommendation = rec
        pinned = {} if self.reset_var.get() else (
            (get_path_or(self.config, "server.perModel", {}) or {}).get(model.path.name) or {})
        lines = [f"{model.label}   ({model.gib:.2f} GiB, arch {model.arch or 'unknown'})", ""]
        for key, value in rec["settings"].items():
            short = key[len("server."):] if key.startswith("server.") else ""
            mark = ""
            if short in pinned:
                value, mark = pinned[short], "   <- your saved value"
            if value in ("", False, None):
                continue
            shown = Path(str(value)).name if key in ("server.model", "server.vision", "server.mtp") else value
            lines.append(f"  {key:34} {shown}{mark}")
        lines.append("")
        lines.append(f"  budget {rec['budget_gib']:.2f} GiB of resident weights + KV/context buffers")
        for note in rec["notes"]:
            lines.append(f"  - {note}")
        for warning in rec["warnings"]:
            lines.append(f"  ! {warning}")
        self.set_detail("\n".join(lines))

    def apply_recommendation(self) -> bool:
        row = self.selected_row()
        if isinstance(row, Endpoint):
            model_id = self.ep_model_var.get().strip()
            if not model_id:
                # The combobox is empty when the preview probe failed. Probe
                # again here rather than repeating "unreachable or advertises
                # none": it recovers if the server came up in the meantime, and
                # otherwise it can name the actual failure.
                try:
                    models = probe_endpoint(row.base_url)
                except Exception as err:
                    self.set_detail(f"{row.label}\n\nCannot attach: {err}\n\n"
                                    f"Start the server, then press Rescan.")
                    return False
                if not models:
                    self.set_detail(f"{row.label}\n\nReachable, but /v1/models is empty: "
                                    f"there is no model id to send.")
                    return False
                model_id = models[0]
            set_path(self.config, "server.modelsDir", self.dir_var.get().strip())
            apply_endpoint(self.config, row, model_id)
            return True
        rec = self.recommendation
        if rec is None:
            self.set_detail("Select a target model first (sidecars cannot be launched on their own).")
            return False
        set_path(self.config, "server.modelsDir", self.dir_var.get().strip())
        apply_local(self.config)
        name = Path(str(rec["settings"].get("server.model") or "")).name
        per = self.config.setdefault("server", {}).setdefault("perModel", {})
        if self.reset_var.get():
            per.pop(name, None)
        overrides = per.get(name) or {}
        for key, value in rec["settings"].items():
            short = key[len("server."):] if key.startswith("server.") else ""
            if short in overrides:
                value = overrides[short]
            set_path(self.config, key, value)
        return True

    def skip(self) -> None:
        set_path(self.config, "server.modelsDir", self.dir_var.get().strip())
        self.exit_code = EXIT_OK
        self.root.destroy()

    def ok(self) -> None:
        if not self.apply_recommendation():
            return
        self.exit_code = EXIT_OK
        self.root.destroy()

    def cancel(self) -> None:
        self.exit_code = EXIT_CANCEL
        self.root.destroy()

    def run(self) -> int:
        self.root.mainloop()
        return self.exit_code


class TuningDialog:
    def __init__(self, config_path: Path, config: dict[str, Any]):
        import tkinter as tk
        from tkinter import ttk

        self.tk = tk
        self.ttk = ttk
        self.config_path = config_path
        self.config = config
        self.vars: dict[str, Any] = {}
        self.exit_code = EXIT_CANCEL
        self.root = tk.Tk()
        self.root.title("DS4 Studio startup tuning")
        self.root.geometry("980x760")
        self.root.protocol("WM_DELETE_WINDOW", self.cancel)
        self.build()

    def build(self) -> None:
        ttk = self.ttk
        notebook = ttk.Notebook(self.root)
        notebook.pack(fill="both", expand=True, padx=10, pady=10)

        tabs: dict[str, Any] = {}
        # Derived from the fields themselves: a hardcoded list silently drifts
        # and the first field naming a missing tab kills the whole startup GUI
        # with KeyError (that is exactly how the Lean tab broke srun.sh).
        # TAB_ORDER only decides the order of the tabs it knows about.
        for tab in tab_names():
            frame = ttk.Frame(notebook)
            notebook.add(frame, text=tab)
            tabs[tab] = self.scroll_frame(frame)

        for field in ALL_FIELDS:
            self.add_field(tabs[field.tab], field)

        self.add_extra_env(tabs["Extra Env"])

        buttons = ttk.Frame(self.root)
        buttons.pack(fill="x", padx=10, pady=(0, 10))
        ttk.Button(buttons, text="OK", command=self.ok).pack(side="right", padx=(8, 0))
        ttk.Button(buttons, text="Save", command=self.save_only).pack(side="right", padx=(8, 0))
        ttk.Button(buttons, text="Cancel", command=self.cancel).pack(side="right")

    def scroll_frame(self, parent: Any) -> Any:
        tk = self.tk
        canvas = tk.Canvas(parent, highlightthickness=0)
        scrollbar = self.ttk.Scrollbar(parent, orient="vertical", command=canvas.yview)
        inner = self.ttk.Frame(canvas)
        inner.bind("<Configure>", lambda _event: canvas.configure(scrollregion=canvas.bbox("all")))
        canvas.create_window((0, 0), window=inner, anchor="nw")
        canvas.configure(yscrollcommand=scrollbar.set)
        canvas.pack(side="left", fill="both", expand=True)
        scrollbar.pack(side="right", fill="y")
        return inner

    def add_field(self, parent: Any, field: Field) -> None:
        tk = self.tk
        ttk = self.ttk
        row = len(parent.grid_slaves()) // 2
        ttk.Label(parent, text=field.label).grid(row=row, column=0, sticky="w", padx=8, pady=5)
        value = field_value(self.config, field)
        if field.kind in {"bool", "env_toggle"}:
            if field.kind == "env_toggle":
                value = parse_bool(str(value))
            var = tk.BooleanVar(value=bool(value))
            widget = ttk.Checkbutton(parent, variable=var)
        elif field.kind == "backend":
            var = tk.StringVar(value=str(value))
            widget = ttk.Combobox(parent, textvariable=var, values=["auto", "metal", "cuda", "cpu"], state="readonly")
        elif field.kind == "startup_mode":
            var = tk.StringVar(value=str(value))
            widget = ttk.Combobox(parent, textvariable=var, values=["server", "agent"], state="readonly")
        elif field.kind == "env_flag":
            var = tk.StringVar(value=str(value))
            widget = ttk.Combobox(parent, textvariable=var, values=["", "1"], state="readonly")
        else:
            var = tk.StringVar(value=str(value))
            widget = ttk.Entry(parent, textvariable=var, width=72)
        self.vars[field.path] = (var, field.kind)
        widget.grid(row=row, column=1, sticky="ew", padx=8, pady=5)
        parent.columnconfigure(1, weight=1)

    def add_extra_env(self, parent: Any) -> None:
        env = self.config.get("server", {}).get("env", {})
        extra = {key: value for key, value in env.items() if key not in KNOWN_ENV_KEYS}
        self.ttk.Label(parent, text="Extra DS4_* environment variables, one KEY=VALUE per line").pack(anchor="w", padx=8, pady=8)
        self.extra_env = self.tk.Text(parent, height=8, width=80)
        self.extra_env.pack(fill="both", expand=True, padx=8, pady=8)
        self.extra_env.insert("1.0", "\n".join(f"{key}={value}" for key, value in sorted(extra.items())))

    def collect(self) -> dict[str, Any]:
        config = copy.deepcopy(self.config)
        for path, (var, kind) in self.vars.items():
            raw = str(var.get())
            value = raw
            if kind == "bool":
                value = bool(var.get())
            elif kind == "env_toggle":
                value = "1" if bool(var.get()) else "0"
            elif kind == "auto_or_positive_int":
                value = parse_value(path, raw)
            elif kind in {"positive_int", "nonnegative_int", "port"}:
                value = int(raw.strip())
            elif kind in {"float", "optional_float"}:
                value = "" if kind == "optional_float" and raw.strip() == "" else parse_value(path, raw)
            set_path(config, path, value)

        env = config.setdefault("server", {}).setdefault("env", {})
        for key in list(env.keys()):
            if key not in KNOWN_ENV_KEYS and key.startswith("DS4_"):
                del env[key]
        for line in self.extra_env.get("1.0", "end").splitlines():
            text = line.strip()
            if not text:
                continue
            if "=" not in text:
                raise ValueError(f"extra env line must be KEY=VALUE: {text}")
            key, value = text.split("=", 1)
            env[key.strip()] = value

        pin_per_model_overrides(config, self.config)
        return config

    def save_collected(self) -> bool:
        from tkinter import messagebox

        try:
            config = self.collect()
            errors = validate_config(config)
            if errors:
                messagebox.showerror("Invalid startup parameters", "\n".join(errors[:12]))
                return False
            save_config(self.config_path, config)
            self.config = config
            return True
        except Exception as err:  # pragma: no cover - exercised manually by GUI users.
            messagebox.showerror("Unable to save startup parameters", str(err))
            return False

    def ok(self) -> None:
        if self.save_collected():
            self.exit_code = EXIT_OK
            self.root.destroy()

    def save_only(self) -> None:
        if self.save_collected():
            self.exit_code = EXIT_SAVE_ONLY
            self.root.destroy()

    def cancel(self) -> None:
        self.exit_code = EXIT_CANCEL
        self.root.destroy()

    def run(self) -> int:
        self.root.mainloop()
        return self.exit_code


def run_headless(config_path: Path, action: str, sets: list[str]) -> int:
    before = load_config(config_path)
    config = load_config(config_path)
    apply_sets(config, sets)
    pin_per_model_overrides(config, before)
    if action == "cancel":
        print("srun_tuning_gui: canceled")
        return EXIT_CANCEL
    errors = validate_config(config)
    if errors:
        for error in errors:
            print(f"srun_tuning_gui: {error}", file=sys.stderr)
        return EXIT_ERROR
    save_config(config_path, config)
    if action == "save":
        print("srun_tuning_gui: saved")
        return EXIT_SAVE_ONLY
    print("srun_tuning_gui: confirmed")
    return EXIT_OK


def self_check() -> int:
    """Round-trip the thing that was broken: edit -> save -> relaunch."""
    base = {"server": {"model": "/m/A.gguf", "ctx": 550000, "power": 100,
                       "ssdStreamingCacheExperts": "38GB", "host": "127.0.0.1"}}

    edited = copy.deepcopy(base)
    edited["server"].update(ctx=131072, ssdStreamingCacheExperts="78GB")
    assert sorted(pin_per_model_overrides(edited, base)) == ["ctx", "ssdStreamingCacheExperts"]
    assert edited["server"]["perModel"]["A.gguf"] == {"ctx": 131072, "ssdStreamingCacheExperts": "78GB"}

    # reconcile hands the recommendation back only where nothing was pinned
    over = edited["server"]["perModel"]["A.gguf"]
    for key, derived in (("ctx", 550000), ("power", 90), ("ssdStreamingCacheExperts", "38GB")):
        effective = over[key] if key in over else derived
        assert effective == {"ctx": 131072, "power": 90,
                             "ssdStreamingCacheExperts": "78GB"}[key], key

    # saving without touching anything must not invent overrides
    untouched = copy.deepcopy(base)
    assert pin_per_model_overrides(untouched, base) == []
    assert "perModel" not in untouched["server"]

    # switching model in the dialog must not pin the old model's values
    switched = copy.deepcopy(base)
    switched["server"].update(model="/m/B.gguf", ctx=4096)
    assert pin_per_model_overrides(switched, base) == []

    # Editing a pinned key again re-pins it. This dialog has no recommendation
    # to compare against, so "same as recommended" is indistinguishable from any
    # other typed value; the picker checkbox is the documented way back.
    back = copy.deepcopy(edited)
    back["server"]["ctx"] = 550000
    assert pin_per_model_overrides(back, edited) == ["ctx"]
    assert back["server"]["perModel"]["A.gguf"]["ctx"] == 550000

    # endpoints: only what backendBase() can actually express
    assert endpoint_target("http://127.0.0.1:8731/v1") == ("127.0.0.1", 8731)
    assert endpoint_target("http://box.lan:8731") == ("box.lan", 8731)
    assert endpoint_target("http://box.lan/v1/") == ("box.lan", 80)
    for bad in ("https://host/v1", "http://host/openai/v1", "ftp://host",
                "http://user:pw@host/v1", "http://host/v1?key=1", "http:///v1"):
        try:
            endpoint_target(bad)
        except ValueError:
            pass
        else:
            raise AssertionError("accepted an unrepresentable base URL: %s" % bad)

    # attach round trip must restore the local backend verbatim
    local = {"server": {"binary": "./ds4-server", "host": "127.0.0.1", "port": 8002},
             "wrapper": {"enabled": False},
             "requestDefaults": {"model": "deepseek-v4-flash", "temperature": 0, "top_p": 1}}
    cfg = copy.deepcopy(local)
    apply_endpoint(cfg, Endpoint("Halogen", "http://127.0.0.1:8731/v1",
                                 request_defaults=(("temperature", 0.7), ("top_p", 0.8))),
                   "halogen-qwen3.8-flash-next")
    assert cfg["requestDefaults"]["temperature"] == 0.7
    assert (cfg["server"]["host"], cfg["server"]["port"]) == ("127.0.0.1", 8731)
    assert cfg["server"]["binary"] == ATTACH_STUB
    assert cfg["wrapper"]["enabled"] is False
    assert cfg["requestDefaults"]["model"] == "halogen-qwen3.8-flash-next"
    assert cfg["server"]["attach"]["mode"] == "endpoint"

    # switching endpoint twice must not overwrite savedLocal with the stub
    apply_endpoint(cfg, Endpoint("Other", "http://box.lan:9000/v1"), "other-model")
    saved = cfg["server"]["attach"]["savedLocal"]
    assert saved["binary"] == "./ds4-server" and saved["wrapperEnabled"] is False
    assert saved["requestDefaults"] == {"temperature": 0, "top_p": 1}

    apply_local(cfg)
    assert cfg["server"]["binary"] == "./ds4-server"
    assert cfg["wrapper"]["enabled"] is False        # restored, not forced to True
    assert cfg["requestDefaults"]["temperature"] == 0   # the local model's sampling is back
    assert cfg["server"]["port"] == 8002                # not the endpoint's port
    assert cfg["server"]["host"] == "127.0.0.1"
    assert cfg["server"]["attach"] == {"mode": "local"}

    print("srun_tuning_gui: self-check ok")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Edit DS4 Studio startup tuning before ./srun.sh launch.")
    parser.add_argument("--config", help="Path to frontend/ds4-ui.config.json")
    parser.add_argument("--headless-action", choices=["ok", "save", "cancel"], help="Test mode without tkinter")
    parser.add_argument("--self-check", action="store_true",
                        help="Run the save/relaunch round-trip assertions and exit")
    parser.add_argument("--set", action="append", default=[], help="Headless path=value override")
    parser.add_argument("--no-picker", action="store_true",
                        help="Skip the model selection screen and open the parameter screen directly")
    parser.add_argument("--models-dir",
                        help="Directory of .gguf models to list (overrides server.modelsDir)")
    args = parser.parse_args(argv)

    if args.self_check:
        return self_check()
    if not args.config:
        parser.error("--config is required")

    config_path = Path(args.config).expanduser().resolve()
    if args.headless_action:
        return run_headless(config_path, args.headless_action, args.set)

    try:
        config = load_config(config_path)
        if args.models_dir:
            set_path(config, "server.modelsDir", args.models_dir)
        if not args.no_picker:
            # Step 1 picks the model and seeds the recommendation; step 2 is the
            # existing full parameter screen, opened on the seeded config so the
            # recommended values are already in the widgets.
            picker = ModelPickerDialog(config_path, config)
            if picker.run() != EXIT_OK:
                return EXIT_CANCEL
            config = picker.config
        dialog = TuningDialog(config_path, config)
        return dialog.run()
    except Exception as err:
        print(f"srun_tuning_gui: {err}", file=sys.stderr)
        return EXIT_ERROR


if __name__ == "__main__":
    raise SystemExit(main())
