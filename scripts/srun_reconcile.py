#!/usr/bin/env python3
"""Make the config agree with whichever model is selected.

ds4-ui.config.json keeps one flat server.* block, so every model-dependent key
is really "the last model's value". Switching models left the previous one's
settings behind, and the failure was silent until the engine refused: a plain
DeepSeek V4 Flash inherited the Vision-Exp encoder and died with

    ds4: --vision requires GLM-5.3, Qwen3.8-Flash-Next or the pinned
         DeepSeek V4 Flash Vision-Exp or V4.1 Flash model

Rather than asking the user to remember which keys belong to which model, the
derived ones are recomputed from the selected model on every launch. Anything
the user deliberately changed lives in server.perModel[<file name>] and wins
over the derived value, so a hand-tuned context is not silently overwritten.

Keys NOT in DERIVED are untouched: host, port, KV cache, tool memory, env and
everything else stays exactly as configured.
"""
from __future__ import annotations

import argparse
import collections
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from srun_model_scan import (  # noqa: E402
    configured_models_dir, load_observations, recommend, scan, unsupported_reason,
)

# The keys recommend() owns. Everything else in server.* is the user's.
DERIVED = ("vision", "mtp", "ctx", "ssdStreaming", "ssdStreamingCacheExperts",
           "power", "dspark")


def reconcile(config: dict, *, quiet: bool = False) -> tuple[dict, list[str]]:
    """Return (config, messages). Never raises on a missing/odd model."""
    msgs: list[str] = []
    server = config.setdefault("server", {})
    if (server.get("attach") or {}).get("mode") == "endpoint":
        # The model runs on another server; none of DERIVED describes it.
        return config, ["attached to an endpoint; nothing to reconcile"]
    model = str(server.get("model") or "")
    if not model:
        return config, ["no server.model set; nothing to reconcile"]
    path = Path(model)
    if not path.is_file():
        return config, ["server.model does not exist: %s" % model]

    models = scan(path.parent)
    target = next((m for m in models if m.path == path), None)
    if target is None:
        return config, ["server.model is not a .gguf in its own directory: %s" % model]

    blocked = unsupported_reason(target)
    if blocked:
        return config, ["%s cannot run here: %s" % (path.name, blocked)]

    rec = recommend(target, models, observations=load_observations())
    overrides = (server.get("perModel") or {}).get(path.name) or {}

    for key in DERIVED:
        derived = rec["settings"].get("server." + key)
        if derived is None:
            continue
        value = overrides[key] if key in overrides else derived
        if server.get(key) != value:
            msgs.append("  %-26s %r -> %r%s"
                        % (key, server.get(key), value,
                           "  (override)" if key in overrides else ""))
            server[key] = value
    for w in rec["warnings"]:
        msgs.append("  ! " + w)
    if not msgs and not quiet:
        msgs.append("  already consistent with %s" % path.name)
    return config, msgs


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--config", required=True)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--quiet", action="store_true")
    a = ap.parse_args(argv)

    p = Path(a.config).expanduser()
    try:
        config = json.loads(p.read_text(), object_pairs_hook=collections.OrderedDict)
    except Exception as err:
        print("srun_reconcile: cannot read %s: %s" % (p, err), file=sys.stderr)
        return 1

    before = json.dumps(config, sort_keys=True)
    config, msgs = reconcile(config, quiet=a.quiet)
    changed = json.dumps(config, sort_keys=True) != before

    if msgs and not (a.quiet and not changed):
        server = config.get("server", {})
        if (server.get("attach") or {}).get("mode") == "endpoint":
            # server.model still names the last local model; printing it here
            # read as "reconciling with <gguf>" right before "nothing to do".
            print("srun.sh: config attached to %s"
                  % ((server.get("attach") or {}).get("name") or "an endpoint"))
        else:
            print("srun.sh: reconciling config with %s"
                  % Path(str(server.get("model", "?"))).name)
        for m in msgs:
            print(m)
    if changed and not a.dry_run:
        p.write_text(json.dumps(config, indent=2, ensure_ascii=False) + "\n")
    return 0


def demo() -> None:
    """A model switch must not leave the previous model's keys behind."""
    models_dir = configured_models_dir()
    if models_dir is None:
        print("srun_reconcile demo: skipped (no models directory: set "
              "server.modelsDir or DS4_MODELS_DIR)")
        return
    cfg = {"server": {
        "model": str(models_dir /
                     ("DeepSeek-V4-Flash-Layers37-42Q4KExperts-OtherExpertLayersIQ2XXS"
                      "GateUp-Q2KDown-AProjQ8-SExpQ8-OutQ8-chat-v2-imatrix-fixed-0731.gguf")),
        # left over from a Qwen session: the engine refuses this pairing
        "vision": str(models_dir / "DeepSeek-V4-Flash-Vision-Encoder.gguf"),
        "ssdStreaming": True, "host": "127.0.0.1", "port": 8002}}
    if not Path(cfg["server"]["model"]).is_file():
        print("srun_reconcile demo: skipped (models not present)")
        return
    out, msgs = reconcile(cfg)
    s = out["server"]
    assert s["vision"] == "", s["vision"]          # incompatible encoder dropped
    assert s["ssdStreaming"] is False              # model fits: streaming is a loss
    assert s["host"] == "127.0.0.1" and s["port"] == 8002   # untouched keys survive

    # An explicit per-model override must beat the derived value.
    cfg["server"]["perModel"] = {Path(cfg["server"]["model"]).name: {"ctx": 4096}}
    out, _ = reconcile(cfg)
    assert out["server"]["ctx"] == 4096, out["server"]["ctx"]
    print("srun_reconcile demo: OK")


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--demo":
        demo()
        raise SystemExit(0)
    raise SystemExit(main())
