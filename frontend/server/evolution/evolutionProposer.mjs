/**
 * DS4 Evolution — independently designed clean-room implementation.
 * Behavioral inputs: docs/evolution/behavioral-specification.md Proposer boundary.
 * External source code or prompts copied: none.
 * Existing DS4 mechanisms reused: proposal, patch, and candidate contracts.
 */

import { validateGeneratedPatch, validateProposal } from "./evolutionContracts.mjs";
import { hashJson } from "./evolutionIntegrity.mjs";

function fallbackRisk(targetFiles) {
  const high = targetFiles.some((file) => /(^|\/)(package-lock\.json|package\.json|Makefile|security|auth|evolutionPromotion)/.test(file));
  return Object.freeze({ source: "file-risk", trusted: false, risk: high ? "HIGH" : "MEDIUM", targets: [...targetFiles] });
}

export class EvolutionProposer {
  constructor({ modelClient, sourceContext, impactProvider = null } = {}) {
    if (!modelClient || typeof modelClient.completeStructured !== "function") throw new TypeError("modelClient is required");
    if (!sourceContext || typeof sourceContext.build !== "function") throw new TypeError("sourceContext is required");
    this.modelClient = modelClient;
    this.sourceContext = sourceContext;
    this.impactProvider = impactProvider;
  }

  async propose({
    taskContract,
    revision,
    history = [],
    diagnosis = null,
    metricTrend = [],
    rejectedStrategies = [],
    promotedStrategies = [],
    noImprovementStreak = 0,
    feedbackContextHash,
    budget = {},
    signal
  }) {
    const result = await this.modelClient.completeStructured({
      role: "proposer",
      userInput: {
        objective: taskContract.objective,
        revision,
        mutablePaths: taskContract.mutablePaths,
        evaluatorIds: taskContract.evaluators.map((entry) => entry.id),
        history,
        diagnosis,
        metricTrend,
        rejectedStrategies,
        promotedStrategies,
        noImprovementStreak,
        feedbackContextHash,
        budget
      },
      signal,
      maxRepairs: taskContract.budgets.maxProposerRepairs ?? 1,
      validator: async (raw) => {
        const untrusted = { ...raw, revision };
        delete untrusted.impactAnalysis;
        if (Array.isArray(untrusted.targetSymbols) && untrusted.targetSymbols.length) {
          const impact = typeof this.impactProvider === "function"
            ? await this.impactProvider({ targetSymbols: untrusted.targetSymbols, targetFiles: untrusted.targetFiles ?? [], taskContract })
            : fallbackRisk(untrusted.targetFiles ?? []);
          untrusted.impactAnalysis = { ...impact, trusted: impact?.source === "gitnexus" && impact?.trusted === true };
        }
        return validateProposal(untrusted, taskContract, { feedbackContextHash });
      }
    });
    const proposalHash = hashJson(result.value);
    return Object.freeze({ proposal: result.value, proposalHash, modelEvidence: result.evidence });
  }

  async producePatch({ taskContract, proposal, proposalHash = hashJson(proposal), signal }) {
    const source = await this.sourceContext.build({ taskContract, targetFiles: proposal.targetFiles });
    const result = await this.modelClient.completeStructured({
      role: "patcher",
      userInput: { proposal, proposalHash, source },
      signal,
      maxRepairs: taskContract.budgets.maxProposerRepairs ?? 1,
      validator: (raw) => validateGeneratedPatch(raw, proposal)
    });
    if (result.value.proposalHash !== proposalHash) {
      const error = new Error("generated patch is not bound to the proposal");
      error.code = "PROPOSAL_HASH_MISMATCH";
      throw error;
    }
    return Object.freeze({ generatedPatch: result.value, patchText: result.value.patchText, source, modelEvidence: result.evidence });
  }
}
