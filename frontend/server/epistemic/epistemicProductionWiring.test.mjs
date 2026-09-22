import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { CLAIM_EVENT_KIND, ClaimHistory } from "./epistemicClaimHistory.mjs";
import { createClaim, EpistemicLedger } from "./epistemicLedger.mjs";
import { EpistemicSessionLedger } from "./epistemicSessionLedger.mjs";
import { MATH_CHECK_MARKER } from "./epistemicMathVerifier.mjs";
import {
  createVerifierBudget,
  dispatchClaimVerifiers
} from "./epistemicVerifierDispatcher.mjs";
import {
  REPAIR_NEXT,
  REPAIR_STATUS,
  evaluateRepairTransition
} from "./epistemicRepairPolicy.mjs";
import { SEVERITY } from "./epistemicContracts.mjs";

const source = await readFile(new URL("../index.mjs", import.meta.url), "utf8");

test("the production caller passes every epistemic verification dependency", () => {
  const evaluationPosition = source.indexOf("const epistemicEvaluation");
  const position = source.indexOf("evaluateEpistemicTurn", evaluationPosition);
  assert.ok(position >= 0);
  const call = source.slice(position, position + 1400);
  for (const field of [
    "client",
    "assistantReasoning",
    "executeSage",
    "citationProviders",
    "sourceContext",
    "sessionLedger"
  ]) {
    // The caller passes shorthand (no colon) when the variable matches the
    // parameter name (assistantContent, assistantReasoning) and explicit
    // `name: value` otherwise; accept either form.
    assert.match(
      call,
      new RegExp(`${field}\\s*(:|,)`),
      `missing production dependency ${field}`
    );
  }
  assert.match(call, /epistemicShadowMode\s*\?\s*null\s*:\s*await epistemicEvaluation/);
  assert.match(source, /observeEpistemicShadow\s*\(/);
});

test("the epistemic model client reuses the active backend and loaded model", () => {
  const position = source.indexOf("function createEpistemicStructuredClient");
  assert.ok(position >= 0);
  const factory = source.slice(position, position + 600);
  assert.match(factory, /backendBase\s*\(\s*\)/);
  assert.match(factory, /activeRequestDefaults\.model/);
  assert.match(factory, /new StructuredModelClient/);
  assert.match(factory, /think:\s*false/);
});

test("the Sage adapter returns executeTool's structured result unchanged", () => {
  const position = source.indexOf("const epistemicSageExecutor");
  assert.ok(position >= 0);
  const adapter = source.slice(position, position + 700);
  assert.match(adapter, /executeTool\s*\(\s*["']sage["']/);
  assert.doesNotMatch(adapter, /JSON\.stringify|String\s*\(/);
  assert.match(adapter, /sageWorkdir/);
});

test("citation verification reuses the research provider instances", () => {
  const position = source.indexOf("function currentEpistemicCitationProviders");
  assert.ok(position >= 0);
  const adapter = source.slice(position, position + 500);
  assert.match(adapter, /agentResearchService\?\.providers\?\.arxiv/);
  assert.match(adapter, /agentResearchService\?\.providers\?\.openalex/);
});

test("the production session lifecycle stages, discards or commits before chat commit", () => {
  for (const method of ["beginTurn", "stageClaims", "discardCandidate", "commitClaims"]) {
    assert.match(
      source,
      new RegExp(`agentSession\\.epistemic\\.${method}\\s*\\(`),
      `missing session lifecycle method ${method}`
    );
  }
  const epistemicCommit = source.indexOf("agentSession.epistemic.commitClaims");
  const chatCommit = source.indexOf("agentSession.commit(modeChoice.pending", epistemicCommit);
  assert.ok(epistemicCommit >= 0 && chatCommit > epistemicCommit);
});

test("accepted publication order is epistemic commit, chat commit, then buffer flush", () => {
  const epistemicCommit = source.indexOf("agentSession.epistemic.commitClaims");
  const chatCommit = source.indexOf("agentSession.commit(modeChoice.pending", epistemicCommit);
  const bufferFlush = source.indexOf("deferredAssistantText.flush", chatCommit);
  assert.ok(epistemicCommit >= 0);
  assert.ok(chatCommit > epistemicCommit);
  assert.ok(bufferFlush > chatCommit);
});

test("production records compact epistemic telemetry for every decision", () => {
  assert.match(source, /createEpistemicTelemetry\s*\(\s*\)/);
  const position = source.indexOf(
    "epistemicTelemetry.record",
    source.indexOf("const epistemicDecision")
  );
  assert.ok(position >= 0);
  const record = source.slice(position, position + 900);
  assert.match(record, /\bdecision\s*,/);
  assert.match(record, /claims:\s*epistemicTurn\.ledger\.allClaims\(\)/);
  assert.match(record, /sessionRepromotionBlocks/);
});

test("REM-007/008: index.mjs imports and invokes the shared repair transition", () => {
  // Import presence is what a source regex is for; the state machine itself is
  // verified behaviorally in the evaluateRepairTransition tests below.
  assert.match(source, /evaluateRepairTransition[\s\S]{0,40}from\s*["']\.\/epistemic\/epistemicRepairPolicy\.mjs["']/);
  const position = source.indexOf("evaluateRepairTransition({");
  assert.ok(position >= 0, "the production blocked path calls evaluateRepairTransition");
  const block = source.slice(position, position + 1800);
  assert.match(block, /repairState\.policy/);
  assert.match(block, /finish_reason:\s*["']epistemic_blocked["']/);
  assert.match(block, /beginRepair\s*\(\s*\)/);
  assert.doesNotMatch(source, /if\s*\(\s*!epistemicTurn\.canRepair\(\)\s*\)/);
});

test("REM-008.5: evaluateRepairTransition REQUIRED -> repair, carrying policy state", () => {
  const claimState = createClaim({
    text: "broad claim with open debt",
    status: "UNKNOWN",
    challengeDebtIds: ["ch1"]
  });
  claimState.failureCodes = ["F39"];
  claimState.severity = SEVERITY.HIGH;
  const transition = evaluateRepairTransition({
    claims: [claimState],
    config: { maxRepairRounds: 3 }
  });
  assert.equal(transition.next, REPAIR_NEXT.REPAIR);
  assert.equal(transition.status, REPAIR_STATUS.REQUIRED);
  assert.match(transition.decision.guidance, /EPISTEMIC_REPAIR_REQUIRED|EPISTEMIC_REPAIR_CANNOT_PARAPHRASE|EPISTEMIC_REPAIR_EXHAUSTED/);
  // the decision is the policy state carried into the next round
  const again = evaluateRepairTransition({
    claims: [claimState],
    previous: transition.decision,
    config: { maxRepairRounds: 3 }
  });
  assert.equal(again.status, REPAIR_STATUS.REQUIRED);
  assert.equal(again.decision.repairId, transition.decision.repairId);
});

test("REM-008.5: the same semantic failure exhausts the transition to a terminal block", () => {
  const claimState = createClaim({
    text: "broad claim with open debt",
    status: "UNKNOWN",
    challengeDebtIds: ["ch1"]
  });
  claimState.failureCodes = ["F39"];
  const t1 = evaluateRepairTransition({ claims: [claimState], config: { maxRepairRounds: 2 } });
  assert.equal(t1.next, REPAIR_NEXT.REPAIR, "first offering is repairable");
  const t2 = evaluateRepairTransition({ claims: [claimState], previous: t1.decision, config: { maxRepairRounds: 2 } });
  // round-bound exhaustion: the promise of repair is spent after 2 rounds
  const t3 = evaluateRepairTransition({ claims: [claimState], previous: t2.decision, config: { maxRepairRounds: 2 } });
  assert.equal(t3.next, REPAIR_NEXT.EXHAUSTED);
  assert.equal(t3.status, REPAIR_STATUS.EXHAUSTED);
});

test("REM-008.5: NOT_REQUIRED while blocked is an incoherent terminal block, not a loop", () => {
  const transition = evaluateRepairTransition({
    claims: [createClaim({ text: "clean claim", status: "UNKNOWN", challengeDebtIds: [] })]
  });
  // a blocked turn that the policy sees as clean cannot be repaired; fail safe
  assert.equal(transition.next, REPAIR_NEXT.BLOCKED);
});

test("VERIFY-WIRE (R02): the dispatcher orders plan, results, certificate, scope and reconciliation", async () => {
  const out = await dispatchClaimVerifiers({
    claim: {
      id: "C1",
      text: "sqrt(4) = 2",
      verificationRequirements: ["math_verification"],
      expectedCertificateScope: { requiredProperties: ["math_verification"] }
    },
    executeSage: async () => ({
      content: `${MATH_CHECK_MARKER}: PASS`,
      isError: false,
      runId: "run_1",
      sageResult: {
        status: "ok",
        state: "validated",
        runId: "run_1",
        execution: { ok: true, timedOut: false, exitCode: 0 }
      }
    }),
    budget: createVerifierBudget(1)
  });
  // plan stage: checks predeclared with stable ids
  assert.ok(out.verificationPlan, "a verification plan exists");
  const planCheckIds = new Set(out.verificationPlan.checks.map((c) => c.id));
  assert.ok(planCheckIds.size > 0, "the plan predeclares checks");
  // result stage: every result checkId originates in the plan
  assert.ok(out.results.length > 0, "verifier produced results");
  for (const result of out.results) {
    assert.ok(planCheckIds.has(result.checkId), `result checkId ${result.checkId} originates in the plan`);
  }
  // certificate stage: the result carries a claim-bound certificate
  const cert = out.results[0].certificate;
  assert.ok(cert, "result carries a certificate");
  assert.equal(cert.claimId, "C1");
  assert.ok(cert.id, "certificate has a stable id");
  // scope stage: PASS is evaluated against the declared expected scope
  assert.ok(out.results[0].scope, "result carries a scope evaluation");
  assert.ok(typeof out.results[0].scope.status === "string");
  // reconciliation stage: the plan is reconciled against the executed results
  assert.ok(out.planReconciliation, "plan reconciliation is produced");
  assert.ok(Number.isFinite(out.planReconciliation.coverage));
});

test("VERIFY-WIRE (R04): the finalization gate imports claim-bound authorization", async () => {
  // import presence only — authorization behaviour is covered by the
  // AUTHOR-* / R04-FINGATE behavioral suites.
  const gate = await readFile(
    new URL("./epistemicFinalizationGate.mjs", import.meta.url),
    "utf8"
  );
  assert.match(gate, /epistemicVerificationClaimAuthorization\.mjs/);
  assert.match(gate, /assessVerificationAuthorization\s*\(/);

  const authz = await readFile(
    new URL("./epistemicVerificationClaimAuthorization.mjs", import.meta.url),
    "utf8"
  );
  assert.match(authz, /ASSERTION_LEVEL/);
  assert.match(authz, /PROTECTED_VERIFICATION_PHRASES/);
  assert.match(authz, /EPISTEMIC_VERIFICATION_LANGUAGE_UNAUTHORIZED/);
});

test("REM-005.3: the ledger exposes a read-only historySnapshot() with events(claimId)", () => {
  const ledger = new EpistemicLedger();
  const claim = createClaim({ text: "x", status: "UNKNOWN", challengeDebtIds: [] });
  ledger.addClaim(claim);

  ledger.history.append({
    kind: CLAIM_EVENT_KIND.CHALLENGED,
    claimId: claim.id,
    challengeId: "ch1",
    origin: "self",
    severity: 4,
    evidenceIds: []
  });

  const snapshot = ledger.historySnapshot();
  const events = snapshot.events(claim.id);
  assert.ok(Array.isArray(events));
  assert.equal(events.filter((event) => event.kind === CLAIM_EVENT_KIND.CHALLENGED).length, 1);
  assert.equal(events[events.length - 1].kind, CLAIM_EVENT_KIND.CHALLENGED);
  // The snapshot is read-only and returns a fresh copy each call.
  snapshot.events(claim.id).push({ kind: "X" });
  assert.equal(snapshot.events(claim.id).length, events.length);
});

test("REM-005.4: staging with history persists a CHALLENGED event into the session", () => {
  const ledger = new EpistemicLedger();
  const claim = createClaim({ text: "x", status: "UNKNOWN", challengeDebtIds: ["ch1"] });
  ledger.addClaim(claim);
  ledger.history.append({
    kind: CLAIM_EVENT_KIND.CHALLENGED,
    claimId: claim.id,
    challengeId: "ch1",
    origin: "self",
    severity: 4,
    evidenceIds: []
  });

  const session = new EpistemicSessionLedger();
  session.stageClaims(ledger.allClaims(), { history: ledger.historySnapshot() });

  const sessionEvents = session.events.get(claim.id) ?? [];
  assert.ok(sessionEvents.some((event) => event.kind === CLAIM_EVENT_KIND.CHALLENGED),
    `expected CHALLENGED in session events, got ${JSON.stringify(sessionEvents)}`);
  // Raw reasoning is never persisted (REM-005.6).
  const event = sessionEvents.find((event) => event.kind === CLAIM_EVENT_KIND.CHALLENGED);
  assert.equal(event.reasoning, undefined);
});

test("REM-005.1/5: production stageClaims hands the history snapshot to the session", async () => {
  const index = await readFile(new URL("../index.mjs", import.meta.url), "utf8");
  const position = index.indexOf("agentSession.epistemic.stageClaims(epistemicTurn.ledger.allClaims()");
  assert.ok(position >= 0, "stageClaims is still called with the claim list");
  const call = index.slice(position, position + 260);
  assert.match(call, /history:\s*epistemicTurn\.ledger\.historySnapshot\(\)/);
});

test("Q2-008: tool results reach the turn, so lean_check runs are audited in production", () => {
  // epistemicTurn.addToolResult delegates to the same TurnEvidence AND records
  // the Lean assumption/scope audit. Recording straight onto turn.evidence skips
  // that audit, which silently disables §30/§35/§48 in the live path.
  const position = source.indexOf("addToolResult({");
  assert.ok(position >= 0, "the production caller records no tool results");
  const preamble = source.slice(Math.max(0, position - 120), position);
  assert.match(
    preamble,
    /epistemicTurn\.$/,
    "tool results must be recorded through epistemicTurn.addToolResult, not turn.evidence"
  );
  assert.equal(
    source.includes("epistemicEvidence.addToolResult("),
    false,
    "no caller may bypass the turn's Lean audit"
  );
});
