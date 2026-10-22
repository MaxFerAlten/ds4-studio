#!/usr/bin/env python3
# Part of DS4-Studio DeepInfer integration (Gate 0 server leg).
"""Markdown report for a server_matrix.py run directory.

Decode speed comes from ds4-server's own per-request log (`prompt done Xs`, then
`gen=N ... finish=... Ts`): decode_tps = N / (T - X). The streamed client timing
is biased because the server holds deltas back while it classifies output
(thinking, DSML). TTFT is client-side: request sent -> first streamed delta.

Distribution check for the `sample` scenario: per word position, a permutation
chi-square test of homogeneity against the baseline (Bonferroni over positions).
"""
from __future__ import annotations

import argparse
import collections
import dataclasses
import json
import math
import random
import re
import statistics
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "python"))
from deepinfer_ds4 import dspark_log, spec_select  # noqa: E402

PROMPT_DONE = re.compile(r"ds4-server: chat ctx=\S+ .*prompt done ([0-9.]+)s$")
FINISH = re.compile(r"ds4-server: chat ctx=\S+ gen=([0-9]+) .*finish=\S+ ([0-9.]+)s$")
POSITIONS = 6
PERMUTATIONS = 2000


def server_timings(err: Path) -> list[tuple[float | None, int, float]]:
    out, pending = [], None
    for line in err.read_text(errors="replace").splitlines():
        if m := PROMPT_DONE.search(line):
            pending = float(m.group(1))
        elif m := FINISH.search(line):
            out.append((pending, int(m.group(1)), float(m.group(2))))
            pending = None
    return out


def load_runs(root: Path):
    meta = json.loads((root / "metadata.json").read_text())
    runs = collections.defaultdict(list)   # config -> [(round, records, err path)]
    problems = []
    for cfg in meta["configs"]:
        for jl in sorted((root / "runs" / cfg).glob("*.jsonl"), key=lambda p: int(p.stem)):
            recs = [json.loads(line) for line in jl.read_text().splitlines() if line.strip()]
            err = jl.with_suffix(".err")
            times = server_timings(err)
            if len(times) != len(recs):
                problems.append(f"{cfg} round {jl.stem}: {len(recs)} records, {len(times)} server timings")
                times = [(None, 0, 0.0)] * len(recs)
            for r, (p, gen, total) in zip(recs, times):
                ok = p is not None and gen == r["completion_tokens"] and total > p
                r["server_decode_tps"] = gen / (total - p) if ok else None
                r["server_prefill_s"] = p
            runs[cfg].append((int(jl.stem), recs, err))
    return meta, runs, problems


def per_run(runs, scenario):
    """One value per run: decode tps over all requests of the scenario(s), and their summed TTFT."""
    names = (scenario,) if isinstance(scenario, str) else scenario
    tps, ttft = [], []
    for _, recs, _ in runs:
        rs = [r for r in recs if r["scenario"] in names]
        if not rs or any(r["server_decode_tps"] is None for r in rs):
            continue
        tokens = sum(r["completion_tokens"] for r in rs)
        seconds = sum(r["completion_tokens"] / r["server_decode_tps"] for r in rs)
        tps.append(tokens / seconds)
        ttft.append(sum(r["ttft_ms"] for r in rs))
    return tps, ttft


def words(text: str) -> list[str]:
    return [w.strip().strip(".").lower() for w in text.split(",") if w.strip()]


def chi2(groups: list[list[str]]) -> float:
    cats = sorted({x for g in groups for x in g})
    n = sum(len(g) for g in groups)
    total = collections.Counter(x for g in groups for x in g)
    stat = 0.0
    for g in groups:
        c = collections.Counter(g)
        for k in cats:
            e = len(g) * total[k] / n
            if e > 0:
                stat += (c[k] - e) ** 2 / e
    return stat


def perm_pvalue(a: list[str], b: list[str], rng: random.Random) -> float:
    obs = chi2([a, b])
    pool = a + b
    hits = 0
    for _ in range(PERMUTATIONS):
        rng.shuffle(pool)
        if chi2([pool[:len(a)], pool[len(a):]]) >= obs - 1e-12:
            hits += 1
    return (hits + 1) / (PERMUTATIONS + 1)


def sample_words(runs, pos):
    out = []
    for _, recs, _ in runs:
        for r in recs:
            if r["scenario"] == "sample":
                w = words(r.get("content", ""))
                out.append(w[pos] if pos < len(w) else "<none>")
    return out


def fmt(v, d=2):
    return "n/a" if v is None else f"{v:.{d}f}"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("root")
    ap.add_argument("--baseline", default="baseline")
    ap.add_argument("--seed", type=int, default=1)
    a = ap.parse_args()
    root = Path(a.root)
    meta, runs, problems = load_runs(root)
    base = a.baseline
    others = [c for c in meta["configs"] if c != base]
    gates = spec_select.Gates()
    p = print

    p(f"# Server experiment: {root.name}\n")
    p("## Metadata\n")
    for k in ("utc_time", "git_sha_ds4", "model_basename", "rounds", "seed"):
        p(f"- {k}: {meta.get(k)}")
    p(f"- runs: " + ", ".join(f"{c} {len(runs[c])}" for c in meta["configs"]))
    for pr in problems:
        p(f"- WARNING: {pr}")

    p("\n## Decode and TTFT per scenario\n")
    p("decode = server log `gen / (total - prefill)`; one value per run (all requests of the "
      "scenario pooled). TTFT = client, request -> first streamed delta, summed over the "
      "scenario's requests in the run; the gate compares its p95 across runs.\n")
    groups = [("tool-use (3 scenarios pooled)", ("tool-next-step", "tool-final-answer", "tool-patch"))]
    groups += [(s, s) for s in meta["scenarios"]]
    rng = random.Random(a.seed)
    for title, sc in groups:
        p(f"### {title}\n")
        p("| config | runs | median decode tok/s | Δ vs baseline | CI95 % | p95 TTFT/run ms | TTFT p95 Δ % | gate |")
        p("| --- | ---: | ---: | ---: | --- | ---: | ---: | --- |")
        b_tps, b_ttft = per_run(runs[base], sc)
        bset = spec_select.RunSet(base, b_tps, b_ttft) if b_tps else None
        for c in meta["configs"]:
            tps, ttft = per_run(runs[c], sc)
            if not tps:
                p(f"| {c} | 0 | n/a | | | | | |")
                continue
            med = statistics.median(tps)
            p95 = sorted(ttft)[max(0, math.ceil(0.95 * len(ttft)) - 1)]
            if c == base or bset is None:
                p(f"| {c} | {len(tps)} | {med:.2f} | — | — | {p95:.0f} | — | — |")
                continue
            r = spec_select.evaluate(bset, spec_select.RunSet(c, tps, ttft), gates, rng)
            ci = f"{r.ci95_pct[0]:.1f}, {r.ci95_pct[1]:.1f}" if r.ci95_pct else "n/a"
            p(f"| {c} | {len(tps)} | {med:.2f} | {fmt(r.improvement_pct, 1)}% | {ci} | {p95:.0f} | "
              f"{fmt(r.ttft_p95_regression_pct, 1)} | {r.decision} |")
        p("")

    p("## Greedy output stability (tool scenarios)\n")
    p("Completion tokens and tool-call deltas per scenario, every run. Greedy output is "
      "deterministic per configuration; a spread across configurations is the documented "
      "DSpark divergence.\n")
    p("| scenario | " + " | ".join(meta["configs"]) + " |")
    p("| --- |" + " --- |" * len(meta["configs"]))
    for sc in ("tool-next-step", "tool-final-answer", "tool-patch"):
        cells = []
        for c in meta["configs"]:
            vals = sorted({(r["completion_tokens"], r["tool_call_deltas"], r["finish_reason"])
                           for _, recs, _ in runs[c] for r in recs if r["scenario"] == sc})
            cells.append("; ".join(f"{n} tok/{t} tc/{f}" for n, t, f in vals))
        p(f"| {sc} | " + " | ".join(cells) + " |")

    p("\n## Sampling distribution (`sample`, temperature 1.0)\n")
    p(f"Permutation chi-square test of homogeneity vs {base}, per comma-separated word "
      f"position ({PERMUTATIONS} permutations). Bonferroni threshold over {POSITIONS} "
      f"positions: p < {0.05 / POSITIONS:.4f}.\n")
    p("| config | samples | " + " | ".join(f"p pos{i + 1}" for i in range(POSITIONS)) + " | min p | verdict |")
    p("| --- | ---: |" + " ---: |" * POSITIONS + " ---: | --- |")
    prng = random.Random(a.seed)
    for c in others:
        ps = [perm_pvalue(sample_words(runs[base], i), sample_words(runs[c], i), prng)
              for i in range(POSITIONS)]
        n = len(sample_words(runs[c], 0))
        verdict = "differs" if min(ps) < 0.05 / POSITIONS else "no difference detected"
        p(f"| {c} | {n} | " + " | ".join(f"{x:.3f}" for x in ps) + f" | {min(ps):.3f} | {verdict} |")

    p("\n## DSpark telemetry (whole server lifetime, all scenarios)\n")
    p("| config | cycles | accepted drafts | accepted/cycle |")
    p("| --- | ---: | ---: | ---: |")
    for c in others:
        s = dspark_log.parse_logs(sorted(str(e) for _, _, e in runs[c]))
        p(f"| {c} | {s.cycles} | {s.accepted_drafts} | {fmt(s.acceptance_avg)} |")


if __name__ == "__main__":
    main()
