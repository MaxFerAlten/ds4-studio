/**
 * DS4 Quantum Fix §56 — the evidence that may authorize each claim class.
 *
 * This is policy vocabulary, not a verifier. A requirement in this matrix is
 * satisfied only by the named verifier/evidence producer; prose, confidence
 * and absence of objections never satisfy it.
 */

export const CLAIM_CLASS = Object.freeze({
  NONTRIVIAL_ARITHMETIC: "NONTRIVIAL_ARITHMETIC",
  SYMBOLIC_IDENTITY: "SYMBOLIC_IDENTITY",
  ODE_SOLUTION: "ODE_SOLUTION",
  EXACT_PAPER_METADATA: "EXACT_PAPER_METADATA",
  PAPER_SUPPORTS_CLAIM: "PAPER_SUPPORTS_CLAIM",
  WORKING_CODE: "WORKING_CODE",
  TESTS_PASSED: "TESTS_PASSED",
  BENCHMARK: "BENCHMARK",
  INTERNAL_ANALYSIS: "INTERNAL_ANALYSIS",
  OFFICIAL_MODEL_ARCHITECTURE: "OFFICIAL_MODEL_ARCHITECTURE",
  ANALOGY: "ANALOGY",
  HYPOTHESIS: "HYPOTHESIS",
  USER_CORRECTION: "USER_CORRECTION",
  REPAIRED_FACT: "REPAIRED_FACT"
});

function rule(requiredEvidence, { labelOnly = false, inheritsOriginal = false } = {}) {
  return Object.freeze({
    requiredEvidence: Object.freeze([...requiredEvidence]),
    labelOnly,
    inheritsOriginal
  });
}

export const CLAIM_AUTHORIZATION_MATRIX = Object.freeze({
  [CLAIM_CLASS.NONTRIVIAL_ARITHMETIC]: rule(["math_verification"]),
  [CLAIM_CLASS.SYMBOLIC_IDENTITY]: rule(["symbolic_verification"]),
  [CLAIM_CLASS.ODE_SOLUTION]: rule(["ode_residual_verification"]),
  [CLAIM_CLASS.EXACT_PAPER_METADATA]: rule(["source_identity"]),
  [CLAIM_CLASS.PAPER_SUPPORTS_CLAIM]: rule(["source_entailment"]),
  [CLAIM_CLASS.WORKING_CODE]: rule(["execution_evidence"]),
  [CLAIM_CLASS.TESTS_PASSED]: rule(["test_evidence"]),
  [CLAIM_CLASS.BENCHMARK]: rule(["benchmark_evidence"]),
  [CLAIM_CLASS.INTERNAL_ANALYSIS]: rule(["analysis_execution_or_source_artifact"]),
  [CLAIM_CLASS.OFFICIAL_MODEL_ARCHITECTURE]: rule(["primary_source"]),
  [CLAIM_CLASS.ANALOGY]: rule([], { labelOnly: true }),
  [CLAIM_CLASS.HYPOTHESIS]: rule([], { labelOnly: true }),
  [CLAIM_CLASS.USER_CORRECTION]: rule(["challenge_verification"]),
  [CLAIM_CLASS.REPAIRED_FACT]: rule([], { inheritsOriginal: true })
});

/** Return the evidence requirements for one §56 claim class. */
export function requirementsForClaimClass(claimClass, { originalRequirements = [] } = {}) {
  const entry = CLAIM_AUTHORIZATION_MATRIX[claimClass];
  if (!entry) return [];
  if (!entry.inheritsOriginal) return [...entry.requiredEvidence];
  return [...new Set(Array.isArray(originalRequirements) ? originalRequirements.filter(Boolean) : [])];
}

/** Union requirements while preserving matrix/class order. */
export function requirementsForClaimClasses(claimClasses, options = {}) {
  const requirements = new Set();
  for (const claimClass of Array.isArray(claimClasses) ? claimClasses : []) {
    for (const requirement of requirementsForClaimClass(claimClass, options)) {
      requirements.add(requirement);
    }
  }
  return [...requirements];
}
