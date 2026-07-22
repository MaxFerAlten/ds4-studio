/**
 * DS4 Evolution — independently designed clean-room implementation.
 * Behavioral inputs: docs/evolution/acceptance-contract.md loop budget requirements.
 * External source code or prompts copied: none.
 * Existing DS4 mechanisms reused: immutable Evolution ledger events.
 */

import { hashJson } from "./evolutionIntegrity.mjs";

function positive(value, fallback = 0) {
  return Number.isSafeInteger(value) && value >= 0 ? value : fallback;
}

export function deriveBudgetState(taskContract, events = []) {
  const budgets = taskContract?.budgets ?? {};
  const modelEvents = events.filter((event) => event.type === "MODEL_CALL_COMPLETED");
  const promptTokens = modelEvents.reduce((sum, event) => sum + positive(event.payload?.usage?.promptTokens), 0);
  const completionTokens = modelEvents.reduce((sum, event) => sum + positive(event.payload?.usage?.completionTokens), 0);
  const wallTimeMs = events.reduce((sum, event) => sum + positive(event.payload?.wallTimeMs), 0);
  const revision = events.reduce((max, event) => Math.max(max, positive(event.revision)), 0);
  const callsThisRevision = modelEvents.filter((event) => event.revision === revision).length;
  const limits = {
    promptTokens: budgets.maxTotalPromptTokens ?? budgets.maxPromptTokensPerRevision,
    completionTokens: budgets.maxTotalCompletionTokens ?? budgets.maxCompletionTokensPerRevision,
    wallTimeMs: budgets.maxTotalWallTimeMs ?? budgets.maxWallTimeMsPerRevision,
    callsThisRevision: budgets.maxModelCallsPerRevision ?? Number.MAX_SAFE_INTEGER
  };
  const exceeded = promptTokens > limits.promptTokens || completionTokens > limits.completionTokens ||
    wallTimeMs > limits.wallTimeMs || callsThisRevision >= limits.callsThisRevision;
  return Object.freeze({ promptTokens, completionTokens, wallTimeMs, callsThisRevision, revision, limits: Object.freeze(limits), exceeded });
}

export function recordModelUsage(role, usage, extras = {}) {
  if (![usage?.promptTokens, usage?.completionTokens, usage?.totalTokens].every(Number.isSafeInteger)) {
    throw new TypeError("complete model usage is required");
  }
  return Object.freeze({ role, usage: Object.freeze({ ...usage }), calls: positive(extras.calls, 1), repairs: positive(extras.repairs), wallTimeMs: positive(extras.wallTimeMs) });
}

export function classifyFailureSignature(evaluation) {
  return hashJson({
    status: evaluation?.status ?? "unknown",
    hardFailures: [...(evaluation?.hardFailures ?? [])].sort(),
    violations: [...(evaluation?.evaluators ?? [])]
      .flatMap((entry) => entry.violations ?? [])
      .map(String)
      .sort()
  });
}

export function decideLoopContinuation(run, budgetState) {
  if (["MANUAL_REVIEW", "COMPLETED", "STOPPED", "FAILED"].includes(run?.state)) {
    return Object.freeze({ continue: false, reasonCode: `STATE_${run.state}` });
  }
  if (budgetState?.exceeded) return Object.freeze({ continue: false, reasonCode: "BUDGET_EXHAUSTED" });
  if (!["BASELINE_READY", "REJECTED", "PROMOTED"].includes(run?.state)) {
    return Object.freeze({ continue: false, reasonCode: "STATE_NOT_RUNNABLE" });
  }
  return Object.freeze({ continue: true, reasonCode: null });
}
