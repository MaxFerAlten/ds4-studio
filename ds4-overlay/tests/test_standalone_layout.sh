#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OVERLAY="$ROOT/ds4-overlay"

grep -F 'DS4_OVERLAY_DIR="${DS4_OVERLAY_DIR:-$ROOT_DIR/ds4-overlay}"' "$ROOT/srun.sh" >/dev/null
status="$($OVERLAY/scripts/overlayctl.py status)"
grep -F "upstream        : $ROOT" <<<"$status" >/dev/null
test ! -e "$OVERLAY/.git"
$OVERLAY/scripts/verify_anchors.py >/dev/null

old_parent="/mnt/crucial_ai/COPARATOR/"
if grep -R -n -F --exclude-dir=__pycache__ \
    --include='*.py' --include='*.sh' --include='*.toml' \
    "${old_parent}ds4" \
    "$OVERLAY/scripts" "$OVERLAY/tests" "$OVERLAY/overlay.toml"; then
  echo "standalone layout still contains an old DS4 runtime path" >&2
  exit 1
fi
