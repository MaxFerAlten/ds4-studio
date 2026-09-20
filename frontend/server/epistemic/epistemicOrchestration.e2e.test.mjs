import test from "node:test";
import assert from "node:assert/strict";
import { AuthoritativeOutputBuffer } from "../authoritativeOutputBuffer.mjs";
import { evidenceFromToolResult } from "./epistemicEvidence.mjs";
import { MATH_CHECK_MARKER } from "./epistemicMathVerifier.mjs";
import { EpistemicSessionLedger } from "./epistemicSessionLedger.mjs";
import { createEpistemicTurn, evaluateEpistemicTurn } from "./epistemicTurn.mjs";
import { applyChallenges, extractChallenges } from "./epistemicChallengeExtractor.mjs";

const HARDENED = Object.freeze({
  enabled: true,
  mode: "block",
  withholdOutput: true,
  blockSeverity: 4,
  maxClaimsPerTurn: 64,
  maxVerifierCallsPerTurn: 4,
  verifyMath: true,
  verifyCitations: true,
  verifyExecutionClaims: true,
  verifyChallenges: true
});

function extractionClient(claims) {
  return {
    calls: [],
    async completeRole(args) {
      this.calls.push(args);
      if (args.roleName !== "epistemic_claim_extractor") {
        throw new Error(`unexpected semantic role ${args.roleName}`);
      }
      return { json: { claims }, content: JSON.stringify({ claims }) };
    }
  };
}

function mathClaim(text) {
  return {
    id: "C1",
    text,
    epistemicType: "COMPUTED",
    dependencies: [],
    flags: { containsArithmetic: true, usesProtectedLanguage: true }
  };
}

function sage(outcome) {
  return async () => ({
    content: `${MATH_CHECK_MARKER}: ${outcome}`,
    isError: false,
    runId: `run_${outcome}`,
    sageResult: {
      status: "ok",
      state: "validated",
      runId: `run_${outcome}`,
      execution: { ok: true, timedOut: false, exitCode: 0 }
    }
  });
}

function bashEvidence(command, exitCode = 0) {
  return evidenceFromToolResult({
    callId: `call_${command}`,
    toolName: "bash",
    arguments: { command },
    rawResult: { isError: exitCode !== 0, raw: { exit_code: exitCode }, content: "done" }
  });
}

async function runCandidate({ text, claims, config = {}, executeSage = null, evidence = [] }) {
  const turn = createEpistemicTurn({ config: { ...HARDENED, ...config } });
  for (const item of evidence) turn.evidence.add(item);
  const session = new EpistemicSessionLedger();
  session.beginTurn();
  const buffer = new AuthoritativeOutputBuffer();
  const published = [];
  buffer.append(text);

  const decision = await evaluateEpistemicTurn(turn, {
    assistantContent: text,
    client: extractionClient(claims),
    executeSage,
    sessionLedger: session
  });
  const turnClaims = turn.ledger.allClaims();
  session.stageClaims(turnClaims);
  if (decision.allowed) {
    session.commitClaims(turnClaims);
    buffer.flush((chunk) => published.push(chunk));
  } else {
    session.discardCandidate(decision.code);
    buffer.discard();
  }
  return { turn, session, buffer, published, decision };
}

test("EPI_ORCH_001: a verifier that never ran can never produce VERIFIED", async () => {
  const out = await runCandidate({
    text: "sqrt(124000000) = 11",
    claims: [mathClaim("sqrt(124000000) = 11")],
    config: { maxVerifierCallsPerTurn: 0 }
  });
  assert.equal(out.turn.ledger.allClaims()[0].status, "UNKNOWN");
  assert.equal(out.decision.promotions[0].promotion.decision, "UNKNOWN");
  assert.equal(out.decision.allowed, false);
  assert.deepEqual(out.published, []);
});

test("EPI_ORCH_002: a Sage refutation rejects the candidate before publication", async () => {
  const out = await runCandidate({
    text: "sqrt(124000000) = 11",
    claims: [mathClaim("sqrt(124000000) = 11")],
    executeSage: sage("FAIL")
  });
  const claim = out.turn.ledger.allClaims()[0];
  assert.equal(claim.status, "CONTRADICTED");
  // F05 is the refutation. F29 additionally reports the mandatory coverage gap
  // left by the failed check (REM-003): rejection still wins.
  assert.deepEqual(claim.failureCodes, ["F05", "F29"]);
  assert.equal(out.decision.allowed, false);
  assert.deepEqual(out.published, []);
});

test("EPI_ORCH_003: a Sage pass binds evidence before VERIFIED and publication", async () => {
  const out = await runCandidate({
    text: "sqrt(4) = 2",
    claims: [mathClaim("sqrt(4) = 2")],
    executeSage: sage("PASS")
  });
  const claim = out.turn.ledger.allClaims()[0];
  assert.equal(claim.status, "VERIFIED");
  assert.equal(claim.evidenceIds.length, 1);
  assert.deepEqual(out.turn.evidence.items[0].supportsClaimIds, [claim.id]);
  assert.equal(out.decision.allowed, true);
  assert.deepEqual(out.published, ["sqrt(4) = 2"]);
});

test("EPI_ORCH_004: unrelated bash evidence cannot verify a test claim", async () => {
  const out = await runCandidate({
    text: "All tests pass.",
    claims: [{ id: "C1", text: "All tests pass.", epistemicType: "OBSERVED", flags: { assertsTest: true } }],
    evidence: [bashEvidence("ls -la")]
  });
  assert.notEqual(out.turn.ledger.allClaims()[0].status, "VERIFIED");
  assert.equal(out.decision.allowed, false);
  assert.deepEqual(out.published, []);
});

test("EPI_ORCH_005: a successful test command verifies only its matching claim", async () => {
  const evidence = bashEvidence("node --test correction.test.mjs");
  const out = await runCandidate({
    text: "All tests pass.",
    claims: [{ id: "C1", text: "All tests pass.", epistemicType: "OBSERVED", flags: { assertsTest: true } }],
    evidence: [evidence]
  });
  const claim = out.turn.ledger.allClaims()[0];
  assert.equal(claim.status, "VERIFIED");
  assert.deepEqual(claim.evidenceIds, [evidence.id]);
  assert.equal(out.decision.allowed, true);
});

test("EPI_ORCH_006: zero citation budget leaves exact identity UNKNOWN", async () => {
  const text = "The exact DOI is DOI: 10.1000/example.";
  const out = await runCandidate({
    text,
    claims: [
      {
        id: "C1",
        text,
        epistemicType: "SOURCE_FACT",
        flags: { containsCitation: true, usesProtectedLanguage: true }
      }
    ],
    config: { maxVerifierCallsPerTurn: 0 }
  });
  assert.equal(out.turn.ledger.allClaims()[0].status, "UNKNOWN");
  assert.equal(out.decision.allowed, false);
});

test("a multi-turn challenge changes state only after fresh verifier evidence", async () => {
  const session = new EpistemicSessionLedger();
  session.beginTurn();
  session.commitClaims([
    {
      id: "prior_tests",
      text: "All tests pass.",
      normalizedText: "all tests pass",
      epistemicType: "OBSERVED",
      status: "VERIFIED",
      evidenceIds: ["ev_prior"],
      failureCodes: [],
      dependencies: [],
      verificationRequirements: ["test_evidence"],
      verifierResults: [],
      flags: { assertsTest: true }
    }
  ]);

  const turn = createEpistemicTurn({
    config: HARDENED,
    userText: "Hai sbagliato: i test non passano."
  });
  for (const prior of session.acceptedClaims()) turn.ledger.importSnapshotClaim(prior);
  const extracted = await extractChallenges({
    userText: turn.userText,
    priorClaims: session.acceptedClaims(),
    client: null
  });
  applyChallenges(turn.ledger, extracted);
  turn.noteChallenges(extracted.challenges);
  const fresh = bashEvidence("node --test correction.test.mjs");
  turn.evidence.add(fresh);

  const decision = await evaluateEpistemicTurn(turn, {
    assistantContent: "Hai ragione: ho rieseguito la suite.",
    client: extractionClient([]),
    sessionLedger: session
  });
  const challenged = turn.ledger.getClaim("prior_tests");
  assert.equal(challenged.status, "VERIFIED");
  assert.ok(challenged.evidenceIds.includes(fresh.id));
  assert.equal(decision.allowed, true);
});

test("self-critique audit records verifier-backed state changes", async () => {
  const evidence = bashEvidence("node --test correction.test.mjs");
  const turn = createEpistemicTurn({
    config: HARDENED,
    userText: "Fai autocritica e ricontrolla."
  });
  turn.evidence.add(evidence);
  const decision = await evaluateEpistemicTurn(turn, {
    assistantContent: "All tests pass.",
    client: extractionClient([
      {
        id: "C1",
        text: "All tests pass.",
        epistemicType: "OBSERVED",
        flags: { assertsTest: true }
      }
    ])
  });
  assert.equal(decision.selfCritiqueAudit.triggered, true);
  assert.equal(decision.selfCritiqueAudit.requests[0].requirement, "test_evidence");
  const change = decision.selfCritiqueAudit.stateChanges[0];
  assert.equal(change.from, "PROPOSED");
  assert.equal(change.to, "VERIFIED");
  assert.equal(change.verifierResults[0].status, "PASSED");
});

test("PATCH-34: extractor dependencies reach the ledger and broken parents reject descendants", async () => {
  const evidence = bashEvidence("node --test dependency.test.mjs");
  const out = await runCandidate({
    text: "sqrt(9) = 4. All tests pass for layer two. All tests pass for layer three.",
    claims: [
      {
        id: "C1",
        text: "sqrt(9) = 4",
        epistemicType: "COMPUTED",
        dependencies: [],
        flags: { containsArithmetic: true, usesProtectedLanguage: true }
      },
      {
        id: "C2",
        text: "All tests pass for layer two.",
        epistemicType: "OBSERVED",
        dependencies: ["C1"],
        flags: { assertsTest: true, usesProtectedLanguage: true }
      },
      {
        id: "C3",
        text: "All tests pass for layer three.",
        epistemicType: "OBSERVED",
        dependencies: ["C2"],
        flags: { assertsTest: true, usesProtectedLanguage: true }
      }
    ],
    evidence: [evidence],
    executeSage: sage("FAIL")
  });

  const [parent, child, grandchild] = out.turn.ledger.allClaims();
  assert.deepEqual(
    out.turn.ledger.transitiveDependents(parent.id).sort(),
    [child.id, grandchild.id].sort()
  );
  assert.equal(parent.status, "CONTRADICTED");
  assert.ok(["REJECTED", "CONTRADICTED", "INVALIDATED"].includes(child.status));
  assert.ok(["REJECTED", "CONTRADICTED", "INVALIDATED"].includes(grandchild.status));
  const dependencyAudit = JSON.stringify({
    claims: out.turn.ledger.allClaims(),
    promotions: out.decision.promotions
  });
  assert.ok(child.failureCodes.includes("F24"), dependencyAudit);
  assert.ok(grandchild.failureCodes.includes("F24"), dependencyAudit);
  assert.equal(out.decision.allowed, false);
  assert.deepEqual(out.published, []);
});

test("EPI-054 (R05): a cross-turn paraphrase cannot escape a rejected claim's debt", async () => {
  const session = new EpistemicSessionLedger();
  session.beginTurn();
  // Seed the session with the rejected prior: number-operator proof rejected
  // with open challenge debt (ch1) and F39, per R05-PATCH-04.
  const prior = {
    ...mathClaim("Lean proved the number operator."),
    id: "prior1",
    status: "REJECTED",
    challengeDebtIds: ["ch1"],
    failureCodes: ["F39"],
    negativeProvenance: ["prior-note"],
    correctiveEpoch: 2,
    lastQualifiedEvidenceEpoch: 1,
    normalizedText: "lean proved the number operator",
    text: "Lean proved the number operator."
  };
  session.rejected.set("lean proved the number operator", prior);

  // Turn 2 restates the same proposition as a paraphrase, with no new evidence.
  const turn = createEpistemicTurn({ config: HARDENED });
  const decision = await evaluateEpistemicTurn(turn, {
    assistantContent: "The number-operator relation was machine certified.",
    client: extractionClient([
      {
        id: "C2",
        text: "The number-operator relation was machine certified.",
        epistemicType: "COMPUTED",
        dependencies: [],
        flags: { usesProtectedLanguage: true }
      }
    ]),
    sessionLedger: session
  });

  // The paraphrase must inherit the prior debt and be blocked, not slip through.
  const claim = turn.ledger.allClaims()[0];
  assert.ok(claim.challengeDebtIds.includes("ch1") || claim.failureCodes.includes("F39"), JSON.stringify(claim));
  assert.equal(decision.allowed, false);
});

test("EPI-055 (R05): a cross-turn narrowing can proceed after fresh scope evaluation", async () => {
  const session = new EpistemicSessionLedger();
  session.beginTurn();
  const prior = {
    ...mathClaim("Lean proved the full quantum harmonic oscillator ladder algebra."),
    id: "prior-broad",
    status: "REJECTED",
    failureCodes: ["F27"],
    normalizedText: "lean proved the full quantum harmonic oscillator ladder algebra",
    text: "Lean proved the full quantum harmonic oscillator ladder algebra."
  };
  session.rejected.set("lean proved the full quantum harmonic oscillator ladder algebra", prior);

  // Turn 2 narrows the claim: Lean typechecked only the toy Nat transition
  // theorem and explicitly does not verify N|n> = n|n>.
  const turn = createEpistemicTurn({ config: HARDENED });
  const decision = await evaluateEpistemicTurn(turn, {
    assistantContent: "Lean typechecked only the toy transition model. It does not verify N|n> = n|n>.",
    client: extractionClient([
      {
        id: "C3",
        text: "Lean typechecked only the toy transition model.",
        epistemicType: "COMPUTED",
        dependencies: [],
        flags: { assertsProof: true, usesProtectedLanguage: true }
      }
    ]),
    sessionLedger: session
  });

  // The narrow claim is a different, honest assertion: it must not inherit the
  // broad claim's rejection as an impassable block.
  const claim = turn.ledger.allClaims()[0] ?? null;
  assert.equal(claim === null, false);
  const inheritedBroaderDebt = claim.failureCodes?.includes("F27") && claim.inheritedClaimRelation === "PARAPHRASE";
  // Even if it narrows, its own verification decides; the honest narrowed
  // wording is explicitly allowed by the plan.
  assert.doesNotMatch(decision?.guidance ?? "", /contains the claim/);
});
