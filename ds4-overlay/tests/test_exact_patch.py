#!/usr/bin/env python3
"""test_exact_patch.py - regression cover for the applier.

The bug this file exists for: the original composer used `git apply`, which -
because the shadow tree lives inside the overlay repository - resolved paths
against the repository root, exited 0, and wrote nothing. It reported
"9 patches applied" for a patch that never landed.

So: applying must either change the file or raise. Never both zero and quiet.
"""
import os
import sys
import tempfile
import textwrap

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                "..", "scripts"))
import exact_patch as ep  # noqa: E402

fails = []


def check(label, cond):
    print(("ok   " if cond else "FAIL ") + label)
    if not cond:
        fails.append(label)


def workdir(name, body):
    d = tempfile.mkdtemp()
    with open(os.path.join(d, name), "w") as f:
        f.write(body)
    return d


BASE = "alpha\nbravo\ncharlie\ndelta\necho\n"

PATCH_OK = textwrap.dedent("""\
    diff --git a/f.txt b/f.txt
    --- a/f.txt
    +++ b/f.txt
    @@ -1,5 +1,6 @@
     alpha
     bravo
    -charlie
    +CHARLIE
    +charlie-two
     delta
     echo
    """)

# 1. a good patch applies and actually changes the file
d = workdir("f.txt", BASE)
ep.apply_patch(d, workdir("p.patch", PATCH_OK) + "/p.patch")
got = open(os.path.join(d, "f.txt")).read()
check("applies and changes content", "CHARLIE" in got and "charlie-two" in got)
check("untouched lines preserved", got.startswith("alpha\nbravo\n") and got.endswith("delta\necho\n"))

# 2. applying the same patch twice must fail, not silently no-op
try:
    ep.apply_patch(d, workdir("p.patch", PATCH_OK) + "/p.patch")
    check("re-applying an applied patch raises", False)
except ep.PatchError:
    check("re-applying an applied patch raises", True)

# 3. context that does not match must fail
d2 = workdir("f.txt", "alpha\nbravo\nDIFFERENT\ndelta\necho\n")
try:
    ep.apply_patch(d2, workdir("p.patch", PATCH_OK) + "/p.patch")
    check("mismatched context raises", False)
except ep.PatchError:
    check("mismatched context raises", True)

# 4. a symlinked target must be refused - writing it would go through to upstream
real = workdir("real.txt", BASE)
link = tempfile.mkdtemp()
os.symlink(os.path.join(real, "real.txt"), os.path.join(link, "f.txt"))
try:
    ep.apply_patch(link, workdir("p.patch", PATCH_OK) + "/p.patch")
    check("symlink target refused", False)
except ep.PatchError as e:
    check("symlink target refused", "symlink" in str(e))
check("symlinked original untouched", open(os.path.join(real, "real.txt")).read() == BASE)

# 5. an ambiguous hunk with a wrong line hint must fail rather than guess
REPEATED = "x\nSAME\ny\nSAME\nz\n"
AMBIG = textwrap.dedent("""\
    diff --git a/f.txt b/f.txt
    --- a/f.txt
    +++ b/f.txt
    @@ -99,1 +99,1 @@
    -SAME
    +CHANGED
    """)
d3 = workdir("f.txt", REPEATED)
try:
    ep.apply_patch(d3, workdir("p.patch", AMBIG) + "/p.patch")
    check("ambiguous hunk refused", False)
except ep.PatchError as e:
    check("ambiguous hunk refused", "expected exactly 1" in str(e))

# 6. dry_run must not write
d4 = workdir("f.txt", BASE)
ep.apply_patch(d4, workdir("p.patch", PATCH_OK) + "/p.patch", dry_run=True)
check("dry_run leaves the file alone", open(os.path.join(d4, "f.txt")).read() == BASE)

# 7. strict: a repeated block is refused even when it sits at the declared line.
# Without strict the line hint picks the copy; that is exact today and wrong the
# day upstream shifts code and a different identical block lands on that line.
AT_LINE_2 = textwrap.dedent("""\
    diff --git a/f.txt b/f.txt
    --- a/f.txt
    +++ b/f.txt
    @@ -2,1 +2,1 @@
    -SAME
    +CHANGED
    """)
d5 = workdir("f.txt", REPEATED)
ep.apply_patch(d5, workdir("p.patch", AT_LINE_2) + "/p.patch")
check("non-strict accepts a repeat at its declared line",
      open(os.path.join(d5, "f.txt")).read() == "x\nCHANGED\ny\nSAME\nz\n")
d6 = workdir("f.txt", REPEATED)
try:
    ep.apply_patch(d6, workdir("p.patch", AT_LINE_2) + "/p.patch", strict=True)
    check("strict refuses a repeated block", False)
except ep.PatchError as e:
    check("strict refuses a repeated block", "expected exactly 1" in str(e))
check("strict refusal writes nothing", open(os.path.join(d6, "f.txt")).read() == REPEATED)

# 8. strict still applies a hunk that is unique
d7 = workdir("f.txt", BASE)
ep.apply_patch(d7, workdir("p.patch", PATCH_OK) + "/p.patch", strict=True)
check("strict applies a unique hunk", "CHARLIE" in open(os.path.join(d7, "f.txt")).read())

print()
if fails:
    print("test_exact_patch: FAIL (%d)" % len(fails))
    sys.exit(1)
print("test_exact_patch: PASS")
