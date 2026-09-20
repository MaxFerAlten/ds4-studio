#!/usr/bin/env python3
"""Scan a directory of GGUF models and recommend launch parameters.

No tkinter here on purpose: the numbers are testable without a display, and
srun_model_picker only renders what this module decides.

The budget constants are measured on this machine (Strix Halo, 121.5 GiB RAM,
124 GiB GTT), not guessed. See BUDGET_NOTES.
"""
from __future__ import annotations

import json
import os
import re
import struct
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

GIB = 1024 ** 3

COLD_START_NOTE = """\
No launch has been recorded yet on this machine, so the budget is derived from
free memory the same way the engine's own guard does (MemAvailable - CmaFree,
ds4_linux_memory.h), minus its 2 GiB OS reserve and a 6 GiB cushion for
allocator overhead the plan does not show. Being cautious costs context; being
optimistic costs a failed start, so the cushion only ever shrinks ctx.
Every launch writes an observation, and from the first one the numbers below
come from this machine instead of this comment."""

ENGINE_RESERVE_GIB = 2.0      # ds4_rocm_memory.h: the guard's own OS reserve
COLD_START_CUSHION_GIB = 6.0  # only used until the first launch is recorded
COLD_START_CTX_PER_TOKEN = 2.0e-5   # deliberately generous: high -> smaller ctx
CEILING_MARGIN_GIB = 0.5      # stay below the smallest total ever refused
PROBE_STEP_GIB = 2.0          # how far above a proven-good total we dare go

CTX_LADDER = [550000, 393216, 262144, 131072, 65536, 32768]

DEFAULT_CALIBRATION = Path.home() / ".ds4" / "launch-calibration.json"


def load_observations(path: Path | None = None) -> list[dict[str, Any]]:
    """Launch records written by frontend/server/launchCalibration.mjs."""
    target = path or Path(os.environ.get("DS4_CALIBRATION_FILE", DEFAULT_CALIBRATION))
    try:
        parsed = json.loads(target.read_text())
    except Exception:
        return []
    rows = parsed.get("observations")
    return [r for r in rows if isinstance(r, dict)] if isinstance(rows, list) else []


def available_gib() -> float:
    """MemAvailable - CmaFree: the exact quantity the engine's guard checks."""
    avail = cma = 0.0
    try:
        for line in Path("/proc/meminfo").read_text().splitlines():
            if line.startswith("MemAvailable:"):
                avail = int(re.search(r"(\d+)", line).group(1)) * 1024 / GIB
            elif line.startswith("CmaFree:"):
                cma = int(re.search(r"(\d+)", line).group(1)) * 1024 / GIB
    except Exception:
        return 0.0
    return max(0.0, avail - cma)


def host_ram_gib() -> float:
    try:
        for line in Path("/proc/meminfo").read_text().splitlines():
            if line.startswith("MemTotal:"):
                return int(re.search(r"(\d+)", line).group(1)) * 1024 / GIB
    except Exception:
        pass
    return 0.0


def ctx_cost_model(observations: list[dict[str, Any]],
                   arch: str | None = None) -> tuple[float, float, str]:
    """(fixed GiB, GiB per token, why) for KV + context buffers.

    Affine, not proportional. Qwen3.8 spends 7.37 GiB of context buffers at
    ctx 8192 and 7.74 at 32768: almost all of it is a fixed workspace sized by
    the prefill chunk, and only the KV part scales. Fitting that through the
    origin turns a 0.5 GiB/1k-token cost into 931 MiB/1k and declares that
    nothing fits. DeepSeek V4 Flash happens to have a near-zero intercept,
    which is why the proportional model looked right until a second
    architecture arrived.

    Scoped per architecture: KV size follows n_layer and the head geometry, so
    one family's numbers say nothing about another's.
    """
    usable = [o for o in observations
              if o.get("ctx") and o.get("kvGib") is not None and o.get("buffersGib") is not None]
    if arch:
        same = [o for o in usable if (o.get("arch") or "") == arch]
        if not same:
            known = sorted({o.get("arch") or "?" for o in usable})
            return (0.0, COLD_START_CTX_PER_TOKEN,
                    "no launch recorded for architecture '%s'%s; using the cautious default"
                    % (arch, " (only %s)" % ", ".join(known) if known else ""))
        usable = same
    if not usable:
        return 0.0, COLD_START_CTX_PER_TOKEN, "cold start (no launch recorded yet)"

    pts = sorted({(o["ctx"], o["kvGib"] + o["buffersGib"]) for o in usable})
    if len(pts) < 2:
        ctx, cost = pts[0]
        return 0.0, cost / ctx, "one launch only: assuming the cost is all per-token"
    (x0, y0), (x1, y1) = pts[0], pts[-1]
    slope = (y1 - y0) / (x1 - x0)
    fixed = y0 - slope * x0
    if slope < 0 or fixed < 0:            # noisy pair: fall back to proportional
        return 0.0, y1 / x1, "measurements not monotone; falling back to proportional"
    return (fixed, slope,
            "measured over %d launch(es) for '%s' on this machine (%.2f GiB fixed + %.1f MiB/1k tokens)"
            % (len(pts), arch or "any", fixed, slope * 1024 * 1000))


def ctx_slope_gib(observations: list[dict[str, Any]],
                  arch: str | None = None) -> tuple[float, str]:
    """Back-compatible view for callers that only want a per-token rate."""
    _fixed, slope, why = ctx_cost_model(observations, arch)
    return slope, why


def budget_gib(observations: list[dict[str, Any]]) -> tuple[float, str]:
    """Largest weights+ctx total believed to start, and why we believe it."""
    refused = [o["totalGib"] for o in observations
               if o.get("outcome") == "refused" and o.get("totalGib")]
    good = [o["totalGib"] for o in observations
            if o.get("outcome") == "ok" and o.get("totalGib")]
    if refused:
        # Once this machine has refused a total, stop proposing sizes it has
        # never actually run: the band between the largest success and the
        # smallest refusal is unknown, and probing it costs a failed startup.
        # Growth resumes through the no-refusal branch below as successes
        # accumulate, so this is a brake, not a permanent cap.
        if good:
            return max(good), (f"{max(good):.2f} GiB started here and "
                               f"{min(refused):.2f} GiB was refused")
        return (min(refused) - CEILING_MARGIN_GIB,
                f"{min(refused):.2f} GiB was refused here and nothing has started yet")
    if good:
        return max(good) + PROBE_STEP_GIB, (
            f"{max(good):.2f} GiB started here and nothing has been refused yet, "
            f"so we probe {PROBE_STEP_GIB:.0f} GiB above it")
    return (max(0.0, available_gib() - ENGINE_RESERVE_GIB - COLD_START_CUSHION_GIB),
            "cold start: free memory minus the engine reserve and a safety cushion")

_SCALAR = {0: "<B", 1: "<b", 2: "<H", 3: "<h", 4: "<I", 5: "<i",
           6: "<f", 7: "<?", 10: "<Q", 11: "<q", 12: "<d"}
_SIZE = {k: struct.calcsize(v) for k, v in _SCALAR.items()}

WANTED_KEYS = (
    "general.architecture", "general.name", "general.source.revision",
    "block_count", "embedding_length", "vision.sidecar_required",
    "checkpoint_variant",
)


def read_gguf_metadata(path: Path) -> dict[str, Any]:
    """Return the handful of KV entries the recommender needs.

    Arrays are skipped without being materialised: a tokenizer list would
    otherwise pull a hundred MiB of strings into memory for nothing.
    """
    out: dict[str, Any] = {}
    with open(path, "rb") as fh:
        if fh.read(4) != b"GGUF":
            raise ValueError(f"{path.name}: not a GGUF file")
        _version, _n_tensors, n_kv = struct.unpack("<IQQ", fh.read(20))

        def rd(fmt: str) -> Any:
            return struct.unpack(fmt, fh.read(struct.calcsize(fmt)))[0]

        def rstr() -> str:
            return fh.read(rd("<Q")).decode("utf-8", "replace")

        def skip(t: int) -> None:
            if t == 8:
                fh.seek(rd("<Q"), 1)
            elif t == 9:
                et, n = rd("<I"), rd("<Q")
                if et == 8:
                    for _ in range(n):
                        fh.seek(rd("<Q"), 1)
                elif et == 9:
                    for _ in range(n):
                        skip(9)
                else:
                    fh.seek(_SIZE[et] * n, 1)
            else:
                fh.seek(_SIZE[t], 1)

        def value(t: int) -> Any:
            if t == 8:
                return rstr()
            if t == 9:
                skip(9)
                return None
            return rd(_SCALAR[t])

        for _ in range(n_kv):
            key = rstr()
            typ = rd("<I")
            if any(w in key for w in WANTED_KEYS):
                out[key] = value(typ)
            else:
                skip(typ)
    return out


@dataclass
class Model:
    path: Path
    bytes: int
    arch: str
    name: str
    kind: str                      # target | vision-encoder | dspark | mtp | unknown
    needs_vision: bool = False
    meta: dict[str, Any] = field(default_factory=dict)

    @property
    def gib(self) -> float:
        return self.bytes / GIB

    @property
    def label(self) -> str:
        return self.path.name


def classify(path: Path, meta: dict[str, Any]) -> tuple[str, bool]:
    arch = str(meta.get("general.architecture", "") or "")
    name = str(meta.get("general.name", "") or "")
    needs_vision = bool(meta.get("deepseek4.vision.sidecar_required")
                        or meta.get("vision.sidecar_required"))
    # llama.cpp ships Qwen3-VL projectors as architecture "clip" with an
    # mmproj- filename. Without this they look like ordinary targets and the
    # picker happily offers to launch a 0.57 GiB "model".
    if arch == "clip" or path.name.lower().startswith("mmproj-"):
        return "vision-encoder", False
    if "vision" in arch and "encoder" in name.lower():
        return "vision-encoder", False
    if arch.endswith("-vision"):
        return "vision-encoder", False
    if "dspark" in arch or "dspark" in name.lower():
        return "dspark", False
    if "mtp" in path.name.lower():
        return "mtp", False
    return "target", needs_vision


def configured_models_dir() -> Path | None:
    """The models directory the user configured, never a built-in path.

    DS4_MODELS_DIR wins; otherwise server.modelsDir of the UI config, found the
    way the frontend and srun.sh find it (DS4_UI_CONFIG, else
    frontend/ds4-ui.config.json). None when neither is set."""
    env = os.environ.get("DS4_MODELS_DIR", "").strip()
    if env:
        return Path(env).expanduser()
    cfg = os.environ.get("DS4_UI_CONFIG") or str(
        Path(__file__).resolve().parent.parent / "frontend" / "ds4-ui.config.json")
    try:
        d = json.loads(Path(cfg).expanduser().read_text())
    except (OSError, ValueError):
        return None
    value = str((d.get("server") or {}).get("modelsDir") or "").strip()
    return Path(value).expanduser() if value else None


def scan(models_dir: Path) -> list[Model]:
    out: list[Model] = []
    for path in sorted(models_dir.glob("*.gguf")):
        try:
            meta = read_gguf_metadata(path)
        except Exception as err:                      # unreadable file is data, not a crash
            out.append(Model(path, path.stat().st_size, "", f"<unreadable: {err}>", "unknown"))
            continue
        kind, needs_vision = classify(path, meta)
        out.append(Model(
            path=path,
            bytes=path.stat().st_size,
            arch=str(meta.get("general.architecture", "") or ""),
            name=str(meta.get("general.name", "") or path.stem),
            kind=kind,
            needs_vision=needs_vision,
            meta=meta,
        ))
    return out


def host_ram_gib() -> float:
    try:
        for line in Path("/proc/meminfo").read_text().splitlines():
            if line.startswith("MemTotal:"):
                return int(re.search(r"(\d+)", line).group(1)) * 1024 / GIB
    except Exception:
        pass
    return 0.0


# Architectures the engine refuses outright on this backend. Sizing a model it
# will not run is worse than saying nothing: the numbers look authoritative and
# the launch dies minutes later, after the whole file has been read off disk.
#
# Keyed by general.architecture, checked against a ROCm/CUDA (non-Metal) build.
UNSUPPORTED_ARCH: dict[str, str] = {
    # Emptied 2026-09-16: qwen4exp used to live here. The overlay feature
    # rocm-qwen4-enable makes it run, verified by generating 200 greedy tokens
    # of correct prose at 20.00 t/s, so keeping the refusal would have been the
    # stale entry lying to the next person.
}

# Constraints the engine enforces per architecture. Proposing a setting the
# engine rejects wastes a full model load before the refusal, so they are
# encoded rather than discovered at launch.
ARCH_CONSTRAINTS: dict[str, dict[str, Any]] = {
    "qwen4exp": {
        # ds4.c: SSD streaming, DSpark, external MTP and any power below 100
        # are all refused for this family alongside multi-GPU.
        "streaming": False,
        "dspark": False,
        "max_ctx": 262144,      # rope_orig_ctx; beyond it needs YaRN
        "note": ("Qwen3.8 refuses SSD streaming, DSpark, external MTP and "
                 "--power below 100. Its BF16 n-grams are read from disk, so "
                 "the resident footprint is far below the file size."),
    },
}


def vision_pair_ok(target: "Model", encoder: "Model") -> bool:
    """Whether this encoder actually belongs to this target.

    Name proximity is not evidence. DeepSeek-V4-Flash-Vision-Encoder.gguf shares
    a prefix with DeepSeek-V4.1-Flash-Q2.gguf and is the wrong sidecar for it;
    handing them to the engine together dies with

        ds4: DeepSeek vision sidecar does not match the language checkpoint

    only after the 340 GiB language model has been read off disk.

    ds4.c:7344 pins one revision per checkpoint and checks the encoder's
    general.source.revision against it. Those hashes are not copied here --
    they change whenever upstream repins -- because both files carry the field:
    the V4.1 target reports df42c109..., its encoder must report the same, and
    the Vision-Exp pair agree on e46e16bf... Comparing the two directly gives
    the engine's answer without hardcoding either value.

    CLIP/mmproj projectors (Qwen3-VL) carry no revision to compare, so those
    keep the filename heuristic.
    """
    # Family first: a CLIP projector belongs to Qwen3-VL and a deepseek4-vision
    # encoder to DeepSeek. Filtering only on revision let the V4.1 target fall
    # through to the Qwen mmproj once its own encoder was correctly rejected,
    # which is a worse pairing than the one being fixed.
    if encoder.arch == "clip":
        return target.arch == "qwen4exp"
    if encoder.arch != "deepseek4-vision":
        return True                       # unknown projector kind: stay out of it
    if not target.arch.startswith("deepseek4"):
        return False
    tgt = target.meta.get("general.source.revision")
    enc = encoder.meta.get("general.source.revision")
    if not tgt or not enc:
        return True                       # cannot tell: do not invent a refusal
    return str(tgt) == str(enc)


def vision_capable(target: "Model") -> bool:
    """Whether the engine will accept --vision for this target.

    Mirrors ds4.c:70355 exactly:

        if (!ds4_model_is_glm53() && !g_ds4_flash_vision_exp &&
            !ds4_model_is_qwen4() && DS4_MODEL_FAMILY != DS4_MODEL_FAMILY_DEEPSEEK41)
                -> "--vision requires GLM-5.3, Qwen3.8-Flash-Next or the pinned
                    DeepSeek V4 Flash Vision-Exp or V4.1 Flash model"

    A projector sitting in the same directory is not evidence the target can use
    it: plain DeepSeek V4 Flash ships next to the Vision-Exp encoder and refuses
    it, which is how attaching one by proximity broke a working configuration.
    g_ds4_flash_vision_exp is exactly the sidecar_required flag this scanner
    already reads, so the four cases map cleanly onto metadata.
    """
    arch = target.arch
    return (target.needs_vision                 # Vision-Exp: pinned, requires it
            or arch == "qwen4exp"               # Qwen3.8-Flash-Next
            or arch == "deepseek41"             # V4.1 Flash
            or arch.startswith("glm53"))        # GLM-5.3


def arch_constraints(target: "Model") -> dict[str, Any]:
    return ARCH_CONSTRAINTS.get(target.arch, {})


def resident_gib(target: "Model", observations: list[dict[str, Any]]) -> tuple[float, str]:
    """What actually has to stay in memory, which is not always the file size.

    Qwen3.8 keeps 95 of its 165 GiB of BF16 n-grams on disk (ds4.c sets
    m->size = ngram_tensor->abs_offset and reads rows with pread), so sizing it
    from the file recommends streaming for a model that refuses to stream.
    A recorded launch reports the real number; until then the file size is the
    only honest upper bound, and it errs toward a smaller ctx.
    """
    for o in reversed(observations or []):
        if (o.get("arch") or "") == target.arch and o.get("modelGib"):
            m = float(o["modelGib"])
            if m <= target.gib + 0.5:
                return m, "measured on this machine (%.2f GiB of %.2f on disk stays resident)" % (
                    m, target.gib)
    return target.gib, "file size; no launch of this architecture recorded yet"


def unsupported_reason(target: "Model") -> str | None:
    """Why this machine cannot serve this architecture, or None if it can."""
    return UNSUPPORTED_ARCH.get(target.arch)


MIN_EXPERT_CACHE_GIB = 8.0
NON_EXPERT_SHARE = 0.15   # over-estimate until a launch reports "resident model"


def non_expert_gib(target: "Model", observations: list[dict[str, Any]] | None = None) -> float:
    """How much of a streamed model still has to stay resident.

    When streaming, the engine prints "resident model X GiB" for exactly this
    part, so one launch of this architecture replaces the estimate with the
    measurement. Until then, assume a generous share: under-estimating it
    oversizes the expert cache, and an oversized cache does not start.
    """
    for o in reversed(observations or []):
        if (o.get("arch") or "") == target.arch and o.get("streaming") and o.get("modelGib"):
            return float(o["modelGib"])
    return target.gib * NON_EXPERT_SHARE


def ctx_cost_gib(ctx: int, slope: float | None = None) -> float:
    if slope is None:
        slope, _ = ctx_slope_gib(load_observations())
    return ctx * slope


def largest_ctx_that_fits(weights_gib: float, budget: float, slope: float,
                          ladder: list[int] | None = None,
                          fixed: float = 0.0) -> int | None:
    for ctx in (ladder or CTX_LADDER):
        if weights_gib + fixed + ctx * slope <= budget:
            return ctx
    return None


def find_sidecars(target: Model, models: list[Model]) -> dict[str, Model | None]:
    """Pick the encoder / DSpark support that belong to this target.

    Matched on the longest shared filename prefix so a Vision-Exp target takes
    the Vision DSpark support rather than the plain one.
    """
    def best(kind: str) -> Model | None:
        cands = [m for m in models if m.kind == kind]
        if kind == "vision-encoder":
            cands = [m for m in cands if vision_pair_ok(target, m)]
        if not cands:
            return None
        def shared(m: Model) -> int:
            a = target.path.stem
            # "mmproj-Qwen3.8-Flash-Next-Q8_0" shares nothing with
            # "Qwen3.8-Flash-Next-Q4" until the prefix comes off.
            b = m.path.stem
            for prefix in ("mmproj-", "mmproj."):
                if b.lower().startswith(prefix):
                    b = b[len(prefix):]
                    break
            n = 0
            while n < min(len(a), len(b)) and a[n] == b[n]:
                n += 1
            return n
        return max(cands, key=shared)
    return {"vision": best("vision-encoder"), "dspark": best("dspark")}


def recommend(target: Model, models: list[Model],
              observations: list[dict[str, Any]] | None = None,
              want_dspark: bool = False,
              want_vision: bool | None = None) -> dict[str, Any]:
    """Recommended launch settings plus the reasoning behind each one.

    Both the budget and the per-token context cost come from launches this
    machine has actually performed. Until one is recorded they fall back to a
    deliberately pessimistic estimate, because an over-estimate only shrinks
    ctx while an under-estimate produces a backend that refuses to start.
    """
    obs = load_observations() if observations is None else observations
    blocked = unsupported_reason(target)
    budget, budget_why = budget_gib(obs)
    fixed, slope, slope_why = ctx_cost_model(obs, target.arch)
    sidecars = find_sidecars(target, models)
    notes: list[str] = []
    warnings: list[str] = []

    limits = arch_constraints(target)
    weights, weights_why = resident_gib(target, obs)
    notes.append("resident weights %.2f GiB - %s" % (weights, weights_why))
    if limits.get("note"):
        notes.append(limits["note"])
    vision_path = ""
    # A DeepSeek Vision-Exp target refuses to load without its encoder, so it is
    # attached automatically. A Qwen3-VL target takes an mmproj projector but
    # runs fine text-only, so that one is opt-in: want_vision None means "only
    # if the target demands it".
    # A projector next to the target is there to be used: attach it unless the
    # caller says otherwise. Qwen3-VL runs fine text-only, but a user who put
    # the mmproj in the directory wants the vision path.
    can_vision = vision_capable(target)
    use_vision = (target.needs_vision or
                  (can_vision and sidecars["vision"] is not None)) \
        if want_vision is None else want_vision
    if use_vision and not can_vision:
        warnings.append(
            "%s does not accept --vision (ds4.c:70355 allows it only for GLM-5.3, "
            "Qwen3.8-Flash-Next, the pinned Vision-Exp build and V4.1 Flash); "
            "leaving the encoder out so the engine can start."
            % target.label)
        use_vision = False
    if use_vision:
        enc = sidecars["vision"]
        if enc is None:
            warnings.append(
                f"no vision encoder / mmproj GGUF found next to {target.label}"
                + (": this target declares vision.sidecar_required and will refuse to load."
                   if target.needs_vision else "; launching text-only."))
        else:
            vision_path = str(enc.path)
            weights += enc.gib
            why = "required by this target" if target.needs_vision else "requested"
            notes.append(f"vision encoder {enc.label} (+{enc.gib:.2f} GiB), {why}")

    mtp_path = ""
    dspark = sidecars["dspark"]
    if want_dspark:
        if dspark is None:
            warnings.append("DSpark requested but no support GGUF found in the directory.")
        else:
            mtp_path = str(dspark.path)
            weights += dspark.gib
            notes.append(f"DSpark support {dspark.label} (+{dspark.gib:.2f} GiB); "
                         f"measured +4.8% decode, and it costs context")

    ladder = CTX_LADDER
    if limits.get("max_ctx"):
        ladder = [c for c in CTX_LADDER if c <= limits["max_ctx"]] or [CTX_LADDER[-1]]
        if CTX_LADDER[0] > limits["max_ctx"]:
            notes.append("ctx capped at %d: beyond it this architecture needs YaRN scaling"
                         % limits["max_ctx"])
    ctx = largest_ctx_that_fits(weights, budget, slope, ladder, fixed)
    streaming = False
    cache = ""
    if ctx is None and limits.get("streaming") is False:
        ctx = ladder[-1]
        warnings.append(
            "%s does not fit at any context this architecture allows, and it "
            "refuses SSD streaming, so there is no configuration that works "
            "here. Proposing the smallest context so the refusal is visible "
            "rather than silently replaced by a setting the engine rejects."
            % target.label)
    elif ctx is None:
        # Streaming does not make the budget go away: the non-expert weights,
        # the KV/context buffers and the expert cache all still have to fit.
        # Getting the cache wrong is a failed startup, not a slow one, so the
        # non-expert share is over-estimated until a launch measures it.
        streaming = True
        non_expert = non_expert_gib(target, observations=obs)
        ctx = largest_ctx_that_fits(non_expert + MIN_EXPERT_CACHE_GIB, budget, slope, None, fixed)
        if ctx is None:
            ctx = CTX_LADDER[-1]
            warnings.append(
                f"even the smallest context leaves less than "
                f"{MIN_EXPERT_CACHE_GIB:.0f} GiB for the expert cache; "
                f"this model may not start on this machine.")
        cache_gib = budget - non_expert - ctx * slope
        cache_gib = max(MIN_EXPERT_CACHE_GIB, cache_gib)
        cache = f"{int(cache_gib)}GB"
        notes.append(f"weights are {weights:.2f} GiB against a {budget:.2f} GiB budget: "
                     f"they cannot stay resident, so experts stream from SSD")
        notes.append(f"expert cache {cache} = budget {budget:.2f} - "
                     f"non-expert weights {non_expert:.2f} - ctx {ctx * slope:.2f}")
    else:
        notes.append(f"weights {weights:.2f} GiB + ctx {ctx} "
                     f"({fixed + ctx * slope:.2f} GiB) fits the {budget:.2f} GiB budget, "
                     f"so experts stay resident (streaming a resident model measured "
                     f"9.12 t/s against 15.32 t/s)")
        if ctx != CTX_LADDER[0]:
            notes.append(f"ctx reduced from {CTX_LADDER[0]} to {ctx} to make room")

    if blocked:
        warnings.insert(0, "THIS MACHINE CANNOT RUN THIS MODEL. " + blocked)
    notes.append(f"budget {budget:.2f} GiB - {budget_why}")
    notes.append(f"context cost - {slope_why}")

    return {
        "settings": {
            "server.model": str(target.path),
            "server.vision": vision_path,
            "server.mtp": mtp_path,
            "server.ctx": ctx,
            "server.ssdStreaming": streaming and limits.get("streaming", True),
            "server.ssdStreamingCacheExperts": cache,
            "server.power": 100,
            "server.dspark": bool(want_dspark and mtp_path),
        },
        "notes": notes,
        "warnings": warnings,
        "budget_gib": budget,
        "weights_gib": weights,
        "blocked": blocked,
        "budget_why": budget_why,
        "slope_why": slope_why,
        "ctx_slope": slope,
        "observations": len(obs),
    }


def demo() -> None:
    """Self-check against the launches actually measured in this repo.

    The three rows below are real: they are what the engine printed on
    2026-09-15 for the vision target (started), the DSpark pairing at ctx
    550000 (refused) and the same pairing at 262144 (started).
    """
    ok_vision = {"arch": "deepseek4", "ctx": 550000, "kvGib": 7.15, "buffersGib": 1.05,
                 "totalGib": 99.96, "outcome": "ok"}
    refused_dspark = {"arch": "deepseek4", "ctx": 550000, "kvGib": 7.15, "buffersGib": 1.05,
                      "totalGib": 104.67, "outcome": "refused"}
    ok_dspark = {"arch": "deepseek4", "ctx": 262144, "kvGib": 3.46, "buffersGib": 0.50,
                 "totalGib": 100.42, "outcome": "ok"}

    # 1. With no history the estimate must be pessimistic, never optimistic.
    cold_fixed, cold_slope, why = ctx_cost_model([])
    assert cold_fixed == 0.0 and cold_slope >= 1.51e-5, (cold_fixed, cold_slope)
    assert "cold start" in why

    # 2. One launch cannot separate fixed cost from per-token cost, and must
    #    say so rather than implying a measurement it did not make.
    _f, slope, why = ctx_cost_model([ok_vision], "deepseek4")
    assert abs(slope - (7.15 + 1.05) / 550000) < 1e-9, slope
    assert "one launch only" in why

    # 2b. Two launches recover the affine shape. Qwen3.8 is the case that broke
    #     the proportional model: 7.37 GiB of context buffers at ctx 8192 and
    #     7.74 at 32768 is almost all fixed workspace, and fitting it through
    #     the origin reported 931 MiB per 1000 tokens and "nothing fits".
    qwen = [{"ctx": 8192, "kvGib": 0.26, "buffersGib": 7.37, "arch": "qwen4exp",
             "totalGib": 77.36, "outcome": "ok"},
            {"ctx": 32768, "kvGib": 1.04, "buffersGib": 7.74, "arch": "qwen4exp",
             "totalGib": 78.51, "outcome": "ok"}]
    qf, qs, why = ctx_cost_model(qwen, "qwen4exp")
    assert 7.0 < qf < 7.5, qf                       # the fixed workspace
    assert qs * 1024 * 1000 < 60, qs * 1024 * 1000  # MiB per 1k tokens, not 931
    assert "fixed" in why
    # and with it, a 70 GiB resident model DOES fit at a large context
    assert largest_ctx_that_fits(70.30, 100.43, qs, [262144, 131072], qf) == 262144

    # 2c. One architecture's numbers must never be borrowed for another.
    _f, borrowed, why = ctx_cost_model(qwen, "deepseek4")
    assert borrowed == COLD_START_CTX_PER_TOKEN, borrowed
    assert "no launch recorded" in why

    # 3. A refusal is a hard ceiling: nothing at or above it is proposed again.
    budget, why = budget_gib([ok_vision, refused_dspark, ok_dspark])
    assert budget < refused_dspark["totalGib"], (budget, why)
    assert budget >= ok_dspark["totalGib"], (budget, why)

    # 4. With only successes we may probe upward, but only a little.
    probe, _ = budget_gib([ok_vision])
    assert ok_vision["totalGib"] < probe <= ok_vision["totalGib"] + PROBE_STEP_GIB

    # 5. The ladder reproduces what the machine actually did: the vision pair
    #    at full context, the DSpark pair only after stepping ctx down.
    obs = [ok_vision, refused_dspark, ok_dspark]
    budget, _ = budget_gib(obs)
    slope, _ = ctx_slope_gib(obs)
    assert largest_ctx_that_fits(91.76, budget, slope) == 550000
    assert largest_ctx_that_fits(96.46, budget, slope) == 262144
    # A 340 GiB model fits no context at all and must fall back to streaming.
    assert largest_ctx_that_fits(340.6, budget, slope) is None

    # 6. A cold start must still refuse the pairing that this machine refused.
    cold_budget, _ = budget_gib([])
    if cold_budget > 0:                               # 0 when /proc is unreadable
        assert 96.46 + 550000 * cold_slope > cold_budget

    print("srun_model_scan demo: OK "
          f"(learned budget {budget:.2f} GiB, slope {slope * 1e6:.1f} MiB/1k tokens)")

def main(argv: list[str]) -> int:
    if len(argv) > 1 and argv[1] == "--demo":
        demo()
        return 0
    if len(argv) < 2:
        print(f"usage: {Path(argv[0]).name} <models-dir> [--json] [--dspark]", file=sys.stderr)
        return 2
    models_dir = Path(argv[1]).expanduser()
    if not models_dir.is_dir():
        print(f"not a directory: {models_dir}", file=sys.stderr)
        return 2
    models = scan(models_dir)
    if "--json" in argv:
        print(json.dumps([{
            "path": str(m.path), "gib": round(m.gib, 2), "kind": m.kind,
            "arch": m.arch, "name": m.name, "needs_vision": m.needs_vision,
        } for m in models], indent=2))
        return 0
    want_dspark = "--dspark" in argv
    obs = load_observations()
    budget, budget_why = budget_gib(obs)
    print(f"{models_dir}\n  {host_ram_gib():.1f} GiB RAM, "
          f"{available_gib():.1f} GiB available now\n"
          f"  budget {budget:.2f} GiB - {budget_why}\n"
          f"  {len(obs)} launch(es) recorded\n")
    for m in models:
        print(f"  [{m.kind:<14}] {m.gib:7.2f} GiB  {m.label}")
    print()
    for m in models:
        if m.kind != "target":
            continue
        rec = recommend(m, models, observations=obs, want_dspark=want_dspark,
                        want_vision=True if "--vision" in argv else None)
        print(f"== {m.label}")
        if rec["blocked"]:
            # Printing sizing for a model the engine refuses reads as advice.
            print(f"     ! {rec['blocked']}")
            print()
            continue
        for k, v in rec["settings"].items():
            if v not in ("", False):
                print(f"     {k:34} {v}")
        for n in rec["notes"]:
            print(f"     · {n}")
        for w in rec["warnings"]:
            print(f"     ! {w}")
        print()
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
