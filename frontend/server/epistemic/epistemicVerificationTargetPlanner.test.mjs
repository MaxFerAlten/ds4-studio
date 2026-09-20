import test from "node:test";
import assert from "node:assert/strict";

import { planVerificationTarget, PLANNER_STATUS } from "./epistemicVerificationTargetPlanner.mjs";
import { CLAIM_CLASS } from "./epistemicAuthorization.mjs";
import { extractEpistemicClaims } from "./epistemicClaimExtractor.mjs";

const mathClaim = (over = {}) => ({
  id: "c1",
  text: "2^10 + 40 = 1064",
  normalizedText: "2^10 + 40 = 1064",
  domain: "GENERAL",
  claimClass: CLAIM_CLASS.NONTRIVIAL_ARITHMETIC,
  verificationRequirements: ["math_verification"],
  ...over
});

test("REM-013.6: math claim gets an exact CAS_EXPRESSION scope, not a theorem", () => {
  const plan = planVerificationTarget({ claim: mathClaim() });
  assert.equal(plan.status, PLANNER_STATUS.DECLARED);
  assert.equal(plan.expectedCertificateScope.formalizationKind, "CAS_EXPRESSION");
  assert.ok(!plan.expectedCertificateScope.formalizationKind.includes("QHO"));
  assert.deepEqual(plan.expectedCertificateScope.forbiddenSubstitutions, ["THEOREM", "PROSE"]);
  assert.deepEqual(plan.expectedCertificateScope.allowedFormalizationKinds, ["CAS_EXPRESSION"]);
  assert.equal(plan.verificationTarget.normalizedStatement, "2^10 + 40 = 1064");
  assert.equal(plan.failSafe, false);
});

test("REM-013.5: protected claim with no derivable scope is fail-safe (cannot ASSERT)", () => {
  const plan = planVerificationTarget({ claim: mathClaim({ usesProtectedLanguage: true, verificationRequirements: [] }) });
  assert.equal(plan.status, PLANNER_STATUS.FAIL_SAFE);
  assert.equal(plan.expectedCertificateScope, null);
  assert.equal(plan.verificationTarget, null);
  assert.equal(plan.failSafe, true);
});

test("REM-013.4: scope derives from claim properties, never from a verifier result", () => {
  const claim = mathClaim({ claimClass: CLAIM_CLASS.SYMBOLIC_IDENTITY, verificationRequirements: ["symbolic_verification"] });
  const plan = planVerificationTarget({ claim });
  assert.equal(plan.status, PLANNER_STATUS.DECLARED);
  assert.deepEqual(plan.expectedCertificateScope.requiredProperties, ["symbolic_verification"]);
  assert.equal(plan.derivedFrom, "deterministic-scope-planner");
});

test("REM-013.3: model-supplied scope is stripped and re-derived by the planner", async () => {
  const result = await extractEpistemicClaims({
    text: "the QHO number operator is N and N|n> = n|n>",
    client: {
      async completeRole() {
        return {
          json: {
            claims: [
              {
                id: "C1",
                text: "the QHO number operator is N and N|n> = n|n>",
                // A model attempting to self-authorize any scope must fail:
                // the supplied scope is discarded and re-derived (or fail-safe).
                expectedCertificateScope: { anything: "passes", requiredProperties: ["anything"] },
                verificationTarget: { normalizedStatement: "whatever" },
                flags: { usesProtectedLanguage: true }
              }
            ]
          }
        };
      }
    }
  });
  assert.equal(result.status, "EXTRACTION_COMPLETE");
  const claim = result.claims[0];
  assert.notDeepEqual(claim.expectedCertificateScope, { anything: "passes", requiredProperties: ["anything"] });
  assert.notEqual(claim.verificationTarget?.normalizedStatement, "whatever");
  // The claim is protected with a QHO-phrased assertion that has no CAS scope
  // derivation -> the planner leaves it fail-safe (no self-authorization).
  assert.equal(claim.expectedCertificateScope, null);
});
