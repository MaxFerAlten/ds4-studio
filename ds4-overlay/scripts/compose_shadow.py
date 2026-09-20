#!/usr/bin/env python3
"""compose_shadow.py - build a compilable shadow tree from a read-only upstream.

Plan section 6.  The contract this file exists to enforce:

  * upstream is an input, never an output;
  * files nobody patches are symlinked, so the shadow costs almost nothing;
  * files a patch touches are REAL COPIES - never hardlinks, because a hardlink
    shares the inode and a patch would write straight through into upstream;
  * every anchor must match exactly the declared number of times, or compose
    stops.  No fuzz, no --3way, no --reject, no "closest match".

The shadow lands in <build>/<upstream-sha>/src, <build> being overlay.toml's
[paths] build (see overlay_manifest.build_root).
"""
import argparse
import json
import fcntl
import os
import shutil
import subprocess
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import overlay_manifest as om  # noqa: E402
import exact_patch  # noqa: E402

# Never copied into the shadow: upstream's own VCS, the excluded temp/ area
# (plan section 2, invariant 10), build outputs and editor/tool scratch.
EXCLUDE_DIRS = {".git", "temp", "tmp", ".build", "build", "__pycache__",
                ".serena", ".codex", ".tokensave", ".claude", "node_modules",
                "gguf", ".venv", "venv", "ds4-overlay"}
EXCLUDE_EXTS = {".o", ".a", ".so", ".dylib", ".pyc", ".gguf", ".orig",
                ".rej", ".bak", ".buk", ".swp"}
EXCLUDE_NAMES = {".DS_Store"}


def _same_bytes(a, b):
    import hashlib
    def h(p):
        return hashlib.sha256(open(p, "rb").read()).hexdigest()
    return h(a) == h(b)


def run(cmd, cwd=None, check=True):
    r = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True)
    if check and r.returncode != 0:
        raise SystemExit("command failed: %s\n%s%s" %
                         (" ".join(cmd), r.stdout, r.stderr))
    return r


def git_out(root, *args):
    return run(["git", "-C", root, *args]).stdout.strip()


def assert_upstream_clean(upstream, manifest=None):
    script = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                          "verify_upstream_clean.py")
    cmd = [sys.executable, script, "--upstream", upstream, "--quiet"]
    if manifest:
        cmd += ["--manifest", manifest]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        sys.stderr.write(r.stderr)
        raise SystemExit("compose refused: upstream is not clean")


def excluded(rel):
    parts = rel.split(os.sep)
    if any(p in EXCLUDE_DIRS for p in parts[:-1]) or parts[0] in EXCLUDE_DIRS:
        return True
    name = parts[-1]
    return name in EXCLUDE_NAMES or os.path.splitext(name)[1] in EXCLUDE_EXTS


def walk_upstream(upstream):
    for dp, dn, fn in os.walk(upstream):
        dn[:] = [d for d in dn if d not in EXCLUDE_DIRS]
        for f in fn:
            p = os.path.join(dp, f)
            rel = os.path.relpath(p, upstream)
            if not excluded(rel):
                yield rel


def verify_anchor(shadow, anchor, feature_id):
    path = os.path.join(shadow, anchor["file"])
    if not os.path.isfile(path):
        return "feature %s: anchor file %s does not exist in the shadow tree" % (
            feature_id, anchor["file"])
    with open(path, encoding="utf-8", errors="surrogateescape") as f:
        body = f.read()
    n = body.count(anchor["text"])
    want = anchor.get("count", 1)
    if n != want:
        return ("feature %s: anchor in %s matched %d time(s), expected %d\n"
                "      text: %s" % (feature_id, anchor["file"], n, want,
                                    anchor["text"].strip().splitlines()[0][:90]))
    return None


def compose(upstream, overlay, out, only=None, keep=False):
    upstream = os.path.abspath(upstream)
    overlay = os.path.abspath(overlay)

    assert_upstream_clean(upstream)
    sha = git_out(upstream, "rev-parse", "HEAD")

    if out is None:
        out = os.path.join(om.build_root(overlay), sha, "src")
    out = os.path.abspath(out)

    # A shadow inside upstream would put generated files where the guard must
    # stay silent, and a shadow inside temp/ is forbidden outright.
    if out.startswith(upstream + os.sep):
        raise SystemExit("refusing to compose inside upstream: %s" % out)
    if os.sep + "temp" + os.sep in out + os.sep:
        raise SystemExit("refusing to compose inside temp/: %s" % out)

    features = om.enabled_features(overlay, only)
    patch_targets = set()
    owner = {}
    for f in features:
        for t in f.patch_targets():
            if t in owner and owner[t] != f.id:
                # Plan section 24: two features on one file is allowed, two
                # features on one hunk is not - surface the overlap early.
                owner[t] = owner[t] + "," + f.id
            else:
                owner.setdefault(t, f.id)
            patch_targets.add(t)

    # An rmtree under a running build deletes sources mid-compile, and the
    # compiler then reports a file this compose has just claimed to write.
    # srun.sh holds the same lock across compose+make; taking it here covers a
    # compose run by hand while a build is in flight.
    lock_path = os.path.join(overlay, ".build.lock")
    if os.environ.get("DS4_BUILD_LOCK_HELD") == "1":
        # srun.sh already holds it across compose+make. Taking it again here
        # would block on our own parent forever, which is exactly what it did.
        lock_fd = None
    else:
        try:
            lock_fd = os.open(lock_path, os.O_CREAT | os.O_RDWR, 0o644)
        except OSError:
            lock_fd = None                  # read-only checkout: proceed unlocked
    if lock_fd is not None:
        try:
            fcntl.flock(lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            sys.stderr.write("compose: waiting for the build lock at %s\n" % lock_path)
            fcntl.flock(lock_fd, fcntl.LOCK_EX)

    if os.path.exists(out) and not keep:
        shutil.rmtree(out)
    os.makedirs(out, exist_ok=True)

    n_link = n_copy = 0
    for rel in walk_upstream(upstream):
        src = os.path.join(upstream, rel)
        dst = os.path.join(out, rel)
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        if os.path.lexists(dst):
            continue
        if rel in patch_targets:
            shutil.copy2(src, dst)          # real copy: about to be written to
            os.chmod(dst, os.stat(dst).st_mode | 0o200)
            n_copy += 1
        else:
            os.symlink(src, dst)            # read-only by convention + guard
            n_link += 1

    # Overlay-owned sources land after upstream so a feature can add files
    # without any patch at all (level L0).
    n_overlay = 0
    for f in features:
        for o in f.overlay_file:
            src = os.path.join(overlay, o["source"])
            if not os.path.isfile(src):
                raise SystemExit("feature %s: overlay_file source missing: %s"
                                 % (f.id, src))
            dst = os.path.join(out, o["target"])
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            if os.path.lexists(dst):
                os.unlink(dst)
            shutil.copy2(src, dst)
            n_overlay += 1

    def abandon(code):
        """Fail closed means leaving nothing behind, not just stopping.

        The tree above is already written by this point. Keeping it turns the
        next compose into a liar: the loop reuses anything that already exists
        (`if os.path.lexists(dst): continue`), so a half-built tree from a
        refused run gets silently adopted by the following one, with whatever
        file set the refused feature list happened to produce. That is how a
        build once died on a source file the compose had just reported writing.
        """
        if not keep:
            shutil.rmtree(out, ignore_errors=True)
        raise SystemExit(code)

    # A shadow_patch with `from` patches a COPY of an upstream file placed at its
    # own path, leaving the upstream-named file a pristine symlink. DS4 Studio
    # needs this: ds4-server and ds4-agent are built from ds4_server.c and
    # ds4_agent.c through Makefile.overlay and must stay antirez's binaries,
    # while the wrapper compiles the Studio-edited copy. Patching the files in
    # place would have handed Studio's 151 edits to every engine binary.
    for f in features:
        for p in f.shadow_patch:
            if "from" not in p:
                continue
            src = os.path.join(upstream, p["from"])
            dst = os.path.join(out, p["file"])
            if not os.path.isfile(src):
                sys.stderr.write("feature %s: shadow_patch from=%s is not an upstream file\n"
                                 % (f.id, p["from"]))
                abandon(3)
            if os.path.lexists(dst):
                sys.stderr.write("feature %s: shadow_patch file=%s already exists in the shadow; "
                                 "a copy would shadow it\n" % (f.id, p["file"]))
                abandon(3)
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            shutil.copy2(src, dst)
            os.chmod(dst, os.stat(dst).st_mode | 0o200)

    problems = []
    for f in features:
        for a in f.anchors:
            err = verify_anchor(out, a, f.id)
            if err:
                problems.append(err)
    if problems:
        sys.stderr.write("ANCHOR_FAIL: upstream %s no longer matches the overlay\n" % sha[:12])
        for p in problems:
            sys.stderr.write("  %s\n" % p)
        abandon(2)

    applied = []
    for f, p in om.ordered_patches(features):
        patch = os.path.join(overlay, p["patch"])
        if not os.path.isfile(patch):
            sys.stderr.write("feature %s: patch missing: %s\n" % (f.id, patch))
            abandon(3)
        try:
            touched = exact_patch.apply_patch(out, patch, strict=bool(p.get("strict")))
        except exact_patch.PatchError as e:
            sys.stderr.write(
                "PATCH_FAIL: feature=%s patch=%s\n  %s\n" % (f.id, p["patch"], e))
            sys.stderr.write(
                "  Fuzz, --3way and --reject are deliberately not available.\n"
                "  Re-derive this patch against upstream %s.\n" % sha[:12])
            abandon(3)

        # A patch that "succeeds" without changing anything is the failure mode
        # that shipped a false green once already: verify, do not assume.
        declared = p["file"]
        if declared not in dict(touched):
            sys.stderr.write(
                "PATCH_FAIL: feature=%s declares file=%s but the patch touched %s\n"
                % (f.id, declared, ", ".join(r for r, _ in touched)))
            abandon(3)
        up_file = os.path.join(upstream, p.get("from", declared))
        sh_file = os.path.join(out, declared)
        if os.path.isfile(up_file) and _same_bytes(up_file, sh_file):
            sys.stderr.write(
                "PATCH_FAIL: feature=%s patch=%s left %s identical to upstream\n"
                % (f.id, p["patch"], declared))
            abandon(3)
        applied.append({"feature": f.id, "file": declared, "patch": p["patch"],
                        "files_touched": [r for r, _ in touched]})

    write_generated_makefile(out, upstream, overlay)
    assert_upstream_clean(upstream)

    manifest = {
        "composed_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "upstream": upstream,
        "upstream_sha": sha,
        "overlay": overlay,
        "shadow": out,
        "features": [{"id": f.id, "enabled": f.enabled,
                      "anchors": len(f.anchors),
                      "patches": len(f.shadow_patch),
                      "overlay_files": len(f.overlay_file)} for f in features],
        "symlinked": n_link,
        "copied": n_copy,
        "overlay_files": n_overlay,
        "patches_applied": applied,
    }
    mpath = os.path.join(os.path.dirname(out), "compose.json")
    os.makedirs(os.path.dirname(mpath), exist_ok=True)
    json.dump(manifest, open(mpath, "w"), indent=1)

    print("shadow composed: %s" % out)
    print("  upstream   : %s @ %s" % (upstream, sha[:12]))
    print("  symlinked  : %d   copied: %d   overlay files: %d"
          % (n_link, n_copy, n_overlay))
    print("  features   : %s" % (", ".join(f.id for f in features) or "(none)"))
    print("  patches    : %d applied" % len(applied))
    print("  manifest   : %s" % mpath)
    return out


def write_generated_makefile(out, upstream, overlay):
    """Plan section 7.1 - include upstream first, overlay second, never edit
    the upstream Makefile.  Recursive $(MAKE) finds this file, so the overlay
    survives into sub-makes."""
    path = os.path.join(out, "Makefile.overlay")
    with open(path, "w") as f:
        f.write(
            "# GENERATED by compose_shadow.py - do not edit, do not commit.\n"
            "DS4_UPSTREAM := %s\n"
            "DS4_OVERLAY  := %s\n"
            "DS4_SHADOW   := %s\n"
            "include $(DS4_UPSTREAM)/Makefile\n"
            "include $(DS4_OVERLAY)/mk/overlay.mk\n" % (upstream, overlay, out))


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--upstream", default=os.path.dirname(os.path.dirname(
        os.path.dirname(os.path.abspath(__file__)))))
    p.add_argument("--overlay", default=os.path.dirname(
        os.path.dirname(os.path.abspath(__file__))))
    p.add_argument("--out")
    p.add_argument("--feature", nargs="*", help="compose only these feature ids")
    p.add_argument("--keep", action="store_true",
                   help="do not wipe an existing shadow tree first")
    a = p.parse_args()
    compose(a.upstream, a.overlay, a.out, a.feature, a.keep)
    return 0


if __name__ == "__main__":
    sys.exit(main())
