"""Cross-check c/ds4di_choose_draft_length and ds4di_expected_accepted against
the plan §4.3 Python reference on random inputs."""
import ctypes
import math
import pathlib
import random
import shutil
import subprocess

import pytest

from deepinfer_ds4.spec_select import choose_draft_length, expected_accepted

C_DIR = pathlib.Path(__file__).resolve().parents[2] / "c"


class Decision(ctypes.Structure):
    _fields_ = [("draft_length", ctypes.c_uint32), ("reason", ctypes.c_int)]


@pytest.fixture(scope="module")
def lib():
    if shutil.which("cc") is None or shutil.which("make") is None:
        pytest.skip("no C toolchain")
    subprocess.run(["make", "-s", "-C", str(C_DIR), "shared"], check=True)
    so = ctypes.CDLL(str(C_DIR / "build" / "libds4di_spec_policy.so"))
    so.ds4di_expected_accepted.argtypes = [ctypes.POINTER(ctypes.c_double), ctypes.c_uint32,
                                           ctypes.c_uint32, ctypes.POINTER(ctypes.c_double)]
    so.ds4di_choose_draft_length.argtypes = [
        ctypes.POINTER(ctypes.c_double), ctypes.c_uint32, ctypes.POINTER(ctypes.c_double),
        ctypes.POINTER(ctypes.c_uint8), ctypes.c_uint32, ctypes.c_uint32, ctypes.POINTER(Decision)]
    return so


def arr(ctype, values):
    return (ctype * max(1, len(values)))(*values)


def test_c_matches_python_reference(lib):
    rng = random.Random(11)
    for _ in range(5000):
        n = rng.randint(0, 8)
        p = [rng.choice([0.0, 1.0, rng.random()]) for _ in range(n)]
        n_times = rng.randint(0, 10)
        times = [rng.choice([rng.uniform(0.5, 30.0), 0.0, -1.0, math.inf]) for _ in range(n_times)]
        valid = [rng.random() < 0.85 for _ in range(n_times)]
        cap = rng.randint(0, 10)

        out = Decision()
        rc = lib.ds4di_choose_draft_length(arr(ctypes.c_double, p), n, arr(ctypes.c_double, times),
                                           arr(ctypes.c_uint8, valid), n_times, cap, ctypes.byref(out))
        assert rc == 0
        py = choose_draft_length(p, {m: t for m, t in enumerate(times) if valid[m]}, cap)
        assert out.draft_length == py, (p, times, valid, cap)

        m = rng.randint(0, n)
        e = ctypes.c_double()
        assert lib.ds4di_expected_accepted(arr(ctypes.c_double, p), n, m, ctypes.byref(e)) == 0
        assert abs(e.value - expected_accepted(p, m)) < 1e-12


def test_c_and_python_both_fail_closed(lib):
    for bad in (math.nan, -0.1, 1.1, math.inf):
        out = Decision()
        rc = lib.ds4di_choose_draft_length(arr(ctypes.c_double, [0.5, bad]), 2,
                                           arr(ctypes.c_double, [1, 1, 1]), arr(ctypes.c_uint8, [1, 1, 1]),
                                           3, 2, ctypes.byref(out))
        assert rc != 0 and out.draft_length == 0
        with pytest.raises(ValueError):
            choose_draft_length([0.5, bad], {0: 1, 1: 1, 2: 1}, 2)
