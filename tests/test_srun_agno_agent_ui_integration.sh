#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$ROOT/scripts/agno_bootstrap.sh"

WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

setup_case() {
  local case_dir="$1"
  mkdir -p "$case_dir/frontend" "$case_dir/scripts" "$case_dir/third_party/agno-agent-ui"
  cat > "$case_dir/third_party/agno-agent-ui/upstream.lock" <<'EOF'
AGNO_AGENT_UI_COMMIT=0123456789abcdef0123456789abcdef01234567
EOF
  cat > "$case_dir/scripts/agno_agent_ui_bootstrap.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
root_dir="$1"
runtime_dir="${DS4_AGNO_AGENT_UI_RUNTIME_DIR:-$root_dir/.runtime/agno-agent-ui}"
commit="$(sed -n 's/^AGNO_AGENT_UI_COMMIT=//p' "$root_dir/third_party/agno-agent-ui/upstream.lock")"
mkdir -p "$runtime_dir/.next" "$runtime_dir/node_modules"
printf '{}\n' > "$runtime_dir/package.json"
printf 'fake-build\n' > "$runtime_dir/.next/BUILD_ID"
printf 'commit=%s\n' "$commit" > "$runtime_dir/.ds4-ready"
printf 'run\n' >> "$root_dir/bootstrap-runs"
EOF
  chmod +x "$case_dir/scripts/agno_agent_ui_bootstrap.sh"
}

echo "[1/5] agentUi omessa -> usa il default abilitato"
DEFAULT_CASE="$WORKDIR/default"
setup_case "$DEFAULT_CASE"
printf '{"agno":{"enabled":true}}\n' > "$DEFAULT_CASE/frontend/ds4-ui.config.json"
[[ "$(ds4_agno_agent_ui_config_enabled "$DEFAULT_CASE/frontend/ds4-ui.config.json")" == "1" ]] ||
  { echo "FAIL: omitted agentUi should use enabled default"; exit 1; }

echo "[2/5] runtime assente -> bootstrap automatico"
ensure_agno_agent_ui "$DEFAULT_CASE" "$DEFAULT_CASE/frontend/ds4-ui.config.json"
[[ -f "$DEFAULT_CASE/.runtime/agno-agent-ui/.ds4-ready" ]] ||
  { echo "FAIL: ready marker not created"; exit 1; }
[[ "$(wc -l < "$DEFAULT_CASE/bootstrap-runs")" == "1" ]] ||
  { echo "FAIL: bootstrap should run once"; exit 1; }

echo "[3/5] runtime valido -> bootstrap non ripetuto"
ensure_agno_agent_ui "$DEFAULT_CASE" "$DEFAULT_CASE/frontend/ds4-ui.config.json"
[[ "$(wc -l < "$DEFAULT_CASE/bootstrap-runs")" == "1" ]] ||
  { echo "FAIL: ready runtime was rebuilt"; exit 1; }

echo "[4/5] runtime personalizzato rispettato; explicit false disabilita"
CUSTOM_CASE="$WORKDIR/custom"
setup_case "$CUSTOM_CASE"
cat > "$CUSTOM_CASE/frontend/ds4-ui.config.json" <<'EOF'
{"agno":{"enabled":true,"agentUi":{"enabled":true,"runtimeDir":"var/agno-ui"}}}
EOF
ensure_agno_agent_ui "$CUSTOM_CASE" "$CUSTOM_CASE/frontend/ds4-ui.config.json"
[[ -f "$CUSTOM_CASE/var/agno-ui/.ds4-ready" ]] ||
  { echo "FAIL: custom runtimeDir not used"; exit 1; }

printf '{"agno":{"enabled":true,"agentUi":{"enabled":false}}}\n' > "$CUSTOM_CASE/frontend/ds4-ui.config.json"
[[ "$(ds4_agno_agent_ui_config_enabled "$CUSTOM_CASE/frontend/ds4-ui.config.json")" == "0" ]] ||
  { echo "FAIL: explicit agentUi false should disable bootstrap"; exit 1; }

echo "[5/5] lock senza commit valido -> bootstrap rifiutato"
INVALID_CASE="$WORKDIR/invalid"
setup_case "$INVALID_CASE"
printf 'BROKEN_LOCK=1\n' > "$INVALID_CASE/third_party/agno-agent-ui/upstream.lock"
printf '{"agno":{"enabled":true}}\n' > "$INVALID_CASE/frontend/ds4-ui.config.json"
if ensure_agno_agent_ui "$INVALID_CASE" "$INVALID_CASE/frontend/ds4-ui.config.json" 2>/dev/null; then
  echo "FAIL: invalid lock commit was accepted"
  exit 1
fi

echo "srun.sh agno agent UI integration certification: PASS"
