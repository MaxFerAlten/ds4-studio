# Server experiment: g0g-server

## Metadata

- utc_time: 2026-10-22T07:45:25Z
- git_sha_ds4: d9d25345b90b1619e90e55e766088168ca73625b
- model_basename: DeepSeek-V4-Flash-IQ2XXS-w2Q2K-AProjQ8-SExpQ8-OutQ8-chat-v2-imatrix.gguf
- rounds: 7
- seed: 7
- runs: baseline 7, dspark 7, dspark-1500 7, exact 7, exact-1500 7

## Decode and TTFT per scenario

decode = server log `gen / (total - prefill)`; one value per run (all requests of the scenario pooled). TTFT = client, request -> first streamed delta, summed over the scenario's requests in the run; the gate compares its p95 across runs.

### tool-use (3 scenarios pooled)

| config | runs | median decode tok/s | Δ vs baseline | CI95 % | p95 TTFT/run ms | TTFT p95 Δ % | gate |
| --- | ---: | ---: | ---: | --- | ---: | ---: | --- |
| baseline | 7 | 14.51 | — | — | 63770 | — | — |
| dspark | 7 | 15.83 | 9.1% | 6.8, 15.3 | 65007 | 1.9 | GO |
| dspark-1500 | 7 | 16.81 | 15.8% | 13.4, 19.5 | 64975 | 1.9 | GO |
| exact | 7 | 15.99 | 10.2% | 6.5, 14.6 | 64970 | 1.9 | GO |
| exact-1500 | 7 | 16.98 | 17.0% | 14.7, 21.1 | 65300 | 2.4 | GO |

### tool-next-step

| config | runs | median decode tok/s | Δ vs baseline | CI95 % | p95 TTFT/run ms | TTFT p95 Δ % | gate |
| --- | ---: | ---: | ---: | --- | ---: | ---: | --- |
| baseline | 7 | 14.12 | — | — | 39215 | — | — |
| dspark | 7 | 13.67 | -3.2% | -4.1, 4.7 | 39548 | 0.8 | INCONCLUSIVE |
| dspark-1500 | 7 | 15.38 | 8.9% | 6.0, 12.4 | 39755 | 1.4 | GO |
| exact | 7 | 13.68 | -3.1% | -3.6, 4.9 | 39919 | 1.8 | INCONCLUSIVE |
| exact-1500 | 7 | 15.33 | 8.6% | 6.3, 14.9 | 40011 | 2.0 | GO |

### tool-final-answer

| config | runs | median decode tok/s | Δ vs baseline | CI95 % | p95 TTFT/run ms | TTFT p95 Δ % | gate |
| --- | ---: | ---: | ---: | --- | ---: | ---: | --- |
| baseline | 7 | 14.33 | — | — | 17939 | — | — |
| dspark | 7 | 19.09 | 33.2% | 32.3, 37.0 | 18226 | 1.6 | GO |
| dspark-1500 | 7 | 19.08 | 33.1% | 31.4, 37.0 | 18195 | 1.4 | GO |
| exact | 7 | 19.35 | 35.0% | 32.0, 37.1 | 18323 | 2.1 | GO |
| exact-1500 | 7 | 19.29 | 34.6% | 33.0, 38.1 | 18307 | 2.0 | GO |

### tool-patch

| config | runs | median decode tok/s | Δ vs baseline | CI95 % | p95 TTFT/run ms | TTFT p95 Δ % | gate |
| --- | ---: | ---: | ---: | --- | ---: | ---: | --- |
| baseline | 7 | 15.22 | — | — | 6859 | — | — |
| dspark | 7 | 18.26 | 20.0% | 9.6, 21.2 | 7233 | 5.5 | NO_GO |
| dspark-1500 | 7 | 18.40 | 20.9% | 15.2, 22.2 | 7047 | 2.7 | GO |
| exact | 7 | 18.26 | 20.0% | 8.7, 21.6 | 7095 | 3.4 | GO |
| exact-1500 | 7 | 18.22 | 19.7% | 17.6, 22.1 | 7119 | 3.8 | GO |

### sampled-code

| config | runs | median decode tok/s | Δ vs baseline | CI95 % | p95 TTFT/run ms | TTFT p95 Δ % | gate |
| --- | ---: | ---: | ---: | --- | ---: | ---: | --- |
| baseline | 7 | 15.66 | — | — | 717 | — | — |
| dspark | 7 | 16.07 | 2.6% | 1.2, 3.3 | 872 | 21.6 | NO_GO |
| dspark-1500 | 7 | 18.62 | 18.9% | 16.1, 25.0 | 873 | 21.8 | NO_GO |
| exact | 7 | 15.51 | -1.0% | -2.3, -0.5 | 916 | 27.9 | NO_GO |
| exact-1500 | 7 | 16.01 | 2.2% | -2.5, 4.0 | 922 | 28.6 | NO_GO |

### sample

| config | runs | median decode tok/s | Δ vs baseline | CI95 % | p95 TTFT/run ms | TTFT p95 Δ % | gate |
| --- | ---: | ---: | ---: | --- | ---: | ---: | --- |
| baseline | 7 | 15.90 | — | — | 20246 | — | — |
| dspark | 7 | 13.93 | -12.4% | -15.5, -11.2 | 24847 | 22.7 | NO_GO |
| dspark-1500 | 7 | 13.98 | -12.1% | -14.0, -10.5 | 24829 | 22.6 | NO_GO |
| exact | 7 | 14.32 | -9.9% | -10.9, -7.1 | 24159 | 19.3 | NO_GO |
| exact-1500 | 7 | 14.68 | -7.7% | -10.0, -6.8 | 24033 | 18.7 | NO_GO |

## Greedy output stability (tool scenarios)

Completion tokens and tool-call deltas per scenario, every run. Greedy output is deterministic per configuration; a spread across configurations is the documented DSpark divergence.

| scenario | baseline | dspark | dspark-1500 | exact | exact-1500 |
| --- | --- | --- | --- | --- | --- |
| tool-next-step | 114 tok/40 tc/tool_calls; 115 tok/40 tc/tool_calls; 117 tok/43 tc/tool_calls; 118 tok/46 tc/tool_calls; 120 tok/46 tc/tool_calls; 126 tok/42 tc/tool_calls; 135 tok/39 tc/tool_calls | 112 tok/40 tc/tool_calls; 114 tok/40 tc/tool_calls; 116 tok/41 tc/tool_calls; 117 tok/40 tc/tool_calls; 133 tok/40 tc/tool_calls; 134 tok/39 tc/tool_calls | 112 tok/40 tc/tool_calls; 113 tok/36 tc/tool_calls; 114 tok/40 tc/tool_calls; 116 tok/41 tc/tool_calls; 133 tok/40 tc/tool_calls; 134 tok/39 tc/tool_calls | 112 tok/40 tc/tool_calls; 114 tok/40 tc/tool_calls; 116 tok/41 tc/tool_calls; 117 tok/40 tc/tool_calls; 133 tok/40 tc/tool_calls; 134 tok/39 tc/tool_calls | 112 tok/40 tc/tool_calls; 113 tok/36 tc/tool_calls; 114 tok/40 tc/tool_calls; 116 tok/41 tc/tool_calls; 133 tok/40 tc/tool_calls; 134 tok/39 tc/tool_calls |
| tool-final-answer | 56 tok/7 tc/tool_calls; 58 tok/7 tc/tool_calls | 56 tok/7 tc/tool_calls; 58 tok/7 tc/tool_calls | 56 tok/7 tc/tool_calls; 58 tok/7 tc/tool_calls | 56 tok/7 tc/tool_calls; 58 tok/7 tc/tool_calls | 56 tok/7 tc/tool_calls; 58 tok/7 tc/tool_calls |
| tool-patch | 93 tok/7 tc/tool_calls | 93 tok/7 tc/tool_calls; 147 tok/7 tc/tool_calls | 93 tok/7 tc/tool_calls; 148 tok/7 tc/tool_calls | 93 tok/7 tc/tool_calls; 147 tok/7 tc/tool_calls | 93 tok/7 tc/tool_calls; 148 tok/7 tc/tool_calls |

## Sampling distribution (`sample`, temperature 1.0)

Permutation chi-square test of homogeneity vs baseline, per comma-separated word position (2000 permutations). Bonferroni threshold over 6 positions: p < 0.0083.

| config | samples | p pos1 | p pos2 | p pos3 | p pos4 | p pos5 | p pos6 | min p | verdict |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| dspark | 280 | 1.000 | 0.604 | 0.966 | 0.756 | 0.959 | 0.997 | 0.604 | no difference detected |
| dspark-1500 | 280 | 1.000 | 0.700 | 0.947 | 0.774 | 0.924 | 0.996 | 0.700 | no difference detected |
| exact | 280 | 1.000 | 1.000 | 1.000 | 1.000 | 1.000 | 0.999 | 0.999 | no difference detected |
| exact-1500 | 280 | 1.000 | 1.000 | 1.000 | 1.000 | 1.000 | 0.999 | 0.999 | no difference detected |

## DSpark telemetry (whole server lifetime, all scenarios)

| config | cycles | accepted drafts | accepted/cycle |
| --- | ---: | ---: | ---: |
| dspark | 1914 | 2627 | 1.37 |
| dspark-1500 | 2483 | 4372 | 1.76 |
| exact | 2180 | 1799 | 0.83 |
| exact-1500 | 2908 | 3050 | 1.05 |
