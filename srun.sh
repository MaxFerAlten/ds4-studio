#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FRONTEND_DIR="$ROOT_DIR/frontend"
HOST="127.0.0.1"
PORT="5173"
CONFIG_PATH="$FRONTEND_DIR/ds4-ui.config.json"
DRY_RUN=0
ROCM_ARCH="${ROCM_ARCH:-gfx1151}"
DS4_MODEL_VARIANT="${DS4_MODEL_VARIANT:-q2-imatrix}"

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
  --dry-run            Print what would run and exit
  -h, --help           Show this help

Environment:
  DS4_MODEL_VARIANT    Model variant downloaded when ./ds4flash.gguf is missing.
                       Values: q2-imatrix (default), q4-imatrix, q2, q4.

After startup, open the printed local URL in your browser.
USAGE
}

stop_pattern() {
  local label="$1"
  local pattern="$2"
  local self_pid="$$"
  local pids
  pids="$(pgrep -f "$pattern" | grep -vx "$self_pid" || true)"
  if [[ -z "$pids" ]]; then
    echo "srun.sh: no $label process running"
    return 0
  fi
  echo "srun.sh: stopping $label (PIDs: $(echo $pids))"
  kill $pids 2>/dev/null || true
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    pids="$(pgrep -f "$pattern" | grep -vx "$self_pid" || true)"
    [[ -z "$pids" ]] && break
    sleep 0.5
  done
  pids="$(pgrep -f "$pattern" | grep -vx "$self_pid" || true)"
  if [[ -n "$pids" ]]; then
    echo "srun.sh: force-killing $label (PIDs: $(echo $pids))"
    kill -9 $pids 2>/dev/null || true
  fi
}

stop_all_ds4() {
  stop_pattern "frontend" "node .*frontend/server/index\.mjs"
  stop_pattern "ds4-server" "(^|/)ds4-server( |$)"
  stop_pattern "ds4-bench"  "(^|/)ds4-bench( |$)"
  stop_pattern "ds4-eval"   "(^|/)ds4-eval( |$)"
  stop_pattern "ds4-agent"  "(^|/)ds4-agent( |$)"
  stop_pattern "ds4 cli"    "(^|/)ds4( |$)"
}

if [[ $# -gt 0 && "$1" == "stop" ]]; then
  shift
  stop_all_ds4
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
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "srun.sh: unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
done

if ! command -v node >/dev/null 2>&1; then
  echo "srun.sh: node is required" >&2
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "srun.sh: npm is required" >&2
  exit 1
fi

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

ensure_backend() {
  if [[ -x "$ROOT_DIR/ds4-server" ]]; then
    return 0
  fi
  echo "srun.sh: ds4-server binary not found, building ROCm (incremental, no make clean)"
  (cd "$ROOT_DIR" && make rocm ROCM_ARCH="$ROCM_ARCH")
  if [[ ! -x "$ROOT_DIR/ds4-server" ]]; then
    echo "srun.sh: backend build did not produce ./ds4-server" >&2
    exit 1
  fi
}

ensure_model
ensure_backend

if [[ ! -d "$FRONTEND_DIR/node_modules" ]]; then
  echo "srun.sh: installing frontend dependencies"
  npm install --prefix "$FRONTEND_DIR"
fi

echo "srun.sh: cleaning stale ds4 processes before launch"
stop_all_ds4

export DS4_UI_HOST="$HOST"
export DS4_UI_PORT="$PORT"
export DS4_UI_CONFIG="$CONFIG_PATH"

cd "$ROOT_DIR"
exec node frontend/server/index.mjs
