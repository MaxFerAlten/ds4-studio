# Experiment: g0h-ps-16k

## Metadata

- schema_version: 1
- utc_time: 2026-10-22T12:15:33Z
- git_sha_ds4: d4196deb9c7578e7cd43cb746240885f8d570141
- git_dirty: False
- linux_kernel: 7.2.0-070200rc2-generic
- model_basename: DeepSeek-V4-Flash-IQ2XXS-w2Q2K-AProjQ8-SExpQ8-OutQ8-chat-v2-imatrix.gguf
- model_sha256: n/a
- rounds: 7
- seed: 9

## Measurements

DSpark telemetry covers the whole run, including all its contexts; it is not attributed to individual contexts. Only logs next to successful CSVs are included.

| config | ctx_tokens | n | median gen_tps | median prefill_tps | p95 gen_first_ms | p95 first_token_ms | DSpark (whole run) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| baseline | 16384 | 7 | 13.870 | 240.020 | 72.788 | 69548.024 | {"acceptance_avg": null, "accepted_drafts": null, "cycles": null, "event_counts": {}, "unknown_lines": 140} |
| dspark-4000 | 16384 | 7 | 13.050 | 238.390 | 241.079 | 69725.035 | {"acceptance_avg": 0.10144927536231885, "accepted_drafts": 49, "cycles": 483, "event_counts": {"bench_enabled": 7, "dspark_stats": 7}, "unknown_lines": 175} |
| minavg-1500 | 16384 | 7 | 13.110 | 236.260 | 240.066 | 69855.484 | {"acceptance_avg": 0.10144927536231885, "accepted_drafts": 49, "cycles": 483, "event_counts": {"bench_enabled": 7, "dspark_stats": 7}, "unknown_lines": 175} |

## Selection vs baseline

Default selection gates; bootstrap seed 9.

TTFT gate uses first_token_ms = prefill + first decode call (docs/TTFT_SEMANTICS.md).

| ctx_tokens | config | decision | improvement % | CI95 % | TTFT p95 regression % | reason |
| ---: | --- | --- | ---: | --- | ---: | --- |
| 16384 | dspark-4000 | NO_GO | -5.912 | -7.051, -5.145 | 0.255 | CI upper bound -5.14% &lt; -3.0% |
| 16384 | minavg-1500 | NO_GO | -5.479 | -6.232, -4.783 | 0.442 | CI upper bound -4.78% &lt; -3.0% |

Recommended configuration:

- ctx_tokens 16384: baseline
