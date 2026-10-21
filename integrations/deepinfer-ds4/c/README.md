# Standalone C11 speculative policy

Dependency-free policy/statistics library for control-plane and future shadow
hooks. It does not change DS4's adaptive DSpark scheduler, access logits, create
draft tokens, or implement speculative sampling. Inputs describe actual available
drafts and caller-owned, immutable confidence/timing snapshots. No library
function performs I/O, allocates memory, aborts, or uses mutable global state.
Serialize access to each controller/window; separate instances are independent.

Build with `make all`; run `make test test-asan`; remove artifacts with `make clean`.
The static library and both test runners are written under `build/`. Link with
`-Iinclude build/libds4di_spec_policy.a` (and `-lm` where required).

Source: Apache-2.0 DeepInfer snapshot
`9bd9cf243fc53ef9afbf8f04d391d989117d6ab9`,
[`csrc/engine/mtp_varlen.hpp`](https://github.com/deepseek-ai/DeepInfer/blob/9bd9cf243fc53ef9afbf8f04d391d989117d6ab9/csrc/engine/mtp_varlen.hpp).
Line references below apply to that snapshot.

| C API | Source / relationship |
| --- | --- |
| `ds4di_expected_accepted` | Integration plan 4.1/4.3 prefix-product formula; prepares cumulative probabilities for `MTPVarlen::schedule`, lines 180–189, 231–259. |
| `ds4di_choose_draft_length`, `ds4di_reason_name` | Plan 4.3 scalar utility and diagnostics; mirrors `schedule` expected/time maximization, lines 234–259, with complete measured step times. |
| `ds4di_median_window_init/update/get` | `SamplerRuntimeEstimator::update/get`, lines 20–42 (window 9, minimum 5). Initialization replaces C++ member initialization. |
| `ds4di_varlen_schedule` | `MTPVarlen::schedule`, lines 150–269: empty-curve fallback, rate padding/sorting, graph ceiling, budget selection, allocation. Runtime cost mirrors lines 221–225, 242–244. |
| `ds4di_spec_state_transition`, `ds4di_spec_applies` | New DS4 safety policy from plan 4.4; no DeepInfer state-machine counterpart. |
| `ds4di_spec_controller_init/event/applies`, `ds4di_spec_observe` | New controller/EMA/fault gates from plan 4.2–4.4; observation role resembles `MTPVarlen::update_runtime`, lines 139–148, without fitting the forward estimator. |

Deliberate deviations and contracts:

- C11, fixed arrays and insertion sorting replace C++ containers/exceptions.
  Multi-sequence limits are 64 sequences and 16 available drafts per sequence;
  the scalar APIs have no such cap. Scheduling scratch is at most 1024 ranked
  entries on the stack (typically 16 KiB). No `malloc` or `qsort` is used.
- One caller-supplied rate history selects both total budget and sequence lengths.
  DS4 has no async ZOS pipeline, so upstream's N-2/N-1 histories and counters
  (lines 161–206) are omitted. Rates for this API are **cumulative prefix**
  probabilities, supplied in nonincreasing position order; scalar selection
  instead consumes **conditional** probabilities and computes prefix products.
  Per-sequence output lengths always describe prefixes of supplied drafts.
- ForwardRuntimeEstimator (lines 48–131) is not ported: its two-level, 5000-step
  history is outside this package. Supply its equivalent `slope_ms`; scheduling
  clamps finite negative slopes to zero as upstream does. Supply `sampler_ms`
  from a warmed median window or another matching profile (zero if unavailable).
  Selection arithmetic uses long double intermediates instead of upstream's
  float expected counts; exact utility ties keep the smaller budget.
- Invalid confidence fails closed even after a zero prefix product. Scalar
  choice validates every probability up to `min(n,max_supported)` before
  selection, including unprofiled lengths; later probabilities are unused.
  Invalid/missing/nonpositive timing candidates are skipped. `NO_PROFILE` is a
  normal zero-length decision; confidence/argument errors also return a negative
  status. Output buffers and their inputs must not overlap.
- Scheduling rejects malformed curves, nonfinite runtime inputs, negative
  sampler time, invalid rates and oversized inputs. Errors leave query lengths
  at one when output pointers/count are valid. An exhausted curve retains the
  best covered budget; no graph covering even the base sequence count returns
  `DS4DI_ERR_PROFILE`. An empty curve ignores unused rate/runtime inputs and
  selects exactly `1+n_drafts`, matching upstream's early return.
- The median rejects/counts nonfinite samples without evicting a finite sample;
  even medians avoid overflow when averaging large finite values. Zero-init
  works for windows/controllers; rejection and observation counters saturate.
- The pure transition function checks the state graph. Use
  `ds4di_spec_controller_event` to enforce a valid matching profile and at least
  16 nonzero-candidate ratio observations before either promotion. The first
  ratio seeds the EMA; subsequent updates use alpha 0.1. Zero-candidate steps
  count as observations but do not provide promotion evidence. This empirical
  ratio is not a replacement for positional confidence. No automatic promotion
  or quality threshold is inferred from the EMA.
- `ds4di_spec_applies(state)` reports state eligibility. Session integrations must
  use `ds4di_spec_controller_applies(ctl, session_opted_in)`, which additionally
  requires a valid profile and explicit opt-in in CANARY. SHADOW never applies.
- FAULT from any valid state latches FALLBACK and invalidates the profile.
  Invalid observations (including nonfinite/negative timing or accepted length
  exceeding candidate length) trigger FAULT; `valid=false` reports external
  faults. RESET and MODEL_SWITCH clear profile/statistics. FALLBACK can exit
  only through RESET: MODEL_SWITCH there clears statistics/profile but returns
  false and preserves FALLBACK. This resolves the overlapping reset/model-switch
  rules in favor of the explicit fallback latch. Call MODEL_SWITCH also when
  backend, driver, quantization or layout changes invalidate the profile.
