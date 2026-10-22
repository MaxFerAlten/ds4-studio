# Part of DS4-Studio DeepInfer integration (plan §9: MoE expert hotness, telemetry only).
"""Offline statistics over DS4 expert-routing histograms.

Two producers exist in ds4.c, both Metal-only (`ds4.c:72002`):
- hotlist v1 text (`DS4_EXPERT_HOTLIST=FILE`, writer `ds4.c:1841-1903`): the full
  per-(layer, expert) histogram, one `layer expert hits weight` row each;
- expert locality profile JSON (`--expert-profile FILE` / `DS4_EXPERT_PROFILE`,
  writer `ds4.c:1906-1960`, per layer `ds4.c:1765-1839`): only the top 16 experts
  per layer, so distribution statistics are computed from hotlists only.
Numeric content only; the model name header is the only string kept.
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass

HOTLIST_MAGIC = "# ds4 expert hotlist v1"
_HEADER_KEYS = ("model", "layers", "experts", "layer_records", "selections")
MAX_LAYERS, MAX_EXPERTS = 1024, 4096


@dataclass(frozen=True)
class Hotlist:
    model: str
    layers: int
    experts: int
    layer_records: int
    selections: int
    hits: dict[int, list[int]]        # layer -> hits per expert id
    weights: dict[int, list[float]]   # layer -> router weight sum per expert id


@dataclass(frozen=True)
class LayerHeat:
    layer: int
    selections: int
    active_experts: int
    top_share: float          # fraction of selections in the top-N experts
    gini: float
    entropy_bits: float
    experts_for_50: int
    experts_for_90: int
    experts_for_99: int


def parse_hotlist(text: str) -> Hotlist:
    lines = text.splitlines()
    if not lines or lines[0] != HOTLIST_MAGIC:
        raise ValueError("not a ds4 expert hotlist v1")
    header: dict[str, str] = {}
    i = 1
    while i < len(lines) and lines[i].startswith("# "):
        body = lines[i][2:]
        if body == "columns: layer expert hits weight":
            i += 1
            break
        key, _, value = body.partition(" ")
        if key not in _HEADER_KEYS or key in header or not value:
            raise ValueError(f"line {i + 1}: unexpected header {body!r}")
        header[key] = value
        i += 1
    else:
        raise ValueError("missing columns header")
    if set(header) != set(_HEADER_KEYS):
        raise ValueError(f"missing header keys: {sorted(set(_HEADER_KEYS) - set(header))}")
    try:
        layers, experts = int(header["layers"]), int(header["experts"])
        records, selections = int(header["layer_records"]), int(header["selections"])
    except ValueError:
        raise ValueError("non-integer hotlist header") from None
    if not (0 < layers <= MAX_LAYERS and 0 < experts <= MAX_EXPERTS) or records < 0 or selections < 0:
        raise ValueError("hotlist header out of range")

    hits = {il: [0] * experts for il in range(layers)}
    weights = {il: [0.0] * experts for il in range(layers)}
    seen = set()
    for line_no, line in enumerate(lines[i:], start=i + 1):
        parts = line.split(" ")
        if len(parts) != 4:
            raise ValueError(f"line {line_no}: expected 4 columns")
        try:
            il, e, h, w = int(parts[0]), int(parts[1]), int(parts[2]), float(parts[3])
        except ValueError:
            raise ValueError(f"line {line_no}: non-numeric row") from None
        if not (0 <= il < layers and 0 <= e < experts) or h < 0 or not math.isfinite(w) or w < 0:
            raise ValueError(f"line {line_no}: value out of range")
        if (il, e) in seen:
            raise ValueError(f"line {line_no}: duplicate layer/expert")
        seen.add((il, e))
        hits[il][e], weights[il][e] = h, w
    if len(seen) != layers * experts:
        raise ValueError(f"expected {layers * experts} rows, got {len(seen)}")
    if sum(sum(v) for v in hits.values()) != selections:
        raise ValueError("row hits do not sum to the selections header")
    return Hotlist(header["model"], layers, experts, records, selections, hits, weights)


def _gini(values: list[int]) -> float:
    s = sorted(values)
    n, total = len(s), sum(s)
    if n == 0 or total == 0:
        return 0.0
    return sum((2 * (k + 1) - n - 1) * v for k, v in enumerate(s)) / (n * total)


def _coverage(sorted_desc: list[int], total: int, q: float) -> int:
    acc = 0
    for k, v in enumerate(sorted_desc, start=1):
        acc += v
        if acc >= q * total:
            return k
    return len(sorted_desc)


def layer_heat(hits: list[int], layer: int, top_n: int = 16) -> LayerHeat:
    total = sum(hits)
    desc = sorted(hits, reverse=True)
    entropy = -sum((h / total) * math.log2(h / total) for h in hits if h) if total else 0.0
    return LayerHeat(
        layer=layer, selections=total, active_experts=sum(1 for h in hits if h),
        top_share=sum(desc[:top_n]) / total if total else 0.0, gini=_gini(hits),
        entropy_bits=entropy,
        experts_for_50=_coverage(desc, total, 0.50) if total else 0,
        experts_for_90=_coverage(desc, total, 0.90) if total else 0,
        experts_for_99=_coverage(desc, total, 0.99) if total else 0,
    )


def _ranks(values: list[int]) -> list[float]:
    order = sorted(range(len(values)), key=lambda k: values[k])
    ranks = [0.0] * len(values)
    k = 0
    while k < len(order):
        j = k
        while j + 1 < len(order) and values[order[j + 1]] == values[order[k]]:
            j += 1
        for t in range(k, j + 1):
            ranks[order[t]] = (k + j) / 2.0
        k = j + 1
    return ranks


def spearman(a: list[int], b: list[int]) -> float | None:
    if len(a) != len(b) or len(a) < 2:
        raise ValueError("spearman needs equal-length vectors of length >= 2")
    ra, rb = _ranks(a), _ranks(b)
    ma, mb = sum(ra) / len(ra), sum(rb) / len(rb)
    cov = sum((x - ma) * (y - mb) for x, y in zip(ra, rb))
    va = math.sqrt(sum((x - ma) ** 2 for x in ra))
    vb = math.sqrt(sum((y - mb) ** 2 for y in rb))
    return cov / (va * vb) if va and vb else None


def top_set(hits: list[int], n: int) -> set[int]:
    ranked = sorted(range(len(hits)), key=lambda e: (-hits[e], e))
    return {e for e in ranked[:n] if hits[e]}


def summarize(h: Hotlist, top_n: int = 16) -> dict:
    return {
        "model": h.model, "layers": h.layers, "experts": h.experts,
        "layer_records": h.layer_records, "selections": h.selections,
        "per_layer": [layer_heat(h.hits[il], il, top_n).__dict__ for il in range(h.layers)],
    }


def compare(a: Hotlist, b: Hotlist, top_n: int = 16) -> list[dict]:
    if (a.layers, a.experts) != (b.layers, b.experts):
        raise ValueError("hotlists have different shapes")
    out = []
    for il in range(a.layers):
        sa, sb = top_set(a.hits[il], top_n), top_set(b.hits[il], top_n)
        union = sa | sb
        out.append({"layer": il, "top_jaccard": len(sa & sb) / len(union) if union else None,
                    "spearman": spearman(a.hits[il], b.hits[il])})
    return out


def parse_profile_json(text: str) -> dict:
    """Validate the locality profile and return its numeric summary (top-16 only)."""
    obj = json.loads(text)
    if not isinstance(obj, dict) or obj.get("source") != "ds4 Metal expert locality profile":
        raise ValueError("not a ds4 expert locality profile")
    for k in ("layers", "experts", "expert_used", "layer_records", "selections"):
        if not isinstance(obj.get(k), int) or obj[k] < 0:
            raise ValueError(f"profile field {k} must be a non-negative integer")
    detail = obj.get("layers_detail")
    if not isinstance(detail, list) or len(detail) != obj["layers"]:
        raise ValueError("layers_detail length mismatch")
    return {
        "layers": obj["layers"], "experts": obj["experts"], "expert_used": obj["expert_used"],
        "selections": obj["selections"], "cache_summary": obj.get("cache_summary", []),
        "per_layer": [{"layer": d["layer"], "unique_experts": d["unique_experts"],
                       "avg_adjacent_jaccard": d["avg_adjacent_jaccard"],
                       "top16_pct": sum(t["pct"] for t in d["top_experts"])} for d in detail],
    }
