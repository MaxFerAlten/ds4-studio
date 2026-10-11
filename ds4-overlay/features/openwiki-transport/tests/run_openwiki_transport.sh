#!/usr/bin/env bash
set -euo pipefail

HERE="$(cd -- "$(dirname -- "$0")" && pwd)"
ROOT="$(cd -- "$HERE/.." && pwd)"
BUILD="$(mktemp -d "${TMPDIR:-/tmp}/ds4-openwiki-transport.XXXXXX")"
trap 'rm -rf "$BUILD"' EXIT

CC_BIN="${CC:-cc}"
FLAGS=(-std=c11 -O1 -g -Wall -Wextra -Werror -I"$ROOT/studio")
if [[ "${DS4_OW_SANITIZE:-0}" == "1" ]]; then
    FLAGS+=(-fsanitize=address,undefined -fno-omit-frame-pointer)
fi

"$CC_BIN" "${FLAGS[@]}" \
    "$ROOT/studio/ds4_openwiki_policy.c" \
    "$ROOT/studio/ds4_openwiki_client.c" \
    "$HERE/test_openwiki_client.c" \
    -pthread -o "$BUILD/test_openwiki_client"
"$BUILD/test_openwiki_client"
node "$HERE/test_openwiki_dispatch_integration.mjs" "$ROOT/studio/ds4_agent.c"
"$CC_BIN" -O2 -std=c11 -D_GNU_SOURCE -I"$ROOT" -I"$ROOT/studio" \
    -I"$ROOT/tests/fixtures/openwiki-prompt-compile-only" \
    -Wno-unused-function -DDS4_AGENT_TEST -c "$ROOT/studio/ds4_agent.c" \
    -o "$BUILD/ds4_agent.o"
echo "Composed DS4 agent compile: PASS"
