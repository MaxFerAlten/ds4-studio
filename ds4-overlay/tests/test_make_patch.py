#!/usr/bin/env python3
"""test_make_patch.py - a generated patch must be unique and round-trip exactly.

The case this exists for: `diff -u` gives every hunk 3 lines of context, and in
ds4_agent.c one of DS4 Studio's 148 edits sat in a block that repeats, so its
hunk was not unique. make_patch.py grows each hunk's context until it is, and a
strict shadow_patch then refuses anything that is not.
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "scripts"))
import exact_patch as ep  # noqa: E402
import make_patch as mp  # noqa: E402

fails = []


def check(label, cond):
    print(("ok   " if cond else "FAIL ") + label)
    if not cond:
        fails.append(label)


def lines(s):
    return s.splitlines(keepends=True)


def roundtrip(a, b):
    patch = mp.unified(a, b, "f.txt")
    hunks = ep.parse_patch(patch)["f.txt"]
    return hunks, "".join(ep.apply_to_lines(a, hunks, "f.txt", strict=True))


# 1. an edit inside a block repeated verbatim elsewhere: 3 lines of context are
#    not enough, the hunk must grow until its text occurs once.
rep = ["free(a);\n", "free(b);\n", "free(c);\n", "return 0;\n"]
a = lines("head\n") + rep + lines("mid\n") + rep + lines("tail\n")
b = list(a)
b[2] = "free(B);\n"                       # inside the FIRST copy
hunks, out = roundtrip(a, b)
check("repeated block: applies strictly and exactly", out == "".join(b))
check("repeated block: every hunk unique",
      all(mp.count_block(a, h[1]) == 1 for h in hunks))
check("repeated block: context grew past 3", len(hunks[0][1]) > 1 + 2 * 3 or hunks[0][0] == 1)

# 2. several edits whose grown windows meet are merged into one hunk
a = lines("".join("l%d\n" % i for i in range(40)))
b = list(a)
b[10] = "X\n"
b[13] = "Y\n"
hunks, out = roundtrip(a, b)
check("nearby edits: exact", out == "".join(b))
check("nearby edits: merged, no overlap", len(hunks) == 1)

# 3. insertion, deletion and edits at both file edges
a = lines("first\nsecond\nthird\nfourth\nlast\n")
b = lines("NEW\nfirst\nthird\nfourth\nlast\nAPPENDED\n")
hunks, out = roundtrip(a, b)
check("edges, insert and delete: exact", out == "".join(b))

# 4. a file without a trailing newline survives
a = lines("a\nb\nc")
b = lines("a\nB\nc")
hunks, out = roundtrip(a, b)
check("no trailing newline: exact", out == "".join(b))

print()
if fails:
    print("test_make_patch: FAIL (%d)" % len(fails))
    sys.exit(1)
print("test_make_patch: PASS")
