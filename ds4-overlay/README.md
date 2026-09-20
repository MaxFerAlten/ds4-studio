# ds4-overlay

A detachable downstream overlay for [antirez/ds4](https://github.com/antirez/ds4).

Upstream is a **read-only input**. Nothing here ever writes to it. The build
composes a *shadow tree* — symlinks for the files nobody touches, real copies
for the few that get patched — and compiles there.

```
/mnt/crucial_ai/COPARATOR/
├── new-ds4-studio/             UPSTREAM, READ-ONLY to the overlay
│   └── ds4-overlay/            this directory (skipped by compose and verify)
└── new-ds4-studio-build/       overlay.toml [paths] build
    └── <sha>/src/              generated shadow tree, never inside upstream
```

Read [docs/FINDINGS.md](docs/FINDINGS.md) first: the delta this overlay carries
is much smaller than the original plan assumed, because upstream has since
landed DeepSeek v4.1 Flash support.

## Use

```bash
./scripts/overlayctl.py status          # upstream sha, features, anchor health
./scripts/overlayctl.py compose         # build the shadow tree
./scripts/overlayctl.py build --target strix-halo
./scripts/overlayctl.py test  --suite deepseek41
./scripts/overlayctl.py rebase-check    # after a git pull
./scripts/overlayctl.py clean
```

## Why it is safe

Four properties, each with a test that fails if it stops being true
(`tests/run_all.sh`):

| property | enforced by |
|---|---|
| upstream is never written | `verify_upstream_clean.py`, git **and** SHA-256 manifest |
| patch targets never share an inode with upstream | real `copy2`, never a hardlink |
| an anchor that stops matching stops the build | `compose_shadow.py`, exit 2 |
| patches never apply approximately | `git apply --check`; no `--3way`, `--reject` or fuzz |

`temp/` is outside the contract entirely: never read, copied, or patched.

## Features

Each lives in `features/<id>/feature.toml` with anchors, patches, overlay files
and tests.

| feature | state | carries |
|---|---|---|
| `accelerator-span-bounds` | on | bounds-check every tensor, not only Q8_0 2-D — what rejects disk-only V4.1 descriptors |
| `rocm-disk-only-engram` | on | validated Engram exemption on ROCm instead of upstream's name-only check |
| `rocm-vision-alpha-precision` | on | `rsqrtf` → `1.0f/sqrtf`; required, `rsqrtf` is `__device__`-only on ROCm 7.2.4 |
| `rocm-strix-halo` | on | `ds4_rocm.cu` hook + `ds4_rocm_v41.cuh` + `ds4_rocm_hc_sgemm.cuh` |
| `cuda-mmq-v41` | on | MMQ tier additions for the V4.1 quantised paths |
| `vision-gpu-v41` | on | DeepSeek 4.1 vision GPU path |
| `engram-rocm` | on | Engram disk-row handling for ROCm |
| `deepseek41-harness` | on | three downstream-only V4.1 test harnesses |
| `docs-strix-halo` | on | Strix Halo operational docs |
| `dsv41-expert-streaming` | **off** | expert-streaming callers; incomplete, see `docs/FINDINGS.md` §6 |

Verified on this machine: both branches of `test_deepseek41_cache_spans` pass,
and `ds4_rocm.o` compiles clean under ROCm 7.2.4 / gfx1151.

## Retiring a feature

When upstream ships something the overlay carries, a text probe is **not** a
decision (plan §21):

```bash
./scripts/overlayctl.py retire-check      rocm-strix-halo   # probe only, advisory
./scripts/overlayctl.py pure-upstream-test rocm-strix-halo  # compose without it, run its tests
```

Only a green pure-upstream run justifies `enabled = false`. A feature with no
declared tests cannot be retired safely, and `retire_feature.py` says so.

## Layout

```
overlay.toml        global manifest and policy flags
mk/overlay.mk       additive make rules, included after the upstream Makefile
features/           one feature.toml per feature
patches/            shadow patches, organised per feature
src/                overlay-owned sources (installed into the shadow)
tests/              the overlay toolchain's own tests
scripts/            overlayctl, compose, verify, diff, retire
docs/FINDINGS.md    reconnaissance report
```
