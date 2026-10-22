import ast
import json
import math
import pathlib
import random
import subprocess
import sys

import pytest

from deepinfer_ds4 import bench_ingest, cli as cli_module, perf_profile
from deepinfer_ds4.spec_select import (
    GO, INCONCLUSIVE, INSUFFICIENT_DATA, NO_GO, Gates, RunSet,
    choose_draft_length, expected_accepted, select,
)

PKG = pathlib.Path(__file__).resolve().parents[1]
HEADER = ",".join(bench_ingest.EXPECTED_HEADER)


def write_csv(path, rows):
    path.write_text(HEADER + "\n" + "".join(
        f"{ctx},{ctx},500.0,128,{tps},{ttft},127,{tps},1048576\n" for ctx, tps, ttft in rows))
    return path


# --- plan §4.5 reference cases ---

def test_prefix_expectation():
    assert abs(expected_accepted([0.9, 0.5, 0.1], 3) - (0.9 + 0.45 + 0.045)) < 1e-12


def test_no_invalid_length():
    assert choose_draft_length([.7, .6], {0: 10, 1: 9, 2: 11}, 1) in (0, 1)


def test_nonfinite_confidence_fails_closed():
    with pytest.raises(ValueError):
        expected_accepted([float("nan")], 1)
    with pytest.raises(ValueError):
        choose_draft_length([0.5, 1.5], {0: 1, 1: 1, 2: 1}, 2)


def test_choose_tie_prefers_shorter_and_skips_bad_times():
    assert choose_draft_length([0.0], {0: 10.0, 1: 10.0}, 1) == 0
    assert choose_draft_length([1.0, 1.0], {0: 10.0, 1: math.nan, 2: 12.0}, 2) == 2
    assert choose_draft_length([1.0], {}, 1) == 0


def test_choose_random_invariants():
    rng = random.Random(3)
    for _ in range(2000):
        n = rng.randint(0, 6)
        p = [rng.random() for _ in range(n)]
        times = {m: rng.uniform(0.1, 20) for m in range(n + 1) if rng.random() < 0.8}
        cap = rng.randint(0, 8)
        assert 0 <= choose_draft_length(p, times, cap) <= min(cap, n)


# --- bench ingest ---

def test_parse_and_aggregate(tmp_path):
    p = write_csv(tmp_path / "a.csv", [(4096, 20.0, 100.0), (4096, 25.0, 120.0), (8192, 10.0, 300.0)])
    stats = bench_ingest.aggregate_by_ctx(bench_ingest.parse_csv(str(p)))
    s = stats[4096]
    assert s.n == 2 and s.gen_tps_median == 22.5
    assert s.ms_per_token_p50 <= s.ms_per_token_p95 == 50.0
    ms = bench_ingest.profile_measurements(stats)
    assert [m["samples"] for m in ms] == [2, 1]
    assert [m["ctx_tokens"] for m in ms] == [4096, 8192]
    for m in ms:
        perf_profile.validate_measurement(m)


def test_profile_measurements_preserve_contexts(tmp_path):
    p = write_csv(tmp_path / "contexts.csv", [(8192, 10, 200), (4096, 20, 100)])
    stats = bench_ingest.aggregate_by_ctx(bench_ingest.parse_csv(str(p)))
    measurements = bench_ingest.profile_measurements(stats, draft_length=2)
    assert [m["ctx_tokens"] for m in measurements] == [4096, 8192]
    assert [m["draft_length"] for m in measurements] == [2, 2]


@pytest.mark.parametrize("body", [
    "ctx_tokens,gen_tps\n1,2\n",
    HEADER + "\n4096,4096,500,128,nan,1,127,1,1\n",
    HEADER + "\n4096,4096,500,128,-1,1,127,1,1\n",
    HEADER + "\n4096,4096,500,128,x,1,127,1,1\n",
    HEADER + "\n4096,4096,500\n",
    HEADER + "\n",
    "",
])
def test_parse_rejects_bad_csv(tmp_path, body):
    p = tmp_path / "bad.csv"
    p.write_text(body)
    with pytest.raises(ValueError):
        bench_ingest.parse_csv(str(p))


# --- Mode A selector ---

def runs(center, spread=0.2, n=9, ttft=100.0):
    return [center + spread * ((i % 3) - 1) for i in range(n)], [ttft] * n


def test_select_go():
    base = RunSet("baseline", *runs(20.0))
    fast = RunSet("fast", *runs(23.0))
    sel = select(base, [fast], seed=1)
    assert sel.candidates[0].decision == GO and sel.recommended == "fast"


def test_select_no_go_slower():
    sel = select(RunSet("baseline", *runs(20.0)), [RunSet("slow", *runs(18.0))])
    assert sel.candidates[0].decision == NO_GO and sel.recommended == "baseline"


def test_select_no_go_ttft_regression_even_if_faster():
    base = RunSet("baseline", *runs(20.0, ttft=100.0))
    cand = RunSet("ttft", *runs(25.0, ttft=110.0))
    r = select(base, [cand]).candidates[0]
    assert r.decision == NO_GO and "TTFT" in r.reason


def test_select_inconclusive():
    r = select(RunSet("baseline", *runs(20.0)), [RunSet("same", *runs(20.3))]).candidates[0]
    assert r.decision == INCONCLUSIVE


def test_select_insufficient_data():
    r = select(RunSet("baseline", *runs(20.0)), [RunSet("few", *runs(30.0, n=6))]).candidates[0]
    assert r.decision == INSUFFICIENT_DATA and r.ci95_pct is None


def test_select_deterministic_and_picks_best_go():
    base = RunSet("baseline", [20, 21, 19, 20.5, 19.5, 20, 21, 19])
    cands = [RunSet("a", [22.5, 23, 22, 23.5, 22, 23, 22.8, 22.2]),
             RunSet("b", [25, 26, 24.5, 25.5, 25, 26, 24.8, 25.2])]
    s1, s2 = select(base, cands, seed=5), select(base, cands, seed=5)
    assert s1 == s2 and s1.recommended == "b"


def test_select_rejects_duplicates_and_nan():
    with pytest.raises(ValueError):
        select(RunSet("x", [1.0] * 7), [RunSet("x", [1.0] * 7)])
    with pytest.raises(ValueError):
        RunSet("n", [math.nan])


def test_gates_match_shipped_defaults():
    cfg = json.loads((PKG.parent / "config" / "deepinfer-overlay.defaults.json").read_text())
    g = cfg["deepinfer_overlay"]["gates"]
    d = Gates()
    assert (g["min_runs"], g["go_min_ci_low_pct"], g["no_go_ci_high_pct"],
            g["max_ttft_regression_pct"], g["bootstrap_resamples"]) == \
           (d.min_runs, d.go_min_ci_low_pct, d.no_go_ci_high_pct, d.max_ttft_regression_pct, d.resamples)
    assert cfg["deepinfer_overlay"]["enabled"] is False


# --- CLI ---

def cli(*args, cwd=PKG):
    return subprocess.run([sys.executable, "-m", "deepinfer_ds4", *args], cwd=cwd,
                          capture_output=True, text=True)


def test_cli_select_and_profile(tmp_path):
    for i, (b, c) in enumerate(zip(runs(20.0)[0], runs(24.0)[0])):
        write_csv(tmp_path / f"base-{i}.csv", [(4096, b, 100.0)])
        write_csv(tmp_path / f"cand-{i}.csv", [(4096, c, 100.0)])
    r = cli("select", "--baseline", str(tmp_path / "base-*.csv"),
            "--candidate", f"fast={tmp_path / 'cand-*.csv'}", "--seed", "1")
    assert r.returncode == 0, r.stderr
    assert json.loads(r.stdout)["recommended"] == "fast"

    r = cli("ingest", "--csv", str(tmp_path / "base-*.csv"), "--label", "b")
    assert r.returncode == 0 and json.loads(r.stdout)["contexts"][0]["n"] == 9

    ident = tmp_path / "identity.json"
    ident.write_text(json.dumps(dict(model_sha256="a" * 64, runtime_commit="r", overlay_commit="o",
                                     backend="rocm", device_id="gfx1151", quantization="Q2",
                                     context_length=4096, kv_dtype="f16", mtp_max=0)))
    store = tmp_path / "store"
    r = cli("profile", "write", "--dir", str(store), "--identity", str(ident),
            "--csv", str(tmp_path / "base-*.csv"))
    assert r.returncode == 0, r.stderr
    r = cli("profile", "show", "--dir", str(store), "--identity", str(ident))
    measurement = json.loads(r.stdout)["profile"]["measurements"][0]
    assert measurement["samples"] == 9 and measurement["ctx_tokens"] == 4096


def test_cli_errors_exit_2(tmp_path):
    r = cli("select", "--baseline", str(tmp_path / "none-*.csv"))
    assert r.returncode == 2 and "no CSV matches" in r.stderr
    r = cli("select", "--baseline", str(tmp_path / "x"), "--candidate", "noequals")
    assert r.returncode == 2


def test_runset_returns_context(tmp_path):
    csv = write_csv(tmp_path / "run.csv", [(8192, 20, 100)])
    runset, logs, ctx = cli_module._runset("base", str(csv))
    assert runset.label == "base" and logs == [] and ctx == 8192


@pytest.mark.parametrize("contexts", [(8192, 4096), (4096, 8192), (8192, 8192, 4096)])
def test_cli_select_rejects_different_config_contexts(tmp_path, monkeypatch, capsys, contexts):
    args = ["select", "--baseline-label", "base"]
    labels = ["base"] + [f"candidate-{i}" for i in range(1, len(contexts))]
    for i, (label, ctx) in enumerate(zip(labels, contexts)):
        csv = write_csv(tmp_path / f"{label}.csv", [(ctx, 20, 100)] * 7)
        args.extend(["--baseline", str(csv)] if i == 0 else ["--candidate", f"{label}={csv}"])

    def must_not_select(*args, **kwargs):
        pytest.fail("select must reject mismatched contexts before comparing runs")

    monkeypatch.setattr(cli_module.spec_select, "select", must_not_select)
    assert cli_module.main(args) == 2
    captured = capsys.readouterr()
    assert not captured.out
    for label, ctx in zip(labels, contexts):
        assert label in captured.err and str(ctx) in captured.err


def test_cli_profile_write_rejects_context_above_identity(tmp_path):
    csv = write_csv(tmp_path / "contexts.csv", [(4096, 20, 100), (8192, 10, 200)])
    identity_path = tmp_path / "identity.json"
    identity_path.write_text(json.dumps(dict(
        model_sha256="a" * 64, runtime_commit="r", overlay_commit="o", backend="rocm",
        device_id="gfx1151", quantization="Q2", context_length=4096, kv_dtype="f16", mtp_max=0)))
    directory = tmp_path / "store"
    r = cli("profile", "write", "--dir", str(directory), "--identity", str(identity_path),
            "--csv", str(csv))
    assert r.returncode == 2, r.stderr
    assert "ctx_tokens" in r.stderr and "8192" in r.stderr and "4096" in r.stderr
    assert not directory.exists()


def test_offline_no_network_imports():
    banned = {"socket", "urllib", "http", "requests", "ssl", "ftplib", "smtplib"}
    for src in (PKG / "deepinfer_ds4").glob("*.py"):
        for node in ast.walk(ast.parse(src.read_text())):
            names = []
            if isinstance(node, ast.Import):
                names = [a.name for a in node.names]
            elif isinstance(node, ast.ImportFrom) and node.module:
                names = [node.module]
            assert not {n.split(".")[0] for n in names} & banned, src.name


def test_cli_context_filters_preserve_mixed_context_error(tmp_path):
    for i in range(7):
        write_csv(tmp_path / f"base-{i}.csv", [(4096, 20, 100), (8192, 10, 200)])
        write_csv(tmp_path / f"cand-{i}.csv", [(4096, 24, 100), (8192, 8, 200)])
    args = ("select", "--baseline", str(tmp_path / "base-*.csv"),
            "--candidate", f"fast={tmp_path / 'cand-*.csv'}", "--resamples", "100")
    r = cli(*args)
    assert r.returncode == 2 and "runs mix context sizes [4096, 8192]" in r.stderr
    r = cli(*args, "--ctx", "4096")
    assert r.returncode == 0, r.stderr
    out = json.loads(r.stdout)
    assert out["recommended"] == "fast" and out["candidates"][0]["runs"] == 7
    r = cli(*args, "--ctx", "8192")
    assert json.loads(r.stdout)["candidates"][0]["decision"] == NO_GO
    r = cli("ingest", "--csv", str(tmp_path / "base-*.csv"), "--ctx", "8192")
    assert r.returncode == 0, r.stderr
    out = json.loads(r.stdout)
    assert len(out["contexts"]) == 1
    assert out["contexts"][0]["ctx_tokens"] == 8192 and out["contexts"][0]["n"] == 7
    r = cli("ingest", "--csv", str(tmp_path / "base-*.csv"))
    assert len(json.loads(r.stdout)["contexts"]) == 2
    for args in (args, ("ingest", "--csv", str(tmp_path / "base-*.csv"))):
        r = cli(*args, "--ctx", "12345")
        assert r.returncode == 2 and "no rows for ctx 12345" in r.stderr


def test_cli_dspark_logs_multiple_files_and_errors(tmp_path):
    first, second = tmp_path / "first.log", tmp_path / "second.log"
    first.write_text("ds4: DSpark scheduler skip remaining=2\nprivate prompt\n")
    second.write_text("ds4: Qwen3.8 mtp: 10 verify cycles, 7 drafts accepted (70.0%)\n")
    r = cli("dspark-log", "--log", str(first), str(second))
    assert r.returncode == 0, r.stderr
    out = json.loads(r.stdout)
    assert out["accepted_drafts"] == 7 and out["cycles"] == 10
    assert out["acceptance_avg"] == 0.7 and out["unknown_lines"] == 1
    assert "private" not in r.stdout and str(tmp_path) not in r.stdout
    repeated = cli("dspark-log", "--log", str(first), "--log", str(second))
    assert repeated.stdout == r.stdout
    assert cli("dspark-log", "--log", str(tmp_path / "missing.log")).returncode == 2


def test_cli_neighbor_telemetry_does_not_change_decisions(tmp_path):
    for label, tps in (("baseline", 20), ("fast", 24)):
        (tmp_path / label).mkdir()
        for i in range(7):
            write_csv(tmp_path / label / f"run-{i:02}.csv", [(4096, tps, 100), (8192, tps / 2, 200)])
    args = ("select", "--baseline", str(tmp_path / "baseline" / "run-*.csv"),
            "--candidate", f"fast={tmp_path / 'fast' / 'run-*.csv'}",
            "--ctx", "4096", "--resamples", "100")
    before = json.loads(cli(*args).stdout)
    assert "telemetry" not in before
    stats = (pathlib.Path(__file__).parent / "fixtures" / "dspark_stderr.txt").read_text().splitlines()[7]
    for label in ("baseline", "fast"):
        for i in range(7):
            (tmp_path / label / f"run-{i:02}.log").write_text(stats + "\nprivate prompt\n")
    # A different context's CSV/log and an orphan failed log must not be counted.
    write_csv(tmp_path / "fast" / "run-90.csv", [(16384, 1, 1000)])
    for i in (90, 99):
        (tmp_path / "fast" / f"run-{i}.log").write_text(stats + "\n")
    r = cli(*args)
    assert r.returncode == 0, r.stderr
    after = json.loads(r.stdout)
    telemetry = after.pop("telemetry")
    assert after.pop("telemetry_scope") == "whole_run"
    assert after == before
    assert set(telemetry) == {"baseline", "fast"}
    assert telemetry["fast"]["accepted_drafts"] == 84
    assert telemetry["fast"]["cycles"] == 56
    assert telemetry["fast"]["unknown_lines"] == 7
    assert "private" not in r.stdout and str(tmp_path) not in r.stdout


def test_first_token_ms_includes_prefill():
    row = bench_ingest.BenchRow(4096, 4096, 200.0, 128, 14.0, 400.0, 127, 14.0, 0)
    assert bench_ingest.first_token_ms(row) == 1000.0 * 4096 / 200.0 + 400.0
    no_prefill = bench_ingest.BenchRow(0, 0, 0.0, 128, 14.0, 70.0, 127, 14.0, 0)
    assert bench_ingest.first_token_ms(no_prefill) == 70.0
    with pytest.raises(ValueError):
        bench_ingest.first_token_ms(bench_ingest.BenchRow(4096, 4096, 0.0, 128, 14.0, 1.0, 127, 14.0, 0))
