#!/usr/bin/env python3
"""verify_upstream_clean.py - plan section 23, upstream immutability guard.

Two independent checks, because they fail in different ways:

  git  - catches anything git tracks (worktree + index).  Authoritative for
         "did the toolchain write a tracked upstream file".
  hash - catches writes that git would not notice at the moment of checking
         (a file restored to the same path by a tool, a mid-build mutation),
         by comparing SHA-256 against a manifest captured before the build.

Exit 0 only when both agree upstream is untouched.  Anything else is non-zero:
the overlay toolchain must never continue on a dirty upstream.
"""
import argparse
import hashlib
import json
import os
import subprocess
import sys

# temp/ is explicitly outside the contract (plan section 2, invariant 10).
EXCLUDE_PATHSPEC = [":(exclude)temp/**", ":(exclude)ds4-overlay/**"]


def git(root, *args):
    r = subprocess.run(["git", "-C", root, *args],
                       capture_output=True, text=True)
    return r.returncode, r.stdout, r.stderr


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def upstream_paths(root):
    """The files that came from upstream, or None when that cannot be told.

    With upstream's history merged in (the standalone layout), its own tree
    says exactly which tracked files are upstream's; everything else in the
    repository is Studio's and is edited directly, not through a patch.
    Without that ref nothing is known, so every tracked file is treated as
    upstream -- the strict reading, never the lax one."""
    ref = os.environ.get("DS4_UPSTREAM_REF", "upstream/main")
    rc, out, _ = git(root, "ls-tree", "-r", "--name-only", ref)
    if rc != 0:
        return None
    return {f for f in out.splitlines() if f}


def check_git(root, upstream=None):
    problems = []
    for args in (["diff", "--name-only", "--"],
                 ["diff", "--cached", "--name-only", "--"]):
        rc, out, err = git(root, *args, *EXCLUDE_PATHSPEC)
        if rc != 0:
            problems.append("git %s failed: %s" % (args[0], err.strip()))
            continue
        for f in out.split():
            if upstream is not None and f not in upstream:
                continue                      # a Studio file: ours to edit
            problems.append("%s modified (%s)" %
                            (f, "index" if "--cached" in args else "worktree"))
    return sorted(set(problems))


def build_manifest(root, files):
    return {f: sha256(os.path.join(root, f))
            for f in files if os.path.isfile(os.path.join(root, f))}


def tracked_files(root, upstream=None):
    rc, out, _ = git(root, "ls-files")
    if rc != 0:
        raise SystemExit("upstream is not a git repository: %s" % root)
    return [f for f in out.splitlines()
            if not f.startswith(("temp/", "ds4-overlay/"))
            and (upstream is None or f in upstream)]


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--upstream", required=True)
    p.add_argument("--manifest", help="hash manifest to write (--snapshot) or verify")
    p.add_argument("--snapshot", action="store_true",
                   help="write the manifest instead of verifying it")
    p.add_argument("--files", nargs="*",
                   help="limit the hash manifest to these paths (patch targets)")
    p.add_argument("--quiet", action="store_true")
    a = p.parse_args()

    up = os.path.abspath(a.upstream)
    upstream = upstream_paths(up)
    files = a.files if a.files else tracked_files(up, upstream)

    if a.snapshot:
        if not a.manifest:
            raise SystemExit("--snapshot needs --manifest")
        m = build_manifest(up, files)
        os.makedirs(os.path.dirname(os.path.abspath(a.manifest)) or ".", exist_ok=True)
        json.dump({"upstream": up,
                   "head": git(up, "rev-parse", "HEAD")[1].strip(),
                   "files": m}, open(a.manifest, "w"), indent=1)
        if not a.quiet:
            print("snapshot: %d files -> %s" % (len(m), a.manifest))
        return 0

    problems = check_git(up, upstream)

    if a.manifest and os.path.exists(a.manifest):
        saved = json.load(open(a.manifest))
        head_now = git(up, "rev-parse", "HEAD")[1].strip()
        if saved.get("head") != head_now:
            problems.append("upstream HEAD moved during the run: %s -> %s"
                            % (saved.get("head"), head_now))
        for f, want in saved["files"].items():
            path = os.path.join(up, f)
            if not os.path.isfile(path):
                problems.append("%s disappeared since the snapshot" % f)
            elif sha256(path) != want:
                problems.append("%s content changed since the snapshot" % f)

    if problems:
        sys.stderr.write("UPSTREAM_DIRTY: %s\n" % up)
        for x in problems:
            sys.stderr.write("  %s\n" % x)
        sys.stderr.write("\nThe overlay toolchain must not write to upstream.\n"
                         "Capture the change as an overlay patch, then restore\n"
                         "the file with: git -C %s checkout -- <file>\n" % up)
        return 1

    if not a.quiet:
        print("upstream clean: %s @ %s" % (up, git(up, "rev-parse", "--short", "HEAD")[1].strip()))
    return 0


if __name__ == "__main__":
    sys.exit(main())
