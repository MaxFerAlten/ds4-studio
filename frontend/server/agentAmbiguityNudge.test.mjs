// Regression: STOP_AMBIGUITY_LOOP ended a live agent turn as soon as two steps
// sounded ambiguous, discarding the work.  The second ambiguous step now earns
// a nudge (guidance before the next model call, tool calls still run) and the
// turn reaches its final answer.
import assert from "node:assert/strict";
import { test } from "node:test";
import { startFakeBackend, startServerChild } from "./agent/agentRunParityHarness.mjs";

const SESSION = "ambiguity-nudge";
const headers = { "Content-Type": "application/json", "X-Agent-Session-Key": SESSION };
const read = (id) => ({ id, name: "read", arguments: { path: "tests/fixtures/conformance/big-read.txt", start_line: 1 } });

test("js engine: a repeated ambiguity step is nudged, not fatal", async () => {
  const backend = await startFakeBackend({
    turns: [
      { content: "Given the ambiguity, I read the fixture first.", toolCalls: [read("a1")], finish: "tool_calls" },
      { content: "It could mean the other file; reading again.", toolCalls: [read("a2")], finish: "tool_calls" },
      { content: "The fixture is a plain text file used by the conformance tests.", finish: "stop" }
    ]
  });
  const server = await startServerChild(backend);
  try {
    const start = await fetch(`${server.base}/api/agent/start`, { method: "POST", headers, body: "{}" });
    assert.equal(start.status, 200, await start.text());

    const res = await fetch(`${server.base}/api/agent/chat`, {
      method: "POST", headers, body: JSON.stringify({ message: "what is the conformance fixture?" })
    });
    const sse = await res.text();
    assert.equal(res.status, 200);
    assert.doesNotMatch(sse, /event: agent_error/, sse.slice(-1500));
    assert.doesNotMatch(sse, /"finish_reason":"loop_guard"/);
    assert.match(sse, /STOP_AMBIGUITY_LOOP/, "the nudge is surfaced as a warning");
    assert.match(sse, /plain text file used by the conformance tests/);

    const calls = backend.log.filter((entry) => entry.path === "POST /v1/chat/completions");
    assert.equal(calls.length, 3);
    const nudged = calls[2].body.messages.some((m) =>
      m.role === "user" && typeof m.content === "string" && m.content.includes("Choose an operating assumption"));
    assert.ok(nudged, "the third model call carries the guidance");
  } finally {
    server.stop();
    await backend.close();
  }
});
