#!/bin/sh
set -eu
HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
if [ -f "$HERE/../studio/ds4_openwiki_request.c" ]; then
  ROOT=$(CDPATH= cd -- "$HERE/.." && pwd)
  SRC="$ROOT/studio/ds4_openwiki_request.c"
  INC="$ROOT/studio"
  COMPOSED=1
else
  ROOT=$(CDPATH= cd -- "$HERE/../../../.." && pwd)
  SRC="$ROOT/ds4-overlay/features/openwiki-transport/src/studio/ds4_openwiki_request.c"
  INC="$ROOT/ds4-overlay/features/openwiki-transport/src/studio"
  COMPOSED=0
fi
BUILD=$(mktemp -d "${TMPDIR:-/tmp}/ds4-openwiki-request.XXXXXX")
trap 'rm -rf "$BUILD"' EXIT HUP INT TERM
cc -std=c11 -Wall -Wextra -Werror \
  -I"$INC" "$SRC" "$HERE/test_openwiki_request.c" \
  -o "$BUILD/test_openwiki_request"
"$BUILD/test_openwiki_request"
if [ "$COMPOSED" = 1 ]; then
  node "$HERE/test_openwiki_request_scope.mjs" \
    "$ROOT/studio/ds4_wrapper_http.c" "$ROOT/studio/ds4_agent_runtime.c"
fi
