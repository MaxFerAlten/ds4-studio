#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$ROOT/scripts/crawl_bootstrap.sh"

WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

FAKE_BIN="$WORKDIR/fakebin"
mkdir -p "$FAKE_BIN"
PIP_LOG="$WORKDIR/pip-calls.log"

FAKE_PYTHON="$FAKE_BIN/python3"
cat > "$FAKE_PYTHON" <<EOF
#!/usr/bin/env bash
if [[ "\$1" == "-m" && "\$2" == "venv" ]]; then
  mkdir -p "\$3/bin"
  cp "$FAKE_PYTHON" "\$3/bin/python3"
  chmod +x "\$3/bin/python3"
  exit 0
fi
if [[ "\$1" == "-m" && "\$2" == "pip" ]]; then
  echo "pip \$*" >> "$PIP_LOG"
  if [[ "\$3" == "install" && "\${4:-}" == "-e" ]]; then
    touch "\$(dirname "\$0")/../.ds4-crawl-installed"
  fi
  exit 0
fi
if [[ "\$1" == "-c" ]]; then
  [[ -f "\$(dirname "\$0")/../.ds4-crawl-installed" ]]
  exit
fi
exit 1
EOF
chmod +x "$FAKE_PYTHON"

CASE_DIR="$WORKDIR/case"
mkdir -p "$CASE_DIR/crawl_service"
cat > "$CASE_DIR/crawl_service/pyproject.toml" <<'EOF'
[project]
name = "fake-crawl"
EOF

echo "[1/2] crawl virtualenv assente -> crea e installa il servizio"
OUTPUT="$(PATH="$FAKE_BIN:$PATH" ensure_crawl_service "$CASE_DIR")"
grep -qF "srun.sh: crawl_service virtualenv not ready, creating" <<<"$OUTPUT" ||
  { echo "FAIL: missing crawl bootstrap message"; exit 1; }
[[ -x "$CASE_DIR/crawl_service/.venv/bin/python3" ]] ||
  { echo "FAIL: crawl virtualenv not created"; exit 1; }
grep -qF "pip -m pip install --upgrade pip" "$PIP_LOG" ||
  { echo "FAIL: pip was not upgraded"; exit 1; }
grep -qF "pip -m pip install -e $CASE_DIR/crawl_service" "$PIP_LOG" ||
  { echo "FAIL: crawl service was not installed editable"; exit 1; }

echo "[2/2] crawl virtualenv pronto -> nessuna reinstallazione"
rm -f "$PIP_LOG"
PATH="$FAKE_BIN:$PATH" ensure_crawl_service "$CASE_DIR"
[[ ! -f "$PIP_LOG" ]] || { echo "FAIL: pip invoked for ready crawl virtualenv"; exit 1; }

echo "srun.sh crawl bootstrap certification: PASS"
