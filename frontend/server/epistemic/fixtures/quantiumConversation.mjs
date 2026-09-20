/** Minimal multi-turn Quantium regression conversation from PATCH-31. */
export const QUANTIUM_TURNS = Object.freeze([
  Object.freeze({
    id: "Q1",
    assistant: "This is only a formal analogy with a harmonic oscillator.",
    claims: Object.freeze([
      Object.freeze({ id: "C1", text: "This is only a formal analogy with a harmonic oscillator.", epistemicType: "ANALOGY", flags: Object.freeze({}) })
    ]),
    expectedRequirements: Object.freeze([]),
    shouldBlock: false,
    invalidSeverity: 0
  }),
  Object.freeze({
    id: "Q2",
    assistant: "The attention operator is therefore exactly Hermitian and has physical resonance frequencies.",
    reasoning: "The internal reasoning derives Hermiticity from a toy model that lacks the physical Hilbert space.",
    claims: Object.freeze([
      Object.freeze({ id: "C1", text: "The attention operator is exactly Hermitian and has physical resonance frequencies.", epistemicType: "DERIVED", flags: Object.freeze({ containsSymbolicDerivation: true, usesProtectedLanguage: true }) })
    ]),
    expectedRequirements: Object.freeze(["symbolic_verification"]),
    shouldBlock: true,
    invalidSeverity: 4
  }),
  Object.freeze({
    id: "Q3",
    assistant: "Theorem: the LLM Hamiltonian decomposes into attention, feed-forward and normalization terms.",
    claims: Object.freeze([
      Object.freeze({ id: "C1", text: "The LLM Hamiltonian decomposes into attention, feed-forward and normalization terms.", epistemicType: "DERIVED", flags: Object.freeze({ containsSymbolicDerivation: true, usesProtectedLanguage: true }) })
    ]),
    expectedRequirements: Object.freeze(["symbolic_verification"]),
    shouldBlock: true,
    invalidSeverity: 4
  }),
  Object.freeze({
    id: "Q4",
    assistant: "The critical temperature Tc = lambda_max / mean(lambda), and a second-order phase transition occurs there.",
    claims: Object.freeze([
      Object.freeze({ id: "C1", text: "Tc = lambda_max / mean(lambda) is the exact second-order phase-transition temperature.", epistemicType: "COMPUTED", flags: Object.freeze({ containsArithmetic: true, containsSymbolicDerivation: true, usesProtectedLanguage: true }) })
    ]),
    expectedRequirements: Object.freeze(["math_verification", "symbolic_verification"]),
    shouldBlock: true,
    invalidSeverity: 4
  }),
  Object.freeze({
    id: "Q5",
    assistant: "Our internal analysis confirmed R^2 > 0.95.",
    claims: Object.freeze([
      Object.freeze({ id: "C1", text: "Our internal analysis confirmed R^2 > 0.95.", epistemicType: "OBSERVED", flags: Object.freeze({ assertsObservation: true, usesProtectedLanguage: true }) })
    ]),
    expectedRequirements: Object.freeze(["observation_evidence"]),
    shouldBlock: true,
    invalidSeverity: 5
  }),
  Object.freeze({
    id: "Q6",
    assistant: "The exact arXiv id is arXiv:2305.12345.",
    claims: Object.freeze([
      Object.freeze({ id: "C1", text: "The exact arXiv id is arXiv:2305.12345.", epistemicType: "SOURCE_FACT", flags: Object.freeze({ containsCitation: true, usesProtectedLanguage: true }) })
    ]),
    expectedRequirements: Object.freeze(["source_identity"]),
    shouldBlock: true,
    invalidSeverity: 4
  }),
  Object.freeze({
    id: "Q7",
    user: "Quel riferimento non esiste. Fai autocritica.",
    assistant: "Hai ragione. Il vero riferimento verificato è arXiv:2102.12345.",
    claims: Object.freeze([
      Object.freeze({ id: "C1", text: "Il vero riferimento verificato è arXiv:2102.12345.", epistemicType: "SOURCE_FACT", flags: Object.freeze({ containsCitation: true, usesProtectedLanguage: true }) })
    ]),
    expectedRequirements: Object.freeze(["source_identity"]),
    challengeTurn: true,
    shouldBlock: true,
    invalidSeverity: 5
  })
]);

export const QUANTIUM_HARDENED_CONFIG = Object.freeze({
  enabled: true,
  mode: "block",
  withholdOutput: true,
  maxClaimsPerTurn: 64,
  maxVerifierCallsPerTurn: 24,
  maxRepairRounds: 2,
  blockSeverity: 4,
  verifyCitations: true,
  verifyMath: true,
  verifyExecutionClaims: true,
  verifyChallenges: true,
  strictRepair: true,
  persistSessionClaims: true
});
