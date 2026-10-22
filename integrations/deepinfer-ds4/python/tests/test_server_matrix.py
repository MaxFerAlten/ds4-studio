"""server_matrix.py config parsing and server_report.py log/statistics helpers."""
import importlib.util
import pathlib
import random

import pytest

SCRIPTS = pathlib.Path(__file__).resolve().parents[2] / "scripts"


def load(name):
    spec = importlib.util.spec_from_file_location(name, SCRIPTS / f"{name}.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


sm, sr = load("server_matrix"), load("server_report")

# Lines as ds4-server prints them (ds4_server.c:12161, 12739 and the finish line).
LOG = """\
1022 09:43:11 ds4-server: chat ctx=0..8634:8634 TOOLS prompt start
1022 09:43:11 ds4-server: chat ctx=0..8634:8634 TOOLS prefill chunk 4096/8634 (47.4%) chunk=230.1 t/s avg=230.1 t/s 17.8s
1022 09:43:11 ds4-server: chat ctx=0..8634:8634 TOOLS prompt done 37.642s
1022 09:43:12 ds4-server: chat ctx=8634..8658:24 gen=24 TOOLS THINKING decoding chunk=14.26 t/s avg=14.26 t/s 1.683s
1022 09:43:12 ds4-server: chat ctx=0..8634:8634 gen=24 TOOLS THINKING finish=length 39.325s
1022 09:43:31 ds4-server: chat ctx=0..4166:4166 TOOLS invalid tool call returned as assistant text finish=length [text_len=100]
1022 09:43:31 ds4-server: chat ctx=0..4166:4166 TOOLS prompt done 17.190s
1022 09:43:31 ds4-server: chat ctx=0..4166:4166 gen=24 TOOLS DSML_START finish=length 18.854s
"""


def test_server_timings(tmp_path):
    err = tmp_path / "1.err"
    err.write_text(LOG)
    assert sr.server_timings(err) == [(37.642, 24, 39.325), (17.19, 24, 18.854)]


def test_parse_configs(tmp_path):
    f = tmp_path / "c.tsv"
    f.write_text("# comment\nbaseline\nfast\tA=1 B=x --dspark --mtp-model m.gguf C=not-env\n")
    assert sm.parse_configs(f) == [("baseline", {}, []),
                                   ("fast", {"A": "1", "B": "x"},
                                    ["--dspark", "--mtp-model", "m.gguf", "C=not-env"])]
    f.write_text("a\na\n")
    with pytest.raises(SystemExit):
        sm.parse_configs(f)


def test_words():
    assert sr.words("Dog, cat , Owl.") == ["dog", "cat", "owl"]


def test_permutation_detects_shift_and_not_noise():
    rng = random.Random(3)
    a = [rng.choice("abcd") for _ in range(300)]
    same = [rng.choice("abcd") for _ in range(300)]
    shifted = [rng.choice("aaab") for _ in range(300)]
    assert sr.perm_pvalue(a, same, random.Random(1)) > 0.01
    assert sr.perm_pvalue(a, shifted, random.Random(1)) < 0.001
