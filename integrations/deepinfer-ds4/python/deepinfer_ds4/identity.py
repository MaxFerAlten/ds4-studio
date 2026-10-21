# Part of DS4-Studio DeepInfer integration (plan §3.1, §7.1, §11).
"""Offline GGUF identity; sampled weights are never a full content hash.

The header reader stops at the aligned tensor-data boundary. Identity derivation
additionally reads three bounded samples; only full_hash=True scans all weights.
No identity here proves runtime KV compatibility or verifies a model manifest.
"""

from __future__ import annotations

import hashlib
import json
import math
import os
import struct
import subprocess
from collections import Counter
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, BinaryIO

from .perf_profile import PerfIdentity

MAX_HEADER_BYTES = 256 * 1024 * 1024
MAX_STRING_BYTES = 16 * 1024 * 1024
MAX_ARRAY_LENGTH = 1_000_000
MAX_ITEMS = 1_000_000
MAX_VALUES = 2_000_000
SAMPLE_BYTES = 1024 * 1024
FULL_HASH_CHUNK_BYTES = 8 * 1024 * 1024

# GGUF metadata types 0..12; ARRAY (9) is handled separately.
VALUE_FORMATS = {0: "B", 1: "b", 2: "H", 3: "h", 4: "I", 5: "i",
                 6: "f", 7: "B", 10: "Q", 11: "q", 12: "d"}
GGML_TYPE_NAMES = {
    0: "F32", 1: "F16", 2: "Q4_0", 3: "Q4_1", 6: "Q5_0", 7: "Q5_1",
    8: "Q8_0", 9: "Q8_1", 10: "Q2_K", 11: "Q3_K", 12: "Q4_K",
    13: "Q5_K", 14: "Q6_K", 15: "Q8_K", 16: "IQ2_XXS", 17: "IQ2_XS",
    18: "IQ3_XXS", 19: "IQ1_S", 20: "IQ4_NL", 21: "IQ3_S", 22: "IQ2_S",
    23: "IQ4_XS", 24: "I8", 25: "I16", 26: "I32", 27: "I64", 28: "F64",
    29: "IQ1_M", 30: "BF16", 31: "Q4_0_4_4", 32: "Q4_0_4_8",
    33: "Q4_0_8_8", 34: "TQ1_0", 35: "TQ2_0", 36: "IQ4_NL_4_4",
    37: "IQ4_NL_4_8", 38: "IQ4_NL_8_8", 39: "MXFP4", 40: "NVFP4",
    41: "Q1_0",
}


@dataclass(frozen=True)
class TensorInfo:
    name: str
    n_dims: int
    dims: tuple[int, ...]
    type: int
    offset: int


@dataclass(frozen=True)
class GGUFHeader:
    version: int
    metadata: dict[str, Any]
    value_types: dict[str, tuple[int, ...]]
    tensors: tuple[TensorInfo, ...]
    data_offset: int
    file_size: int

    @property
    def tensor_count(self) -> int:
        return len(self.tensors)

    @property
    def kv_count(self) -> int:
        return len(self.metadata)


class _Reader:
    def __init__(self, f: BinaryIO):
        self.f = f
        self.file_size = os.fstat(f.fileno()).st_size
        self.endian = "<"
        self.values_left = MAX_VALUES

    def read(self, size: int) -> bytes:
        end = self.f.tell() + size
        if size < 0 or end > MAX_HEADER_BYTES:
            raise ValueError("GGUF header exceeds byte limit")
        if end > self.file_size:
            raise ValueError("truncated GGUF header")
        data = self.f.read(size)
        if len(data) != size:
            raise ValueError("truncated GGUF header")
        return data

    def number(self, fmt: str) -> Any:
        return struct.unpack(self.endian + fmt, self.read(struct.calcsize(fmt)))[0]

    def string(self) -> str:
        size = self.number("Q")
        if size > MAX_STRING_BYTES:
            raise ValueError("GGUF string exceeds size limit")
        try:
            return self.read(size).decode("utf-8")
        except UnicodeDecodeError as e:
            raise ValueError("invalid UTF-8 in GGUF string") from e

    def scalar(self, kind: int) -> Any:
        if self.values_left == 0:
            raise ValueError("too many GGUF metadata values")
        self.values_left -= 1
        if kind == 8:
            return self.string()
        if kind not in VALUE_FORMATS:
            raise ValueError(f"invalid GGUF value type {kind}")
        value = self.number(VALUE_FORMATS[kind])
        if kind == 7:
            if value not in (0, 1):
                raise ValueError("invalid GGUF boolean")
            return bool(value)
        if isinstance(value, float) and not math.isfinite(value):
            raise ValueError("nonfinite GGUF metadata value")
        return value

    def value(self, kind: int) -> tuple[Any, tuple[int, ...]]:
        if kind != 9:
            return self.scalar(kind), (kind,)
        element_type, count = self.number("I"), self.number("Q")
        if element_type not in VALUE_FORMATS and element_type != 8:
            raise ValueError("invalid GGUF array element type (nested arrays forbidden)")
        if count > MAX_ARRAY_LENGTH or count > self.values_left:
            raise ValueError("GGUF array exceeds size limit")
        return [self.scalar(element_type) for _ in range(count)], (kind, element_type)


def _read_header(f: BinaryIO) -> GGUFHeader:
    r = _Reader(f)
    magic = r.read(4)
    if magic not in (b"GGUF", b"FUGG"):
        raise ValueError("invalid GGUF magic")
    version_bytes = r.read(4)
    version = struct.unpack("<I", version_bytes)[0]
    if version not in (2, 3):
        r.endian = ">"
        version = struct.unpack(">I", version_bytes)[0]
        if version != 3:
            raise ValueError("unsupported GGUF version or byte order")
    if magic == b"FUGG" and r.endian != ">":
        raise ValueError("invalid GGUF byte order")
    tensor_count, kv_count = r.number("Q"), r.number("Q")
    if tensor_count > MAX_ITEMS or kv_count > MAX_ITEMS:
        raise ValueError("too many GGUF tensors or metadata entries")
    metadata, value_types = {}, {}
    for _ in range(kv_count):
        key = r.string()
        if not key or key in metadata:
            raise ValueError("empty or duplicate GGUF metadata key")
        metadata[key], value_types[key] = r.value(r.number("I"))
    alignment = metadata.get("general.alignment", 32)
    if ("general.alignment" in metadata and value_types["general.alignment"] != (4,)) or \
            not isinstance(alignment, int) or alignment <= 0 or alignment & (alignment - 1):
        raise ValueError("invalid GGUF alignment")
    tensors, names = [], set()
    for _ in range(tensor_count):
        name, n_dims = r.string(), r.number("I")
        if not name or name in names or len(name.encode("utf-8")) > 64:
            raise ValueError("invalid or duplicate GGUF tensor name")
        names.add(name)
        if not 1 <= n_dims <= 4:
            raise ValueError("invalid GGUF tensor dimension count")
        dims = tuple(r.number("Q") for _ in range(n_dims))
        if any(d == 0 for d in dims):
            raise ValueError("invalid GGUF tensor dimensions")
        kind, offset = r.number("I"), r.number("Q")
        if kind not in GGML_TYPE_NAMES:
            raise ValueError(f"unsupported GGML tensor type {kind}")
        if offset % alignment:
            raise ValueError("unaligned GGUF tensor offset")
        tensors.append(TensorInfo(name, n_dims, dims, kind, offset))
    data_offset = (f.tell() + alignment - 1) // alignment * alignment
    r.read(data_offset - f.tell())
    if any(t.offset >= r.file_size - data_offset for t in tensors):
        raise ValueError("GGUF tensor offset outside file")
    return GGUFHeader(version, metadata, value_types, tuple(tensors), data_offset, r.file_size)


def read_gguf_header(model_path: str | os.PathLike[str]) -> GGUFHeader:
    """Read only the bounded header and alignment padding, never tensor data."""
    with open(model_path, "rb", buffering=0) as f:
        return _read_header(f)


def _json_hash(obj: Any) -> str:
    digest = hashlib.sha256()
    encoder = json.JSONEncoder(sort_keys=True, separators=(",", ":"), allow_nan=False)
    for chunk in encoder.iterencode(obj):
        digest.update(chunk.encode("utf-8"))
    return digest.hexdigest()


def _metadata_hash(header: GGUFHeader, keys: list[str]) -> str:
    # Include value types, including empty-array element types, in the encoding.
    return _json_hash({k: [header.value_types[k], header.metadata[k]] for k in keys})


def gguf_metadata_hash(header: GGUFHeader) -> str:
    return _metadata_hash(header, [k for k in header.metadata if not k.startswith("tokenizer.")])


def tokenizer_hash(header: GGUFHeader) -> str | None:
    keys = [k for k in header.metadata if k.startswith("tokenizer.") and k != "tokenizer.chat_template"]
    return _metadata_hash(header, keys) if keys else None


def chat_template_hash(header: GGUFHeader) -> str | None:
    key = "tokenizer.chat_template"
    return _metadata_hash(header, [key]) if key in header.metadata else None


def tensor_layout_hash(header: GGUFHeader) -> str:
    return _json_hash([asdict(t) for t in header.tensors])


def quantization(header: GGUFHeader) -> str:
    counts = Counter(t.type for t in header.tensors)
    return ",".join(f"{GGML_TYPE_NAMES[t]}:{counts[t]}" for t in sorted(counts))


def _sample_hash(f: BinaryIO, header: GGUFHeader) -> str:
    digest = hashlib.sha256()
    f.seek(0)
    remaining = header.data_offset
    while remaining:
        chunk = f.read(min(SAMPLE_BYTES, remaining))
        if not chunk:
            raise ValueError("GGUF changed during identity derivation")
        digest.update(chunk)
        remaining -= len(chunk)
    digest.update(struct.pack("<Q", header.file_size))
    data_size = header.file_size - header.data_offset
    sample_size = min(SAMPLE_BYTES, data_size)
    # Clamp the middle window for small files. Small samples may overlap.
    offsets = (0, min(data_size // 2, data_size - sample_size), data_size - sample_size)
    for offset in offsets:
        f.seek(header.data_offset + offset)
        sample = f.read(sample_size)
        if len(sample) != sample_size:
            raise ValueError("GGUF changed during identity derivation")
        digest.update(hashlib.sha256(sample).digest())
    return digest.hexdigest()


def weights_sample_sha256(model_path: str | os.PathLike[str]) -> str:
    """Fast header + file size + three sample digests; NOT a full weights hash."""
    with open(model_path, "rb", buffering=0) as f:
        return _sample_hash(f, _read_header(f))


def _runtime_commit() -> str | None:
    try:
        result = subprocess.run(["git", "-C", str(Path(__file__).resolve().parents[4]),
                                 "rev-parse", "HEAD"], check=True, capture_output=True,
                                text=True, timeout=5)
        return result.stdout.strip() or None
    except (OSError, subprocess.SubprocessError):
        return None


def build_perf_identity(model_path: str | os.PathLike[str], *, backend: str, device_id: str,
                        context_length: int, mtp_max: int, kv_dtype: str | None = None,
                        runtime_commit: str | None = None, overlay_commit: str | None = None,
                        config_label: str = "", full_hash: bool = False) -> PerfIdentity:
    with open(model_path, "rb", buffering=0) as f:
        header = _read_header(f)
        sample_hash = _sample_hash(f, header)
        model_hash = "sample:" + sample_hash
        if full_hash:
            digest = hashlib.sha256()
            f.seek(0)
            while chunk := f.read(FULL_HASH_CHUNK_BYTES):
                digest.update(chunk)
            model_hash = digest.hexdigest()
        if os.fstat(f.fileno()).st_size != header.file_size:
            raise ValueError("GGUF size changed during identity derivation")
    return PerfIdentity.from_dict(dict(
        model_sha256=model_hash,
        runtime_commit=_runtime_commit() if runtime_commit is None else runtime_commit,
        overlay_commit=overlay_commit, backend=backend, device_id=device_id,
        quantization=quantization(header), context_length=context_length, kv_dtype=kv_dtype,
        mtp_max=mtp_max, config_label=config_label,
        extra={"gguf_metadata_hash": gguf_metadata_hash(header),
               "tokenizer_hash": tokenizer_hash(header), "chat_template_hash": chat_template_hash(header),
               "tensor_layout_hash": tensor_layout_hash(header), "gguf_version": header.version,
               "general.architecture": header.metadata.get("general.architecture"),
               "file_size": header.file_size, "weights_sample_sha256": sample_hash}))


def kv_identity(model_path: str | os.PathLike[str], **kwargs: Any) -> dict[str, Any]:
    """Plan §7.1 offline fields. A source commit does not identify a runtime build.

    RoPE/attention metadata alone cannot prove effective runtime settings; tensor
    layout does not describe the KV layout. No cache compatibility is asserted.
    """
    ident = build_perf_identity(model_path, **kwargs)
    out = dict(model_weights_hash=None if ident.model_sha256.startswith("sample:") else ident.model_sha256,
               gguf_metadata_hash=ident.extra["gguf_metadata_hash"],
               tokenizer_hash=ident.extra["tokenizer_hash"],
               chat_template_hash=ident.extra["chat_template_hash"], runtime_build_hash=None,
               backend_name=ident.backend, backend_kernel_config=None, rope_config_hash=None,
               kv_layout_hash=None, kv_dtype=ident.kv_dtype, attention_config_hash=None,
               context_length=ident.context_length)
    out["unverified_fields"] = sorted(k for k, v in out.items() if v is None)
    out["weights_sample_sha256"] = ident.extra["weights_sample_sha256"]
    return out
