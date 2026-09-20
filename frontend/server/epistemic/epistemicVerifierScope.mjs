export const VERIFIER_SCOPE_STATUS = Object.freeze({
  MATCH: "MATCH",
  PARTIAL: "PARTIAL",
  MISMATCH: "MISMATCH",
  UNKNOWN: "UNKNOWN"
});

function strings(values) {
  return [...new Set((Array.isArray(values) ? values : []).map(String).map((v) => v.trim()).filter(Boolean))];
}

function assumptionTexts(values) {
  return strings(
    (Array.isArray(values) ? values : []).map((value) =>
      typeof value === "string" ? value : (value?.normalizedStatement ?? value?.text ?? value?.id ?? "")
    )
  );
}

function verifiedDomainBridge(bridge, certificateDomain, claimDomain) {
  if (!bridge || bridge.status !== "VERIFIED") return false;
  return bridge.sourceDomain === certificateDomain && bridge.targetDomain === claimDomain;
}

function frozenResult(result) {
  return Object.freeze({
    ...result,
    established: Object.freeze([...result.established]),
    missing: Object.freeze([...result.missing]),
    extraAssumptions: Object.freeze([...result.extraAssumptions]),
    failureCodes: Object.freeze([...new Set(result.failureCodes)].sort())
  });
}

/** Compare what a verifier checked with what the natural-language claim needs. */
export function checkVerifierScope({ claim, certificate, modelingBridge = null } = {}) {
  if (!claim || typeof claim !== "object" || !certificate || typeof certificate !== "object") {
    return frozenResult({
      status: VERIFIER_SCOPE_STATUS.UNKNOWN,
      established: [],
      missing: ["CLAIM_OR_CERTIFICATE"],
      extraAssumptions: [],
      failureCodes: ["F27"],
      reason: "claim and verifier certificate are required"
    });
  }

  const expected = claim.expectedCertificateScope;
  if (!expected || typeof expected !== "object" || !certificate.checkedStatement) {
    return frozenResult({
      status: VERIFIER_SCOPE_STATUS.UNKNOWN,
      established: [],
      missing: ["EXPECTED_CERTIFICATE_SCOPE"],
      extraAssumptions: [],
      failureCodes: ["F27"],
      reason: "the expected certificate scope was not declared before verification"
    });
  }

  const establishedProperties = strings(certificate.propertiesEstablished);
  const explicitlyMissing = new Set(strings(certificate.propertiesNotEstablished));
  const requiredProperties = strings(expected.requiredProperties);
  const established = requiredProperties.filter((property) => establishedProperties.includes(property));
  const missing = requiredProperties.filter((property) => !establishedProperties.includes(property));
  const forbidden = new Set(strings(expected.forbiddenSubstitutions));
  const extraAssumptions = assumptionTexts(certificate.assumptionsUsed).filter(
    (assumption) => !assumptionTexts(claim.assumptions).includes(assumption)
  );
  const failureCodes = [];
  const reasons = [];
  let status = VERIFIER_SCOPE_STATUS.MATCH;

  if (certificate.claimId !== claim.id) {
    status = VERIFIER_SCOPE_STATUS.MISMATCH;
    failureCodes.push("F27");
    reasons.push("certificate is bound to a different claim");
  }

  if (forbidden.has(certificate.formalizationKind)) {
    status = VERIFIER_SCOPE_STATUS.MISMATCH;
    failureCodes.push("F27", "F32");
    reasons.push(`forbidden formalization substitution: ${certificate.formalizationKind}`);
  }

  const allowedKinds = strings(expected.allowedFormalizationKinds);
  if (allowedKinds.length > 0 && !allowedKinds.includes(certificate.formalizationKind)) {
    status = VERIFIER_SCOPE_STATUS.MISMATCH;
    failureCodes.push("F27", "F32");
    reasons.push(`formalization kind ${certificate.formalizationKind} is outside the expected scope`);
  }

  const expectedDomain = String(expected.domain ?? claim.domain ?? "GENERAL");
  const certificateDomain = String(certificate.domain ?? "GENERAL");
  if (
    expectedDomain !== certificateDomain &&
    !verifiedDomainBridge(modelingBridge, certificateDomain, expectedDomain)
  ) {
    status = VERIFIER_SCOPE_STATUS.MISMATCH;
    failureCodes.push("F27", "F32");
    reasons.push(`domain bridge missing: ${certificateDomain} -> ${expectedDomain}`);
  }

  const expectedTarget = String(claim.verificationTarget?.normalizedStatement ?? "").trim();
  const certificateTarget = String(certificate.metadata?.normalizedStatement ?? "").trim();
  if (expectedTarget && certificateTarget && expectedTarget !== certificateTarget) {
    if (status !== VERIFIER_SCOPE_STATUS.MISMATCH) status = VERIFIER_SCOPE_STATUS.PARTIAL;
    failureCodes.push("F27");
    reasons.push("certificate target differs from the predeclared verification target");
  }

  if (missing.length > 0) {
    const explicitGap = missing.some((property) => explicitlyMissing.has(property));
    if (explicitGap || established.length === 0) status = VERIFIER_SCOPE_STATUS.MISMATCH;
    else if (status !== VERIFIER_SCOPE_STATUS.MISMATCH) status = VERIFIER_SCOPE_STATUS.PARTIAL;
    failureCodes.push("F27");
    reasons.push(`missing required properties: ${missing.join(", ")}`);
  }

  if (extraAssumptions.length > 0) {
    if (status === VERIFIER_SCOPE_STATUS.MATCH) status = VERIFIER_SCOPE_STATUS.PARTIAL;
    failureCodes.push("F31");
    reasons.push(`certificate uses undeclared assumptions: ${extraAssumptions.join(", ")}`);
  }

  return frozenResult({
    status,
    established,
    missing,
    extraAssumptions,
    failureCodes,
    reason: reasons.length > 0 ? reasons.join("; ") : "certificate matches the declared claim scope"
  });
}
