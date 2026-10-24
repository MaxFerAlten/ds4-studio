// Regression: lean_check with task_mode=utility bypassed the proof tracker,
// so a model "proving" through utility checks looped for 12+ rounds with no
// attempt or wall-clock budget.  Utility checks are now capped per turn.
import assert from "node:assert/strict";
import { test } from "node:test";
import { startFakeBackend, startServerChild } from "./agent/agentRunParityHarness.mjs";

const SESSION = "lean-utility-budget";
const headers = { "Content-Type": "application/json", "X-Agent-Session-Key": SESSION };
const utilityCheck = (id) => ({
  id,
  name: "lean_check",
  arguments: { code: `theorem t_${id} : True := trivial`, task_mode: "utility" }
});

test("js engine: utility lean_check calls stop at the per-turn budget", async () => {
  const backend = await startFakeBackend({
    turns: [
      { toolCalls: [utilityCheck("u1")], finish: "tool_calls" },
      { toolCalls: [utilityCheck("u2")], finish: "tool_calls" },
      { toolCalls: [utilityCheck("u3")], finish: "tool_calls" },
      { content: "The checks did not establish a verified proof.", finish: "stop" }
    ]
  });
  const server = await startServerChild(backend, { env: { DS4_AGENT_LEAN_MAX_UTILITY_CHECKS: "2" } });
  try {
    const start = await fetch(`${server.base}/api/agent/start`, { method: "POST", headers, body: "{}" });
    assert.equal(start.status, 200, await start.text());

    const res = await fetch(`${server.base}/api/agent/chat`, {
      method: "POST", headers, body: JSON.stringify({ message: "prove it with lean" })
    });
    const sse = await res.text();
    assert.equal(res.status, 200);
    assert.match(sse, /did not establish a verified proof/);

    const calls = backend.log.filter((entry) => entry.path === "POST /v1/chat/completions");
    assert.equal(calls.length, 4);
    const toolResults = calls[3].body.messages.filter((m) => m.role === "tool");
    const contents = toolResults.map((m) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content)));
    assert.equal(contents.filter((c) => c.includes("LEAN_UTILITY_BUDGET_EXHAUSTED")).length, 1,
      contents.map((c) => c.slice(0, 120)).join("\n---\n"));
    assert.match(contents.at(-1), /LEAN_UTILITY_BUDGET_EXHAUSTED/);
    assert.match(contents.at(-1), /utilityChecks=2\/2/);
  } finally {
    server.stop();
    await backend.close();
  }
});
