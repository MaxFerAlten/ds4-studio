/** Test origin: DS4 acceptance requirements BEH-LOOP-002, SEC-LOOP-002, BEH-BUDGET-003..006, SEC-LOOP-007. */

import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyFailureSignature,
  decideLoopContinuation,
  deriveBudgetState,
  deriveImprovementState,
  recordModelUsage
} from "./evolutionBudget.mjs";

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

test("BEH-BUDGET-003 maximize improvement resets streak", () => {
  const taskContract = {
    budgets: { maxNoImprovementRevisions: 3 },
    metrics: [{ name: "score", direction: "maximize", required: true, baselineTolerance: 0 }]
  };
  const baselineEvaluation = { aggregateMetrics: { score: 1 } };
  const revisionEvaluations = [
    { revision: 1, outcome: "REJECTED", evaluation: { aggregateMetrics: { score: 1 }, hardFailures: [] } },
    { revision: 2, outcome: "PROMOTED", evaluation: { aggregateMetrics: { score: 2 }, hardFailures: [] } }
  ];
  const state = deriveImprovementState({ taskContract, baselineEvaluation, revisionEvaluations });
  assert.equal(state.noImprovementStreak, 0);
  assert.equal(state.lastImprovedRevision, 2);
  assert.equal(state.exhausted, false);
});

test("BEH-BUDGET-004 minimize improvement resets streak", () => {
  const taskContract = {
    budgets: { maxNoImprovementRevisions: 3 },
    metrics: [{ name: "latency", direction: "minimize", required: true, baselineTolerance: 0 }]
  };
  const baselineEvaluation = { aggregateMetrics: { latency: 100 } };
  const revisionEvaluations = [
    { revision: 1, outcome: "REJECTED", evaluation: { aggregateMetrics: { latency: 100 }, hardFailures: [] } },
    { revision: 2, outcome: "PROMOTED", evaluation: { aggregateMetrics: { latency: 50 }, hardFailures: [] } }
  ];
  const state = deriveImprovementState({ taskContract, baselineEvaluation, revisionEvaluations });
  assert.equal(state.noImprovementStreak, 0);
  assert.equal(state.lastImprovedRevision, 2);
});

test("BEH-BUDGET-005 identical metrics increment streak", () => {
  const taskContract = {
    budgets: { maxNoImprovementRevisions: 3 },
    metrics: [{ name: "score", direction: "maximize", required: true, baselineTolerance: 0 }]
  };
  const baselineEvaluation = { aggregateMetrics: { score: 1 } };
  // Simulates a human-approved MANUAL_REVIEW -> PROMOTED transition for a neutral revision.
  const revisionEvaluations = [
    { revision: 1, outcome: "PROMOTED", evaluation: { aggregateMetrics: { score: 1 }, hardFailures: [] } }
  ];
  const state = deriveImprovementState({ taskContract, baselineEvaluation, revisionEvaluations });
  assert.equal(state.noImprovementStreak, 1);
  assert.equal(state.lastImprovedRevision, null);
});

test("BEH-BUDGET-006 rejected revision increments streak", () => {
  const taskContract = {
    budgets: { maxNoImprovementRevisions: 3 },
    metrics: [{ name: "score", direction: "maximize", required: true, baselineTolerance: 0 }]
  };
  const baselineEvaluation = { aggregateMetrics: { score: 1 } };
  const revisionEvaluations = [
    { revision: 1, outcome: "REJECTED", evaluation: { aggregateMetrics: { score: 5 }, hardFailures: ["REQUIRED_EVALUATOR_FAILED:x"] } }
  ];
  const state = deriveImprovementState({ taskContract, baselineEvaluation, revisionEvaluations });
  assert.equal(state.noImprovementStreak, 1);
});

test("SEC-LOOP-007 optional metric cannot hide required regression", () => {
  const taskContract = {
    budgets: { maxNoImprovementRevisions: 3 },
    metrics: [
      { name: "score", direction: "maximize", required: true, baselineTolerance: 0 },
      { name: "extra", direction: "maximize", required: false, baselineTolerance: 0 }
    ]
  };
  const baselineEvaluation = { aggregateMetrics: { score: 10, extra: 1 } };
  const revisionEvaluations = [
    { revision: 1, outcome: "PROMOTED", evaluation: { aggregateMetrics: { score: 5, extra: 2 }, hardFailures: [] } }
  ];
  const state = deriveImprovementState({ taskContract, baselineEvaluation, revisionEvaluations });
  assert.equal(state.noImprovementStreak, 1);
  assert.equal(state.lastImprovedRevision, null);
});
