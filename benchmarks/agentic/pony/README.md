# DS4 Pony agentic quality gate

This is a clean-room benchmark harness for the proposed DS4 `/pony` agent mode.
It does not copy Ponytail code or prompts. It tests the DS4-native idea: smaller
safe diffs when the agent is explicitly put in lean mode.

## Offline scorer gate

Runs without DS4, a model, or network access. It proves the task scorers catch
both empty implementations and deliberately overbuilt/unsafe references.

```bash
node benchmarks/agentic/pony/run.mjs --selftest
```

This is the CI-safe gate to keep the benchmark itself honest.

## Live DS4 agentic gate

Requires DS4 Studio running on the given base URL and the `/pony` endpoint to be
implemented. The harness creates isolated workspaces under `runs/`, starts an
agent session per cell, optionally enables `/pony`, asks it to edit only that
workspace, then scores the resulting diff.

Use the smoke gate for routine checks. It runs only three representative tasks,
uses one run, writes `summary.json` after every cell, waits for the wrapper to be
ready, cools down between cells, lowers `max_tokens`, and aborts cells that run
too long.

```bash
node benchmarks/agentic/pony/run.mjs \
  --live --smoke --gate \
  --base-url http://127.0.0.1:5173
```

Full A/B is intentionally manual/heavy:

```bash
node benchmarks/agentic/pony/run.mjs \
  --live --gate \
  --base-url http://127.0.0.1:5173 \
  --arms baseline,pony-full \
  --runs 1 \
  --cell-timeout-ms 480000 \
  --cooldown-ms 5000 \
  --max-tokens 3072 \
  --fail-fast
```

Useful narrower runs while developing:

```bash
node benchmarks/agentic/pony/run.mjs --live --gate --tasks native-date-filter --arms baseline,pony-full --runs 1
node benchmarks/agentic/pony/run.mjs --live --gate --tasks intl-formatting,debt-ledger-scan --arms baseline,pony-full --runs 1
node benchmarks/agentic/pony/run.mjs --summary benchmarks/agentic/pony/runs/<stamp>/summary.json --gate
```

## Tasks

- `native-date-filter` — overbuild trap; native `<input type="date">`, no date picker dependency.
- `url-search-params` — stdlib trap; `URL`/`URLSearchParams`, not a hand parser.
- `safe-export-path` — safety trap; path traversal must be rejected.
- `pony-command-parser` — irreducible DS4-ish parser; strict slash command handling.
- `intl-formatting` — native platform trap; `Intl.NumberFormat`, no formatting dependency.
- `debt-ledger-scan` — DS4 debt convention; scan `ds4-pony:` markers and skip generated/deps.

## Gate rule

For every pony arm:

1. task scorer must pass;
2. safety rate must not drop below baseline;
3. for overbuild/native/stdlib/debt tasks, median LOC must not exceed baseline.

The gate intentionally uses conservative thresholds. It proves "no harm + no
larger diff" first; stronger claims (token/cost/time savings) require repeated
published runs.
