import test from "node:test";
import assert from "node:assert/strict";

import {
  CLAIM_AUTHORIZATION_MATRIX,
  CLAIM_CLASS,
  requirementsForClaimClass,
  requirementsForClaimClasses
} from "./epistemicAuthorization.mjs";

test("§56 claim authorization matrix names every required evidence class", () => {
  const expected = {
    NONTRIVIAL_ARITHMETIC: ["math_verification"],
    SYMBOLIC_IDENTITY: ["symbolic_verification"],
    ODE_SOLUTION: ["ode_residual_verification"],
    EXACT_PAPER_METADATA: ["source_identity"],
    PAPER_SUPPORTS_CLAIM: ["source_entailment"],
    WORKING_CODE: ["execution_evidence"],
    TESTS_PASSED: ["test_evidence"],
    BENCHMARK: ["benchmark_evidence"],
    INTERNAL_ANALYSIS: ["analysis_execution_or_source_artifact"],
    OFFICIAL_MODEL_ARCHITECTURE: ["primary_source"],
    ANALOGY: [],
    HYPOTHESIS: [],
    USER_CORRECTION: ["challenge_verification"],
    REPAIRED_FACT: []
  };

  assert.deepEqual(Object.keys(CLAIM_AUTHORIZATION_MATRIX), Object.keys(expected));
  for (const [claimClass, evidence] of Object.entries(expected)) {
    assert.deepEqual(requirementsForClaimClass(CLAIM_CLASS[claimClass]), evidence);
  }
  assert.equal(CLAIM_AUTHORIZATION_MATRIX.ANALOGY.labelOnly, true);
  assert.equal(CLAIM_AUTHORIZATION_MATRIX.HYPOTHESIS.labelOnly, true);
});

test("a repaired fact inherits the original evidence debt", () => {
  const originalRequirements = ["source_identity", "source_entailment", "source_identity"];
  assert.deepEqual(
    requirementsForClaimClass(CLAIM_CLASS.REPAIRED_FACT, { originalRequirements }),
    ["source_identity", "source_entailment"]
  );
  assert.deepEqual(requirementsForClaimClass("NOT_A_CLASS"), []);
});

test("requirements from multiple claim classes are deterministic and deduplicated", () => {
  assert.deepEqual(
    requirementsForClaimClasses([
      CLAIM_CLASS.WORKING_CODE,
      CLAIM_CLASS.TESTS_PASSED,
      CLAIM_CLASS.WORKING_CODE
    ]),
    ["execution_evidence", "test_evidence"]
  );
});
