import hashlib
import json
import os
import pathlib
import struct
import subprocess
import sys

import pytest

from deepinfer_ds4 import bench_ingest, identity
from deepinfer_ds4.perf_profile import PerfIdentity

PKG = pathlib.Path(__file__).resolve().parents[1]
MODEL = pathlib.Path("/mnt/crucial_ai/modelli/ds4-rocm/DeepSeek-V4-Flash-DSpark-support.gguf")
OPTIONS = dict(backend="rocm", device_id="gfx1151", context_length=4096, mtp_max=5,
               kv_dtype="f16", runtime_commit="runtime-test", overlay_commit="overlay-test")
METADATA = [
    ("general.architecture", 8, "deepseek4"), ("general.alignment", 4, 32),
    ("general.name", 8, "synthetic"), ("tokenizer.ggml.model", 8, "gpt2"),
    ("tokenizer.ggml.tokens", 9, (8, ["a", "b"])),
    ("tokenizer.ggml.merges", 9, (8, ["a b"])),
    ("tokenizer.ggml.token_type", 9, (5, [1, 2])),
    ("tokenizer.ggml.scores", 9, (6, [0.25, -0.5])),
    ("tokenizer.ggml.bos_token_id", 4, 1),
    ("tokenizer.chat_template", 8, "{{ messages }}"),
]
TENSORS = [("first.weight", (2, 2), 0, 0), ("second.weight", (4,), 1, 32)]
# Independent test writer: GGUF metadata IDs and wire formats.
FORMATS = {0: "B", 1: "b", 2: "H", 3: "h", 4: "I", 5: "i", 6: "f", 7: "B",
           10: "Q", 11: "q", 12: "d"}


def string(value, endian="<"):
    data = value.encode("utf-8")
    return struct.pack(endian + "Q", len(data)) + data


def value(kind, data, endian="<"):
    if kind == 8:
        return string(data, endian)
    if kind == 9:
        element_type, elements = data
        return struct.pack(endian + "IQ", element_type, len(elements)) + b"".join(
            value(element_type, v, endian) for v in elements)
    return struct.pack(endian + FORMATS[kind], data)


def write_gguf(path, *, metadata=METADATA, tensors=TENSORS, version=3, endian="<", data=None):
    header = b"GGUF" + struct.pack(endian + "IQQ", version, len(tensors), len(metadata))
    for key, kind, item in metadata:
        header += string(key, endian) + struct.pack(endian + "I", kind) + value(kind, item, endian)
    for name, dims, kind, offset in tensors:
        header += string(name, endian) + struct.pack(endian + "I", len(dims))
        header += struct.pack(endian + "Q" * len(dims), *dims)
        header += struct.pack(endian + "IQ", kind, offset)
    header += b"\0" * (-len(header) % 32)
    path.write_bytes(header + (bytes(range(48)) if data is None else data))
    return path


def derive(path, **kwargs):
    return identity.build_perf_identity(path, **{**OPTIONS, **kwargs})


def hashes(path):
    header = identity.read_gguf_header(path)
    return dict(metadata=identity.gguf_metadata_hash(header), tokenizer=identity.tokenizer_hash(header),
                template=identity.chat_template_hash(header), layout=identity.tensor_layout_hash(header))


@pytest.mark.parametrize("version,endian", [(2, "<"), (3, "<"), (3, ">")])
def test_header_all_types_and_arrays(tmp_path, version, endian):
    examples = {0: 255, 1: -127, 2: 65535, 3: -32768, 4: 2**32 - 1, 5: -2**31,
                6: 1.25, 7: True, 8: "caffè", 10: 2**64 - 1, 11: -2**63, 12: 0.125}
    metadata = METADATA + [(f"scalar.{k}", k, v) for k, v in examples.items()]
    metadata += [(f"array.{k}", 9, (k, [v, v])) for k, v in examples.items()]
    path = write_gguf(tmp_path / "m.gguf", metadata=metadata, version=version, endian=endian)
    h = identity.read_gguf_header(path)
    assert h.version == version and h.file_size == path.stat().st_size
    assert h.file_size - h.data_offset == 48
    assert h.tensor_count == 2 and h.kv_count == len(metadata)
    assert h.tensors[0] == identity.TensorInfo("first.weight", 2, (2, 2), 0, 0)
    assert h.tensors[1].offset == 32 and h.tensors[1].type == 1
    for kind, item in examples.items():
        assert h.metadata[f"scalar.{kind}"] == item
        assert h.metadata[f"array.{kind}"] == [item, item]
        assert h.value_types[f"array.{kind}"] == (9, kind)
    assert identity.quantization(h) == "F32:1,F16:1"


def test_quantized_type_histogram(tmp_path):
    tensors = [("q2", (256,), 10, 0), ("iq2", (256,), 16, 96), ("q2_2", (256,), 10, 192)]
    path = write_gguf(tmp_path / "q.gguf", tensors=tensors, data=bytes(320))
    assert derive(path).quantization == "Q2_K:2,IQ2_XXS:1"


def test_empty_array_element_type_is_hashed(tmp_path):
    first = write_gguf(tmp_path / "u8.gguf", metadata=METADATA + [("empty", 9, (0, []))])
    second = write_gguf(tmp_path / "str.gguf", metadata=METADATA + [("empty", 9, (8, []))])
    assert hashes(first)["metadata"] != hashes(second)["metadata"]


def test_stable_hashes_metadata_order_types_and_mtime(tmp_path):
    path = write_gguf(tmp_path / "m.gguf")
    first, first_hashes = derive(path), hashes(path)
    assert derive(path) == first
    os.utime(path, ns=(1_000_000_000, 2_000_000_000))
    assert derive(path) == first
    reordered = write_gguf(tmp_path / "reordered.gguf", metadata=list(reversed(METADATA)))
    assert hashes(reordered) == first_hashes
    endian = write_gguf(tmp_path / "big.gguf", endian=">")
    assert hashes(endian) == first_hashes
    integer = write_gguf(tmp_path / "i.gguf", metadata=METADATA + [("number", 4, 1)])
    signed = write_gguf(tmp_path / "s.gguf", metadata=METADATA + [("number", 5, 1)])
    assert hashes(integer)["metadata"] != hashes(signed)["metadata"]
    assert first.model_sha256 == "sample:" + first.extra["weights_sample_sha256"]
    assert first.extra["general.architecture"] == "deepseek4" and first.extra["gguf_version"] == 3
    assert PerfIdentity.from_dict(first.to_dict()) == first


@pytest.mark.parametrize("key,new,changed", [
    ("general.name", "modified", "metadata"),
    ("general.architecture", "other", "metadata"),
    ("tokenizer.ggml.tokens", (8, ["a", "c"]), "tokenizer"),
    ("tokenizer.ggml.merges", (8, ["a c"]), "tokenizer"),
    ("tokenizer.ggml.token_type", (5, [1, 3]), "tokenizer"),
    ("tokenizer.ggml.scores", (6, [0.5, -0.5]), "tokenizer"),
    ("tokenizer.ggml.bos_token_id", 2, "tokenizer"),
    ("tokenizer.chat_template", "{{ other }}", "template"),
])
def test_metadata_hash_partitions(tmp_path, key, new, changed):
    original = write_gguf(tmp_path / "original.gguf")
    metadata = [(k, t, new if k == key else v) for k, t, v in METADATA]
    modified = write_gguf(tmp_path / "modified.gguf", metadata=metadata)
    before, after = hashes(original), hashes(modified)
    assert {k for k in before if before[k] != after[k]} == {changed}
    assert derive(original).key() != derive(modified).key()


@pytest.mark.parametrize("tensor", [
    ("changed.weight", (2, 2), 0, 0), ("first.weight", (4,), 0, 0),
    ("first.weight", (1, 2), 0, 0), ("first.weight", (2, 2), 1, 0),
    ("first.weight", (2, 2), 0, 32),
])
def test_tensor_layout_changes(tmp_path, tensor):
    before = write_gguf(tmp_path / "before.gguf")
    after = write_gguf(tmp_path / "after.gguf", tensors=[tensor, TENSORS[1]])
    assert hashes(before)["layout"] != hashes(after)["layout"]
    assert hashes(before)["metadata"] == hashes(after)["metadata"]


@pytest.mark.parametrize("cut", [0, 3, 7, 23, 35, 100, -49])
def test_truncated_header(tmp_path, cut):
    path = write_gguf(tmp_path / "m.gguf")
    path.write_bytes(path.read_bytes()[:cut])
    with pytest.raises(ValueError):
        identity.read_gguf_header(path)


@pytest.mark.parametrize("wire", [
    b"NOPE" + struct.pack("<IQQ", 3, 0, 0),
    b"GGUF" + struct.pack("<IQQ", 1, 0, 0),
    b"GGUF" + struct.pack("<IQQ", 3, 2**64 - 1, 0),
    b"GGUF" + struct.pack("<IQQ", 3, 0, 2**64 - 1),
    b"GGUF" + struct.pack("<IQQQ", 3, 0, 1, 2**64 - 1),
    b"GGUF" + struct.pack("<IQQ", 3, 0, 1) + string("x") + struct.pack("<I", 99),
    b"GGUF" + struct.pack("<IQQ", 3, 0, 1) + string("x") + struct.pack("<IB", 7, 2),
    b"GGUF" + struct.pack("<IQQ", 3, 0, 1) + string("x") + struct.pack("<IIQ", 9, 8, 2**64 - 1),
    b"GGUF" + struct.pack("<IQQ", 3, 0, 1) + string("x") + struct.pack("<IIQ", 9, 9, 0),
    b"GGUF" + struct.pack("<IQQ", 3, 0, 1) + struct.pack("<Q", 1) + b"\xff",
])
def test_bad_or_oversized_wire(tmp_path, wire):
    path = tmp_path / "bad.gguf"
    path.write_bytes(wire)
    with pytest.raises(ValueError):
        identity.read_gguf_header(path)


@pytest.mark.parametrize("metadata,tensors", [
    (METADATA + [METADATA[0]], TENSORS),
    (METADATA + [("", 8, "bad")], TENSORS),
    (METADATA + [("number", 6, float("nan"))], TENSORS),
    ([k for k in METADATA if k[0] != "general.alignment"] + [("general.alignment", 4, 3)], TENSORS),
    ([k for k in METADATA if k[0] != "general.alignment"] + [("general.alignment", 7, True)], TENSORS),
    (METADATA, [TENSORS[0], TENSORS[0]]),
    (METADATA, [("x", (), 0, 0)]),
    (METADATA, [("x", (0,), 0, 0)]),
    (METADATA, [("x", (1, 1, 1, 1, 1), 0, 0)]),
    (METADATA, [("x", (1,), 0, 1)]),
    (METADATA, [("x", (1,), 0, 4096)]),
    (METADATA, [("x", (1,), 999, 0)]),
])
def test_malformed_metadata_and_tensors(tmp_path, metadata, tensors):
    with pytest.raises(ValueError):
        identity.read_gguf_header(write_gguf(tmp_path / "bad.gguf", metadata=metadata, tensors=tensors))


@pytest.mark.parametrize("limit,value", [("MAX_HEADER_BYTES", 128), ("MAX_STRING_BYTES", 3),
                                        ("MAX_ARRAY_LENGTH", 1), ("MAX_VALUES", 1)])
def test_resource_limits(tmp_path, monkeypatch, limit, value):
    path = write_gguf(tmp_path / "m.gguf")
    monkeypatch.setattr(identity, limit, value)
    with pytest.raises(ValueError):
        identity.read_gguf_header(path)


def test_header_reader_never_reads_tensor_data(tmp_path, monkeypatch):
    path = write_gguf(tmp_path / "m.gguf")
    boundary = identity.read_gguf_header(path).data_offset
    original = identity._Reader.read

    def guarded_read(self, size):
        assert self.f.tell() + size <= boundary
        return original(self, size)

    monkeypatch.setattr(identity._Reader, "read", guarded_read)
    assert identity.read_gguf_header(path).data_offset == boundary


def test_samples_and_full_hash(tmp_path, monkeypatch):
    path = write_gguf(tmp_path / "m.gguf")
    header = identity.read_gguf_header(path)
    raw = path.read_bytes()
    sample_digest = hashlib.sha256(raw[header.data_offset:]).digest()
    expected = hashlib.sha256(raw[:header.data_offset] + struct.pack("<Q", len(raw)) + sample_digest * 3)
    assert identity.weights_sample_sha256(path) == expected.hexdigest()
    assert derive(path, full_hash=True).model_sha256 == hashlib.sha256(raw).hexdigest()
    # Small chunk limits prove the opt-in full hash streams across multiple reads.
    monkeypatch.setattr(identity, "FULL_HASH_CHUNK_BYTES", 17)
    assert derive(path, full_hash=True).model_sha256 == hashlib.sha256(raw).hexdigest()
    changed = bytearray(raw)
    changed[-1] ^= 1
    path.write_bytes(changed)
    assert identity.weights_sample_sha256(path) != expected.hexdigest()


@pytest.mark.parametrize("fraction", [0, 0.5, 1])
def test_each_fixed_sample_changes_fingerprint(tmp_path, fraction):
    # A sparse synthetic payload avoids model-sized reads or allocations.
    path = write_gguf(tmp_path / "m.gguf")
    header = identity.read_gguf_header(path)
    size = 5 * identity.SAMPLE_BYTES
    with path.open("r+b") as f:
        f.truncate(header.data_offset + size)
    before = identity.weights_sample_sha256(path)
    relative = int(fraction * size) if fraction < 1 else size - 1
    with path.open("r+b") as f:
        f.seek(header.data_offset + relative)
        f.write(b"x")
    assert identity.weights_sample_sha256(path) != before


def test_runtime_commit_none_safe(tmp_path, monkeypatch):
    path = write_gguf(tmp_path / "m.gguf")

    def unavailable(*args, **kwargs):
        raise FileNotFoundError("git unavailable")

    monkeypatch.setattr(identity.subprocess, "run", unavailable)
    assert derive(path, runtime_commit=None).runtime_commit is None
    assert derive(path).runtime_commit == "runtime-test"


def test_default_reads_only_fixed_samples_and_size_matters(tmp_path, monkeypatch):
    path = write_gguf(tmp_path / "m.gguf")
    header = identity.read_gguf_header(path)
    data_size = 5 * identity.SAMPLE_BYTES
    with path.open("r+b") as f:
        f.truncate(header.data_offset + data_size)
    sample_ranges = [(header.data_offset + p, identity.SAMPLE_BYTES)
                     for p in (0, data_size // 2, data_size - identity.SAMPLE_BYTES)]
    payload_reads = []

    class SampleGuard:
        def __init__(self, *args, **kwargs):
            self.f = open(*args, **kwargs)

        def __enter__(self):
            return self

        def __exit__(self, *args):
            self.f.close()

        def __getattr__(self, name):
            return getattr(self.f, name)

        def read(self, size):
            position = self.f.tell()
            assert size >= 0
            if position + size > header.data_offset:
                assert (position, size) in sample_ranges
                payload_reads.append(size)
            return self.f.read(size)

    with monkeypatch.context() as patch:
        patch.setattr(identity, "open", SampleGuard, raising=False)
        first = derive(path)
    assert sum(payload_reads) == 3 * identity.SAMPLE_BYTES
    # An unsampled change can escape the fast fingerprint, as documented.
    with path.open("r+b") as f:
        f.seek(header.data_offset + identity.SAMPLE_BYTES + 1)
        f.write(b"x")
    assert derive(path) == first
    with path.open("r+b") as f:
        f.truncate(header.file_size + data_size + 1)
    assert derive(path).model_sha256 != first.model_sha256


def test_kv_identity_is_explicitly_unverified(tmp_path):
    path = write_gguf(tmp_path / "m.gguf")
    result = identity.kv_identity(path, **OPTIONS)
    fields = {"model_weights_hash", "gguf_metadata_hash", "tokenizer_hash", "chat_template_hash",
              "runtime_build_hash", "backend_name", "backend_kernel_config", "rope_config_hash",
              "kv_layout_hash", "kv_dtype", "attention_config_hash", "context_length"}
    assert fields <= result.keys()
    assert set(result["unverified_fields"]) == {k for k in fields if result[k] is None}
    assert result["model_weights_hash"] is None and result["runtime_build_hash"] is None
    assert result["backend_name"] == "rocm" and result["context_length"] == 4096
    assert result["weights_sample_sha256"] == derive(path).extra["weights_sample_sha256"]
    full = identity.kv_identity(path, **OPTIONS, full_hash=True)
    assert full["model_weights_hash"] == hashlib.sha256(path.read_bytes()).hexdigest()
    assert "model_weights_hash" not in full["unverified_fields"]
    no_tokenizer = write_gguf(tmp_path / "bare.gguf", metadata=METADATA[:3])
    result = identity.kv_identity(no_tokenizer, **{**OPTIONS, "kv_dtype": None})
    assert {"tokenizer_hash", "chat_template_hash", "kv_dtype"} <= set(result["unverified_fields"])


def cli(*args):
    return subprocess.run([sys.executable, "-m", "deepinfer_ds4", *args], cwd=PKG,
                          capture_output=True, text=True)


def test_cli_identity_profile_roundtrip_and_kv(tmp_path):
    path = write_gguf(tmp_path / "m.gguf")
    args = ("identity", "--model", str(path), "--backend", "rocm", "--device-id", "gfx1151",
            "--context-length", "4096", "--mtp-max", "5", "--kv-dtype", "f16",
            "--config-label", "baseline", "--runtime-commit", "r1", "--overlay-commit", "o1")
    r = cli(*args)
    assert r.returncode == 0, r.stderr
    result = json.loads(r.stdout)
    assert result["model_sha256"].startswith("sample:") and result["config_label"] == "baseline"
    ident = tmp_path / "identity.json"
    ident.write_text(r.stdout)
    csv = tmp_path / "bench.csv"
    csv.write_text(",".join(bench_ingest.EXPECTED_HEADER) + "\n4096,4096,500,128,20,100,127,20,1024\n")
    store = tmp_path / "store"
    r = cli("profile", "write", "--dir", str(store), "--identity", str(ident), "--csv", str(csv))
    assert r.returncode == 0 and json.loads(r.stdout)["key"] == PerfIdentity.from_dict(result).key()
    r = cli("profile", "show", "--dir", str(store), "--identity", str(ident))
    assert json.loads(r.stdout)["profile"]["identity"] == result
    r = cli(*args, "--kv")
    assert r.returncode == 0 and json.loads(r.stdout)["model_weights_hash"] is None
    r = cli(*args, "--full-hash")
    assert json.loads(r.stdout)["model_sha256"] == hashlib.sha256(path.read_bytes()).hexdigest()
    r = cli(*args[:args.index("--kv-dtype")])
    assert r.returncode == 0 and json.loads(r.stdout)["kv_dtype"] is None
    path.write_bytes(b"bad magic")
    r = cli(*args)
    assert r.returncode == 2 and not r.stdout and "GGUF" in r.stderr


@pytest.mark.skipif(not MODEL.is_file(), reason="optional local DSpark GGUF absent")
def test_local_dspark_header_smoke():
    header = identity.read_gguf_header(MODEL)
    assert header.metadata.get("general.architecture")
    assert header.tensors
