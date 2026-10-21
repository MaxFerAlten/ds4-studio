# Part of DS4-Studio DeepInfer integration (plan §2.4, §3, §10).
"""Strict parser and aggregator for `ds4-bench --csv` output (ds4_bench.c:782)."""

from __future__ import annotations

import csv
import math
from dataclasses import dataclass

EXPECTED_HEADER = (
    "ctx_tokens", "prefill_tokens", "prefill_tps", "gen_tokens", "gen_tps",
    "gen_first_ms", "gen_steady_tokens", "gen_steady_tps", "kvcache_bytes",
)
_INT_FIELDS = {"ctx_tokens", "prefill_tokens", "gen_tokens", "gen_steady_tokens", "kvcache_bytes"}


@dataclass(frozen=True)
class BenchRow:
    ctx_tokens: int
    prefill_tokens: int
    prefill_tps: float
    gen_tokens: int
    gen_tps: float
    gen_first_ms: float
    gen_steady_tokens: int
    gen_steady_tps: float
    kvcache_bytes: int


@dataclass(frozen=True)
class CtxStats:
    ctx_tokens: int
    n: int
    gen_tps_median: float
    gen_first_ms_median: float
    gen_first_ms_p95: float
    ms_per_token_p50: float
    ms_per_token_p95: float


def parse_csv(path: str) -> list[BenchRow]:
    with open(path, newline="", encoding="utf-8") as f:
        reader = csv.reader(f)
        header = next(reader, None)
        if header is None or tuple(h.strip() for h in header) != EXPECTED_HEADER:
            raise ValueError(f"{path}: unexpected ds4-bench CSV header {header}")
        rows = []
        for line_no, raw in enumerate(reader, start=2):
            if not raw:
                continue
            if len(raw) != len(EXPECTED_HEADER):
                raise ValueError(f"{path}:{line_no}: expected {len(EXPECTED_HEADER)} columns")
            values = {}
            for name, text in zip(EXPECTED_HEADER, raw):
                try:
                    v = int(text) if name in _INT_FIELDS else float(text)
                except ValueError:
                    raise ValueError(f"{path}:{line_no}: {name} is not numeric: {text!r}") from None
                if not math.isfinite(v) or v < 0:
                    raise ValueError(f"{path}:{line_no}: {name} must be finite and >= 0")
                values[name] = v
            rows.append(BenchRow(**values))
    if not rows:
        raise ValueError(f"{path}: no data rows")
    return rows


def median(values: list[float]) -> float:
    if not values:
        raise ValueError("median of empty list")
    s = sorted(values)
    mid = len(s) // 2
    return s[mid] if len(s) % 2 else (s[mid - 1] + s[mid]) / 2.0


def percentile(values: list[float], q: float) -> float:
    """Nearest-rank percentile, q in (0, 100]."""
    if not values:
        raise ValueError("percentile of empty list")
    s = sorted(values)
    k = max(0, min(len(s) - 1, math.ceil(q / 100.0 * len(s)) - 1))
    return s[k]


def aggregate_by_ctx(rows: list[BenchRow]) -> dict[int, CtxStats]:
    groups: dict[int, list[BenchRow]] = {}
    for r in rows:
        groups.setdefault(r.ctx_tokens, []).append(r)
    out = {}
    for ctx, rs in sorted(groups.items()):
        tps = [r.gen_tps for r in rs]
        if any(t <= 0 for t in tps):
            raise ValueError(f"ctx {ctx}: gen_tps must be > 0 to derive ms/token")
        # Per-token latency is derived per run, then aggregated, so p50 <= p95
        # holds by construction (the inverse of a tps percentile would not).
        ms_tok = [1000.0 / t for t in tps]
        ttft = [r.gen_first_ms for r in rs]
        out[ctx] = CtxStats(
            ctx_tokens=ctx, n=len(rs), gen_tps_median=median(tps),
            gen_first_ms_median=median(ttft), gen_first_ms_p95=percentile(ttft, 95),
            ms_per_token_p50=median(ms_tok), ms_per_token_p95=percentile(ms_tok, 95),
        )
    return out


def profile_measurements(stats: dict[int, CtxStats], draft_length: int = 0) -> list[dict]:
    """One single-sequence decode measurement per context size (plan §3.1)."""
    return [
        {"num_sequences": 1, "draft_length": draft_length, "p50_ms": s.ms_per_token_p50,
         "p95_ms": s.ms_per_token_p95, "samples": s.n}
        for _, s in sorted(stats.items())
    ]
