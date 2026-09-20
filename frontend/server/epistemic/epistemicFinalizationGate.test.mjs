import test from "node:test";
import assert from "node:assert/strict";
import { SEVERITY } from "./epistemicContracts.mjs";
import { createClaim } from "./epistemicLedger.mjs";
import { evidenceFromToolResult } from "./epistemicEvidence.mjs";
import { evaluateEpistemicFinalCandidate } from "./epistemicFinalizationGate.mjs";
import { deriveUserVerificationContract } from "./epistemicUserVerificationContract.mjs";

const BLOCKING = Object.freeze({ enabled: true, mode: "block", blockSeverity: 4 });

function claim(overrides = {}) {
  return { ...createClaim({ text: overrides.text ?? "x" }), ...overrides };
}

function bashEvidence(command, exitCode) {
  return evidenceFromToolResult({
    callId: "c1",
    toolName: "bash",
    arguments: { command },
    rawResult: { content: "out", isError: exitCode !== 0, raw: { exit_code: exitCode } }
  });
}

test("the gate is inert until it is switched on", () => {
  const bad = { assistantContent: "All tests pass.", claims: [claim({ severity: SEVERITY.CRITICAL })] };
  for (const config of [undefined, {}, { enabled: false, mode: "block" }, { enabled: true, mode: "off" }]) {
    const out = evaluateEpistemicFinalCandidate({ ...bad, config });
    assert.equal(out.allowed, true);
    assert.equal(out.code, "EPISTEMIC_NOT_ACTIVE");
    assert.equal(out.mustContinue, false);
  }
});

test("a clean turn is allowed and says so", () => {
  const out = evaluateEpistemicFinalCandidate({
    assistantContent: "This section explains how the ladder operators work.",
    claims: [],
    config: BLOCKING
  });
  assert.equal(out.allowed, true);
  assert.equal(out.code, "EPISTEMIC_CLEAN");
  assert.deepEqual(out.blockedClaimIds, []);
});

test("an unresolved high-severity failure blocks", () => {
  const out = evaluateEpistemicFinalCandidate({
    assistantContent: "Here is the answer.",
    claims: [claim({ id: "c1", severity: SEVERITY.CRITICAL, failureCodes: ["F18"] })],
    config: BLOCKING
  });
  assert.equal(out.allowed, false);
  assert.equal(out.mustContinue, true);
  assert.equal(out.code, "EPISTEMIC_SEVERITY_UNRESOLVED");
  assert.deepEqual(out.blockedClaimIds, ["c1"]);

  // A claim already rejected is resolved: it is no longer being asserted.
  const settled = evaluateEpistemicFinalCandidate({
    assistantContent: "Here is the answer.",
    claims: [claim({ id: "c1", severity: SEVERITY.CRITICAL, status: "REJECTED" })],
    config: BLOCKING
  });
  assert.equal(settled.code, "EPISTEMIC_CLEAN");

  // The threshold is configurable, and S3 is below it by default.
  const medium = evaluateEpistemicFinalCandidate({
    assistantContent: "Here is the answer.",
    claims: [claim({ id: "c1", severity: SEVERITY.MEDIUM })],
    config: BLOCKING
  });
  assert.equal(medium.code, "EPISTEMIC_CLEAN");
});

test("EPI-009: a fabricated internal analysis with no producing run is blocked", () => {
  // The candidate presents an internal analysis as if it were produced, but no
  // execution/analysis artifact backs it: it is fabricated, and it must be
  // blocked rather than passed as a finished derivation.
  const out = evaluateEpistemicFinalCandidate({
    assistantContent: "Our internal analysis shows the torque is exactly balanced.",
    claims: [
      claim({
        id: "c1",
        text: "Our internal analysis shows the torque is exactly balanced.",
        verificationRequirements: ["analysis_execution_or_source_artifact"]
      })
    ],
    config: BLOCKING
  });
  assert.equal(out.allowed, false);
  assert.equal(out.code, "EPISTEMIC_UNSUPPORTED_EMPIRICAL_CLAIM");
  assert.deepEqual(out.blockedClaimIds, ["c1"]);
});

test("an empirical claim with no evidence blocks", () => {
  const out = evaluateEpistemicFinalCandidate({
    assistantContent: "We measured a 42% improvement.",
    claims: [
      claim({
        id: "c1",
        text: "We measured a 42% improvement.",
        verificationRequirements: ["observation_evidence"]
      })
    ],
    config: BLOCKING
  });
  assert.equal(out.code, "EPISTEMIC_UNSUPPORTED_EMPIRICAL_CLAIM");
  assert.deepEqual(out.blockedClaimIds, ["c1"]);

  // With evidence attached it passes; reasoning the reader can follow needs none.
  const supported = evaluateEpistemicFinalCandidate({
    assistantContent: "We measured a 42% improvement.",
    claims: [
      claim({
        id: "c1",
        verificationRequirements: ["observation_evidence"],
        evidenceIds: ["ev_1"],
        status: "VERIFIED"
      }),
      claim({ id: "c2", text: "It follows that the loop terminates." })
    ],
    config: BLOCKING
  });
  assert.equal(supported.code, "EPISTEMIC_CLEAN");
});

test("FG-001: a requirement-bearing pending claim cannot reach CLEAN", () => {
  const out = evaluateEpistemicFinalCandidate({
    assistantContent: "The equality is discussed below.",
    claims: [
      claim({
        id: "c_math",
        status: "VERIFICATION_PENDING",
        verificationRequirements: ["math_verification"]
      })
    ],
    config: BLOCKING
  });
  assert.equal(out.code, "EPISTEMIC_VERIFICATION_INCOMPLETE");
  assert.equal(out.allowed, false);
  assert.deepEqual(out.blockedClaimIds, ["c_math"]);
});

test("FG-002: UNKNOWN or PARTIAL cannot use protected authoritative language", () => {
  for (const [status, code] of [
    ["UNKNOWN", "EPISTEMIC_UNKNOWN_RENDERED_AS_KNOWN"],
    ["PARTIAL", "EPISTEMIC_PARTIAL_RENDERED_AS_KNOWN"]
  ]) {
    const out = evaluateEpistemicFinalCandidate({
      assistantContent: "This is verified.",
      claims: [claim({ id: `c_${status}`, status, flags: { usesProtectedLanguage: true } })],
      config: BLOCKING
    });
    assert.equal(out.code, code);
    assert.equal(out.allowed, false);
  }
});

test("a citation whose identifier names another paper blocks", () => {
  for (const code of ["F17", "F01"]) {
    const out = evaluateEpistemicFinalCandidate({
      assistantContent: "As shown in Fujii 2007 (arXiv:1409.3215).",
      claims: [claim({ id: "c1", failureCodes: [code], evidenceIds: ["ev_1"] })],
      config: BLOCKING
    });
    assert.equal(out.code, "EPISTEMIC_CITATION_IDENTITY_MISMATCH", code);
  }

  const off = evaluateEpistemicFinalCandidate({
    assistantContent: "As shown in Fujii 2007.",
    claims: [claim({ id: "c1", failureCodes: ["F17"], evidenceIds: ["ev_1"] })],
    config: { ...BLOCKING, verifyCitations: false }
  });
  assert.equal(off.code, "EPISTEMIC_CLEAN");
});

test("EPI-010: an execution claim with no tool record blocks", () => {
  const out = evaluateEpistemicFinalCandidate({
    assistantContent: "The implementation is complete and working.",
    claims: [],
    evidence: [],
    config: BLOCKING
  });
  assert.equal(out.code, "EPISTEMIC_EXECUTION_CLAIM_WITHOUT_TRACE");
  assert.match(out.guidance, /no tool in this turn produced any/);

  const ran = evaluateEpistemicFinalCandidate({
    assistantContent: "The implementation is complete and working.",
    claims: [],
    evidence: [bashEvidence("./build.sh", 0)],
    config: BLOCKING
  });
  assert.equal(ran.code, "EPISTEMIC_CLEAN");

  const off = evaluateEpistemicFinalCandidate({
    assistantContent: "The implementation is complete and working.",
    evidence: [],
    config: { ...BLOCKING, verifyExecutionClaims: false }
  });
  assert.equal(off.code, "EPISTEMIC_CLEAN");
});

test("EPI-016: conceding to a critique with nothing checked blocks", () => {
  const challenges = [{ id: "ch1", targetClaimId: "c1", challengeText: "that DOI is wrong" }];
  const out = evaluateEpistemicFinalCandidate({
    assistantContent: "Hai ragione, il valore corretto è 3.2.",
    challenges,
    evidence: [],
    config: BLOCKING
  });
  assert.equal(out.code, "EPISTEMIC_CHALLENGE_ACCEPTED_WITHOUT_VERIFICATION");
  assert.deepEqual(out.blockedClaimIds, ["c1"]);

  // FG-003: unrelated evidence is not evidence for the challenged claim.
  const unrelated = evaluateEpistemicFinalCandidate({
    assistantContent: "Hai ragione, il valore corretto è 3.2.",
    challenges,
    evidence: [bashEvidence("curl -s https://api.crossref.org/works/10.5555/x", 0)],
    config: BLOCKING
  });
  assert.equal(unrelated.code, "EPISTEMIC_CHALLENGE_ACCEPTED_WITHOUT_VERIFICATION");

  // FG-004: a conclusive result with evidence bound to the target is a check.
  const evidence = bashEvidence("node --test correction.test.mjs", 0);
  evidence.supportsClaimIds.push("c1");
  const checked = evaluateEpistemicFinalCandidate({
    assistantContent: "Hai ragione, il valore corretto è 3.2.",
    claims: [
      claim({
        id: "c1",
        status: "VERIFIED",
        evidenceIds: [evidence.id],
        verifierResults: [{ status: "PASSED", evidenceIds: [evidence.id] }]
      })
    ],
    challenges,
    evidence: [evidence],
    config: BLOCKING
  });
  assert.equal(checked.code, "EPISTEMIC_CLEAN");

  // No challenge this turn means there is no critique to have echoed.
  const unprompted = evaluateEpistemicFinalCandidate({
    assistantContent: "Hai ragione, il valore corretto è 3.2.",
    challenges: [],
    config: BLOCKING
  });
  assert.equal(unprompted.code, "EPISTEMIC_CLEAN");
});

test("F26: a repair summary may only restate what the repair verified", () => {
  const claims = [
    claim({ id: "c1", status: "VERIFIED", evidenceIds: ["ev_1"] }),
    claim({ id: "c2", status: "VERIFICATION_PENDING" })
  ];
  const out = evaluateEpistemicFinalCandidate({
    assistantContent: "Summary of the repair: everything is now consistent.",
    claims,
    repairState: { summarizing: true, round: 1 },
    config: BLOCKING
  });
  assert.equal(out.code, "EPISTEMIC_REPAIR_SUMMARY_CONTAMINATED");
  assert.deepEqual(out.blockedClaimIds, ["c2"]);

  // The same claims outside a repair summary are an ordinary turn.
  const ordinary = evaluateEpistemicFinalCandidate({
    assistantContent: "Summary of the repair: everything is now consistent.",
    claims,
    repairState: null,
    config: BLOCKING
  });
  assert.equal(ordinary.code, "EPISTEMIC_CLEAN");
});

test("F24: a claim whose premise fell may not be rendered as true", () => {
  const invalidated = evaluateEpistemicFinalCandidate({
    assistantContent: "Therefore the throughput doubles.",
    claims: [claim({ id: "c2", status: "INVALIDATED" })],
    config: BLOCKING
  });
  assert.equal(invalidated.code, "EPISTEMIC_DEPENDENCY_INVALID_CLAIM_RENDERED");
  assert.deepEqual(invalidated.blockedClaimIds, ["c2"]);

  const flagged = evaluateEpistemicFinalCandidate({
    assistantContent: "Therefore the throughput doubles.",
    claims: [claim({ id: "c2", failureCodes: ["F24"], evidenceIds: ["ev_1"], severity: SEVERITY.MEDIUM })],
    config: BLOCKING
  });
  assert.equal(flagged.code, "EPISTEMIC_DEPENDENCY_INVALID_CLAIM_RENDERED");
});

test("shadow mode reports the finding without withholding the answer", () => {
  const input = {
    assistantContent: "The implementation is complete and working.",
    claims: [claim({ id: "c1", severity: SEVERITY.CRITICAL })],
    evidence: []
  };
  const shadow = evaluateEpistemicFinalCandidate({ ...input, config: { enabled: true, mode: "shadow" } });
  // Same finding, same code, same guidance — the turn simply still ships.
  assert.equal(shadow.code, "EPISTEMIC_SEVERITY_UNRESOLVED");
  assert.equal(shadow.allowed, true);
  assert.equal(shadow.mustContinue, false);
  assert.deepEqual(shadow.blockedClaimIds, ["c1"]);
  // §37's telemetry: the turn shipped, and this is what block mode would have done.
  assert.equal(shadow.wouldBlock, true);

  const blocking = evaluateEpistemicFinalCandidate({ ...input, config: BLOCKING });
  assert.equal(blocking.code, shadow.code);
  assert.equal(blocking.allowed, false);
  assert.equal(blocking.wouldBlock, true);

  const clean = evaluateEpistemicFinalCandidate({ assistantContent: "Plain prose.", config: BLOCKING });
  assert.equal(clean.wouldBlock, false);
});

test("the checks fire in severity order and the result is stable", () => {
  // A turn that trips several conditions reports the most serious one.
  const input = {
    assistantContent: "The implementation is complete and working.",
    claims: [claim({ id: "c1", severity: SEVERITY.CRITICAL }), claim({ id: "c2", status: "INVALIDATED" })],
    evidence: [],
    config: BLOCKING
  };
  const first = evaluateEpistemicFinalCandidate(input);
  assert.equal(first.code, "EPISTEMIC_SEVERITY_UNRESOLVED");
  assert.deepEqual(evaluateEpistemicFinalCandidate(input), first);
});

test("R04-FINGATE-001: protected wording bound to a non-ASSERT claim blocks even without the legacy flag", () => {
  // An UNKNOWN claim that bypasses the flag-based unsettled-authority check
  // (no `usesProtectedLanguage` flag, no requirements -> not empirical) is
  // still caught by content-based claim-bound authorization: "verified"
  // exceeds what an UNKNOWN claim authorizes.
  const out = evaluateEpistemicFinalCandidate({
    assistantContent: "The number operator is verified.",
    claims: [claim({ id: "c1", text: "The number operator is complete.", status: "UNKNOWN" })],
    config: BLOCKING
  });
  assert.equal(out.allowed, false);
  assert.equal(out.code, "EPISTEMIC_VERIFICATION_LANGUAGE_UNAUTHORIZED");
  assert.deepEqual(out.blockedClaimIds, ["c1"]);
});

test("R04-FINGATE-002: a properly authorized VERIFIED claim may use protected wording", () => {
  const out = evaluateEpistemicFinalCandidate({
    assistantContent: "The number operator is verified.",
    claims: [claim({
      id: "c1",
      text: "The number operator is complete.",
      status: "VERIFIED",
      verificationRequirements: ["math_verification"],
      verificationPlanSummary: {
        status: "PASSED",
        coverage: 1,
        mandatoryPassed: 1,
        mandatoryFailedOrMissing: 0
      },
      verifierResults: [
        { status: "PASSED", certificate: { id: "cert_1" }, scope: { status: "MATCH" } }
      ]
    })],
    config: BLOCKING
  });
  assert.equal(out.allowed, true);
  assert.equal(out.code, "EPISTEMIC_CLEAN");
});

test("R04-FINGATE-003: the authorization check is off when verification-language verification is disabled", () => {
  const disabled = { ...BLOCKING, verifyVerificationLanguage: false };
  const out = evaluateEpistemicFinalCandidate({
    assistantContent: "The number operator is verified.",
    claims: [claim({ id: "c1", text: "The number operator is complete.", status: "UNKNOWN" })],
    config: disabled
  });
  assert.equal(out.allowed, true);
  assert.equal(out.code, "EPISTEMIC_CLEAN");
});

test("Q2-010: the finalizer blocks an analogy promoted to a literal LLM mechanism", () => {
  const content =
    "L'attenzione agisce come una misura che collassa la sovrapposizione di significati del token.";
  const out = evaluateEpistemicFinalCandidate({
    assistantContent: content,
    claims: [claim({ id: "c-analogy", text: content, epistemicType: "ANALOGY" })],
    bridges: [],
    config: BLOCKING
  });

  assert.equal(out.allowed, false);
  assert.equal(out.code, "EPISTEMIC_ANALOGY_PROMOTED_TO_FACT");
  assert.deepEqual(out.blockedClaimIds, ["c-analogy"]);
});

test("Q2-014: strict mode blocks incomplete assertive-span coverage", () => {
  const verificationContract = deriveUserVerificationContract({
    userText: "Ogni affermazione deve essere dimostrata con Lean."
  });
  const out = evaluateEpistemicFinalCandidate({
    assistantContent: "Il teorema A vale. Anche il teorema B vale.",
    claims: [claim({ id: "c-a", text: "Il teorema A vale." })],
    verificationContract,
    extractionStatus: "EXTRACTION_COMPLETE",
    config: BLOCKING
  });

  assert.equal(out.allowed, false);
  assert.equal(out.code, "EPISTEMIC_STRICT_CLAIM_COVERAGE_INCOMPLETE");
});

test("Q2-014: strict mathematical claims require a matching Lean certificate", () => {
  const verificationContract = deriveUserVerificationContract({
    userText: "Ogni affermazione deve essere dimostrata con Lean."
  });
  const content = "Lo spettro QHO è discreto.";
  const out = evaluateEpistemicFinalCandidate({
    assistantContent: content,
    claims: [claim({ id: "c-qho", text: content, epistemicType: "DERIVED" })],
    verificationContract,
    extractionStatus: "EXTRACTION_COMPLETE",
    leanCertificates: [],
    config: BLOCKING
  });

  assert.equal(out.allowed, false);
  assert.equal(out.code, "EPISTEMIC_USER_VERIFICATION_CONTRACT_VIOLATION");
  assert.deepEqual(out.blockedClaimIds, ["c-qho"]);
});

test("Q2-015 control (§56): a repair that trades a bad claim for a new uncovered one still blocks", () => {
  const contract = deriveUserVerificationContract({
    userText: "Ogni affermazione deve essere dimostrata con Lean."
  });
  // The offending claim is gone; a fresh assertive sentence took its place and
  // never became a claim, so coverage is still short of 1.
  const decision = evaluateEpistemicFinalCandidate({
    assistantContent:
      "Lean ha verificato l'iniettivita del costruttore. " +
      "Gli embedding dell'LLM si raggruppano in stati semantici discreti.",
    claims: [
      {
        id: "C1",
        text: "Lean ha verificato l'iniettivita del costruttore.",
        status: "VERIFIED",
        epistemicType: "DERIVED"
      }
    ],
    verificationContract: contract,
    extractionStatus: "EXTRACTION_COMPLETE",
    config: { enabled: true, mode: "block" }
  });
  assert.equal(decision.allowed, false);
  assert.equal(decision.code, "EPISTEMIC_STRICT_CLAIM_COVERAGE_INCOMPLETE");
});

test("Q2-004/Q2-015: a verified Lean heading cannot contain an unbound artifact", () => {
  const out = evaluateEpistemicFinalCandidate({
    assistantContent: "Dimostrazione Lean verificata\n```lean\ntheorem t : True := by trivial\n```",
    claims: [],
    formalArtifacts: [
      {
        artifactId: "fa-1",
        renderedAsVerified: true,
        status: "UNCHECKED",
        failureCodes: ["F18"]
      }
    ],
    config: BLOCKING
  });

  assert.equal(out.allowed, false);
  assert.equal(out.code, "EPISTEMIC_FORMAL_ARTIFACT_UNBOUND");
});
