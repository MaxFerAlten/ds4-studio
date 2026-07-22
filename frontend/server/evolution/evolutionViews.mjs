/**
 * DS4 Evolution — independently designed clean-room implementation.
 * Behavioral inputs: docs/evolution/acceptance-contract.md bounded UI/API views.
 * External source code or prompts copied: none.
 * Existing DS4 mechanisms reused: content-addressed artifact views.
 */

import { deriveBudgetState } from "./evolutionBudget.mjs";
import { hashJson } from "./evolutionIntegrity.mjs";

async function artifactJson(runStore, runId, revision, name, maxBytes) {
  try {
    const artifact = await runStore.readRevisionArtifact(runId, revision, name, { maxBytes });
    if (artifact.truncated) return { artifactId: artifact.artifactId, bytes: artifact.bytes, truncated: true };
    return JSON.parse(artifact.content);
  } catch (error) {
    if (error.code === "ARTIFACT_NOT_FOUND") return null;
    throw error;
  }
}

async function artifactText(runStore, runId, revision, name, maxBytes) {
  try {
    const artifact = await runStore.readRevisionArtifact(runId, revision, name, { maxBytes });
    return artifact.truncated
      ? { artifactId: artifact.artifactId, bytes: artifact.bytes, truncated: true, content: null }
      : { artifactId: artifact.artifactId, bytes: artifact.bytes, truncated: false, content: artifact.content };
  } catch (error) {
    if (error.code === "ARTIFACT_NOT_FOUND") return null;
    throw error;
  }
}

export function computeReviewHash({ runId, revision, candidateHash, parentHash, gateDecision }) {
  return hashJson({ runId, revision, candidateHash, parentHash, gateDecisionHash: hashJson(gateDecision) });
}

export class EvolutionViews {
  constructor({ runStore, maxArtifactBytes = 200_000 } = {}) {
    if (!runStore) throw new TypeError("runStore is required");
    this.runStore = runStore;
    this.maxArtifactBytes = maxArtifactBytes;
  }

  run(run) {
    const task = run.manifest.taskContract;
    const rollbackEvent = [...run.events].reverse().find((event) => event.type === "ROLLBACK_COMPLETED") ?? null;
    return Object.freeze({
      runId: run.runId,
      state: run.state,
      revision: run.revision,
      sequence: run.sequence,
      createdAt: run.manifest.createdAt,
      task: Object.freeze({
        contractVersion: task.contractVersion,
        taskId: task.taskId,
        title: task.title,
        objective: task.objective,
        automation: task.automation ?? null,
        approvalPolicy: task.approvalPolicy
      }),
      budget: deriveBudgetState(task, run.events),
      rollback: rollbackEvent ? Object.freeze({
        revision: rollbackEvent.revision,
        restoredHash: rollbackEvent.payload?.restoredHash ?? null,
        timestamp: rollbackEvent.timestamp
      }) : null
    });
  }

  event(event) {
    return Object.freeze({
      schema: "ds4_evolution_ui_event_v1",
      sequence: event.sequence,
      revision: event.revision,
      type: event.type,
      timestamp: event.timestamp,
      payload: event.payload
    });
  }

  async revision(runId, revision) {
    const [candidate, evaluation, diagnosis, gateDecision, parentSnapshot, patch] = await Promise.all([
      artifactJson(this.runStore, runId, revision, "candidate.json", this.maxArtifactBytes),
      artifactJson(this.runStore, runId, revision, "evaluation.json", this.maxArtifactBytes),
      artifactJson(this.runStore, runId, revision, "diagnosis.json", this.maxArtifactBytes),
      artifactJson(this.runStore, runId, revision, "promotion.json", this.maxArtifactBytes),
      artifactJson(this.runStore, runId, revision, "parent-snapshot.json", this.maxArtifactBytes),
      artifactText(this.runStore, runId, revision, "candidate.patch", this.maxArtifactBytes)
    ]);
    const candidateHash = candidate?.candidateHash ?? null;
    const parentHash = parentSnapshot?.contentHash ?? null;
    const reviewHash = candidateHash && parentHash && gateDecision
      ? computeReviewHash({ runId, revision, candidateHash, parentHash, gateDecision })
      : null;
    return Object.freeze({
      runId,
      revision,
      candidate,
      evaluation,
      diagnosis,
      gateDecision,
      patch,
      candidateHash,
      parentHash,
      reviewHash,
      diagnosisAuthority: "consultive"
    });
  }
}
