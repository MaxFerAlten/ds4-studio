/**
 * DS4 Evolution — independently designed clean-room implementation.
 * Behavioral inputs: docs/evolution/behavioral-specification.md sections 2, 4, 6, and 17-19.
 * External source code or prompts copied: none.
 * Existing DS4 mechanisms reused: Evolution run store, workspace, executor, evaluator, and deterministic gate.
 */

import fs from "node:fs/promises";
import path from "node:path";

import { captureBaselineSnapshot } from "./evolutionRunStore.mjs";
import { decidePromotion } from "./evolutionPromotionGate.mjs";
import { hashJson, sha256, timingSafeHexEqual } from "./evolutionIntegrity.mjs";
import { buildEvidencePacket } from "./evolutionEvidencePacket.mjs";

export class EvolutionOrchestratorError extends Error {
  constructor(code, message, details = {}) {
    super(`${code}: ${message}`);
    this.name = "EvolutionOrchestratorError";
    this.code = code;
    this.details = details;
  }
}

function targetReached(taskContract, aggregateMetrics) {
  const targetMetrics = taskContract.metrics.filter((metric) => metric.required && metric.target !== null);
  if (!targetMetrics.length) return false;
  return targetMetrics.every((metric) => {
    const value = aggregateMetrics?.[metric.name];
    if (metric.direction === "maximize") return typeof value === "number" && value >= metric.target;
    if (metric.direction === "minimize") return typeof value === "number" && value <= metric.target;
    return value === metric.target;
  });
}

async function readRevisionText(runStore, runId, revision, name) {
  const file = path.join(runStore.revisionDir(runId, revision), name);
  return fs.readFile(file, "utf8").catch((error) => {
    if (error.code === "ENOENT") throw new EvolutionOrchestratorError("REVISION_ARTIFACT_MISSING", name);
    throw error;
  });
}

async function readRevisionJson(runStore, runId, revision, name) {
  const text = await readRevisionText(runStore, runId, revision, name);
  try {
    return { value: JSON.parse(text), text };
  } catch {
    throw new EvolutionOrchestratorError("REVISION_ARTIFACT_INVALID", name);
  }
}

async function readOptionalRevisionJson(runStore, runId, revision, name) {
  const file = path.join(runStore.revisionDir(runId, revision), name);
  const text = await fs.readFile(file, "utf8").catch((error) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    throw new EvolutionOrchestratorError("REVISION_ARTIFACT_INVALID", name);
  }
}

function validateSnapshot(snapshot, name) {
  if (!snapshot || !Array.isArray(snapshot.files) || !Array.isArray(snapshot.relevantPaths) ||
      typeof snapshot.contentHash !== "string" || !timingSafeHexEqual(hashJson(snapshot.files), snapshot.contentHash)) {
    throw new EvolutionOrchestratorError("SNAPSHOT_INTEGRITY_FAILURE", name);
  }
  return snapshot;
}

async function expectedCanonicalSnapshot(runStore, runId, revision) {
  const events = await runStore.readEvents(runId);
  for (let current = revision; current >= 1; current -= 1) {
    const snapshot = await readOptionalRevisionJson(runStore, runId, current, "promoted-snapshot.json");
    if (snapshot) {
      validateSnapshot(snapshot, `promoted-snapshot@${current}`);
      const applied = events.find((event) => event.type === "CANDIDATE_APPLIED" && event.revision === current);
      if (!applied || !timingSafeHexEqual(applied.payload?.integrityHash, snapshot.contentHash)) {
        throw new EvolutionOrchestratorError("SNAPSHOT_INTEGRITY_FAILURE", `promoted-snapshot@${current} is not ledger-bound`);
      }
      return snapshot;
    }
  }
  return validateSnapshot(await runStore.loadBaseline(runId), "baseline");
}

async function captureComparableSnapshot(repositoryRoot, expected) {
  return captureBaselineSnapshot({
    repositoryRoot,
    relevantPaths: expected.relevantPaths,
    repositoryIdentity: expected.repositoryIdentity,
    toolchainIdentity: expected.toolchainIdentity,
    configuration: {},
    now: new Date(expected.capturedAt)
  });
}

async function hiddenMaskBindings(workspaceRoot, taskContract) {
  const root = path.resolve(workspaceRoot);
  const hiddenPaths = [...new Set(taskContract.evaluators.flatMap((descriptor) =>
    descriptor.configuration?.hiddenPaths ?? []))].sort();
  const bindings = [];
  for (const hiddenPath of hiddenPaths) {
    const absolute = path.resolve(root, ...hiddenPath.split("/"));
    const relative = path.relative(root, absolute);
    if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new EvolutionOrchestratorError("HIDDEN_PATH_ESCAPE", hiddenPath);
    }
    const stat = await fs.lstat(absolute).catch((error) => {
      if (error.code === "ENOENT") throw new EvolutionOrchestratorError("HIDDEN_PATH_MISSING", hiddenPath);
      throw error;
    });
    if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory())) {
      throw new EvolutionOrchestratorError("HIDDEN_PATH_UNSUPPORTED", hiddenPath);
    }
    bindings.push(Object.freeze({
      target: path.posix.join("/workspace", hiddenPath),
      type: stat.isDirectory() ? "directory" : "file"
    }));
  }
  return Object.freeze(bindings);
}

async function loadRollbackArtifact(runStore, runId, revision) {
  const { value: record, text } = await readRevisionJson(runStore, runId, revision, "rollback.json");
  const artifact = Object.freeze({
    runId,
    path: path.posix.join("revisions", `r${String(revision).padStart(4, "0")}`, "rollback.json"),
    artifactId: `sha256:${sha256(text)}`,
    candidateHash: record.candidateHash,
    parentHash: record.parentHash,
    record: Object.freeze(record)
  });
  const events = await runStore.readEvents(runId);
  const prepared = events.find((event) => event.type === "ROLLBACK_PREPARED" && event.revision === revision &&
    event.payload?.artifactId === artifact.artifactId && event.payload?.candidateHash === artifact.candidateHash &&
    event.payload?.parentHash === artifact.parentHash);
  if (!prepared) throw new EvolutionOrchestratorError("ROLLBACK_ARTIFACT_INVALID", "rollback artifact is not ledger-bound");
  return artifact;
}

function publicCandidate(candidate) {
  return {
    candidateHash: candidate.candidateHash,
    patchMetadata: candidate.patchMetadata,
    audit: candidate.audit,
    impact: candidate.impact,
    requiresManualReview: candidate.requiresManualReview,
    evaluatorModified: false,
    hiddenInformationUsed: false,
    networkEnabled: false,
    securityViolations: []
  };
}

function securityPolicyFrom(evaluation) {
  const evaluator = evaluation.evaluators.find((entry) => entry.id === "security-policy" || entry.metrics?.security_passed !== undefined);
  if (!evaluator) return { passed: false, violations: ["SECURITY_EVALUATOR_MISSING"] };
  return {
    passed: evaluator.status === "passed" && evaluator.metrics?.security_passed !== false,
    violations: evaluator.violations ?? []
  };
}

export class EvolutionOrchestrator {
  constructor({
    runStore,
    workspaceManager,
    candidateBuilder,
    executor,
    evaluatorRegistry,
    promotionService,
    smokeEvaluator,
    promotionGate = decidePromotion,
    critic = null,
    evidencePacketBuilder = buildEvidencePacket,
    now = () => new Date()
  } = {}) {
    for (const [name, dependency] of Object.entries({
      runStore, workspaceManager, candidateBuilder, executor, evaluatorRegistry, promotionService,
      smokeEvaluator
    })) {
      if (!dependency) throw new TypeError(`${name} is required`);
    }
    if (typeof smokeEvaluator !== "function") throw new TypeError("smokeEvaluator must be a function");
    this.runStore = runStore;
    this.workspaceManager = workspaceManager;
    this.candidateBuilder = candidateBuilder;
    this.executor = executor;
    this.evaluatorRegistry = evaluatorRegistry;
    this.promotionService = promotionService;
    this.smokeEvaluator = smokeEvaluator;
    this.promotionGate = promotionGate;
    this.critic = critic;
    this.evidencePacketBuilder = evidencePacketBuilder;
    this.now = now;
  }

  async createRun(taskInput, options = {}) {
    return this.runStore.createRun(taskInput, options);
  }

  async prepareBaseline(runId) {
    const initial = await this.runStore.loadRun(runId);
    if (initial.state !== "CREATED") throw new EvolutionOrchestratorError("INVALID_RUN_STATE", initial.state);
    const taskContract = initial.manifest.taskContract;
    await this.runStore.transitionRun(runId, "BASELINE_CAPTURING");
    let snapshot;
    try {
      snapshot = await captureBaselineSnapshot({
        repositoryRoot: taskContract.workspaceRoot,
        relevantPaths: [...taskContract.mutablePaths, ...taskContract.immutablePaths],
        configuration: taskContract
      });
    } catch (error) {
      await this.runStore.transitionRun(runId, "FAILED", {
        kind: "hard_failure",
        reasonCode: "BASELINE_CAPTURE_FAILED",
        details: { errorCode: error.code ?? "UNKNOWN" }
      });
      throw error;
    }
    await this.runStore.transitionRun(runId, "BASELINE_EVALUATING");
    const baselineEvaluation = await this.evaluatorRegistry.evaluateAll({
      runId,
      revision: 0,
      taskContract,
      candidateWorkspace: taskContract.workspaceRoot,
      candidate: { audit: { filesChanged: 0, addedLines: 0, deletedLines: 0 }, securityViolations: [] },
      isBaseline: true
    });
    await this.runStore.saveBaseline(runId, snapshot, baselineEvaluation);
    if (baselineEvaluation.status === "failed" || baselineEvaluation.status === "error" || baselineEvaluation.hardFailures.length) {
      await this.runStore.transitionRun(runId, "FAILED", {
        reasonCode: "BASELINE_EVALUATION_FAILED",
        details: { hardFailures: baselineEvaluation.hardFailures }
      });
      return this.runStore.loadRun(runId);
    }
    await this.runStore.transitionRun(runId, "BASELINE_READY");
    return this.runStore.loadRun(runId);
  }

  async buildRevision(runId, { proposal, patchText }) {
    const run = await this.runStore.loadRun(runId);
    if (!["BASELINE_READY", "PROMOTED", "REJECTED"].includes(run.state)) {
      throw new EvolutionOrchestratorError("INVALID_RUN_STATE", run.state);
    }
    const parentRevision = run.events.reduce((highest, event) =>
      event.type === "STATE_TRANSITION" ? Math.max(highest, event.revision) : highest, 0);
    const revision = parentRevision + 1;
    if (proposal?.revision !== revision) {
      throw new EvolutionOrchestratorError("INVALID_REVISION", `proposal ${proposal?.revision} does not match candidate ${revision}`);
    }
    if (revision > run.manifest.taskContract.budgets.maxRevisions) {
      await this.runStore.transitionRun(runId, "STOPPED", { kind: "stop", revision: parentRevision, reasonCode: "REVISION_BUDGET_EXHAUSTED" });
      throw new EvolutionOrchestratorError("REVISION_BUDGET_EXHAUSTED", String(revision));
    }
    const expectedParent = await expectedCanonicalSnapshot(this.runStore, runId, parentRevision);
    const canonicalParent = await captureComparableSnapshot(this.workspaceManager.repositoryRoot, expectedParent);
    if (!timingSafeHexEqual(expectedParent.contentHash, canonicalParent.contentHash)) {
      await this.runStore.transitionRun(runId, "FAILED", {
        kind: "hard_failure", revision: parentRevision, reasonCode: "BASELINE_MUTATED"
      });
      throw new EvolutionOrchestratorError("BASELINE_MUTATED", "canonical parent differs from the last accepted snapshot");
    }
    await this.runStore.transitionRun(runId, "PROPOSING", { revision });
    if (proposal?.stopInstead === true) {
      await this.runStore.transitionRun(runId, "STOPPED", { revision, reasonCode: "PROPOSER_STOP_ACCEPTED" });
      return { revision, state: "STOPPED" };
    }
    await this.runStore.transitionRun(runId, "CANDIDATE_BUILDING", { revision });
    const workspace = await this.workspaceManager.createWorkspace({ runId, revision });
    const workspaceParent = await captureComparableSnapshot(workspace.root, expectedParent);
    if (!timingSafeHexEqual(expectedParent.contentHash, workspaceParent.contentHash)) {
      await this.runStore.transitionRun(runId, "FAILED", {
        kind: "hard_failure", revision, reasonCode: "BASELINE_MUTATED"
      });
      throw new EvolutionOrchestratorError("BASELINE_MUTATED", "candidate workspace did not derive from the accepted parent");
    }
    let candidate;
    try {
      candidate = await this.candidateBuilder.build({
        taskContract: run.manifest.taskContract,
        proposal,
        patchText,
        sourceRoot: this.workspaceManager.repositoryRoot,
        workspaceRoot: workspace.root
      });
    } catch (error) {
      await this.runStore.appendEvent(runId, {
        revision,
        type: "CANDIDATE_REJECTED",
        payload: { reasonCode: error.code ?? "CANDIDATE_BUILD_FAILED" }
      });
      await this.runStore.transitionRun(runId, "REJECTED", {
        revision,
        reasonCode: error.code ?? "CANDIDATE_BUILD_FAILED"
      });
      throw error;
    }
    const candidateSnapshot = await captureComparableSnapshot(workspace.root, expectedParent);
    if (!timingSafeHexEqual(candidate.audit.candidateHash, candidateSnapshot.contentHash)) {
      await this.runStore.transitionRun(runId, "FAILED", {
        kind: "hard_failure", revision, reasonCode: "CANDIDATE_SNAPSHOT_MISMATCH"
      });
      throw new EvolutionOrchestratorError("CANDIDATE_SNAPSHOT_MISMATCH", "candidate audit and snapshot disagree");
    }
    await this.runStore.writeRevisionArtifact(runId, revision, "parent-snapshot.json", canonicalParent);
    await this.runStore.writeRevisionArtifact(runId, revision, "candidate-snapshot.json", candidateSnapshot);
    await this.runStore.writeRevisionArtifact(runId, revision, "proposal.json", candidate.proposal);
    await this.runStore.writeRevisionArtifact(runId, revision, "candidate.patch", candidate.patchText ?? patchText);
    await this.runStore.writeRevisionArtifact(runId, revision, "candidate.json", publicCandidate(candidate));
    await this.runStore.transitionRun(runId, "CANDIDATE_READY", { revision });
    return Object.freeze({ revision, workspace, candidate: publicCandidate(candidate) });
  }

  async executeAndEvaluate(runId, revision, workspaceRoot) {
    const run = await this.runStore.loadRun(runId);
    if (run.state !== "CANDIDATE_READY" || run.revision !== revision) {
      throw new EvolutionOrchestratorError("INVALID_RUN_STATE", `${run.state}@${run.revision}`);
    }
    const taskContract = run.manifest.taskContract;
    const { value: candidate } = await readRevisionJson(this.runStore, runId, revision, "candidate.json");
    const initialCandidateHash = candidate.audit.candidateHash;
    const writableBindings = await this.workspaceManager.writableBindings(workspaceRoot, taskContract);
    const maskedBindings = await hiddenMaskBindings(workspaceRoot, taskContract);
    await this.runStore.transitionRun(runId, "EXECUTING", { revision });
    const execution = await this.executor.execute({
      runId,
      revision,
      workspaceRoot,
      writableBindings,
      maskedBindings,
      command: taskContract.evaluators[0]?.configuration?.candidateExecutable ?? "/usr/bin/node",
      args: taskContract.evaluators[0]?.configuration?.candidateArgs ?? ["-e", "process.exit(0)"],
      limits: { timeoutMs: taskContract.budgets.maxWallTimeMsPerRevision },
      postRunAudit: async () => {
        const audit = await this.workspaceManager.audit(workspaceRoot, taskContract);
        if (audit.candidateHash !== initialCandidateHash) {
          const error = new EvolutionOrchestratorError("CANDIDATE_MUTATED_DURING_EXECUTION", "candidate source changed during execution");
          throw error;
        }
      }
    });
    await this.runStore.writeRevisionArtifact(runId, revision, "execution.json", execution);
    if (execution.status === "infrastructure_error") {
      await this.runStore.transitionRun(runId, "FAILED", {
        revision,
        reasonCode: "INFRASTRUCTURE_FAILURE"
      });
      return { execution, evaluation: null, state: "FAILED" };
    }
    await this.runStore.transitionRun(runId, "EVALUATING", { revision });
    const evaluation = await this.evaluatorRegistry.evaluateAll({
      runId,
      revision,
      taskContract,
      candidateWorkspace: workspaceRoot,
      candidate,
      executionResult: execution
    });
    await this.runStore.writeRevisionArtifact(runId, revision, "evaluation.json", evaluation);
    await this.runStore.transitionRun(runId, "DIAGNOSING", { revision });
    await this.diagnoseRevision(runId, revision, evaluation, candidate);
    await this.runStore.transitionRun(runId, "GATING", { revision });
    return { execution, evaluation, candidate, state: "GATING" };
  }

  async diagnoseRevision(runId, revision, evaluation, candidate) {
    const run = await this.runStore.loadRun(runId);
    const taskContract = run.manifest.taskContract;
    if (!taskContract.automation?.criticEnabled || !this.critic) {
      const diagnosis = {
        diagnosisVersion: "ds4_evolution_diagnosis_v1",
        revision,
        status: "skipped",
        reasonCode: "LEVEL_B_DETERMINISTIC_KERNEL"
      };
      await this.runStore.writeRevisionArtifact(runId, revision, "diagnosis.json", diagnosis);
      return diagnosis;
    }
    const baselineEvaluation = JSON.parse(await fs.readFile(this.runStore.baselinePath(runId, "evaluation.json"), "utf8"));
    const evidence = [
      { runId, revision, artifactId: `sha256:${hashJson(evaluation)}`, path: "evaluation.json", summary: "candidate evaluator results" },
      { runId, revision, artifactId: `sha256:${candidate.candidateHash}`, path: "candidate.json", summary: "candidate metadata and bounded diff summary" }
    ];
    const packet = this.evidencePacketBuilder({
      runId,
      revision,
      objective: taskContract.objective,
      baselineMetrics: baselineEvaluation.aggregateMetrics,
      candidateMetrics: evaluation.aggregateMetrics,
      violations: evaluation.evaluators.flatMap((entry) => entry.violations ?? []),
      diffSummary: candidate.patchMetadata,
      evidence,
      rejectedStrategies: [],
      budget: {}
    });
    await this.runStore.writeRevisionArtifact(runId, revision, "evidence-packet.json", packet);
    try {
      const diagnosed = await this.critic.diagnose(packet, { maxRepairs: taskContract.budgets.maxCriticRepairs ?? 1 });
      await this.runStore.writeRevisionArtifact(runId, revision, "diagnosis.json", diagnosed.value);
      await this.runStore.writeRevisionArtifact(runId, revision, "critic-model-evidence.json", diagnosed.evidence);
      await this.runStore.appendEvent(runId, {
        revision,
        type: "MODEL_CALL_COMPLETED",
        payload: {
          role: "critic",
          usage: diagnosed.evidence.usage,
          calls: diagnosed.evidence.calls,
          repairs: diagnosed.evidence.repairs,
          promptHash: diagnosed.evidence.promptHash,
          responseHash: diagnosed.evidence.responseHash
        }
      });
      return diagnosed.value;
    } catch (error) {
      const diagnosis = {
        diagnosisVersion: "ds4_evolution_diagnosis_v1",
        revision,
        status: "completed",
        summary: "The consultive critic did not return a schema-valid diagnosis; deterministic evaluation and promotion remain authoritative.",
        rootCauses: [{
          code: error.code ?? "CRITIC_FAILED",
          description: "The critic response could not be validated against the diagnosis contract.",
          evidenceRefs: evidence
        }],
        recommendations: ["Use the deterministic evaluator and promotion gate as the authoritative result.", "Inspect the critic model response before relying on consultive explanations."],
        confidence: 0
      };
      await this.runStore.writeRevisionArtifact(runId, revision, "diagnosis.json", diagnosis);
      await this.runStore.appendEvent(runId, {
        revision,
        type: "CRITIC_FAILED",
        payload: { reasonCode: error.code ?? "CRITIC_FAILED" }
      });
      return diagnosis;
    }
  }

  async gateRevision(runId, revision, evaluation, candidate) {
    const run = await this.runStore.loadRun(runId);
    if (run.state !== "GATING" || run.revision !== revision) {
      throw new EvolutionOrchestratorError("INVALID_RUN_STATE", `${run.state}@${run.revision}`);
    }
    const baseline = await this.runStore.loadBaseline(runId);
    const { value: parentSnapshot } = await readRevisionJson(this.runStore, runId, revision, "parent-snapshot.json");
    validateSnapshot(parentSnapshot, `parent-snapshot@${revision}`);
    const canonicalParent = await captureComparableSnapshot(this.workspaceManager.repositoryRoot, parentSnapshot);
    if (!timingSafeHexEqual(parentSnapshot.contentHash, canonicalParent.contentHash)) {
      await this.runStore.transitionRun(runId, "FAILED", {
        kind: "hard_failure", revision, reasonCode: "BASELINE_MUTATED"
      });
      throw new EvolutionOrchestratorError("BASELINE_MUTATED", "canonical parent changed after candidate evaluation");
    }
    const baselineEvaluation = JSON.parse(await fs.readFile(this.runStore.baselinePath(runId, "evaluation.json"), "utf8"));
    const rollbackParent = await captureBaselineSnapshot({
      repositoryRoot: this.workspaceManager.repositoryRoot,
      relevantPaths: candidate.patchMetadata.files
    });
    const rollbackArtifact = await this.promotionService.prepareRollback({
      runId,
      revision,
      candidateHash: candidate.candidateHash,
      paths: candidate.patchMetadata.files,
      expectedParentHash: rollbackParent.contentHash
    });
    const gateDecision = this.promotionGate({
      runId,
      revision,
      decidedAt: this.now().toISOString(),
      taskContract: run.manifest.taskContract,
      baselineEvaluation,
      candidateEvaluation: evaluation,
      candidate,
      securityPolicy: securityPolicyFrom(evaluation),
      baselineIntegrity: timingSafeHexEqual(hashJson(baseline.files), baseline.contentHash),
      budgetState: { exceeded: revision > run.manifest.taskContract.budgets.maxRevisions },
      rollbackArtifact
    });
    await this.runStore.writeRevisionArtifact(runId, revision, "promotion.json", gateDecision);
    if (gateDecision.decision === "REJECT") {
      await this.runStore.transitionRun(runId, "REJECTED", {
        revision,
        reasonCode: gateDecision.hardFailures[0] ?? "PROMOTION_GATE_REJECTED"
      });
      return { gateDecision, rollbackArtifact, state: "REJECTED" };
    }
    if (gateDecision.decision === "MANUAL_REVIEW") {
      await this.runStore.transitionRun(runId, "MANUAL_REVIEW", { revision, reasonCode: "HUMAN_APPROVAL_REQUIRED" });
      return { gateDecision, rollbackArtifact, state: "MANUAL_REVIEW" };
    }
    const patchText = await readRevisionText(this.runStore, runId, revision, "candidate.patch");
    let promoted;
    try {
      promoted = await this.promotionService.promote({
        runId,
        revision,
        patchText,
        candidateHash: candidate.candidateHash,
        rollbackArtifact,
        gateDecision,
        integrityPaths: parentSnapshot.relevantPaths,
        expectedParentHash: parentSnapshot.contentHash,
        expectedPostHash: candidate.audit.candidateHash,
        smokeEvaluator: this.smokeEvaluator
      });
      const promotedSnapshot = await captureComparableSnapshot(this.workspaceManager.repositoryRoot, parentSnapshot);
      if (!timingSafeHexEqual(promoted.integrityHash, promotedSnapshot.contentHash)) {
        throw new EvolutionOrchestratorError("PROMOTED_SNAPSHOT_MISMATCH", "promoted repository hash is not stable");
      }
      await this.runStore.writeRevisionArtifact(runId, revision, "promoted-snapshot.json", promotedSnapshot);
    } catch (error) {
      if (promoted?.applied) {
        await this.promotionService.rollback({
          runId,
          revision,
          rollbackArtifact,
          expectedCurrentHash: promoted.promotedHash,
          smokeEvaluator: this.smokeEvaluator
        }).catch(() => {});
      }
      await this.runStore.transitionRun(runId, "FAILED", {
        kind: "hard_failure",
        revision,
        reasonCode: error.code ?? "PROMOTION_FAILED"
      });
      throw error;
    }
    await this.runStore.transitionRun(runId, "PROMOTED", { revision });
    if (targetReached(run.manifest.taskContract, evaluation.aggregateMetrics)) {
      await this.runStore.transitionRun(runId, "COMPLETED", { revision, reasonCode: "TARGET_REACHED" });
      return { gateDecision, rollbackArtifact, promoted, state: "COMPLETED" };
    }
    return { gateDecision, rollbackArtifact, promoted, state: "PROMOTED" };
  }

  async issueManualApproval(runId, revision, reviewer) {
    const run = await this.runStore.loadRun(runId);
    if (run.state !== "MANUAL_REVIEW" || run.revision !== revision) {
      throw new EvolutionOrchestratorError("INVALID_RUN_STATE", `${run.state}@${run.revision}`);
    }
    const { value: candidate } = await readRevisionJson(this.runStore, runId, revision, "candidate.json");
    const rollbackArtifact = await loadRollbackArtifact(this.runStore, runId, revision);
    return this.promotionService.issueApproval({
      runId,
      revision,
      candidateHash: candidate.candidateHash,
      parentHash: rollbackArtifact.parentHash,
      reviewer
    });
  }

  async approveRevision(runId, revision, approval) {
    const run = await this.runStore.loadRun(runId);
    if (run.state !== "MANUAL_REVIEW" || run.revision !== revision) {
      throw new EvolutionOrchestratorError("INVALID_RUN_STATE", `${run.state}@${run.revision}`);
    }
    const [{ value: candidate }, { value: evaluation }, { value: gateDecision }, { value: parentSnapshot }] = await Promise.all([
      readRevisionJson(this.runStore, runId, revision, "candidate.json"),
      readRevisionJson(this.runStore, runId, revision, "evaluation.json"),
      readRevisionJson(this.runStore, runId, revision, "promotion.json"),
      readRevisionJson(this.runStore, runId, revision, "parent-snapshot.json")
    ]);
    if (gateDecision.decision !== "MANUAL_REVIEW") {
      throw new EvolutionOrchestratorError("PROMOTION_NOT_AUTHORIZED", gateDecision.decision);
    }
    validateSnapshot(parentSnapshot, `parent-snapshot@${revision}`);
    const canonicalParent = await captureComparableSnapshot(this.workspaceManager.repositoryRoot, parentSnapshot);
    if (!timingSafeHexEqual(parentSnapshot.contentHash, canonicalParent.contentHash)) {
      await this.runStore.transitionRun(runId, "FAILED", {
        kind: "hard_failure", revision, reasonCode: "BASELINE_MUTATED"
      });
      throw new EvolutionOrchestratorError("BASELINE_MUTATED", "canonical parent changed while approval was pending");
    }
    const rollbackArtifact = await loadRollbackArtifact(this.runStore, runId, revision);
    const patchText = await readRevisionText(this.runStore, runId, revision, "candidate.patch");
    let promoted;
    try {
      promoted = await this.promotionService.promote({
        runId,
        revision,
        patchText,
        candidateHash: candidate.candidateHash,
        rollbackArtifact,
        gateDecision,
        approval,
        integrityPaths: parentSnapshot.relevantPaths,
        expectedParentHash: parentSnapshot.contentHash,
        expectedPostHash: candidate.audit.candidateHash,
        smokeEvaluator: this.smokeEvaluator
      });
      const promotedSnapshot = await captureComparableSnapshot(this.workspaceManager.repositoryRoot, parentSnapshot);
      if (!timingSafeHexEqual(promoted.integrityHash, promotedSnapshot.contentHash)) {
        throw new EvolutionOrchestratorError("PROMOTED_SNAPSHOT_MISMATCH", "promoted repository hash is not stable");
      }
      await this.runStore.writeRevisionArtifact(runId, revision, "promoted-snapshot.json", promotedSnapshot);
    } catch (error) {
      if (promoted?.applied) {
        await this.promotionService.rollback({
          runId,
          revision,
          rollbackArtifact,
          expectedCurrentHash: promoted.promotedHash,
          smokeEvaluator: this.smokeEvaluator
        }).catch(() => {});
      }
      if (String(error.code ?? "").startsWith("APPROVAL_")) throw error;
      await this.runStore.transitionRun(runId, "FAILED", {
        kind: "hard_failure", revision, reasonCode: error.code ?? "PROMOTION_FAILED"
      });
      throw error;
    }
    await this.runStore.transitionRun(runId, "PROMOTED", { revision });
    if (targetReached(run.manifest.taskContract, evaluation.aggregateMetrics)) {
      await this.runStore.transitionRun(runId, "COMPLETED", { revision, reasonCode: "TARGET_REACHED" });
      return { gateDecision, rollbackArtifact, promoted, state: "COMPLETED" };
    }
    return { gateDecision, rollbackArtifact, promoted, state: "PROMOTED" };
  }

  async rejectManualRevision(runId, revision, reasonCode = "HUMAN_REJECTED") {
    const run = await this.runStore.loadRun(runId);
    if (run.state !== "MANUAL_REVIEW" || run.revision !== revision) {
      throw new EvolutionOrchestratorError("INVALID_RUN_STATE", `${run.state}@${run.revision}`);
    }
    await this.runStore.transitionRun(runId, "REJECTED", { revision, reasonCode });
    return this.runStore.loadRun(runId);
  }

  async rollbackRevision(runId, revision, reviewer = null) {
    const run = await this.runStore.loadRun(runId);
    if (run.revision < revision) throw new EvolutionOrchestratorError("INVALID_REVISION", String(revision));
    const rollbackArtifact = await loadRollbackArtifact(this.runStore, runId, revision);
    const applied = run.events.find((event) => event.type === "CANDIDATE_APPLIED" && event.revision === revision);
    if (!applied) throw new EvolutionOrchestratorError("ROLLBACK_NOT_AVAILABLE", String(revision));
    return this.promotionService.rollback({
      runId,
      revision,
      rollbackArtifact,
      expectedCurrentHash: applied.payload.promotedHash,
      smokeEvaluator: this.smokeEvaluator,
      reviewer
    });
  }

  async runManualCandidate(runId, input) {
    const built = await this.buildRevision(runId, input);
    if (built.state === "STOPPED") return built;
    const evaluated = await this.executeAndEvaluate(runId, built.revision, built.workspace.root);
    if (evaluated.state === "FAILED") return evaluated;
    return this.gateRevision(runId, built.revision, evaluated.evaluation, evaluated.candidate);
  }

  async stop(runId, reasonCode = "MANUAL_STOP") {
    const run = await this.runStore.loadRun(runId);
    await this.runStore.transitionRun(runId, "STOPPED", {
      kind: "stop",
      revision: run.revision,
      reasonCode
    });
    return this.runStore.loadRun(runId);
  }
}
