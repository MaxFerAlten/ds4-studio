#!/usr/bin/env bash
# Copy sanitized experiment reports (no raw prompts/outputs exist by design) into reports/.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="${XDG_DATA_HOME:-$HOME/.local/share}/h2ds4/reports"
DST="$ROOT/reports/experiments"
[[ -d "$SRC" ]] || { echo "no experiment reports yet"; exit 0; }
mkdir -p "$DST"
cp --no-dereference --preserve=mode "$SRC"/*.json "$DST"/ 2>/dev/null || true
echo "copied to $DST"
