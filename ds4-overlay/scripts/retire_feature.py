#!/usr/bin/env python3
"""retire_feature.py - plan section 21, deciding when an overlay can be dropped.

The textual probe is deliberately NOT the decision.  Finding the word
"deepseek41" in upstream proves antirez shipped something with that name, not
that it behaves like the overlay.  This tool therefore reports two independent
things and refuses to conflate them:

  probe   did the symbol/text appear upstream?         (cheap, advisory)
  tests   does the feature's own suite pass WITHOUT     (authoritative)
          the overlay, against upstream alone?

Only a green pure-upstream test run justifies enabled=false.
"""
import argparse
import os
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import overlay_manifest as om  # noqa: E402


def probe(upstream, pr):
    path = os.path.join(upstream, pr["file"])
    if not os.path.isfile(path):
        return False, "file missing upstream"
    with open(path, encoding="utf-8", errors="surrogateescape") as f:
        n = f.read().count(pr["text"])
    return n > 0, "%d occurrence(s) of %r" % (n, pr["text"])


def main():
    p = argparse.ArgumentParser()
    p.add_argument("feature")
    p.add_argument("--upstream", default=os.path.dirname(os.path.dirname(
        os.path.dirname(os.path.abspath(__file__)))))
    p.add_argument("--overlay", default=os.path.dirname(
        os.path.dirname(os.path.abspath(__file__))))
    p.add_argument("--pure-upstream-test", action="store_true",
                   help="compose WITHOUT this feature and run its tests there")
    a = p.parse_args()

    feats = om.load_features(a.overlay)
    f = next((x for x in feats if x.id == a.feature), None)
    if not f:
        raise SystemExit("no such feature: %s (have: %s)"
                         % (a.feature, ", ".join(x.id for x in feats)))

    print("feature %s (%s)" % (f.id, "enabled" if f.enabled else "disabled"))
    print("  %s" % (f.description or "(no description)"))

    print("\nprobes (advisory only):")
    if not f.retire_probes:
        print("  none declared")
    for pr in f.retire_probes:
        hit, detail = probe(os.path.abspath(a.upstream), pr)
        print("  %-6s %s: %s" % ("FOUND" if hit else "absent", pr["file"], detail))

    print("\ntests that must pass against pure upstream before retiring:")
    if not f.tests:
        print("  none declared -- this feature CANNOT be retired safely:")
        print("  with no test there is no evidence of equivalence.")
    for t in f.tests:
        print("  %s%s" % (t["command"], "" if t.get("required") else "   (optional)"))

    if not a.pure_upstream_test:
        print("\nNo equivalence run was performed. A probe is not a decision;\n"
              "re-run with --pure-upstream-test to actually compare.")
        return 0

    others = [x.id for x in om.enabled_features(a.overlay) if x.id != f.id]
    print("\ncomposing pure-upstream tree (without %s)..." % f.id)
    compose = os.path.join(os.path.dirname(os.path.abspath(__file__)), "compose_shadow.py")
    out = os.path.join(om.build_root(a.overlay), "pure-upstream-%s" % f.id, "src")
    r = subprocess.run([sys.executable, compose, "--upstream", a.upstream,
                        "--overlay", a.overlay, "--out", out,
                        "--feature", *others], capture_output=True, text=True)
    sys.stdout.write(r.stdout)
    if r.returncode != 0:
        sys.stderr.write(r.stderr)
        return r.returncode

    failed = 0
    for t in f.tests:
        print("\n$ %s" % t["command"])
        rr = subprocess.run(t["command"], shell=True, cwd=out)
        if rr.returncode != 0:
            failed += 1
            print("  FAILED (rc=%d)" % rr.returncode)
    if failed:
        print("\n%d test(s) failed without the overlay: %s is NOT retirable."
              % (failed, f.id))
        return 1
    print("\nAll of %s's tests pass against pure upstream." % f.id)
    print("Equivalence of behaviour is now evidenced for the declared tests only.")
    print("Performance and golden-output parity are separate checks (plan 18).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
