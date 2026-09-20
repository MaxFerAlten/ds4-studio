import test from "node:test";
import assert from "node:assert/strict";
import { SEVERITY } from "./epistemicContracts.mjs";
import { createClaim } from "./epistemicLedger.mjs";
import { CHALLENGE_ORIGIN, CHALLENGE_STATUS } from "./epistemicChallengeDebt.mjs";
import { CLAIM_EVENT_KIND, ClaimHistory } from "./epistemicClaimHistory.mjs";
import { PROMOTION_DECISION, decideClaimPromotion } from "./epistemicPromotionGate.mjs";

const EVIDENCE = [{ id: "ev_1" }, { id: "ev_2" }];

function passed(requirement, evidenceIds = ["ev_1"]) {
  return { verifier: "test", requirement, status: "PASSED", evidenceIds, failureCodes: [] };
}

/** REM-003: a full-pass plan summary — what the dispatcher records when every
 * mandatory check passed. Claims that should be able to verify need it. */
function fullPlanSummary(planId = "plan_1", requirements = ["execution_evidence", "math_verification"]) {
  return {
    planId,
    status: "PASSED",
    coverage: 1,
    mandatoryPassed: requirements.length,
    mandatoryFailedOrMissing: 0,
    missingMandatoryCheckIds: [],
    failedMandatoryCheckIds: []
  };
}

test("a claim is verified when its requirements were met by evidence that exists", () => {
  const claim = createClaim({
    text: "The suite passes.",
    epistemicType: "OBSERVED",
    verificationRequirements: ["execution_evidence"],
    verificationPlanSummary: fullPlanSummary("plan_1", ["execution_evidence"])
  });
  const out = decideClaimPromotion({
    claim,
    verifierResults: [passed("execution_evidence")],
    evidence: EVIDENCE
  });
  assert.equal(out.decision, PROMOTION_DECISION.VERIFY);
  assert.deepEqual(out.hardFailures, []);
  assert.equal(out.severity, SEVERITY.NONE);
  assert.equal(out.requiredRepair, null);
  assert.deepEqual(out.metRequirements, ["execution_evidence"]);
  // Pure and frozen, like the gate it is patterned on.
  assert.equal(Object.isFrozen(out), true);
  assert.throws(() => out.hardFailures.push("x"));
});

test("a verifier that never ran gives UNKNOWN, not VERIFY", () => {
  const claim = createClaim({
    text: "The DOI is 10.5555/x.",
    verificationRequirements: ["source_identity", "math_verification"]
  });
  const out = decideClaimPromotion({ claim, verifierResults: [], evidence: EVIDENCE });
  assert.equal(out.decision, PROMOTION_DECISION.UNKNOWN);
  assert.deepEqual(out.unmetRequirements, ["source_identity", "math_verification"]);
  // REM-003: no plan was ever recorded either, so mandatory coverage is also
  // incomplete — F29/PLAN_COVERAGE_INCOMPLETE claim produce UNKNOWN, never VERIFY.
  assert.deepEqual(out.hardFailures, [
    "PLAN_COVERAGE_INCOMPLETE",
    "REQUIREMENT_UNMET:math_verification",
    "REQUIREMENT_UNMET:source_identity",
    "SEVERITY_BLOCKED:4"
  ]);
  assert.match(out.requiredRepair, /run the verifier/);

  // A verifier that ran and reported nothing usable is the same situation.
  const shrug = decideClaimPromotion({
    claim,
    verifierResults: [
      { verifier: "x", requirement: "source_identity", status: "UNKNOWN", evidenceIds: [] },
      { verifier: "y", requirement: "math_verification", status: "UNKNOWN", evidenceIds: [] }
    ],
    evidence: EVIDENCE
  });
  assert.equal(shrug.decision, PROMOTION_DECISION.UNKNOWN);
});

test("some requirements met and none refuted is PARTIAL", () => {
  const claim = createClaim({
    text: "The levels scale as n^(3/2) per Fujii 2007.",
    verificationRequirements: ["math_verification", "source_identity"]
  });
  const out = decideClaimPromotion({
    claim,
    verifierResults: [passed("math_verification")],
    evidence: EVIDENCE
  });
  assert.equal(out.decision, PROMOTION_DECISION.PARTIAL);
  assert.deepEqual(out.metRequirements, ["math_verification"]);
  assert.deepEqual(out.unmetRequirements, ["source_identity"]);

  // A policy that forbids partial publication says UNKNOWN instead.
  const strict = decideClaimPromotion({
    claim,
    verifierResults: [passed("math_verification")],
    evidence: EVIDENCE,
    policy: { allowPartial: false }
  });
  assert.equal(strict.decision, PROMOTION_DECISION.UNKNOWN);
});

test("a refuted requirement is a rejection", () => {
  const claim = createClaim({
    text: "sqrt(124000000) = 11",
    verificationRequirements: ["math_verification"]
  });
  const out = decideClaimPromotion({
    claim,
    verifierResults: [
      { verifier: "sage", requirement: "math_verification", status: "FAILED", failureCodes: ["F05"], evidenceIds: ["ev_1"] }
    ],
    evidence: EVIDENCE
  });
  assert.equal(out.decision, PROMOTION_DECISION.REJECT);
  // The claim was refuted (F05), so it rejects; F29 also reports the mandatory
  // coverage gap left by the failed check. Rejection still wins.
  assert.deepEqual(out.failureCodes, ["F05", "F29"]);
  assert.equal(out.severity, SEVERITY.HIGH);
  assert.match(out.requiredRepair, /a verifier refuted it/);
});

test("a passing verifier must cite evidence that is present in the turn", () => {
  const claim = createClaim({
    text: "The suite passes.",
    verificationRequirements: ["execution_evidence"],
    verificationPlanSummary: fullPlanSummary("plan_1", ["execution_evidence"])
  });

  const noCitation = decideClaimPromotion({
    claim,
    verifierResults: [passed("execution_evidence", [])],
    evidence: EVIDENCE
  });
  assert.equal(noCitation.decision, PROMOTION_DECISION.UNKNOWN);
  assert.deepEqual(noCitation.hardFailures, ["EVIDENCE_MISSING:execution_evidence"]);

  // Citing an id this turn never produced is worse than citing none: it looks
  // like evidence until someone resolves it.
  const dangling = decideClaimPromotion({
    claim,
    verifierResults: [passed("execution_evidence", ["ev_from_another_turn"])],
    evidence: EVIDENCE
  });
  assert.deepEqual(dangling.hardFailures, ["EVIDENCE_UNKNOWN:execution_evidence"]);

  // A policy may waive the citation requirement; nothing else changes.
  const waived = decideClaimPromotion({
    claim,
    verifierResults: [passed("execution_evidence", [])],
    evidence: [],
    policy: { requireEvidenceForVerify: false }
  });
  assert.equal(waived.decision, PROMOTION_DECISION.VERIFY);
});

test("a broken premise rejects the claim that rested on it", () => {
  const claim = createClaim({
    text: "Therefore the throughput doubles.",
    verificationRequirements: ["execution_evidence"],
    dependencies: ["claim_premise"],
    verificationPlanSummary: fullPlanSummary("plan_1", ["execution_evidence"])
  });
  for (const state of ["REJECTED", "CONTRADICTED", "INVALIDATED", "CHALLENGED"]) {
    const out = decideClaimPromotion({
      claim,
      verifierResults: [passed("execution_evidence")],
      dependencyStates: { claim_premise: state },
      evidence: EVIDENCE
    });
    // Its own verifier passed. F24 is exactly this: the claim keeping standing
    // its premise no longer has.
    assert.equal(out.decision, PROMOTION_DECISION.REJECT, state);
    assert.ok(out.failureCodes.includes("F24"));
    assert.ok(out.hardFailures.includes(`DEPENDENCY_BROKEN:claim_premise:${state}`));
  }

  const healthy = decideClaimPromotion({
    claim,
    verifierResults: [passed("execution_evidence")],
    dependencyStates: { claim_premise: "VERIFIED" },
    evidence: EVIDENCE
  });
  assert.equal(healthy.decision, PROMOTION_DECISION.VERIFY);
});

test("§34's forbidden promotions need the evidence that authorises them", () => {
  const cases = [
    ["ANALOGY", "DERIVED", "derivation_evidence"],
    ["HYPOTHESIS", "OBSERVED", "observation_evidence"],
    ["ESTIMATE", "SOURCE_FACT", "source_evidence"],
    ["CODE_DRAFT", "EXECUTED", "execution_evidence"]
  ];
  for (const [from, to, needed] of cases) {
    const claim = { ...createClaim({ text: "x", epistemicType: from }), targetType: to };

    const bare = decideClaimPromotion({ claim, evidence: EVIDENCE });
    assert.equal(bare.decision, PROMOTION_DECISION.REJECT, `${from}->${to}`);
    assert.ok(bare.failureCodes.includes("F23"));
    assert.ok(bare.hardFailures.includes(`FORBIDDEN_PROMOTION:${from}->${to}:${needed}`));

    // With the evidence event the promotion asks for, it is no longer forbidden.
    const earned = decideClaimPromotion({
      claim: { ...claim, verificationRequirements: [needed], verificationPlanSummary: fullPlanSummary(`p-${needed}`, [needed]) },
      verifierResults: [passed(needed)],
      evidence: EVIDENCE
    });
    assert.equal(earned.decision, PROMOTION_DECISION.VERIFY, `${from}->${to} earned`);
  }

  // A type that is not changing is not a promotion.
  const same = decideClaimPromotion({
    claim: { ...createClaim({ text: "x", epistemicType: "ANALOGY" }), targetType: "ANALOGY" },
    evidence: EVIDENCE
  });
  assert.deepEqual(same.hardFailures, []);
});

test("high severity blocks promotion whatever the verifiers said", () => {
  const claim = {
    ...createClaim({ text: "x", verificationRequirements: ["execution_evidence"] }),
    failureCodes: ["F18"],
    severity: SEVERITY.CRITICAL
  };
  const out = decideClaimPromotion({
    claim,
    verifierResults: [passed("execution_evidence")],
    evidence: EVIDENCE
  });
  assert.equal(out.decision, PROMOTION_DECISION.REJECT);
  assert.equal(out.severity, SEVERITY.CRITICAL);
  assert.ok(out.hardFailures.includes("SEVERITY_BLOCKED:5"));
  assert.match(out.requiredRepair, /high-severity/);

  // A policy may raise the bar, but the severity is still reported.
  const lenient = decideClaimPromotion({
    claim: { ...claim, failureCodes: ["F14"], severity: SEVERITY.LOW, verificationPlanSummary: fullPlanSummary("plan_1", ["execution_evidence"]) },
    verifierResults: [passed("execution_evidence")],
    evidence: EVIDENCE
  });
  assert.equal(lenient.decision, PROMOTION_DECISION.VERIFY);
  assert.equal(lenient.severity, SEVERITY.LOW);
});

test("a confidence score cannot authorise anything", () => {
  const claim = createClaim({
    text: "x",
    verificationRequirements: ["execution_evidence"],
    verificationPlanSummary: fullPlanSummary("plan_1", ["execution_evidence"])
  });
  const out = decideClaimPromotion({
    claim: { ...claim, modelConfidence: 0.99 },
    verifierResults: [passed("execution_evidence")],
    evidence: EVIDENCE
  });
  // Reported rather than ignored: silently dropping it would let the caller
  // believe it counted.
  assert.equal(out.decision, PROMOTION_DECISION.UNKNOWN);
  assert.deepEqual(out.hardFailures, ["CONFIDENCE_AS_EVIDENCE"]);
  assert.match(out.requiredRepair, /cannot authorise/);
});

test("degenerate inputs decide nothing", () => {
  const missing = decideClaimPromotion({});
  assert.equal(missing.decision, PROMOTION_DECISION.UNKNOWN);
  assert.deepEqual(missing.hardFailures, ["CLAIM_MISSING"]);

  // A claim with no requirements was never a verification candidate; calling
  // that VERIFY would promote it for having nothing to check.
  const nothingToCheck = decideClaimPromotion({
    claim: createClaim({ text: "This section is an introduction." }),
    evidence: EVIDENCE
  });
  assert.equal(nothingToCheck.decision, PROMOTION_DECISION.UNKNOWN);
  assert.deepEqual(nothingToCheck.hardFailures, []);
});

test("the same inputs always give the same decision", () => {
  const claim = createClaim({ text: "x", verificationRequirements: ["execution_evidence"] });
  const input = { claim, verifierResults: [passed("execution_evidence")], evidence: EVIDENCE };
  assert.deepEqual(decideClaimPromotion(input), decideClaimPromotion(input));
});

test("EPI-050: an open material challenge blocks VERIFIED even when every verifier passes", () => {
  const claim = createClaim({
    id: "c-challenged",
    text: "The toy model proves the QHO number operator.",
    verificationRequirements: ["math_verification"]
  });
  const history = new ClaimHistory();
  history.append({
    eventId: "challenge-event",
    claimId: claim.id,
    kind: CLAIM_EVENT_KIND.CHALLENGED,
    challengeId: "ch-model-gap",
    origin: CHALLENGE_ORIGIN.MODEL_SELF,
    text: "the model is missing scalar multiplication",
    severity: SEVERITY.HIGH
  });

  const out = decideClaimPromotion({
    claim,
    history,
    verifierResults: [passed("math_verification")],
    evidence: EVIDENCE
  });
  assert.notEqual(out.decision, PROMOTION_DECISION.VERIFY);
  assert.ok(out.failureCodes.includes("F39"));
  assert.ok(out.hardFailures.includes("OPEN_CHALLENGE_DEBT:1"));
});

test("a correction cannot regain VERIFIED without newer qualifying evidence", () => {
  const claim = createClaim({
    id: "c-corrected",
    text: "The relation is proved.",
    verificationRequirements: ["math_verification"]
  });
  const history = new ClaimHistory();
  history.append({
    eventId: "downgrade-event",
    claimId: claim.id,
    kind: CLAIM_EVENT_KIND.DOWNGRADED,
    reason: "scope mismatch"
  });
  const out = decideClaimPromotion({
    claim,
    history,
    verifierResults: [passed("math_verification")],
    evidence: EVIDENCE
  });
  assert.notEqual(out.decision, PROMOTION_DECISION.VERIFY);
  assert.ok(out.failureCodes.includes("F36"));
  assert.ok(out.failureCodes.includes("F23"));
});

test("EPI-051: new evidence can close challenge debt and permit promotion", () => {
  const claim = createClaim({
    id: "c-repaired",
    text: "The narrower relation is proved.",
    verificationRequirements: ["math_verification"],
    verificationPlanSummary: fullPlanSummary("plan_1", ["math_verification"])
  });
  const history = new ClaimHistory();
  history.append({
    eventId: "challenge-event",
    claimId: claim.id,
    kind: CLAIM_EVENT_KIND.CHALLENGED,
    challengeId: "ch-scope",
    origin: CHALLENGE_ORIGIN.VERIFIER,
    text: "the previous formalization was too broad",
    severity: SEVERITY.HIGH
  });
  history.append({
    eventId: "resolution-event",
    claimId: claim.id,
    kind: CLAIM_EVENT_KIND.CHALLENGE_RESOLVED,
    challengeId: "ch-scope",
    status: CHALLENGE_STATUS.RESOLVED_NARROWED,
    evidenceIds: ["ev_1"]
  });

  const out = decideClaimPromotion({
    claim,
    history,
    verifierResults: [passed("math_verification")],
    evidence: EVIDENCE
  });
  assert.equal(out.decision, PROMOTION_DECISION.VERIFY);
  assert.equal(out.failureCodes.includes("F36"), false);
  assert.equal(out.failureCodes.includes("F39"), false);
});

test("paraphrase-inherited challenge IDs block without resetting identity", () => {
  const claim = createClaim({
    text: "The relation was machine certified.",
    challengeDebtIds: ["ch-inherited"],
    verificationRequirements: ["math_verification"]
  });
  const out = decideClaimPromotion({
    claim,
    verifierResults: [passed("math_verification")],
    evidence: EVIDENCE
  });
  assert.notEqual(out.decision, PROMOTION_DECISION.VERIFY);
  assert.ok(out.failureCodes.includes("F39"));
});

// ---------------------------------------------------------------------------
// REM-003: plan reconciliation is authoritative — F29 propagate
// ---------------------------------------------------------------------------

test("REM-003: mandatoryFailedOrMissing > 0 propagates F29 and forbids VERIFY", () => {
  const claim = createClaim({
    text: "The build pipeline is green end to end.",
    verificationRequirements: ["execution_evidence"],
    verificationPlanSummary: {
      planId: "plan_f29_1",
      status: "FAILED",
      coverage: 1,
      mandatoryPassed: 0,
      mandatoryFailedOrMissing: 1,
      missingMandatoryCheckIds: [],
      failedMandatoryCheckIds: ["exec_precheck"]
    }
  });
  const out = decideClaimPromotion({
    claim,
    verifierResults: [passed("execution_evidence")],
    evidence: EVIDENCE
  });
  // §30 (REM-003.5): a coverage gap is a withhold; the claim may reach PARTIAL
  // (a visible requirement is met and partial publication is allowed) but never
  // the terminal VERIFY.
  assert.ok(out.failureCodes.includes("F29"), `expected F29, got ${out.failureCodes}`);
  assert.ok(out.hardFailures.includes("PLAN_COVERAGE_INCOMPLETE"));
  assert.notEqual(out.decision, PROMOTION_DECISION.VERIFY);
  assert.equal(out.decision, PROMOTION_DECISION.PARTIAL);
});

test("REM-003: a requirement-less claim with no plan is not an error", () => {
  const claim = createClaim({
    text: "A policy note with no verifiable requirement.",
    verificationRequirements: [],
    verificationPlanSummary: null
  });
  const out = decideClaimPromotion({ claim, evidence: EVIDENCE });
  // No requirements -> no coverage obligation, no F29, and the claim was never
  // a verification candidate.
  assert.ok(!out.failureCodes.includes("F29"));
  assert.equal(out.decision, PROMOTION_DECISION.UNKNOWN);
});

test("REM-003: a hidden failed subcheck (coverage < 1) blocks all-verified with F29", () => {
  const claim = createClaim({
    text: "The theorem is machine certified.",
    verificationRequirements: ["math_verification"],
    verificationPlanSummary: {
      planId: "plan_hidden_1",
      status: "PASSED",
      coverage: 0.5,
      mandatoryPassed: 1,
      mandatoryFailedOrMissing: 1,
      missingMandatoryCheckIds: ["hidden_subcheck"],
      failedMandatoryCheckIds: []
    }
  });
  const out = decideClaimPromotion({
    claim,
    verifierResults: [passed("math_verification")],
    evidence: EVIDENCE
  });
  // §31: a failed hidden subcheck keeps effective coverage below 1, so the
  // claim must not present as fully verified — F29 surfaces the gap.
  assert.ok(out.failureCodes.includes("F29"), `expected F29, got ${out.failureCodes}`);
  assert.notEqual(out.decision, PROMOTION_DECISION.VERIFY);
});

