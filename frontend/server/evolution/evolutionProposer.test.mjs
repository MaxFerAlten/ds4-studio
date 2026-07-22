/** Test origin: DS4 acceptance requirements BEH-PROPOSER-001..003 and SEC-PROPOSER-003. */

import assert from "node:assert/strict";
import test from "node:test";

import { EvolutionProposer } from "./evolutionProposer.mjs";

const proposal = {
  proposalVersion: "ds4_evolution_proposal_v1",
  revision: 1,
  summary: "Change one file",
  hypothesis: "The change improves correctness",
  targetFiles: ["src/a.mjs"],
  targetSymbols: [],
  plannedChanges: ["replace value"],
  testsToRun: ["unit"],
  knownRisks: [],
  stopInstead: false,
  impactAnalysis: { source: "model", risk: "LOW" }
};

const taskContract = {
  objective: "Improve",
  mutablePaths: ["src"],
  immutablePaths: [],
  evaluators: [{ id: "unit" }],
  budgets: { maxFilesChanged: 1, maxProposerRepairs: 1 }
};

test("BEH-PROPOSER-001/002/003 SEC-PROPOSER-003 strips model authority and produces a schema-bound patch without tools", async () => {
  let role;
  const proposer = new EvolutionProposer({
    modelClient: {
      async completeStructured(input) {
        role = input.role;
        if (role === "proposer") return { value: await input.validator(proposal), evidence: { role } };
        const raw = {
          patchVersion: "ds4_evolution_generated_patch_v1",
          revision: 1,
          patchText: "diff --git a/src/a.mjs b/src/a.mjs\n--- a/src/a.mjs\n+++ b/src/a.mjs\n@@ -1 +1 @@\n-a\n+b\n",
          targetFiles: ["src/a.mjs"],
          proposalHash: input.userInput.proposalHash
        };
        return { value: input.validator(raw), evidence: { role } };
      }
    },
    sourceContext: { async build() { return { files: [] }; } }
  });
  const proposed = await proposer.propose({ taskContract, revision: 1 });
  assert.equal(Object.hasOwn(proposed.proposal, "impactAnalysis"), false);
  const patched = await proposer.producePatch({ taskContract, proposal: proposed.proposal, proposalHash: proposed.proposalHash });
  assert.match(patched.patchText, /^diff --git/m);
  assert.equal(role, "patcher");
});
