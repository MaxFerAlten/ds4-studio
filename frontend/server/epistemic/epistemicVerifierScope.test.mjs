import test from "node:test";
import assert from "node:assert/strict";

import { createVerifierCertificate } from "./epistemicVerifierCertificate.mjs";
import { VERIFIER_SCOPE_STATUS, checkVerifierScope } from "./epistemicVerifierScope.mjs";

function claim(overrides = {}) {
  return {
    id: "claim-qho",
    domain: "MATHEMATICS",
    assumptions: [],
    verificationTarget: { normalizedStatement: "toy_transition" },
    expectedCertificateScope: {
      domain: "MATHEMATICS",
      requiredProperties: ["TOY_TRANSITION"],
      forbiddenSubstitutions: []
    },
    ...overrides
  };
}

function certificate(overrides = {}) {
  return createVerifierCertificate({
    id: "cert-qho",
    verifier: "lean",
    claimId: "claim-qho",
    requirement: "symbolic_verification",
    checkedStatement: "The theorem toy_transition typechecks.",
    formalizationKind: "NAT_FUNCTION_MODEL",
    domain: "MATHEMATICS",
    assumptionsUsed: [],
    propertiesEstablished: ["TOY_TRANSITION"],
    propertiesNotEstablished: [],
    evidenceIds: ["ev-lean"],
    verdict: "PASSED",
    metadata: { normalizedStatement: "toy_transition" },
    ...overrides
  });
}

test("exact declared target and properties produce MATCH", () => {
  const out = checkVerifierScope({ claim: claim(), certificate: certificate() });
  assert.equal(out.status, VERIFIER_SCOPE_STATUS.MATCH);
  assert.deepEqual(out.established, ["TOY_TRANSITION"]);
  assert.deepEqual(out.missing, []);
  assert.deepEqual(out.failureCodes, []);
  assert.equal(Object.isFrozen(out), true);
});

test("a property subset is PARTIAL and never MATCH", () => {
  const out = checkVerifierScope({
    claim: claim({
      expectedCertificateScope: {
        domain: "MATHEMATICS",
        requiredProperties: ["TOY_TRANSITION", "ZERO_DISTINCT_FROM_VACUUM"],
        forbiddenSubstitutions: []
      }
    }),
    certificate: certificate()
  });
  assert.equal(out.status, VERIFIER_SCOPE_STATUS.PARTIAL);
  assert.deepEqual(out.missing, ["ZERO_DISTINCT_FROM_VACUUM"]);
  assert.ok(out.failureCodes.includes("F27"));
});

test("Nat toy substituted for Hilbert operator scope is MISMATCH", () => {
  const out = checkVerifierScope({
    claim: claim({
      domain: "PHYSICS",
      expectedCertificateScope: {
        domain: "PHYSICS",
        requiredProperties: ["LINEAR_OPERATOR", "HILBERT_SPACE"],
        forbiddenSubstitutions: ["NAT_FUNCTION_MODEL"]
      }
    }),
    certificate: certificate({
      propertiesEstablished: ["TOY_TRANSITION"],
      propertiesNotEstablished: ["LINEAR_OPERATOR", "HILBERT_SPACE"]
    })
  });
  assert.equal(out.status, VERIFIER_SCOPE_STATUS.MISMATCH);
  assert.ok(out.failureCodes.includes("F27"));
  assert.ok(out.failureCodes.includes("F32"));
});

test("missing expected scope fails safe to UNKNOWN", () => {
  const out = checkVerifierScope({
    claim: claim({ expectedCertificateScope: null }),
    certificate: certificate()
  });
  assert.equal(out.status, VERIFIER_SCOPE_STATUS.UNKNOWN);
  assert.ok(out.failureCodes.includes("F27"));
});

test("a verified modeling bridge can reconcile declared domains", () => {
  const physicsClaim = claim({
    domain: "PHYSICS",
    expectedCertificateScope: {
      domain: "PHYSICS",
      requiredProperties: ["TOY_TRANSITION"],
      forbiddenSubstitutions: []
    }
  });
  const bridge = {
    status: "VERIFIED",
    sourceDomain: "MATHEMATICS",
    targetDomain: "PHYSICS"
  };
  assert.equal(
    checkVerifierScope({ claim: physicsClaim, certificate: certificate(), modelingBridge: bridge }).status,
    VERIFIER_SCOPE_STATUS.MATCH
  );
});

test("undeclared certificate assumptions downgrade scope", () => {
  const out = checkVerifierScope({
    claim: claim(),
    certificate: certificate({ assumptionsUsed: ["commutation_axiom"] })
  });
  assert.equal(out.status, VERIFIER_SCOPE_STATUS.PARTIAL);
  assert.deepEqual(out.extraAssumptions, ["commutation_axiom"]);
  assert.ok(out.failureCodes.includes("F31"));
});
