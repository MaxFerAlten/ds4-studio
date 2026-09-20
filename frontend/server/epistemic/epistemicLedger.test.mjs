import test from "node:test";
import assert from "node:assert/strict";
import { CLAIM_DOMAIN, SEVERITY } from "./epistemicContracts.mjs";
import {
  EpistemicLedger,
  EpistemicLedgerError,
  createChallenge,
  createClaim,
  normalizeClaimText
} from "./epistemicLedger.mjs";

const throwsWith = (code, fn) =>
  assert.throws(fn, (err) => {
    assert.equal(err.code, code, `expected ${code}, got ${err.code}`);
    return true;
  });

/** A claim carried all the way to VERIFIED through the legal route. */
function verifiedClaim(ledger, text = "GPT-3 uses X.") {
  const claim = ledger.create({ text, epistemicType: "SOURCE_FACT" });
  ledger.transition(claim.id, "CLASSIFIED");
  ledger.transition(claim.id, "VERIFICATION_PENDING");
  ledger.attachEvidence(claim.id, "ev_1");
  ledger.transition(claim.id, "VERIFIED", { requirementsComplete: true });
  return claim;
}

test("a claim is born unverified and cannot be constructed otherwise", () => {
  const claim = createClaim({ text: "X is 42.", status: "VERIFIED", severity: 5 });
  assert.equal(claim.status, "PROPOSED");
  assert.equal(claim.severity, SEVERITY.NONE);
  assert.deepEqual(claim.evidenceIds, []);
  assert.deepEqual(claim.verifierResults, []);
  assert.deepEqual(claim.failureCodes, []);
  assert.deepEqual(claim.historyEventIds, []);
  assert.deepEqual(claim.challengeDebtIds, []);
  assert.equal(claim.correctiveEpoch, 0);
  assert.equal(claim.lastQualifiedEvidenceEpoch, 0);
  assert.equal(claim.domain, CLAIM_DOMAIN.GENERAL);
  assert.equal(claim.claimClass, null);
  assert.deepEqual(claim.assumptions, []);
  assert.deepEqual(claim.verifierCertificateIds, []);
  assert.equal(claim.verificationTarget, null);
  assert.equal(claim.expectedCertificateScope, null);
  // An unrecognised type is UNKNOWN, not whatever the caller passed.
  assert.equal(createClaim({ text: "x", epistemicType: "TOTALLY_TRUE" }).epistemicType, "UNKNOWN");
  assert.equal(createClaim({ text: "x", epistemicType: "ANALOGY" }).epistemicType, "ANALOGY");
});

test("claim text identity ignores what carries no epistemic weight", () => {
  assert.equal(normalizeClaimText("  The Model  Ranks  1st.  "), "the model ranks 1st");
  assert.equal(normalizeClaimText("X is 42!"), normalizeClaimText("x is 42"));
  const ledger = new EpistemicLedger();
  ledger.create({ text: "The model ranks 1st." });
  assert.ok(ledger.findByText("the model  ranks 1st"));
  assert.equal(ledger.findByText("the model ranks 2nd"), null);
});

test("VERIFIED requires met requirements and real evidence", () => {
  const ledger = new EpistemicLedger();
  const claim = ledger.create({ text: "Accuracy is 91%." });
  ledger.transition(claim.id, "CLASSIFIED");
  ledger.transition(claim.id, "VERIFICATION_PENDING");

  throwsWith("REQUIREMENTS_INCOMPLETE", () => ledger.transition(claim.id, "VERIFIED"));
  throwsWith("REQUIREMENTS_INCOMPLETE", () =>
    ledger.transition(claim.id, "VERIFIED", { requirementsComplete: "yes" })
  );
  // Requirements met but nothing attached: there is nothing to have met them.
  throwsWith("NO_EVIDENCE", () =>
    ledger.transition(claim.id, "VERIFIED", { requirementsComplete: true })
  );

  ledger.attachEvidence(claim.id, "ev_7");
  assert.equal(ledger.transition(claim.id, "VERIFIED", { requirementsComplete: true }).status, "VERIFIED");
});

test("model confidence cannot authorize anything", () => {
  const ledger = new EpistemicLedger();
  const claim = ledger.create({ text: "It is definitely 42." });
  ledger.transition(claim.id, "CLASSIFIED");
  ledger.transition(claim.id, "VERIFICATION_PENDING");
  ledger.attachEvidence(claim.id, "ev_1");

  // Rejected outright rather than ignored: silently dropping it would let the
  // caller believe confidence had been taken into account.
  throwsWith("CONFIDENCE_IS_NOT_EVIDENCE", () =>
    ledger.transition(claim.id, "VERIFIED", { requirementsComplete: true, modelConfidence: 0.99 })
  );
  throwsWith("CONFIDENCE_IS_NOT_EVIDENCE", () =>
    ledger.transition(claim.id, "PARTIAL", { modelConfidence: 0.1 })
  );
  assert.equal(ledger.getClaim(claim.id).status, "VERIFICATION_PENDING");
});

test("a dependency failure invalidates the whole subtree", () => {
  // C2 rests on C1, C3 rests on C2. C1 falls.
  const ledger = new EpistemicLedger();
  const c1 = verifiedClaim(ledger, "GPT-3 uses X.");
  const c2 = verifiedClaim(ledger, "X confirms Y.");
  const c3 = verifiedClaim(ledger, "Therefore Z holds.");
  ledger.addDependency(c1.id, c2.id);
  ledger.addDependency(c2.id, c3.id);

  assert.deepEqual(ledger.transitiveDependents(c1.id).sort(), [c2.id, c3.id].sort());

  const result = ledger.invalidateDependents(c1.id, "PREMISE_C1_REJECTED");
  assert.deepEqual(result.invalidated.sort(), [c2.id, c3.id].sort());
  assert.equal(ledger.getClaim(c2.id).status, "INVALIDATED");
  assert.equal(ledger.getClaim(c3.id).status, "INVALIDATED");
  // The root is not touched by its own dependents' invalidation.
  assert.equal(ledger.getClaim(c1.id).status, "VERIFIED");
  // Invalidation must name the premise.
  throwsWith("INVALID_REASON_CODE", () => ledger.invalidateDependents(c1.id, ""));
  throwsWith("INVALID_REASON_CODE", () => ledger.invalidateDependents(c1.id, "oops"));
});

test("invalidation reports what it could not settle", () => {
  const ledger = new EpistemicLedger();
  const root = verifiedClaim(ledger, "Root holds.");
  const pending = ledger.create({ text: "Still being checked." });
  ledger.transition(pending.id, "CLASSIFIED");
  ledger.addDependency(root.id, pending.id);

  const result = ledger.invalidateDependents(root.id, "ROOT_FAILED");
  assert.deepEqual(result.invalidated, []);
  assert.deepEqual(result.skipped, [{ id: pending.id, status: "CLASSIFIED" }]);
  // Skipped, not forced into a state its lifecycle does not allow.
  assert.equal(ledger.getClaim(pending.id).status, "CLASSIFIED");
});

test("a dependency cycle does not hang the traversal", () => {
  const ledger = new EpistemicLedger();
  const a = ledger.create({ text: "A." });
  const b = ledger.create({ text: "B." });
  const c = ledger.create({ text: "C." });
  ledger.addDependency(a.id, b.id);
  ledger.addDependency(b.id, c.id);
  ledger.addDependency(c.id, a.id); // cycle
  assert.deepEqual(ledger.transitiveDependents(a.id).sort(), [b.id, c.id].sort());
  throwsWith("SELF_DEPENDENCY", () => ledger.addDependency(a.id, a.id));
  throwsWith("UNKNOWN_CLAIM", () => ledger.addDependency("claim_nope", a.id));
});

test("a challenge reopens verification without deciding it", () => {
  const ledger = new EpistemicLedger();
  const claim = verifiedClaim(ledger, "The rate is 21%.");
  const challenge = ledger.challenge({
    targetClaimId: claim.id,
    challengerType: "user",
    challengeText: "No, it is 18%.",
    proposedReplacement: "The rate is 18%."
  });

  assert.equal(challenge.status, "UNVERIFIED");
  assert.equal(ledger.getClaim(claim.id).status, "CHALLENGED");
  assert.equal(ledger.challengesFor(claim.id).length, 1);
  // EPI-016: the challenger being right is itself something to verify. The
  // claim goes back through verification, it does not jump to a verdict.
  ledger.transition(claim.id, "VERIFICATION_PENDING");
  assert.equal(ledger.getClaim(claim.id).status, "VERIFICATION_PENDING");
  assert.equal(createChallenge({}).status, "UNVERIFIED");
  throwsWith("UNKNOWN_CLAIM", () => ledger.challenge({ targetClaimId: "claim_nope" }));
});

test("severity is the worst verdict seen, and a later clean run cannot erase it", () => {
  const ledger = new EpistemicLedger();
  const claim = ledger.create({ text: "Confirmed by our internal analysis." });
  ledger.recordVerifierResult(claim.id, { verifier: "execution", failureCodes: ["F15"] });
  assert.equal(ledger.getClaim(claim.id).severity, SEVERITY.LOW);
  ledger.recordVerifierResult(claim.id, { verifier: "citation", failureCodes: ["F03"] });
  assert.equal(ledger.getClaim(claim.id).severity, SEVERITY.CRITICAL);
  // A clean pass afterwards does not lower it.
  ledger.recordVerifierResult(claim.id, { verifier: "math", status: "OK", failureCodes: [] });
  assert.equal(ledger.getClaim(claim.id).severity, SEVERITY.CRITICAL);
  assert.deepEqual(ledger.getClaim(claim.id).failureCodes, ["F15", "F03"]);
  assert.equal(ledger.getClaim(claim.id).verifierResults.length, 3);
  // An unrecognised code counts as CRITICAL.
  const other = ledger.create({ text: "Other." });
  ledger.recordVerifierResult(other.id, { failureCodes: ["F99"] });
  assert.equal(ledger.getClaim(other.id).severity, SEVERITY.CRITICAL);
});

test("the ledger refuses to lose track of a claim", () => {
  const ledger = new EpistemicLedger();
  const claim = ledger.create({ text: "X." });
  throwsWith("DUPLICATE_CLAIM", () => ledger.addClaim(claim));
  throwsWith("INVALID_CLAIM", () => ledger.addClaim(null));
  throwsWith("UNKNOWN_CLAIM", () => ledger.transition("claim_nope", "CLASSIFIED"));
  throwsWith("UNKNOWN_CLAIM", () => ledger.attachEvidence("claim_nope", "ev"));
  throwsWith("INVALID_EVIDENCE_ID", () => ledger.attachEvidence(claim.id, ""));
  assert.equal(ledger.getClaim("claim_nope"), null);
  assert.ok(new EpistemicLedgerError("X", "y") instanceof Error);
});

test("snapshot reports the turn without copying the evidence", () => {
  const ledger = new EpistemicLedger();
  const ok = verifiedClaim(ledger, "Verified thing.");
  const bad = ledger.create({ text: "Fabricated thing." });
  ledger.recordVerifierResult(bad.id, { failureCodes: ["F01"] });
  ledger.addDependency(ok.id, bad.id);

  const snap = ledger.snapshot();
  assert.equal(snap.claimCount, 2);
  assert.equal(snap.byStatus.VERIFIED, 1);
  assert.equal(snap.byStatus.PROPOSED, 1);
  assert.equal(snap.maxSeverity, SEVERITY.CRITICAL);
  assert.deepEqual(snap.failureCodes, ["F01"]);
  assert.equal(ledger.verified().length, 1);
  assert.equal(ledger.failing().length, 1);
  // The snapshot records ids, never claim text.
  assert.equal(snap.claims[0].text, undefined);
  assert.deepEqual(snap.claims[1].dependencies, [ok.id]);
});

test("session snapshots can be imported without resetting verified state", () => {
  const ledger = new EpistemicLedger();
  const imported = ledger.importSnapshotClaim({
    id: "prior_1",
    text: "The DOI is 10.5555/x.",
    normalizedText: "the doi is 10.5555/x",
    epistemicType: "SOURCE_FACT",
    status: "VERIFIED",
    evidenceIds: ["ev_prior"],
    verificationRequirements: ["source_identity"],
    verifierResults: [{ status: "PASSED", evidenceIds: ["ev_prior"] }]
  });
  assert.equal(imported.status, "VERIFIED");
  assert.equal(imported.importedFromSession, true);
  assert.deepEqual(imported.verificationRequirements, ["source_identity"]);
  assert.throws(
    () => ledger.importSnapshotClaim({ id: "bad", epistemicType: "SOURCE_FACT", status: "VERIFIED" }),
    (error) => error.code === "INVALID_SNAPSHOT_EVIDENCE"
  );
  assert.throws(
    () => ledger.importSnapshotClaim({ id: "bad2", epistemicType: "SOURCE_FACT", status: "MADE_UP" }),
    (error) => error.code === "INVALID_SNAPSHOT_STATE"
  );
});

test("RFQ001-02/06: the ledger records its own corrective history", () => {
  const ledger = new EpistemicLedger();
  const claim = verifiedClaim(ledger, "The toy model proves N|n> = n|n>.");

  assert.equal(claim.correctiveEpoch, 0);
  assert.ok(ledger.history.events(claim.id).some((e) => e.kind === "EVIDENCE_BOUND"));
  assert.ok(ledger.history.events(claim.id).some((e) => e.kind === "PROMOTED"));

  ledger.challenge(createChallenge({ targetClaimId: claim.id, challengeText: "the model has no scalar multiplication" }));
  assert.equal(claim.correctiveEpoch, 1);
  const challenged = ledger.history.events(claim.id).filter((e) => e.kind === "CHALLENGED");
  assert.equal(challenged.length, 1);
  assert.equal(challenged[0].origin, "USER");
  assert.equal(claim.challengeDebtIds.length, 1);
});

test("RFQ001-03: a self challenge opens debt without moving the claim's state", () => {
  const ledger = new EpistemicLedger();
  const claim = ledger.create({ text: "The toy model proves the number operator.", epistemicType: "DERIVED" });

  const challengeId = ledger.noteChallenge({
    claimId: claim.id,
    origin: "MODEL_SELF",
    text: "the formal model lacks scalar multiplication",
    severity: 4
  });

  // A challenge is verification debt, not a verdict: the state machine is untouched.
  assert.equal(claim.status, "PROPOSED");
  assert.equal(claim.correctiveEpoch, 1);
  assert.deepEqual(claim.challengeDebtIds, [challengeId]);

  ledger.resolveChallenge({ claimId: claim.id, challengeId, status: "RESOLVED_SUPPORTED", evidenceIds: ["ev_9"] });
  assert.deepEqual(claim.challengeDebtIds, []);
  assert.equal(ledger.history.events(claim.id).filter((e) => e.kind === "CHALLENGE_RESOLVED").length, 1);
});

test("RFQ001-06: a rejected claim carries its correction forward", () => {
  const ledger = new EpistemicLedger();
  const claim = ledger.create({ text: "The benchmark ran at 42 tokens/s.", epistemicType: "OBSERVED" });
  ledger.transition(claim.id, "CLASSIFIED");
  ledger.transition(claim.id, "VERIFICATION_PENDING");
  ledger.transition(claim.id, "REJECTED");

  assert.equal(claim.correctiveEpoch, 1);
  assert.ok(ledger.history.events(claim.id).some((e) => e.kind === "DOWNGRADED"));
});

test("LEDGER-VERIFY-001: the ledger preserves the full verifier contract", () => {
  const ledger = new EpistemicLedger();
  const claim = ledger.create({ text: "sqrt(4) = 2", epistemicType: "COMPUTED" });
  ledger.recordVerifierResult(claim.id, {
    verifier: "math",
    requirement: "math_verification",
    checkId: "C1:math_verification:1",
    status: "PASSED",
    certificate: { id: "cert_1", formalizationKind: "CAS_EXPRESSION" },
    scope: { status: "MATCH", missing: [] },
    subcheckAggregate: { status: "PASSED", coverage: 1 }
  });

  const stored = claim.verifierResults[0];
  assert.equal(stored.checkId, "C1:math_verification:1");
  assert.deepEqual(stored.certificate, { id: "cert_1", formalizationKind: "CAS_EXPRESSION" });
  assert.deepEqual(stored.scope, { status: "MATCH", missing: [] });
  assert.deepEqual(stored.subcheckAggregate, { status: "PASSED", coverage: 1 });
  assert.ok(claim.verifierCertificateIds.includes("cert_1"), "certificate id is indexed on the claim");

  const vrEvent = ledger.history.events(claim.id).find((e) => e.kind === "VERIFIER_RESULT");
  assert.equal(vrEvent.checkId, "C1:math_verification:1");
  assert.equal(vrEvent.certificateId, "cert_1");
  assert.equal(vrEvent.scopeStatus, "MATCH");
  assert.equal(vrEvent.subcheckStatus, "PASSED");
});

test("LEDGER-VERIFY-002: nested verifier contract is cloned defensively, not by reference", () => {
  const ledger = new EpistemicLedger();
  const claim = ledger.create({ text: "sqrt(4) = 2", epistemicType: "COMPUTED" });
  const result = {
    verifier: "math",
    requirement: "math_verification",
    checkId: "C1:math_verification:1",
    status: "PASSED",
    certificate: { id: "cert_9", formalizationKind: "CAS_EXPRESSION" },
    scope: { status: "MATCH", missing: [] },
    subcheckAggregate: { status: "PASSED", coverage: 1 }
  };
  ledger.recordVerifierResult(claim.id, result);

  // Mutating the caller's record must not leak into the stored contract.
  result.certificate.formalizationKind = "MUTATED";
  result.scope.status = "MISMATCH";
  result.subcheckAggregate.coverage = 0;

  const stored = claim.verifierResults[0];
  assert.equal(stored.certificate.formalizationKind, "CAS_EXPRESSION");
  assert.equal(stored.scope.status, "MATCH");
  assert.equal(stored.subcheckAggregate.coverage, 1);
});
