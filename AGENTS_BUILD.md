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

## Static Analysis / Format

The C codebase uses:
- C99 (`-std=c99`)
- ClangFormat-like style (no autoformatter enforced)
- No comments in code unless strictly necessary
- Linting via `-Wall -Wextra`
