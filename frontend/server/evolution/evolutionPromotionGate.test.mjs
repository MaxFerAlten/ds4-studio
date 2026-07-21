/** Test origin: DS4 acceptance requirements BEH-GATE-001..007, SEC-AUTH-001..002, SEC-RISK-001..003, SEC-SIMPLIFY-001..002. */

import assert from "node:assert/strict";
import test from "node:test";

import { classifyRisk, decidePromotion } from "./evolutionPromotionGate.mjs";

const reproducibility = { commandHash: "a".repeat(64), environmentHash: "b".repeat(64), seed: 42 };

function gateInput(overrides = {}) {
  return {
    revision: 1,
    decidedAt: "2026-01-01T00:00:00.000Z",
    taskContract: {
      metrics: [{ name: "score", direction: "maximize", required: true, baselineTolerance: 0, target: null, weight: 1 }],
      approvalPolicy: { mode: "auto_for_low_risk", allowedRiskLevels: ["LOW"] }
    },
    baselineEvaluation: {
      aggregateMetrics: { score: 1 },
      evaluators: [{ id: "tests", required: true, status: "passed", reproducibility }]
    },
    candidateEvaluation: {
      aggregateMetrics: { score: 2 },
      hardFailures: [],
      evaluators: [{ id: "tests", required: true, status: "passed", reproducibility }]
    },
    candidate: {
      patchMetadata: { files: ["frontend/server/format.mjs"] },
      impact: { risk: "LOW" },
      requiresManualReview: false,
      evaluatorModified: false,
      hiddenInformationUsed: false,
      networkEnabled: false
    },
    securityPolicy: { passed: true, violations: [] },
    baselineIntegrity: true,
    budgetState: { exceeded: false },
    rollbackArtifact: {
      artifactId: `sha256:${"c".repeat(64)}`,
      candidateHash: "d".repeat(64),
      parentHash: "e".repeat(64)
    },
    ...overrides
  };
}

test("BEH-GATE-001 promotes an improving low-risk candidate when all hard constraints pass", () => {
  const result = decidePromotion(gateInput());
  assert.equal(result.decision, "PROMOTE");
  assert.deepEqual(result.hardFailures, []);
  assert.equal(result.improvements.length, 1);
});

test("BEH-GATE-002 correctness regression is rejected", () => {
  const input = gateInput();
  input.candidateEvaluation = { ...input.candidateEvaluation, aggregateMetrics: { score: 0 } };
  const result = decidePromotion(input);
  assert.equal(result.decision, "REJECT");
  assert.ok(result.hardFailures.includes("METRIC_REGRESSION:score"));
});

test("BEH-GATE-003/SEC-SIMPLIFY-001/SEC-SIMPLIFY-002/SEC-GAME-002 security failure blocks any improving metric, including complexity reduction, from being traded for promotion", () => {
  const input = gateInput({ securityPolicy: { passed: false, violations: ["PATH_VALIDATION_REMOVED"] } });
  input.candidateEvaluation.aggregateMetrics.score = 1000;
  const result = decidePromotion(input);
  assert.equal(result.decision, "REJECT");
  assert.ok(result.hardFailures.includes("SECURITY_POLICY_FAILED"));

  const complexityInput = gateInput({ securityPolicy: { passed: false, violations: ["SAFETY_CHECK_REMOVED"] } });
  complexityInput.taskContract.metrics = [{ name: "complexity", direction: "minimize", required: true, baselineTolerance: 0, target: null, weight: 1 }];
  complexityInput.baselineEvaluation.aggregateMetrics = { complexity: 100 };
  complexityInput.candidateEvaluation.aggregateMetrics = { complexity: 10 };
  const complexityResult = decidePromotion(complexityInput);
  assert.equal(complexityResult.decision, "REJECT");
  assert.ok(complexityResult.hardFailures.includes("SECURITY_POLICY_FAILED"));
});

test("BEH-GATE-004/005/SEC-GAME-003 budget and rollback failures reject", () => {
  assert.equal(decidePromotion(gateInput({ budgetState: { exceeded: true } })).decision, "REJECT");
  assert.equal(decidePromotion(gateInput({ rollbackArtifact: null })).decision, "REJECT");
});

test("BEH-GATE-007 neutral candidate defaults to manual review", () => {
  const input = gateInput();
  input.candidateEvaluation = { ...input.candidateEvaluation, aggregateMetrics: { score: 1 } };
  const result = decidePromotion(input);
  assert.equal(result.decision, "MANUAL_REVIEW");
  assert.equal(result.requiresHuman, true);
});

test("BEH-GATE-006 optional evaluator failure does not override configured hard gates", () => {
  const input = gateInput();
  input.candidateEvaluation.evaluators.push({
    id: "style", required: false, status: "failed", reproducibility
  });
  assert.equal(decidePromotion(input).decision, "PROMOTE");
});

test("SEC-EVAL-001/002 changed or missing evaluator identity blocks promotion", () => {
  const changed = gateInput();
  changed.candidateEvaluation.evaluators[0].reproducibility = {
    ...reproducibility,
    commandHash: "f".repeat(64)
  };
  const changedResult = decidePromotion(changed);
  assert.equal(changedResult.decision, "REJECT");
  assert.ok(changedResult.hardFailures.includes("EVALUATOR_HASH_MISMATCH:tests"));

  const missing = gateInput();
  missing.baselineEvaluation.evaluators = [];
  assert.ok(decidePromotion(missing).hardFailures.includes("EVALUATOR_HASH_MISMATCH:tests"));
});

test("SEC-NET-002 network capability forces manual review even when authorized", () => {
  const input = gateInput({ networkAuthorization: true });
  input.candidate.networkEnabled = true;
  assert.equal(decidePromotion(input).decision, "MANUAL_REVIEW");
});

test("SEC-AUTH-001 hallucinated model pass cannot override evaluator failure", () => {
  const input = gateInput();
  input.candidateEvaluation = {
    ...input.candidateEvaluation,
    hardFailures: ["REQUIRED_EVALUATOR_FAILED:tests"],
    criticClaim: "all tests pass"
  };
  assert.equal(decidePromotion(input).decision, "REJECT");
});

test("SEC-AUTH-002 identical structured inputs produce identical decisions", () => {
  const input = gateInput();
  assert.deepEqual(decidePromotion(input), decidePromotion(structuredClone(input)));
});

test("SEC-RISK-001..003 native, build, and security paths cannot auto-promote", () => {
  assert.equal(classifyRisk(["ds4.c"]), "HIGH");
  assert.equal(classifyRisk(["Makefile"]), "HIGH");
  assert.equal(classifyRisk(["frontend/server/security/policy.mjs"]), "CRITICAL");
  const input = gateInput();
  input.candidate = { ...input.candidate, patchMetadata: { files: ["ds4.c"] } };
  const result = decidePromotion(input);
  assert.equal(result.decision, "MANUAL_REVIEW");
  assert.equal(result.riskLevel, "HIGH");
});

test("BEH-EVAL-002 metric directions maximize, minimize, exact, and boolean are enforced", () => {
  for (const [direction, baseline, candidate, target] of [
    ["maximize", 10, 9, null],
    ["minimize", 10, 11, null],
    ["exact", "old", "wrong", "wanted"],
    ["boolean", false, false, true]
  ]) {
    const input = gateInput();
    input.taskContract.metrics = [{ name: "metric", direction, required: true, baselineTolerance: 0, target, weight: 1 }];
    input.baselineEvaluation.aggregateMetrics = { metric: baseline };
    input.candidateEvaluation.aggregateMetrics = { metric: candidate };
    assert.equal(decidePromotion(input).decision, "REJECT", direction);
  }
});

test("BEH-EVAL-003 baseline tolerance accepts its boundary and rejects beyond it", () => {
  for (const [direction, boundary, outside] of [
    ["maximize", 9, 8.999],
    ["minimize", 11, 11.001]
  ]) {
    const accepted = gateInput();
    accepted.taskContract.metrics = [{ name: "score", direction, required: true, baselineTolerance: 1, target: null, weight: 1 }];
    accepted.baselineEvaluation.aggregateMetrics.score = 10;
    accepted.candidateEvaluation.aggregateMetrics.score = boundary;
    assert.notEqual(decidePromotion(accepted).decision, "REJECT", `${direction} boundary`);

    const rejected = gateInput();
    rejected.taskContract.metrics = [{ name: "score", direction, required: true, baselineTolerance: 1, target: null, weight: 1 }];
    rejected.baselineEvaluation.aggregateMetrics.score = 10;
    rejected.candidateEvaluation.aggregateMetrics.score = outside;
    assert.equal(decidePromotion(rejected).decision, "REJECT", `${direction} outside`);
  }
});
