# Reconnaissance findings — executing `piano.overlay.md`

Date: 2026-09-14. Upstream at `9139e2ae`, downstream reference `kyuz0/ds4` at `006b3c12`.

The plan instructs (§20) to verify every symbol against the live tree and to stop
and report rather than guess. Doing that first changed what the plan should build.

## 1. The plan's central premise no longer holds

The plan was written from Repomix snapshots taken when the downstream V4.1/ROCm
fork was **ahead** of upstream. It expects `ds4.c +4751/−412`, 55 new downstream
files, and nine feature bundles spanning core, agent, server and Metal.

Measured against the live trees today, the diff runs the other way:

| file | plan (snapshot) | live, upstream → downstream |
|---|---|---|
| `ds4.c` | +4751 / −412 | **+1060 / −5563** |
| `ds4_server.c` | +1509 / −241 | **+37 / −1356** |
| `ds4_agent.c` | +1777 / −563 | **+20 / −360** |
| `ds4_metal.m` | +1165 / −402 | **+24 / −2061** |

A leading `−` here means *upstream has code the fork lacks*. antirez has since
landed DeepSeek v4.1 Flash support, and upstream is now ahead on core, agent,
server and Metal.

Symbol check — every one of these already exists in **upstream** `ds4.c`:

```
config_validate_deepseek41_model   ds4_deepseek41_reasoning_effort_text
ds4_chat_append_think_prefix       ds4_think_mode_level
model_unmap_engram                 ds4_engine_is_deepseek41   ds41_graph_free
```

Only `ds41_prefill_logical_limit` is downstream-only.

**Consequence.** Plan §8 (`ds4.h` shim), §9 (`ds4.c` extraction), §10 (agent),
§11 (server) and §13 (Metal) describe work that is now largely *retirement*
(§21), not construction. Building those nine feature manifests would have meant
writing anchors for code that is already upstream, and the `[[shadow_patch]]`
entries would have **reverted** antirez's work.

## 2. What the delta actually is

Tracked files: upstream 2726, downstream 2681.

| | count |
|---|---|
| modified on both sides | 62 |
| new downstream only | **5** (plan expected 55) |
| present upstream, absent downstream | 50 |

Hunk-level triage of all 62 modified files (`scripts/diff_report.py`):

| hunk class | count | meaning |
|---|---|---|
| `add` | 83 | downstream adds something upstream lacks → overlay content |
| `del` | 281 | upstream ahead → **not** overlay content |
| `mixed` | 402 | genuine divergence → needs a human |

Only **13 of 62 files** contain a single `add` hunk. The real remaining
downstream delta is **ROCm / Strix Halo, the CUDA MMQ tier, and Engram** — which
is plan §12, the section that already called it "overlay naturale".

## 3. Upstream is not behaviourally equivalent

`tests/test_deepseek41_cache_spans.c`, imported byte-for-byte from downstream:

* against **downstream** `ds4.c` → PASS
* against **upstream** `ds4.c` → `Assertion !accelerator_cache_q8_tensors(&m, NULL, NULL, 0) failed`

The non-ROCm path no longer rejects disk-only V4.1 descriptors the way the
downstream work expects. This is the plan §21 point exactly: a textual probe
would have said "upstream has deepseek41, retire the feature" and would have
been wrong. Keep this test; it is the evidence.

## 4. The `rsqrtf` edit was a build fix, not an experiment

`rocm/ds4_rocm_deepseek4_vision.cuh` carried an uncommitted worktree edit
replacing `rsqrtf(head_dim)` with `1.0f / sqrtf(head_dim)`. It looked like a
precision experiment — it is marked `//TODO REMOVE` — so it was first captured
as a **disabled** opt-in feature.

Building against ROCm 7.2.4 settled it:

```
./rocm/ds4_rocm_deepseek4_vision.cuh:239:25: error: no matching function for call to 'rsqrtf'
note: candidate function not viable: call to __device__ function from __host__ function
```

`rsqrtf` is `__device__`-only there, and the call site
`ds4_gpu_attention_visual_mixed_batch_heads_tensor()` is `__host__`. Without the
edit, ROCm does not compile at all. The feature is now **enabled**
(`rocm-vision-alpha-precision`). The replacement is also the more accurate of
the two, and `alpha` is computed once per call, so nothing is lost.

This is the reason the overlay captures before it discards: the change had
already been reverted out of the worktree by the time its purpose became clear.

## 5. Two behavioural divergences found and closed

`tests/test_deepseek41_cache_spans.c`, imported byte-for-byte, failed against
upstream on both of its branches. Both causes were located and are now carried
as evidence-backed features; the test passes on both branches.

**`accelerator-span-bounds`** — upstream short-circuits with

```c
if (t->bytes == 0 || t->type != DS4_TENSOR_Q8_0 || t->ndim != 2) continue;
```

so a tensor outside the mapping never reaches the bounds check below it. The
downstream work depends on that check firing for every tensor: it is what makes
the non-ROCm path reject a disk-only V4.1 descriptor.

**`rocm-disk-only-engram`** — upstream recognises an Engram table by name alone,
and on ROCm that same name check grants the exemption from the mapping bounds
check. A name is not evidence: a malformed descriptor called
`blk.1.engram_embd.weight` inherits the exemption. The feature adds
`model_engram_table_index()` and `model_tensor_is_disk_only_engram()` —
architecture, row encoding, shape, and bounds against the **file** — and uses
them under `DS4_ROCM_BUILD` only. The non-ROCm path is untouched.

Both are the plan §21 case: a textual probe would have said "upstream shipped
deepseek41, retire the overlay" and been wrong twice.

## 6. The ROCm feature had to be split

The auto-derived add-hunks for `rocm/ds4_rocm_runtime.cuh` and
`rocm/ds4_rocm_current_api_compat.cuh` pull in the ROCm-side *callers* of the
downstream V4.1 expert-streaming subsystem without the declarations they call.
18 of the 19 ROCm build errors were that:

```
unknown type name 'ds4_gpu_dsv41_stream_layer_plan'
unknown type name 'ds4_gpu_stream_expert_memory'
use of undeclared identifier 'cuda_stream_layer_expert_cache_reserve'
use of undeclared identifier 'cuda_stream_layer_expert_cache_note_consumed'
use of undeclared identifier 'cuda_stream_expert_cache_quiesce'
use of undeclared identifier 'cuda_stream_layer_table_bytes'
no matching function for call to 'cuda_stream_resident_seed_experts'
```

Those types live in `ds4_gpu.h` (+229/−247), the functions in `ds4_cuda.cu`
(+394/−1214) and engine fields in `ds4.c` — all group-B files where upstream
moved on independently. That is a multi-file port with design decisions in it,
not a hunk copy, which is why the automated `add`-only triage never claimed it.

The symbols are confined to those two patches; neither imported header nor the
`ds4_rocm.cu` hook references them. So the feature was split:

| feature | state | contents |
|---|---|---|
| `rocm-strix-halo` | **enabled** | `ds4_rocm.cu` include hook + `ds4_rocm_v41.cuh` + `ds4_rocm_hc_sgemm.cuh` |
| `dsv41-expert-streaming` | **disabled** | the two `.cuh` caller patches, with the missing dependencies documented |

Verified: `ds4_rocm.o` compiles clean under ROCm 7.2.4 for gfx1151 with the
enabled set, and is larger than the build without `rocm-strix-halo`, confirming
the V4.1 headers are genuinely compiled in.

## 7. Outstanding

* **`rocm-strix-halo` must be disabled or completed.** It needs a
  `dsv41-expert-streaming` feature spanning `ds4_gpu.h`, `ds4_cuda.cu` and
  `ds4.c`. Until then it breaks the ROCm build. See §6.
* **`tests/test_deepseek41_memory.c` cannot compile against upstream.** It
  references `ds4_engine.ds41_host_memory_baseline`,
  `ds4_engine.ds41_model_loaded` and the type `ds4_gpu_stream_expert_memory`,
  all part of the same unported streaming subsystem.
* **`tests/test_deepseek41_rocm.c`** compiles, but linking `ds4-kernel-v41`
  needs `ds4_rocm.o`, which needs §6 resolved first.
* **41 `mixed` hunks inside the 13 group-A files** remain unclaimed; 402
  overall. Each needs a decision — emitting them blindly reverts upstream.
* Commits **C06–C15** of the plan are extraction/refactor steps gated on a
  green ROCm build and a recorded performance baseline (§18). Not started.

## 8. Composer bug found and fixed

The first composer used `git apply --check` then `git apply`, as plan §6
specifies. Inside the overlay repository — where the shadow tree lives — git
resolves patch paths against the **repository root**, not the working
directory. The result was `git apply` exiting 0 and writing nothing: it
reported *"9 patches applied"* for a patch that never landed, and the
`--check` pre-flight agreed.

A silent no-op is the worst possible failure for a fail-closed design, so
patching is now done in-process by `scripts/exact_patch.py`: byte-exact context
matching, the hunk's stated line preferred and a unique whole-file match
required otherwise, refusal to write through a symlink, and no partial
application. `compose_shadow.py` additionally verifies after each patch that
the declared file was touched **and** now differs from upstream — the false
green could not survive either check.

## 9. `engram-rocm` retired — it was dead code

The ROCm build warned:

```
ds4_engram.c:236:13: warning: 'read_batch_pthreads' defined but not used
```

The warning fired only in the overlay build, not in upstream and not in the
fork, which meant the overlay had introduced it.

`engram-rocm` was derived by the automated add-hunk triage and contained
exactly two things: the fork's `read_batch_pthreads()` and the `#include
<stdio.h>` that function needed. The fork **extracts** that helper and calls it
from a `#elif defined(__linux__) && defined(DS4_ROCM_BUILD)` branch; upstream
keeps the identical pthread fan-out **inline** in the `#else` of its
`#ifdef __APPLE__`. So on Linux/ROCm upstream already runs the parallel reader —
the add-only triage copied the extracted function but not the call site that
replaces it, leaving the helper unreferenced.

Upstream's inline version is also the better of the two on failure:

  upstream  thread exhaustion reduces concurrency, the remaining partitions are
            read on the calling thread ("only reduces concurrency, not
            correctness")
  fork      pthread_create failure sets errno and fails the batch

and upstream's arrangement keeps the fan-out on **all** Linux builds, whereas
the fork's `#elif` restricts it to ROCm and leaves plain Linux serial.

The feature is therefore deleted rather than fixed: it had no content worth
keeping. This is the second time the automated triage produced something that
compiled and ran but was not right - see also the missing `#include <stdio.h>`
it originally omitted from this same patch.
