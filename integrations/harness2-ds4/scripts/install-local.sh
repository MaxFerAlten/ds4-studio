#!/usr/bin/env bash
# Local install into .venv from the lockfile. No global install, no service enablement.
# Fetches the pinned Harness² checkout if absent and verifies the exact commit.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PIN=1cfe254e8d25b15f37048c3730134686abe60335
cd "$ROOT"
if [[ ! -d vendor/harness2/.git && ! -f vendor/harness2/.git ]]; then
  git submodule update --init vendor/harness2
fi
test "$(git -C vendor/harness2 rev-parse HEAD)" = "$PIN" || { echo "harness2 pin mismatch" >&2; exit 7; }
uv sync --frozen --python 3.12 --extra dev "$@"
echo "installed into $ROOT/.venv (service NOT enabled)"
