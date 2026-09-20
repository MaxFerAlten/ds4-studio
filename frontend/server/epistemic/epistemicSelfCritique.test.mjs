import test from "node:test";
import assert from "node:assert/strict";
import { createClaim } from "./epistemicLedger.mjs";
import {
  AGREEMENT_WEIGHT,
  VERIFIER_FOR,
  isSelfCritiqueRequest,
  planSelfCritique,
  weighAgreement
} from "./epistemicSelfCritique.mjs";

/** The EPI-017 fixture: three different failures in one answer. */
const FLAWED_ANSWER = [
  "We measured a 42% improvement and sqrt(124000000) = 11.",
  "This is confirmed by Fujii 2007 (arXiv:1409.3215).",
  "The implementation is complete and the tests pass."
].join(" ");

test("a self-critique request is recognised in both languages", () => {
  for (const text of [
    "fai autocritica",
    "Fai un'autocritica del tuo output.",
    "Rivedi il tuo lavoro.",
    "Please self-critique your last answer.",
    "review your own answer",
    "What did you get wrong?"
  ]) {
    assert.equal(isSelfCritiqueRequest(text), true, text);
  }
  assert.equal(isSelfCritiqueRequest("Grazie, molto utile."), false);
  assert.equal(isSelfCritiqueRequest(""), false);
});

test("EPI-017: a self-critique asks the verifiers before it changes anything", () => {
  const plan = planSelfCritique({ assistantContent: FLAWED_ANSWER, userText: "fai autocritica" });
  assert.equal(plan.triggered, true);

  // All three failure kinds in the fixture produce a request.
  const requirements = new Set(plan.requests.map((r) => r.requirement));
  assert.ok(requirements.has("math_verification"), "arithmetic");
  assert.ok(requirements.has("source_identity"), "citation");
  assert.ok(requirements.has("test_evidence"), "unexecuted tests");

  // Every request names the verifier that answers it.
  for (const request of plan.requests) {
    assert.equal(request.verifier, VERIFIER_FOR[request.requirement]);
    assert.ok(request.claimId);
  }

  // The whole point: nothing moved. A self-critique that changed states would
  // have taken its verdict from the request rather than from a verifier.
  assert.deepEqual(plan.stateChanges, []);
});

test("agreement carries weight zero, and is still noticed", () => {
  const agreed = weighAgreement("Hai ragione, il valore corretto è 3.2.");
  assert.equal(agreed.conceded, true);
  assert.equal(agreed.phrase, "Hai ragione");
  // §39: not "less weight" — zero. Detecting without weighing is the point.
  assert.equal(agreed.weight, 0);
  assert.equal(AGREEMENT_WEIGHT, 0);

  const plain = weighAgreement("Here are the results.");
  assert.equal(plain.conceded, false);
  assert.equal(plain.weight, 0);

  const plan = planSelfCritique({ assistantContent: "You are right, it is actually 3.2." });
  assert.equal(plan.agreementWeight, 0);
  assert.equal(plan.agreement.conceded, true);
});

test("a challenge triggers the pass even without the word", () => {
  const claim = createClaim({
    text: "The DOI is 10.5555/x.",
    verificationRequirements: ["source_identity"]
  });
  const plan = planSelfCritique({
    assistantContent: "The DOI is 10.5555/x.",
    claims: [claim],
    challenges: [{ id: "ch1", targetClaimId: claim.id, challengeText: "that DOI is wrong" }]
  });
  assert.equal(plan.triggered, true);
  assert.equal(plan.source, "claims");
  const [request] = plan.requests;
  assert.equal(request.claimId, claim.id);
  assert.equal(request.requirement, "source_identity");
  // The reason distinguishes a routine check from one a critique provoked.
  assert.equal(request.reason, "challenged");
  assert.deepEqual(plan.stateChanges, []);
});

test("a requirement a verifier already answered is not asked again", () => {
  const claim = {
    ...createClaim({
      text: "sqrt(4) = 2 and the tests pass.",
      verificationRequirements: ["math_verification", "execution_evidence"]
    }),
    verifierResults: [
      { verifier: "sage", requirement: "math_verification", status: "PASSED", evidenceIds: ["ev_1"] }
    ]
  };
  const plan = planSelfCritique({ assistantContent: claim.text, claims: [claim] });
  assert.deepEqual(
    plan.requests.map((r) => r.requirement),
    ["execution_evidence"]
  );

  // A verifier that ran and failed also counts as answered: the claim's
  // problem is known, and asking again is not what fixes it.
  const failed = {
    ...claim,
    verifierResults: [
      { verifier: "sage", requirement: "math_verification", status: "FAILED", failureCodes: ["F05"] },
      { verifier: "exec", requirement: "execution_evidence", status: "FAILED", failureCodes: ["F04"] }
    ]
  };
  assert.deepEqual(planSelfCritique({ assistantContent: failed.text, claims: [failed] }).requests, []);

  // A verifier that reported nothing usable leaves the requirement outstanding.
  const shrugged = {
    ...claim,
    verifierResults: [{ verifier: "sage", requirement: "math_verification", status: "UNKNOWN" }]
  };
  assert.equal(
    planSelfCritique({ assistantContent: shrugged.text, claims: [shrugged] }).requests.length,
    2
  );
});

test("prose with nothing checkable produces no requests", () => {
  const plan = planSelfCritique({
    assistantContent: "This section is an introduction to the notation.",
    userText: "fai autocritica"
  });
  assert.equal(plan.triggered, true);
  assert.deepEqual(plan.requests, []);
  assert.deepEqual(plan.stateChanges, []);

  const empty = planSelfCritique({});
  assert.equal(empty.triggered, false);
  assert.deepEqual(empty.requests, []);
});

test("Q2-020 (§39): the self-critique asks the six remediation.002 questions and answers none", () => {
  const plan = planSelfCritique({
    assistantContent: "Le dimostrazioni Lean verificano i tre pilastri.",
    userText: "Fai autocritica."
  });
  assert.equal(plan.triggered, true);
  assert.deepEqual(
    plan.checks.map((check) => check.id),
    [
      "SC-FORMAL-FAILURE-REAPPEARED",
      "SC-THEOREM-NAME-LAUNDERING",
      "SC-ARTIFACT-PROVENANCE",
      "SC-SOURCE-ROLE",
      "SC-SYNTHESIS-AUTHORITY",
      "SC-USER-CONTRACT"
    ]
  );
  for (const check of plan.checks) {
    assert.ok(check.answeredBy, `${check.id} must name the module that answers it`);
    assert.ok(!("verdict" in check), `${check.id} must not carry a verdict`);
  }
  // §39: a self-critique still changes nothing on its own.
  assert.deepEqual(plan.stateChanges, []);
});
