"""exact_patch.py - apply a unified diff exactly, or refuse.

Why not `git apply`.  The shadow tree lives inside the overlay repository, and
git resolves paths against the enclosing repository root rather than the
working directory.  In that situation `git apply` exits 0 and writes nothing:
a silent no-op, which is the single worst failure mode for a design whose whole
premise is fail-closed patching.  It shipped a "9 patches applied" message for
a patch that never landed.

So the applier is in-process and deliberately dumb:

  * a hunk's old side (context + removed lines) must match the target exactly;
  * it is looked for at the stated line first, then anywhere in the file;
  * it must match EXACTLY ONCE, or the patch is refused;
  * no fuzz, no partial application, no whitespace forgiveness;
  * the file is written only after every hunk of that file has been resolved.
"""
import os
import re

HUNK_RE = re.compile(r"^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@")


class PatchError(Exception):
    pass


def parse_patch(text):
    """-> {path: [(old_start, old_lines, new_lines), ...]} in file order."""
    files, path, hunks, cur = {}, None, None, None
    last_tag = None

    def flush_hunk():
        if cur is not None:
            hunks.append(cur)

    for line in text.splitlines(keepends=True):
        if line.startswith("diff --git "):
            flush_hunk()
            cur = None
            path, hunks = None, None
            continue
        if line.startswith("--- "):
            continue
        if line.startswith("+++ "):
            flush_hunk()
            cur = None
            p = line[4:].strip()
            if p.startswith("b/"):
                p = p[2:]
            path = p
            hunks = files.setdefault(path, [])
            continue
        m = HUNK_RE.match(line)
        if m:
            flush_hunk()
            cur = [int(m.group(1)), [], []]
            continue
        if cur is None:
            continue
        if not line:
            continue
        tag, body = line[0], line[1:]
        if tag == " ":
            cur[1].append(body)
            cur[2].append(body)
        elif tag == "-":
            cur[1].append(body)
        elif tag == "+":
            cur[2].append(body)
        elif tag == "\\":
            # "\ No newline at end of file" qualifies the line BEFORE it. It used
            # to be skipped, which kept that line's "\n" and made any hunk
            # touching the last line of a file without one match nothing.
            sides = {" ": (1, 2), "-": (1,), "+": (2,)}.get(last_tag, ())
            for k in sides:
                if cur[k] and cur[k][-1].endswith("\n"):
                    cur[k][-1] = cur[k][-1][:-1]
            continue
        else:
            flush_hunk()
            cur = None
            continue
        last_tag = tag
    flush_hunk()
    return {k: v for k, v in files.items() if v}


def _find(hay, needle, hint, strict=False):
    """Locate `needle` exactly.

    The hunk's own line number is authoritative when the text is actually there:
    a block that legitimately repeats (a freeing loop, a boilerplate guard) is
    common in this codebase, and position is what disambiguates it.  Matching is
    still byte-exact - position only chooses between identical candidates.

    Falls back to a whole-file search, which must then be unique.

    strict: skip the position shortcut and require the block to be unique in
    the whole file. The shortcut is exact today but not after a rebase: once
    upstream moves code, a different yet identical block can sit at the old
    line and be patched in its place without a word. DS4 Studio's edits were
    written under that stricter rule (studio_overlay.py required every anchor
    to occur exactly once), and a strict patch keeps them under it.
    """
    n = len(needle)
    if n == 0:
        return [hint] if 0 <= hint <= len(hay) else []
    if not strict and 0 <= hint <= len(hay) - n and hay[hint:hint + n] == needle:
        return [hint]
    hits = []
    for i in range(len(hay) - n + 1):
        if hay[i] == needle[0] and hay[i:i + n] == needle:
            hits.append(i)
    return hits


def apply_to_lines(lines, hunks, path, strict=False):
    """Resolve every hunk against the ORIGINAL lines, then splice once."""
    edits = []
    for old_start, old, new in hunks:
        hits = _find(lines, old, max(0, old_start - 1), strict=strict)
        if len(hits) != 1:
            head = next((l.strip() for l in old if l.strip()), "")
            raise PatchError(
                "%s: hunk at line %d matched %d time(s), expected exactly 1\n"
                "        near: %s" % (path, old_start, len(hits), head[:90]))
        s = hits[0]
        edits.append((s, s + len(old), new))

    edits.sort()
    for (s1, e1, _), (s2, _, _) in zip(edits, edits[1:]):
        if e1 > s2:
            raise PatchError("%s: overlapping hunks" % path)

    out, pos = [], 0
    for s, e, new in edits:
        out.extend(lines[pos:s])
        out.extend(new)
        pos = e
    out.extend(lines[pos:])
    return out


def apply_patch(root, patch_path, dry_run=False, strict=False):
    """Apply every file in the patch under `root`. Returns [(path, changed)]."""
    with open(patch_path, encoding="utf-8", errors="surrogateescape") as f:
        files = parse_patch(f.read())
    if not files:
        raise PatchError("%s: no hunks found" % patch_path)

    results, staged = [], []
    for rel, hunks in files.items():
        target = os.path.join(root, rel)
        if not os.path.isfile(target):
            raise PatchError("%s: target missing: %s" % (patch_path, rel))
        if os.path.islink(target):
            # Writing here would go straight through into upstream.
            raise PatchError("%s: target is a symlink, refusing to write: %s"
                             % (patch_path, rel))
        with open(target, encoding="utf-8", errors="surrogateescape") as f:
            before = f.readlines()
        after = apply_to_lines(before, hunks, rel, strict=strict)
        if after == before:
            raise PatchError("%s: applying %s changed nothing" % (rel, patch_path))
        staged.append((target, after))
        results.append((rel, True))

    if not dry_run:
        for target, after in staged:
            with open(target, "w", encoding="utf-8", errors="surrogateescape") as f:
                f.writelines(after)
    return results
