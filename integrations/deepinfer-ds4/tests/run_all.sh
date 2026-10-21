#!/usr/bin/env bash
# Every offline check of the DeepInfer integration. No GPU, model or network.
set -euo pipefail
root=$(cd "$(dirname "$0")/.." && pwd)
make -C "$root/c" test test-asan
bash "$root/tests/test_bench_matrix.sh"
(cd "$root/python" && python3 -m pytest -q -p no:cacheprovider tests)
python3 -m json.tool "$root/config/deepinfer-overlay.defaults.json" >/dev/null
python3 -m json.tool "$root/LICENSES/third_party.lock.json" >/dev/null
echo "PASS deepinfer-ds4 offline suite"
