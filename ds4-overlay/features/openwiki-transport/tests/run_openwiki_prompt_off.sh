#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SHADOW="$ROOT"
BUILD="$(mktemp -d "${TMPDIR:-/tmp}/ds4-openwiki-prompt-off.XXXXXX")"
trap 'rm -rf "$BUILD"' EXIT
# The pinned upstream omits this Studio declaration header; the prompt-only
# harness includes the downstream agent source but links no evidence-guard code.
"${CC:-cc}" -std=gnu11 -O0 -Wall -Wextra -Werror -Wno-unused-function -Wno-format-truncation \
    -ffunction-sections -fdata-sections -I"$SHADOW" \
    -I"$ROOT/tests/fixtures/openwiki-prompt-compile-only" \
    "$SHADOW/tests/test_openwiki_prompt_off.c" \
    -Wl,--gc-sections -pthread -o "$BUILD/test_openwiki_prompt_off"
mkdir "$BUILD/snapshots"
"$BUILD/test_openwiki_prompt_off" "$BUILD/snapshots" \
    "$ROOT/tests/fixtures/openwiki-prompt-off"
for family in deepseek glm qwen dsml41; do
    actual_hash="$(sha256sum "$BUILD/snapshots/$family.actual" | cut -d ' ' -f 1)"
    case "$family" in
        deepseek) expected_hash=84977eddad025005c05e164192c3ee57953fe4e802fde3aed57cd1ad5b01ab61 ;;
        glm) expected_hash=57bcf276980b047019bbf886982f1504c28b8555b8852f4115f0179e301fefe9 ;;
        qwen) expected_hash=71ac0ffaa05a85c62adbcb4525b1c7587e3392a5db927f981071de8458979396 ;;
        dsml41) expected_hash=90037a543676ad4b5b8edc812a05c061b70c0908d1bf7e8b1d5ee50c81c71387 ;;
    esac
    test "$expected_hash" = "$actual_hash"
done
node "$ROOT/tests/test_openwiki_prompt_on.mjs" "$BUILD/snapshots"
echo "PASS: OFF tool/system prompts match pre-WP09 goldens; OFF reminders match baseline; ON schemas, reminders and both parsers pass for DeepSeek, GLM, Qwen, DSML41; default remains OFF."
