/** Test origin: DS4 acceptance requirements BEH-LOOP-003 and SEC-LOOP-003. */

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { EvolutionCandidateBuilder } from "./evolutionCandidateBuilder.mjs";
import { EVOLUTION_TASK_VERSION_V2 } from "./evolutionContracts.mjs";
import { EvolutionFeedbackContextBuilder } from "./evolutionFeedbackContext.mjs";
import { hashJson } from "./evolutionIntegrity.mjs";
import { EvolutionLoopController } from "./evolutionLoopController.mjs";
import { EvolutionOrchestrator } from "./evolutionOrchestrator.mjs";
import { EvolutionPromotionService } from "./evolutionPromotion.mjs";
import { EvolutionRunStore } from "./evolutionRunStore.mjs";
import { EvolutionWorkspaceManager } from "./evolutionWorkspace.mjs";

function fixture() {
  const calls = [];
  const events = [];
  const artifacts = new Map();
  const run = {
    runId: "evo_0123456789abcdefabcd",
    state: "BASELINE_READY",
    revision: 0,
    manifest: {
      taskContract: {
        objective: "Improve",
        automation: { level: "D", proposerEnabled: true, autoContinue: true },
        budgets: {
          maxTotalPromptTokens: 100,
          maxTotalCompletionTokens: 100,
          maxTotalWallTimeMs: 1000,
          maxModelCallsPerRevision: 4,
          maxRepeatedFailureSignatures: 2
        }
      }
    },
    events
  };
  const store = {
    async loadRun() { return run; },
    async readEvents() { return events; },
    async writeRevisionArtifact(_runId, _revision, name, value) { calls.push(`write:${name}`); artifacts.set(name, value); },
    async readRevisionArtifact(_runId, _revision, name) {
      if (!artifacts.has(name)) throw Object.assign(new Error(name), { code: "ARTIFACT_NOT_FOUND" });
      return { truncated: false, content: JSON.stringify(artifacts.get(name)) };
    },
    async appendEvent(_runId, event) { events.push({ sequence: events.length + 1, ...event }); }
  };
  const orchestrator = {
    runStore: store,
    async buildRevision() { calls.push("build"); run.state = "CANDIDATE_READY"; run.revision = 1; return { revision: 1, workspace: { root: "/tmp/work" } }; },
    async executeAndEvaluate() { calls.push("evaluate"); run.state = "GATING"; return { state: "GATING", evaluation: {}, candidate: {} }; },
    async gateRevision() { calls.push("gate"); run.state = "MANUAL_REVIEW"; },
    async stop(_runId, reason) { calls.push(`stop:${reason}`); run.state = "STOPPED"; return run; }
  };
  const evidence = {
    role: "proposer",
    usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    calls: 1,
    repairs: 0,
    responseHash: "b".repeat(64)
  };
  const feedbackContextPayload = {
    schema: "ds4_evolution_feedback_context_v1",
    runId: run.runId,
    nextRevision: 1,
    previousRevision: null,
    previousState: "NONE",
    history: [],
    previousDiagnosis: null,
    previousEvaluation: null,
    metricTrend: [],
    rejectedStrategies: [],
    promotedStrategies: [],
    noImprovementStreak: 0,
    budget: null
  };
  const feedbackContextHash = hashJson(feedbackContextPayload);
  const feedbackContextBuilder = {
    async build() { calls.push("feedback-context"); return { ...feedbackContextPayload, contextHash: feedbackContextHash }; }
  };
  const proposal = { revision: 1, stopInstead: false, feedbackContextHash };
  const proposalHash = hashJson(proposal);
  const proposer = {
    async propose() { calls.push("propose"); return { proposal, proposalHash, modelEvidence: evidence }; },
    async producePatch() {
      calls.push("patch");
      return {
        patchText: "diff",
        generatedPatch: { proposalHash, patchText: "diff" },
        modelEvidence: { ...evidence, role: "patcher", responseHash: "c".repeat(64) }
      };
    }
  };
  return { calls, run, orchestrator, proposer, feedbackContextBuilder, feedbackContextHash, artifacts };
}

test("BEH-LOOP-003 executes one ordered revision and pauses at manual review", async () => {
  const f = fixture();
  const controller = new EvolutionLoopController({ orchestrator: f.orchestrator, proposer: f.proposer, feedbackContextBuilder: f.feedbackContextBuilder });
  const run = await controller.runUntilPause(f.run.runId);
  assert.equal(run.state, "MANUAL_REVIEW");
  assert.deepEqual(f.calls.filter((entry) => ["propose", "patch", "build", "evaluate", "gate"].includes(entry)), ["propose", "patch", "build", "evaluate", "gate"]);
});

test("BEH-LOOP-002 restart reuses durable Proposer and Patcher outputs without duplicate model calls", async () => {
  const f = fixture();
  let builds = 0;
  const originalBuild = f.orchestrator.buildRevision;
  f.orchestrator.buildRevision = async (...args) => {
    builds += 1;
    if (builds === 1) throw new Error("simulated crash after model output persistence");
    return originalBuild(...args);
  };
  const controller = new EvolutionLoopController({ orchestrator: f.orchestrator, proposer: f.proposer, feedbackContextBuilder: f.feedbackContextBuilder });
  await assert.rejects(() => controller.runOneRevision(f.run.runId), /simulated crash/);
  await controller.runOneRevision(f.run.runId);
  assert.equal(f.calls.filter((entry) => entry === "propose").length, 1);
  assert.equal(f.calls.filter((entry) => entry === "patch").length, 1);
  assert.equal(f.artifacts.has("generated-proposal.json"), true);
  assert.equal(f.artifacts.has("generated-patch.json"), true);
});

test("BEH-LOOP-006 persisted feedback context is reused after restart without a second build", async () => {
  const f = fixture();
  let builds = 0;
  const originalBuild = f.orchestrator.buildRevision;
  f.orchestrator.buildRevision = async (...args) => {
    builds += 1;
    if (builds === 1) throw new Error("simulated crash after feedback context persistence");
    return originalBuild(...args);
  };
  const controller = new EvolutionLoopController({ orchestrator: f.orchestrator, proposer: f.proposer, feedbackContextBuilder: f.feedbackContextBuilder });
  await assert.rejects(() => controller.runOneRevision(f.run.runId), /simulated crash/);
  await controller.runOneRevision(f.run.runId);
  assert.equal(f.calls.filter((entry) => entry === "feedback-context").length, 1);
  assert.equal(f.artifacts.has("feedback-context.json"), true);
});

test("SEC-LOOP-004 feedbackContextHash mismatch blocks the proposal", async () => {
  const f = fixture();
  f.proposer.propose = async () => ({
    proposal: { revision: 1, stopInstead: false, feedbackContextHash: "0".repeat(64) },
    proposalHash: hashJson({ revision: 1, stopInstead: false, feedbackContextHash: "0".repeat(64) }),
    modelEvidence: {
      role: "proposer",
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      calls: 1,
      repairs: 0,
      responseHash: "b".repeat(64)
    }
  });
  const controller = new EvolutionLoopController({ orchestrator: f.orchestrator, proposer: f.proposer, feedbackContextBuilder: f.feedbackContextBuilder });
  await assert.rejects(
    () => controller.runOneRevision(f.run.runId),
    (error) => error.code === "FEEDBACK_CONTEXT_HASH_MISMATCH"
  );
});

test("SEC-LOOP-003 stops before proposing when total budget is exhausted", async () => {
  const f = fixture();
  f.orchestrator.runStore.readEvents = async () => [{
    type: "MODEL_CALL_COMPLETED",
    revision: 0,
    payload: { usage: { promptTokens: 101, completionTokens: 1 }, wallTimeMs: 0 }
  }];
  const controller = new EvolutionLoopController({ orchestrator: f.orchestrator, proposer: f.proposer, feedbackContextBuilder: f.feedbackContextBuilder });
  const run = await controller.runOneRevision(f.run.runId);
  assert.equal(run.state, "STOPPED");
  assert.equal(f.calls.includes("propose"), false);
});

const SECRET_SENTINEL = "SECRET_TOKEN_DO_NOT_LEAK";
const CANDIDATE_PATCH = `diff --git a/src/value.txt b/src/value.txt
--- a/src/value.txt
+++ b/src/value.txt
@@ -1 +1,2 @@
 one
+two
`;

async function setupIntegration({ maxNoImprovementRevisions = 5 } = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "ds4-evo-loop-integration-"));
  const repository = path.join(directory, "repository");
  await fs.mkdir(path.join(repository, "src"), { recursive: true });
  await fs.mkdir(path.join(repository, "checks"), { recursive: true });
  await fs.writeFile(path.join(repository, "src", "value.txt"), "one\n", "utf8");
  await fs.writeFile(path.join(repository, "checks", "oracle.txt"), "safe\n", "utf8");
  const runId = "evo_00000000000000000002";
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
      status: revision === 0 ? "passed" : "failed",
      evaluators: [
        { id: "correctness", required: true, status: "passed", metrics: { score: revision === 0 ? 1 : 2 }, violations: [], artifacts: [], reproducibility: { commandHash: "a".repeat(64), environmentHash: "b".repeat(64), seed: 1 } },
        {
          id: "security-policy", required: true, status: revision === 0 ? "passed" : "failed",
          metrics: { security_passed: revision === 0 }, violations: revision === 0 ? [] : [SECRET_SENTINEL],
          artifacts: [], reproducibility: { commandHash: "c".repeat(64), environmentHash: "d".repeat(64), seed: null }
        }
      ],
      aggregateMetrics: { score: revision === 0 ? 1 : 2, security_passed: revision === 0 },
      hardFailures: revision === 0 ? [] : ["REQUIRED_EVALUATOR_FAILED:security-policy"]
    })
  };
  const promotionService = new EvolutionPromotionService({ repositoryRoot: repository, runStore });
  const diagnosis = {
    diagnosisVersion: "ds4_evolution_diagnosis_v1",
    revision: 1,
    status: "completed",
    summary: "candidate regressed relative to baseline on the security-policy evaluator",
    rootCauses: [{ code: "CAUSE_A", description: "synthetic root cause for the P2 gate test", evidenceRefs: [] }],
    recommendations: ["try a materially different mechanism"],
    confidence: 0.8
  };
  const critic = {
    async diagnose(packet) {
      const value = { ...diagnosis, rootCauses: [{ ...diagnosis.rootCauses[0], evidenceRefs: packet.evidence }] };
      return {
        value,
        evidence: {
          role: "critic",
          usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
          calls: 1,
          repairs: 0,
          promptHash: "e".repeat(64),
          responseHash: "f".repeat(64)
        }
      };
    }
  };
  const orchestrator = new EvolutionOrchestrator({
    runStore, workspaceManager, candidateBuilder, executor, evaluatorRegistry, promotionService, critic,
    smokeEvaluator: async () => ({ passed: true }),
    now: () => new Date("2026-01-01T00:00:00.000Z")
  });
  const task = {
    contractVersion: EVOLUTION_TASK_VERSION_V2,
    taskId: "loop-integration-fixture",
    title: "Loop integration fixture",
    objective: "Reach score two",
    workspaceRoot: repository,
    mutablePaths: ["src"],
    immutablePaths: ["checks", "evolutionPromotionGate.mjs", "evolutionPromotion.mjs", "hidden-fixtures"],
    baselineRef: "snapshot",
    evaluators: [
      { id: "correctness", required: true, configuration: {} },
      { id: "security-policy", required: true, configuration: {} }
    ],
    metrics: [
      { name: "score", direction: "maximize", required: true, baselineTolerance: 0, target: 3, weight: 1 },
      { name: "security_passed", direction: "boolean", required: true, baselineTolerance: 0, target: true, weight: 1 }
    ],
    budgets: {
      maxRevisions: 3, maxFilesChanged: 2, maxAddedLines: 10, maxDeletedLines: 10,
      maxWallTimeMsPerRevision: 5_000, maxPromptTokensPerRevision: 1_000, maxCompletionTokensPerRevision: 1_000,
      maxTotalWallTimeMs: 60_000, maxTotalPromptTokens: 20_000, maxTotalCompletionTokens: 20_000,
      maxModelCallsPerRevision: 4, maxInfrastructureRetries: 1, maxEvaluatorRetries: 1,
      maxCriticRepairs: 1, maxProposerRepairs: 1, maxRepeatedFailureSignatures: 5, maxNoImprovementRevisions
    },
    approvalPolicy: { mode: "manual", allowedRiskLevels: ["LOW"] },
    automation: { level: "D", criticEnabled: true, proposerEnabled: true, autoContinue: false, modelProfile: "default" }
  };
  await orchestrator.createRun(task, { repositoryRoot: directory });
  return { directory, repository, runId, runStore, orchestrator };
}

test("BEH-LOOP-004/005 SEC-LOOP-005 revision N+1 receives the diagnosis, metric trend and rejected strategies of revision N without secret leakage", async () => {
  const f = await setupIntegration();
  const feedbackContextBuilder = new EvolutionFeedbackContextBuilder({ runStore: f.runStore });
  const calls = [];
  const proposer = {
    async propose(args) {
      calls.push(args);
      if (args.revision === 1) {
        const proposal = {
          proposalVersion: "ds4_evolution_proposal_v1",
          revision: 1,
          summary: "Append a second line",
          hypothesis: "Appending a line increases the score metric",
          targetFiles: ["src/value.txt"],
          targetSymbols: [],
          plannedChanges: [{ file: "src/value.txt", symbol: null, change: "append", reason: "score", expectedMetricEffect: { metric: "score", direction: "increase" } }],
          testsToRun: ["correctness", "security-policy"],
          knownRisks: [],
          stopInstead: false,
          impactAnalysis: null,
          feedbackContextHash: args.feedbackContextHash
        };
        return {
          proposal,
          proposalHash: hashJson(proposal),
          modelEvidence: {
            role: "proposer", usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
            calls: 1, repairs: 0, promptHash: "0".repeat(64), responseHash: "1".repeat(64)
          }
        };
      }
      const proposal = {
        proposalVersion: "ds4_evolution_proposal_v1",
        revision: 2,
        summary: "Stop, no safe distinct mechanism available",
        hypothesis: "No hypothesis distinct from the rejected strategy is supported by the evidence",
        targetFiles: [],
        targetSymbols: [],
        plannedChanges: [],
        testsToRun: [],
        knownRisks: [],
        stopInstead: true,
        impactAnalysis: null,
        feedbackContextHash: args.feedbackContextHash
      };
      return {
        proposal,
        proposalHash: hashJson(proposal),
        modelEvidence: {
          role: "proposer", usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
          calls: 1, repairs: 0, promptHash: "0".repeat(64), responseHash: "2".repeat(64)
        }
      };
    },
    async producePatch({ proposalHash }) {
      return {
        patchText: CANDIDATE_PATCH,
        generatedPatch: { patchVersion: "ds4_evolution_generated_patch_v1", revision: 1, patchText: CANDIDATE_PATCH, targetFiles: ["src/value.txt"], proposalHash },
        modelEvidence: {
          role: "patcher", usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
          calls: 1, repairs: 0, promptHash: "0".repeat(64), responseHash: "3".repeat(64)
        }
      };
    }
  };
  const controller = new EvolutionLoopController({ orchestrator: f.orchestrator, proposer, feedbackContextBuilder });

  const afterRevisionOne = await controller.runOneRevision(f.runId);
  assert.equal(afterRevisionOne.state, "REJECTED");

  await controller.runOneRevision(f.runId);
  assert.equal(calls.length, 2);

  const secondCall = calls[1];
  assert.equal(secondCall.diagnosis.rootCauses[0].code, "CAUSE_A");
  assert.equal(secondCall.rejectedStrategies.length, 1);
  const scoreTrend = secondCall.metricTrend.find((entry) => entry.metric === "score");
  assert.equal(scoreTrend.baseline, 1);
  assert.equal(scoreTrend.previous, 2);
  assert.ok(!JSON.stringify(secondCall).includes(SECRET_SENTINEL));
});

test("SEC-LOOP-006 no model call occurs after the no-improvement limit is reached", async () => {
  const f = await setupIntegration({ maxNoImprovementRevisions: 2 });
  const feedbackContextBuilder = new EvolutionFeedbackContextBuilder({ runStore: f.runStore });
  const calls = [];
  const proposer = {
    async propose(args) {
      calls.push(args);
      const proposal = {
        proposalVersion: "ds4_evolution_proposal_v1",
        revision: args.revision,
        summary: "Append a second line",
        hypothesis: "Appending a line increases the score metric",
        targetFiles: ["src/value.txt"],
        targetSymbols: [],
        plannedChanges: [{ file: "src/value.txt", symbol: null, change: "append", reason: "score", expectedMetricEffect: { metric: "score", direction: "increase" } }],
        testsToRun: ["correctness", "security-policy"],
        knownRisks: [],
        stopInstead: false,
        impactAnalysis: null,
        feedbackContextHash: args.feedbackContextHash
      };
      return {
        proposal,
        proposalHash: hashJson(proposal),
        modelEvidence: {
          role: "proposer", usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
          calls: 1, repairs: 0, promptHash: "0".repeat(64), responseHash: "1".repeat(64)
        }
      };
    },
    async producePatch({ proposalHash }) {
      return {
        patchText: CANDIDATE_PATCH,
        generatedPatch: { patchVersion: "ds4_evolution_generated_patch_v1", revision: 1, patchText: CANDIDATE_PATCH, targetFiles: ["src/value.txt"], proposalHash },
        modelEvidence: {
          role: "patcher", usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
          calls: 1, repairs: 0, promptHash: "0".repeat(64), responseHash: "3".repeat(64)
        }
      };
    }
  };
  const controller = new EvolutionLoopController({ orchestrator: f.orchestrator, proposer, feedbackContextBuilder });

  let run;
  for (let iteration = 0; iteration < 10; iteration += 1) {
    run = await controller.runOneRevision(f.runId);
    if (run.state === "STOPPED") break;
  }
  assert.equal(run.state, "STOPPED");
  assert.equal(calls.length, 2);
  const stopTransition = run.events.filter((event) => event.type === "STATE_TRANSITION" && event.payload?.to === "STOPPED").at(-1);
  assert.equal(stopTransition.payload.reasonCode, "NO_IMPROVEMENT_LIMIT_REACHED");
});
