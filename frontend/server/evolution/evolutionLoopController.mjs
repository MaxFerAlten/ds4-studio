/**
 * DS4 Evolution — independently designed clean-room implementation.
 * Behavioral inputs: docs/evolution/behavioral-specification.md automatic loop semantics.
 * External source code or prompts copied: none.
 * Existing DS4 mechanisms reused: EvolutionOrchestrator and ledger state.
 */

import fs from "node:fs/promises";

import { decideLoopContinuation, deriveBudgetState, deriveImprovementState } from "./evolutionBudget.mjs";
import { hashJson, timingSafeHexEqual } from "./evolutionIntegrity.mjs";

const CONCLUDED_STATES = new Set(["REJECTED", "PROMOTED", "COMPLETED"]);

export class EvolutionLoopError extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.name = "EvolutionLoopError";
    this.code = code;
  }
}

function assertNotAborted(signal) {
  if (signal?.aborted) throw signal.reason ?? Object.assign(new Error("aborted"), { name: "AbortError" });
}

function modelEvent(evidence) {
  return {
    role: evidence.role,
    usage: evidence.usage,
    calls: evidence.calls,
    repairs: evidence.repairs,
    promptHash: evidence.promptHash,
    responseHash: evidence.responseHash
  };
}

async function readGeneratedArtifact(store, runId, revision, name) {
  if (typeof store.readRevisionArtifact !== "function") return null;
  try {
    const artifact = await store.readRevisionArtifact(runId, revision, name, { maxBytes: 256_000 });
    if (artifact.truncated) throw new EvolutionLoopError("GENERATED_ARTIFACT_TOO_LARGE", name);
    return JSON.parse(artifact.content);
  } catch (error) {
    if (error.code === "ARTIFACT_NOT_FOUND") return null;
    if (error instanceof SyntaxError) throw new EvolutionLoopError("GENERATED_ARTIFACT_INVALID", name);
    throw error;
  }
}

function validateStoredProposal(stored, revision, feedbackContextHash) {
  if (stored?.schema !== "ds4_evolution_generated_proposal_v1" || stored.revision !== revision ||
      !stored.proposal || !stored.modelEvidence || !timingSafeHexEqual(stored.proposalHash, hashJson(stored.proposal)) ||
      !timingSafeHexEqual(stored.proposal.feedbackContextHash, feedbackContextHash)) {
    throw new EvolutionLoopError("GENERATED_ARTIFACT_INVALID", "generated-proposal.json");
  }
  return Object.freeze({ proposal: stored.proposal, proposalHash: stored.proposalHash, modelEvidence: stored.modelEvidence });
}

function validateStoredFeedbackContext(stored, revision) {
  if (!stored || stored.schema !== "ds4_evolution_feedback_context_v1" || stored.nextRevision !== revision) {
    throw new EvolutionLoopError("GENERATED_ARTIFACT_INVALID", "feedback-context.json");
  }
  const { contextHash, ...rest } = stored;
  if (!timingSafeHexEqual(contextHash, hashJson(rest))) {
    throw new EvolutionLoopError("GENERATED_ARTIFACT_INVALID", "feedback-context.json");
  }
  return stored;
}

function validateStoredPatch(stored, proposalHash) {
  if (stored?.schema !== "ds4_evolution_generated_patch_artifact_v1" || !stored.generatedPatch ||
      !stored.modelEvidence || !timingSafeHexEqual(stored.proposalHash, proposalHash) ||
      !timingSafeHexEqual(stored.generatedPatch.proposalHash, proposalHash) ||
      typeof stored.generatedPatch.patchText !== "string") {
    throw new EvolutionLoopError("GENERATED_ARTIFACT_INVALID", "generated-patch.json");
  }
  return Object.freeze({
    generatedPatch: stored.generatedPatch,
    patchText: stored.generatedPatch.patchText,
    modelEvidence: stored.modelEvidence
  });
}

function lastTransitionByRevision(events) {
  const map = new Map();
  for (const event of [...events].sort((left, right) => left.sequence - right.sequence)) {
    if (event.type === "STATE_TRANSITION" && event.revision > 0) map.set(event.revision, event);
  }
  return map;
}

async function loadImprovementEvidence(store, runId, events, nextRevision) {
  const transitions = lastTransitionByRevision(events);
  const concluded = [...transitions.keys()]
    .filter((revision) => revision < nextRevision && CONCLUDED_STATES.has(transitions.get(revision).payload?.to))
    .sort((left, right) => left - right);
  if (concluded.length === 0) return { baselineEvaluation: null, revisionEvaluations: [] };

  const revisionEvaluations = [];
  for (const revision of concluded) {
    const evaluation = await readGeneratedArtifact(store, runId, revision, "evaluation.json");
    revisionEvaluations.push({ revision, outcome: transitions.get(revision).payload.to, evaluation });
  }
  let baselineEvaluation = null;
  try {
    baselineEvaluation = JSON.parse(await fs.readFile(store.baselinePath(runId, "evaluation.json"), "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  return { baselineEvaluation, revisionEvaluations };
}

async function ensureModelEvidence(store, runId, revision, role, evidence) {
  const artifactName = `${role}-model-evidence.json`;
  const existingArtifact = await readGeneratedArtifact(store, runId, revision, artifactName);
  if (!existingArtifact) await store.writeRevisionArtifact(runId, revision, artifactName, evidence);
  else if (!timingSafeHexEqual(hashJson(existingArtifact), hashJson(evidence))) {
    throw new EvolutionLoopError("MODEL_EVIDENCE_MISMATCH", role);
  }
  const events = await store.readEvents(runId);
  const recorded = events.some((event) => event.revision === revision && event.type === "MODEL_CALL_COMPLETED" &&
    event.payload?.role === evidence.role && timingSafeHexEqual(event.payload?.responseHash, evidence.responseHash));
  if (!recorded) await store.appendEvent(runId, { revision, type: "MODEL_CALL_COMPLETED", payload: modelEvent(evidence) });
}

export class EvolutionLoopController {
  constructor({
    orchestrator,
    proposer,
    feedbackContextBuilder,
    budgetPolicy = { deriveBudgetState, decideLoopContinuation, deriveImprovementState },
    logger = console
  } = {}) {
    if (!orchestrator) throw new TypeError("orchestrator is required");
    this.orchestrator = orchestrator;
    this.proposer = proposer;
    this.feedbackContextBuilder = feedbackContextBuilder;
    this.budgetPolicy = budgetPolicy;
    this.logger = logger;
  }

  async runOneRevision(runId, { signal } = {}) {
    assertNotAborted(signal);
    let run = await this.orchestrator.runStore.loadRun(runId);
    if (run.state === "CREATED") {
      run = await this.orchestrator.prepareBaseline(runId);
      if (run.state !== "BASELINE_READY") return run;
    }
    const events = await this.orchestrator.runStore.readEvents(runId);
    const budget = this.budgetPolicy.deriveBudgetState(run.manifest.taskContract, events);
    const continuation = this.budgetPolicy.decideLoopContinuation(run, budget);
    if (!continuation.continue) {
      if (continuation.reasonCode === "BUDGET_EXHAUSTED") return this.orchestrator.stop(runId, continuation.reasonCode);
      return run;
    }
    if (run.manifest.taskContract.automation?.proposerEnabled !== true) return run;
    if (!this.proposer) throw new EvolutionLoopError("PROPOSER_UNAVAILABLE", "Level D requires a Proposer");
    if (!this.feedbackContextBuilder) {
      throw new EvolutionLoopError("FEEDBACK_CONTEXT_BUILDER_UNAVAILABLE", "Level D requires a feedback context builder");
    }
    const improvementEvidence = await loadImprovementEvidence(this.orchestrator.runStore, runId, events, run.revision + 1);
    const improvementState = this.budgetPolicy.deriveImprovementState({
      taskContract: run.manifest.taskContract,
      baselineEvaluation: improvementEvidence.baselineEvaluation,
      revisionEvaluations: improvementEvidence.revisionEvaluations
    });
    if (improvementState.exhausted) return this.orchestrator.stop(runId, "NO_IMPROVEMENT_LIMIT_REACHED");
    const revision = run.revision + 1;
    assertNotAborted(signal);
    const storedFeedbackContext = await readGeneratedArtifact(this.orchestrator.runStore, runId, revision, "feedback-context.json");
    const feedbackContext = storedFeedbackContext
      ? validateStoredFeedbackContext(storedFeedbackContext, revision)
      : await this.feedbackContextBuilder.build({ runId, nextRevision: revision, taskContract: run.manifest.taskContract, events, budget });
    if (!storedFeedbackContext) {
      await this.orchestrator.runStore.writeRevisionArtifact(runId, revision, "feedback-context.json", feedbackContext);
    }
    const storedProposal = await readGeneratedArtifact(this.orchestrator.runStore, runId, revision, "generated-proposal.json");
    const proposed = storedProposal ? validateStoredProposal(storedProposal, revision, feedbackContext.contextHash) : await this.proposer.propose({
      taskContract: run.manifest.taskContract,
      revision,
      history: feedbackContext.history,
      diagnosis: feedbackContext.previousDiagnosis,
      metricTrend: feedbackContext.metricTrend,
      rejectedStrategies: feedbackContext.rejectedStrategies,
      promotedStrategies: feedbackContext.promotedStrategies,
      noImprovementStreak: feedbackContext.noImprovementStreak,
      feedbackContextHash: feedbackContext.contextHash,
      budget,
      signal
    });
    if (!storedProposal && !timingSafeHexEqual(proposed.proposal.feedbackContextHash, feedbackContext.contextHash)) {
      throw new EvolutionLoopError("FEEDBACK_CONTEXT_HASH_MISMATCH", "proposal is not bound to the supplied feedback context");
    }
    if (!storedProposal) {
      await this.orchestrator.runStore.writeRevisionArtifact(runId, revision, "generated-proposal.json", {
        schema: "ds4_evolution_generated_proposal_v1",
        revision,
        proposal: proposed.proposal,
        proposalHash: proposed.proposalHash,
        modelEvidence: proposed.modelEvidence
      });
    }
    await ensureModelEvidence(this.orchestrator.runStore, runId, revision, "proposer", proposed.modelEvidence);
    if (proposed.proposal.stopInstead) {
      return this.orchestrator.buildRevision(runId, { proposal: proposed.proposal, patchText: "" });
    }
    const afterProposal = this.budgetPolicy.deriveBudgetState(run.manifest.taskContract, await this.orchestrator.runStore.readEvents(runId));
    if (afterProposal.exceeded) return this.orchestrator.stop(runId, "BUDGET_EXHAUSTED");
    assertNotAborted(signal);
    const storedPatch = await readGeneratedArtifact(this.orchestrator.runStore, runId, revision, "generated-patch.json");
    const patched = storedPatch ? validateStoredPatch(storedPatch, proposed.proposalHash) : await this.proposer.producePatch({
      taskContract: run.manifest.taskContract,
      proposal: proposed.proposal,
      proposalHash: proposed.proposalHash,
      signal
    });
    if (!storedPatch) {
      await this.orchestrator.runStore.writeRevisionArtifact(runId, revision, "generated-patch.json", {
        schema: "ds4_evolution_generated_patch_artifact_v1",
        proposalHash: proposed.proposalHash,
        generatedPatch: patched.generatedPatch ?? { proposalHash: proposed.proposalHash, patchText: patched.patchText },
        modelEvidence: patched.modelEvidence
      });
    }
    await ensureModelEvidence(this.orchestrator.runStore, runId, revision, "patcher", patched.modelEvidence);
    const afterPatch = this.budgetPolicy.deriveBudgetState(run.manifest.taskContract, await this.orchestrator.runStore.readEvents(runId));
    if (afterPatch.exceeded) return this.orchestrator.stop(runId, "BUDGET_EXHAUSTED");
    const built = await this.orchestrator.buildRevision(runId, { proposal: proposed.proposal, patchText: patched.patchText });
    if (built.state === "STOPPED") return built;
    assertNotAborted(signal);
    const evaluated = await this.orchestrator.executeAndEvaluate(runId, built.revision, built.workspace.root);
    if (evaluated.state === "FAILED") return this.orchestrator.runStore.loadRun(runId);
    await this.orchestrator.gateRevision(runId, built.revision, evaluated.evaluation, evaluated.candidate);
    return this.orchestrator.runStore.loadRun(runId);
  }

  async runUntilPause(runId, { signal } = {}) {
    while (true) {
      assertNotAborted(signal);
      const run = await this.runOneRevision(runId, { signal });
      if (["MANUAL_REVIEW", "COMPLETED", "STOPPED", "FAILED", "BASELINE_READY"].includes(run.state)) return run;
      if (!run.manifest.taskContract.automation?.autoContinue) return run;
      if (run.state === "REJECTED") {
        const failures = run.events.filter((event) => event.type === "STATE_TRANSITION" && event.payload?.to === "REJECTED")
          .map((event) => event.payload.reasonCode);
        const last = failures.at(-1);
        const repeated = failures.filter((code) => code === last).length;
        if (repeated >= run.manifest.taskContract.budgets.maxRepeatedFailureSignatures) {
          return this.orchestrator.stop(runId, "REPEATED_FAILURE_SIGNATURE");
        }
      }
    }
  }
}
