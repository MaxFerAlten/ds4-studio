#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

export DS4_SKILLS_DIR="$ROOT/skills"

echo "[1/5] Fixture files"
test -s "$DS4_SKILLS_DIR/soul/SKILL.md"
test -s "$DS4_SKILLS_DIR/ethic/SKILL.md"

echo "[2/5] Build deterministic tests"
if command -v hipcc &>/dev/null; then
    make GPU_BACKEND=rocm ds4_agent_test ds4_test ds4-wrapper
elif command -v nvcc &>/dev/null; then
    make ds4_agent_test ds4_test ds4-wrapper
else
    make ds4_agent_test
    echo "  (no GPU compiler — skipping ds4_test, ds4-wrapper)"
fi

echo "[3/5] Agent C tests"
./ds4_agent_test

echo "[4/5] Server C tests"
if [ -x ./ds4_test ]; then
    echo "  (ds4_test requires a model — compile-only check passed)"
else
    echo "  (ds4_test not built — skipped)"
fi

echo "[5/5] Frontend tests"
node --test frontend/src/App.test.mjs

python3 - <<'PY'
from pathlib import Path

agent = Path("ds4_agent.c").read_text()
runtime = Path("ds4_agent_runtime.c").read_text()
app = Path("frontend/src/App.jsx").read_text()

forbidden = [
    "Soul skill loaded.",
    "Ethic skill loaded.",
]
for token in forbidden:
    assert token not in agent, f"forbidden token found in ds4_agent.c: {token}"
    assert token not in runtime, f"forbidden token found in ds4_agent_runtime.c: {token}"

start = app.index("async function startNewSession")
end = app.index("\n  async function saveHistorySettings", start)
body = app[start:end]
assert '"/api/agent/stop"' not in body, "startNewSession still calls /api/agent/stop"
assert "setAgentMode(false)" not in body, "startNewSession still sets agentMode(false)"
assert "requestFreshNativeAgentSession" in body, "startNewSession missing requestFreshNativeAgentSession"
PY

echo "skill autoload deterministic certification: PASS"
