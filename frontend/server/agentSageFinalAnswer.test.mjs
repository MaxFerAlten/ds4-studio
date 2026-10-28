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
  const answerReading = { content: JSON.stringify({ selected: "D", options: [
    { label: "A", verdict: "excluded", instance: "n=4" },
    { label: "B", verdict: "excluded", instance: "n=4" },
    { label: "C", verdict: "excluded", instance: "" },
    { label: "D", verdict: "selected", instance: "n=4" }
  ], values: [] }), finish: "stop" };
  const toolReading = { content: JSON.stringify({ options: [
    { label: "A", tool_output: 1, tool_value: "4*x*y^3", reference_value: "4*x^3*y" },
    { label: "B", tool_output: 1, tool_value: "9*x^3*y", reference_value: "4*x^3*y" },
    { label: "C", tool_output: null, tool_value: "", reference_value: "" }
  ], values: [] }), finish: "stop" };
  const backend = await startFakeBackend({ turns: [
    { content: JSON.stringify({ verification_requested: true, required_tools: ["sage"], tool_selection: ["sage"], skill_actions: [] }), finish: "stop" },
    contract,
    ...sageCalls.map((call) => ({ toolCalls: [call], finish: "tool_calls" })),
    { content: "FINAL_ANSWER_AFTER_SAGE: option D.", finish: "stop" },
    answerReading, toolReading
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
    // Reading 1 saw the answer only; reading 2 Sage's printed output only, numbered as the receipts.
    const calls = backend.log.filter((entry) => entry.path === "POST /v1/chat/completions");
    const first = JSON.parse(calls.at(-2).body.messages[1].content);
    const second = JSON.parse(calls.at(-1).body.messages[1].content);
    assert.equal(first.final_answer, "FINAL_ANSWER_AFTER_SAGE: option D.");
    assert.equal(first.tool_outputs, undefined);
    assert.equal(second.final_answer, undefined);
    assert.equal(second.tool_outputs[0].number, 1);
    assert.match(second.tool_outputs[0].text, /4\*x\^3\*y/);
  } finally {
    server.stop();
    await backend.close();
  }
});

// Plan I2 (critique 2026-10-27): a final answer that states a value Sage did
// not print is rewritten; Sage itself compares the stated and printed values.
test("js engine: a stated value that differs from what Sage printed is rewritten", {
  skip: !sageInstalled && "SageMath is not installed", timeout: 300000
}, async () => {
  const contract = { content: JSON.stringify({ task_kind: "compute", options: [], hypotheses: [], open_conventions: [] }), finish: "stop" };
  const answerValues = (answerValue) => ({ content: JSON.stringify({ selected: null, options: [], values: [
    { quantity: "T_2 for n=4", answer_value: answerValue }
  ] }), finish: "stop" });
  const printedValues = { content: JSON.stringify({ options: [], values: [
    { quantity: "T_2 for n=4", tool_output: 1, printed_value: "4*x^3*y" }
  ] }), finish: "stop" };
  const backend = await startFakeBackend({ turns: [
    { content: JSON.stringify({ verification_requested: true, required_tools: ["sage"], tool_selection: ["sage"], skill_actions: [] }), finish: "stop" },
    contract,
    ...sageCalls.map((call) => ({ toolCalls: [call], finish: "tool_calls" })),
    { content: "WRONG_VALUE: T_2 = 3x^3y.", finish: "stop" },
    answerValues("3*x^3*y"), printedValues,
    { content: "RIGHT_VALUE: T_2 = 4x^3y.", finish: "stop" },
    answerValues("4*x^3*y"), printedValues
  ] });
  const server = await startServerChild(backend);
  try {
    const headers = { "Content-Type": "application/json", "X-Agent-Session-Key": "sage-value-integrity" };
    await fetch(`${server.base}/api/agent/start`, { method: "POST", headers, body: "{}" });
    const res = await fetch(`${server.base}/api/agent/chat`, {
      method: "POST", headers, body: JSON.stringify({ message: "Compute the second term of (x+y)^4 with SageMath." })
    });
    const sse = await res.text();
    assert.equal(res.status, 200, sse);
    assert.match(sse, /VALUE_INTEGRITY_MISMATCH/);
    const text = [...sse.matchAll(/event: agent_text\ndata: (.*)/g)].map((m) => JSON.parse(m[1]).content).join("");
    assert.doesNotMatch(text, /WRONG_VALUE/);
    assert.match(text, /RIGHT_VALUE: T_2 = 4x\^3y\.[\s\S]*- Valori calcolati riportati: 1\/1 uguali all'output$/);
    const calls = backend.log.filter((entry) => entry.path === "POST /v1/chat/completions");
    const rewrite = JSON.stringify(calls.at(-3).body.messages);
    assert.match(rewrite, /the answer says 3\*x\^3\*y, output #1 printed 4\*x\^3\*y/);
    // The model saw what Sage printed together with the READY marker.
    assert.match(rewrite, /SAGE_AUTHORITATIVE_RESULT_READY\\n\\nPrinted output of the validated run/);
  } finally {
    server.stop();
    await backend.close();
  }
});
