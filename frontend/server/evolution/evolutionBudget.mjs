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

const CONCLUDED_OUTCOMES = new Set(["PROMOTED", "COMPLETED"]);

function metricValue(evaluation, name) {
  const value = evaluation?.aggregateMetrics?.[name];
  return value === undefined ? null : value;
}

function evaluateMetric(metric, previous, value) {
  if (value === null || value === undefined) return { improved: false, regressed: false, next: previous };
  if (previous === null || previous === undefined) return { improved: true, regressed: false, next: value };
  const tolerance = positive(metric.baselineTolerance, 0);
  if (metric.direction === "maximize") {
    return { improved: value > previous, regressed: metric.required && value < previous - tolerance, next: Math.max(previous, value) };
  }
  if (metric.direction === "minimize") {
    return { improved: value < previous, regressed: metric.required && value > previous + tolerance, next: Math.min(previous, value) };
  }
  const target = metric.target;
  const improved = value === target && previous !== target;
  const regressed = metric.required && previous === target && value !== target;
  return { improved, regressed, next: improved ? value : previous };
}

export function deriveImprovementState({ taskContract, baselineEvaluation, revisionEvaluations = [] }) {
  const metricList = Array.isArray(taskContract?.metrics) ? taskContract.metrics : [];
  let bestMetrics = { ...(baselineEvaluation?.aggregateMetrics ?? {}) };
  let noImprovementStreak = 0;
  let lastImprovedRevision = null;

  for (const entry of revisionEvaluations) {
    const evaluation = entry?.evaluation;
    const concluded = CONCLUDED_OUTCOMES.has(entry?.outcome);
    const hasHardFailures = (evaluation?.hardFailures?.length ?? 0) > 0;

    if (!concluded || !evaluation || hasHardFailures) {
      noImprovementStreak += 1;
      continue;
    }

    let improvedAny = false;
    let regressedAny = false;
    const nextBest = { ...bestMetrics };
    for (const metric of metricList) {
      const { improved, regressed, next } = evaluateMetric(metric, bestMetrics[metric.name] ?? null, metricValue(evaluation, metric.name));
      if (improved) improvedAny = true;
      if (regressed) regressedAny = true;
      nextBest[metric.name] = next;
    }

    if (improvedAny && !regressedAny) {
      noImprovementStreak = 0;
      lastImprovedRevision = entry.revision;
      bestMetrics = nextBest;
    } else {
      noImprovementStreak += 1;
    }
  }

  const limit = positive(taskContract?.budgets?.maxNoImprovementRevisions, Number.MAX_SAFE_INTEGER);
  return Object.freeze({
    noImprovementStreak,
    lastImprovedRevision,
    bestMetrics: Object.freeze(bestMetrics),
    exhausted: noImprovementStreak >= limit
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
