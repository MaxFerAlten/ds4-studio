/** Test origin: DS4 Evolution post-verdict plan section 6 (feedback context builder). */

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { EvolutionFeedbackContextBuilder, EvolutionFeedbackContextError } from "./evolutionFeedbackContext.mjs";
import { captureBaselineSnapshot, EvolutionRunStore } from "./evolutionRunStore.mjs";

const TASK = Object.freeze({
  contractVersion: "ds4_evolution_task_v1",
  taskId: "feedback-fixture",
  title: "Feedback fixture",
  objective: "Reach score five",
  workspaceRoot: null,
  mutablePaths: ["src"],
  immutablePaths: ["checks", "evolutionPromotionGate.mjs", "evolutionPromotion.mjs", "hidden-fixtures"],
  baselineRef: "snapshot",
  evaluators: [
    { id: "correctness", required: true, configuration: {} },
    { id: "security-policy", required: true, configuration: {} }
  ],
  metrics: [
    { name: "score", direction: "maximize", required: true, baselineTolerance: 0, target: 5, weight: 1 },
    { name: "security_passed", direction: "boolean", required: true, baselineTolerance: 0, target: true, weight: 1 }
  ],
  budgets: {
    maxRevisions: 8, maxFilesChanged: 2, maxAddedLines: 10, maxDeletedLines: 10,
    maxWallTimeMsPerRevision: 5_000, maxPromptTokensPerRevision: 1_000, maxCompletionTokensPerRevision: 1_000
  },
  approvalPolicy: { mode: "auto_for_low_risk", allowedRiskLevels: ["LOW"] }
});

async function setup() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "ds4-evo-feedback-"));
  const repository = path.join(directory, "repository");
  await fs.mkdir(path.join(repository, "src"), { recursive: true });
  await fs.mkdir(path.join(repository, "checks"), { recursive: true });
  await fs.writeFile(path.join(repository, "src", "value.txt"), "one\n", "utf8");
  const runStore = new EvolutionRunStore({ rootDir: path.join(directory, "runs") });
  const task = { ...TASK, workspaceRoot: repository };
  const { runId } = await runStore.createRun(task, { repositoryRoot: directory });
  await runStore.transitionRun(runId, "BASELINE_CAPTURING");
  await runStore.transitionRun(runId, "BASELINE_EVALUATING");
  const snapshot = await captureBaselineSnapshot({ repositoryRoot: repository, relevantPaths: ["src", "checks"] });
  const baselineEvaluation = {
    evaluationVersion: "ds4_evolution_evaluation_v1",
    revision: 0,
    status: "passed",
    evaluators: [
      { id: "correctness", required: true, status: "passed", metrics: { score: 1 }, violations: [], artifacts: [], reproducibility: {} },
      { id: "security-policy", required: true, status: "passed", metrics: { security_passed: true }, violations: [], artifacts: [], reproducibility: {} }
    ],
    aggregateMetrics: { score: 1, security_passed: true },
    hardFailures: []
  };
  await runStore.saveBaseline(runId, snapshot, baselineEvaluation);
  await runStore.transitionRun(runId, "BASELINE_READY");
  return { directory, runStore, runId, task };
}

async function driveRevision(runStore, runId, revision, { outcome, reasonCode = null, score, summary, hypothesis, diagnosisSummary, improvements = [], candidateHash, executionPadding = null, patchPadding = null }) {
  await runStore.transitionRun(runId, "PROPOSING", { revision });
  await runStore.transitionRun(runId, "CANDIDATE_BUILDING", { revision });
  await runStore.writeRevisionArtifact(runId, revision, "proposal.json", { revision, summary, hypothesis });
  await runStore.writeRevisionArtifact(runId, revision, "candidate.json", { candidateHash });
  await runStore.writeRevisionArtifact(runId, revision, "candidate.patch", patchPadding ?? "diff --git a/src/value.txt b/src/value.txt\n");
  await runStore.transitionRun(runId, "CANDIDATE_READY", { revision });
  await runStore.transitionRun(runId, "EXECUTING", { revision });
  await runStore.writeRevisionArtifact(runId, revision, "execution.json", {
    executionVersion: "ds4_evolution_execution_v1", revision, status: "success", exitCode: 0,
    stdoutPreview: executionPadding?.stdout ?? "", stderrPreview: executionPadding?.stderr ?? ""
  });
  await runStore.transitionRun(runId, "EVALUATING", { revision });
  const evaluation = {
    evaluationVersion: "ds4_evolution_evaluation_v1",
    revision,
    status: outcome === "REJECTED" ? "failed" : "passed",
    evaluators: [{ id: "correctness", required: true, status: outcome === "REJECTED" ? "failed" : "passed", metrics: { score }, violations: outcome === "REJECTED" ? ["SCORE_TOO_LOW"] : [], artifacts: [], reproducibility: {} }],
    aggregateMetrics: { score },
    hardFailures: outcome === "REJECTED" ? ["REQUIRED_EVALUATOR_FAILED:correctness"] : []
  };
  await runStore.writeRevisionArtifact(runId, revision, "evaluation.json", evaluation);
  await runStore.transitionRun(runId, "DIAGNOSING", { revision });
  await runStore.writeRevisionArtifact(runId, revision, "diagnosis.json", {
    diagnosisVersion: "ds4_evolution_diagnosis_v1", revision, status: "completed",
    summary: diagnosisSummary, rootCauses: [], recommendations: [], confidence: 0.5
  });
  await runStore.transitionRun(runId, "GATING", { revision });
  await runStore.writeRevisionArtifact(runId, revision, "promotion.json", {
    decision: outcome, revision, improvements, regressions: [], hardFailures: evaluation.hardFailures, riskLevel: "LOW"
  });
  await runStore.transitionRun(runId, outcome, { revision, reasonCode });
}

async function loadEvents(runStore, runId) {
  return runStore.readEvents(runId);
}

test("BEH-FEEDBACK-001 empty history yields baseline-only trend and null previous state", async () => {
  const { runStore, runId, task } = await setup();
  const events = await loadEvents(runStore, runId);
  const builder = new EvolutionFeedbackContextBuilder({ runStore });
  const context = await builder.build({ runId, nextRevision: 1, taskContract: task, events, budget: { revisionsUsed: 0 } });
  assert.equal(context.previousRevision, null);
  assert.equal(context.previousState, "NONE");
  assert.deepEqual(context.history, []);
  assert.deepEqual(context.rejectedStrategies, []);
  assert.deepEqual(context.promotedStrategies, []);
  assert.equal(context.noImprovementStreak, 0);
  assert.equal(context.metricTrend[0].baseline, 1);
  assert.equal(context.metricTrend[0].best, 1);
  assert.equal(context.metricTrend[0].targetReached, false);
  assert.equal(typeof context.contextHash, "string");
  assert.ok(Object.isFrozen(context));
});

test("BEH-FEEDBACK-002 a rejected revision populates history and failure signature", async () => {
  const { runStore, runId, task } = await setup();
  await driveRevision(runStore, runId, 1, {
    outcome: "REJECTED", reasonCode: "GATE_REJECTED", score: 1,
    summary: "try smaller patch", hypothesis: "reduces risk", diagnosisSummary: "no effect", candidateHash: "a".repeat(64)
  });
  const events = await loadEvents(runStore, runId);
  const builder = new EvolutionFeedbackContextBuilder({ runStore });
  const context = await builder.build({ runId, nextRevision: 2, taskContract: task, events, budget: null });
  assert.equal(context.previousRevision, 1);
  assert.equal(context.previousState, "REJECTED");
  assert.equal(context.history.length, 1);
  assert.equal(context.history[0].outcome, "REJECTED");
  assert.equal(context.rejectedStrategies.length, 1);
  assert.equal(typeof context.rejectedStrategies[0].failureSignature, "string");
  assert.equal(context.noImprovementStreak, 1);
  assert.equal(context.previousEvaluation.status, "failed");
  assert.ok(context.previousDiagnosis.summary.includes("no effect"));
});

test("BEH-FEEDBACK-003 a promoted revision resets the no-improvement streak and updates the trend", async () => {
  const { runStore, runId, task } = await setup();
  await driveRevision(runStore, runId, 1, {
    outcome: "REJECTED", reasonCode: "GATE_REJECTED", score: 1,
    summary: "try smaller patch", hypothesis: "reduces risk", diagnosisSummary: "no effect", candidateHash: "a".repeat(64)
  });
  await driveRevision(runStore, runId, 2, {
    outcome: "PROMOTED", score: 4,
    summary: "widen coverage", hypothesis: "adds missing branch", diagnosisSummary: "improved",
    improvements: ["score"], candidateHash: "b".repeat(64)
  });
  const events = await loadEvents(runStore, runId);
  const builder = new EvolutionFeedbackContextBuilder({ runStore });
  const context = await builder.build({ runId, nextRevision: 3, taskContract: task, events, budget: null });
  assert.equal(context.previousRevision, 2);
  assert.equal(context.previousState, "PROMOTED");
  assert.equal(context.history.length, 2);
  assert.equal(context.promotedStrategies.length, 1);
  assert.deepEqual(context.promotedStrategies[0].improvements, ["score"]);
  assert.equal(context.noImprovementStreak, 0);
  assert.equal(context.metricTrend[0].best, 4);
  assert.equal(context.metricTrend[0].deltaFromBaseline, 3);
  assert.equal(context.metricTrend[0].targetReached, false);
});

test("BEH-FEEDBACK-004 a manual-review revision is pending, not scored", async () => {
  const { runStore, runId, task } = await setup();
  await driveRevision(runStore, runId, 1, {
    outcome: "PROMOTED", score: 4,
    summary: "widen coverage", hypothesis: "adds missing branch", diagnosisSummary: "improved",
    improvements: ["score"], candidateHash: "b".repeat(64)
  });
  await driveRevision(runStore, runId, 2, {
    outcome: "MANUAL_REVIEW", score: 6,
    summary: "risky rewrite", hypothesis: "touches security path", diagnosisSummary: "needs human sign-off",
    candidateHash: "c".repeat(64)
  });
  const events = await loadEvents(runStore, runId);
  const builder = new EvolutionFeedbackContextBuilder({ runStore });
  const context = await builder.build({ runId, nextRevision: 3, taskContract: task, events, budget: null });
  assert.equal(context.previousRevision, 2);
  assert.equal(context.previousState, "MANUAL_REVIEW");
  assert.equal(context.history.length, 2);
  assert.ok(context.previousDiagnosis.summary.includes("needs human sign-off"));
  assert.equal(context.rejectedStrategies.length, 0);
  assert.equal(context.promotedStrategies.length, 1);
  assert.equal(context.metricTrend[0].best, 4);
  assert.equal(context.noImprovementStreak, 0);
});

test("BEH-FEEDBACK-005 identical inputs produce an identical context hash", async () => {
  const { runStore, runId, task } = await setup();
  await driveRevision(runStore, runId, 1, {
    outcome: "REJECTED", reasonCode: "GATE_REJECTED", score: 1,
    summary: "try smaller patch", hypothesis: "reduces risk", diagnosisSummary: "no effect", candidateHash: "a".repeat(64)
  });
  const events = await loadEvents(runStore, runId);
  const builder = new EvolutionFeedbackContextBuilder({ runStore });
  const first = await builder.build({ runId, nextRevision: 2, taskContract: task, events, budget: { revisionsUsed: 1 } });
  const second = await builder.build({ runId, nextRevision: 2, taskContract: { ...task }, events: [...events], budget: { revisionsUsed: 1 } });
  assert.equal(first.contextHash, second.contextHash);
  assert.throws(() => { first.noImprovementStreak = 99; }, TypeError);
});

test("SEC-FEEDBACK-001 an artifact whose internal revision disagrees with its directory is rejected", async () => {
  const { runStore, runId, task } = await setup();
  await runStore.transitionRun(runId, "PROPOSING", { revision: 1 });
  await runStore.transitionRun(runId, "CANDIDATE_BUILDING", { revision: 1 });
  await runStore.writeRevisionArtifact(runId, 1, "proposal.json", { revision: 99, summary: "mismatched", hypothesis: "x" });
  await runStore.transitionRun(runId, "REJECTED", { revision: 1, reasonCode: "CANDIDATE_BUILD_FAILED" });
  const events = await loadEvents(runStore, runId);
  const builder = new EvolutionFeedbackContextBuilder({ runStore });
  await assert.rejects(
    builder.build({ runId, nextRevision: 2, taskContract: task, events, budget: null }),
    (error) => error instanceof EvolutionFeedbackContextError && error.code === "CROSS_RUN_ARTIFACT"
  );
});

test("SEC-FEEDBACK-002 a context that cannot fit even after full reduction throws", async () => {
  const { runStore, runId, task } = await setup();
  await driveRevision(runStore, runId, 1, {
    outcome: "REJECTED", reasonCode: "GATE_REJECTED", score: 1,
    summary: "try smaller patch", hypothesis: "reduces risk",
    diagnosisSummary: "x".repeat(5_000), candidateHash: "a".repeat(64)
  });
  const events = await loadEvents(runStore, runId);
  const builder = new EvolutionFeedbackContextBuilder({ runStore, maxBytes: 200 });
  await assert.rejects(
    builder.build({ runId, nextRevision: 2, taskContract: task, events, budget: null }),
    (error) => error instanceof EvolutionFeedbackContextError && error.code === "FEEDBACK_CONTEXT_TOO_LARGE"
  );
});

test("SEC-FEEDBACK-003 an oversized revision artifact is refused rather than silently truncated", async () => {
  const { runStore, runId, task } = await setup();
  await runStore.transitionRun(runId, "PROPOSING", { revision: 1 });
  await runStore.transitionRun(runId, "CANDIDATE_BUILDING", { revision: 1 });
  await runStore.writeRevisionArtifact(runId, 1, "proposal.json", { revision: 1, summary: "oversized", hypothesis: "x" });
  await runStore.writeRevisionArtifact(runId, 1, "evaluation.json", {
    evaluationVersion: "ds4_evolution_evaluation_v1", revision: 1, status: "failed",
    evaluators: [], aggregateMetrics: { score: 1 }, hardFailures: [], padding: "y".repeat(250_000)
  });
  await runStore.transitionRun(runId, "REJECTED", { revision: 1, reasonCode: "GATE_REJECTED" });
  const events = await loadEvents(runStore, runId);
  const builder = new EvolutionFeedbackContextBuilder({ runStore });
  await assert.rejects(
    builder.build({ runId, nextRevision: 2, taskContract: task, events, budget: null }),
    (error) => error instanceof EvolutionFeedbackContextError && error.code === "REVISION_ARTIFACT_INVALID"
  );
});

test("SEC-FEEDBACK-004 raw stdout, stderr, and patch content never reach the context", async () => {
  const { runStore, runId, task } = await setup();
  await driveRevision(runStore, runId, 1, {
    outcome: "REJECTED", reasonCode: "GATE_REJECTED", score: 1,
    summary: "try smaller patch", hypothesis: "reduces risk", diagnosisSummary: "no effect",
    candidateHash: "a".repeat(64),
    executionPadding: { stdout: "SECRET_STDOUT_SENTINEL", stderr: "SECRET_STDERR_SENTINEL" },
    patchPadding: "diff --git a/src/value.txt b/src/value.txt\nSECRET_PATCH_SENTINEL\n"
  });
  const events = await loadEvents(runStore, runId);
  const builder = new EvolutionFeedbackContextBuilder({ runStore });
  const context = await builder.build({ runId, nextRevision: 2, taskContract: task, events, budget: null });
  const serialized = JSON.stringify(context);
  assert.ok(!serialized.includes("SECRET_PATCH_SENTINEL"));
  assert.ok(!serialized.includes("SECRET_STDOUT_SENTINEL"));
  assert.ok(!serialized.includes("SECRET_STDERR_SENTINEL"));
});
