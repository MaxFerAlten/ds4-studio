#!/usr/bin/env bash
# Model-free smoke: one fixture end to end in a throwaway state dir (no DS4, no model).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
exec "$ROOT/.venv/bin/h2ds4" demo --no-model --fixture "${1:-json-002}"
