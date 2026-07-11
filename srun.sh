#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$ROOT_DIR/scripts/rocm_settings.sh"

FRONTEND_DIR="$ROOT_DIR/frontend"
HOST="127.0.0.1"
PORT="5173"
CONFIG_PATH="$FRONTEND_DIR/ds4-ui.config.json"
DRY_RUN=0
NO_GUI=0
ROCM_ARCH="${ROCM_ARCH:-gfx1151}"
DS4_MODEL_VARIANT="${DS4_MODEL_VARIANT:-q2-imatrix}"
SRUN_TUNING_GUI="${DS4_SRUN_TUNING_GUI:-$ROOT_DIR/scripts/srun_tuning_gui.py}"

usage() {
  cat <<'USAGE'
Usage: ./srun.sh [command] [options]

Starts the DS4 web GUI and the managed ds4-server backend.

Commands:
  build                Build backend (ROCm) and frontend, then exit
                       Uses ROCM_ARCH env var (default: gfx1151)
  build be             Clean and rebuild ROCm binaries only, then exit
  build fe             Build frontend assets (vite build) only, then exit
  clean                Remove build artifacts produced by build, build be, and
                       build fe (make clean + rm -rf frontend/dist), then exit
  stop                 Stop frontend (node frontend/server/index.mjs) and
                       backend (ds4-server), then exit

Options:
  --host HOST          UI/control bind host. Allowed loopback hosts: 127.0.0.1, localhost, ::1. Default: 127.0.0.1
  --port PORT          UI/control port. Default: 5173
  --config FILE        Config file path. Default: frontend/ds4-ui.config.json
  --no-gui             Skip the Python startup tuning window
  --dry-run            Print what would run and exit
  -h, --help           Show this help

Environment:
  DS4_MODEL_VARIANT    Model variant downloaded when ./ds4flash.gguf is missing.
                       Values: q2-imatrix (default), q4-imatrix, q2, q4.
  DS4_SRUN_NO_GUI=1    Skip the Python startup tuning window.
  DS4_SERVER_FAST_FULL=1
                       Enable the max-performance ROCm preset (default).
  DS4_SERVER_FAST_FULL=0
                       Disable the preset and use explicit environment settings.
  DS4_SERVER_PERFLEVEL=high|auto
                       ROCm performance level; use off/skip/none to bypass.
  DS4_SKILL_AUTO=0     Disable automatic loading of soul/ethic skills at startup.
                       Default is 1 (enabled). Set via GUI or environment variable.

After startup, open the printed local URL in your browser.
USAGE
}

configure_rocm_runtime() {
  export DS4_SERVER_FAST_FULL="${DS4_SERVER_FAST_FULL:-1}"
  if [[ "$DS4_SERVER_FAST_FULL" == "1" ]]; then
    # 8192 is the measured prefill optimum on Strix Halo (and the ROCm
    # attention-score cap); 4096 loses ~3-7% long-prompt throughput.
    ds4_rocm_apply_fast_full_defaults 8192
  fi

  ds4_rocm_apply_tensor_env
  ds4_rocm_apply_prefill_env 128 512
  ds4_rocm_export_runtime_env
  ds4_rocm_normalize_perflevel_var DS4_SERVER_PERFLEVEL

  echo "srun.sh: ROCm FAST_FULL=$DS4_SERVER_FAST_FULL prefill_chunk=${DS4_METAL_PREFILL_CHUNK:-auto}"
  if [[ -n "${DS4_SERVER_PERFLEVEL:-}" ]] && command -v amd-smi >/dev/null 2>&1; then
    echo "srun.sh: setting perflevel ${DS4_SERVER_PERFLEVEL}"
    local perflevel_set=0
    local amd_smi_args=(set -g 0 -l "$DS4_SERVER_PERFLEVEL")
    if [[ "${EUID:-$(id -u)}" -eq 0 ]]; then
      amd-smi "${amd_smi_args[@]}" </dev/null >&2 &&
        perflevel_set=1
    elif command -v sudo >/dev/null 2>&1; then
      sudo -n -- amd-smi "${amd_smi_args[@]}" </dev/null >&2 &&
        perflevel_set=1
    fi
    if [[ "$perflevel_set" != "1" ]]; then
      echo "srun.sh: warning: unable to set perflevel ${DS4_SERVER_PERFLEVEL}; continuing" >&2
    fi
  fi
}

stop_pattern() {
  local label="$1"
  local pattern="$2"
  local pids
  pids="$(pgrep -f "$pattern" || true)"
  pids="$(filter_pids "$pids")"
  if [[ -z "$pids" ]]; then
    echo "srun.sh: no $label process running"
    return 0
  fi
  stop_pids "$label" "$pids"
}

is_protected_pid() {
  local candidate="$1"
  [[ "$candidate" == "$$" || "$candidate" == "${BASHPID:-}" || "$candidate" == "${PPID:-}" ]] && return 0
  local pid="$$"
  local parent
  while [[ -n "$pid" && "$pid" =~ ^[0-9]+$ && "$pid" != "0" && "$pid" != "1" ]]; do
    [[ "$candidate" == "$pid" ]] && return 0
    parent="$(ps -o ppid= -p "$pid" 2>/dev/null | awk '{print $1}' || true)"
    [[ -z "$parent" || "$parent" == "$pid" ]] && break
    pid="$parent"
  done
  return 1
}

filter_pids() {
  local raw="$1"
  local out=""
  local pid
  for pid in $raw; do
    [[ "$pid" =~ ^[0-9]+$ ]] || continue
    if is_protected_pid "$pid"; then
      continue
    fi
    out="$out $pid"
  done
  if [[ -n "$out" ]]; then
    printf '%s\n' $out | sort -u
  fi
}

stop_pids() {
  local label="$1"
  local pids="$2"
  pids="$(filter_pids "$pids")"
  if [[ -z "$pids" ]]; then
    echo "srun.sh: no $label process running"
    return 0
  fi
  echo "srun.sh: stopping $label (PIDs: $(echo $pids))"
  kill $pids 2>/dev/null || true
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    local alive=""
    local pid
    for pid in $pids; do
      if kill -0 "$pid" 2>/dev/null; then
        alive="$alive $pid"
      fi
    done
    [[ -z "$alive" ]] && return 0
    sleep 0.5
  done
  local alive=""
  local pid
  for pid in $pids; do
    if kill -0 "$pid" 2>/dev/null; then
      alive="$alive $pid"
    fi
  done
  if [[ -n "$alive" ]]; then
    echo "srun.sh: force-killing $label (PIDs: $(echo $pids))"
    kill -9 $alive 2>/dev/null || true
  fi
}

port_pids() {
  local port="$1"
  if command -v lsof >/dev/null 2>&1; then
    lsof -nP -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null | sort -u
    return 0
  fi
  if command -v fuser >/dev/null 2>&1; then
    fuser -n tcp "$port" 2>/dev/null | tr ' ' '\n' | awk 'NF' | sort -u
    return 0
  fi
  if command -v ss >/dev/null 2>&1; then
    ss -ltnp "sport = :$port" 2>/dev/null |
      sed -n 's/.*pid=\([0-9][0-9]*\).*/\1/p' |
      sort -u
  fi
}

stop_port() {
  local label="$1"
  local port="$2"
  [[ "$port" =~ ^[0-9]+$ ]] || return 0
  local pids
  pids="$(port_pids "$port" || true)"
  if [[ -z "$pids" ]]; then
    echo "srun.sh: no process listening on $label port $port"
    return 0
  fi
  stop_pids "$label port $port" "$pids"
}

config_backend_port() {
  local config_path="$1"
  [[ -f "$config_path" ]] || return 0
  node -e '
    const fs = require("fs");
    const file = process.argv[1];
    try {
      const cfg = JSON.parse(fs.readFileSync(file, "utf8"));
      const port = cfg && cfg.server && cfg.server.port;
      if (port !== undefined && port !== null && String(port).trim()) {
        console.log(String(port));
      }
    } catch {}
  ' "$config_path" 2>/dev/null || true
}

stop_launch_ports() {
  stop_port "frontend" "$PORT"
  local backend_port
  backend_port="$(config_backend_port "$CONFIG_PATH" | head -n 1 || true)"
  if [[ -n "$backend_port" && "$backend_port" != "$PORT" ]]; then
    stop_port "backend" "$backend_port"
  fi
}

stop_all_ds4() {
  stop_pattern "frontend" "node .*frontend/server/index\.mjs"
  stop_pattern "ds4-server"  "(^|/)ds4-server( |$)"
  stop_pattern "ds4-wrapper" "(^|/)ds4-wrapper( |$)"
  stop_pattern "ds4-bench"   "(^|/)ds4-bench( |$)"
  stop_pattern "ds4-eval"    "(^|/)ds4-eval( |$)"
  stop_pattern "ds4-agent"   "(^|/)ds4-agent( |$)"
  stop_pattern "ds4 cli"     "(^|/)ds4( |$)"
}

if [[ $# -gt 0 && "$1" == "stop" ]]; then
  shift
  stop_all_ds4
  stop_launch_ports
  exit 0
fi

if [[ $# -gt 0 && "$1" == "clean" ]]; then
  shift
  cd "$ROOT_DIR"
  echo "srun.sh: make clean"
  make clean
  echo "srun.sh: removing frontend/dist"
  rm -rf "$FRONTEND_DIR/dist"
  exit 0
fi

build_fe() {
  if [[ ! -d "$FRONTEND_DIR/node_modules" ]]; then
    echo "srun.sh: installing frontend dependencies"
    npm install --prefix "$FRONTEND_DIR"
  fi
  echo "srun.sh: building frontend"
  npm run build --prefix "$FRONTEND_DIR"
}

build_be() {
  echo "srun.sh: cleaning previous build"
  make clean
  echo "srun.sh: building ROCm with ROCM_ARCH=$ROCM_ARCH"
  make rocm ROCM_ARCH="$ROCM_ARCH"
}

if [[ $# -gt 0 && "$1" == "build" ]]; then
  shift
  cd "$ROOT_DIR"
  if [[ $# -gt 0 && "$1" == "fe" ]]; then
    shift
    build_fe
    exit 0
  fi
  if [[ $# -gt 0 && "$1" == "be" ]]; then
    shift
    build_be
    exit 0
  fi
  build_be
  build_fe
  exit 0
fi

while [[ $# -gt 0 ]]; do
  case "$1" in
    --host) HOST="${2:?missing --host value}"; shift 2 ;;
    --port) PORT="${2:?missing --port value}"; shift 2 ;;
    --config) CONFIG_PATH="${2:?missing --config value}"; shift 2 ;;
    --no-gui) NO_GUI=1; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "srun.sh: unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
done

ensure_model() {
  if [[ -e "$ROOT_DIR/ds4flash.gguf" ]]; then
    return 0
  fi
  if [[ -L "$ROOT_DIR/ds4flash.gguf" ]]; then
    echo "srun.sh: ds4flash.gguf is a broken symlink, re-downloading" >&2
    rm -f "$ROOT_DIR/ds4flash.gguf"
  fi
  case "$DS4_MODEL_VARIANT" in
    q2-imatrix|q4-imatrix|q2|q4) ;;
    *)
      echo "srun.sh: invalid DS4_MODEL_VARIANT='$DS4_MODEL_VARIANT' (use q2-imatrix|q4-imatrix|q2|q4)" >&2
      exit 1
      ;;
  esac
  if [[ ! -x "$ROOT_DIR/download_model.sh" ]]; then
    echo "srun.sh: download_model.sh missing or not executable" >&2
    exit 1
  fi
  if ! command -v curl >/dev/null 2>&1; then
    echo "srun.sh: curl is required to download the model" >&2
    exit 1
  fi
  echo "srun.sh: ds4flash.gguf not found, downloading $DS4_MODEL_VARIANT"
  (cd "$ROOT_DIR" && ./download_model.sh "$DS4_MODEL_VARIANT")
}

if [[ "$DRY_RUN" -eq 1 ]]; then
  printf 'cd %q\n' "$ROOT_DIR"
  printf '%q=%q %q=%q %q=%q node frontend/server/index.mjs\n' \
    DS4_UI_HOST "$HOST" \
    DS4_UI_PORT "$PORT" \
    DS4_UI_CONFIG "$CONFIG_PATH"
  exit 0
fi

run_tuning_gui() {
  if [[ "$NO_GUI" -eq 1 || "${DS4_SRUN_NO_GUI:-}" == "1" ]]; then
    echo "srun.sh: startup tuning GUI skipped"
    return 0
  fi
  if ! command -v python3 >/dev/null 2>&1; then
    echo "srun.sh: python3 is required for startup tuning GUI (use --no-gui to skip)" >&2
    exit 1
  fi
  if [[ ! -f "$SRUN_TUNING_GUI" ]]; then
    echo "srun.sh: startup tuning GUI not found: $SRUN_TUNING_GUI" >&2
    exit 1
  fi
  local rc
  set +e
  python3 "$SRUN_TUNING_GUI" --config "$CONFIG_PATH"
  rc=$?
  set -e
  case "$rc" in
    0)
      echo "srun.sh: tuning confirmed"
      ;;
    20)
      echo "srun.sh: tuning saved; launch skipped"
      exit 0
      ;;
    30)
      echo "srun.sh: tuning canceled; launch skipped"
      exit 0
      ;;
    *)
      echo "srun.sh: startup tuning GUI failed with exit code $rc" >&2
      exit "$rc"
      ;;
  esac
}

ensure_backend() {
  # Check if the config requests wrapper mode
  local use_wrapper=0
  if [[ -f "$CONFIG_PATH" ]] && command -v node >/dev/null 2>&1; then
    use_wrapper="$(node -e '
      const fs = require("fs");
      try {
        const cfg = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
        console.log(cfg && cfg.wrapper && cfg.wrapper.enabled ? "1" : "0");
      } catch { console.log("0"); }
    ' "$CONFIG_PATH" 2>/dev/null || echo "0")"
  fi

  if [[ "$use_wrapper" == "1" ]]; then
    if [[ -x "$ROOT_DIR/ds4-wrapper" ]]; then
      return 0
    fi
    echo "srun.sh: ds4-wrapper binary not found, building ROCm (incremental, no make clean)"
    (cd "$ROOT_DIR" && make ds4-wrapper GPU_BACKEND=rocm ROCM_ARCH="$ROCM_ARCH")
    if [[ ! -x "$ROOT_DIR/ds4-wrapper" ]]; then
      echo "srun.sh: backend build did not produce ./ds4-wrapper" >&2
      exit 1
    fi
  else
    if [[ -x "$ROOT_DIR/ds4-server" ]]; then
      return 0
    fi
    echo "srun.sh: ds4-server binary not found, building ROCm (incremental, no make clean)"
    (cd "$ROOT_DIR" && make ds4-server GPU_BACKEND=rocm ROCM_ARCH="$ROCM_ARCH")
    if [[ ! -x "$ROOT_DIR/ds4-server" ]]; then
      echo "srun.sh: backend build did not produce ./ds4-server" >&2
      exit 1
    fi
  fi
}

configure_rocm_runtime
run_tuning_gui

if ! command -v node >/dev/null 2>&1; then
  echo "srun.sh: node is required" >&2
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "srun.sh: npm is required" >&2
  exit 1
fi

ensure_model
ensure_backend

if [[ ! -d "$FRONTEND_DIR/node_modules" ]]; then
  echo "srun.sh: installing frontend dependencies"
  npm install --prefix "$FRONTEND_DIR"
fi

echo "srun.sh: cleaning stale ds4 processes before launch"
stop_all_ds4
stop_launch_ports

export DS4_UI_HOST="$HOST"
export DS4_UI_PORT="$PORT"
export DS4_UI_CONFIG="$CONFIG_PATH"

cd "$ROOT_DIR"

# Determine what backend will be used (for log only)
_backend_label="ds4-server"
if [[ -f "$CONFIG_PATH" ]] && command -v node >/dev/null 2>&1; then
  _uw="$(node -e '
    const fs = require("fs");
    try {
      const cfg = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
      console.log(cfg && cfg.wrapper && cfg.wrapper.enabled ? "1" : "0");
    } catch { console.log("0"); }
  ' "$CONFIG_PATH" 2>/dev/null || echo "0")"
  [[ "$_uw" == "1" ]] && _backend_label="ds4-wrapper"
fi

echo "srun.sh: launching DS4 Studio at http://$HOST:$PORT (backend: $_backend_label)"
echo "srun.sh: backend GPU model load can take about 2 minutes before Healthy"
exec node frontend/server/index.mjs
