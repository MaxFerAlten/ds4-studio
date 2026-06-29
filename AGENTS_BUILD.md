# Build Notes for AI Agents

## ROCm Header Priority (`Makefile` line 47)

**Do NOT use `-I` for HIP headers.** clang's `-x hip` mode **ignores `-I` flags** when resolving `#include <hip/*.h>`. It only respects `-cxx-isystem` (C++), `-isystem` (C), and internal system paths.

The system has a conflicting `libamdhip64-dev` (ROCm 5.7.1) that puts headers in `/usr/include/hip/`. The real ROCm 7.2.4 lives in `/opt/rocm-7.2.4/`.

**Rule**: Always use `-cxx-isystem /opt/rocm-7.2.4/include` in `ROCM_CFLAGS`. This gives priority to ROCm 7.2.4 headers over the system-installed old ones.

Current flags:
```
ROCM_CFLAGS = -I/tmp/rocm-headers -cxx-isystem /opt/rocm-7.2.4/include ...
```

## `ds4` GPU Target Missing Objects (`Makefile` line 141)

The `ds4` target under the GPU (CUDA/ROCm) section was missing `ds4_crawl_grounding.o` in its prerequisites. The Metal (`macOS`) variant at line 77 has it. If you add or remove object files, always update **both** the Metal and GPU targets.

Current GPU target:
```
ds4: ds4_cli.o ds4_help.o ds4_crawl_grounding.o linenoise.o $(CORE_OBJS)
```

## Build Commands

| Command | What it does |
|---------|-------------|
| `./srun.sh build` | Full ROCm build + frontend |
| `./srun.sh build be` | ROCm binaries only |
| `make rocm` | ROCm build via recursive strix-halo |
| `make strix-halo` | Same as above (alias) |

## Adding New `.o` Files

If you add a new `.c` file that compiles with `$(CC) $(CFLAGS)`:
- Add it to the relevant target(s) under both the **Metal** section (lines 77-93) and the **GPU** section (lines 141-157)
- Add a compilation rule with the correct dependencies in the object-file rules section (lines 170+)

## Memory / OOM on Strix Halo (ROCm 7.2.4, 128 GiB unified)

Symptom: `ds4: CUDA tensor alloc failed: out of memory` (printed by `cuda_ok`,
`ds4_cuda.cu:713`; HIP shim → reads as "ROCm"). Swap does **not** help — GPU
memory is GTT/`hipMalloc`, TTM-pinned, non-swappable.

Root cause (regression after the ROCm 7.2.4 update): the device-tensor path
(`DS4_SERVER_DEVICE_TENSORS=1` + `DS4_SERVER_COPY_MODEL=1`, plus
`HSA_USE_SVM=0` added in `rocm_settings.sh:222` to dodge SVM hang
ROCm/TheRock #2684) copies the **80.8 GiB** model into GTT *on top of* the
80 GiB host mmap → ~160 GiB on a 124 GiB box → RAM hits 0 available, 28 GiB
swap, next alloc OOMs.

Fix: managed/no-copy path. `scripts/rocm_settings.sh:40-41` defaults now
`DS4_SERVER_DEVICE_TENSORS=0` + `DS4_SERVER_COPY_MODEL=0`. **Both** are needed
— `DEVICE_TENSORS=0` alone leaves `COPY_MODEL=1`, still pins 80 GiB. Note the
copy gate is `copy_env && copy_env[0]` (`ds4_cuda.cu:1580`): value `"0"` is
truthy → only unset/empty disables; `export_pair_flag` only exports when value
is exactly `"1"`, so `DS4_SERVER_COPY_MODEL=0` correctly leaves it unset.
(`ds4_rocm_apply_quality_decode_defaults`, which would force
`DS4_CUDA_COPY_MODEL=1`, is dead code — no caller.)

KV cache cost (managed path, this model — 43 layers, ratio4×21/ratio128×20,
HEAD_DIM=512, INDEXER_DIM=128, comp cache float 4B since
`DS4_GPU_ATTN_COMP_CACHE_F16=0` off-Apple): **13.44 KiB/token**
(`13760 B/tok`, formula `metal_graph_kv_cache_bytes_for_context`,
`ds4.c:10696`). Model stays pinned at 80.8 GiB (`cudaHostRegister`,
`ds4_cuda.cu:1604`). Budget = 124 − 80.8 − ~8 (scratch) − ~12 (headroom):

| ctx | KV | resident |
|----:|---:|---------:|
| 550K | 7.1 GiB | 96 GiB |
| 1.0M | 12.8 GiB | 102 GiB |
| 1.81M | 23.2 GiB | 112 GiB ← mem-safe ceiling |

Context is not the binding limit; the model copy was. Verify with
`watch -n2 free -g` during a long prefill.

## Static Analysis / Format

The C codebase uses:
- C99 (`-std=c99`)
- ClangFormat-like style (no autoformatter enforced)
- No comments in code unless strictly necessary
- Linting via `-Wall -Wextra`
