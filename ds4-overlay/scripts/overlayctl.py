#!/usr/bin/env python3
"""overlayctl.py - the one entry point (plan section 22).

    ./scripts/overlayctl.py status
    ./scripts/overlayctl.py compose
    ./scripts/overlayctl.py build --target strix-halo
    ./scripts/overlayctl.py test --suite rocm
    ./scripts/overlayctl.py diff
    ./scripts/overlayctl.py rebase-check
    ./scripts/overlayctl.py retire-check <feature>
    ./scripts/overlayctl.py pure-upstream-test <feature>
    ./scripts/overlayctl.py shadow-path
    ./scripts/overlayctl.py clean
"""
import argparse
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import overlay_manifest as om  # noqa: E402

DEFAULT_UPSTREAM = os.path.dirname(ROOT)
DEFAULT_DOWNSTREAM = os.path.join(DEFAULT_UPSTREAM, "ds4-v41-rocm")


def sh(cmd, **kw):
    return subprocess.run(cmd, **kw).returncode


def py(script, *args, **kw):
    return sh([sys.executable, os.path.join(HERE, script), *args], **kw)


def git_out(root, *args):
    r = subprocess.run(["git", "-C", root, *args], capture_output=True, text=True)
    return r.stdout.strip() if r.returncode == 0 else "?"


def shadow_dir(overlay, upstream):
    return os.path.join(om.build_root(overlay), git_out(upstream, "rev-parse", "HEAD"), "src")


def cmd_status(a):
    up = a.upstream
    print("upstream        : %s" % up)
    print("  HEAD          : %s  %s" % (git_out(up, "rev-parse", "--short", "HEAD"),
                                        git_out(up, "log", "-1", "--format=%s")))
    clean = py("verify_upstream_clean.py", "--upstream", up, "--quiet",
               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL) == 0
    print("  clean         : %s" % ("yes" if clean else "NO - see verify_upstream_clean.py"))
    print("overlay         : %s" % a.overlay)

    feats = om.load_features(a.overlay)
    print("features        : %d (%d enabled)"
          % (len(feats), sum(1 for f in feats if f.enabled)))
    for f in feats:
        print("  %-22s %-8s anchors=%-2d patches=%-2d files=%-2d tests=%d"
              % (f.id, "on" if f.enabled else "OFF", len(f.anchors),
                 len(f.shadow_patch), len(f.overlay_file), len(f.tests)))

    rc = py("verify_anchors.py", "--upstream", up, "--overlay", a.overlay,
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    print("anchors         : %s" % ("all resolve" if rc == 0 else "DRIFTED - run rebase-check"))

    sd = shadow_dir(a.overlay, up)
    cj = os.path.join(os.path.dirname(sd), "compose.json")
    if os.path.isfile(cj):
        m = json.load(open(cj))
        print("last compose    : %s  (%d symlinked, %d copied, %d patches)"
              % (m["composed_at"], m["symlinked"], m["copied"], len(m["patches_applied"])))
        print("  shadow        : %s" % m["shadow"])
    else:
        print("last compose    : none for this upstream sha")
    return 0


def cmd_compose(a):
    return py("compose_shadow.py", "--upstream", a.upstream, "--overlay", a.overlay)


def cmd_build(a):
    sd = shadow_dir(a.overlay, a.upstream)
    if not os.path.isdir(sd):
        print("no shadow tree yet; composing first")
        rc = cmd_compose(a)
        if rc:
            return rc
    target = a.target if a.target.startswith("overlay-") else "overlay-" + a.target
    return sh(["make", "-f", "Makefile.overlay", target], cwd=sd)


def cmd_test(a):
    sd = shadow_dir(a.overlay, a.upstream)
    if not os.path.isdir(sd):
        rc = cmd_compose(a)
        if rc:
            return rc
    target = "overlay-test-" + a.suite
    return sh(["make", "-f", "Makefile.overlay", target], cwd=sd)


def cmd_diff(a):
    # Compared against the reference fork by upstream name: a `from` copy has
    # no counterpart there under its shadow path.
    files = sorted({p.get("from", p["file"]) for f in om.load_features(a.overlay)
                    for p in f.shadow_patch})
    if not files:
        print("no patched files")
        return 0
    return py("diff_report.py", "--upstream", a.upstream,
              "--downstream", a.downstream, "--files", *files)


def cmd_rebase_check(a):
    print("== upstream ==")
    py("verify_upstream_clean.py", "--upstream", a.upstream)
    print("\n== anchors ==")
    rc = py("verify_anchors.py", "--upstream", a.upstream, "--overlay", a.overlay)
    if rc:
        print("\nAn anchor no longer matches. Do NOT relax it: re-derive the\n"
              "patch against the new upstream, or retire the feature if\n"
              "upstream now provides it (scripts/retire_feature.py).")
    return rc


def cmd_retire(a):
    return py("retire_feature.py", a.feature, "--upstream", a.upstream,
              "--overlay", a.overlay)


def cmd_pure(a):
    return py("retire_feature.py", a.feature, "--upstream", a.upstream,
              "--overlay", a.overlay, "--pure-upstream-test")


def cmd_shadow_path(a):
    """Print the shadow tree path for the current upstream sha (for scripts)."""
    print(shadow_dir(a.overlay, a.upstream))
    return 0


def cmd_clean(a):
    import shutil
    b = om.build_root(a.overlay)
    if os.path.isdir(b):
        shutil.rmtree(b)
        print("removed %s" % b)
    else:
        print("nothing to clean")
    return 0


def main():
    p = argparse.ArgumentParser(prog="overlayctl.py")
    p.add_argument("--upstream", default=DEFAULT_UPSTREAM)
    p.add_argument("--downstream", default=DEFAULT_DOWNSTREAM)
    p.add_argument("--overlay", default=ROOT)
    s = p.add_subparsers(dest="cmd", required=True)

    s.add_parser("status").set_defaults(fn=cmd_status)
    s.add_parser("compose").set_defaults(fn=cmd_compose)
    b = s.add_parser("build"); b.add_argument("--target", default="strix-halo"); b.set_defaults(fn=cmd_build)
    t = s.add_parser("test"); t.add_argument("--suite", default="rocm"); t.set_defaults(fn=cmd_test)
    s.add_parser("diff").set_defaults(fn=cmd_diff)
    s.add_parser("rebase-check").set_defaults(fn=cmd_rebase_check)
    r = s.add_parser("retire-check"); r.add_argument("feature"); r.set_defaults(fn=cmd_retire)
    u = s.add_parser("pure-upstream-test"); u.add_argument("feature"); u.set_defaults(fn=cmd_pure)
    s.add_parser("shadow-path").set_defaults(fn=cmd_shadow_path)
    s.add_parser("clean").set_defaults(fn=cmd_clean)

    a = p.parse_args()
    return a.fn(a)


if __name__ == "__main__":
    sys.exit(main())
