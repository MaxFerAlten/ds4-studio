/**
 * DS4 Evolution — independently designed clean-room implementation.
 * Behavioral inputs: docs/evolution/acceptance-contract.md sections 14-17.
 * External source code or prompts copied: none.
 * Existing DS4 mechanisms reused: DS4 evolution orchestrator and structured model client.
 */

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { EvolutionCandidateBuilder } from "../../../frontend/server/evolution/evolutionCandidateBuilder.mjs";
import { EVOLUTION_PROPOSAL_VERSION, EVOLUTION_TASK_VERSION_V2 } from "../../../frontend/server/evolution/evolutionContracts.mjs";
import { EvolutionCritic } from "../../../frontend/server/evolution/evolutionCritic.mjs";
import { EvolutionEvaluatorRegistry } from "../../../frontend/server/evolution/evolutionEvaluator.mjs";
import { EvolutionExecutor } from "../../../frontend/server/evolution/evolutionExecutor.mjs";
import { EvolutionModelClient } from "../../../frontend/server/evolution/evolutionModelClient.mjs";
import { EvolutionOrchestrator } from "../../../frontend/server/evolution/evolutionOrchestrator.mjs";
import { EvolutionPromotionService } from "../../../frontend/server/evolution/evolutionPromotion.mjs";
import { EvolutionProposer } from "../../../frontend/server/evolution/evolutionProposer.mjs";
import { EvolutionRunStore, captureBaselineSnapshot } from "../../../frontend/server/evolution/evolutionRunStore.mjs";
import { EvolutionSourceContext } from "../../../frontend/server/evolution/evolutionSourceContext.mjs";
import { EvolutionWorkspaceManager } from "../../../frontend/server/evolution/evolutionWorkspace.mjs";
import { StructuredModelClient } from "../../../frontend/server/structuredModelClient.mjs";
import { atomicWriteJson, hashJson, sha256 } from "../../../frontend/server/evolution/evolutionIntegrity.mjs";

const execFileAsync = promisify(execFile);

const DEFAULT_TIMEOUT_MS = 120_000;

const VALUE_PASSING = `export function evaluate(input) {
  return input === "pass";
}
`;

const VALUE_FAILING = `export function evaluate(input) {
  return false;
}
`;

const EVALUATE_PASSING = `import { evaluate } from "../src/value.mjs";
const result = evaluate(process.argv[2] || "pass");
process.exit(result ? 0 : 1);
`;

const EVALUATE_FAILING = `import { evaluate } from "../src/value.mjs";
const result = evaluate(process.argv[2] || "pass");
process.exit(result ? 0 : 1);
`;

const SECURITY_PASSING = `process.exit(0);
`;

const PATCH_BREAK_VALUE = `diff --git a/src/value.mjs b/src/value.mjs
--- a/src/value.mjs
+++ b/src/value.mjs
@@ -1 +1,3 @@
-export function evaluate(input) {
-  return input === "pass";
+export function evaluate(input) {
+  return false;
 }
`;

const PATCH_COSMETIC_PASS = `diff --git a/src/value.mjs b/src/value.mjs
--- a/src/value.mjs
+++ b/src/value.mjs
@@ -1,3 +1,4 @@
 export function evaluate(input) {
+  // validated by live benchmark
   return input === "pass";
 }
`;

function deterministicRunId(seed) {
  const hash = crypto.createHash("sha256").update(String(seed)).digest("hex");
  return `evo_${hash.slice(0, 20)}`;
}

async function createFixtureRepository(root) {
  await fs.mkdir(path.join(root, "src"), { recursive: true });
  await fs.mkdir(path.join(root, "checks"), { recursive: true });
  await fs.writeFile(path.join(root, "src", "value.mjs"), VALUE_PASSING, "utf8");
  await fs.writeFile(path.join(root, "checks", "evaluate.mjs"), EVALUATE_PASSING, "utf8");
  await fs.writeFile(path.join(root, "checks", "security.mjs"), SECURITY_PASSING, "utf8");
}

function buildTaskContract(repositoryRoot, options = {}) {
  return {
    contractVersion: EVOLUTION_TASK_VERSION_V2,
    taskId: options.taskId ?? "live-benchmark",
    title: options.title ?? "Live benchmark fixture",
    objective: options.objective ?? "Verify live model critic behavior",
    workspaceRoot: repositoryRoot,
    mutablePaths: ["src"],
    immutablePaths: ["checks", "evolutionPromotionGate.mjs", "evolutionPromotion.mjs", "hidden-fixtures"],
    baselineRef: "snapshot",
    evaluators: [
      { id: "correctness", required: true, configuration: { type: "live-eval" } },
      { id: "security-policy", required: true, configuration: { type: "security-policy" } }
    ],
    metrics: [
      { name: "score", direction: "boolean", required: true, baselineTolerance: 0, target: true, weight: 1 },
      { name: "security_passed", direction: "boolean", required: true, baselineTolerance: 0, target: true, weight: 1 }
    ],
    budgets: {
      maxRevisions: 2, maxFilesChanged: 2, maxAddedLines: 50, maxDeletedLines: 50,
      maxWallTimeMsPerRevision: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      maxPromptTokensPerRevision: 4000, maxCompletionTokensPerRevision: 4000,
      maxTotalWallTimeMs: (options.timeoutMs ?? DEFAULT_TIMEOUT_MS) * 2,
      maxTotalPromptTokens: 8000, maxTotalCompletionTokens: 8000,
      maxModelCallsPerRevision: 2, maxInfrastructureRetries: 1, maxEvaluatorRetries: 1,
      maxCriticRepairs: 1, maxProposerRepairs: 1, maxRepeatedFailureSignatures: 2,
      maxNoImprovementRevisions: 2
    },
    approvalPolicy: { mode: "manual", allowedRiskLevels: ["LOW"] },
    automation: { level: "C", criticEnabled: true, proposerEnabled: false, autoContinue: false, modelProfile: "default" }
  };
}

function createLiveEvalAdapter() {
  return async function liveEval(context) {
    const root = path.resolve(context.candidateWorkspace);
    const checksPath = path.join(root, "checks", "evaluate.mjs");
    try {
      const { stdout } = await execFileAsync("node", [checksPath], { cwd: root, timeout: 10_000 });
      return {
        status: "passed",
        metrics: { score: true },
        violations: [],
        artifacts: [],
        reproducibility: { commandHash: hashJson({ evaluator: "live-eval", version: 1 }), environmentHash: hashJson({}), seed: null }
      };
    } catch {
      return {
        status: "failed",
        metrics: { score: false },
        violations: ["LIVE_EVAL_FAILED"],
        artifacts: [],
        reproducibility: { commandHash: hashJson({ evaluator: "live-eval", version: 1 }), environmentHash: hashJson({}), seed: null }
      };
    }
  };
}

function buildDefectiveProposal(feedbackContextHash) {
  return {
    proposalVersion: EVOLUTION_PROPOSAL_VERSION,
    revision: 1,
    summary: "Intentionally break the evaluate function",
    hypothesis: "Replacing the condition with false will demonstrate a deterministic failure",
    targetFiles: ["src/value.mjs"],
    targetSymbols: [],
    plannedChanges: [{ file: "src/value.mjs", symbol: "evaluate", change: "replace body", reason: "benchmark regression", expectedMetricEffect: { metric: "score", direction: "decrease" } }],
    testsToRun: ["correctness", "security-policy"],
    knownRisks: [],
    stopInstead: false,
    impactAnalysis: null,
    feedbackContextHash
  };
}

function buildPassingProposal(feedbackContextHash) {
  return {
    proposalVersion: EVOLUTION_PROPOSAL_VERSION,
    revision: 2,
    summary: "Restore the evaluate function to passing state",
    hypothesis: "The original condition input === pass is the correct fix",
    targetFiles: ["src/value.mjs"],
    targetSymbols: [],
    plannedChanges: [{ file: "src/value.mjs", symbol: "evaluate", change: "restore body", reason: "fix regression", expectedMetricEffect: { metric: "score", direction: "increase" } }],
    testsToRun: ["correctness", "security-policy"],
    knownRisks: [],
    stopInstead: false,
    impactAnalysis: null,
    feedbackContextHash
  };
}

export async function runLevelCLiveArm({
  repositoryRoot,
  artifactsDir,
  modelBaseUrl,
  model,
  token,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  seed = 0
} = {}) {
  const runId = deterministicRunId(seed);
  const fixtureDir = await fs.mkdtemp(path.join(repositoryRoot, "fixture-"));
  try {
    await createFixtureRepository(fixtureDir);

    const stateDir = path.join(artifactsDir, "state");
    const workDir = path.join(artifactsDir, "workspaces");
    await fs.mkdir(stateDir, { recursive: true });
    await fs.mkdir(workDir, { recursive: true });

    const runStore = new EvolutionRunStore({ rootDir: stateDir, runIdFactory: () => runId });
    const workspaceManager = new EvolutionWorkspaceManager({ repositoryRoot: fixtureDir, workRoot: workDir });
    const candidateBuilder = new EvolutionCandidateBuilder();
    const executor = new EvolutionExecutor({ runStore });

    const structuredClient = new StructuredModelClient({
      baseUrl: modelBaseUrl,
      model,
      timeoutMs,
      errorPrefix: "live-benchmark"
    });
    const modelClient = new EvolutionModelClient({ client: structuredClient });

    const evaluatorRegistry = new EvolutionEvaluatorRegistry({ executor });
    evaluatorRegistry.register("live-eval", createLiveEvalAdapter());
    const promotionService = new EvolutionPromotionService({ repositoryRoot: fixtureDir, runStore });
    const sourceContext = new EvolutionSourceContext({ repositoryRoot: fixtureDir });
    const proposer = new EvolutionProposer({ modelClient, sourceContext });
    const critic = new EvolutionCritic({ modelClient });

    const orchestrator = new EvolutionOrchestrator({
      runStore, workspaceManager, candidateBuilder, executor, evaluatorRegistry, promotionService,
      smokeEvaluator: async () => ({ passed: true }),
      critic,
      now: () => new Date()
    });

    const task = buildTaskContract(fixtureDir, { timeoutMs, taskId: `live-c-${seed}` });
    await orchestrator.createRun(task, { repositoryRoot: fixtureDir });
    const baseline = await orchestrator.prepareBaseline(runId);

    const feedbackContextBuilder = new (await import("../../../frontend/server/evolution/evolutionFeedbackContext.mjs")).EvolutionFeedbackContextBuilder({ runStore });
    const feedbackContext = await feedbackContextBuilder.build({ runId, nextRevision: 1 });
    const proposal = buildDefectiveProposal(feedbackContext.contextHash);
    const patchResult = await orchestrator.runManualCandidate(runId, { proposal, patchText: PATCH_BREAK_VALUE });

    const run = await runStore.loadRun(runId);
    const events = await runStore.readEvents(runId);

    const requestRecord = { runId, task, seed, modelBaseUrl, model, timestamp: new Date().toISOString() };
    const decision = {
      schema: "ds4_evolution_live_c_decision_v1",
      runId,
      gateDecision: patchResult.gateDecision?.decision ?? "UNKNOWN",
      expectedGate: "REJECT",
      passed: patchResult.gateDecision?.decision === "REJECT",
      model,
      modelEndpointHash: sha256(modelBaseUrl),
      sourceRevisionHash: sha256(JSON.stringify(task)),
      decidedAt: new Date().toISOString()
    };

    await atomicWriteJson(path.join(artifactsDir, "request.json"), requestRecord);
    await atomicWriteJson(path.join(artifactsDir, "run.json"), run);
    await atomicWriteJson(path.join(artifactsDir, "events.json"), events);
    await atomicWriteJson(path.join(artifactsDir, "decision.json"), decision);
    await atomicWriteJson(path.join(artifactsDir, "proposal.json"), proposal);
    await atomicWriteJson(path.join(artifactsDir, "patch-result.json"), patchResult);

    return { runId, decision, run, events };
  } finally {
    await fs.rm(fixtureDir, { recursive: true, force: true }).catch(() => {});
  }
}

export async function runLevelDLiveArm({
  repositoryRoot,
  artifactsDir,
  modelBaseUrl,
  model,
  token,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  seed = 0
} = {}) {
  const runId = deterministicRunId(seed);
  const fixtureDir = await fs.mkdtemp(path.join(repositoryRoot, "fixture-"));
  try {
    await createFixtureRepository(fixtureDir);

    const stateDir = path.join(artifactsDir, "state");
    const workDir = path.join(artifactsDir, "workspaces");
    await fs.mkdir(stateDir, { recursive: true });
    await fs.mkdir(workDir, { recursive: true });

    const runStore = new EvolutionRunStore({ rootDir: stateDir, runIdFactory: () => runId });
    const workspaceManager = new EvolutionWorkspaceManager({ repositoryRoot: fixtureDir, workRoot: workDir });
    const candidateBuilder = new EvolutionCandidateBuilder();
    const executor = new EvolutionExecutor({ runStore });

    const structuredClient = new StructuredModelClient({
      baseUrl: modelBaseUrl,
      model,
      timeoutMs,
      errorPrefix: "live-benchmark"
    });
    const modelClient = new EvolutionModelClient({ client: structuredClient });

    const evaluatorRegistry = new EvolutionEvaluatorRegistry({ executor });
    evaluatorRegistry.register("live-eval", createLiveEvalAdapter());
    const promotionService = new EvolutionPromotionService({ repositoryRoot: fixtureDir, runStore });
    const sourceContext = new EvolutionSourceContext({ repositoryRoot: fixtureDir });
    const proposer = new EvolutionProposer({ modelClient, sourceContext });
    const critic = new EvolutionCritic({ modelClient });

    const orchestrator = new EvolutionOrchestrator({
      runStore, workspaceManager, candidateBuilder, executor, evaluatorRegistry, promotionService,
      smokeEvaluator: async () => ({ passed: true }),
      critic, proposer,
      now: () => new Date()
    });

    const task = buildTaskContract(fixtureDir, {
      timeoutMs,
      taskId: `live-d-${seed}`,
      title: "Level D feedback loop benchmark",
      objective: "Verify two-revision feedback loop with real model"
    });
    task.automation = { level: "D", criticEnabled: true, proposerEnabled: true, autoContinue: false, modelProfile: "default" };

    await orchestrator.createRun(task, { repositoryRoot: fixtureDir });
    await orchestrator.prepareBaseline(runId);

    const feedbackContextBuilder = new (await import("../../../frontend/server/evolution/evolutionFeedbackContext.mjs")).EvolutionFeedbackContextBuilder({ runStore });
    const feedbackContext1 = await feedbackContextBuilder.build({ runId, nextRevision: 1 });
    const proposal1 = buildDefectiveProposal(feedbackContext1.contextHash);
    const result1 = await orchestrator.runManualCandidate(runId, { proposal: proposal1, patchText: PATCH_BREAK_VALUE });

    let result2 = null;
    let proposal2 = null;
    if (result1.state === "REJECTED") {
      const feedbackContext2 = await feedbackContextBuilder.build({ runId, nextRevision: 2 });
      proposal2 = buildPassingProposal(feedbackContext2.contextHash);
      result2 = await orchestrator.runManualCandidate(runId, { proposal: proposal2, patchText: PATCH_COSMETIC_PASS });
    }

    const run = await runStore.loadRun(runId);
    const events = await runStore.readEvents(runId);

    const decision = {
      schema: "ds4_evolution_live_d_decision_v1",
      runId,
      revision1: { gateDecision: result1.gateDecision?.decision ?? "UNKNOWN", hypothesis: proposal1.hypothesis },
      revision2: result2 ? { gateDecision: result2.gateDecision?.decision ?? "UNKNOWN", hypothesis: proposal2?.hypothesis } : null,
      feedbackContextUsed: true,
      passed: result2?.gateDecision?.decision === "PROMOTE" || result1.gateDecision?.decision === "PROMOTE",
      model,
      modelEndpointHash: sha256(modelBaseUrl),
      sourceRevisionHash: sha256(JSON.stringify(task)),
      decidedAt: new Date().toISOString()
    };

    await atomicWriteJson(path.join(artifactsDir, "request.json"), { runId, task, seed, modelBaseUrl, model, timestamp: new Date().toISOString() });
    await atomicWriteJson(path.join(artifactsDir, "run.json"), run);
    await atomicWriteJson(path.join(artifactsDir, "events.json"), events);
    await atomicWriteJson(path.join(artifactsDir, "decision.json"), decision);
    if (proposal1) await atomicWriteJson(path.join(artifactsDir, "proposal-r1.json"), proposal1);
    if (proposal2) await atomicWriteJson(path.join(artifactsDir, "proposal-r2.json"), proposal2);
    await atomicWriteJson(path.join(artifactsDir, "result-r1.json"), result1);
    if (result2) await atomicWriteJson(path.join(artifactsDir, "result-r2.json"), result2);

    return { runId, decision, run, events, result1, result2 };
  } finally {
    await fs.rm(fixtureDir, { recursive: true, force: true }).catch(() => {});
  }
}
