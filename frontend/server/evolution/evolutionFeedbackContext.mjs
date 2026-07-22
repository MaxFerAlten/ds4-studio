/**
 * DS4 Evolution — independently designed clean-room implementation.
 * Behavioral inputs: docs/evolution/piano-post-verdetto.001.md section 6.
 * External source code or prompts copied: none.
 */

import fs from "node:fs/promises";

import { classifyFailureSignature } from "./evolutionBudget.mjs";
import { hashJson } from "./evolutionIntegrity.mjs";

const CONCLUDED_STATES = new Set(["REJECTED", "PROMOTED", "COMPLETED", "MANUAL_REVIEW"]);
const SCORED_STATES = new Set(["REJECTED", "PROMOTED", "COMPLETED"]);
const SUCCESS_STATES = new Set(["PROMOTED", "COMPLETED"]);

export class EvolutionFeedbackContextError extends Error {
  constructor(code, message, details = {}) {
    super(`${code}: ${message}`);
    this.name = "EvolutionFeedbackContextError";
    this.code = code;
    this.details = details;
  }
}

function deepFreeze(value) {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const key of Object.keys(value)) deepFreeze(value[key]);
  return Object.freeze(value);
}

function byteLength(value) {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

function lastTransitionByRevision(events) {
  const map = new Map();
  for (const event of events) {
    if (event.type !== "STATE_TRANSITION" || !(event.revision > 0)) continue;
    map.set(event.revision, event);
  }
  return map;
}

export class EvolutionFeedbackContextBuilder {
  constructor({
    runStore,
    maxHistoryEntries = 16,
    maxRejectedStrategies = 8,
    maxPromotedStrategies = 8,
    maxBytes = 64_000
  } = {}) {
    if (!runStore) throw new TypeError("runStore is required");
    this.runStore = runStore;
    this.maxHistoryEntries = maxHistoryEntries;
    this.maxRejectedStrategies = maxRejectedStrategies;
    this.maxPromotedStrategies = maxPromotedStrategies;
    this.maxBytes = maxBytes;
  }

  async _readArtifact(runId, revision, name) {
    let stored;
    try {
      stored = await this.runStore.readRevisionArtifact(runId, revision, name);
    } catch (error) {
      if (error.code === "ARTIFACT_NOT_FOUND") return null;
      throw new EvolutionFeedbackContextError("REVISION_ARTIFACT_INVALID", `${name} could not be read`, {
        revision,
        name,
        cause: error.code
      });
    }
    if (stored.truncated) {
      throw new EvolutionFeedbackContextError("REVISION_ARTIFACT_INVALID", `${name} exceeds readable bound`, {
        revision,
        name
      });
    }
    try {
      return JSON.parse(stored.content);
    } catch {
      throw new EvolutionFeedbackContextError("REVISION_ARTIFACT_INVALID", `${name} is not valid JSON`, {
        revision,
        name
      });
    }
  }

  _assertOwnership(content, revision, name) {
    if (content === null || content.revision === undefined) return content;
    if (content.revision !== revision) {
      throw new EvolutionFeedbackContextError("CROSS_RUN_ARTIFACT", `${name} revision does not match`, {
        expected: revision,
        found: content.revision
      });
    }
    return content;
  }

  async build({ runId, nextRevision, taskContract, events, budget }) {
    if (typeof runId !== "string" || runId.length === 0) {
      throw new EvolutionFeedbackContextError("INVALID_RUN_ID", "runId must be a non-empty string");
    }
    if (!Number.isSafeInteger(nextRevision) || nextRevision < 1) {
      throw new EvolutionFeedbackContextError("INVALID_NEXT_REVISION", "nextRevision must be a positive integer");
    }

    const sortedEvents = [...(events ?? [])].sort((left, right) => left.sequence - right.sequence);
    const transitions = lastTransitionByRevision(sortedEvents);
    const concludedRevisions = [...transitions.keys()]
      .filter((revision) => revision < nextRevision && CONCLUDED_STATES.has(transitions.get(revision).payload?.to))
      .sort((left, right) => left - right);

    const perRevision = new Map();
    for (const revision of concludedRevisions) {
      const transition = transitions.get(revision);
      const outcome = transition.payload.to;
      const reasonCode = transition.payload.reasonCode ?? null;
      const proposal = this._assertOwnership(
        await this._readArtifact(runId, revision, "proposal.json"),
        revision,
        "proposal.json"
      );
      const evaluation = this._assertOwnership(
        await this._readArtifact(runId, revision, "evaluation.json"),
        revision,
        "evaluation.json"
      );
      const diagnosis = this._assertOwnership(
        await this._readArtifact(runId, revision, "diagnosis.json"),
        revision,
        "diagnosis.json"
      );
      const promotion = this._assertOwnership(
        await this._readArtifact(runId, revision, "promotion.json"),
        revision,
        "promotion.json"
      );
      const candidate = await this._readArtifact(runId, revision, "candidate.json");
      perRevision.set(revision, { revision, outcome, reasonCode, proposal, evaluation, diagnosis, promotion, candidate });
    }

    const previousRevision = concludedRevisions.length ? concludedRevisions.at(-1) : null;
    const previousEntry = previousRevision !== null ? perRevision.get(previousRevision) : null;
    const previousState = previousEntry?.outcome ?? "NONE";

    const history = concludedRevisions.slice(-this.maxHistoryEntries).map((revision) => {
      const entry = perRevision.get(revision);
      return {
        revision: entry.revision,
        outcome: entry.outcome,
        reasonCode: entry.reasonCode,
        candidateHash: entry.candidate?.candidateHash ?? null,
        proposalSummary: entry.proposal?.summary ?? null,
        hypothesis: entry.proposal?.hypothesis ?? null
      };
    });

    const previousDiagnosis = previousEntry?.diagnosis ?? null;
    const previousEvaluation = previousEntry?.evaluation
      ? {
          status: previousEntry.evaluation.status,
          aggregateMetrics: previousEntry.evaluation.aggregateMetrics,
          hardFailures: previousEntry.evaluation.hardFailures
        }
      : null;

    let baselineEvaluation = null;
    try {
      const raw = await fs.readFile(this.runStore.baselinePath(runId, "evaluation.json"), "utf8");
      baselineEvaluation = JSON.parse(raw);
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw new EvolutionFeedbackContextError("REVISION_ARTIFACT_INVALID", "baseline evaluation could not be read");
      }
    }

    const scoredRevisions = concludedRevisions.filter((revision) => SCORED_STATES.has(perRevision.get(revision).outcome));

    const metricTrend = (taskContract?.metrics ?? []).map((metric) => {
      const series = scoredRevisions
        .map((revision) => perRevision.get(revision).evaluation?.aggregateMetrics?.[metric.name])
        .filter((value) => value !== undefined);
      const baseline = baselineEvaluation?.aggregateMetrics?.[metric.name] ?? null;
      const previous = previousEvaluation?.aggregateMetrics?.[metric.name] ?? null;
      let best = null;
      let deltaFromBaseline = null;
      let targetReached = false;

      if (metric.direction === "maximize" || metric.direction === "minimize") {
        const candidates = [baseline, ...series].filter((value) => typeof value === "number" && Number.isFinite(value));
        if (candidates.length) {
          best = metric.direction === "maximize" ? Math.max(...candidates) : Math.min(...candidates);
        }
        if (best !== null && typeof baseline === "number") deltaFromBaseline = best - baseline;
        if (best !== null && typeof metric.target === "number") {
          targetReached = metric.direction === "maximize" ? best >= metric.target : best <= metric.target;
        }
      } else if (metric.direction === "boolean" || metric.direction === "exact") {
        const chronological = [baseline, ...series];
        for (let index = chronological.length - 1; index >= 0; index -= 1) {
          if (chronological[index] === metric.target) {
            best = chronological[index];
            break;
          }
        }
        targetReached = best !== null;
      } else {
        throw new EvolutionFeedbackContextError("METRIC_DIRECTION_UNSUPPORTED", `unsupported metric direction: ${metric.direction}`, {
          metric: metric.name
        });
      }

      return {
        metric: metric.name,
        direction: metric.direction,
        baseline,
        previous,
        best,
        deltaFromBaseline,
        target: metric.target ?? null,
        targetReached
      };
    });

    let noImprovementStreak = 0;
    for (let index = scoredRevisions.length - 1; index >= 0; index -= 1) {
      const entry = perRevision.get(scoredRevisions[index]);
      const improved = SUCCESS_STATES.has(entry.outcome) && (entry.promotion?.improvements?.length ?? 0) > 0;
      if (improved) break;
      noImprovementStreak += 1;
    }

    const rejectedStrategies = concludedRevisions
      .filter((revision) => perRevision.get(revision).outcome === "REJECTED")
      .slice(-this.maxRejectedStrategies)
      .map((revision) => {
        const entry = perRevision.get(revision);
        return {
          revision,
          summary: entry.proposal?.summary ?? null,
          hypothesis: entry.proposal?.hypothesis ?? null,
          reasonCode: entry.reasonCode,
          failureSignature: entry.evaluation ? classifyFailureSignature(entry.evaluation) : null
        };
      });

    const promotedStrategies = concludedRevisions
      .filter((revision) => SUCCESS_STATES.has(perRevision.get(revision).outcome))
      .slice(-this.maxPromotedStrategies)
      .map((revision) => {
        const entry = perRevision.get(revision);
        return {
          revision,
          summary: entry.proposal?.summary ?? null,
          hypothesis: entry.proposal?.hypothesis ?? null,
          improvements: entry.promotion?.improvements ?? []
        };
      });

    let payload = {
      schema: "ds4_evolution_feedback_context_v1",
      runId,
      nextRevision,
      previousRevision,
      previousState,
      history,
      previousDiagnosis,
      previousEvaluation,
      metricTrend,
      rejectedStrategies,
      promotedStrategies,
      noImprovementStreak,
      budget: budget ?? null
    };

    while (byteLength(payload) > this.maxBytes) {
      if (payload.history.length > 0) {
        payload = { ...payload, history: payload.history.slice(1) };
        continue;
      }
      if (payload.rejectedStrategies.length > 0) {
        payload = { ...payload, rejectedStrategies: payload.rejectedStrategies.slice(1) };
        continue;
      }
      if (payload.promotedStrategies.length > 0) {
        payload = { ...payload, promotedStrategies: payload.promotedStrategies.slice(1) };
        continue;
      }
      throw new EvolutionFeedbackContextError("FEEDBACK_CONTEXT_TOO_LARGE", "feedback context exceeds maxBytes after full reduction", {
        maxBytes: this.maxBytes
      });
    }

    const contextHash = hashJson(payload);
    return deepFreeze({ ...payload, contextHash });
  }
}
