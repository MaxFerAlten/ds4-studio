/** §63 — structured, server-side-only shadow trace construction. */

import { FAILURE_SEVERITY, SEVERITY } from "./epistemicContracts.mjs";
import { scanDeterministicEpistemicFailures } from "./epistemicDeterministicPolicy.mjs";

function compactClaim(claim) {
  return Object.freeze({
    id: claim?.id ?? null,
    text: String(claim?.text ?? ""),
    epistemicType: claim?.epistemicType ?? "UNKNOWN",
    status: claim?.status ?? "UNKNOWN"
  });
}

function verifierDebt(claim) {
  return Object.freeze({
    claimId: claim?.id ?? null,
    requirements: Object.freeze([
      ...new Set(
        Array.isArray(claim?.verificationRequirements)
          ? claim.verificationRequirements.filter(Boolean)
          : []
      )
    ])
  });
}

/** Build the trace §63 requires without exposing it through the user SSE. */
export function buildEpistemicShadowTrace({
  decision = {},
  extraction = {},
  claims = [],
  evidence = [],
  assistantContent = "",
  challengeTurn = false
} = {}) {
  const extractedClaims = (Array.isArray(claims) ? claims : []).filter(Boolean);
  const deterministic = scanDeterministicEpistemicFailures({
    text: assistantContent,
    evidence,
    challengeTurn
  });
  const failureCodes = new Set(deterministic.failureCodes);
  let severity = SEVERITY.NONE;

  for (const claim of extractedClaims) {
    for (const code of Array.isArray(claim.failureCodes) ? claim.failureCodes : []) {
      failureCodes.add(code);
    }
    if (Number.isInteger(claim.severity)) severity = Math.max(severity, claim.severity);
  }
  for (const code of failureCodes) {
    severity = Math.max(severity, FAILURE_SEVERITY[code] ?? SEVERITY.CRITICAL);
  }
  if (decision.wouldBlock === true && severity === SEVERITY.NONE) {
    severity = SEVERITY.HIGH;
  }

  const codes = [...failureCodes];
  return Object.freeze({
    event: "EPISTEMIC_SHADOW",
    extractionStatus: extraction?.status ?? null,
    extractionSource: extraction?.source ?? null,
    extractedClaims: Object.freeze(extractedClaims.map(compactClaim)),
    verifierRequirements: Object.freeze(extractedClaims.map(verifierDebt)),
    wouldBlock: decision.wouldBlock === true,
    failureCode: codes[0] ?? (decision.wouldBlock === true ? decision.code ?? null : null),
    failureCodes: Object.freeze(codes),
    severity
  });
}
