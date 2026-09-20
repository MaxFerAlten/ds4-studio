#!/bin/sh
# test_upstream_compat.sh - the DS4 Studio architectural test.
#
# Two invariants:
#   1. upstream files are pristine  -> `git diff` on them is empty
#   2. every Studio patch (ds4-overlay patches/studio/, strict) still resolves
#      against that pristine upstream
#
# If both hold, `git pull` needs no hand re-adaptation.

set -e
cd "$(dirname "$0")/.."

UPSTREAM="ds4_agent.c ds4_server.c Makefile"
fail=0

echo "== upstream purity =="
for f in $UPSTREAM; do
    if [ -n "$(git diff --name-only -- "$f")" ] || \
       [ -n "$(git diff --cached --name-only -- "$f")" ]; then
        echo "FAIL $f is modified; Studio changes belong in ds4-overlay, not upstream"
        git --no-pager diff --stat -- "$f" | sed 's/^/     /'
        fail=1
    else
        echo "ok   $f pristine"
    fi
done

echo
echo "== studio patches resolve against upstream (strict) =="
# Studio's edits are ds4-overlay shadow patches now. Apply each one, strictly,
# to a throwaway copy of the upstream file: the applier is never pointed at the
# upstream tree itself, not even to dry-run.
OVERLAY="${DS4_OVERLAY_DIR:-$(cd .. && pwd)/ds4-overlay}"
if [ ! -d "$OVERLAY/patches/studio" ]; then
    echo "FAIL no studio patches at $OVERLAY/patches/studio (set DS4_OVERLAY_DIR)"
    fail=1
fi
for patch in "$OVERLAY"/patches/studio/*.patch; do
    [ -e "$patch" ] || continue
    if python3 - "$OVERLAY/scripts" "$patch" "$PWD" <<'EOF'
import os, shutil, sys, tempfile
scripts, patch, upstream = sys.argv[1:4]
sys.path.insert(0, scripts)
import exact_patch as ep
files = ep.parse_patch(open(patch, encoding="utf-8", errors="surrogateescape").read())
tmp = tempfile.mkdtemp()
try:
    for rel in files:
        # Studio patches a copy at studio/<name> of upstream's <name>
        # (studio-app-layer's `from`), so resolve it against that file.
        os.makedirs(os.path.dirname(os.path.join(tmp, rel)), exist_ok=True)
        shutil.copy2(os.path.join(upstream, os.path.basename(rel)), os.path.join(tmp, rel))
    ep.apply_patch(tmp, patch, strict=True)
except ep.PatchError as e:
    print("FAIL %s\n     %s" % (os.path.basename(patch), e))
    sys.exit(1)
finally:
    shutil.rmtree(tmp)
EOF
    then
        echo "ok   $(basename "$patch")"
    else
        fail=1
    fi
done

echo
if [ "$fail" -ne 0 ]; then
    echo "test_upstream_compat: FAIL"
    exit 1
fi
echo "test_upstream_compat: PASS"
