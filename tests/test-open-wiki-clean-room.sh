#!/usr/bin/env bash
# test-open-wiki-clean-room.sh — one-shot launcher + tester for the ContextWiki
# clean-room feature.
#
#   Phase 0 (always, no infra): unit tests + benchmark self-test.
#   Phase 1 (--live default on):  boots the full DS4 stack once per arm with that
#                                 arm's capsule env, runs the live A/B benchmark,
#                                 then stops the stack. Writes summary.json per arm.
#
# The capsule flags are read SERVER-SIDE, so a true A/B needs one server per arm;
# this script restarts the stack between arms. Unit phase alone proves delta-safety
# and budget; the live phase measures real retention quality against the model.
#
# Usage:
#   tests/test-open-wiki-clean-room.sh                 # units + live (baseline vs enabled)
#   tests/test-open-wiki-clean-room.sh --unit-only     # units + selftest only, no stack
#   tests/test-open-wiki-clean-room.sh --no-start      # live, assume stack already up
#   tests/test-open-wiki-clean-room.sh --arms context-enabled --tasks big-tool-result-no-echo --runs 1
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOST="${DS4_HOST:-127.0.0.1}"
PORT="${DS4_PORT:-5173}"
BASE="http://${HOST}:${PORT}"
LOGDIR="${TMPDIR:-/tmp}/ds4-openwiki-test"
mkdir -p "$LOGDIR"

# Defaults
ARMS="baseline context-enabled"
TASKS="long-rule-retention,big-tool-result-no-echo"
RUNS=1
MAXTOK=3072
DO_LIVE=1
DO_START=1
KEEP_UP=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --unit-only) DO_LIVE=0; shift ;;
    --no-start)  DO_START=0; shift ;;
    --keep-up)   KEEP_UP=1; shift ;;
    --arms)      ARMS="${2//,/ }"; shift 2 ;;
    --tasks)     TASKS="$2"; shift 2 ;;
    --runs)      RUNS="$2"; shift 2 ;;
    --max-tokens) MAXTOK="$2"; shift 2 ;;
    -h|--help)   sed -n '2,20p' "$0"; exit 0 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

say() { printf '\n\033[1;36m== %s ==\033[0m\n' "$*"; }
die() { printf '\033[1;31mFAIL: %s\033[0m\n' "$*" >&2; exit 1; }

# ---- Phase 0: unit tests + selftest (no infra) --------------------------------
say "Phase 0 — unit tests (no infra needed)"
node --test \
  "$ROOT"/frontend/server/context*.test.mjs \
  "$ROOT"/frontend/server/agentContext*.test.mjs \
  "$ROOT"/frontend/server/agentRuntimeRules.test.mjs \
  "$ROOT"/frontend/server/agentSession.test.mjs \
  || die "unit tests failed"

say "Phase 0 — benchmark self-test"
node "$ROOT/benchmarks/agentic/context/run.mjs" --selftest || die "benchmark selftest failed"

if [[ "$DO_LIVE" -eq 0 ]]; then
  say "Done (unit-only)."
  exit 0
fi

# ---- stack lifecycle ----------------------------------------------------------
STACK_UP=0
stop_stack() {
  [[ "$DO_START" -eq 1 && "$STACK_UP" -eq 1 && "$KEEP_UP" -eq 0 ]] || return 0
  echo "stopping stack..."
  "$ROOT/srun.sh" stop >/dev/null 2>&1 || true
  STACK_UP=0
}
trap 'stop_stack' EXIT INT TERM

wait_ready() {
  local url="$1" label="$2" tries="${3:-120}"
  echo -n "waiting for $label"
  for ((i=0; i<tries; i++)); do
    if curl -fsS -o /dev/null "$url" 2>/dev/null; then echo " ok"; return 0; fi
    echo -n "."; sleep 2
  done
  echo " timeout"; return 1
}

arm_env() {
  case "$1" in
    baseline|context-preview) export DS4_CONTEXT_WIKI_ENABLED=0 DS4_CONTEXT_PREVIEW_ONLY=1 ;;
    context-enabled)          export DS4_CONTEXT_WIKI_ENABLED=1 DS4_CONTEXT_PREVIEW_ONLY=0 ;;
    *) die "unknown arm: $1" ;;
  esac
  export DS4_CONTEXT_LOG_TELEMETRY=1
}

# ---- Phase 1: live A/B, one stack per arm -------------------------------------
[[ -x "$ROOT/srun.sh" ]] || die "srun.sh not found/executable at $ROOT"
FAILED=0
for arm in $ARMS; do
  say "Phase 1 — arm: $arm"
  arm_env "$arm"

  if [[ "$DO_START" -eq 1 ]]; then
    LOG="$LOGDIR/srun-$arm.log"
    echo "starting stack (--no-gui), log: $LOG"
    "$ROOT/srun.sh" --no-gui --host "$HOST" --port "$PORT" >"$LOG" 2>&1 &
    STACK_UP=1
    wait_ready "$BASE/api/agent/status" "frontend" 60 || { echo "see $LOG"; FAILED=1; stop_stack; continue; }
    wait_ready "$BASE/v1/models" "model backend" 180 || { echo "see $LOG"; FAILED=1; stop_stack; continue; }
  fi

  echo "running benchmark: arms=$arm tasks=$TASKS runs=$RUNS"
  DS4_BENCH_BASE="$BASE" node "$ROOT/benchmarks/agentic/context/run.mjs" \
    --live --gate --arms "$arm" --tasks "$TASKS" --runs "$RUNS" --max-tokens "$MAXTOK" \
    || { echo "benchmark arm $arm gate/run failed"; FAILED=1; }

  stop_stack
done

say "Summaries"
ls -1dt "$ROOT"/benchmarks/agentic/context/runs/*/summary.json 2>/dev/null | head -n "$(wc -w <<<"$ARMS")" || echo "(no summaries written)"

[[ "$FAILED" -eq 0 ]] || die "one or more arms failed — inspect logs in $LOGDIR and summaries above"
say "Done — all phases passed."
