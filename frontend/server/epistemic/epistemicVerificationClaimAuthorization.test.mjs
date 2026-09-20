import test from "node:test";
import assert from "node:assert/strict";
import {
  ASSERTION_LEVEL,
  PROTECTED_VERIFICATION_PHRASES,
  bindProtectedPhrasesToClaims,
  buildVerificationAuthorization,
  assessVerificationAuthorization
} from "./epistemicVerificationClaimAuthorization.mjs";

function claim(overrides) {
  return { id: "C1", text: "The number operator is complete and working.", status: "VERIFIED", ...overrides };
}

/** A full-pass plan summary so certificate-bound claims prove complete coverage. */
function fullPlan() {
  return { status: "PASSED", coverage: 1, mandatoryPassed: 1, mandatoryFailedOrMissing: 0 };
}

/** A passing, in-scope verifier result carrying a certificate. */
function scopedCertificate(id = "cert_1") {
  return {
    status: "PASSED",
    certificate: { id },
    scope: { status: "MATCH" }
  };
}

function certificateBoundClaim(overrides = {}) {
  return claim({
    verificationRequirements: ["math_verification"],
    verificationPlanSummary: fullPlan(),
    verifierResults: [scopedCertificate()],
    ...overrides
  });
}

test("AUTHOR-000: ASSERTION_LEVEL and protected vocabulary are frozen and non-empty", () => {
  assert.deepEqual(
    Object.keys(ASSERTION_LEVEL).sort(),
    ["ASSERT", "HYPOTHESIS", "QUALIFIED", "UNKNOWN", "WITHHOLD"]
  );
  assert.ok(PROTECTED_VERIFICATION_PHRASES.includes("verified"));
  assert.ok(PROTECTED_VERIFICATION_PHRASES.includes("formally verified"));
  assert.ok(PROTECTED_VERIFICATION_PHRASES.includes("dimostrato"));
});

test("AUTHOR-001A (REM-004.7): VERIFIED + protected wording + no certificate blocks with F18", () => {
  const out = assessVerificationAuthorization({
    assistantContent: "The number operator is verified and complete.",
    claims: [claim({ status: "VERIFIED" })]
  });
  assert.ok(out, "expected a certificate authorization failure");
  assert.equal(out.decision, "EPISTEMIC_VERIFICATION_LANGUAGE_UNAUTHORIZED");
  assert.ok(out.failureCodes.includes("F18"), `expected F18, got ${out.failureCodes}`);
  assert.deepEqual(out.blockedClaimIds, ["C1"]);
});

test("AUTHOR-001B (REM-004.7): VERIFIED + matching certificate + coverage 1 authorizes ASSERT", () => {
  const out = assessVerificationAuthorization({
    assistantContent: "The number operator is verified and complete.",
    claims: [certificateBoundClaim()]
  });
  assert.equal(out, null);

  const auths = buildVerificationAuthorization({
    assistantContent: "The number operator is verified.",
    claims: [certificateBoundClaim()]
  });
  assert.equal(auths[0].assertionLevel, ASSERTION_LEVEL.ASSERT);
  assert.deepEqual(auths[0].forbiddenPhrases, []);
  assert.deepEqual(auths[0].authorizedCertificateIds, ["cert_1"]);
});

test("AUTHOR-002: an UNKNOWN claim bound to protected wording blocks", () => {
  const out = assessVerificationAuthorization({
    assistantContent: "The number operator is verified.",
    claims: [claim({ status: "UNKNOWN" })]
  });
  assert.ok(out, "expected an authorization failure");
  assert.equal(out.decision, "EPISTEMIC_VERIFICATION_LANGUAGE_UNAUTHORIZED");
  assert.ok(out.failureCodes.includes("F18"));
  assert.deepEqual(out.blockedClaimIds, ["C1"]);
  assert.ok(out.offenders[0].forbiddenPhrases.includes("verified"));
});

test("AUTHOR-003: a protected phrase that binds to no claim is unauthorized", () => {
  const out = assessVerificationAuthorization({
    assistantContent: "All formulas are officially verified.",
    claims: [claim({ text: "something entirely unrelated about tomato crops", status: "VERIFIED" })]
  });
  assert.ok(out, "an unbound protected phrase must block");
  assert.equal(out.decision, "EPISTEMIC_VERIFICATION_LANGUAGE_UNAUTHORIZED");
  assert.ok(out.failureCodes.includes("F18"));
});

test("AUTHOR-004: open challenge debt yields WITHHOLD and is forbidden from ASSERT", () => {
  const auths = buildVerificationAuthorization({
    assistantContent: "The number operator is verified.",
    claims: [claim({ status: "PARTIAL", challengeDebtIds: ["ch1"], failureCodes: ["F39"] })]
  });
  assert.equal(auths[0].assertionLevel, ASSERTION_LEVEL.WITHHOLD);
  assert.ok(auths[0].forbiddenPhrases.includes("verified"));
});

test("AUTHOR-005: blocking failure codes downgrade a VERIFIED claim to WITHHOLD", () => {
  const auths = buildVerificationAuthorization({
    assistantContent: "The number operator is verified.",
    claims: [claim({ status: "VERIFIED", failureCodes: ["F27"] })]
  });
  assert.equal(auths[0].assertionLevel, ASSERTION_LEVEL.WITHHOLD);
});

// ---------------------------------------------------------------------------
// REM-004.10 — AUTHOR-CERT: ASSERT is certificate-bound
// ---------------------------------------------------------------------------

test("AUTHOR-CERT-001: protected VERIFIED claim without a certificate is withheld (F18)", () => {
  const auths = buildVerificationAuthorization({
    assistantContent: "The number operator is verified.",
    claims: [claim({ status: "VERIFIED" })]
  });
  assert.equal(auths[0].assertionLevel, ASSERTION_LEVEL.WITHHOLD);
  assert.ok(auths[0].failureCodes.includes("F18"));
  assert.ok(auths[0].forbiddenPhrases.includes("verified"));
});

test("AUTHOR-CERT-002: protected VERIFIED claim with a scope-MATCH certificate asserts", () => {
  const auths = buildVerificationAuthorization({
    assistantContent: "The number operator is verified.",
    claims: [certificateBoundClaim()]
  });
  assert.equal(auths[0].assertionLevel, ASSERTION_LEVEL.ASSERT);
  assert.deepEqual(auths[0].authorizedCertificateIds, ["cert_1"]);
  assert.deepEqual(auths[0].forbiddenPhrases, []);
});

test("AUTHOR-CERT-003: a PARTIAL-scope certificate withholds (F27)", () => {
  const auths = buildVerificationAuthorization({
    assistantContent: "The number operator is verified.",
    claims: [certificateBoundClaim({
      verifierResults: [{ status: "PASSED", certificate: { id: "cert_1" }, scope: { status: "PARTIAL" } }]
    })]
  });
  assert.equal(auths[0].assertionLevel, ASSERTION_LEVEL.WITHHOLD);
  assert.ok(auths[0].failureCodes.includes("F27"), `expected F27, got ${auths[0].failureCodes}`);
  assert.ok(auths[0].forbiddenPhrases.includes("verified"));
});

test("AUTHOR-CERT-004: a scope-MISMATCH certificate withholds (F27)", () => {
  const auths = buildVerificationAuthorization({
    assistantContent: "The number operator is verified.",
    claims: [certificateBoundClaim({
      verifierResults: [{ status: "PASSED", certificate: { id: "cert_9" }, scope: { status: "MISMATCH" } }]
    })]
  });
  assert.equal(auths[0].assertionLevel, ASSERTION_LEVEL.WITHHOLD);
  assert.ok(auths[0].failureCodes.includes("F27"));
});

test("AUTHOR-CERT-005: incomplete plan coverage withholds (F29)", () => {
  const auths = buildVerificationAuthorization({
    assistantContent: "The number operator is verified.",
    claims: [certificateBoundClaim({
      verificationPlanSummary: { status: "PASSED", coverage: 0.8, mandatoryPassed: 1, mandatoryFailedOrMissing: 1 }
    })]
  });
  assert.equal(auths[0].assertionLevel, ASSERTION_LEVEL.WITHHOLD);
  assert.ok(auths[0].failureCodes.includes("F29"), `expected F29, got ${auths[0].failureCodes}`);
});

test("AUTHOR-CERT-006: open challenge debt withholds even with a matching certificate (F39)", () => {
  const auths = buildVerificationAuthorization({
    assistantContent: "The number operator is verified.",
    claims: [certificateBoundClaim({ challengeDebtIds: ["ch1"] })]
  });
  assert.equal(auths[0].assertionLevel, ASSERTION_LEVEL.WITHHOLD);
  assert.ok(auths[0].failureCodes.includes("F39"));
});

test("AUTHOR-CERT-007: ordinary non-protected verified wording is unaffected", () => {
  // No protected verification phrase in the assistant content, so the claim is
  // not bound to protected vocabulary and ASSERT requires no certificate.
  const out = assessVerificationAuthorization({
    assistantContent: "The subsystem is in a stable configuration.",
    claims: [claim({ status: "VERIFIED", verifierResults: [], verificationRequirements: [] })]
  });
  assert.equal(out, null);
  const auths = buildVerificationAuthorization({
    assistantContent: "The subsystem is in a stable configuration.",
    claims: [claim({ status: "VERIFIED", verifierResults: [], verificationRequirements: [] })]
  });
  assert.equal(auths[0].assertionLevel, ASSERTION_LEVEL.ASSERT);
  assert.deepEqual(auths[0].forbiddenPhrases, []);
});

test("REM2 §11/§31: a denial of verification is not protected verification wording", () => {
  const denials = [
    "La decomposizione in sovrapposizione non e stata verificata.",
    "Il codice sull'unitarieta contiene sorry e non e verificato.",
    "This theorem was not verified.",
    "I could not verify the second paper; its identity is not certified."
  ];
  for (const sentence of denials) {
    const bindings = bindProtectedPhrasesToClaims({ assistantContent: sentence, claims: [] });
    assert.equal(
      bindings.size,
      0,
      `"${sentence}" must not bind a protected phrase: ${JSON.stringify([...bindings])}`
    );
  }
});

test("REM2 §11: an affirmation in the same answer is still protected", () => {
  const bindings = bindProtectedPhrasesToClaims({
    assistantContent: "Il primo teorema non e verificato. Il secondo teorema e verificato.",
    claims: []
  });
  assert.equal(bindings.size, 1);
  assert.deepEqual([...(bindings.get("unbound") ?? [])], ["verificato"]);
});

test("REM2 §11: a negation across a clause boundary does not neutralise the phrase", () => {
  const bindings = bindProtectedPhrasesToClaims({
    assistantContent: "Non importa quale sia il metodo, il risultato e verificato.",
    claims: []
  });
  assert.equal(bindings.size, 1);
});
