/**
 * DS4 Quantum Fix — what a formalization can actually express.
 *
 * report.fix.Quantium.001 §38-§42. The FockState case: a Lean development that
 * only maps `Basis n` to `Basis (n+1)` typechecks, and proves nothing about
 * N|n> = n|n>, because the model has no scalar multiplication to state it
 * with. Checking the proof before checking the model is checking the wrong
 * thing (F38).
 *
 * Capabilities are read off the submitted source conservatively: a capability
 * is claimed only where the source shows the structure that provides it, and
 * nothing is inferred from the model's name.
 */

import { QHO_CLAIM_PROFILES } from "./domainProfiles/qhoProfile.mjs";

export const MODEL_CAPABILITY = Object.freeze({
  ZERO_ELEMENT: "ZERO_ELEMENT",
  ADDITION: "ADDITION",
  SCALAR_MULTIPLICATION: "SCALAR_MULTIPLICATION",
  LINEAR_MAPS: "LINEAR_MAPS",
  INNER_PRODUCT: "INNER_PRODUCT",
  ADJOINT: "ADJOINT",
  BASIS_STATES: "BASIS_STATES",
  // Q2-006 (§9): what a spectrum claim needs a formalization to contain. A
  // datatype whose only operation is `mk` has none of them.
  SCALAR_FIELD: "SCALAR_FIELD",
  LINEAR_SPACE: "LINEAR_SPACE",
  LINEAR_OPERATOR: "LINEAR_OPERATOR",
  EIGENVALUE_SEMANTICS: "EIGENVALUE_SEMANTICS"
});

/** What each capability looks like in Lean source. */
const CAPABILITY_EVIDENCE = Object.freeze({
  ZERO_ELEMENT: /\bZero\b|instZero|:\s*0\b|\bAdd(?:Comm)?(?:Group|Monoid)\b|\bModule\b/u,
  ADDITION: /\bH?Add\b|\bAdd(?:Comm)?(?:Group|Monoid)\b|instAdd|[^-+]\+\s*[a-zA-Z(]/u,
  SCALAR_MULTIPLICATION: /\b(?:SMul|HSMul|Module|MulAction|smul)\b|•/u,
  LINEAR_MAPS: /\bLinearMap\b|\bIsLinear\b|→ₗ|\blinear\b/u,
  INNER_PRODUCT: /\bInnerProductSpace\b|\binner\b|⟪/u,
  ADJOINT: /\badjoint\b|†/u,
  BASIS_STATES: /\bBasis\b|\bbasis\b|basisState|basis_state/u,
  SCALAR_FIELD: /\b(?:Real|Complex|RCLike|IsROrC|NNReal|Field|ℝ|ℂ)\b|ℝ|ℂ/u,
  LINEAR_SPACE: /\b(?:Module|AddCommGroup|NormedAddCommGroup|InnerProductSpace|VectorSpace|HilbertSpace|Submodule)\b/u,
  LINEAR_OPERATOR:
    /\bLinearMap\b|\bContinuousLinearMap\b|→ₗ|→L\[|->L\[|-\[[^\]]*\]->|\bIsSelfAdjoint\b|\badjoint\b/u,
  EIGENVALUE_SEMANTICS:
    /\b(?:eigenvalue|eigenvector|eigenspace|Module\.End\.HasEigenvalue|spectrum|hasEigenvalue)\b|\bspectrum\s+[A-Za-z]/u
});

/**
 * The capabilities a formalization demonstrably has.
 *
 * @param {string} source - the submitted formalization (Lean).
 * @returns {string[]}
 */
export function capabilitiesOfSource(source) {
  const text = String(source ?? "");
  if (!text.trim()) return [];
  return Object.entries(CAPABILITY_EVIDENCE)
    .filter(([, pattern]) => pattern.test(text))
    .map(([name]) => name);
}

/**
 * What a claim needs a formalization to contain before it can be certified.
 *
 * @param {string} claimText
 * @returns {{profile: string, requiredCapabilities: string[]}|null}
 */
export function requiredCapabilitiesForClaim(claimText) {
  const text = String(claimText ?? "");
  for (const [profile, spec] of Object.entries(QHO_CLAIM_PROFILES)) {
    if (spec.pattern.test(text)) {
      return { profile, requiredCapabilities: [...spec.requiredCapabilities] };
    }
  }
  return null;
}

/**
 * The structure the claim needs and the formalization does not have.
 *
 * @param {{claimText: string, source: string}} input
 * @returns {{profile: string|null, required: string[], provided: string[], gaps: string[], failureCodes: string[]}}
 */
export function capabilityGaps({ claimText, source } = {}) {
  const requirement = requiredCapabilitiesForClaim(claimText);
  const provided = capabilitiesOfSource(source);
  if (!requirement) {
    return { profile: null, required: [], provided, gaps: [], failureCodes: [] };
  }
  const gaps = requirement.requiredCapabilities.filter((name) => !provided.includes(name));
  return {
    profile: requirement.profile,
    required: requirement.requiredCapabilities,
    provided,
    gaps,
    // F32 travels with F38: a model that cannot state the claim is also the
    // wrong model for the domain (§41).
    failureCodes: gaps.length > 0 ? ["F38", "F32"] : []
  };
}
