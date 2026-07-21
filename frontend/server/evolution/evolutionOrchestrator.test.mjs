/** Test origin: DS4 Level B acceptance flow, recovery, and deterministic promotion authority. */

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { EvolutionCandidateBuilder } from "./evolutionCandidateBuilder.mjs";
import { EVOLUTION_PROPOSAL_VERSION, EVOLUTION_TASK_VERSION } from "./evolutionContracts.mjs";
import { hashJson } from "./evolutionIntegrity.mjs";
import { EvolutionOrchestrator } from "./evolutionOrchestrator.mjs";
import { EvolutionPromotionService } from "./evolutionPromotion.mjs";
import { EvolutionRunStore } from "./evolutionRunStore.mjs";
import { EvolutionWorkspaceManager } from "./evolutionWorkspace.mjs";

const PATCH = `diff --git a/src/value.txt b/src/value.txt
--- a/src/value.txt
+++ b/src/value.txt
@@ -1 +1,2 @@
 one
+two
`;

async function setup({ candidateScore = 2, securityPassed = true, approvalMode = "auto_for_low_risk", targetScore = 2, hiddenPaths = [] } = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "ds4-evo-orchestrator-"));
  const repository = path.join(directory, "repository");
  await fs.mkdir(path.join(repository, "src"), { recursive: true });
  await fs.mkdir(path.join(repository, "checks"), { recursive: true });
  await fs.writeFile(path.join(repository, "src", "value.txt"), "one\n", "utf8");
  await fs.writeFile(path.join(repository, "checks", "oracle.txt"), "safe\n", "utf8");
  const runId = "evo_00000000000000000001";
  const runStore = new EvolutionRunStore({ rootDir: path.join(directory, "runs"), runIdFactory: () => runId });
  const workspaceManager = new EvolutionWorkspaceManager({ repositoryRoot: repository, workRoot: path.join(directory, "workspaces") });
  const candidateBuilder = new EvolutionCandidateBuilder();
  const executor = {
    execute: async (input) => {
      await input.postRunAudit();
      return {
        executionVersion: "ds4_evolution_execution_v1", revision: input.revision, status: "success",
        exitCode: 0, signal: null, stdoutArtifact: null, stderrArtifact: null, stdoutPreview: "",
        stderrPreview: "", violations: [], reproducibility: { commandHash: "a".repeat(64), environmentHash: "b".repeat(64) }
      };
    }
  };
  const evaluatorRegistry = {
    evaluateAll: async ({ revision }) => ({
      evaluationVersion: "ds4_evolution_evaluation_v1",
      revision,
      status: securityPassed ? "passed" : "failed",
      evaluators: [
        { id: "correctness", required: true, status: "passed", metrics: { score: revision === 0 ? 1 : candidateScore }, violations: [], artifacts: [], reproducibility: { commandHash: "a".repeat(64), environmentHash: "b".repeat(64), seed: 1 } },
        { id: "security-policy", required: true, status: securityPassed ? "passed" : "failed", metrics: { security_passed: securityPassed }, violations: securityPassed ? [] : ["UNSAFE"], artifacts: [], reproducibility: { commandHash: "c".repeat(64), environmentHash: "d".repeat(64), seed: null } }
      ],
      aggregateMetrics: { score: revision === 0 ? 1 : candidateScore, security_passed: securityPassed },
      hardFailures: securityPassed ? [] : ["REQUIRED_EVALUATOR_FAILED:security-policy"]
    })
  };
  const promotionService = new EvolutionPromotionService({ repositoryRoot: repository, runStore });
  const orchestrator = new EvolutionOrchestrator({
    runStore, workspaceManager, candidateBuilder, executor, evaluatorRegistry, promotionService,
    smokeEvaluator: async () => ({ passed: true }),
    now: () => new Date("2026-01-01T00:00:00.000Z")
  });
  const task = {
    contractVersion: EVOLUTION_TASK_VERSION,
    taskId: "orchestrator-fixture",
    title: "Orchestrator fixture",
    objective: "Reach score two",
    workspaceRoot: repository,
    mutablePaths: ["src"],
    immutablePaths: ["checks"],
    baselineRef: "snapshot",
    evaluators: [
      { id: "correctness", required: true, configuration: { hiddenPaths } },
      { id: "security-policy", required: true, configuration: {} }
    ],
    metrics: [{ name: "score", direction: "maximize", required: true, baselineTolerance: 0, target: targetScore, weight: 1 }],
    budgets: {
      maxRevisions: 2, maxFilesChanged: 2, maxAddedLines: 10, maxDeletedLines: 10,
      maxWallTimeMsPerRevision: 5_000, maxPromptTokensPerRevision: 1_000, maxCompletionTokensPerRevision: 1_000
    },
    approvalPolicy: { mode: approvalMode, allowedRiskLevels: ["LOW"] }
  };
  const proposal = {
    proposalVersion: EVOLUTION_PROPOSAL_VERSION,
    revision: 1,
    summary: "Append line",
    hypothesis: "The fixture score increases",
    targetFiles: ["src/value.txt"],
    targetSymbols: [],
    plannedChanges: [{ file: "src/value.txt", symbol: null, change: "append", reason: "score", expectedMetricEffect: { metric: "score", direction: "increase" } }],
    testsToRun: ["correctness", "security-policy"],
    knownRisks: [],
    stopInstead: false,
    impactAnalysis: null
  };
  await orchestrator.createRun(task, { repositoryRoot: directory });
  return { directory, repository, runId, runStore, orchestrator, proposal };
}

test("Level B deterministic flow captures baseline, evaluates, gates, promotes, and completes", async () => {
  const f = await setup();
  try {
    assert.equal((await f.orchestrator.prepareBaseline(f.runId)).state, "BASELINE_READY");
    const result = await f.orchestrator.runManualCandidate(f.runId, { proposal: f.proposal, patchText: PATCH });
    assert.equal(result.state, "COMPLETED");
    assert.equal(result.gateDecision.decision, "PROMOTE");
    assert.equal(await fs.readFile(path.join(f.repository, "src", "value.txt"), "utf8"), "one\ntwo\n");
    const restarted = new EvolutionRunStore({ rootDir: path.join(f.directory, "runs") });
    assert.equal((await restarted.loadRun(f.runId)).state, "COMPLETED");
  } finally {
    await fs.rm(f.directory, { recursive: true, force: true });
  }
});

test("BEH-BASE-002 a failed required baseline evaluator blocks BASELINE_READY", async () => {
  const f = await setup();
  try {
    f.orchestrator.evaluatorRegistry.evaluateAll = async ({ revision }) => ({
      evaluationVersion: "ds4_evolution_evaluation_v1", revision, status: "failed",
      evaluators: [{ id: "correctness", required: true, status: "failed", metrics: {}, violations: ["FIXTURE_FAILURE"], reproducibility: { commandHash: "a".repeat(64), environmentHash: "b".repeat(64) } }],
      aggregateMetrics: {},
      hardFailures: ["REQUIRED_EVALUATOR_FAILED:correctness"]
    });
    const result = await f.orchestrator.prepareBaseline(f.runId);
    assert.equal(result.state, "FAILED");
  } finally {
    await fs.rm(f.directory, { recursive: true, force: true });
  }
});

test("security evaluator failure deterministically rejects an improving candidate", async () => {
  const f = await setup({ candidateScore: 100, securityPassed: true });
  try {
    await f.orchestrator.prepareBaseline(f.runId);
    f.orchestrator.evaluatorRegistry.evaluateAll = async ({ revision }) => ({
      evaluationVersion: "ds4_evolution_evaluation_v1", revision, status: revision === 0 ? "passed" : "failed",
      evaluators: [
        { id: "correctness", required: true, status: "passed", metrics: { score: revision === 0 ? 1 : 100 }, violations: [], reproducibility: { commandHash: "a", environmentHash: "b" } },
        { id: "security-policy", required: true, status: revision === 0 ? "passed" : "failed", metrics: { security_passed: revision === 0 }, violations: revision === 0 ? [] : ["UNSAFE"], reproducibility: { commandHash: "c", environmentHash: "d" } }
      ],
      aggregateMetrics: { score: revision === 0 ? 1 : 100, security_passed: revision === 0 },
      hardFailures: revision === 0 ? [] : ["REQUIRED_EVALUATOR_FAILED:security-policy"]
    });
    const result = await f.orchestrator.runManualCandidate(f.runId, { proposal: f.proposal, patchText: PATCH });
    assert.equal(result.state, "REJECTED");
    assert.equal(result.gateDecision.decision, "REJECT");
    assert.equal(await fs.readFile(path.join(f.repository, "src", "value.txt"), "utf8"), "one\n");
  } finally {
    await fs.rm(f.directory, { recursive: true, force: true });
  }
});

test("post-apply smoke failure reverts the canonical repository and fails the run", async () => {
  const f = await setup();
  try {
    await f.orchestrator.prepareBaseline(f.runId);
    f.orchestrator.smokeEvaluator = async () => ({ passed: false });
    await assert.rejects(
      f.orchestrator.runManualCandidate(f.runId, { proposal: f.proposal, patchText: PATCH }),
      { code: "POST_APPLY_SMOKE_FAILED" }
    );
    assert.equal(await fs.readFile(path.join(f.repository, "src", "value.txt"), "utf8"), "one\n");
    assert.equal((await f.runStore.loadRun(f.runId)).state, "FAILED");
  } finally {
    await fs.rm(f.directory, { recursive: true, force: true });
  }
});

test("SEC-BASE-002 canonical drift after evaluation fails before promotion", async () => {
  const f = await setup();
  try {
    await f.orchestrator.prepareBaseline(f.runId);
    const built = await f.orchestrator.buildRevision(f.runId, { proposal: f.proposal, patchText: PATCH });
    const evaluated = await f.orchestrator.executeAndEvaluate(f.runId, built.revision, built.workspace.root);
    await fs.writeFile(path.join(f.repository, "checks", "oracle.txt"), "drifted\n", "utf8");
    await assert.rejects(
      f.orchestrator.gateRevision(f.runId, built.revision, evaluated.evaluation, evaluated.candidate),
      { code: "BASELINE_MUTATED" }
    );
    assert.equal((await f.runStore.loadRun(f.runId)).state, "FAILED");
    assert.equal(await fs.readFile(path.join(f.repository, "src", "value.txt"), "utf8"), "one\n");
  } finally {
    await fs.rm(f.directory, { recursive: true, force: true });
  }
});

test("SEC-HID-001 orchestrator masks declared hidden fixtures only from candidate execution", async () => {
  const f = await setup({ hiddenPaths: ["checks/oracle.txt"] });
  try {
    let observedMasks = null;
    const execute = f.orchestrator.executor.execute.bind(f.orchestrator.executor);
    f.orchestrator.executor.execute = async (input) => {
      observedMasks = input.maskedBindings;
      return execute(input);
    };
    await f.orchestrator.prepareBaseline(f.runId);
    await f.orchestrator.runManualCandidate(f.runId, { proposal: f.proposal, patchText: PATCH });
    assert.deepEqual(observedMasks, [{ target: "/workspace/checks/oracle.txt", type: "file" }]);
  } finally {
    await fs.rm(f.directory, { recursive: true, force: true });
  }
});

test("manual review approval is hash-bound and resumes the deterministic flow", async () => {
  const f = await setup({ approvalMode: "manual" });
  try {
    await f.orchestrator.prepareBaseline(f.runId);
    const pending = await f.orchestrator.runManualCandidate(f.runId, { proposal: f.proposal, patchText: PATCH });
    assert.equal(pending.state, "MANUAL_REVIEW");
    const approval = await f.orchestrator.issueManualApproval(f.runId, 1, "maintainer");
    await assert.rejects(
      f.orchestrator.approveRevision(f.runId, 1, { ...approval, candidateHash: "f".repeat(64) }),
      { code: "APPROVAL_HASH_MISMATCH" }
    );
    assert.equal((await f.runStore.loadRun(f.runId)).state, "MANUAL_REVIEW");
    const approved = await f.orchestrator.approveRevision(f.runId, 1, approval);
    assert.equal(approved.state, "COMPLETED");
    assert.equal(await fs.readFile(path.join(f.repository, "src", "value.txt"), "utf8"), "one\ntwo\n");
  } finally {
    await fs.rm(f.directory, { recursive: true, force: true });
  }
});

test("manual reviewer can reject without touching the canonical repository", async () => {
  const f = await setup({ approvalMode: "manual" });
  try {
    await f.orchestrator.prepareBaseline(f.runId);
    assert.equal((await f.orchestrator.runManualCandidate(f.runId, { proposal: f.proposal, patchText: PATCH })).state, "MANUAL_REVIEW");
    assert.equal((await f.orchestrator.rejectManualRevision(f.runId, 1)).state, "REJECTED");
    assert.equal(await fs.readFile(path.join(f.repository, "src", "value.txt"), "utf8"), "one\n");
  } finally {
    await fs.rm(f.directory, { recursive: true, force: true });
  }
});

test("a rewritten promoted snapshot is rejected against its ledger seal", async () => {
  const f = await setup({ targetScore: 3 });
  try {
    await f.orchestrator.prepareBaseline(f.runId);
    assert.equal((await f.orchestrator.runManualCandidate(f.runId, { proposal: f.proposal, patchText: PATCH })).state, "PROMOTED");
    const snapshotPath = path.join(f.runStore.revisionDir(f.runId, 1), "promoted-snapshot.json");
    const snapshot = JSON.parse(await fs.readFile(snapshotPath, "utf8"));
    snapshot.files[0].mode = snapshot.files[0].mode === 0o600 ? 0o644 : 0o600;
    snapshot.contentHash = hashJson(snapshot.files);
    await fs.writeFile(snapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
    await assert.rejects(
      f.orchestrator.buildRevision(f.runId, {
        proposal: { ...f.proposal, revision: 2 },
        patchText: PATCH
      }),
      { code: "SNAPSHOT_INTEGRITY_FAILURE" }
    );
  } finally {
    await fs.rm(f.directory, { recursive: true, force: true });
  }
});

test("explicit stop uses the exceptional typed transition", async () => {
  const f = await setup();
  try {
    const stopped = await f.orchestrator.stop(f.runId);
    assert.equal(stopped.state, "STOPPED");
    assert.equal(stopped.events.at(-1).payload.kind, "stop");
  } finally {
    await fs.rm(f.directory, { recursive: true, force: true });
  }
});
