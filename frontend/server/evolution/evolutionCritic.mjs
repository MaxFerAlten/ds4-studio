/**
 * DS4 Evolution — independently designed clean-room implementation.
 * Behavioral inputs: docs/evolution/behavioral-specification.md Critic boundary.
 * External source code or prompts copied: none.
 * Existing DS4 mechanisms reused: versioned Evolution diagnosis contract.
 */

import { validateDiagnosis } from "./evolutionContracts.mjs";

export class EvolutionCritic {
  constructor({ modelClient } = {}) {
    if (!modelClient || typeof modelClient.completeStructured !== "function") throw new TypeError("modelClient is required");
    this.modelClient = modelClient;
  }

  async diagnose(packet, { signal, maxRepairs = 1 } = {}) {
    const ownership = { runId: packet.runId, revision: packet.revision };
    return this.modelClient.completeStructured({
      role: "critic",
      userInput: packet,
      signal,
      maxRepairs,
      validator: (value) => validateDiagnosis(value, ownership)
    });
  }
}
