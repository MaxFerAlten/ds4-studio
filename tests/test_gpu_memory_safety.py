"""Host-only regression checks for GPU model bounds and teardown order."""

import os
from pathlib import Path
import re
import shlex
import subprocess
import tempfile


ROOT = Path(__file__).resolve().parents[1]


def extract(source, signature):
    for match in re.finditer(signature, source):
        opening = source.index("{", match.start())
        semicolon = source.find(";", match.start(), opening)
        if semicolon < 0:
            break
    else:
        raise AssertionError(f"missing production function: {signature}")
    depth = 0
    for pos in range(opening, len(source)):
        if source[pos] == "{":
            depth += 1
        elif source[pos] == "}":
            depth -= 1
            if depth == 0:
                return source[match.start():pos + 1]
    raise AssertionError(f"unterminated production function: {signature}")


def main():
    cuda_source = (ROOT / "ds4_cuda.cu").read_text()
    span_fits = extract(cuda_source, r"static bool cuda_model_span_fits\s*\(")
    resolver = extract(cuda_source, r"static const char \*cuda_model_range_ptr\s*\(")
    guard = "cuda_model_span_fits(g_model_registered_size, offset, bytes)"
    assert guard in resolver
    assert resolver.index(guard) < resolver.index("cuda_model_ptr(model_map, offset)")

    rocm_source = (ROOT / "rocm" / "ds4_rocm_runtime.cuh").read_text()
    range_fits = extract(rocm_source, r"static int cuda_model_range_fits\s*\(")
    resolver = extract(rocm_source, r"static const char \*cuda_model_range_ptr\s*\(")
    guard = "cuda_model_range_fits(g_model_registered_size, offset, bytes)"
    assert guard in resolver
    assert resolver.index(guard) < resolver.index("cuda_model_ptr(model_map, offset)")

    code = """
#include <assert.h>
#include <stdint.h>
""" + span_fits + range_fits + """
int main() {
    assert(cuda_model_span_fits(100, 99, 1));
    assert(!cuda_model_span_fits(100, 99, 2));
    assert(!cuda_model_span_fits(UINT64_MAX, UINT64_MAX - 1, 3));
    assert(cuda_model_range_fits(100, 99, 1));
    assert(!cuda_model_range_fits(100, 99, 2));
    assert(!cuda_model_range_fits(UINT64_MAX, UINT64_MAX - 1, 3));
    return 0;
}
"""
    compiler = shlex.split(os.environ.get("CXX", "c++"))
    with tempfile.TemporaryDirectory(prefix="ds4-gpu-memory-safety-") as tmp:
        source = Path(tmp) / "span.cc"
        binary = Path(tmp) / "span"
        source.write_text(code)
        subprocess.run(compiler + ["-std=c++17", "-Wall", "-Wextra", "-Werror",
                                   str(source), "-o", str(binary)], check=True)
        subprocess.run([str(binary)], check=True)

    close = extract((ROOT / "ds4.c").read_text(), r"void ds4_engine_close\s*\(")
    shutdown = close.index("ds4_threads_shutdown()")
    cleanup = close.index("ds4_gpu_cleanup()")
    assert shutdown < cleanup
    for release in ("weights_free(", "vocab_free(", "model_close("):
        assert cleanup < close.index(release)

    print("GPU model bounds and teardown order: PASS")


if __name__ == "__main__":
    main()
