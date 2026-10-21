# Part of DS4-Studio DeepInfer integration (plan §3, §4.1, §10).
"""`python -m deepinfer_ds4 ingest|select|profile` - JSON on stdout, errors exit 2."""

from __future__ import annotations

import argparse
import dataclasses
import glob
import json
import sys

from . import bench_ingest, perf_profile, spec_select


def _expand(pattern: str) -> list[str]:
    paths = sorted(glob.glob(pattern))
    if not paths:
        raise ValueError(f"no CSV matches {pattern!r}")
    return paths


def _runset(label: str, pattern: str) -> spec_select.RunSet:
    rows = [r for p in _expand(pattern) for r in bench_ingest.parse_csv(p)]
    ctxs = {r.ctx_tokens for r in rows}
    if len(ctxs) != 1:
        raise ValueError(f"{label}: runs mix context sizes {sorted(ctxs)}; select one per call")
    return spec_select.RunSet(label, [r.gen_tps for r in rows], [r.gen_first_ms for r in rows])


def _cmd_ingest(a: argparse.Namespace) -> object:
    rows = [r for p in a.csv for path in _expand(p) for r in bench_ingest.parse_csv(path)]
    stats = bench_ingest.aggregate_by_ctx(rows)
    return {"label": a.label, "contexts": [dataclasses.asdict(s) for s in stats.values()]}


def _cmd_select(a: argparse.Namespace) -> object:
    cands = []
    for spec in a.candidate:
        label, sep, pattern = spec.partition("=")
        if not sep or not label or not pattern:
            raise ValueError(f"--candidate must be NAME=GLOB, got {spec!r}")
        cands.append(_runset(label, pattern))
    gates = spec_select.Gates(min_runs=a.min_runs, resamples=a.resamples)
    return dataclasses.asdict(spec_select.select(_runset(a.baseline_label, a.baseline), cands, gates, a.seed))


def _load_identity(path: str) -> perf_profile.PerfIdentity:
    with open(path, encoding="utf-8") as f:
        return perf_profile.PerfIdentity.from_dict(json.load(f))


def _cmd_profile(a: argparse.Namespace) -> object:
    store = perf_profile.PerfProfileStore(a.dir, ttl_s=a.ttl)
    ident = _load_identity(a.identity)
    if a.action == "write":
        if not a.csv:
            raise ValueError("profile write needs --csv")
        rows = [r for p in a.csv for path in _expand(p) for r in bench_ingest.parse_csv(path)]
        ms = bench_ingest.profile_measurements(bench_ingest.aggregate_by_ctx(rows), a.draft_length)
        store.cleanup()
        return {"written": store.write(ident, ms), "key": ident.key()}
    return {"key": ident.key(), "profile": store.read(ident)}


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="deepinfer_ds4")
    sub = p.add_subparsers(dest="cmd", required=True)

    ing = sub.add_parser("ingest", help="aggregate ds4-bench CSVs")
    ing.add_argument("--csv", action="append", required=True, help="file or glob, repeatable")
    ing.add_argument("--label", default="")
    ing.set_defaults(fn=_cmd_ingest)

    sel = sub.add_parser("select", help="Mode A configuration selection")
    sel.add_argument("--baseline", required=True, help="glob of baseline CSVs")
    sel.add_argument("--baseline-label", default="baseline")
    sel.add_argument("--candidate", action="append", default=[], help="NAME=GLOB, repeatable")
    sel.add_argument("--seed", type=int, default=1)
    sel.add_argument("--min-runs", type=int, default=spec_select.Gates.min_runs)
    sel.add_argument("--resamples", type=int, default=spec_select.Gates.resamples)
    sel.set_defaults(fn=_cmd_select)

    prof = sub.add_parser("profile", help="decode perf profile store")
    prof.add_argument("action", choices=("write", "show"))
    prof.add_argument("--dir", required=True)
    prof.add_argument("--identity", required=True, help="identity JSON file")
    prof.add_argument("--csv", action="append", default=[])
    prof.add_argument("--draft-length", type=int, default=0)
    prof.add_argument("--ttl", type=int, default=perf_profile.DEFAULT_TTL_S)
    prof.set_defaults(fn=_cmd_profile)
    return p


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        out = args.fn(args)
    except (OSError, ValueError, KeyError, TypeError) as e:
        print(f"deepinfer_ds4: {e}", file=sys.stderr)
        return 2
    json.dump(out, sys.stdout, indent=2, sort_keys=True, allow_nan=False)
    sys.stdout.write("\n")
    return 0
