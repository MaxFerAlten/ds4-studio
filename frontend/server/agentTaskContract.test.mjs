// P2 (plan §7.2 pass A): the task contract is read from the user's words alone
// and reaches the answer's prompt; a later turn's extractor never sees an answer.
import assert from "node:assert/strict";
import { test } from "node:test";
import { startFakeBackend, startServerChild } from "./agent/agentRunParityHarness.mjs";
import { TASK_CONTRACT_PROMPT } from "./taskContract.mjs";

const headers = { "Content-Type": "application/json", "X-Agent-Session-Key": "task-contract" };
const question = "Per una successione con primo termine u e passo d, il termine u_k è:\nA) u + k d\nB) u + (k-1) d";
const answer = "PREVIOUS_ANSWER: B.";
const evaluate = { content: JSON.stringify({ verification_requested: false, tool_evaluation_requested: true,
  required_tools: [], tool_selection: [], skill_actions: [] }), finish: "stop" };
const contract = { content: JSON.stringify({ task_kind: "select_option", options: ["A", "B"],
  hypotheses: [{ statement: "u_k = u + (k-1) d", quote: "u_k = u + (k-1) d" }],
  open_conventions: ["where the index k starts"] }), finish: "stop" };

test("js engine: the task contract comes from the user's words and reaches the answer's prompt", async () => {
  const backend = await startFakeBackend({ turns: [
    { content: answer, finish: "stop" },
    evaluate, contract, { content: "Raccomando SageMath.", finish: "stop" }
  ] });
  const server = await startServerChild(backend);
  try {
    await fetch(`${server.base}/api/agent/start`, { method: "POST", headers, body: "{}" });
    for (const message of [question, "valuta quale strumento usare"]) {
      const res = await fetch(`${server.base}/api/agent/chat`, { method: "POST", headers, body: JSON.stringify({ message }) });
      var sse = await res.text();
      assert.equal(res.status, 200, sse);
    }
    const contractEvent = JSON.parse(sse.match(/event: agent_task_contract\ndata: (.*)/)[1]);
    assert.deepEqual(contractEvent.openConventions, ["where the index k starts"]);
    // The quote is not the user's words (it restates option B): dropped.
    assert.deepEqual(contractEvent.hypotheses, []);
    assert.equal(contractEvent.droppedHypotheses, 1);

    const calls = backend.log.filter((entry) => entry.path === "POST /v1/chat/completions");
    const extraction = calls.find((call) => call.body.messages[0]?.content === TASK_CONTRACT_PROMPT);
    const sent = JSON.stringify(extraction.body.messages);
    assert.match(sent, /primo termine u e passo d/);
    assert.match(sent, /valuta quale strumento usare/);
    assert.doesNotMatch(sent, /PREVIOUS_ANSWER/);
    const final = JSON.stringify(calls.at(-1).body.messages);
    assert.match(final, /TASK_CONTRACT \(read from the user's question alone, before any answer\)/);
    assert.match(final, /- where the index k starts/);
  } finally {
    server.stop();
    await backend.close();
  }
});

// Critique 2026-10-27: the question came as a picture, so the contract of the
// later "verify it" turn had no options. The extractor now gets the picture.
test("js engine: a later turn's contract reads the question from the picture the user sent", async () => {
  const picture = "data:image/png;base64,iVBORw0KGgo=";
  const backend = await startFakeBackend({ turns: [
    { content: "Ho letto il quiz.", finish: "stop" },
    evaluate, contract, { content: "Raccomando SageMath.", finish: "stop" }
  ] });
  const server = await startServerChild(backend);
  try {
    const session = { ...headers, "X-Agent-Session-Key": "task-contract-picture" };
    await fetch(`${server.base}/api/agent/start`, { method: "POST", headers: session, body: "{}" });
    for (const body of [{ message: "analizza immagine", images: [picture] }, { message: "valuta quale strumento usare" }]) {
      const res = await fetch(`${server.base}/api/agent/chat`, { method: "POST", headers: session, body: JSON.stringify(body) });
      assert.equal(res.status, 200, await res.text());
    }
    const calls = backend.log.filter((entry) => entry.path === "POST /v1/chat/completions");
    const extraction = calls.find((call) => call.body.messages[0]?.content === TASK_CONTRACT_PROMPT);
    const content = extraction.body.messages[1].content;
    assert.ok(Array.isArray(content), JSON.stringify(content));
    assert.deepEqual(content.slice(1), [{ type: "image_url", image_url: { url: picture } }]);
    assert.match(content[0].text, /analizza immagine/);
  } finally {
    server.stop();
    await backend.close();
  }
});
