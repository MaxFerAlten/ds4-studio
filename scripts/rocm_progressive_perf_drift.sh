#!/usr/bin/env bash
# ROCm Performance Progressive Anti-Drift — script unico
set -euo pipefail

MODE="${1:-}"
ROOT="${2:-}"
PHASE="${3:-}"
ENV_CMD="${4:-true}"

MODEL="${MODEL:-ds4flash.gguf}"
PROMPT="${PROMPT:-speed-bench/promessi_sposi.txt}"
ROCM_ARCH="${ROCM_ARCH:-gfx1151}"

capture_env() {
  local out="$1"
  {
    echo "DATE=$(date -Is)"
    echo "GIT_COMMIT=$(git rev-parse HEAD 2>/dev/null || true)"
    git status --short 2>/dev/null || true
    echo "KERNEL=$(uname -a)"
    echo "ROCM_ARCH=$ROCM_ARCH"
    env | sort | grep -E '^(DS4_|HSA_|HIP_|ROCM_|AMD_|GPU_)' || true
    free -g || true
  } > "$out"
}

start_mem_watch() {
  local out="$1"
  (
    while true; do
      echo "$(date -Is) free=$(free -g | awk '/Mem:/ {print $3}')"
      sleep 2
    done
  ) > "$out" &
  echo $!
}

run_bench_short() {
  local outdir="$1"
  timeout 120s ./ds4-bench \
    -m "$MODEL" \
    --prompt-file "$PROMPT" \
    --ctx-start 2048 \
    --ctx-max 16384 \
    --step-incr 4096 \
    --gen-tokens 64 \
    --csv "$outdir/bench.csv" \
    2>&1 | tee "$outdir/bench.log"
}

if [[ "$MODE" == "baseline" ]]; then
  ROOT="/tmp/ds4-rocm-progressive-$(date +%Y%m%d-%H%M%S)"
  OUT="$ROOT/phase-00-baseline"
  mkdir -p "$OUT"
  echo "$ROOT" | tee "$ROOT/path.txt"

  export DS4_SERVER_DEVICE_TENSORS="${DS4_SERVER_DEVICE_TENSORS:-0}"
  unset DS4_SERVER_COPY_MODEL || true
  unset DS4_CUDA_COPY_MODEL || true
  unset DS4_HIP_COPY_MODEL || true

  capture_env "$OUT/env.txt"
  make rocm ROCM_ARCH="$ROCM_ARCH" 2>&1 | tee "$OUT/build.log"
  ./certify_all.sh 2>&1 | tee "$OUT/certify_all.log"
  PID=$(start_mem_watch "$OUT/memory.log")
  run_bench_short "$OUT"
  kill "$PID" 2>/dev/null || true

  echo "BASELINE_ROOT=$ROOT"

elif [[ "$MODE" == "cell" ]]; then
  OUT="$ROOT/$PHASE"
  mkdir -p "$OUT"
  eval "$ENV_CMD"
  capture_env "$OUT/env.txt"
  make rocm ROCM_ARCH="$ROCM_ARCH" 2>&1 | tee "$OUT/build.log"
  ./certify_all.sh 2>&1 | tee "$OUT/certify_all.log"
  PID=$(start_mem_watch "$OUT/memory.log")
  run_bench_short "$OUT"
  kill "$PID" 2>/dev/null || true

elif [[ "$MODE" == "verdict" ]]; then
  OUT="$ROOT/$PHASE"
  BASELINE="$ROOT/phase-00-baseline"
  if [[ ! -f "$BASELINE/bench.csv" || ! -f "$OUT/bench.csv" ]]; then
    echo "SKIP — missing benchmark data"
    exit 0
  fi
  echo "=== VERDICT ==="
  echo "Phase: $PHASE"
  echo "Baseline decode tok/s: $(awk -F',' 'NR>1{print $NF}' "$BASELINE/bench.csv" | paste -sd+ | bc -l 2>/dev/null || echo 'N/A')"
  echo "Candidate decode tok/s: $(awk -F',' 'NR>1{print $NF}' "$OUT/bench.csv" | paste -sd+ | bc -l 2>/dev/null || echo 'N/A')"
  echo "=== BUILD ==="
  tail -3 "$OUT/build.log"
  echo "=== CERTIFY ==="
  grep -E "✅|❌" "$OUT/certify_all.log" || true
  echo "=== MEMORY ==="
  tail -3 "$OUT/memory.log" || true
  echo "=== DECISION ==="
  echo "GO / FLAG / RETEST / ROLLBACK — decide manualmente"

else
  echo "Usage: $0 baseline|cell|verdict"
  exit 1
fi
