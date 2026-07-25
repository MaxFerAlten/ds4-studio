#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$ROOT/scripts/agno_bootstrap.sh"

WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

FAKE_BIN="$WORKDIR/fakebin"
mkdir -p "$FAKE_BIN"
PIP_LOG="$WORKDIR/pip-calls.log"

# Fake python3: "-m venv DIR" stages a copy of itself as DIR/bin/python
# (so later `$venv_python -m pip ...` calls resolve to the same stub);
# "-m pip ..." only logs the call. Never touches the network.
cat > "$FAKE_BIN/python3" <<EOF
#!/usr/bin/env bash
if [[ "\$1" == "-m" && "\$2" == "venv" ]]; then
  mkdir -p "\$3/bin"
  cp "$FAKE_BIN/python3" "\$3/bin/python"
  chmod +x "\$3/bin/python"
  exit 0
fi
if [[ "\$1" == "-m" && "\$2" == "pip" ]]; then
  echo "pip \$*" >> "$PIP_LOG"
  [[ "\$3" == "freeze" ]] && echo "# fake-lock"
  exit 0
fi
exit 1
EOF
chmod +x "$FAKE_BIN/python3"

setup_case() {
  local case_dir="$1"
  rm -rf "$case_dir"
  mkdir -p "$case_dir/agno_service" "$case_dir/frontend"
  cat > "$case_dir/agno_service/pyproject.toml" <<'EOF'
[project]
name = "fake"
EOF
}

write_config() {
  local path="$1" enabled="$2"
  printf '{"agno": {"enabled": %s}}\n' "$enabled" > "$path"
}

echo "[1/3] Agno disabled, virtualenv absent -> DS4 startup non bloccato"
CASE1="$WORKDIR/case1"
setup_case "$CASE1"
write_config "$CASE1/frontend/ds4-ui.config.json" false
rm -f "$PIP_LOG"
PATH="$FAKE_BIN:$PATH" ensure_agno_service "$CASE1" "$CASE1/frontend/ds4-ui.config.json"
[[ ! -e "$CASE1/agno_service/.venv" ]] || { echo "FAIL: venv created while Agno disabled"; exit 1; }
[[ ! -f "$PIP_LOG" ]] || { echo "FAIL: pip invoked while Agno disabled"; exit 1; }

echo "[2/3] Agno enabled, virtualenv assente -> messaggio installazione/creazione deterministico"
CASE2="$WORKDIR/case2"
setup_case "$CASE2"
write_config "$CASE2/frontend/ds4-ui.config.json" true
rm -f "$PIP_LOG"
OUTPUT="$(PATH="$FAKE_BIN:$PATH" ensure_agno_service "$CASE2" "$CASE2/frontend/ds4-ui.config.json")"
grep -qF "srun.sh: agno_service virtualenv not found, creating" <<<"$OUTPUT" ||
  { echo "FAIL: missing deterministic install message"; exit 1; }
[[ -x "$CASE2/agno_service/.venv/bin/python" ]] || { echo "FAIL: venv not created"; exit 1; }
[[ -f "$CASE2/agno_service/.venv/.ds4-lock-hash" ]] || { echo "FAIL: hash stamp not written"; exit 1; }

echo "[3/3] lock hash invariato -> nessun pip install"
CASE3="$WORKDIR/case3"
setup_case "$CASE3"
write_config "$CASE3/frontend/ds4-ui.config.json" true
mkdir -p "$CASE3/agno_service/.venv/bin"
cp "$FAKE_BIN/python3" "$CASE3/agno_service/.venv/bin/python"
chmod +x "$CASE3/agno_service/.venv/bin/python"
ds4_agno_pyproject_hash "$CASE3/agno_service" > "$CASE3/agno_service/.venv/.ds4-lock-hash"
rm -f "$PIP_LOG"
PATH="$FAKE_BIN:$PATH" ensure_agno_service "$CASE3" "$CASE3/frontend/ds4-ui.config.json"
[[ ! -f "$PIP_LOG" ]] || { echo "FAIL: pip invoked despite unchanged lock hash"; exit 1; }

echo "srun.sh agno bootstrap certification: PASS"
