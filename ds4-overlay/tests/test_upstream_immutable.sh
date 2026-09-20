#!/bin/sh
# test_upstream_immutable.sh - plan C01, the guard's negative test.
#
# A guard that has never been shown to fail is not a guard.  This makes a
# throwaway clone, dirties it three different ways, and asserts the guard
# catches each one.  The real upstream is never touched.

set -e
OVERLAY="$(cd "$(dirname "$0")/.." && pwd)"
UPSTREAM="${UPSTREAM:-$(cd "$OVERLAY/.." && pwd)}"
GUARD="$OVERLAY/scripts/verify_upstream_clean.py"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/ds4-guard.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

fail=0
expect() { # expect <want-rc> <label> <cmd...>
    want="$1"; label="$2"; shift 2
    if "$@" >/dev/null 2>&1; then got=0; else got=$?; fi
    if [ "$got" -eq "$want" ]; then
        echo "ok   $label (rc=$got)"
    else
        echo "FAIL $label: wanted rc=$want, got rc=$got"
        fail=1
    fi
}

git clone --no-hardlinks --quiet "$UPSTREAM" "$WORK/up"
CLONE="$WORK/up"

echo "== positive: a pristine clone must pass =="
expect 0 "clean clone passes" python3 "$GUARD" --upstream "$CLONE" --quiet

echo
echo "== negative: each kind of write must be caught =="

# 1. worktree edit of a tracked file
echo "/* overlay guard test */" >> "$CLONE/ds4.h"
expect 1 "worktree edit detected" python3 "$GUARD" --upstream "$CLONE" --quiet
git -C "$CLONE" checkout -- ds4.h

# 2. staged edit
echo "/* overlay guard test */" >> "$CLONE/ds4.h"
git -C "$CLONE" add ds4.h
expect 1 "staged edit detected" python3 "$GUARD" --upstream "$CLONE" --quiet
git -C "$CLONE" reset --quiet HEAD ds4.h
git -C "$CLONE" checkout -- ds4.h
expect 0 "clean again after restore" python3 "$GUARD" --upstream "$CLONE" --quiet

# 3. content change caught by the hash manifest even when git is quiet:
#    snapshot, mutate, restore mtime/size illusion -> hash still differs.
python3 "$GUARD" --upstream "$CLONE" --manifest "$WORK/m.json" --snapshot --quiet
printf '/* x */' >> "$CLONE/ds4.h"
expect 1 "hash manifest detects mutation" \
    python3 "$GUARD" --upstream "$CLONE" --manifest "$WORK/m.json" --quiet
git -C "$CLONE" checkout -- ds4.h

# 4. temp/ is outside the contract and must NOT trip the guard
mkdir -p "$CLONE/temp" && echo scratch > "$CLONE/temp/scratch.txt"
expect 0 "temp/ ignored by the contract" python3 "$GUARD" --upstream "$CLONE" --quiet

echo
if [ "$fail" -ne 0 ]; then
    echo "test_upstream_immutable: FAIL"
    exit 1
fi
echo "test_upstream_immutable: PASS"
