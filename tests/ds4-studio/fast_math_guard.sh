#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd -P)"
SOURCE_ROOT="${DS4_FAST_MATH_GUARD_SOURCE_ROOT:-$PROJECT_ROOT}"
BUILD_ROOT="${DS4_FAST_MATH_GUARD_BUILD_ROOT:-}"
KEEP="${DS4_FAST_MATH_GUARD_KEEP:-0}"

if [[ -z "$BUILD_ROOT" ]]; then
  BUILD_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/ds4-fast-math-guard.XXXXXX")"
else
  if [[ "$BUILD_ROOT" != /* ]]; then
    BUILD_ROOT="$PROJECT_ROOT/$BUILD_ROOT"
  fi
  mkdir -p "$BUILD_ROOT"
  BUILD_ROOT="$(cd "$BUILD_ROOT" && pwd -P)"
fi

if [[ "$BUILD_ROOT" == "/" || "$BUILD_ROOT" == "$SOURCE_ROOT" ]]; then
  echo "fast math guard: unsafe build root: $BUILD_ROOT" >&2
  exit 2
fi

cleanup() {
  if [[ "$KEEP" != "1" ]]; then
    rm -rf "$BUILD_ROOT"
  fi
}
trap cleanup EXIT

DEFAULT_DIR="$BUILD_ROOT/default"
STRICT_DIR="$BUILD_ROOT/strict"
rm -rf "$DEFAULT_DIR" "$STRICT_DIR"
mkdir -p "$DEFAULT_DIR" "$STRICT_DIR"
cp -a "$SOURCE_ROOT/." "$DEFAULT_DIR/"
cp -a "$SOURCE_ROOT/." "$STRICT_DIR/"

(
  cd "$DEFAULT_DIR"
  make ds4 ds4_test
)

STRICT_CFLAGS="${DS4_FAST_MATH_STRICT_CFLAGS:--O3 -g -fno-fast-math -fno-finite-math-only -fno-associative-math -fno-reciprocal-math}"
STRICT_OBJCFLAGS="${DS4_FAST_MATH_STRICT_OBJCFLAGS:--O3 -g -fno-fast-math -fno-finite-math-only -fno-associative-math -fno-reciprocal-math -fobjc-arc}"
(
  cd "$STRICT_DIR"
  make ds4 ds4_test "CFLAGS=$STRICT_CFLAGS" "OBJCFLAGS=$STRICT_OBJCFLAGS"
)

export DS4_CUDA_Q8_F16_CACHE_MB="${DS4_CUDA_Q8_F16_CACHE_MB:-0}"
export DS4_CUDA_Q8_F16_CACHE_RESERVE_MB="${DS4_CUDA_Q8_F16_CACHE_RESERVE_MB:-512}"
export DS4_CUDA_COPY_MODEL_CHUNKED="${DS4_CUDA_COPY_MODEL_CHUNKED:-1}"
export DS4_CUDA_WEIGHT_ARENA_CHUNK_MB="${DS4_CUDA_WEIGHT_ARENA_CHUNK_MB:-1024}"

MODEL="${DS4_FAST_MATH_MODEL:-$SOURCE_ROOT/ds4flash.gguf}"
PROMPT="${DS4_FAST_MATH_PROMPT:-$SOURCE_ROOT/tests/test-vectors/prompts/short_italian_fact.txt}"
TOKENS="${DS4_FAST_MATH_TOKENS:-4}"
CONTEXT="${DS4_FAST_MATH_CONTEXT:-16384}"
TOP_K="${DS4_FAST_MATH_TOP_K:-20}"
DEFAULT_DUMP="$BUILD_ROOT/default-logprobs.json"
STRICT_DUMP="$BUILD_ROOT/strict-logprobs.json"

run_dump() {
  local variant_dir="$1"
  local output="$2"
  (
    cd "$variant_dir"
    ./ds4 \
      -m "$MODEL" \
      --nothink \
      -sys "" \
      --temp 0 \
      -n "$TOKENS" \
      --ctx "$CONTEXT" \
      --prompt-file "$PROMPT" \
      --dump-logprobs "$output" \
      --logprobs-top-k "$TOP_K"
  )
}

run_dump "$DEFAULT_DIR" "$DEFAULT_DUMP"
run_dump "$STRICT_DIR" "$STRICT_DUMP"

python3 - "$DEFAULT_DUMP" "$STRICT_DUMP" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as default_file:
    default = json.load(default_file)
with open(sys.argv[2], encoding="utf-8") as strict_file:
    strict = json.load(strict_file)

if default != strict:
    print("fast math guard: default and strict logprob dumps differ", file=sys.stderr)
    raise SystemExit(1)
PY

VECTOR_FLAGS="${DS4_FAST_MATH_VECTOR_FLAGS:-}"
if [[ -n "$VECTOR_FLAGS" ]]; then
  read -r -a vector_args <<<"$VECTOR_FLAGS"
  if ! (cd "$DEFAULT_DIR" && ./ds4_test "${vector_args[@]}"); then
    echo "fast math guard: default math test-vector run failed" >&2
    exit 1
  fi
  if ! (cd "$STRICT_DIR" && ./ds4_test "${vector_args[@]}"); then
    echo "fast math guard: strict math test-vector run failed" >&2
    exit 1
  fi
fi

echo "fast math guard passed"
