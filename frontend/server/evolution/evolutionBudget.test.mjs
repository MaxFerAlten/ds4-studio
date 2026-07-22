/** Test origin: DS4 acceptance requirements BEH-LOOP-002 and SEC-LOOP-002. */

import assert from "node:assert/strict";
import test from "node:test";

import { classifyFailureSignature, decideLoopContinuation, deriveBudgetState, recordModelUsage } from "./evolutionBudget.mjs";

test("BEH-LOOP-002 derives monotonic usage from ledger events", () => {
  const task = { budgets: { maxTotalPromptTokens: 10, maxTotalCompletionTokens: 10, maxTotalWallTimeMs: 100, maxModelCallsPerRevision: 3 } };
  const events = [
    { type: "MODEL_CALL_COMPLETED", revision: 1, payload: recordModelUsage("critic", { promptTokens: 3, completionTokens: 2, totalTokens: 5 }, { wallTimeMs: 10 }) },
    { type: "MODEL_CALL_COMPLETED", revision: 1, payload: recordModelUsage("proposer", { promptTokens: 4, completionTokens: 1, totalTokens: 5 }, { wallTimeMs: 20 }) }
  ];
  const state = deriveBudgetState(task, events);
  assert.equal(state.promptTokens, 7);
  assert.equal(state.completionTokens, 3);
  assert.equal(state.callsThisRevision, 2);
  assert.equal(state.exceeded, false);
});

test("SEC-LOOP-002 stops at budget and gives stable failure signatures", () => {
  assert.equal(decideLoopContinuation({ state: "REJECTED" }, { exceeded: true }).reasonCode, "BUDGET_EXHAUSTED");
  const a = classifyFailureSignature({ status: "failed", hardFailures: ["B", "A"] });
  const b = classifyFailureSignature({ status: "failed", hardFailures: ["A", "B"] });
  assert.equal(a, b);
});
