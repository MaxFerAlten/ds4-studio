import ast
import json
import math
import pathlib
import random
import subprocess
import sys

import pytest

from deepinfer_ds4 import bench_ingest, perf_profile
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
    for m in ms:
        perf_profile.validate_measurement(m)


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
    assert json.loads(r.stdout)["profile"]["measurements"][0]["samples"] == 9


def test_cli_errors_exit_2(tmp_path):
    r = cli("select", "--baseline", str(tmp_path / "none-*.csv"))
    assert r.returncode == 2 and "no CSV matches" in r.stderr
    r = cli("select", "--baseline", str(tmp_path / "x"), "--candidate", "noequals")
    assert r.returncode == 2


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
