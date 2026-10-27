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
    // P-1.4: the status under the answer is written by the server, not the model.
    const text = [...sse.matchAll(/event: agent_text\ndata: (.*)/g)].map((m) => JSON.parse(m[1]).content).join("");
    assert.match(text, /FINAL_ANSWER_AFTER_SAGE: option D\.\n\n---\n\n\*\*Verifica \(DS4 Studio\)\*\*\n\n- SageMath: VERIFICATO — eseguito in questo turno$/);
  } finally {
    server.stop();
    await backend.close();
  }
});

// P3 gate (plan §8.12, audit U34): an option's exclusion is reported as
// tool-attested only when the value it cites is in what Sage printed this turn.
test("js engine: an excluded option is attested only by a value Sage printed in this turn", {
  skip: !sageInstalled && "SageMath is not installed", timeout: 300000
}, async () => {
  const contract = { content: JSON.stringify({ task_kind: "select_option", options: ["A", "B", "C", "D"],
    hypotheses: [], open_conventions: [] }), finish: "stop" };
  const claims = { content: JSON.stringify({ selected: "D", options: [
    { label: "A", verdict: "excluded", instance: "n=4", tool_output: 1, tool_value: "4*x*y^3", reference_value: "4*x^3*y" },
    { label: "B", verdict: "excluded", instance: "n=4", tool_output: 1, tool_value: "9*x^3*y", reference_value: "4*x^3*y" },
    { label: "C", verdict: "excluded", instance: "", tool_output: null, tool_value: "" },
    { label: "D", verdict: "selected", instance: "n=4", tool_output: 1, tool_value: "4*x^3*y" }
  ] }), finish: "stop" };
  const backend = await startFakeBackend({ turns: [
    { content: JSON.stringify({ verification_requested: true, required_tools: ["sage"], tool_selection: ["sage"], skill_actions: [] }), finish: "stop" },
    contract,
    ...sageCalls.map((call) => ({ toolCalls: [call], finish: "tool_calls" })),
    { content: "FINAL_ANSWER_AFTER_SAGE: option D.", finish: "stop" },
    claims
  ] });
  const server = await startServerChild(backend);
  try {
    const headers = { "Content-Type": "application/json", "X-Agent-Session-Key": "sage-option-claims" };
    await fetch(`${server.base}/api/agent/start`, { method: "POST", headers, body: "{}" });
    const res = await fetch(`${server.base}/api/agent/chat`, {
      method: "POST", headers, body: JSON.stringify({ message: "Which option is the general term of (x+y)^n? Check it with SageMath." })
    });
    const sse = await res.text();
    assert.equal(res.status, 200, sse);
    const result = JSON.parse(sse.match(/event: agent_option_claims\ndata: (.*)/)[1]);
    assert.deepEqual(result.claims.map((claim) => [claim.label, claim.support]),
      [["A", "TOOL_ATTESTED"], ["B", "NOT_ATTESTED"], ["C", "NOT_ATTESTED"], ["D", "NOT_APPLICABLE"]]);
    const text = [...sse.matchAll(/event: agent_text\ndata: (.*)/g)].map((m) => JSON.parse(m[1]).content).join("");
    assert.match(text, /- SageMath: VERIFICATO — eseguito in questo turno\n- Esclusione di A: controesempio attestato da SageMath \(n=4\), output #1\n- Esclusione di B: non attestata da un tool \(n=4\)\n- Esclusione di C: non attestata da un tool$/);
    // The extractor saw the answer and Sage's printed output, numbered as the receipts.
    const extraction = backend.log.filter((entry) => entry.path === "POST /v1/chat/completions").at(-1);
    const sent = JSON.parse(extraction.body.messages[1].content);
    assert.equal(sent.final_answer, "FINAL_ANSWER_AFTER_SAGE: option D.");
    assert.equal(sent.tool_outputs[0].number, 1);
    assert.match(sent.tool_outputs[0].text, /4\*x\^3\*y/);
  } finally {
    server.stop();
    await backend.close();
  }
});
