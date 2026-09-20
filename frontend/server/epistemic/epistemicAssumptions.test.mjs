import test from "node:test";
import assert from "node:assert/strict";

import {
  ASSUMPTION_STATUS,
  assessClaimAssumptions,
  createAssumption
} from "./epistemicAssumptions.mjs";

function assumption(id, status, overrides = {}) {
  return createAssumption({
    id,
    claimId: "claim-energy",
    text: overrides.text ?? id,
    status,
    evidenceIds: status === ASSUMPTION_STATUS.VERIFIED ? [`ev-${id}`] : [],
    verifierResultIds: status === ASSUMPTION_STATUS.VERIFIED ? [`vr-${id}`] : [],
    ...overrides
  });
}

test("all mandatory assumptions VERIFIED permit full verification", () => {
  const assumptions = [
    assumption("hbar-positive", ASSUMPTION_STATUS.VERIFIED),
    assumption("omega-positive", ASSUMPTION_STATUS.VERIFIED)
  ];
  const out = assessClaimAssumptions({
    claim: { assumptions: assumptions.map((item) => item.id) },
    assumptions
  });
  assert.equal(out.eligibleForFullVerification, true);
  assert.equal(out.maxAssertionLevel, "ASSERT");
  assert.deepEqual(out.failureCodes, []);
});

test("one UNKNOWN assumption limits the claim to conditional wording", () => {
  const assumptions = [
    assumption("hbar-positive", ASSUMPTION_STATUS.VERIFIED),
    assumption("omega-positive", ASSUMPTION_STATUS.UNKNOWN)
  ];
  const out = assessClaimAssumptions({
    claim: { assumptions: assumptions.map((item) => item.id) },
    assumptions
  });
  assert.equal(out.eligibleForFullVerification, false);
  assert.equal(out.downstreamInvalidated, false);
  assert.equal(out.maxAssertionLevel, "CONDITIONAL");
  assert.deepEqual(out.unresolvedIds, ["omega-positive"]);
  assert.deepEqual(out.failureCodes, ["F31"]);
});

test("one REJECTED assumption invalidates the downstream assertion", () => {
  const assumptions = [assumption("wrong-ladder-action", ASSUMPTION_STATUS.REJECTED)];
  const out = assessClaimAssumptions({
    claim: { assumptions: ["wrong-ladder-action"] },
    assumptions
  });
  assert.equal(out.eligibleForFullVerification, false);
  assert.equal(out.downstreamInvalidated, true);
  assert.equal(out.maxAssertionLevel, "WITHHOLD");
  assert.deepEqual(out.rejectedIds, ["wrong-ladder-action"]);
});

test("missing assumption records fail safe to UNKNOWN", () => {
  const out = assessClaimAssumptions({
    claim: { assumptions: ["missing-assumption"] },
    assumptions: []
  });
  assert.equal(out.eligibleForFullVerification, false);
  assert.deepEqual(out.unresolvedIds, ["missing-assumption"]);
});

test("VERIFIED assumption cannot be model-authored without evidence", () => {
  assert.throws(
    () =>
      createAssumption({
        claimId: "claim-energy",
        text: "omega > 0",
        status: ASSUMPTION_STATUS.VERIFIED
      }),
    /requires evidence and a verifier result/
  );
});
