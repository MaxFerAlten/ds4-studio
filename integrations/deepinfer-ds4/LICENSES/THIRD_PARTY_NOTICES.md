# Third-party notices

## DeepInfer

- Source: https://github.com/deepseek-ai/DeepInfer, commit `9bd9cf243fc53ef9afbf8f04d391d989117d6ab9`
- License: Apache License 2.0 (full text: `DeepInfer-LICENSE.txt`)
- DeepInfer ships no NOTICE file at this commit.

Files in this directory derived from DeepInfer (Apache-2.0 §4(b): modified files
carry a prominent notice in their header):

| DS4-Studio file | Derived from | Change |
|---|---|---|
| `c/src/ds4di_spec_policy.c`, `c/include/ds4di_spec_policy.h` | `csrc/engine/mtp_varlen.hpp` | Ported from C++/libtorch to dependency-free C11; single rate history (no async ZOS pipeline in DS4) |
| `python/deepinfer_ds4/perf_profile.py` | `deepinfer/worker/decode_perf_cache.py` | No torch.distributed; extended identity, digest, 0600 perms, flock, dir fsync |

No DeepInfer code is compiled into `ds4`, `ds4-server`, `ds4-agent` or `ds4-wrapper`.
No CUDA/Ascend/TileLang component is copied.

## deepseek-recipe

- Source: https://github.com/deepseek-ai/deepseek-recipe, commit `935817c66f5d6e64838f419692545f06787e485f`
- License: MIT (full text: `deepseek-recipe-LICENSE.txt`)
- Used as a Cargo path dependency by `recipe-adapter/` (crates `deepseek-recipe`,
  `deepseek-recipe-encoding`); no recipe source is copied into this directory.
  Transitive crates and versions are pinned in `recipe-adapter/Cargo.lock`; the
  bundled tokenizer files under recipe's `static/tokenizers/` are not used.
- The adapter is a standalone process; it is not linked into `ds4`, `ds4-server`,
  `ds4-agent` or `ds4-wrapper`.
