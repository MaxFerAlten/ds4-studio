/**
 * Quantum harmonic oscillator profile (report.fix.Quantium.001 §43-§48).
 *
 * Two jobs, both narrow. The invariants list inferences that are refuted for
 * every QHO model; the capability table says which algebraic structure a
 * formalization must actually contain before it can certify a QHO claim.
 *
 * This is not a physics ontology. It covers the ladder algebra the DS4
 * conversations keep reaching for, and nothing else.
 */

export const QHO_PROFILE_VERSION = 1;

export const QHO_INVARIANTS = Object.freeze([
  Object.freeze({
    id: "Q1",
    // tr([A,B]) = 0 while tr(I) = d: the CCR has no finite-dimensional model.
    pattern:
      /\b(?:finite[-\s]dimensional|d\s*[x×]\s*d|n\s*[x×]\s*n|matrices)\b[^.]{0,140}\[\s*a\s*,\s*a[†\^]?\s*\]\s*=\s*(?:1|I)\b|\[\s*a\s*,\s*a[†\^]?\s*\]\s*=\s*(?:1|I)\b[^.]{0,140}\b(?:finite[-\s]dimensional|matrices)\b/iu,
    failureCodes: Object.freeze(["F21"]),
    reason:
      "tr([A,B]) = 0 for finite matrices while tr(I) = d > 0, so the canonical commutation relation has no exact finite-dimensional realisation"
  }),
  Object.freeze({
    id: "Q2",
    pattern:
      /\b(?:toy|index|discrete)\s+(?:model|formalization|formalizzazione)\b[^.]{0,140}\b(?:proves?|establishes|dimostra)\b[^.]{0,80}\b(?:number operator|QHO|harmonic oscillator|N\s*\|\s*n\s*(?:>|⟩))/iu,
    failureCodes: Object.freeze(["F32"]),
    reason:
      "a model that only relabels basis indices carries no scalar multiplication and cannot state N|n> = n|n>; it is an index transition model, not a QHO operator model"
  })
]);

/**
 * Q2-006 (§9) — the formal properties a QHO spectrum claim actually needs.
 *
 * The failing transcript published "gli autovalori dell'Hamiltoniano formano
 * uno spettro discreto e non degenere" on the authority of a theorem about a
 * datatype constructor. These are the five things such a claim asserts; a
 * certificate establishes them or it establishes something else.
 */
export const QHO_FORMAL_PROPERTY = Object.freeze({
  HAMILTONIAN_DEFINED: "HAMILTONIAN_DEFINED",
  EIGENVALUE_EQUATION: "EIGENVALUE_EQUATION",
  ENERGY_LEVEL_FORMULA: "ENERGY_LEVEL_FORMULA",
  OPERATOR_SPECTRUM_DISCRETE: "OPERATOR_SPECTRUM_DISCRETE",
  EIGENVALUES_NONDEGENERATE: "EIGENVALUES_NONDEGENERATE"
});

/**
 * What a datatype-constructor theorem establishes, at most (§9.1). Neither
 * entry appears in any QHO claim profile, which is the entire point.
 */
export const CONSTRUCTOR_INJECTIVITY_PROPERTIES = Object.freeze([
  "CONSTRUCTOR_INJECTIVE",
  "INDEX_LABEL_UNIQUE"
]);

/**
 * Positivity of E_n = hbar*omega*(n+1/2) is conditional on the constants being
 * positive; a certificate that does not carry these has not established it.
 */
export const QHO_POSITIVITY_ASSUMPTIONS = Object.freeze(["hbar > 0", "omega > 0"]);

/** Algebraic structure a claim needs before a formalization can certify it. */
export const QHO_CLAIM_PROFILES = Object.freeze({
  SPECTRUM_DISCRETE_NONDEGENERATE: Object.freeze({
    domain: "PHYSICS",
    pattern:
      /\b(?:spettro|spectrum|autovalor\w+|eigenvalues?)\b[^.]{0,120}\b(?:discret\w+|non[-\s]degener\w+|nondegener\w+)\b|\b(?:discret\w+|non[-\s]degener\w+|nondegener\w+)\b[^.]{0,120}\b(?:spettro|spectrum|autovalor\w+|eigenvalues?|hamiltonian\w*|hamiltonian\w*)\b/iu,
    requiredFormalProperties: Object.freeze([
      QHO_FORMAL_PROPERTY.HAMILTONIAN_DEFINED,
      QHO_FORMAL_PROPERTY.EIGENVALUE_EQUATION,
      QHO_FORMAL_PROPERTY.ENERGY_LEVEL_FORMULA,
      QHO_FORMAL_PROPERTY.OPERATOR_SPECTRUM_DISCRETE,
      QHO_FORMAL_PROPERTY.EIGENVALUES_NONDEGENERATE
    ]),
    requiredCapabilities: Object.freeze([
      "SCALAR_FIELD",
      "LINEAR_SPACE",
      "LINEAR_OPERATOR",
      "EIGENVALUE_SEMANTICS"
    ])
  }),
  NUMBER_OPERATOR_EIGENSTATE: Object.freeze({
    pattern: /\bN\s*\|\s*n\s*(?:>|⟩)\s*=\s*n\s*\|\s*n\s*(?:>|⟩)|\bnumber operator\b[^.]{0,60}\beigen\w+/iu,
    requiredCapabilities: Object.freeze([
      "ZERO_ELEMENT",
      "ADDITION",
      "SCALAR_MULTIPLICATION",
      "LINEAR_MAPS",
      "BASIS_STATES"
    ])
  }),
  LADDER_OPERATOR: Object.freeze({
    pattern: /\bladder operator|\ba[†^]\s*\|\s*n\s*(?:>|⟩)|\bcreation and annihilation\b/iu,
    requiredCapabilities: Object.freeze(["SCALAR_MULTIPLICATION", "LINEAR_MAPS", "BASIS_STATES"])
  }),
  ADJOINT_RELATION: Object.freeze({
    pattern: /\ba[†^]\b[^.]{0,60}\badjoint\b|\badjoint of\b[^.]{0,40}\bannihilation\b/iu,
    requiredCapabilities: Object.freeze(["INNER_PRODUCT", "LINEAR_MAPS", "ADJOINT"])
  })
});
