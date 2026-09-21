#!/bin/sh
# test_compose_shadow.sh - end-to-end composer contract.
#
# Asserts the five properties the whole design rests on:
#   1. a shadow composes from a pristine upstream;
#   2. patch targets are REAL COPIES, never sharing an inode with upstream;
#   3. upstream is byte-identical afterwards;
#   4. a broken anchor STOPS the compose - it is never patched approximately;
#   5. generated/ is a live view of upstream, so build outputs written after
#      the compose are still visible to the compiler.

set -e
OVERLAY="$(cd "$(dirname "$0")/.." && pwd)"
UPSTREAM="${UPSTREAM:-$(cd "$OVERLAY/.." && pwd)}"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/ds4-compose.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

fail=0
say() { printf '%s\n' "$1"; }
bad() { printf 'FAIL %s\n' "$1"; fail=1; }

git clone --no-hardlinks --quiet "$UPSTREAM" "$WORK/up"
CLONE="$WORK/up"
SHADOW="$WORK/shadow"

say "== 1. compose =="
if python3 "$OVERLAY/scripts/compose_shadow.py" \
        --upstream "$CLONE" --overlay "$OVERLAY" --out "$SHADOW" >"$WORK/compose.log" 2>&1; then
    say "ok   composed"
else
    bad "compose failed"; sed 's/^/     /' "$WORK/compose.log"
fi

say ""
say "== 2/3. no shared inodes, upstream byte-identical =="
python3 - "$CLONE" "$SHADOW" <<'PY' || fail=1
import os, sys, hashlib, subprocess
up, sh = sys.argv[1], sys.argv[2]
shared = []
for dp, dn, fn in os.walk(sh):
    dn[:] = [d for d in dn if d != ".git"]
    for f in fn:
        p = os.path.join(dp, f)
        if os.path.islink(p):
            continue
        u = os.path.join(up, os.path.relpath(p, sh))
        if os.path.isfile(u) and os.stat(p).st_ino == os.stat(u).st_ino:
            shared.append(os.path.relpath(p, sh))
print("ok   no hardlinked patch targets" if not shared
      else "FAIL shared inodes with upstream: %s" % shared[:5])
r = subprocess.run(["git", "-C", up, "status", "--porcelain=v1",
                    "--untracked-files=no"], capture_output=True, text=True)
print("ok   upstream byte-identical after compose" if not r.stdout.strip()
      else "FAIL upstream dirty after compose:\n%s" % r.stdout)
sys.exit(1 if shared or r.stdout.strip() else 0)
PY

say ""
say "== 4. fail-closed: a broken anchor must stop the compose =="
BROKEN="$WORK/broken"
cp -r "$OVERLAY/features" "$WORK/features.bak"
mkdir -p "$BROKEN"
cp -r "$OVERLAY/mk" "$OVERLAY/patches" "$OVERLAY/scripts" "$OVERLAY/src" "$OVERLAY/tests" "$BROKEN/" 2>/dev/null || true
cp -r "$OVERLAY/features" "$BROKEN/features"
# Corrupt one anchor so it can no longer match upstream.
python3 - "$BROKEN" <<'PY'
import os, sys, re
root = sys.argv[1]
for d in sorted(os.listdir(os.path.join(root, "features"))):
    p = os.path.join(root, "features", d, "feature.toml")
    if not os.path.isfile(p):
        continue
    s = open(p).read()
    if "[[anchors]]" in s:
        s = s.replace("text = \"", "text = \"ZZZ_NO_SUCH_ANCHOR_ZZZ ", 1)
        open(p, "w").write(s)
        print("corrupted anchor in", d)
        break
PY
if python3 "$BROKEN/scripts/compose_shadow.py" --upstream "$CLONE" \
        --overlay "$BROKEN" --out "$WORK/shadow2" >"$WORK/broken.log" 2>&1; then
    bad "compose SUCCEEDED with a broken anchor (must be fail-closed)"
else
    if grep -q ANCHOR_FAIL "$WORK/broken.log"; then
        say "ok   compose refused with ANCHOR_FAIL"
    else
        bad "compose failed but not with ANCHOR_FAIL:"; sed 's/^/     /' "$WORK/broken.log"
    fi
fi

say ""
say "== 5. generated/ is a live view of upstream's build outputs =="
# The policy-header generators are run by make from inside the shadow, but node
# resolves their symlinked path back to upstream and writes there. A per-file
# mirror taken at compose time cannot show that: on a clean tree there is
# nothing to mirror yet, and the compile dies on a header make just built.
if [ -L "$SHADOW/generated" ] && [ -d "$SHADOW/generated" ]; then
    printf 'probe\n' >"$CLONE/generated/probe.h"
    if [ -f "$SHADOW/generated/probe.h" ]; then
        say "ok   build output written after the compose is visible"
    else
        bad "generated/ in the shadow does not follow upstream"
    fi
    rm -f "$CLONE/generated/probe.h"
else
    bad "shadow has no generated/ link (clean upstream has no generated/ yet)"
fi

say ""
[ "$fail" -eq 0 ] && { say "test_compose_shadow: PASS"; exit 0; }
say "test_compose_shadow: FAIL"; exit 1
