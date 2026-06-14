#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd -P)"
LOAD_SCRIPT="${LOAD_SCRIPT:-$SCRIPT_DIR/server_load.sh}"
RUN_DIR="${RUN_DIR:-$PROJECT_ROOT/benchmarks/perf-matrix-$(date -u +%Y%m%dT%H%M%SZ)}"
HOST="${DS4_MATRIX_HOST:-127.0.0.1}"
PORT="${DS4_MATRIX_PORT:-8002}"
MODEL="${DS4_MATRIX_MODEL:-ds4}"
REQS="${DS4_MATRIX_REQS:-20}"
CONC_LIST="${DS4_MATRIX_CONC:-1 2 4 8}"
TOKEN_LIST="${DS4_MATRIX_MAX_TOKENS:-32 64 128}"

if [[ ! -f "$LOAD_SCRIPT" ]]; then
  echo "perf matrix: load script not found: $LOAD_SCRIPT" >&2
  exit 2
fi

is_positive_int() {
  [[ "$1" =~ ^[1-9][0-9]*$ ]]
}

if ! is_positive_int "$REQS"; then
  echo "perf matrix: DS4_MATRIX_REQS must be a positive integer" >&2
  exit 2
fi

read -r -a conc_values <<<"$CONC_LIST"
read -r -a token_values <<<"$TOKEN_LIST"
if [[ "${#conc_values[@]}" -eq 0 || "${#token_values[@]}" -eq 0 ]]; then
  echo "perf matrix: concurrency and token lists must not be empty" >&2
  exit 2
fi

for value in "${conc_values[@]}" "${token_values[@]}"; do
  if ! is_positive_int "$value"; then
    echo "perf matrix: matrix values must be positive integers: $value" >&2
    exit 2
  fi
done

mkdir -p "$RUN_DIR"
MATRIX_FILE="$RUN_DIR/matrix.tsv"
printf '%s\n' \
  $'timestamp\thost\tport\tmodel\tconc\treqs\tmax_tokens\tok_requests\thttp_503\tfailed_requests\tttfb_p50\tttfb_p95\ttotal_p50\ttotal_p95\tout\tsummary' \
  > "$MATRIX_FILE"

metric_value() {
  local summary="$1"
  local key="$2"
  awk -F= -v key="$key" '$1 == key { sub(/^[^=]*=/, ""); print; found=1; exit } END { if (!found) exit 1 }' "$summary"
}

required_metrics=(
  ok_requests
  http_503
  failed_requests
  ttfb_p50
  ttfb_p95
  total_p50
  total_p95
  out
)

for conc in "${conc_values[@]}"; do
  for max_tokens in "${token_values[@]}"; do
    summary="$RUN_DIR/summary-conc${conc}-tok${max_tokens}.txt"
    output="$RUN_DIR/load-conc${conc}-tok${max_tokens}.tsv"

    if ! (
      export HOST PORT MODEL REQS
      export CONC="$conc"
      export MAX_TOKENS="$max_tokens"
      export OUT="$output"
      "$LOAD_SCRIPT"
    ) >"$summary" 2>&1; then
      cat "$summary" >&2
      echo "perf matrix: load run failed for conc=$conc max_tokens=$max_tokens" >&2
      exit 1
    fi

    declare -A metrics=()
    for key in "${required_metrics[@]}"; do
      if ! value="$(metric_value "$summary" "$key")"; then
        echo "perf matrix: summary missing $key: $summary" >&2
        exit 1
      fi
      metrics["$key"]="$value"
    done

    for key in ok_requests http_503 failed_requests ttfb_p50 ttfb_p95 total_p50 total_p95; do
      if [[ ! "${metrics[$key]}" =~ ^[0-9]+([.][0-9]+)?$ ]]; then
        echo "perf matrix: summary metric $key is not numeric: ${metrics[$key]}" >&2
        exit 1
      fi
    done

    timestamp="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
      "$timestamp" "$HOST" "$PORT" "$MODEL" "$conc" "$REQS" "$max_tokens" \
      "${metrics[ok_requests]}" "${metrics[http_503]}" "${metrics[failed_requests]}" \
      "${metrics[ttfb_p50]}" "${metrics[ttfb_p95]}" \
      "${metrics[total_p50]}" "${metrics[total_p95]}" \
      "${metrics[out]}" "$summary" >> "$MATRIX_FILE"
  done
done

echo "matrix complete: $MATRIX_FILE"
