import json
import pathlib
import subprocess
import sys

from deepinfer_ds4 import bench_ingest, spec_select


ROOT = pathlib.Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "scripts" / "experiment_report.py"
STATS = (pathlib.Path(__file__).parent / "fixtures" / "dspark_stderr.txt").read_text().splitlines()[7]


def run_report(directory):
    return subprocess.run([sys.executable, str(SCRIPT), str(directory)], cwd=directory,
                          capture_output=True, text=True)


def make_experiment(directory):
    metadata = dict(schema_version=1, utc_time="2026-10-22T12:00:00Z", git_sha_ds4="abc123",
                    git_dirty=False, linux_kernel="6.8.0", rounds=7, seed=5,
                    model_basename="/home/private/models/model.gguf", model_sha256="a" * 64,
                    prompt="SECRET PROMPT", command="--prompt SECRET PROMPT /home/private")
    (directory / "metadata.json").write_text(json.dumps(metadata))
    for label, fast, slow in (("baseline", 20, 10), ("candidate", 24, 8)):
        config = directory / label
        config.mkdir()
        for i in range(7):
            rows = [(4096, fast, 100 + i, 500 + i), (8192, slow, 200 + i, 300 + i)]
            csv = config / f"run-{i + 1:02}.csv"
            csv.write_text(",".join(bench_ingest.EXPECTED_HEADER) + "\n" + "".join(
                f"{ctx},{ctx},{prefill},128,{tps},{ttft},127,{tps},1048576\n"
                for ctx, tps, ttft, prefill in rows))
            if label == "candidate":
                csv.with_suffix(".log").write_text(STATS + "\nSECRET PROMPT /home/private\n")
        (config / "run-99.log").write_text("failed run SECRET PROMPT\n")


def test_synthetic_report_metrics_privacy_and_selection(tmp_path):
    make_experiment(tmp_path)
    r = run_report(tmp_path)
    assert r.returncode == 0, r.stderr
    out = r.stdout
    for field in ("schema_version: 1", "rounds: 7", "seed: 5", "model_basename: model.gguf",
                  "git_sha_ds4: abc123", "utc_time: 2026-10-22T12:00:00Z"):
        assert field in out
    assert "| baseline | 4096 | 7 | 20.000 | 503.000 | 106.000 | no logs |" in out
    assert "| candidate | 8192 | 7 | 8.000 | 303.000 | 206.000 |" in out
    assert '"accepted_drafts": 84' in out and '"cycles": 56' in out
    assert '"acceptance_avg": 1.5' in out and '"unknown_lines": 7' in out
    assert "whole run" in out and "not attributed to individual contexts" in out
    for ctx, base_tps, cand_tps in ((4096, 20, 24), (8192, 10, 8)):
        expected = spec_select.select(spec_select.RunSet("baseline", [base_tps] * 7),
                                      [spec_select.RunSet("candidate", [cand_tps] * 7)], seed=5)
        assert f"| {ctx} | candidate | {expected.candidates[0].decision} |" in out
        assert f"- ctx_tokens {ctx}: {expected.recommended}" in out
    assert "SECRET" not in out and "/home/" not in out and str(tmp_path) not in out
    assert "command:" not in out and "prompt:" not in out
    assert run_report(tmp_path).stdout == out


def test_report_missing_context_and_insufficient_runs(tmp_path):
    make_experiment(tmp_path)
    candidate = tmp_path / "candidate"
    for path in candidate.glob("*.csv"):
        path.unlink()
    header = ",".join(bench_ingest.EXPECTED_HEADER)
    (candidate / "run-01.csv").write_text(header + "\n4096,4096,500,128,24,100,127,24,1\n")
    r = run_report(tmp_path)
    assert r.returncode == 0, r.stderr
    assert "| 4096 | candidate | INSUFFICIENT_DATA |" in r.stdout
    assert "| 8192 | candidate | INSUFFICIENT_DATA |" in r.stdout


def test_report_errors_do_not_echo_raw_data_or_paths(tmp_path):
    r = run_report(tmp_path)
    assert r.returncode == 2 and not r.stdout
    assert str(tmp_path) not in r.stderr
    make_experiment(tmp_path)
    (tmp_path / "baseline" / "run-01.csv").write_text("SECRET PROMPT /home/private\n")
    r = run_report(tmp_path)
    assert r.returncode == 2 and not r.stdout
    assert "SECRET" not in r.stderr and "/home" not in r.stderr


def test_report_includes_configuration_with_only_failed_logs(tmp_path):
    make_experiment(tmp_path)
    failed = tmp_path / "failed"
    failed.mkdir()
    (failed / "run-01.log").write_text("SECRET failed prompt /home/private\n")
    r = run_report(tmp_path)
    assert r.returncode == 0, r.stderr
    for ctx in (4096, 8192):
        assert f"| failed | {ctx} | 0 | n/a | n/a | n/a | no logs |" in r.stdout
        assert f"| {ctx} | failed | INSUFFICIENT_DATA |" in r.stdout
    assert "SECRET" not in r.stdout and "/home" not in r.stdout
