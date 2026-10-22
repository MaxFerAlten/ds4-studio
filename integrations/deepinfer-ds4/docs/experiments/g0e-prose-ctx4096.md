# Experiment: g0e-prose-ctx4096

## Metadata

- schema_version: 1
- utc_time: 2026-10-22T02:59:21Z
- git_sha_ds4: 04c85699f2a23511eebb01f4fbb7e1e16ed68704
- git_dirty: False
- linux_kernel: 7.2.0-070200rc2-generic
- model_basename: DeepSeek-V4-Flash-IQ2XXS-w2Q2K-AProjQ8-SExpQ8-OutQ8-chat-v2-imatrix.gguf
- model_sha256: n/a
- rounds: 7
- seed: 5

## Measurements

DSpark telemetry covers the whole run, including all its contexts; it is not attributed to individual contexts. Only logs next to successful CSVs are included.

| config | ctx_tokens | n | median gen_tps | median prefill_tps | p95 gen_first_ms | p95 first_token_ms | DSpark (whole run) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| baseline | 4096 | 7 | 14.410 | 228.480 | 70.104 | 18174.772 | {"acceptance_avg": null, "accepted_drafts": null, "cycles": null, "event_counts": {}, "unknown_lines": 140} |
| dspark-default | 4096 | 7 | 14.090 | 227.320 | 255.437 | 18839.810 | {"acceptance_avg": 0.2682926829268293, "accepted_drafts": 77, "cycles": 287, "event_counts": {"bench_enabled": 7, "dspark_stats": 7}, "unknown_lines": 175} |
| minavg-1500 | 4096 | 7 | 14.160 | 226.530 | 269.325 | 18515.467 | {"acceptance_avg": 0.2682926829268293, "accepted_drafts": 77, "cycles": 287, "event_counts": {"bench_enabled": 7, "dspark_stats": 7}, "unknown_lines": 175} |
| sched-off | 4096 | 7 | 11.710 | 225.820 | 251.817 | 18522.075 | {"acceptance_avg": 0.8315412186379928, "accepted_drafts": 1624, "cycles": 1953, "event_counts": {"bench_enabled": 7, "dspark_stats": 7}, "unknown_lines": 175} |

## Selection vs baseline

Default selection gates; bootstrap seed 5.

TTFT gate uses first_token_ms = prefill + first decode call (docs/TTFT_SEMANTICS.md).

| ctx_tokens | config | decision | improvement % | CI95 % | TTFT p95 regression % | reason |
| ---: | --- | --- | ---: | --- | ---: | --- |
| 4096 | dspark-default | INCONCLUSIVE | -2.221 | -2.426, -1.254 | 3.659 | CI straddles the decision thresholds |
| 4096 | minavg-1500 | INCONCLUSIVE | -1.735 | -2.079, -1.117 | 1.875 | CI straddles the decision thresholds |
| 4096 | sched-off | NO_GO | -18.737 | -18.850, -18.087 | 1.911 | CI upper bound -18.09% &lt; -3.0% |

Recommended configuration:

- ctx_tokens 4096: baseline
