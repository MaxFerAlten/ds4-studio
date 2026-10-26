// Regression: in a verification plan the model writes the final answer after
// Sage is done. That answer was withheld as Sage-owned prose, but Sage's own
// publication path does not run inside a plan, so the answer was committed to
// the session and never reached the client.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { startFakeBackend, startServerChild } from "./agent/agentRunParityHarness.mjs";

// A compute and a validate call recorded from a live turn; replayed against
// the real Sage, they leave the run validated and ready to publish.
const sageCalls = JSON.parse(readFileSync(new URL("./fixtures/sage-binomial-validated-calls.json", import.meta.url), "utf8"));
const sageInstalled = ["/usr/local/bin/sage", "/usr/bin/sage"].some((path) => existsSync(path));

test("js engine: a verification plan's final answer after Sage reaches the client", {
  skip: !sageInstalled && "SageMath is not installed", timeout: 300000
}, async () => {
  const backend = await startFakeBackend({ turns: [
    { content: JSON.stringify({ verification_requested: true, required_tools: ["sage"], tool_selection: ["sage"], skill_actions: [] }), finish: "stop" },
    ...sageCalls.map((call) => ({ toolCalls: [call], finish: "tool_calls" })),
    { content: "FINAL_ANSWER_AFTER_SAGE: option D.", finish: "stop" }
  ] });
  const server = await startServerChild(backend);
  try {
    const headers = { "Content-Type": "application/json", "X-Agent-Session-Key": "sage-final-answer" };
    const start = await fetch(`${server.base}/api/agent/start`, { method: "POST", headers, body: "{}" });
    assert.equal(start.status, 200, await start.text());
    const res = await fetch(`${server.base}/api/agent/chat`, {
      method: "POST", headers, body: JSON.stringify({ message: "Which option is the general term of (x+y)^n? Check it with SageMath." })
    });
    const sse = await res.text();
    assert.equal(res.status, 200);
    assert.match(sse, /Report SageMath validato/);
    assert.match(sse, /event: agent_done/);
    assert.match(sse, /event: agent_text\ndata: \{"content":"FINAL_ANSWER_AFTER_SAGE/);
  } finally {
    server.stop();
    await backend.close();
  }
});
