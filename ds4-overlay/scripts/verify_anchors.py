#!/usr/bin/env python3
"""verify_anchors.py - check every feature anchor against upstream, no compose.

This is the cheap rebase check: after `git pull`, it says in one pass whether
the overlay still has somewhere to attach.  It reads upstream directly and
writes nothing.
"""
import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import overlay_manifest as om  # noqa: E402


def check(upstream, features):
    bad = []
    for f in features:
        for a in f.anchors:
            path = os.path.join(upstream, a["file"])
            if not os.path.isfile(path):
                bad.append((f.id, a["file"], "file missing upstream", 0, a.get("count", 1)))
                continue
            with open(path, encoding="utf-8", errors="surrogateescape") as fh:
                n = fh.read().count(a["text"])
            want = a.get("count", 1)
            if n != want:
                bad.append((f.id, a["file"],
                            a["text"].strip().splitlines()[0][:80], n, want))
    return bad


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--upstream", default=os.path.dirname(os.path.dirname(
        os.path.dirname(os.path.abspath(__file__)))))
    p.add_argument("--overlay", default=os.path.dirname(
        os.path.dirname(os.path.abspath(__file__))))
    p.add_argument("--feature", nargs="*")
    p.add_argument("--all", action="store_true",
                   help="also check disabled features; their anchors rot too, "
                        "and a rotted anchor invalidates any retirement decision")
    a = p.parse_args()

    feats = (om.load_features(a.overlay, a.feature) if a.all
             else om.enabled_features(a.overlay, a.feature))
    total = sum(len(f.anchors) for f in feats)
    bad = check(os.path.abspath(a.upstream), feats)

    print("anchors: %d checked across %d %sfeature(s)"
          % (total, len(feats), "" if a.all else "enabled "))
    if not bad:
        print("all anchors resolve")
        return 0
    sys.stderr.write("ANCHOR_FAIL: %d anchor(s) no longer match upstream\n" % len(bad))
    for fid, fl, text, got, want in bad:
        sys.stderr.write("  feature %-22s %s\n      matched %s, expected %s\n      %s\n"
                         % (fid, fl, got, want, text))
    return 2


if __name__ == "__main__":
    sys.exit(main())
