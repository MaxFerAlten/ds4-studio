# Experiment: g0d-ctx16384-sched

## Metadata

- schema_version: 1
- utc_time: 2026-10-22T01:23:42Z
- git_sha_ds4: a471cc2101f7643ab98e00bf13df0516e35537a6
- git_dirty: False
- linux_kernel: 7.2.0-070200rc2-generic
- model_basename: DeepSeek-V4-Flash-IQ2XXS-w2Q2K-AProjQ8-SExpQ8-OutQ8-chat-v2-imatrix.gguf
- model_sha256: n/a
- rounds: 7
- seed: 4

## Measurements

DSpark telemetry covers the whole run, including all its contexts; it is not attributed to individual contexts. Only logs next to successful CSVs are included.

| config | ctx_tokens | n | median gen_tps | median prefill_tps | p95 gen_first_ms | p95 first_token_ms | DSpark (whole run) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| baseline | 16384 | 7 | 14.020 | 241.830 | 72.388 | 68363.711 | {"acceptance_avg": null, "accepted_drafts": null, "cycles": null, "event_counts": {}, "unknown_lines": 140} |
| minavg-1500 | 16384 | 7 | 15.780 | 241.140 | 235.015 | 68671.817 | {"acceptance_avg": 1.8, "accepted_drafts": 2268, "cycles": 1260, "event_counts": {"bench_enabled": 7, "dspark_stats": 7}, "unknown_lines": 175} |
| sched-off | 16384 | 7 | 15.550 | 242.020 | 237.465 | 68827.465 | {"acceptance_avg": 2.303225806451613, "accepted_drafts": 2499, "cycles": 1085, "event_counts": {"bench_enabled": 7, "dspark_stats": 7}, "unknown_lines": 175} |

## Selection vs baseline

Default selection gates; bootstrap seed 4.

TTFT gate uses first_token_ms = prefill + first decode call (docs/TTFT_SEMANTICS.md).

| ctx_tokens | config | decision | improvement % | CI95 % | TTFT p95 regression % | reason |
| ---: | --- | --- | ---: | --- | ---: | --- |
| 16384 | minavg-1500 | GO | 12.553 | 12.340, 12.705 | 0.451 | CI lower bound 12.34% &gt;= 5.0% |
| 16384 | sched-off | GO | 10.913 | 10.763, 11.206 | 0.678 | CI lower bound 10.76% &gt;= 5.0% |

Recommended configuration:

- ctx_tokens 16384: minavg-1500
