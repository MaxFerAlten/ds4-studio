# Experiment: g0h-ps-2k

## Metadata

- schema_version: 1
- utc_time: 2026-10-22T12:01:08Z
- git_sha_ds4: d4196deb9c7578e7cd43cb746240885f8d570141
- git_dirty: False
- linux_kernel: 7.2.0-070200rc2-generic
- model_basename: DeepSeek-V4-Flash-IQ2XXS-w2Q2K-AProjQ8-SExpQ8-OutQ8-chat-v2-imatrix.gguf
- model_sha256: n/a
- rounds: 7
- seed: 8

## Measurements

DSpark telemetry covers the whole run, including all its contexts; it is not attributed to individual contexts. Only logs next to successful CSVs are included.

| config | ctx_tokens | n | median gen_tps | median prefill_tps | p95 gen_first_ms | p95 first_token_ms | DSpark (whole run) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| baseline | 2048 | 7 | 14.470 | 199.710 | 79.055 | 10557.764 | {"acceptance_avg": null, "accepted_drafts": null, "cycles": null, "event_counts": {}, "unknown_lines": 140} |
| dspark-4000 | 2048 | 7 | 13.440 | 189.730 | 265.092 | 11587.265 | {"acceptance_avg": 0.04054054054054054, "accepted_drafts": 21, "cycles": 518, "event_counts": {"bench_enabled": 7, "dspark_stats": 7}, "unknown_lines": 175} |
| minavg-1500 | 2048 | 7 | 13.370 | 189.960 | 474.468 | 11265.544 | {"acceptance_avg": 0.04054054054054054, "accepted_drafts": 21, "cycles": 518, "event_counts": {"bench_enabled": 7, "dspark_stats": 7}, "unknown_lines": 175} |

## Selection vs baseline

Default selection gates; bootstrap seed 8.

TTFT gate uses first_token_ms = prefill + first decode call (docs/TTFT_SEMANTICS.md).

| ctx_tokens | config | decision | improvement % | CI95 % | TTFT p95 regression % | reason |
| ---: | --- | --- | ---: | --- | ---: | --- |
| 2048 | dspark-4000 | NO_GO | -7.118 | -10.103, -6.427 | 9.751 | TTFT p95 regression 9.75% &gt; 5.0% |
| 2048 | minavg-1500 | NO_GO | -7.602 | -9.759, -6.634 | 6.704 | TTFT p95 regression 6.70% &gt; 5.0% |

Recommended configuration:

- ctx_tokens 2048: baseline
