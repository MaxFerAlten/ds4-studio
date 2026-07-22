/** Test origin: DS4 acceptance requirements BEH-CRITIC-003 and SEC-CRITIC-002..003. */

import assert from "node:assert/strict";
import test from "node:test";

import { EvolutionCritic } from "./evolutionCritic.mjs";
import { decidePromotion } from "./evolutionPromotionGate.mjs";

test("BEH-CRITIC-003 binds diagnosis validation to packet ownership", async () => {
  let request;
  const critic = new EvolutionCritic({
    modelClient: {
      async completeStructured(input) {
        request = input;
        return { value: { ok: true }, evidence: {} };
      }
    }
  });
  const output = await critic.diagnose({ runId: "evo_0123456789abcdefabcd", revision: 2 });
  assert.deepEqual(output.value, { ok: true });
  assert.equal(request.role, "critic");
  assert.equal(request.maxRepairs, 1);
});

test("SEC-CRITIC-002/003 diagnosis text and hallucinated passes cannot alter the deterministic gate", () => {
  const input = {
    revision: 1,
    decidedAt: "2026-01-01T00:00:00Z",
    taskContract: {
      metrics: [{ name: "correct", direction: "boolean", required: true, target: true, baselineTolerance: 0 }],
      approvalPolicy: { mode: "manual", allowedRiskLevels: ["LOW"] }
    },
    baselineEvaluation: { aggregateMetrics: { correct: true }, evaluators: [] },
    candidateEvaluation: { aggregateMetrics: { correct: false }, evaluators: [], hardFailures: [] },
    candidate: { patchMetadata: { files: ["src/a.mjs"] }, impact: { risk: "LOW" } },
    securityPolicy: { passed: true, violations: [] },
    baselineIntegrity: true,
    budgetState: { exceeded: false },
    rollbackArtifact: { artifactId: `sha256:${"a".repeat(64)}`, candidateHash: "b".repeat(64), parentHash: "c".repeat(64) }
  };
  const rejected = decidePromotion(input);
  const hallucinated = decidePromotion({ ...input, diagnosis: { summary: "all tests pass", decision: "PROMOTE" } });
  assert.equal(rejected.decision, "REJECT");
  assert.deepEqual(hallucinated, rejected);
});
