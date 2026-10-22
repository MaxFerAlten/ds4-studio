# Experiment: g0c-ctx4096-sched

## Metadata

- schema_version: 1
- utc_time: 2026-10-22T00:49:13Z
- git_sha_ds4: 92bf970285822210ed69f03e470a4044f4d92674
- git_dirty: True
- linux_kernel: 7.2.0-070200rc2-generic
- model_basename: DeepSeek-V4-Flash-IQ2XXS-w2Q2K-AProjQ8-SExpQ8-OutQ8-chat-v2-imatrix.gguf
- model_sha256: n/a
- rounds: 7
- seed: 3

## Measurements

DSpark telemetry covers the whole run, including all its contexts; it is not attributed to individual contexts. Only logs next to successful CSVs are included.

| config | ctx_tokens | n | median gen_tps | median prefill_tps | p95 gen_first_ms | p95 first_token_ms | DSpark (whole run) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| baseline | 4096 | 7 | 14.410 | 228.580 | 69.697 | 18163.168 | {"acceptance_avg": null, "accepted_drafts": null, "cycles": null, "event_counts": {}, "unknown_lines": 140} |
| minavg-1000 | 4096 | 7 | 15.830 | 224.630 | 406.552 | 18755.690 | {"acceptance_avg": 1.9588235294117646, "accepted_drafts": 2331, "cycles": 1190, "event_counts": {"bench_enabled": 7, "dspark_stats": 7}, "unknown_lines": 175} |
| minavg-1500 | 4096 | 7 | 15.850 | 226.620 | 375.640 | 18663.575 | {"acceptance_avg": 1.9588235294117646, "accepted_drafts": 2331, "cycles": 1190, "event_counts": {"bench_enabled": 7, "dspark_stats": 7}, "unknown_lines": 175} |
| sched-off | 4096 | 7 | 15.990 | 228.240 | 454.186 | 18602.832 | {"acceptance_avg": 2.5555555555555554, "accepted_drafts": 2576, "cycles": 1008, "event_counts": {"bench_enabled": 7, "dspark_stats": 7}, "unknown_lines": 175} |

## Selection vs baseline

Default selection gates; bootstrap seed 3.

TTFT gate uses first_token_ms = prefill + first decode call (docs/TTFT_SEMANTICS.md).

| ctx_tokens | config | decision | improvement % | CI95 % | TTFT p95 regression % | reason |
| ---: | --- | --- | ---: | --- | ---: | --- |
| 4096 | minavg-1000 | GO | 9.854 | 9.425, 10.062 | 3.262 | CI lower bound 9.42% &gt;= 5.0% |
| 4096 | minavg-1500 | GO | 9.993 | 9.494, 10.062 | 2.755 | CI lower bound 9.49% &gt;= 5.0% |
| 4096 | sched-off | GO | 10.965 | 10.603, 11.173 | 2.421 | CI lower bound 10.60% &gt;= 5.0% |

Recommended configuration:

- ctx_tokens 4096: sched-off
