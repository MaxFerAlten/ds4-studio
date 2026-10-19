#!/usr/bin/env bash
# WP00 read-only discovery + fingerprint of every configured DS4 checkout into reports/.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$ROOT/reports/preflight"
mkdir -p "$OUT"
for DS4 in "${@:-/mnt/crucial_ai/COPARATOR/ds4}"; do
  name="$(basename "$DS4")"
  "$ROOT/.venv/bin/h2ds4" preflight --ds4-root "$DS4" --output "$OUT/$name.json" >/dev/null
  echo "wrote $OUT/$name.json"
done
