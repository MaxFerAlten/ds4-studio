#!/bin/sh
# run_all.sh - the overlay's own toolchain tests (not the DS4 test suite).
set -e
cd "$(dirname "$0")"
fail=0
for t in test_exact_patch.py test_make_patch.py test_upstream_immutable.sh test_compose_shadow.sh; do
    echo "=== $t ==="
    ./"$t" || fail=1
    echo
done
[ "$fail" -eq 0 ] && { echo "run_all: PASS"; exit 0; }
echo "run_all: FAIL"; exit 1
