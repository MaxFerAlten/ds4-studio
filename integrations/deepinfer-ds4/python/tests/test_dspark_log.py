import dataclasses
import json
import pathlib

import pytest

from deepinfer_ds4.dspark_log import parse_lines, parse_logs


FIXTURE = pathlib.Path(__file__).parent / "fixtures" / "dspark_stderr.txt"
# Every fixture line, in order, is derived from these fprintf format strings:
#  1 ds4.c:61503
#  2-3 ds4.c:61570-61571 (confidence0 valid and n/a variants)
#  4 ds4.c:61600-61601
#  5 ds4.c:61637-61638
#  6 ds4.c:61655-61657
#  7 ds4.c:86338
#  8 ds4.c:74148-74161 (histograms: ds4.c:74111)
#  9 ds4.c:74748
# 10 ds4.c:86182
# 11 ds4.c:86574
# 12 ds4.c:86644
# 13 ds4.c:86672
# 14 ds4.c:86811
# 15 ds4.c:86843
# 16 ds4.c:86880
# 17 ds4.c:86925
# 18 ds4.c:87027
# 19 ds4.c:87037 (accepted includes the first target token; use drafted)
# 20 ds4.c:87042 (use verified, not accepted)
# 21 ds4_bench.c:800
# 22 ds4_bench.c:791
# 23 ds4_bench.c:941
# 24 ds4_bench.c:946
SAMPLES = FIXTURE.read_text().splitlines()


@pytest.mark.parametrize("line", SAMPLES)
def test_each_source_format(line):
    summary = parse_lines(iter([line]))
    assert sum(summary.event_counts.values()) == 1
    assert summary.unknown_lines == 0


def test_all_events_and_summary_precedence():
    summary = parse_lines(iter(SAMPLES))
    assert len(SAMPLES) == 24
    assert sum(summary.event_counts.values()) == 24
    assert summary.event_counts["no_draft_pause"] == 2
    assert summary.event_counts["mtp_timing_micro"] == 4
    assert summary.event_counts["mtp_timing_decode2"] == 2
    assert summary.accepted_drafts == 19  # DSpark + independent Qwen session
    assert summary.cycles == 18
    assert summary.acceptance_avg == pytest.approx(19 / 18)
    with pytest.raises(dataclasses.FrozenInstanceError):
        summary.cycles = 0


def test_scheduler_windows_do_not_sum_lifetime_counters():
    summary = parse_lines([SAMPLES[i] for i in (1, 2, 3, 5)])
    assert (summary.accepted_drafts, summary.cycles, summary.acceptance_avg) == (3, 8, 3 / 8)
    bypass = parse_lines([SAMPLES[3], SAMPLES[4]])
    assert bypass.accepted_drafts == 8
    assert bypass.cycles is None and bypass.acceptance_avg is None
    assert parse_lines([SAMPLES[1]]).accepted_drafts is None


def test_mtp_timing_precedes_overlapping_spec_events():
    summary = parse_lines([SAMPLES[17], SAMPLES[18], SAMPLES[19]])
    assert (summary.accepted_drafts, summary.cycles, summary.acceptance_avg) == (2, 1, 2.0)
    summary = parse_lines([SAMPLES[18], SAMPLES[19]])
    assert (summary.accepted_drafts, summary.cycles) == (3, 2)


def test_unknown_malformed_private_lines_and_empty_input():
    private = "a private prompt /home/someone/private.txt"
    summary = parse_lines([
        private, "", "ds4: DSpark scheduler skip remaining=bad",
        "ds4: DSpark scheduler pause cycles=NaN", SAMPLES[3] + " " + private,
        SAMPLES[8].replace("10 verify", "9" * 5000 + " verify"),
        SAMPLES[22].replace("synthetic error", private),
    ])
    assert summary.unknown_lines == 6
    assert summary.event_counts == {"bench_decode_failed": 1}
    encoded = json.dumps(dataclasses.asdict(summary), allow_nan=False)
    assert "private" not in encoded and "/home" not in encoded
    empty = parse_lines([])
    assert empty.event_counts == {} and empty.unknown_lines == 0
    assert empty.accepted_drafts is None and empty.cycles is None and empty.acceptance_avg is None


def test_zero_stats_and_histogram_variants():
    line = SAMPLES[7].replace("cycles=8", "cycles=0").replace("accepted_draft=12", "accepted_draft=0")
    line = line.replace("net_saved=-2.000", "net_saved=n/a").replace("0:1,3:7", "none")
    summary = parse_lines([line])
    assert summary.unknown_lines == 0
    assert summary.accepted_drafts == summary.cycles == 0
    assert summary.acceptance_avg is None


def test_independent_files_keep_their_own_accounting_source(tmp_path):
    stats, timing, noise = [tmp_path / name for name in ("stats.log", "timing.log", "noise.log")]
    stats.write_text(SAMPLES[7] + "\n" + SAMPLES[17] + "\n")
    timing.write_text(SAMPLES[17] + "\n")
    noise.write_bytes(b"unrelated \xff diagnostic\n")
    summary = parse_logs([stats, timing, noise])
    assert (summary.accepted_drafts, summary.cycles) == (14, 9)
    assert summary.acceptance_avg == pytest.approx(14 / 9)
    assert summary.unknown_lines == 1
