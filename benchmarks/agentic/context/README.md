# Context retention A/B benchmark

Measures whether the ContextWiki capsule improves session context retention
without regressing delta/session-reuse. Clean-room, DS4-native (§14/§19).

## Arms

- `baseline` — `DS4_CONTEXT_WIKI_ENABLED=0`, `DS4_CONTEXT_PREVIEW_ONLY=1`
- `context-preview` — build/log capsule, never inject
- `context-enabled` — `DS4_CONTEXT_WIKI_ENABLED=1`, `DS4_CONTEXT_PREVIEW_ONLY=0`

## Tasks (`tasks.mjs`)

`long-rule-retention`, `pending-links-recovery`, `big-tool-result-no-echo`,
`stale-decision`.

## Run

```bash
node run.mjs --live --gate \
  --arms baseline,context-enabled \
  --tasks long-rule-retention,big-tool-result-no-echo \
  --runs 1 --max-tokens 3072
```

Writes `runs/<timestamp>/summary.json`. Exits non-zero if `--gate` fails.

## Gate (§19.4) — fail if any hold vs. baseline

- `reset_rate_after_revision_1 > baseline + 5%`
- `capsule_tokens_p95 > 3000`
- `task_success < baseline`
- `duplicate_read_count > baseline`
- `raw_echo_detected = true`

## Status

Implemented and self-tested (`node run.mjs --selftest`):

- gate (`evaluateGate`) + aggregation (`aggregate`, `percentile`)
- scoring primitives (`scoring.mjs`): `rawEchoDetected`, `blobIdPresent`,
  `synthesisPresent`, `countDuplicateReads`, `scoreLinkRecovery`
- SSE chat client (`postChat`) and `scoreTranscript` / `runCellLive` wiring

Remaining boundary: `--live` execution needs the DS4 server up (`DS4_BENCH_BASE`,
default `http://127.0.0.1:5173`) plus per-task fixtures (prompt + oracle data).
The capsule env flags are read **server-side**, so run one server per arm with
`ARM_ENV[arm]` exported to that server process. Without `--live` the harness runs
in dry mode (structure only, no fabricated cells).
