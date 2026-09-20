#!/usr/bin/env python3
"""Write a unified diff whose every hunk is unique in the file it patches.

    make_patch.py UPSTREAM_FILE EDITED_FILE --name ds4_agent.c > feature.patch

The overlay's applier (exact_patch.py) resolves each hunk by its text. With a
fixed context, as `diff -u` gives, a hunk can land on a block that repeats in
the file, and then only the declared line number tells the copies apart. That
is exact but fragile: after an upstream change moves code, a different but
identical block can sit at the old line.

So each hunk here starts from the usual 3 lines of context and grows, one line
at a time on each side, until its old-side text occurs exactly once in the
upstream file. Hunks whose windows meet are merged, and a merged block is
still unique because it contains a unique one. The result applies under
`strict` shadow patches, which refuse any hunk that is not globally unique.

This replaces studio_overlay.py's `extract`: DS4 Studio's edits used to live in
a second format (.ops) with its own applier. Both applied the same way -- every
anchor resolved against the pristine file, then one splice -- so one format is
enough, and this is what regenerates it after a hand edit.
"""
from __future__ import annotations

import argparse
import difflib
import sys

MIN_CTX = 3


def count_block(hay: list[str], needle: list[str]) -> int:
    n = len(needle)
    if n == 0:
        return 0
    first = needle[0]
    return sum(1 for i in range(len(hay) - n + 1)
               if hay[i] == first and hay[i:i + n] == needle)


def hunks_for(a: list[str], b: list[str]) -> list[tuple[int, int, int, int]]:
    """-> [(a_start, a_end, b_start, b_end)], each a-block unique in a."""
    ops = difflib.SequenceMatcher(None, a, b, autojunk=False).get_opcodes()
    equal = [(i1, i2, j1) for tag, i1, i2, j1, _ in ops if tag == "equal"]

    def to_b(ai: int) -> int:
        # After merging, an edge is one no other window contains, and an edge
        # inside a changed region is always contained by that change's own
        # window -- so every surviving edge is in an unchanged run.
        if ai == 0:
            return 0
        if ai == len(a):
            return len(b)
        for i1, i2, j1 in equal:
            if i1 <= ai <= i2:
                return j1 + (ai - i1)
        raise ValueError("window edge %d is not in an unchanged region" % ai)

    windows = []
    for tag, i1, i2, _, _ in ops:
        if tag == "equal":
            continue
        ctx = MIN_CTX
        while True:
            s, e = max(0, i1 - ctx), min(len(a), i2 + ctx)
            if count_block(a, a[s:e]) == 1 or (s == 0 and e == len(a)):
                break
            ctx += 1
        if count_block(a, a[s:e]) != 1:
            raise ValueError("change at line %d cannot be anchored uniquely" % (i1 + 1))
        windows.append([s, e])

    # Sorted by start, not by change order: a later change that needed a lot of
    # context can reach back past an earlier window, and merging in change
    # order then kept the wrong start.
    merged = []
    for w in sorted(windows):
        if merged and w[0] <= merged[-1][1]:
            merged[-1][0] = min(merged[-1][0], w[0])
            merged[-1][1] = max(merged[-1][1], w[1])
        else:
            merged.append(list(w))
    return [(s, e, to_b(s), to_b(e)) for s, e in merged]


def unified(a: list[str], b: list[str], name: str) -> str:
    out = ["--- a/%s\n" % name, "+++ b/%s\n" % name]
    sm = difflib.SequenceMatcher(None, a, b, autojunk=False)
    for s, e, bs, be in hunks_for(a, b):
        out.append("@@ -%d,%d +%d,%d @@\n" % (s + 1, e - s, bs + 1, be - bs))
        for tag, i1, i2, j1, j2 in sm.get_opcodes():
            lo, hi = max(i1, s), min(i2, e)
            if tag == "equal":
                for k in range(lo, hi):
                    out.append(" " + a[k])
                continue
            if tag == "insert":
                if s <= i1 <= e and j1 >= bs and j2 <= be:
                    out.extend("+" + line for line in b[j1:j2])
                continue
            if i1 >= s and i2 <= e:
                out.extend("-" + line for line in a[i1:i2])
                out.extend("+" + line for line in b[j1:j2])
    for i, line in enumerate(out):
        if not line.endswith("\n"):
            out[i] = line + "\n\\ No newline at end of file\n"
    return "".join(out)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("upstream")
    ap.add_argument("edited")
    ap.add_argument("--name", required=True, help="path the patch names, e.g. ds4_agent.c")
    args = ap.parse_args(argv)
    with open(args.upstream) as fh:
        a = fh.readlines()
    with open(args.edited) as fh:
        b = fh.readlines()
    sys.stdout.write(unified(a, b, args.name))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
