"""overlay_manifest.py - loading and validating feature.toml files.

Shared by compose_shadow.py, verify_anchors.py, retire_feature.py and
overlayctl.py so there is exactly one interpretation of a manifest.
"""
import os
import tomllib


class ManifestError(Exception):
    pass


class Feature:
    def __init__(self, path, data):
        self.path = path
        self.dir = os.path.dirname(path)
        self.id = data.get("id")
        if not self.id:
            raise ManifestError("%s: missing id" % path)
        self.enabled = bool(data.get("enabled", True))
        self.owner = data.get("owner", "overlay")
        self.description = data.get("description", "")
        self.upstream = data.get("upstream", {})
        self.anchors = data.get("anchors", [])
        self.shadow_patch = data.get("shadow_patch", [])
        self.overlay_file = data.get("overlay_file", [])
        self.tests = data.get("test", [])
        self.retire_probes = data.get("retire_probe", [])
        self.retire_tests = data.get("retire_test", [])
        self._validate()

    def _validate(self):
        for a in self.anchors:
            for k in ("file", "kind", "text"):
                if k not in a:
                    raise ManifestError("%s: anchor missing '%s'" % (self.path, k))
            if a["kind"] != "exact":
                raise ManifestError(
                    "%s: anchor kind %r unsupported; only 'exact' exists, because a "
                    "fuzzy anchor is exactly what this design forbids"
                    % (self.path, a["kind"]))
            a.setdefault("count", 1)
        for p in self.shadow_patch:
            for k in ("file", "patch"):
                if k not in p:
                    raise ManifestError("%s: shadow_patch missing '%s'" % (self.path, k))
            # A real TOML boolean: compose reads it with bool(), so the string
            # "false" would switch strict matching ON while saying the opposite.
            if "from" in p and (not isinstance(p["from"], str) or p["from"] == p["file"]):
                raise ManifestError("%s: shadow_patch 'from' must name a different upstream file"
                                    % self.path)
            if "strict" in p and not isinstance(p["strict"], bool):
                raise ManifestError("%s: shadow_patch 'strict' must be true or false, got %r"
                                    % (self.path, p["strict"]))
        for o in self.overlay_file:
            for k in ("source", "target"):
                if k not in o:
                    raise ManifestError("%s: overlay_file missing '%s'" % (self.path, k))

    def patch_targets(self):
        return {p["file"] for p in self.shadow_patch}

    def __repr__(self):
        return "<Feature %s %s>" % (self.id, "on" if self.enabled else "off")


def build_root(overlay_root):
    """Where shadow trees go: overlay.toml [paths] build, relative to the overlay.

    It must lie outside upstream, or compose refuses; with the overlay embedded
    in upstream that means outside the overlay as well."""
    try:
        with open(os.path.join(overlay_root, "overlay.toml"), "rb") as fh:
            rel = tomllib.load(fh).get("paths", {}).get("build", ".build")
    except FileNotFoundError:
        rel = ".build"
    return os.path.normpath(os.path.join(overlay_root, rel))


def load_features(overlay_root, only=None):
    root = os.path.join(overlay_root, "features")
    feats = []
    if not os.path.isdir(root):
        return feats
    for name in sorted(os.listdir(root)):
        f = os.path.join(root, name, "feature.toml")
        if not os.path.isfile(f):
            continue
        with open(f, "rb") as fh:
            feats.append(Feature(f, tomllib.load(fh)))
    ids = [x.id for x in feats]
    dup = {i for i in ids if ids.count(i) > 1}
    if dup:
        raise ManifestError("duplicate feature ids: %s" % ", ".join(sorted(dup)))
    if only:
        feats = [x for x in feats if x.id in set(only)]
    return feats


def enabled_features(overlay_root, only=None):
    return [f for f in load_features(overlay_root, only) if f.enabled]


def ordered_patches(features):
    """Patches in a deterministic order: feature id, then declaration order.

    Two features touching the same hunk is a design error (plan section 24),
    not something to resolve by ordering luck - compose refuses it separately.
    """
    out = []
    for f in sorted(features, key=lambda x: x.id):
        for p in f.shadow_patch:
            out.append((f, p))
    return out
