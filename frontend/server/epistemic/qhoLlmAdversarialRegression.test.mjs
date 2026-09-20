/**
 * Q2-017 (remediation.Quantiom.002 §30, §31, §32) — the QHO→LLM full replay.
 *
 * Not a unit test of any one verifier (§30 forbids that): the whole turn runs,
 * so the user contract, claim extraction, the assistant's own self-correction,
 * three real Lean outcomes, certificate scope, source identity, the modeling
 * bridge, promotion, synthesis and finalization all have to agree before the
 * answer publishes.
 *
 * Three candidates over the same evidence:
 *   - the transcript's own final answer must BLOCK;
 *   - the honest repair must publish;
 *   - the repair plus one unbacked factual sentence must BLOCK again (§32).
 */
import test from "node:test";
import assert from "node:assert/strict";

import { createEpistemicTurn, evaluateEpistemicTurn } from "./epistemicTurn.mjs";
import { EpistemicSessionLedger } from "./epistemicSessionLedger.mjs";
import { EpistemicSourceContext } from "./epistemicSourceContext.mjs";
import { assessSynthesisAuthorization } from "./epistemicSynthesisAuthorization.mjs";
import { assessBibliographicAuthorization } from "./epistemicSourceIdentityAuthority.mjs";
import { unboundVerifiedArtifacts } from "./epistemicFormalArtifactBinding.mjs";
import { QHO_LLM_ADVERSARIAL } from "./fixtures/qhoLlmAdversarialConversation.mjs";

const HARDENED = Object.freeze({
  enabled: true,
  mode: "block",
  withholdOutput: true,
  blockSeverity: 4,
  maxClaimsPerTurn: 64,
  maxVerifierCallsPerTurn: 8,
  verifyMath: true,
  verifyCitations: true,
  verifyExecutionClaims: true,
  verifyChallenges: true,
  verifyVerificationLanguage: true
});

function extractionClient(claims) {
  return {
    async completeRole(args) {
      if (args.roleName === "epistemic_claim_extractor") {
        return { json: { claims }, content: JSON.stringify({ claims }) };
      }
      // Every other semantic role stays lexical, which is the safe side.
      throw new Error(`role ${args.roleName} is not stubbed`);
    }
  };
}

/** Replay the conversation's tool and source events into one turn. */
function stageTurn({ claims }) {
  const turn = createEpistemicTurn({
    config: HARDENED,
    userText: QHO_LLM_ADVERSARIAL.userRequest
  });
  for (const event of QHO_LLM_ADVERSARIAL.toolEvents) {
    turn.addToolResult({
      callId: `call_${event.sourceId}`,
      toolName: "lean_check",
      arguments: { code: event.source },
      rawResult: {
        isError: event.status !== "CHECKED",
        content: `[lean] ${event.sourceId}: ${event.status}`,
        raw: event.raw
      }
    });
  }

  const sourceContext = new EpistemicSourceContext();
  const claimIds = new Set(claims.map((claim) => claim.id));
  for (const record of QHO_LLM_ADVERSARIAL.sourceEvents) {
    if (!claimIds.has(record.claimId)) continue;
    sourceContext.bind(record.claimId, {
      evidenceId: `ev_${record.sourceId}`,
      source: record,
      passages: []
    });
  }
  return { turn, sourceContext };
}

async function replay({ candidate, claims }) {
  const { turn, sourceContext } = stageTurn({ claims });
  const decision = await evaluateEpistemicTurn(turn, {
    assistantContent: candidate,
    reasoning: QHO_LLM_ADVERSARIAL.reasoningEvents.join("\n"),
    client: extractionClient(claims),
    sourceContext,
    sessionLedger: new EpistemicSessionLedger()
  });
  return { turn, decision };
}

test("Q2-017 (§30): the transcript's own final answer is blocked", async () => {
  const { decision } = await replay({
    candidate: QHO_LLM_ADVERSARIAL.finalCandidate,
    claims: QHO_LLM_ADVERSARIAL.finalClaims
  });
  assert.equal(decision.allowed, false, `expected BLOCK, got ${decision.code}`);
  assert.equal(decision.wouldBlock, true);
});

test("Q2-017 (§4): the user's strict contract survives into the turn unweakened", async () => {
  const { decision } = await replay({
    candidate: QHO_LLM_ADVERSARIAL.finalCandidate,
    claims: QHO_LLM_ADVERSARIAL.finalClaims
  });
  assert.equal(decision.verificationContract.coverageMode, "ALL_ASSERTIVE_CLAIMS");
  assert.equal(decision.verificationContract.mathematicalClaims, "LEAN_REQUIRED");
  assert.equal(decision.verificationContract.bibliographicIdentity, "PRIMARY_SOURCE_REQUIRED");
});

test("EPI-070/EPI-071 (§7, §11): the rendered proofs are not the checked source", async () => {
  const { decision } = await replay({
    candidate: QHO_LLM_ADVERSARIAL.finalCandidate,
    claims: QHO_LLM_ADVERSARIAL.finalClaims
  });
  const artifacts = decision.formalArtifacts;
  assert.equal(artifacts.length, 3, "three Lean blocks were rendered");

  // The timed-out Mathlib block is published under a proof heading and nothing
  // checked it (EPI-070).
  const superposition = artifacts.find((a) => a.sourceText.includes("token_basis_complete"));
  assert.equal(superposition.renderedAsVerified, true);
  assert.notEqual(superposition.status, "CHECKED_BOUND");

  // The unitary block carries `sorry` (EPI-071).
  const unitary = artifacts.find((a) => a.sourceText.includes("unitary_evolution"));
  assert.equal(unitary.containsSorry, true);
  assert.equal(unitary.status, "INCOMPLETE");

  assert.ok(unboundVerifiedArtifacts(artifacts).length > 0, "at least one unbound verified artifact");
});

test("EPI-069 (§9): the checked toy theorem does not certify the QHO spectrum claim", async () => {
  const { turn } = await replay({
    candidate: QHO_LLM_ADVERSARIAL.finalCandidate,
    claims: QHO_LLM_ADVERSARIAL.finalClaims
  });
  const spectrum = turn.ledger
    .allClaims()
    .find((claim) => /spettro discreto e non degenere|spettro\s+discreto/i.test(claim.text));
  assert.ok(spectrum, "the spectrum claim reached the ledger");
  assert.notEqual(spectrum.status, "VERIFIED");
  assert.ok(
    (spectrum.failureCodes ?? []).some((code) => ["F18", "F27", "F32"].includes(code)),
    `expected a scope/verification failure, got ${JSON.stringify(spectrum.failureCodes)}`
  );
});

test("EPI-074 (§14): the two papers cannot be published as certified and peer-reviewed", () => {
  const claim = QHO_LLM_ADVERSARIAL.finalClaims.find((c) => c.id === "C6");
  const decision = assessBibliographicAuthorization({
    assistantContent: QHO_LLM_ADVERSARIAL.finalCandidate,
    claims: [claim],
    sourceCertificates: QHO_LLM_ADVERSARIAL.sourceEvents
  });
  assert.ok(decision, "an AI-overview mention cannot certify a paper");
  assert.ok(decision.failureCodes.includes("F18"));
});

test("EPI-076 (§17): the closing synthesis outranks every component it names", () => {
  const decision = assessSynthesisAuthorization({
    assistantContent: QHO_LLM_ADVERSARIAL.finalCandidate,
    claims: QHO_LLM_ADVERSARIAL.finalClaims.map((claim) => ({ ...claim, status: "UNKNOWN" }))
  });
  assert.ok(decision, "three pillars over UNKNOWN components must block");
  assert.ok(decision.failureCodes.includes("F33"));
});

test("EPI-075 (§16): the self-detected CCR failure is not erased by the later toy proof", async () => {
  const { turn, decision } = await replay({
    candidate: QHO_LLM_ADVERSARIAL.finalCandidate,
    claims: QHO_LLM_ADVERSARIAL.finalClaims
  });
  assert.equal(decision.allowed, false);

  // The failed ladder run and the passing toy run are in the same turn. The toy
  // pass must not close the debt the failure opened on the QHO claim.
  const spectrum = turn.ledger
    .allClaims()
    .find((claim) => /spettro\s+discreto/i.test(claim.text));
  assert.ok(spectrum, "the spectrum claim reached the ledger");
  const events = turn.ledger.history.events(spectrum.id);
  const challenged = events.filter((event) => event.kind === "CHALLENGED");
  assert.ok(challenged.length > 0, "the formal failure opened challenge debt");
  assert.ok(
    challenged.some((event) => event.origin === "VERIFIER"),
    `expected VERIFIER-origin debt, got ${JSON.stringify(challenged.map((e) => e.origin))}`
  );
  assert.ok(
    spectrum.challengeDebtIds.length > 0 || (spectrum.failureCodes ?? []).includes("F39"),
    "the debt is still open at finalization"
  );
});

test("Q2-017 (§31): the honest repair over the same evidence publishes", async () => {
  const { decision } = await replay({
    candidate: QHO_LLM_ADVERSARIAL.safeRepairCandidate,
    claims: []
  });
  assert.equal(
    decision.allowed,
    true,
    `honest narrowing must publish, blocked with ${decision.code}: ${decision.guidance}`
  );
});

test("Q2-017 (§32): one unbacked factual sentence blocks the same repair", async () => {
  const { decision } = await replay({
    candidate: QHO_LLM_ADVERSARIAL.universalCoverageCandidate,
    claims: []
  });
  assert.equal(decision.allowed, false, "an uncovered assertive span cannot publish in strict mode");
  assert.equal(decision.code, "EPISTEMIC_STRICT_CLAIM_COVERAGE_INCOMPLETE");
});
