# A/B report (holdout)

Executor: scripted_local (deterministic, model-free): measures the Harness² recursion and the DS4 gate, NOT model benefit

## in_task-k1

| Domain | n | Base pass | Raw pass | Gated pass | Raw regressions | Gated regressions |
|---|---:|---:|---:|---:|---:|---:|
| json | 5 | 0.2 | 1.0 | 1.0 | 0 | 0 |
| kv | 5 | 0.4 | 0.8 | 1.0 | 1 | 0 |
| ledger | 4 | 0.5 | 0.75 | 1.0 | 1 | 0 |

- Δ pass (raw): {'n': 14, 'mean': 0.5, 'median': 1.0, 'worst': -1.0, 'ci95': [0.071429, 0.857143]}
- Δ pass (gated): {'n': 14, 'mean': 0.642857, 'median': 1.0, 'worst': 0.0, 'ci95': [0.357143, 0.857143]}
- Δ quality (gated): {'n': 14, 'mean': 0.507143, 'median': 0.7, 'worst': 0.0, 'ci95': [0.3, 0.707143]}
- decisions: {'KEEP_BASE': 5, 'QUARANTINE_CANDIDATE': 9}
- critical regressions after gate: 0
- rollouts 56, improvement sessions 42

## in_task-k2

| Domain | n | Base pass | Raw pass | Gated pass | Raw regressions | Gated regressions |
|---|---:|---:|---:|---:|---:|---:|
| json | 5 | 0.2 | 1.0 | 1.0 | 0 | 0 |
| kv | 5 | 0.4 | 0.8 | 1.0 | 1 | 0 |
| ledger | 4 | 0.5 | 0.75 | 1.0 | 1 | 0 |

- Δ pass (raw): {'n': 14, 'mean': 0.5, 'median': 1.0, 'worst': -1.0, 'ci95': [0.071429, 0.857143]}
- Δ pass (gated): {'n': 14, 'mean': 0.642857, 'median': 1.0, 'worst': 0.0, 'ci95': [0.357143, 0.857143]}
- Δ quality (gated): {'n': 14, 'mean': 0.507143, 'median': 0.7, 'worst': 0.0, 'ci95': [0.3, 0.707143]}
- decisions: {'KEEP_BASE': 5, 'QUARANTINE_CANDIDATE': 9}
- critical regressions after gate: 0
- rollouts 112, improvement sessions 84

## transfer-k1

| Domain | n | Base pass | Raw pass | Gated pass | Raw regressions | Gated regressions |
|---|---:|---:|---:|---:|---:|---:|
| json | 5 | 0.2 | 1.0 | 1.0 | 0 | 0 |
| kv | 5 | 0.4 | 0.8 | 0.8 | 1 | 1 |
| ledger | 4 | 0.5 | 0.75 | 0.75 | 1 | 1 |

- Δ pass (raw): {'n': 14, 'mean': 0.5, 'median': 1.0, 'worst': -1.0, 'ci95': [0.071429, 0.857143]}
- Δ pass (gated): {'n': 14, 'mean': 0.5, 'median': 1.0, 'worst': -1.0, 'ci95': [0.071429, 0.857143]}
- Δ quality (gated): {'n': 14, 'mean': 0.407143, 'median': 0.7, 'worst': -0.7, 'ci95': [0.107143, 0.685714]}
- decisions: {'TRANSFER': 14}
- critical regressions after gate: 2
- rollouts 28, improvement sessions 0
