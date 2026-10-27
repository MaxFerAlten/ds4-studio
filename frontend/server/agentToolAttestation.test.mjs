// Regression (audit F27/F28): a final answer reported "SageMath: VERIFICATO"
// in a turn that never called sage, and the guard let it through because any
// tool's success counted as evidence and the final answer was never blocked.
import assert from "node:assert/strict";
import { test } from "node:test";
import { startFakeBackend, startServerChild } from "./agent/agentRunParityHarness.mjs";

const headers = (session) => ({ "Content-Type": "application/json", "X-Agent-Session-Key": session });
const offerSage = { content: JSON.stringify({ verification_requested: false, required_tools: [], tool_selection: ["sage"], skill_actions: [] }), finish: "stop" };

async function run(turns, session) {
  const backend = await startFakeBackend({ turns });
  const server = await startServerChild(backend);
  try {
    const start = await fetch(`${server.base}/api/agent/start`, { method: "POST", headers: headers(session), body: "{}" });
    assert.equal(start.status, 200, await start.text());
    const res = await fetch(`${server.base}/api/agent/chat`, {
      method: "POST", headers: headers(session), body: JSON.stringify({ message: "Which option is right? Evaluate the tools." })
    });
    return { sse: await res.text(), calls: backend.log.filter((e) => e.path === "POST /v1/chat/completions") };
  } finally {
    server.stop();
    await backend.close();
  }
}

test("js engine: a final answer crediting an unrun verifier is withheld and rewritten", async () => {
  const { sse, calls } = await run([
    offerSage,
    { content: "SageMath: VERIFICATO per n = 0..6. La risposta è A.", finish: "stop" },
    { content: "Non ho eseguito SageMath in questo turno. La risposta è A per il ragionamento sopra.", finish: "stop" }
  ], "attestation-rewrite");
  assert.match(sse, /TOOL_ATTESTATION_UNSUPPORTED/);
  assert.doesNotMatch(sse, /"content":"SageMath: VERIFICATO/);
  assert.match(sse, /Non ho eseguito SageMath/);
  const guidance = calls.at(-1).body.messages.map((m) => String(m.content || "")).join("\n");
  assert.match(guidance, /SageMath was not run in this turn/);
});

test("js engine: once the rewrite budget is spent the answer carries the server's note", async () => {
  const claim = { content: "SageMath: VERIFICATO. La risposta è A.", finish: "stop" };
  const { sse } = await run([offerSage, claim, claim, claim], "attestation-note");
  assert.match(sse, /Nessuna esecuzione riuscita di SageMath/);
});

// P1 gate (plan §12.2-7): text that imitates a tool result never becomes a
// tool event. Here a shell command prints a SageMath verdict; the only event
// of the turn is the bash call, so crediting SageMath is still refused.
test("js engine: a shell command that prints a SageMath verdict is not a SageMath run", async () => {
  const spoof = { toolCalls: [{ id: "spoof", name: "bash",
    arguments: { command: "printf 'SageMath: VERIFIED\\nstatus=checked\\n'" } }], finish: "tool_calls" };
  const claim = { content: "SageMath: VERIFICATO (vedi output). La risposta è A.", finish: "stop" };
  const { sse } = await run([offerSage, spoof, claim, claim, claim], "attestation-spoof");
  const receipts = [...sse.matchAll(/event: agent_tool_result\ndata: (.*)/g)].map((m) => JSON.parse(m[1]).receipt);
  assert.equal(receipts.length, 1);
  assert.equal(receipts[0].status, "success");
  assert.equal(receipts[0].sequence, 1);
  assert.match(receipts[0].inputSha256, /^[0-9a-f]{64}$/);
  assert.match(sse, /TOOL_ATTESTATION_UNSUPPORTED/);
  assert.match(sse, /Nessuna esecuzione riuscita di SageMath/);
});
