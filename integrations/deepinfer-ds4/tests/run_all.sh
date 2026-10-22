#!/usr/bin/env bash
# Every offline check of the DeepInfer integration. No GPU, model or network.
set -euo pipefail
root=$(cd "$(dirname "$0")/.." && pwd)
# PR-05: build the recipe adapter (offline, locked) and the DS4 render oracle
# when the local deepseek-recipe checkout exists; their tests skip otherwise.
if command -v cargo >/dev/null && [ -d "$root/../../../deepseek-recipe" ]; then
  (cd "$root/recipe-adapter" && cargo build --offline --locked --quiet)
  make -C "$root/recipe-adapter/oracle" --quiet
fi
make -C "$root/c" test test-asan
bash "$root/tests/test_bench_matrix.sh"
# Tests run without a network namespace when possible: zero external requests.
netless=()
if unshare -rn true 2>/dev/null; then netless=(unshare -rn); fi
(cd "$root/python" && "${netless[@]}" python3 -m pytest -q -p no:cacheprovider tests)
python3 -m json.tool "$root/config/deepinfer-overlay.defaults.json" >/dev/null
python3 -m json.tool "$root/LICENSES/third_party.lock.json" >/dev/null
echo "PASS deepinfer-ds4 offline suite"
