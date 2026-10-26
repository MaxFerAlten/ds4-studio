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

// Regression: inspections refused past their own cap still spent the shared
// utility budget, so the next lean_prepare ended the proof with
// LEAN_UTILITY_BUDGET_EXHAUSTED before any proof was attempted.
test("js engine: refused lean_inspect calls do not spend the lean_prepare budget", async () => {
  const inspect = (id) => ({ toolCalls: [{ id, name: "lean_inspect", arguments: { symbols: [`Nat.add_comm_${id}`] } }], finish: "tool_calls" });
  const backend = await startFakeBackend({ turns: [
    { content: JSON.stringify({ verification_requested: false, required_tools: [], tool_selection: ["lean_check"], skill_actions: [] }), finish: "stop" },
    ...["i1", "i2", "i3", "i4", "i5", "i6"].map(inspect),
    { toolCalls: [{ id: "p1", name: "lean_prepare", arguments: { claim: "c", target_declaration: "t", target_statement: "theorem t : True" } }], finish: "tool_calls" },
    { content: "Done.", finish: "stop" }
  ] });
  const server = await startServerChild(backend, { env: { DS4_AGENT_LEAN_MAX_UTILITY_CHECKS: "6", DS4_LEAN_ENABLED: "0" } });
  try {
    await fetch(`${server.base}/api/agent/start`, { method: "POST", headers, body: "{}" });
    const res = await fetch(`${server.base}/api/agent/chat`, {
      method: "POST", headers, body: JSON.stringify({ message: "inspect then prepare a Lean goal" })
    });
    const sse = await res.text();
    assert.equal(res.status, 200, sse);
    const results = [...sse.matchAll(/event: agent_tool_result\ndata: (.*)\n/g)].map((m) => JSON.parse(m[1]));
    assert.equal(results.filter((r) => r.content.includes("LEAN_INSPECT_BUDGET_EXHAUSTED")).length, 2);
    const prepare = results.find((r) => r.id === "p1");
    assert.ok(prepare, sse.slice(-1500));
    assert.doesNotMatch(prepare.content, /LEAN_UTILITY_BUDGET_EXHAUSTED/);
  } finally {
    server.stop();
    await backend.close();
  }
});
