#!/usr/bin/env python3
# Part of DS4-Studio DeepInfer integration (plan §3.2, §10.3).
"""Read a bench_matrix directory and print a prompt-free Markdown report."""

from __future__ import annotations

import argparse
import dataclasses
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "python"))
from deepinfer_ds4 import bench_ingest, dspark_log, spec_select

# bench_matrix's metadata contract. Never echo arbitrary fields/command lines,
# which may contain prompts. Paths in the supported fields become basenames.
_METADATA_FIELDS = (
    "schema_version", "utc_time", "git_sha_ds4", "git_dirty", "linux_kernel",
    "model_basename", "model_sha256", "rounds", "seed",
)


def _cell(value: object) -> str:
    if isinstance(value, float):
        return f"{value:.3f}"
    if value is None:
        return "n/a"
    text = str(value)
    if text.startswith(("/", "~/")):
        text = Path(text).name
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(
        ">", "&gt;").replace("|", "&#124;").replace("`", "&#96;").replace("\n", " ").replace("\r", " ")


def render_report(directory: Path) -> str:
    with (directory / "metadata.json").open(encoding="utf-8") as f:
        metadata = json.load(f)
    if not isinstance(metadata, dict):
        raise ValueError("metadata must be an object")
    seed = metadata.get("seed", 1)
    if not isinstance(seed, int) or isinstance(seed, bool):
        raise ValueError("seed must be an integer")

    groups = {}
    for config in sorted(directory.iterdir()):
        if not config.is_dir():
            continue
        contexts = {}
        csvs = sorted(config.glob("run-*.csv"))
        for csv in csvs:
            rows = bench_ingest.parse_csv(str(csv))
            for row in rows:
                contexts.setdefault(row.ctx_tokens, ([], set()))[0].append(row)
            for ctx in {row.ctx_tokens for row in rows}:
                log = csv.with_suffix(".log")
                if log.is_file():
                    contexts[ctx][1].add(log)
        if csvs or any(config.glob("run-*.log")):
            groups[config.name] = contexts
    if "baseline" not in groups:
        raise ValueError("no baseline runs")
    ctxs = sorted({ctx for contexts in groups.values() for ctx in contexts})
    if not ctxs:
        raise ValueError("no measured contexts")

    lines = [f"# Experiment: {_cell(directory.name)}", "", "## Metadata", ""]
    for key in _METADATA_FIELDS:
        if key in metadata:
            value = metadata[key]
            if not isinstance(value, (str, int, float, bool, type(None))):
                raise ValueError("metadata fields must be scalar")
            lines.append(f"- {key}: {_cell(value)}")
    lines.extend([
        "", "## Measurements", "",
        "DSpark telemetry covers the whole run, including all its contexts; "
        "it is not attributed to individual contexts. Only logs next to successful CSVs are included.",
        "", "| config | ctx_tokens | n | median gen_tps | median prefill_tps | p95 gen_first_ms | DSpark (whole run) |",
        "| --- | ---: | ---: | ---: | ---: | ---: | --- |",
    ])
    runsets = {}
    for label, contexts in groups.items():
        for ctx in ctxs:
            rows, logs = contexts.get(ctx, ([], set()))
            runsets[label, ctx] = spec_select.RunSet(
                label, [r.gen_tps for r in rows], [r.gen_first_ms for r in rows])
            summary = (json.dumps(dataclasses.asdict(dspark_log.parse_logs(sorted(logs))),
                                  sort_keys=True, allow_nan=False) if logs else "no logs")
            if rows:
                stats = bench_ingest.aggregate_by_ctx(rows)[ctx]
                metrics = (stats.n, stats.gen_tps_median,
                           bench_ingest.median([r.prefill_tps for r in rows]), stats.gen_first_ms_p95)
            else:
                metrics = (0, None, None, None)
            values = (label, ctx, *metrics, summary)
            lines.append("| " + " | ".join(_cell(v) for v in values) + " |")

    lines.extend(["", "## Selection vs baseline", "",
                  f"Default selection gates; bootstrap seed {seed}.", "",
                  "| ctx_tokens | config | decision | improvement % | CI95 % | TTFT p95 regression % | reason |",
                  "| ---: | --- | --- | ---: | --- | ---: | --- |"])
    recommendations = []
    for ctx in ctxs:
        baseline = runsets["baseline", ctx]
        candidates = [runsets[label, ctx] for label in groups if label != "baseline"]
        selection = spec_select.select(baseline, candidates, seed=seed)
        for result in selection.candidates:
            ci = (", ".join(_cell(v) for v in result.ci95_pct)
                  if result.ci95_pct is not None else "n/a")
            values = (ctx, result.label, result.decision, result.improvement_pct, ci,
                      result.ttft_p95_regression_pct, result.reason)
            lines.append("| " + " | ".join(_cell(v) for v in values) + " |")
        recommendations.append(f"- ctx_tokens {ctx}: {_cell(selection.recommended)}")
    lines.extend(["", "Recommended configuration:", "", *recommendations, ""])
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", type=Path, help="bench_matrix output directory")
    args = parser.parse_args(argv)
    try:
        report = render_report(args.directory)
    except (OSError, ValueError, TypeError, KeyError, OverflowError):
        # CSV/JSON exceptions can contain raw input and absolute paths.
        print(f"experiment_report: invalid experiment data in {_cell(args.directory.name)}", file=sys.stderr)
        return 2
    sys.stdout.write(report)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
