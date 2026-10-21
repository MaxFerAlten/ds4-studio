# Part of DS4-Studio DeepInfer integration (plan §4.1 Mode A, §4.3, §10.2).
"""Choose between whole DS4 run configurations from repeated measurements.

DS4 sets the speculative configuration (`--dspark-confidence`, scheduler env
knobs, `--mtp-draft`) only at engine start, so DeepInfer's per-step budget
selection cannot be applied live. This module only *recommends* the
configuration for the next start; it never restarts anything.
"""

from __future__ import annotations

import math
import random
from dataclasses import dataclass, field

GO, NO_GO, INCONCLUSIVE, INSUFFICIENT_DATA = "GO", "NO_GO", "INCONCLUSIVE", "INSUFFICIENT_DATA"


# --- plan §4.3 reference, also the oracle for c/ds4di_choose_draft_length ---

def expected_accepted(conditional_p: list[float], m: int) -> float:
    if m < 0 or m > len(conditional_p):
        raise ValueError("m outside [0, len(conditional_p)]")
    prod, total = 1.0, 0.0
    for p in conditional_p[:m]:
        if not math.isfinite(p) or not 0.0 <= p <= 1.0:
            raise ValueError("confidence non valida")
        prod *= p
        total += prod
    return total


def choose_draft_length(conditional_p: list[float], times_ms: dict[int, float],
                        max_supported: int) -> int:
    # times_ms holds the FULL cost of each candidate, measured on the same
    # model/backend/load. Validate every usable confidence first: fail closed.
    limit = min(max_supported, len(conditional_p))
    expected_accepted(conditional_p, limit)
    feasible = [m for m in range(limit + 1)
                if m in times_ms and math.isfinite(times_ms[m]) and times_ms[m] > 0]
    if not feasible:
        return 0
    return max(feasible, key=lambda m: ((1.0 + expected_accepted(conditional_p, m)) / times_ms[m], -m))


# --- Mode A selector ---

@dataclass(frozen=True)
class Gates:
    min_runs: int = 7
    go_min_ci_low_pct: float = 5.0
    no_go_ci_high_pct: float = -3.0
    max_ttft_regression_pct: float = 5.0
    resamples: int = 2000


@dataclass(frozen=True)
class RunSet:
    label: str
    gen_tps: list[float]
    ttft_ms: list[float] = field(default_factory=list)

    def __post_init__(self) -> None:
        for v in (*self.gen_tps, *self.ttft_ms):
            if not math.isfinite(v) or v < 0:
                raise ValueError(f"{self.label}: measurements must be finite and >= 0")
        if self.ttft_ms and len(self.ttft_ms) != len(self.gen_tps):
            raise ValueError(f"{self.label}: ttft_ms and gen_tps lengths differ")


@dataclass(frozen=True)
class CandidateResult:
    label: str
    decision: str
    runs: int
    median_gen_tps: float | None
    improvement_pct: float | None
    ci95_pct: tuple[float, float] | None
    ttft_p95_regression_pct: float | None
    reason: str


@dataclass(frozen=True)
class Selection:
    baseline: str
    recommended: str
    candidates: list[CandidateResult]
    seed: int


def _median(v: list[float]) -> float:
    s = sorted(v)
    n = len(s)
    return s[n // 2] if n % 2 else (s[n // 2 - 1] + s[n // 2]) / 2.0


def _p95(v: list[float]) -> float:
    s = sorted(v)
    return s[max(0, math.ceil(0.95 * len(s)) - 1)]


def _pct(new: float, old: float) -> float:
    return (new / old - 1.0) * 100.0


def bootstrap_ci(base: list[float], cand: list[float], rng: random.Random,
                 resamples: int) -> tuple[float, float]:
    """Percentile bootstrap 95% CI of the relative change in medians."""
    stats = []
    for _ in range(resamples):
        b = _median([rng.choice(base) for _ in base])
        c = _median([rng.choice(cand) for _ in cand])
        if b > 0:
            stats.append(_pct(c, b))
    if not stats:
        raise ValueError("baseline median is zero in every resample")
    stats.sort()
    lo = stats[max(0, int(0.025 * len(stats)))]
    hi = stats[min(len(stats) - 1, int(math.ceil(0.975 * len(stats))) - 1)]
    return lo, hi


def evaluate(baseline: RunSet, cand: RunSet, gates: Gates, rng: random.Random) -> CandidateResult:
    n = len(cand.gen_tps)
    if n < gates.min_runs or len(baseline.gen_tps) < gates.min_runs:
        return CandidateResult(cand.label, INSUFFICIENT_DATA, n, None, None, None, None,
                               f"need >= {gates.min_runs} runs for baseline and candidate")
    base_med = _median(baseline.gen_tps)
    if base_med <= 0:
        return CandidateResult(cand.label, INSUFFICIENT_DATA, n, None, None, None, None,
                               "baseline median gen_tps is zero")
    med = _median(cand.gen_tps)
    imp = _pct(med, base_med)
    ci = bootstrap_ci(baseline.gen_tps, cand.gen_tps, rng, gates.resamples)

    ttft_reg = None
    if baseline.ttft_ms and cand.ttft_ms:
        base_p95 = _p95(baseline.ttft_ms)
        ttft_reg = _pct(_p95(cand.ttft_ms), base_p95) if base_p95 > 0 else None
    ttft_bad = ttft_reg is not None and ttft_reg > gates.max_ttft_regression_pct

    if ttft_bad:
        decision, reason = NO_GO, f"TTFT p95 regression {ttft_reg:.2f}% > {gates.max_ttft_regression_pct}%"
    elif ci[1] < gates.no_go_ci_high_pct:
        decision, reason = NO_GO, f"CI upper bound {ci[1]:.2f}% < {gates.no_go_ci_high_pct}%"
    elif ci[0] >= gates.go_min_ci_low_pct:
        decision, reason = GO, f"CI lower bound {ci[0]:.2f}% >= {gates.go_min_ci_low_pct}%"
    else:
        decision, reason = INCONCLUSIVE, "CI straddles the decision thresholds"
    return CandidateResult(cand.label, decision, n, med, imp, ci, ttft_reg, reason)


def select(baseline: RunSet, candidates: list[RunSet], gates: Gates | None = None,
           seed: int = 1) -> Selection:
    gates = gates or Gates()
    labels = [baseline.label, *(c.label for c in candidates)]
    if len(set(labels)) != len(labels):
        raise ValueError("configuration labels must be unique")
    rng = random.Random(seed)
    results = [evaluate(baseline, c, gates, rng) for c in candidates]
    go = [r for r in results if r.decision == GO]
    best = max(go, key=lambda r: (r.ci95_pct[0], r.label)) if go else None
    return Selection(baseline.label, best.label if best else baseline.label, results, seed)
