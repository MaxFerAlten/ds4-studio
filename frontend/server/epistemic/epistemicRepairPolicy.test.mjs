import test from "node:test";
import assert from "node:assert/strict";
import { SEVERITY } from "./epistemicContracts.mjs";
import {
  REPAIR_STATUS,
  REPAIR_TRIGGER_CODES,
  buildRepairGuidance,
  buildVerificationRepairGuidance,
  decideEpistemicRepair,
  dependentClaimIds,
  buildRepairDebt,
  codeSpecificGuidance,
  repairIdentityForClaim,
  repairTriggers
} from "./epistemicRepairPolicy.mjs";

test("strict repair guidance names verifier debt without inventing replacements", () => {
  const blocked = claim("c1", {
    status: "CONTRADICTED",
    failureCodes: ["F17"],
    verifierResults: [
      { requirement: "source_identity", status: "FAILED", reasonCode: "MISMATCH" }
    ]
  });
  const guidance = buildVerificationRepairGuidance({
    blockedClaims: [blocked],
    promotions: [
      {
        claimId: "c1",
        finalState: "CONTRADICTED",
        promotion: {
          unmetRequirements: ["source_identity", "source_entailment"],
          requiredRepair: "correct the claim; a verifier refuted it"
        }
      }
    ],
    repairRound: 1,
    maxRepairRounds: 2
  });
  assert.match(guidance, /CLAIM_ID c1/);
  assert.match(guidance, /source_identity:MISMATCH/);
  assert.match(guidance, /source_entailment/);
  assert.match(guidance, /F17/);
  assert.match(guidance, /Do not invent replacement DOI\/arXiv identifiers/);
});

function claim(id, overrides = {}) {
  return {
    id,
    text: `claim ${id}`,
    status: "VERIFICATION_PENDING",
    failureCodes: [],
    evidenceIds: [],
    dependencies: [],
    severity: SEVERITY.NONE,
    ...overrides
  };
}

test("every failure class §38 lists opens a repair", () => {
  for (const code of REPAIR_TRIGGER_CODES) {
    const triggers = repairTriggers([claim("c1", { failureCodes: [code] })]);
    assert.equal(triggers.length, 1, code);
  }
  // S4 and S5 open one on their own, with no trigger code attached.
  assert.equal(repairTriggers([claim("c1", { severity: SEVERITY.HIGH })]).length, 1);
  assert.equal(repairTriggers([claim("c1", { severity: SEVERITY.CRITICAL })]).length, 1);
  // S3 and below do not.
  assert.equal(repairTriggers([claim("c1", { severity: SEVERITY.MEDIUM })]).length, 0);
  assert.equal(repairTriggers([claim("c1", { failureCodes: ["F14"] })]).length, 0);
  // A claim already rejected is already withdrawn.
  assert.equal(repairTriggers([claim("c1", { failureCodes: ["F01"], status: "REJECTED" })]).length, 0);
});

test("a clean candidate needs no repair", () => {
  const out = decideEpistemicRepair({ claims: [claim("c1"), claim("c2")] });
  assert.equal(out.status, REPAIR_STATUS.NOT_REQUIRED);
  assert.equal(out.repairId, null);
  assert.equal(out.guidance, "");
  assert.equal(out.round, 0);
});

test("a triggering claim opens a round and names what to withdraw", () => {
  const claims = [
    claim("c1", { failureCodes: ["F17"], evidenceIds: ["ev_1"] }),
    claim("c2", { dependencies: ["c1"] }),
    claim("c3", { dependencies: ["c2"] }),
    claim("c4")
  ];
  const out = decideEpistemicRepair({ claims });
  assert.equal(out.status, REPAIR_STATUS.REQUIRED);
  assert.equal(out.round, 1);
  assert.equal(out.maxRounds, 2);
  assert.equal(out.rootFailureClaimId, "c1");
  assert.deepEqual(out.rootClaimIds, ["c1"]);
  // Everything resting on the withdrawn claim goes with it, transitively.
  assert.deepEqual(out.invalidatedClaimIds.sort(), ["c2", "c3"]);
  assert.deepEqual(out.evidenceIds, ["ev_1"]);
  assert.deepEqual(out.failureCodes, ["F17"]);
  assert.ok(out.repairId.startsWith("repair_"));
  assert.equal(Object.isFrozen(out), true);
});

test("the root is the worst failure, chosen the same way every time", () => {
  const claims = [
    claim("c9", { failureCodes: ["F17"] }),
    claim("c1", { failureCodes: ["F18"] }),
    claim("c5", { failureCodes: ["F18"] })
  ];
  const out = decideEpistemicRepair({ claims });
  // F18 is CRITICAL and F17 is HIGH; between the two criticals, id order.
  assert.equal(out.rootFailureClaimId, "c1");
  assert.deepEqual(out.rootClaimIds, ["c1", "c5", "c9"]);
  assert.deepEqual(decideEpistemicRepair({ claims }).rootClaimIds, out.rootClaimIds);
});

test("the guidance withdraws claims by id and names the evidence each owes", () => {
  const guidance = buildRepairGuidance({ rootClaimIds: ["c1"], invalidatedClaimIds: ["c2", "c3"] });
  assert.match(guidance, /^EPISTEMIC_REPAIR_REQUIRED/);
  assert.match(guidance, /Do not defend or restate them/);
  // Ids, not descriptions: a claim named by id cannot be satisfied by rewording.
  assert.match(guidance, /Withdraw root claims:\nc1/);
  assert.match(guidance, /Claims invalidated by dependency:\nc2, c3/);
  assert.match(guidance, /external facts require source evidence/);
  assert.match(guidance, /bibliography requires resolver identity/);
  assert.match(guidance, /computations require Sage\/tool evidence/);
  assert.match(guidance, /code execution requires execution trace/);
  // F16 in one line: a replacement invented from memory is the failure repeating.
  assert.match(guidance, /Do not introduce new exact DOI\/arXiv\/numeric results from memory/);
  assert.match(guidance, /preserves UNKNOWN where evidence is missing/);
  assert.match(buildRepairGuidance({}), /\(none\)/);
});

test("rounds are bounded and the failure is reported rather than retried", () => {
  const claims = [claim("c1", { failureCodes: ["F01"] })];
  const first = decideEpistemicRepair({ claims });
  assert.equal(first.round, 1);
  assert.equal(first.status, REPAIR_STATUS.REQUIRED);

  const second = decideEpistemicRepair({ claims, previous: first });
  assert.equal(second.round, 2);
  assert.equal(second.status, REPAIR_STATUS.REQUIRED);
  // The repair keeps its identity across rounds.
  assert.equal(second.repairId, first.repairId);

  const third = decideEpistemicRepair({ claims, previous: second });
  assert.equal(third.status, REPAIR_STATUS.EXHAUSTED);
  assert.equal(third.round, 2);
  // R06-PATCH-06: the same fingerprint recurs for the third time, so the
  // anti-repeat guard reports that restating the claim cannot clear it.
  assert.match(third.guidance, /EPISTEMIC_REPAIR_CANNOT_PARAPHRASE/);
  assert.match(third.guidance, /Do not rephrase the identical claim/);

  // The bound is configurable.
  const single = decideEpistemicRepair({ claims, previous: first, config: { maxRepairRounds: 1 } });
  assert.equal(single.status, REPAIR_STATUS.EXHAUSTED);
});

test("a repair that cleared its failures says so", () => {
  const opened = decideEpistemicRepair({ claims: [claim("c1", { failureCodes: ["F04"] })] });
  const cleared = decideEpistemicRepair({
    claims: [claim("c1", { failureCodes: [], evidenceIds: ["ev_1"], status: "VERIFIED" })],
    previous: opened
  });
  // RESOLVED, not NOT_REQUIRED: a repair that worked is distinguishable from a
  // turn that never needed one.
  assert.equal(cleared.status, REPAIR_STATUS.RESOLVED);
  assert.equal(cleared.repairId, opened.repairId);

  const never = decideEpistemicRepair({ claims: [claim("c1")] });
  assert.equal(never.status, REPAIR_STATUS.NOT_REQUIRED);
});

test("dependency withdrawal handles chains, cycles and unrelated claims", () => {
  const claims = [
    claim("a"),
    claim("b", { dependencies: ["a"] }),
    claim("c", { dependencies: ["b"] }),
    claim("d", { dependencies: ["e"] }),
    claim("e", { dependencies: ["d"] }),
    claim("f")
  ];
  assert.deepEqual(dependentClaimIds(claims, ["a"]).sort(), ["b", "c"]);
  // A cycle terminates rather than spinning.
  assert.deepEqual(dependentClaimIds(claims, ["d"]).sort(), ["e"]);
  assert.deepEqual(dependentClaimIds(claims, ["f"]), []);
  assert.deepEqual(dependentClaimIds([], ["a"]), []);
});

test("replacements offered by a challenge are carried in the state", () => {
  const out = decideEpistemicRepair({
    claims: [claim("c1", { failureCodes: ["F17"] })],
    replacementClaimIds: ["claim_new"]
  });
  assert.deepEqual(out.replacementClaimIds, ["claim_new"]);
});

test("R06-TRIG-001: F27..F40 verification debt classes all open a repair", () => {
  for (const code of ["F27","F28","F29","F30","F31","F32","F33","F34","F35","F36","F37","F38","F39","F40"]) {
    assert.ok(REPAIR_TRIGGER_CODES.includes(code), `expected ${code} in trigger codes`);
    const out = decideEpistemicRepair({
      claims: [claim("c1", { failureCodes: [code] })]
    });
    assert.equal(out.status, REPAIR_STATUS.REQUIRED, `${code} should require a repair`);
  }
});

test("R06-GUID-002: F27 scope-mismatch repair orders narrowing over re-verification", () => {
  const guidance = buildVerificationRepairGuidance({
    blockedClaims: [claim("c1", { failureCodes: ["F27"] })],
    repairRound: 1,
    maxRepairRounds: 2
  });
  assert.match(guidance, /SCOPE_REPAIR F27/);
  assert.match(guidance, /narrow the claim to the certificate scope/);
});

test("R06-GUID-003: F35 axiom repair forbids restating the axiom as a proof", () => {
  const guidance = buildVerificationRepairGuidance({
    blockedClaims: [claim("c1", { failureCodes: ["F35"] })],
    repairRound: 1,
    maxRepairRounds: 2
  });
  assert.match(guidance, /AXIOM_REPAIR F35/);
  assert.match(guidance, /Do not present an axiom as a proof/);
});

test("R06-GUID-005: F39 open-debt repair explicitly forbids paraphrasing", () => {
  const guidance = buildVerificationRepairGuidance({
    blockedClaims: [claim("c1", { failureCodes: ["F39"], challengeDebtIds: ["ch1"] })],
    repairRound: 1,
    maxRepairRounds: 2
  });
  assert.match(guidance, /DEBT_REPAIR F39/);
  assert.match(guidance, /Do not rephrase the claim/);
  assert.match(guidance, /OPEN_CHALLENGE_DEBT 1/);
});

test("R06-GUID-004: machine-readable debt fields are printed when present", () => {
  const blocked = claim("c1", {
    failureCodes: ["F29"],
    challengeDebtIds: ["ch1", "ch2"],
    verifierResults: [
      {
        requirement: "computational_integrity",
        status: "FAILED",
        reasonCode: "FAILED_CHECKS",
        scope: { status: "PARTIAL_MATCH", missing: ["prop_b", "prop_c"] },
        subcheckAggregate: {
          coverage: 0.6,
          requiredChecks: 5,
          passedChecks: 3,
          failedChecks: 2,
          unknownChecks: 1,
          missingChecks: 0
        },
        certificate: { formalizationKind: "NAT_TRANSITION_MODEL" }
      }
    ]
  });
  const guidance = buildVerificationRepairGuidance({ blockedClaims: [blocked] });
  assert.match(guidance, /OPEN_CHALLENGE_DEBT 2/);
  assert.match(guidance, /SCOPE_STATUS PARTIAL_MATCH/);
  assert.match(guidance, /MISSING_SCOPE_PROPERTIES prop_b,prop_c/);
  assert.match(guidance, /MANDATORY_COVERAGE 0.6/);
  assert.match(guidance, /FAILED_SUBCHECKS computational_integrity:failed=2:unknown=1:missing=0/);
  assert.match(guidance, /CERTIFICATE_KINDS NAT_TRANSITION_MODEL/);
});

test("R06-PATCH-06 / EPI-057: the same claim:code thrice forces a cannot-paraphrase outcome", () => {
  const same = () => [claim("c1", { failureCodes: ["F39"], challengeDebtIds: ["ch1"] })];
  const r1 = decideEpistemicRepair({ claims: same() });
  assert.equal(r1.status, REPAIR_STATUS.REQUIRED);
  const r2 = decideEpistemicRepair({ claims: same(), previous: r1 });
  assert.equal(r2.status, REPAIR_STATUS.REQUIRED);
  const r3 = decideEpistemicRepair({ claims: same(), previous: r2 });
  assert.equal(r3.status, REPAIR_STATUS.EXHAUSTED);
  assert.match(r3.guidance, /EPISTEMIC_REPAIR_CANNOT_PARAPHRASE/);
  assert.match(r3.guidance, /EPISTEMIC_REPAIR_CANNOT_PARAPHRASE/);
  // the fingerprint list is carried forward cumulatively
  assert.equal(r3.seenFailures["c1:F39"], 3);
});

test("R06-PATCH-06: a repair that genuinely changes the failure is not falsely exhausted", () => {
  const f27 = () => [claim("c1", { failureCodes: ["F27"] })];
  const f35 = () => [claim("c1", { failureCodes: ["F35"] })];
  const r1 = decideEpistemicRepair({ claims: f27() });
  const r2 = decideEpistemicRepair({ claims: f35(), previous: r1 });
  assert.equal(r2.status, REPAIR_STATUS.REQUIRED);
  assert.equal(r2.guidance.includes("EPISTEMIC_REPAIR_CANNOT_PARAPHRASE"), false);
});

test("REM-006.1: repairIdentityForClaim collapses a paraphrase/broader chain onto its root", () => {
  // A NARROWER claim is genuinely new and gets its own identity.
  assert.equal(
    repairIdentityForClaim({ id: "c3", inheritedFromClaimId: "c2", inheritedClaimRelation: "NARROWER" }),
    "c3"
  );
  // A PARAPHRASE inherits the root identity, no matter how many hops in between.
  assert.equal(
    repairIdentityForClaim({ id: "c3", inheritedFromClaimId: "c2", inheritedClaimRelation: "PARAPHRASE", semanticRootClaimId: "c1" }),
    "c1"
  );
  // A BROADER restatement inherits the root identity too (must not dodge the guard).
  assert.equal(
    repairIdentityForClaim({ id: "c3", inheritedFromClaimId: "c2", inheritedClaimRelation: "BROADER", semanticRootClaimId: "c1" }),
    "c1"
  );
  // Fall back to the inherited-from id / own id when no root is recorded.
  assert.equal(
    repairIdentityForClaim({ id: "c2", inheritedFromClaimId: "c1", inheritedClaimRelation: "PARAPHRASE" }),
    "c1"
  );
  assert.equal(repairIdentityForClaim({ id: "c1" }), "c1");
  assert.equal(repairIdentityForClaim(null), "");
});

test("REM-006.2: paraphrases of the same root exhaust together, not each on a fresh budget", () => {
  const root = claim("c1", { failureCodes: ["F39"], challengeDebtIds: ["ch1"], semanticRootClaimId: "root1" });
  const again = claim("c2", {
    inheritedFromClaimId: "c1",
    inheritedClaimRelation: "PARAPHRASE",
    semanticRootClaimId: "root1",
    failureCodes: ["F39"],
    challengeDebtIds: ["ch1"]
  });
  const r1 = decideEpistemicRepair({ claims: [root] });
  assert.equal(r1.status, REPAIR_STATUS.REQUIRED);
  const r2 = decideEpistemicRepair({ claims: [again], previous: r1 });
  assert.equal(r2.status, REPAIR_STATUS.REQUIRED);
  const r3 = decideEpistemicRepair({ claims: [again], previous: r2 });
  assert.equal(r3.status, REPAIR_STATUS.EXHAUSTED);
  // The fingerprint collapsed onto the shared root identity.
  assert.equal(r3.seenFailures["root1:F39"], 3);
});

test("REM-006.3: a NARROWER restatement gets a fresh fingerprint budget", () => {
  const maxRepairRounds = 4;
  const root = claim("c1", { failureCodes: ["F39"], challengeDebtIds: ["ch1"] });
  const narrowed = claim("c2", {
    inheritedFromClaimId: "c1",
    inheritedClaimRelation: "NARROWER",
    failureCodes: ["F39"],
    challengeDebtIds: ["ch1"]
  });
  const r1 = decideEpistemicRepair({ claims: [root], config: { maxRepairRounds } });
  const r2 = decideEpistemicRepair({ claims: [root], previous: r1, config: { maxRepairRounds } });
  // The root has now failed twice; a paraphrase would be exhausted.
  assert.equal(r2.seenFailures["c1:F39"], 2);
  assert.equal(r2.status, REPAIR_STATUS.REQUIRED);

  // A NARROWER restatement is genuinely new: its identity is c2, so it does
  // NOT inherit the root's exhausted budget and the repair stays REQUIRED.
  const r3 = decideEpistemicRepair({ claims: [narrowed], previous: r2, config: { maxRepairRounds } });
  assert.equal(r3.seenFailures["c1:F39"], 2);
  assert.equal(r3.seenFailures["c2:F39"], 1);
  assert.equal(r3.status, REPAIR_STATUS.REQUIRED);
  assert.equal(r3.guidance.includes("EPISTEMIC_REPAIR_CANNOT_PARAPHRASE"), false);

  // But a mere PARAPHRASE of the root at the same point IS exhausted.
  const paraphrase = claim("c3", {
    inheritedFromClaimId: "c1",
    inheritedClaimRelation: "PARAPHRASE",
    semanticRootClaimId: "c1",
    failureCodes: ["F39"],
    challengeDebtIds: ["ch1"]
  });
  const r4 = decideEpistemicRepair({ claims: [paraphrase], previous: r3, config: { maxRepairRounds } });
  assert.equal(r4.seenFailures["c1:F39"], 3);
  assert.equal(r4.status, REPAIR_STATUS.EXHAUSTED);
});

test("Q2-015 (§40): the repair debt object names every open remediation class", () => {
  const debt = buildRepairDebt({
    claimCoverage: { uncoveredSpans: ["LLM embeddings cluster into discrete semantic states."] },
    formalArtifacts: [
      { artifactId: "a1", status: "UNCHECKED" },
      { artifactId: "a2", status: "CHECKED_BOUND" },
      { artifactId: "a3", status: "INCOMPLETE" }
    ],
    claims: [
      { id: "c1", failureCodes: ["F27"] },
      { id: "c2", failureCodes: ["F18"] },
      { id: "c3", failureCodes: ["F13"] },
      { id: "c4", failureCodes: ["F37"] },
      { id: "c5", failureCodes: ["F08"] },
      { id: "c6", failureCodes: ["F33"] }
    ]
  });
  assert.equal(debt.uncoveredClaims.length, 1);
  assert.deepEqual(debt.unboundFormalArtifacts, ["a1", "a3"]);
  assert.deepEqual(debt.scopeMismatches, ["c1"]);
  assert.deepEqual(debt.unresolvedFormalFailures, ["c2"]);
  assert.deepEqual(debt.unverifiedSourceIdentities, ["c3"]);
  assert.deepEqual(debt.sourceRoleMismatches, ["c4"]);
  assert.deepEqual(debt.analogyPromotions, ["c5"]);
  assert.deepEqual(debt.synthesisOverclaims, ["c6"]);
  assert.equal(debt.total, 9);
});

test("Q2-015 (§40): a clean turn owes no repair debt", () => {
  const debt = buildRepairDebt({});
  assert.equal(debt.total, 0);
  assert.deepEqual(debt.uncoveredClaims, []);
});

test("Q2-015 (§27): each new remediation class carries its own repair guidance", () => {
  for (const code of ["F18", "F08", "F13", "F33"]) {
    const guidance = codeSpecificGuidance(code);
    assert.ok(guidance, `expected guidance for ${code}`);
    assert.ok(guidance.includes(code), `guidance for ${code} must name the code`);
  }
});
