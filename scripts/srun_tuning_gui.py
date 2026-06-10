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
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any


EXIT_OK = 0
EXIT_SAVE_ONLY = 20
EXIT_CANCEL = 30
EXIT_ERROR = 2


DEFAULT_CONFIG: dict[str, Any] = {
    "selectedProfile": "",
    "control": {
        "host": "127.0.0.1",
        "port": 5173,
    },
    "history": {
        "enabled": False,
        "dir": "/home/tendermachine/workspace_ds4studio/history",
    },
    "server": {
        "binary": "./ds4-server",
        "model": "ds4flash.gguf",
        "mtp": "",
        "mtpDraft": 1,
        "mtpMargin": 3,
        "ctx": 32768,
        "tokens": 8192,
        "threads": 0,
        "backend": "auto",
        "quality": False,
        "warmWeights": False,
        "host": "127.0.0.1",
        "port": 8000,
        "maxQueuedJobs": 8,
        "env": {
            "DS4_METAL_PREFILL_CHUNK": "8192",
            "DS4_CUDA_Q8_F16_CACHE_MB": "11264",
            "DS4_CUDA_Q8_F16_CACHE_RESERVE_MB": "512",
            "DS4_CUDA_WEIGHT_ARENA_CHUNK_MB": "1024",
            "DS4_CUDA_COPY_MODEL_CHUNKED": "1",
            "DS4_CUDA_DIRECT_MODEL": "",
            "DS4_CUDA_NO_FD_CACHE": "",
            "DS4_CUDA_MOE_PROFILE": "",
            "DS4_METAL_GRAPH_PREFILL_PROFILE": "",
            "DS4_CUDA_MOE_NO_EXPERT_TILES": "",
            "DS4_CUDA_MOE_TILE4": "",
            "DS4_CUDA_MOE_WRITE_GATE_UP": "",
            "DS4_CUDA_MOE_NO_P2": "",
            "DS4_CUDA_MOE_ATOMIC_DOWN": "",
            "DS4_CUDA_MOE_NO_ATOMIC_DOWN": "",
            "DS4_CUDA_MOE_GATE_ROW512": "",
            "DS4_CUDA_MOE_GATE_ROW2048": "",
            "DS4_CUDA_MOE_GATE_ROW256": "",
            "DS4_CUDA_MOE_GATE_ROW128": "",
            "DS4_CUDA_MOE_NO_GATE_ROW2048": "",
            "DS4_CUDA_MOE_NO_GATE_ROW256": "",
            "DS4_CUDA_MOE_NO_GATE_ROW128": "",
            "DS4_CUDA_MOE_NO_DOWN_TILE16": "",
            "DS4_CUDA_MOE_NO_DECODE_LUT_GATE": "",
            "DS4_CUDA_MOE_DOWN_ROW512": "",
            "DS4_CUDA_MOE_DOWN_ROW1024": "",
            "DS4_CUDA_MOE_DOWN_ROW2048": "",
            "DS4_CUDA_MOE_DOWN_ROW256": "",
            "DS4_CUDA_MOE_DOWN_ROW128": "",
            "DS4_CUDA_MOE_DOWN_ROW64": "",
            "DS4_CUDA_MOE_NO_DOWN_ROW2048": "",
            "DS4_CUDA_MOE_NO_DOWN_ROW256": "",
            "DS4_CUDA_MOE_NO_DOWN_ROW128": "",
            "DS4_CUDA_MOE_NO_DOWN_ROW64": "",
            "DS4_CUDA_MOE_NO_DIRECT_DOWN_SUM6": "",
        },
        "trace": "",
        "dirSteeringFile": "",
        "dirSteeringFfn": "",
        "dirSteeringAttn": "",
        "kvDiskDir": "",
        "kvDiskSpaceMb": 4096,
        "kvCacheMinTokens": 512,
        "kvCacheColdMaxTokens": 30000,
        "kvCacheContinuedIntervalTokens": 10000,
        "kvCacheBoundaryTrimTokens": 32,
        "kvCacheBoundaryAlignTokens": 2048,
        "kvCacheRejectDifferentQuant": False,
        "disableExactDsmlToolReplay": False,
        "toolMemoryMaxIds": 100000,
    },
    "wrapper": {
        "enabled": False,
        "binary": "./ds4-wrapper",
        "startupMode": "server",
        "freezeOnSwitch": True,
        "freeInactiveSession": True,
        "mutualExclusive": True,
        "agentEnabledAtStartup": False,
        "ramFreezeMaxMb": 4096,
        "modeSwitchTimeoutMs": 120000,
    },
}


@dataclass(frozen=True)
class Field:
    path: str
    label: str
    kind: str
    tab: str


FIELDS: list[Field] = [
    Field("server.binary", "Backend binary", "string", "Server"),
    Field("server.model", "Model GGUF", "string", "Server"),
    Field("server.mtp", "MTP draft model", "string", "Server"),
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
    Field("server.trace", "Trace file", "string", "Server"),
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
]


ENV_FIELDS: list[Field] = [
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
FIELD_BY_PATH = {field.path: field for field in ALL_FIELDS}
KNOWN_ENV_KEYS = {field.path.split(".")[-1] for field in ENV_FIELDS}
PRESENCE_ENV_KEYS = {field.path.split(".")[-1] for field in ENV_FIELDS if field.kind == "env_flag"}


def deep_merge(base: Any, patch: Any) -> Any:
    if isinstance(base, dict) and isinstance(patch, dict):
        merged = copy.deepcopy(base)
        for key, value in patch.items():
            merged[key] = deep_merge(merged[key], value) if key in merged else copy.deepcopy(value)
        return merged
    return copy.deepcopy(patch)


def load_config(config_path: Path) -> dict[str, Any]:
    if config_path.exists():
        with config_path.open("r", encoding="utf-8") as fh:
            raw = json.load(fh)
    else:
        raw = {}
    return deep_merge(DEFAULT_CONFIG, raw)


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
    return errors


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
        self.extra_env = tk.Text(self.root, height=8, width=80)
        self.build()

    def build(self) -> None:
        ttk = self.ttk
        notebook = ttk.Notebook(self.root)
        notebook.pack(fill="both", expand=True, padx=10, pady=10)

        tabs: dict[str, Any] = {}
        for tab in ["Server", "Wrapper", "KV/Tools", "CUDA/Prefill", "Profiling", "MoE Kernel", "MoE Rows", "Extra Env"]:
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
        value = get_path(self.config, field.path)
        if field.kind == "bool":
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
        self.extra_env.pack(fill="both", expand=True, padx=8, pady=8)
        self.extra_env.insert("1.0", "\n".join(f"{key}={value}" for key, value in sorted(extra.items())))

    def collect(self) -> dict[str, Any]:
        config = copy.deepcopy(self.config)
        for path, (var, kind) in self.vars.items():
            raw = str(var.get())
            value = raw
            if kind == "bool":
                value = bool(var.get())
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
    config = load_config(config_path)
    apply_sets(config, sets)
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


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Edit DS4 Studio startup tuning before ./srun.sh launch.")
    parser.add_argument("--config", required=True, help="Path to frontend/ds4-ui.config.json")
    parser.add_argument("--headless-action", choices=["ok", "save", "cancel"], help="Test mode without tkinter")
    parser.add_argument("--set", action="append", default=[], help="Headless path=value override")
    args = parser.parse_args(argv)

    config_path = Path(args.config).expanduser().resolve()
    if args.headless_action:
        return run_headless(config_path, args.headless_action, args.set)

    try:
        config = load_config(config_path)
        dialog = TuningDialog(config_path, config)
        return dialog.run()
    except Exception as err:
        print(f"srun_tuning_gui: {err}", file=sys.stderr)
        return EXIT_ERROR


if __name__ == "__main__":
    raise SystemExit(main())
