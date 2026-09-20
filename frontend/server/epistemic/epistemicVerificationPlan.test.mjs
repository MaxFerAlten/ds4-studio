import test from "node:test";
import assert from "node:assert/strict";

import {
  VERIFICATION_PLAN_STATUS,
  createVerificationPlan,
  reconcileVerificationPlan
} from "./epistemicVerificationPlan.mjs";

function plan(checks) {
  return createVerificationPlan({
    id: "plan-1",
    claimId: "claim-1",
    assumptions: [],
    checks,
    createdAt: "2026-08-29T12:00:00.000Z"
  });
}

function check(id, mandatory = true) {
  return {
    id,
    requirement: `${id}-requirement`,
    mandatory,
    method: "structured-verifier",
    expectedCertificateScope: { requiredProperties: [id] },
    successCriterion: `${id} passes`,
    failureCriterion: `${id} fails`
  };
}

test("omitted mandatory check reconciles to UNKNOWN", () => {
  const out = reconcileVerificationPlan(plan([check("a"), check("b")]), [
    { checkId: "a", status: "PASSED" }
  ]);
  assert.equal(out.status, VERIFICATION_PLAN_STATUS.UNKNOWN);
  assert.deepEqual(out.missingMandatoryCheckIds, ["b"]);
  assert.equal(out.mandatoryFailedOrMissing, 1);
  assert.deepEqual(out.failureCodes, ["F29"]);
});

test("optional omission does not prevent all mandatory checks from passing", () => {
  const out = reconcileVerificationPlan(plan([check("mandatory"), check("optional", false)]), [
    { checkId: "mandatory", status: "PASSED" }
  ]);
  assert.equal(out.status, VERIFICATION_PLAN_STATUS.PASSED);
  assert.equal(out.coverage, 1);
  assert.deepEqual(out.failureCodes, []);
});

test("no planned mandatory checks is UNKNOWN rather than vacuous PASS", () => {
  assert.equal(reconcileVerificationPlan(plan([]), []).status, VERIFICATION_PLAN_STATUS.UNKNOWN);
  assert.equal(
    reconcileVerificationPlan(plan([check("optional", false)]), []).status,
    VERIFICATION_PLAN_STATUS.UNKNOWN
  );
});

test("FAILED or ERROR mandatory result produces FAILED", () => {
  for (const status of ["FAILED", "ERROR"]) {
    const out = reconcileVerificationPlan(plan([check("a")]), [{ checkId: "a", status }]);
    assert.equal(out.status, VERIFICATION_PLAN_STATUS.FAILED, status);
    assert.deepEqual(out.failedMandatoryCheckIds, ["a"]);
  }
});

test("plan is immutable and rejects duplicate check IDs", () => {
  const created = plan([check("a")]);
  assert.equal(Object.isFrozen(created), true);
  assert.equal(Object.isFrozen(created.checks[0].expectedCertificateScope), true);
  assert.throws(() => created.checks.push(check("b")), TypeError);
  assert.throws(() => plan([check("a"), check("a")]), /check IDs must be unique/);
});
