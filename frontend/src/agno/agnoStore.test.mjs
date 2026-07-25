import assert from "node:assert/strict";
import test from "node:test";
import { initialAgnoRun, applyAgnoEvent } from "./agnoStore.mjs";

test("initialAgnoRun starts idle with no terminal state", () => {
  const view = initialAgnoRun();
  assert.equal(view.status, "idle");
  assert.equal(view.terminal, false);
  assert.equal(view.lastSeq, -1);
});

test("applyAgnoEvent accumulates content deltas in order", () => {
  let view = initialAgnoRun();
  view = applyAgnoEvent(view, { type: "run_started", run_id: "r1", seq: 1 });
  view = applyAgnoEvent(view, { type: "content_delta", run_id: "r1", seq: 2, content: "Hel" });
  view = applyAgnoEvent(view, { type: "content_delta", run_id: "r1", seq: 3, content: "lo" });
  assert.equal(view.content, "Hello");
  assert.equal(view.status, "running");
  assert.equal(view.runId, "r1");
});

test("applyAgnoEvent ignores duplicate or out-of-order sequence numbers", () => {
  let view = initialAgnoRun();
  view = applyAgnoEvent(view, { type: "content_delta", run_id: "r1", seq: 5, content: "A" });
  const afterFirst = view;
  view = applyAgnoEvent(view, { type: "content_delta", run_id: "r1", seq: 5, content: "B" });
  view = applyAgnoEvent(view, { type: "content_delta", run_id: "r1", seq: 3, content: "C" });
  assert.equal(view, afterFirst);
  assert.equal(view.content, "A");
});

test("applyAgnoEvent locks in terminal state and ignores further events", () => {
  let view = initialAgnoRun();
  view = applyAgnoEvent(view, { type: "run_completed", run_id: "r1", seq: 1 });
  assert.equal(view.status, "completed");
  assert.equal(view.terminal, true);
  const afterTerminal = view;
  view = applyAgnoEvent(view, { type: "content_delta", run_id: "r1", seq: 2, content: "late" });
  assert.equal(view, afterTerminal);
});

test("applyAgnoEvent captures run_failed error content", () => {
  let view = initialAgnoRun();
  view = applyAgnoEvent(view, { type: "run_failed", run_id: "r1", seq: 1, content: "boom" });
  assert.equal(view.status, "failed");
  assert.equal(view.error, "boom");
  assert.equal(view.terminal, true);
});

test("applyAgnoEvent collects tool_call and tool_result entries", () => {
  let view = initialAgnoRun();
  view = applyAgnoEvent(view, { type: "tool_call", run_id: "r1", seq: 1, target_id: "t1", content: { name: "search" } });
  view = applyAgnoEvent(view, { type: "tool_result", run_id: "r1", seq: 2, target_id: "t1", content: { ok: true } });
  assert.equal(view.toolCalls.length, 2);
  assert.equal(view.toolCalls[0].type, "tool_call");
  assert.equal(view.toolCalls[1].type, "tool_result");
});
