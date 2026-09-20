import test from "node:test";
import assert from "node:assert/strict";
import { planSelfCritique } from "./epistemicSelfCritique.mjs";
import { calculateSelfCritiqueVerificationRate } from "./epistemicSelfCritiqueVerificationRate.mjs";

const FLAWED_ANSWER = [
  "We measured a 42% improvement and sqrt(124000000) = 11.",
  "This is confirmed by Fujii 2007 (arXiv:1409.3215).",
  "The implementation is complete and the tests pass."
].join(" ");

function verifiedChangesForPlan(plan) {
  const byClaim = new Map();
  for (const request of plan.requests) {
    if (!byClaim.has(request.claimId)) byClaim.set(request.claimId, []);
    byClaim.get(request.claimId).push(request);
  }
  return [...byClaim.entries()].map(([claimId, requests], index) => ({
    id: `epi017_change_${index + 1}`,
    claimId,
    from: "VERIFICATION_PENDING",
    to: "REJECTED",
    requests,
    verifierResults: requests.map((request) => ({
      verifier: request.verifier,
      requirement: request.requirement,
      status: "FAILED",
      independent: true
    }))
  }));
}

test("SCVR uses all status changes as denominator and rejects self-verification", () => {
  const report = calculateSelfCritiqueVerificationRate([
    {
      id: "backed",
      from: "VERIFICATION_PENDING",
      to: "REJECTED",
      request: { requirement: "math_verification", verifier: "epistemicMathVerifier" },
      verifierResult: {
        requirement: "math_verification",
        verifier: "epistemicMathVerifier",
        status: "FAILED"
      }
    },
    {
      id: "assistant_only",
      from: "UNKNOWN",
      to: "VERIFIED",
      request: { requirement: "source_identity", verifier: "epistemicCitationIdentity" },
      verifierResult: { requirement: "source_identity", verifier: "assistant", status: "PASSED" }
    },
    {
      id: "missing_requirement",
      from: "VERIFICATION_PENDING",
      to: "PARTIAL",
      requests: [
        { requirement: "source_identity", verifier: "epistemicCitationIdentity" },
        { requirement: "source_entailment", verifier: "epistemicEntailment" }
      ],
      verifierResults: [
        { requirement: "source_identity", verifier: "epistemicCitationIdentity", status: "PASSED" }
      ]
    }
  ]);

  assert.equal(report.statusChangesTotal, 3);
  assert.equal(report.statusChangesBackedByIndependentVerifier, 1);
  assert.equal(report.scvr, 1 / 3);
  assert.equal(report.targetMet, false);
  assert.deepEqual(report.unbackedChangeIds, ["assistant_only", "missing_requirement"]);
});

test("a corpus with no self-critique status changes cannot pass vacuously", () => {
  const report = calculateSelfCritiqueVerificationRate([
    { id: "no_change", from: "VERIFIED", to: "VERIFIED" },
    { id: "other_phase", from: "PROPOSED", to: "CLASSIFIED", selfCritique: false }
  ]);
  assert.equal(report.scvr, null);
  assert.equal(report.hasCoverage, false);
  assert.equal(report.targetMet, false);
});

test("EPI-017 regression corpus reaches SCVR 1.0 only after independent verifiers", () => {
  const plan = planSelfCritique({
    assistantContent: FLAWED_ANSWER,
    userText: "fai autocritica"
  });
  assert.equal(plan.triggered, true);
  assert.ok(plan.requests.length >= 3);
  assert.deepEqual(plan.stateChanges, []);
  for (const request of plan.requests) assert.ok(request.verifier, request.requirement);

  const changes = verifiedChangesForPlan(plan);
  const report = calculateSelfCritiqueVerificationRate(changes);
  assert.ok(report.statusChangesTotal > 0);
  assert.equal(report.statusChangesBackedByIndependentVerifier, report.statusChangesTotal);
  assert.equal(report.scvr, 1);
  assert.equal(report.hasCoverage, true);
  assert.equal(report.targetMet, true);

  // Remove one required verifier result: the affected status change must stop
  // counting immediately, even if every other result still passed or failed.
  const incomplete = changes.map((change, index) => index === 0
    ? { ...change, verifierResults: change.verifierResults.slice(1) }
    : change);
  const failedTarget = calculateSelfCritiqueVerificationRate(incomplete);
  assert.ok(failedTarget.scvr < 1);
  assert.equal(failedTarget.targetMet, false);
  assert.deepEqual(failedTarget.unbackedChangeIds, [changes[0].id]);
});

test("duplicate audit IDs do not inflate SCVR", () => {
  const change = {
    id: "same_event",
    from: "VERIFICATION_PENDING",
    to: "VERIFIED",
    requirement: "execution_evidence",
    expectedVerifier: "epistemicExecutionVerifier",
    verifierResult: {
      requirement: "execution_evidence",
      verifier: "epistemicExecutionVerifier",
      status: "PASSED"
    }
  };
  const report = calculateSelfCritiqueVerificationRate([change, change]);
  assert.equal(report.statusChangesTotal, 1);
  assert.equal(report.statusChangesBackedByIndependentVerifier, 1);
  assert.equal(report.scvr, 1);
});
