import dataclasses
import json
import math
import os
import stat
import uuid

import pytest

from deepinfer_ds4.perf_profile import (
    DEFAULT_TTL_S, STALE_GRACE_S, PerfIdentity, PerfProfileStore, parse_filename,
    validate_measurement,
)

IDENT = dict(model_sha256="a" * 64, runtime_commit="r1", overlay_commit="o1", backend="rocm",
             device_id="gfx1151", quantization="Q2", context_length=131072, kv_dtype="f16", mtp_max=5)
MEAS = [{"num_sequences": 1, "draft_length": 0, "ctx_tokens": 4096,
         "p50_ms": 40.0, "p95_ms": 45.0, "samples": 7}]
NOW = 1_800_000_000


def ident(**kw):
    return PerfIdentity.from_dict({**IDENT, **kw})


def test_write_then_read_roundtrip(tmp_path):
    store = PerfProfileStore(str(tmp_path / "p"))
    path = store.write(ident(), MEAS, now_s=NOW)
    got = store.read(ident(), now_s=NOW)
    assert got["measurements"] == MEAS and got["identity"] == ident().to_dict()
    assert stat.S_IMODE(os.stat(path).st_mode) == 0o600
    assert stat.S_IMODE(os.stat(tmp_path / "p").st_mode) == 0o700
    assert got["schema_version"] == 1 and got["created_at_unix"] == NOW
    assert parse_filename(os.path.basename(path))[1] == NOW * 10**9


@pytest.mark.parametrize("timestamp_ns", [0, 123, NOW * 10**9 + 123_456_789])
@pytest.mark.parametrize("temporary", [False, True])
def test_parse_nanosecond_filename(timestamp_ns, temporary):
    key = ident().key()
    name = f"{key}.{'b' * 32}.{timestamp_ns:019d}" + (".tmp" if temporary else "")
    assert parse_filename(name) == (key, timestamp_ns, temporary)


def test_legacy_second_filename_is_dirty(tmp_path):
    store = PerfProfileStore(str(tmp_path))
    legacy = tmp_path / f"{ident().key()}.{'b' * 32}.{NOW}"
    legacy.write_text("{}")
    assert parse_filename(legacy.name) is None
    store.cleanup(now_s=NOW)
    assert not legacy.exists()


def test_newest_valid_wins(tmp_path):
    store = PerfProfileStore(str(tmp_path))
    store.write(ident(), MEAS, now_s=NOW)
    newer = [{**MEAS[0], "p50_ms": 30.0}]
    store.write(ident(), newer, now_s=NOW + 10)
    assert store.read(ident(), now_s=NOW + 10)["measurements"] == newer


@pytest.mark.parametrize("inject_now", [True, False])
def test_newest_write_wins_within_same_second(tmp_path, monkeypatch, inject_now):
    # Descending UUIDs ensure the old UUID tiebreak always prefers the oldest write.
    uuids = iter(uuid.UUID(int=n) for n in range(100, 0, -1))
    monkeypatch.setattr("deepinfer_ds4.perf_profile.uuid.uuid4", lambda: next(uuids))
    monkeypatch.setattr("deepinfer_ds4.perf_profile.time.time", lambda: NOW)
    monkeypatch.setattr("deepinfer_ds4.perf_profile.time.time_ns", lambda: NOW * 10**9 + 123)
    newer = [{**MEAS[0], "p50_ms": 30.0}]
    for _ in range(50):
        # Reopen the store so ordering cannot depend on instance-local state.
        store = PerfProfileStore(str(tmp_path))
        store.write(ident(), MEAS, now_s=NOW if inject_now else None)
        store.write(ident(), newer, now_s=NOW if inject_now else None)
        got = store.read(ident(), now_s=NOW)
        assert got["measurements"] == newer
        assert got["created_at_unix"] == NOW


def test_measurement_requires_context():
    measurement = {k: v for k, v in MEAS[0].items() if k != "ctx_tokens"}
    with pytest.raises(ValueError, match="ctx_tokens"):
        validate_measurement(measurement)


@pytest.mark.parametrize("ctx", [0, -1, True, 1.5, "4096", None])
def test_measurement_requires_positive_integer_context(ctx):
    with pytest.raises(ValueError, match="ctx_tokens"):
        validate_measurement({**MEAS[0], "ctx_tokens": ctx})


def test_write_rejects_context_above_identity(tmp_path):
    measurement = {**MEAS[0], "ctx_tokens": 8192}
    with pytest.raises(ValueError, match="ctx_tokens 8192.*context_length 4096"):
        PerfProfileStore(str(tmp_path)).write(ident(context_length=4096), [measurement], now_s=NOW)
    assert not list(tmp_path.iterdir())


def test_write_rejects_duplicate_measurement_keys(tmp_path):
    measurement = {**MEAS[0], "ctx_tokens": 4096}
    with pytest.raises(ValueError, match="duplicate.*num_sequences.*draft_length.*ctx_tokens"):
        PerfProfileStore(str(tmp_path)).write(
            ident(), [measurement, {**measurement, "p50_ms": 30.0}], now_s=NOW)
    assert not list(tmp_path.iterdir())


def test_write_accepts_distinct_measurement_keys(tmp_path):
    measurement = {**MEAS[0], "ctx_tokens": 4096}
    measurements = [measurement, {**measurement, "ctx_tokens": 8192},
                    {**measurement, "num_sequences": 2}, {**measurement, "draft_length": 1}]
    store = PerfProfileStore(str(tmp_path))
    store.write(ident(context_length=8192), measurements, now_s=NOW)
    assert store.read(ident(context_length=8192), now_s=NOW)["measurements"] == measurements


@pytest.mark.parametrize("field,value", [(k, None) for k in IDENT] + [("config_label", "x"), ("extra", {"g": 1})])
def test_key_changes_with_every_identity_field(field, value):
    base = ident()
    if value is None:
        orig = IDENT[field]
        value = orig + 1 if isinstance(orig, int) else orig + "x"
    assert ident(**{field: value}).key() != base.key()


def test_identity_mismatch_not_returned(tmp_path):
    store = PerfProfileStore(str(tmp_path))
    store.write(ident(), MEAS, now_s=NOW)
    assert store.read(ident(backend="vulkan"), now_s=NOW) is None


def test_tampered_file_is_skipped(tmp_path):
    store = PerfProfileStore(str(tmp_path))
    path = store.write(ident(), MEAS, now_s=NOW)
    obj = json.loads(open(path).read())
    obj["measurements"][0]["p50_ms"] = 1.0
    open(path, "w").write(json.dumps(obj))
    assert store.read(ident(), now_s=NOW) is None


def test_truncated_file_is_skipped_older_used(tmp_path):
    store = PerfProfileStore(str(tmp_path))
    store.write(ident(), MEAS, now_s=NOW)
    bad = store.write(ident(), MEAS, now_s=NOW + 5)
    open(bad, "w").write('{"schema_version": 1')
    assert store.read(ident(), now_s=NOW + 5)["created_at_unix"] == NOW


def test_ttl_expiry(tmp_path):
    store = PerfProfileStore(str(tmp_path), ttl_s=100)
    store.write(ident(), MEAS, now_s=NOW)
    assert store.read(ident(), now_s=NOW + 100) is not None
    assert store.read(ident(), now_s=NOW + 101) is None


def test_nanosecond_timestamp_preserves_ttl_and_cleanup(tmp_path, monkeypatch):
    monkeypatch.setattr("deepinfer_ds4.perf_profile.time.time_ns", lambda: NOW * 10**9 + 999_999_999)
    store = PerfProfileStore(str(tmp_path), ttl_s=100)
    path = store.write(ident(), MEAS)
    assert parse_filename(os.path.basename(path))[1] == NOW * 10**9 + 999_999_999
    assert store.read(ident(), now_s=NOW + 100)["created_at_unix"] == NOW
    assert store.read(ident(), now_s=NOW + 101) is None
    store.cleanup(now_s=NOW + 100 + STALE_GRACE_S)
    assert os.path.exists(path)
    store.cleanup(now_s=NOW + 101 + STALE_GRACE_S)
    assert not os.path.exists(path)


def test_crash_leftover_tmp_ignored_then_cleaned(tmp_path):
    store = PerfProfileStore(str(tmp_path))
    key = ident().key()
    tmp = tmp_path / f"{key}.{'b' * 32}.{NOW * 10**9:019d}.tmp"
    tmp.write_text("{partial")
    assert store.read(ident(), now_s=NOW) is None
    store.cleanup(now_s=NOW)  # fresh .tmp may belong to a live writer
    assert tmp.exists()
    store.cleanup(now_s=NOW + DEFAULT_TTL_S + STALE_GRACE_S + 1)
    assert not tmp.exists()


def test_cleanup_removes_dirty_and_stale_keeps_fresh(tmp_path):
    store = PerfProfileStore(str(tmp_path), ttl_s=100)
    fresh = store.write(ident(), MEAS, now_s=NOW)
    stale = store.write(ident(), MEAS, now_s=NOW - 100 - STALE_GRACE_S - 1)
    (tmp_path / "garbage.txt").write_text("x")
    store.cleanup(now_s=NOW)
    assert os.path.exists(fresh) and not os.path.exists(stale)
    assert not (tmp_path / "garbage.txt").exists() and (tmp_path / ".lock").exists()


@pytest.mark.parametrize("bad", [
    {**MEAS[0], "p50_ms": math.nan},
    {**MEAS[0], "p95_ms": math.inf},
    {**MEAS[0], "p50_ms": -1.0},
    {**MEAS[0], "p50_ms": 50.0},
    {**MEAS[0], "samples": 0},
    {**MEAS[0], "samples": 1.5},
    {**MEAS[0], "prompt": "secret user text"},
])
def test_invalid_measurements_rejected(tmp_path, bad):
    with pytest.raises(ValueError):
        PerfProfileStore(str(tmp_path)).write(ident(), [bad], now_s=NOW)
    assert not [n for n in os.listdir(tmp_path) if n != ".lock"]


def test_identity_validation():
    with pytest.raises(ValueError):
        PerfIdentity.from_dict({k: v for k, v in IDENT.items() if k != "backend"})
    with pytest.raises(ValueError):
        PerfIdentity.from_dict({**IDENT, "prompt": "x"})
    with pytest.raises(ValueError):
        PerfIdentity.from_dict({**IDENT, "mtp_max": -1})
    assert dataclasses.is_dataclass(ident())
