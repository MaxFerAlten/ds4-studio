#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd -P)"
BASELINE_FILE="${BASELINE_FILE:-$PROJECT_ROOT/benchmarks/ds4-regression-baseline.env}"

baseline_value() {
  local key="$1"
  local fallback="$2"
  local value=""
  if [[ -f "$BASELINE_FILE" ]]; then
    value="$(awk -F= -v key="$key" '$1 == key { sub(/^[^=]*=/, ""); print; exit }' "$BASELINE_FILE")"
  fi
  printf '%s\n' "${value:-$fallback}"
}

check_status_json() {
  local file="$1"
  local expected_cache expected_reserve expected_chunked
  expected_cache="$(baseline_value DS4_EXPECT_CUDA_Q8_F16_CACHE_MB 11264)"
  expected_reserve="$(baseline_value DS4_EXPECT_CUDA_Q8_F16_CACHE_RESERVE_MB 512)"
  expected_chunked="$(baseline_value DS4_EXPECT_CUDA_COPY_MODEL_CHUNKED 1)"

  python3 - "$file" "$expected_cache" "$expected_reserve" "$expected_chunked" <<'PY'
import json
import sys

path, expected_cache, expected_reserve, expected_chunked = sys.argv[1:]
try:
    with open(path, encoding="utf-8") as handle:
        status = json.load(handle)
except (OSError, json.JSONDecodeError) as error:
    print(f"regression gate: invalid frontend status JSON: {error}", file=sys.stderr)
    raise SystemExit(1)

if status.get("running") is not True:
    print("regression gate: frontend status is not running", file=sys.stderr)
    raise SystemExit(1)
if status.get("healthy") is not True:
    print("regression gate: frontend status is not healthy", file=sys.stderr)
    raise SystemExit(1)

env = status.get("config", {}).get("server", {}).get("env", {})
expected = {
    "DS4_CUDA_Q8_F16_CACHE_MB": expected_cache,
    "DS4_CUDA_Q8_F16_CACHE_RESERVE_MB": expected_reserve,
    "DS4_CUDA_COPY_MODEL_CHUNKED": expected_chunked,
}
for key, value in expected.items():
    if str(env.get(key, "")) != value:
        print(f"regression gate: {key} must be {value}", file=sys.stderr)
        raise SystemExit(1)

print("frontend status healthy")
PY
}

check_metrics_json() {
  local file="$1"
  python3 - "$file" <<'PY'
import json
import math
import sys

try:
    with open(sys.argv[1], encoding="utf-8") as handle:
        metrics = json.load(handle)
except (OSError, json.JSONDecodeError) as error:
    print(f"regression gate: invalid metrics JSON: {error}", file=sys.stderr)
    raise SystemExit(1)

core = [
    "queued_jobs",
    "max_queued_jobs",
    "total_requests",
    "completed_requests",
    "rejected_jobs",
    "total_send_failures",
    "total_stream_stalls",
    "sse_frame_count",
    "send_all_calls",
    "last_prefill_sec",
    "last_decode_sec",
    "last_ttft_sec",
    "last_prompt_tokens",
    "last_completion_tokens",
    "last_cached_tokens",
]
kv = [
    "kv_cache_enabled",
    "kv_cache_entries",
    "kv_cache_bytes",
    "kv_cache_budget_bytes",
    "kv_cache_full_scans",
    "kv_cache_disk_hits",
    "kv_cache_disk_misses",
    "kv_cache_disk_loaded_tokens",
    "kv_cache_store_successes",
    "kv_cache_store_failures",
    "kv_cache_last_load_tokens",
    "kv_cache_last_load_ms",
    "kv_cache_last_store_tokens",
]
mtp = [
    "mtp_enabled",
    "mtp_drafted_tokens",
    "mtp_accepted_tokens",
    "mtp_accept_rate",
    "mtp_verify_ms",
]

def numeric(key):
    value = metrics.get(key)
    return (
        isinstance(value, (int, float))
        and not isinstance(value, bool)
        and math.isfinite(value)
    )

missing_core = [key for key in core if not numeric(key)]
if missing_core:
    print(
        "regression gate: metrics JSON missing numeric fields: "
        + ", ".join(missing_core),
        file=sys.stderr,
    )
    raise SystemExit(1)

missing_kv = [key for key in kv if not numeric(key)]
if missing_kv:
    print(
        "regression gate: metrics JSON missing numeric KV fields: "
        + ", ".join(missing_kv),
        file=sys.stderr,
    )
    raise SystemExit(1)

missing_mtp = [key for key in mtp if not numeric(key)]
if missing_mtp:
    print(
        "regression gate: metrics JSON missing numeric MTP fields: "
        + ", ".join(missing_mtp),
        file=sys.stderr,
    )
    raise SystemExit(1)

print("metrics JSON ok")
PY
}

summary_value() {
  local file="$1"
  local key="$2"
  awk -F= -v key="$key" '$1 == key { sub(/^[^=]*=/, ""); print; found=1; exit } END { if (!found) exit 1 }' "$file"
}

check_summary() {
  local file="$1"
  local required=(ok_requests http_503 failed_requests ttfb_p50 ttfb_p95 total_p50 total_p95)
  declare -A values=()

  for key in "${required[@]}"; do
    if ! value="$(summary_value "$file" "$key")"; then
      echo "regression gate: summary missing $key" >&2
      exit 1
    fi
    if [[ ! "$value" =~ ^[0-9]+([.][0-9]+)?$ ]]; then
      echo "regression gate: summary field $key is not numeric: $value" >&2
      exit 1
    fi
    values["$key"]="$value"
  done

  local min_ok max_503 max_failed baseline_ttfb baseline_total slowdown
  min_ok="$(baseline_value DS4_MIN_OK_REQUESTS 20)"
  max_503="$(baseline_value DS4_MAX_HTTP_503 0)"
  max_failed="$(baseline_value DS4_MAX_FAILED_REQUESTS 0)"
  baseline_ttfb="$(baseline_value DS4_BASELINE_TTFB_P95_SEC 10)"
  baseline_total="$(baseline_value DS4_BASELINE_TOTAL_P95_SEC 20)"
  slowdown="$(baseline_value DS4_ALLOWED_SLOWDOWN_PCT 10)"

  python3 - \
    "${values[ok_requests]}" "${values[http_503]}" "${values[failed_requests]}" \
    "${values[ttfb_p95]}" "${values[total_p95]}" \
    "$min_ok" "$max_503" "$max_failed" "$baseline_ttfb" "$baseline_total" "$slowdown" <<'PY'
import math
import sys

names = [
    "ok_requests",
    "http_503",
    "failed_requests",
    "ttfb_p95",
    "total_p95",
    "min_ok",
    "max_503",
    "max_failed",
    "baseline_ttfb",
    "baseline_total",
    "slowdown",
]
try:
    values = dict(zip(names, map(float, sys.argv[1:])))
except ValueError as error:
    print(f"regression gate: invalid performance baseline: {error}", file=sys.stderr)
    raise SystemExit(1)

if not all(math.isfinite(value) for value in values.values()):
    print("regression gate: performance values must be finite", file=sys.stderr)
    raise SystemExit(1)
if values["ok_requests"] < values["min_ok"]:
    print("regression gate: ok_requests below minimum", file=sys.stderr)
    raise SystemExit(1)
if values["http_503"] > values["max_503"]:
    print("regression gate: http_503 exceeds maximum", file=sys.stderr)
    raise SystemExit(1)
if values["failed_requests"] > values["max_failed"]:
    print("regression gate: failed_requests exceeds maximum", file=sys.stderr)
    raise SystemExit(1)

factor = 1.0 + values["slowdown"] / 100.0
if values["ttfb_p95"] > values["baseline_ttfb"] * factor:
    print("regression gate: ttfb_p95 exceeds allowed slowdown", file=sys.stderr)
    raise SystemExit(1)
if values["total_p95"] > values["baseline_total"] * factor:
    print("regression gate: total_p95 exceeds allowed slowdown", file=sys.stderr)
    raise SystemExit(1)

print("performance summary within baseline")
PY
}

usage() {
  echo "usage: regression_gate.sh --check-status-json FILE | --check-metrics-json FILE | --check-summary FILE" >&2
  exit 2
}

[[ "$#" -eq 2 ]] || usage
[[ -f "$2" ]] || {
  echo "regression gate: input file not found: $2" >&2
  exit 2
}

case "$1" in
  --check-status-json)
    check_status_json "$2"
    ;;
  --check-metrics-json)
    check_metrics_json "$2"
    ;;
  --check-summary)
    check_summary "$2"
    ;;
  *)
    usage
    ;;
esac
