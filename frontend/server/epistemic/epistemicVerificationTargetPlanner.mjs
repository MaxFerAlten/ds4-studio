// DS4 Quantum Fix — REM-013.3 — deterministic verification-target planner.
//
// A protected claim may be authorized only against a scope that was declared
// BEFORE verification (REM-013). The scope must be derived deterministically from
// the claim's own properties — text, class, domain, verification requirements,
// domain-invariant profile — and NEVER from a verifier result (REM-013.4), and
// NEVER from the model (REM-013.3). Where the scope cannot be derived the planner
// returns a fail-safe undeclared scope so the protected phrase cannot ASSERT.

import { CLAIM_CLASS } from "./epistemicAuthorization.mjs";

/**
 * Map a §56 claim class to its deterministic CAS/math scope kind and required
 * properties. A simple computation gets a CAS_EXPRESSION scope, NOT a named
 * theorem (REM-013.6): the target is the exact mathematical statement to check.
 */
const MATH_SCOPE_BY_CLASS = Object.freeze({
  [CLAIM_CLASS.NONTRIVIAL_ARITHMETIC]: { formalizationKind: "CAS_EXPRESSION" },
  [CLAIM_CLASS.SYMBOLIC_IDENTITY]: { formalizationKind: "CAS_EXPRESSION" },
  [CLAIM_CLASS.ODE_SOLUTION]: { formalizationKind: "CAS_EXPRESSION" }
});

const REQUIREMENT_TO_CLASS = Object.freeze({
  math_verification: CLAIM_CLASS.NONTRIVIAL_ARITHMETIC,
  symbolic_verification: CLAIM_CLASS.SYMBOLIC_IDENTITY,
  ode_residual_verification: CLAIM_CLASS.ODE_SOLUTION
});

export const PLANNER_STATUS = Object.freeze({
  DECLARED: "SCOPE_DECLARED",
  NONE_REQUIRED: "NO_SCOPE_REQUIRED",
  FAIL_SAFE: "FAIL_SAFE_UNDECLARED"
});

function isProtected(claim) {
  return (
    claim.usesProtectedLanguage === true ||
    claim.flags?.usesProtectedLanguage === true
  );
}

function declaredScope({ claim, formalizationKind, requiredProperties }) {
  return Object.freeze({
    status: PLANNER_STATUS.DECLARED,
    verificationTarget: Object.freeze({
      normalizedStatement: String(claim.normalizedText ?? claim.text ?? "").trim(),
      kind: formalizationKind
    }),
    expectedCertificateScope: Object.freeze({
      formalizationKind,
      // Mirror the verifier certificate's domain expression so the declared
      // scope and the produced certificate share one domain.
      domain: String(claim.domain ?? "MATHEMATICS"),
      requiredProperties: Object.freeze([...requiredProperties]),
      forbiddenSubstitutions: Object.freeze([
        formalizationKind === "CAS_EXPRESSION" ? "THEOREM" : "",
        "PROSE"
      ].filter(Boolean)),
      allowedFormalizationKinds: Object.freeze([formalizationKind])
    }),
    // The scope is declared by the deterministic planner, never by the model.
    derivedFrom: "deterministic-scope-planner",
    failSafe: false
  });
}

function noneRequired({ claim }) {
  return Object.freeze({
    status: PLANNER_STATUS.NONE_REQUIRED,
    verificationTarget:
      claim.verificationTarget && typeof claim.verificationTarget === "object"
        ? claim.verificationTarget
        : null,
    expectedCertificateScope:
      claim.expectedCertificateScope && typeof claim.expectedCertificateScope === "object"
        ? claim.expectedCertificateScope
        : null,
    derivedFrom: "caller",
    failSafe: false
  });
}

function failSafe({ claim }) {
  return Object.freeze({
    status: PLANNER_STATUS.FAIL_SAFE,
    // A protected claim whose scope cannot be derived must not carry any scope:
    // with no declared scope the verifier dispatcher grants no MATCH (REM-013.5).
    verificationTarget: null,
    expectedCertificateScope: null,
    derivedFrom: "deterministic-scope-planner",
    failSafe: true
  });
}

/**
 * Deterministically plan the predeclared scope for a claim.
 *
 * @param {object} options
 * @param {object} options.claim - the claim (id, text/normalizedText, domain,
 *   claimClass, verificationRequirements, usesProtectedLanguage).
 * @returns {{status, verificationTarget, expectedCertificateScope, derivedFrom, failSafe}}
 */
export function planVerificationTarget({ claim } = {}) {
  if (!claim || typeof claim !== "object") return failSafe({ claim: {} });

  const requirements = Array.isArray(claim.verificationRequirements)
    ? claim.verificationRequirements
    : [];

  // Math requirement present -> declare an exact CAS_EXPRESSION scope (REM-013.6)
  // whose required property is the requirement itself: the verifier certificate
  // establishes `[requirement]` on a PASS, so the declared scope and the produced
  // certificate agree. The target is the exact computation, not a named theorem.
  const mathRequirement = requirements.find((requirement) => REQUIREMENT_TO_CLASS[requirement]);
  if (mathRequirement) {
    const cls =
      claim.claimClass && MATH_SCOPE_BY_CLASS[claim.claimClass]
        ? claim.claimClass
        : REQUIREMENT_TO_CLASS[mathRequirement];
    const scope = MATH_SCOPE_BY_CLASS[cls] ?? MATH_SCOPE_BY_CLASS[REQUIREMENT_TO_CLASS[mathRequirement]];
    return declaredScope({
      claim,
      formalizationKind: scope.formalizationKind,
      requiredProperties: [mathRequirement]
    });
  }

  // Source/execution/benchmark requirements carry a caller-published scope or none.
  if (!isProtected(claim) && requirements.length > 0) {
    return noneRequired({ claim });
  }

  // A protected claim with no derivable computational/source scope is fail-safe:
  // it carries no scope, so it cannot assert.
  if (isProtected(claim)) return failSafe({ claim });

  return noneRequired({ claim });
}
