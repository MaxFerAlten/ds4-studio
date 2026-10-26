import assert from "node:assert/strict";
import { test } from "node:test";
import { startFakeBackend, startServerChild } from "./agent/agentRunParityHarness.mjs";

test("a negative verification answer ends the agent turn instead of looping", async () => {
  const answer = "The Lean check failed. The theorem has not been verified; diagnostics are shown above.";
  const backend = await startFakeBackend({ turns: [{ content: answer, finish: "stop" }] });
  const server = await startServerChild(backend);
  try {
    const headers = { "Content-Type": "application/json", "X-Agent-Session-Key": "negative-claim-stop" };
    const start = await fetch(`${server.base}/api/agent/start`, { method: "POST", headers, body: "{}" });
    assert.equal(start.status, 200, await start.text());
    const reply = await fetch(`${server.base}/api/agent/chat`, {
      method: "POST", headers, body: JSON.stringify({ message: "Verify the theorem with Lean." })
    });
    const sse = await reply.text();
    assert.equal(reply.status, 200, sse);
    assert.equal(backend.log.filter((entry) => entry.path === "POST /v1/chat/completions").length, 1, sse);
    assert.match(sse, /The theorem has not been verified/);
    assert.doesNotMatch(sse, /STOP_UNSUPPORTED_VERIFIED_CLAIM|AGENT_ITERATION_LIMIT|event: agent_error/);
  } finally {
    server.stop();
    await backend.close();
  }
});
