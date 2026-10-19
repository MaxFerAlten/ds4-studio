#!/usr/bin/env bash
# L3 hard gate: sandbox negative tests. Any FAIL blocks release; SKIP = not certified.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
.venv/bin/python -c 'from h2ds4.sandbox.bwrap import preflight; import json; print(json.dumps(preflight(), indent=2))'
exec .venv/bin/pytest tests/security -q -rs -W ignore::DeprecationWarning
