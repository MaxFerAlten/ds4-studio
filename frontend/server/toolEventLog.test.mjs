import assert from "node:assert/strict";
import { test } from "node:test";
import { ToolEventLog, toolOutcome } from "./toolEventLog.mjs";

test("each finished call becomes one event with its outcome, time and digests", () => {
  let clock = 1000;
  const log = new ToolEventLog({ now: () => clock });
  clock = 1250;
  const first = log.record({ call: { id: "c1", name: "sage", arguments: { b: 1, a: [2, { d: 3, c: 4 }] } },
    result: { content: "ok", isError: false }, startedAt: 1000 });
  assert.deepEqual({ ...first, inputSha256: undefined, outputSha256: undefined }, {
    sequence: 1, callId: "c1", tool: "sage", status: "success", ok: true, code: null, durationMs: 250,
    inputSha256: undefined, outputSha256: undefined
  });
  // Argument order does not change the input digest.
  const reordered = log.record({ call: { id: "c2", name: "sage", arguments: { a: [2, { c: 4, d: 3 }], b: 1 } },
    result: { content: "ok", isError: false }, startedAt: 1250 });
  assert.equal(reordered.inputSha256, first.inputSha256);
  assert.equal(reordered.outputSha256, first.outputSha256);
  assert.match(first.inputSha256, /^[0-9a-f]{64}$/);
  assert.equal(log.length, 2);
  assert.deepEqual(log.events.map((event) => event.sequence), [1, 2]);
});

test("the outcome separates blocked, cancelled, timed-out, unavailable and failed calls", () => {
  assert.equal(toolOutcome({ isError: true, guarded: true, content: "VERIFICATION_PLAN_COMPLETE" }), "blocked");
  assert.equal(toolOutcome({ isError: true, content: "x" }, { aborted: true }), "cancelled");
  assert.equal(toolOutcome({ isError: true, content: "SAGE_WALL_CLOCK_EXHAUSTED\nbudget" }), "timeout");
  assert.equal(toolOutcome({ isError: true, code: "LEAN_RUNTIME_UNAVAILABLE" }), "unavailable");
  assert.equal(toolOutcome({ isError: true, content: "LEAN_GOAL_PREPARATION\nprepared=false\ncode=LEAN_GOAL_NOT_DISCRIMINATING" }), "error");
  assert.equal(toolOutcome({ isError: false, content: "done" }), "success");
});

test("the code is the runtime's label, never a phrase", () => {
  const log = new ToolEventLog();
  const at = (content) => log.record({ call: { id: "x", name: "lean_prepare" }, result: { content, isError: true }, startedAt: 0 }).code;
  assert.equal(at("LEAN_GOAL_PREPARATION\nprepared=false\ncode=LEAN_GOAL_NOT_DISCRIMINATING"), "LEAN_GOAL_NOT_DISCRIMINATING");
  assert.equal(at("SAGE_PHASE_TRANSITION_INVALID\nstate=repair_required"), "SAGE_PHASE_TRANSITION_INVALID");
  assert.equal(at("Il codice ha fallito."), null);
  assert.equal(at("Errore:\ncode=LEAN_GOAL_SCOPE_MISMATCH"), "LEAN_GOAL_SCOPE_MISMATCH");
});

test("a receipt carries no arguments or output, only their digests", () => {
  const event = new ToolEventLog().record({ call: { id: "c", name: "bash", arguments: { command: "cat secret" } },
    result: { content: "token=abc", isError: false }, startedAt: 0 });
  const receipt = ToolEventLog.receipt(event);
  assert.deepEqual(Object.keys(receipt).sort(), ["code", "durationMs", "inputSha256", "outputSha256", "sequence", "status"]);
  assert.doesNotMatch(JSON.stringify(receipt), /secret|token/);
});

test("a successful call carries no code, even when its report starts with a label", () => {
  const event = new ToolEventLog().record({ call: { id: "s", name: "sage" },
    result: { content: "SAGE_AUTHORITATIVE_RESULT_READY", isError: false }, startedAt: 0 });
  assert.equal(event.code, null);
});
