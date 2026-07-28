#!/usr/bin/env bash
# Agno sidecar virtualenv bootstrap for srun.sh.
# Source this file from scripts after ROOT_DIR has been established.

# Echoes "1" if config.agno.enabled is true, "0" otherwise (including missing
# config, missing node, or parse failure).
ds4_agno_config_enabled() {
  local config_path="$1"
  [[ -f "$config_path" ]] || { echo "0"; return 0; }
  command -v node >/dev/null 2>&1 || { echo "0"; return 0; }
  node -e '
    const fs = require("fs");
    try {
      const cfg = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
      console.log(cfg && cfg.agno && cfg.agno.enabled ? "1" : "0");
    } catch { console.log("0"); }
  ' "$config_path" 2>/dev/null || echo "0"
}

# Echoes config.agno.python if set (custom interpreter managed outside the
# bootstrap), otherwise empty.
ds4_agno_config_python_override() {
  local config_path="$1"
  [[ -f "$config_path" ]] || { echo ""; return 0; }
  command -v node >/dev/null 2>&1 || { echo ""; return 0; }
  node -e '
    const fs = require("fs");
    try {
      const cfg = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
      const python = cfg && cfg.agno && cfg.agno.python;
      console.log(python && String(python).trim() ? String(python) : "");
    } catch { console.log(""); }
  ' "$config_path" 2>/dev/null || echo ""
}

# Echoes config.agno.serviceDir (relative to root), defaulting to
# "agno_service" when unset or the config is unreadable.
ds4_agno_config_service_dir() {
  local config_path="$1"
  local default_dir="agno_service"
  [[ -f "$config_path" ]] || { echo "$default_dir"; return 0; }
  command -v node >/dev/null 2>&1 || { echo "$default_dir"; return 0; }
  node -e '
    const fs = require("fs");
    try {
      const cfg = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
      const dir = cfg && cfg.agno && cfg.agno.serviceDir;
      console.log(dir && String(dir).trim() ? String(dir) : "agno_service");
    } catch { console.log("agno_service"); }
  ' "$config_path" 2>/dev/null || echo "$default_dir"
}

# Hashes the dependency manifest that determines whether a reinstall is
# needed. Echoes nothing (and fails) if pyproject.toml is missing.
ds4_agno_pyproject_hash() {
  local service_dir="$1"
  local pyproject="$service_dir/pyproject.toml"
  [[ -f "$pyproject" ]] || return 1
  sha256sum "$pyproject" | awk '{print $1}'
}

# Bootstrap (or skip) the Agno sidecar virtualenv:
# - no-op when config.agno.enabled is false (never blocks DS4 startup);
# - no-op when config.agno.python points at an externally managed interpreter;
# - creates the venv and installs on first run (deterministic log message);
# - reinstalls only when agno_service/pyproject.toml has changed since the
#   last install (tracked via a hash stamp inside the gitignored .venv).
ensure_agno_service() {
  local root_dir="$1"
  local config_path="$2"

  local enabled
  enabled="$(ds4_agno_config_enabled "$config_path")"
  if [[ "$enabled" != "1" ]]; then
    return 0
  fi

  local python_override
  python_override="$(ds4_agno_config_python_override "$config_path")"
  if [[ -n "$python_override" ]]; then
    return 0
  fi

  local service_dir_rel
  service_dir_rel="$(ds4_agno_config_service_dir "$config_path")"
  local service_dir="$root_dir/$service_dir_rel"
  local venv_dir="$service_dir/.venv"
  local venv_python="$venv_dir/bin/python"
  local hash_stamp="$venv_dir/.ds4-lock-hash"

  if [[ ! -x "$venv_python" ]]; then
    echo "srun.sh: agno_service virtualenv not found, creating"
    if ! command -v python3 >/dev/null 2>&1; then
      echo "srun.sh: python3 is required to bootstrap agno_service virtualenv" >&2
      return 1
    fi
    python3 -m venv "$venv_dir"
    "$venv_python" -m pip install --upgrade pip
    "$venv_python" -m pip install -e "${service_dir}[dev]"
    "$venv_python" -m pip freeze > "$service_dir/requirements.lock"
    ds4_agno_pyproject_hash "$service_dir" > "$hash_stamp" || true
    return 0
  fi

  local current_hash stored_hash
  current_hash="$(ds4_agno_pyproject_hash "$service_dir" || true)"
  stored_hash=""
  [[ -f "$hash_stamp" ]] && stored_hash="$(cat "$hash_stamp")"

  if [[ -n "$current_hash" && "$current_hash" == "$stored_hash" ]]; then
    return 0
  fi

  echo "srun.sh: agno_service dependencies changed, reinstalling"
  "$venv_python" -m pip install -e "${service_dir}[dev]"
  "$venv_python" -m pip freeze > "$service_dir/requirements.lock"
  [[ -n "$current_hash" ]] && echo "$current_hash" > "$hash_stamp"
}

# Echoes "1" if both agno.enabled and agno.agentUi.enabled are true, "0" otherwise.
ds4_agno_agent_ui_config_enabled() {
  local config_path="$1"
  [[ -f "$config_path" ]] || { echo "0"; return 0; }
  command -v node >/dev/null 2>&1 || { echo "0"; return 0; }
  node -e '
    const fs = require("fs");
    try {
      const cfg = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
      console.log(
        cfg && cfg.agno && cfg.agno.enabled &&
        cfg.agno.agentUi && cfg.agno.agentUi.enabled !== false ? "1" : "0"
      );
    } catch { console.log("0"); }
  ' "$config_path" 2>/dev/null || echo "0"
}

# Echoes the Agent UI port (default 3000).
config_agno_agent_ui_port() {
  local config_path="$1"
  [[ -f "$config_path" ]] || { echo "3000"; return 0; }
  node -e '
    const fs = require("fs");
    const file = process.argv[1];
    try {
      const cfg = JSON.parse(fs.readFileSync(file, "utf8"));
      const port = cfg && cfg.agno && cfg.agno.agentUi && cfg.agno.agentUi.port;
      console.log(port !== undefined && port !== null && String(port).trim() ? String(port) : "3000");
    } catch { console.log("3000"); }
  ' "$config_path" 2>/dev/null || echo "3000"
}
