#!/usr/bin/env python3
"""diff_report.py - hunk-level triage of upstream -> downstream.

Why this exists.  The naive `diff upstream downstream` is NOT the overlay: the
downstream fork is behind upstream on most files, so that diff is full of hunks
that would *revert* upstream work.  Applying it would silently undo features
antirez already shipped.

Each hunk is therefore classified:

  add    only '+' lines            downstream adds something upstream lacks
                                   -> genuine overlay content
  del    only '-' lines            upstream has something downstream lacks
                                   -> upstream is ahead; NOT overlay content
  mixed  both                      a real divergence; needs a human decision

`--emit add` writes a patch containing only the `add` hunks, which is the
overlay's starting patchset.  `mixed` hunks are never emitted automatically.
"""
import argparse
import difflib
import json
import os
import sys


def read(p):
    with open(p, encoding="utf-8", errors="surrogateescape") as f:
        return f.readlines()


def hunks(a, b, ctx=3):
    """Unified-diff hunks as (header, body_lines, n_add, n_del)."""
    out, cur = [], None
    for line in difflib.unified_diff(a, b, n=ctx, lineterm="\n"):
        if line.startswith("---") or line.startswith("+++"):
            continue
        if line.startswith("@@"):
            if cur:
                out.append(cur)
            cur = [line, [], 0, 0]
            continue
        if cur is None:
            continue
        cur[1].append(line)
        if line.startswith("+"):
            cur[2] += 1
        elif line.startswith("-"):
            cur[3] += 1
    if cur:
        out.append(cur)
    return out


def classify(h):
    _, _, na, nd = h
    if na and not nd:
        return "add"
    if nd and not na:
        return "del"
    return "mixed"


def renumber(body, old_start):
    """Recompute a hunk header for a body applied to the upstream file."""
    old_n = sum(1 for l in body if l[0] in " -")
    new_n = sum(1 for l in body if l[0] in " +")
    return old_start, old_n, new_n


def build_patch(rel, a, selected):
    """Emit a git-applyable patch containing only `selected` hunks.

    Hunks are re-emitted against the upstream file one at a time, with the new
    side offset by everything already accepted, so the patch stays valid when
    only a subset of the original hunks is kept.
    """
    lines = ["diff --git a/%s b/%s\n" % (rel, rel),
             "--- a/%s\n" % rel, "+++ b/%s\n" % rel]
    offset = 0
    for header, body, na, nd in selected:
        # @@ -l,s +l,s @@
        old_start = int(header.split("-")[1].split(",")[0].split()[0])
        o_s, o_n, n_n = renumber(body, old_start)
        lines.append("@@ -%d,%d +%d,%d @@\n" % (o_s, o_n, o_s + offset, n_n))
        lines.extend(body)
        offset += n_n - o_n
    return lines


def main():
    p = argparse.ArgumentParser()
    root = os.path.dirname(os.path.dirname(
        os.path.dirname(os.path.abspath(__file__))))
    p.add_argument("--upstream", default=root)
    p.add_argument("--downstream", default=os.path.join(root, "ds4-v41-rocm"))
    p.add_argument("--files", nargs="+", required=True)
    p.add_argument("--emit", choices=["add", "mixed", "add+mixed"],
                   help="write patches containing only hunks of this class")
    p.add_argument("--outdir")
    p.add_argument("--json")
    a = p.parse_args()

    want = set()
    if a.emit:
        want = set(a.emit.split("+"))

    report = {}
    for rel in a.files:
        up = os.path.join(a.upstream, rel)
        dn = os.path.join(a.downstream, rel)
        if not (os.path.isfile(up) and os.path.isfile(dn)):
            print("skip (missing both sides): %s" % rel)
            continue
        A, B = read(up), read(dn)
        hs = hunks(A, B)
        counts = {"add": 0, "del": 0, "mixed": 0}
        lines_by = {"add": 0, "del": 0, "mixed": 0}
        sel = []
        for h in hs:
            c = classify(h)
            counts[c] += 1
            lines_by[c] += h[2] + h[3]
            if c in want:
                sel.append(h)
        report[rel] = {"hunks": len(hs), "by_class": counts, "lines": lines_by,
                       "selected": len(sel)}
        print("%-44s hunks=%-4d add=%-4d del=%-4d mixed=%-4d  selected=%d"
              % (rel, len(hs), counts["add"], counts["del"], counts["mixed"], len(sel)))
        if a.emit and sel and a.outdir:
            os.makedirs(a.outdir, exist_ok=True)
            name = rel.replace("/", "__") + ".patch"
            out = os.path.join(a.outdir, name)
            with open(out, "w", encoding="utf-8", errors="surrogateescape") as f:
                f.writelines(build_patch(rel, A, sel))
            print("    -> %s" % out)

    if a.json:
        json.dump(report, open(a.json, "w"), indent=1)
    return 0


if __name__ == "__main__":
    sys.exit(main())
