# Part of DS4-Studio DeepInfer integration (plan §3.2, §10.3).
"""Numeric-only, best-effort parsing of DS4 speculation diagnostics.

Totals prefer session stats, then per-cycle timing, then scheduler windows.
These sources overlap and must never be added together. Scheduler totals cover
only printed windows; lifetime accepted_total is deliberately not accumulated.
Logs have no context marker: their telemetry describes the whole run.
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable


@dataclass(frozen=True)
class DsparkLogSummary:
    event_counts: dict[str, int]
    accepted_drafts: int | None
    cycles: int | None
    acceptance_avg: float | None
    unknown_lines: int


_U = r"[0-9]+"
_F = r"-?[0-9]+(?:\.[0-9]+)?"
_H = rf"(?:none|{_U}:{_U}(?:,{_U}:{_U})*)"
_COUNTERS = (
    "cycles", "first_tokens", "proposed", "accepted_draft", "accept_rate", "avg_accept",
    "seed_batches", "full", "partial", "direct_full", "direct_partial", "replay_fallbacks",
    "miss_first", "no_draft", "no_room", "invalid", "scheduler_skips", "tail_skips",
    "verifier_unavailable", "errors",
)
_TIMES = (
    "propose", "prop_stage0", "prop_setup", "prop_cache", "prop_chain", "prop_hidden",
    "prop_conf0", "prop_logits", "prop_markov", "prop_confidence", "snapshot", "verify",
    "verify_upload", "verify_layer", "verify_head", "verify_read", "verify_fused_head",
    "replay", "spec_total", "target", "saved",
)
_stats = []
for _name in _COUNTERS:
    if _name in ("cycles", "accepted_draft"):
        _value = rf"(?P<{_name}>{_U})"
    else:
        _value = _F + ("%" if _name == "accept_rate" else "") if _name in (
            "accept_rate", "avg_accept") else _U
    _stats.append(rf"{_name}={_value}")
_STATS = ("ds4: DSpark stats " + " ".join(_stats) + " time_ms "
          + " ".join(rf"{name}={_U if name == 'verify_fused_head' else _F}" for name in _TIMES)
          + rf" net_saved=(?:n/a|{_F}) draft_len_hist={_H} accepted_len_hist={_H}")

# kind, full line pattern, accounting source (0 means event count only).
_PATTERNS = [
    ("scheduler_skip", rf"ds4: DSpark scheduler skip remaining={_U}", 0),
    ("no_draft_pause", rf"ds4: DSpark scheduler no-draft pause skip={_U} accepted_total={_U} "
     rf"long_accept=[01] confidence0=(?:n/a:)?{_F}", 0),
    ("break_even_pause", rf"ds4: DSpark scheduler break-even pause cycles=(?P<cycles>{_U}) "
     rf"accepted=(?P<accepted_draft>{_U}) saved={_F}ms extra={_F}ms skip={_U}", 1),
    ("bypass", rf"ds4: DSpark scheduler bypass accepted=(?P<accepted_draft>{_U}) "
     rf"avg={_F} no_draft={_U}", 1),
    ("pause", rf"ds4: DSpark scheduler pause cycles=(?P<cycles>{_U}) "
     rf"accepted=(?P<accepted_draft>{_U}) avg={_F} no_draft={_U} extra_per_accept={_F}ms "
     rf"saved={_F}ms extra={_F}ms skip={_U}", 1),
    ("tail_skip", rf"ds4: DSpark scheduler tail skip max={_U} min={_U}", 0),
    ("dspark_stats", _STATS, 5),
    ("qwen_mtp_stats", rf"ds4: Qwen3\.8 mtp: (?P<cycles>{_U}) verify cycles, "
     rf"(?P<accepted_draft>{_U}) drafts accepted \({_F}%\)", 5),
    ("dspark_v41", rf"ds4: V4\.1 DSpark proposed={_U} accepted=(?P<accepted_draft>{_U}) "
     rf"draft={_F} ms verify={_F} ms", 4),
    ("mtp_seq_accept", rf"ds4: mtp spec seq accept drafted=(?P<accepted_draft>{_U}) "
     rf"accepted={_U}", 2),
    ("mtp_seq_partial", rf"ds4: mtp spec seq partial drafted={_U} "
     rf"verified=(?P<accepted_draft>{_U}) accepted={_U}", 2),
    ("mtp_timing_margin_skip", rf"ds4: mtp timing margin-skip drafted=2 "
     rf"committed=(?P<accepted_draft>1) margin={_F} threshold={_F} "
     rf"draft={_F} ms verify={_F} ms total={_F} ms", 3),
    ("mtp_timing_decode2", rf"ds4: mtp timing decode2 drafted=2 "
     rf"committed=(?P<accepted_draft>[12]) draft={_F} ms snapshot={_F} ms verify={_F} ms "
     rf"(?:prefix={_F} ms )?total={_F} ms", 3),
    ("mtp_timing_micro", rf"ds4: mtp timing micro drafted={_U} "
     rf"committed=(?P<accepted_draft>{_U}) draft={_F} ms snapshot={_F} ms verify={_F} ms "
     rf"(?:(?:prefix|exact_replay|replay)={_F} ms )?total={_F} ms(?: noreplay=1)?", 3),
    ("mtp_timing_seq", rf"ds4: mtp timing seq drafted={_U} verified=(?P<accepted_draft>{_U}) "
     rf"draft={_F} ms verify={_F} ms total={_F} ms", 3),
    ("bench_enabled", rf"ds4-bench: DSpark enabled with draft width {_U}; "
     "frontier restoration uses session snapshots", 0),
    ("bench_not_speculative", "ds4-bench: DSpark support model did not enable speculative decoding", 0),
    ("bench_decode_failed", rf"ds4-bench: DSpark decode at frontier {_U} failed: .*", 0),
    ("bench_no_tokens", rf"ds4-bench: DSpark decode at frontier {_U} accepted no tokens", 0),
]
_EVENTS = [(kind, re.compile(pattern), source) for kind, pattern, source in _PATTERNS]


def parse_lines(lines: Iterable[str]) -> DsparkLogSummary:
    """Count unknown/malformed lines without retaining diagnostic or prompt text.

    A bypass omits its cycle count, so scheduler cycles/average become unknown.
    None means unavailable; a measured zero remains zero.
    """
    counts: dict[str, int] = {}
    totals: dict[int, tuple[int, int | None]] = {}
    unknown = 0
    for line in lines:
        for kind, pattern, source in _EVENTS:
            match = pattern.fullmatch(line.strip())
            if match is None:
                continue
            try:
                if source:
                    accepted = int(match["accepted_draft"])
                    cycles = (int(match["cycles"]) if "cycles" in match.re.groupindex
                              else None if source == 1 else 1)
                    old_a, old_c = totals.get(source, (0, 0))
                    new_a = old_a + accepted
                    new_c = None if old_c is None or cycles is None else old_c + cycles
                    # Keep JSON finite even for adversarial numeric input.
                    if new_c and not math.isfinite(new_a / new_c):
                        raise ValueError("nonfinite acceptance")
                    totals[source] = new_a, new_c
            except (ValueError, OverflowError):
                unknown += 1
                break
            counts[kind] = counts.get(kind, 0) + 1
            break
        else:
            unknown += 1
    accepted, cycles = totals[max(totals)] if totals else (None, None)
    avg = accepted / cycles if cycles else None
    return DsparkLogSummary(counts, accepted, cycles, avg, unknown)


def parse_logs(paths: Iterable[str | Path]) -> DsparkLogSummary:
    """Apply source precedence per file, then sum independent run summaries."""
    counts: dict[str, int] = {}
    accepted = cycles = None
    unknown = 0
    complete = True
    for path in paths:
        with open(path, encoding="utf-8", errors="replace") as f:
            summary = parse_lines(f)
        for kind, count in summary.event_counts.items():
            counts[kind] = counts.get(kind, 0) + count
        if summary.accepted_drafts is not None:
            accepted = (accepted or 0) + summary.accepted_drafts
            if summary.cycles is None:
                complete = False
            else:
                cycles = (cycles or 0) + summary.cycles
        unknown += summary.unknown_lines
    if not complete:
        cycles = None
    avg = accepted / cycles if cycles else None
    return DsparkLogSummary(counts, accepted, cycles, avg, unknown)
