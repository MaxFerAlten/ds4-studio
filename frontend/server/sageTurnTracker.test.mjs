import assert from "node:assert/strict";
import { test } from "node:test";

import { SageTurnTracker } from "./sageTurnTracker.mjs";
import { resolveSageOrchestrationConfig } from "./sageOrchestrationConfig.mjs";

const POLICY = resolveSageOrchestrationConfig({}, {});

function begin(taskType = "solve", options = {}) {
  const tracker = new SageTurnTracker();
  tracker.begin({ runId: "run-1", taskType, ...options });
  return tracker;
}

function compute(tracker, { isError = false } = {}) {
  assert.equal(tracker.recordCall({ phase: "compute" }).allowed, true);
  return tracker.recordResult({ phase: "compute", isError });
}

function validateFailure(tracker, overrides = {}) {
  assert.equal(tracker.recordCall({ phase: "validate" }).allowed, true);
  return tracker.recordResult({
    phase: "validate",
    isError: true,
    authoritative: true,
    validationPassed: false,
    publishable: false,
    reportReady: false,
    finalMarkdownReady: false,
    reasonCodes: ["FIRST_DERIVATIVE_EQUIVALENT"],
    ...overrides
  });
}

function validateReady(tracker, overrides = {}) {
  assert.equal(tracker.recordCall({ phase: "validate" }).allowed, true);
  return tracker.recordResult({
    phase: "validate",
    isError: false,
    authoritative: true,
    validationPassed: true,
    publishable: true,
    reportReady: true,
    finalMarkdownReady: true,
    ...overrides
  });
}

function repair(tracker, { isError = false, code } = {}) {
  const call = tracker.recordCall({ phase: "repair", codeSha256: code });
  assert.equal(call.allowed, true, `repair rifiutata: ${call.code}`);
  return tracker.recordResult({ phase: "repair", isError });
}

const ALL_PLOTS = ["function_plot", "first_derivative_plot", "second_derivative_plot"];

test("S-TRACK-01 un compute riuscito chiede la validazione", () => {
  const tracker = begin();
  const snapshot = compute(tracker);
  assert.equal(snapshot.state, "validation_required");
  assert.equal(snapshot.candidateRevision, 1);
  assert.equal(snapshot.requiredNextPhase, "validate");
});

test("S-TRACK-02 una validazione fallita riparabile chiede una repair", () => {
  const tracker = begin();
  compute(tracker);
  const snapshot = validateFailure(tracker);
  assert.equal(snapshot.state, "repair_required");
  assert.equal(snapshot.terminal, false);
  assert.equal(snapshot.failureClass, "math_validation_failed");
});

test("S-TRACK-03 una repair riporta il turno alla validazione", () => {
  const tracker = begin();
  compute(tracker);
  validateFailure(tracker);
  const snapshot = repair(tracker);
  assert.equal(snapshot.state, "validation_required");
  assert.equal(snapshot.candidateRevision, 2);
});

test("S-TRACK-04 la seconda validate e' consentita", () => {
  const tracker = begin();
  compute(tracker);
  validateFailure(tracker);
  repair(tracker);
  assert.equal(tracker.canRun({ phase: "validate" }), true);
  const snapshot = validateReady(tracker);
  assert.equal(snapshot.state, "ready");
  assert.equal(snapshot.validationCount, 2);
});

test("S-TRACK-05 ready richiede che la revisione validata sia quella corrente", () => {
  const tracker = begin();
  compute(tracker);
  validateReady(tracker);
  assert.equal(tracker.canFinalize(), true);
  const snapshot = tracker.snapshot();
  assert.equal(snapshot.validatedRevision, snapshot.candidateRevision);
});

test("S-TRACK-06 artefatti mancanti chiedono la fase plot, non la fine", () => {
  const tracker = begin("function_study", { requiresPlots: true });
  compute(tracker);
  const snapshot = validateReady(tracker, { artifactKinds: ["function_plot"] });
  assert.equal(snapshot.state, "plot_required");
  assert.equal(snapshot.terminal, false);
  assert.equal(tracker.canFinalize(), false);
  assert.equal(tracker.canRun({ phase: "plot" }), true);

  tracker.recordCall({ phase: "plot" });
  const done = tracker.recordResult({ phase: "plot", artifactKinds: ALL_PLOTS });
  assert.equal(done.state, "ready");
  assert.equal(tracker.canFinalize(), true);
});

test("S-TRACK-07 un task generico non richiede plot", () => {
  const tracker = begin("evaluate");
  compute(tracker);
  const snapshot = validateReady(tracker);
  assert.equal(snapshot.requiresPlots, false);
  assert.equal(snapshot.state, "ready");
  assert.equal(snapshot.completed, true);
});

test("S-TRACK-08 lo stesso fingerprint due volte impone il cambio di strategia", () => {
  const tracker = begin();
  compute(tracker);
  validateFailure(tracker);
  assert.equal(tracker.snapshot().strategyChangeRequired, false);
  repair(tracker, { code: "revision-2" });
  const snapshot = validateFailure(tracker);
  assert.equal(snapshot.strategyChangeRequired, true);
  assert.match(tracker.nextDecision().nextAction, /change mathematical strategy/);
});

test("S-TRACK-09 un blocco infrastrutturale e' terminale e non pubblica nulla", () => {
  const tracker = begin();
  compute(tracker);
  tracker.recordCall({ phase: "validate" });
  const snapshot = tracker.recordResult({
    phase: "validate",
    result: {
      isError: true,
      publishable: false,
      debug: { bridgeError: "VALIDATOR_UNAVAILABLE" },
      sageResult: { execution: { ok: false, exitCode: null, timedOut: false } }
    }
  });
  assert.equal(snapshot.state, "infrastructure_block");
  assert.equal(snapshot.terminal, true);
  assert.equal(tracker.canFinalize(), false);
  assert.equal(tracker.mustContinue(), false);
  assert.match(tracker.terminalNotice(), /NOT_PUBLISHABLE/);
});

test("S-TRACK-10 la prosa prematura non termina il turno al secondo episodio", () => {
  const tracker = begin();
  compute(tracker);
  for (let episode = 1; episode <= POLICY.maxPrematureFinalizations; episode += 1) {
    const blocked = tracker.recordPrematureFinalization();
    assert.equal(blocked.retryAllowed, true, `episodio ${episode} gia' terminale`);
    assert.match(blocked.guidance, /SAGE_ORCHESTRATION/);
    assert.match(blocked.guidance, /FINALIZATION_ALLOWED=false/);
  }
  const last = tracker.recordPrematureFinalization();
  assert.equal(last.retryAllowed, false);
  assert.equal(tracker.snapshot().state, "budget_exhausted");
  assert.equal(tracker.isTerminal(), true);
});

test("la fase e' deterministica: una fase diversa viene rifiutata con l'istruzione", () => {
  const tracker = begin("function_study");
  compute(tracker);
  const call = tracker.recordCall({ phase: "plot" });
  assert.equal(call.allowed, false);
  assert.equal(call.code, "SAGE_PHASE_TRANSITION_INVALID");
  assert.equal(call.requiredNextPhase, "validate");
});

test("validate prima di compute e' bloccata", () => {
  const tracker = begin();
  assert.equal(tracker.canRun({ phase: "validate" }), false);
  assert.equal(tracker.recordCall({ phase: "validate" }).allowed, false);
});

test("compute dopo validate e' bloccato", () => {
  const tracker = begin();
  compute(tracker);
  validateReady(tracker);
  assert.equal(tracker.recordCall({ phase: "compute" }).allowed, false);
});

test("una validazione non autorevole non puo' pubblicare", () => {
  const tracker = begin();
  compute(tracker);
  const snapshot = validateReady(tracker, { authoritative: false });
  assert.equal(snapshot.state, "failed_non_retryable");
  assert.equal(snapshot.terminalReason, "SAGE_PUBLISHABLE_INVARIANT_VIOLATION");
  assert.equal(tracker.canFinalize(), false);
});

test("un markdown finale assente non puo' pubblicare", () => {
  const tracker = begin();
  compute(tracker);
  validateReady(tracker, { finalMarkdownReady: false });
  assert.equal(tracker.canFinalize(), false);
});

test("il budget delle repair viene dalla policy, non da un letterale", () => {
  const tracker = begin();
  compute(tracker);
  for (let attempt = 1; attempt <= POLICY.maxRepairAttempts; attempt += 1) {
    validateFailure(tracker);
    const call = tracker.recordCall({ phase: "repair", codeSha256: `rev-${attempt}` });
    assert.equal(call.allowed, true, `repair ${attempt} rifiutata`);
    tracker.recordResult({ phase: "repair", isError: false });
  }
  const snapshot = validateFailure(tracker);
  assert.equal(snapshot.state, "budget_exhausted");
  assert.equal(snapshot.terminalReason, "SAGE_REPAIR_BUDGET_EXHAUSTED");
});

test("una repair identica alla precedente viene rifiutata e non consuma tentativi", () => {
  const tracker = begin();
  compute(tracker);
  validateFailure(tracker);
  const first = tracker.recordCall({ phase: "repair", codeSha256: "same" });
  assert.equal(first.allowed, true);
  tracker.recordResult({ phase: "repair", isError: false });
  validateFailure(tracker);

  const repeated = tracker.recordCall({ phase: "repair", codeSha256: "same" });
  assert.equal(repeated.allowed, false);
  assert.equal(repeated.code, "SAGE_CANDIDATE_UNCHANGED");
  assert.equal(tracker.snapshot().repairCount, 1, "il rifiuto ha consumato un tentativo");
});

test("insistere con la stessa sorgente termina invece di ciclare", () => {
  const tracker = begin();
  compute(tracker);
  validateFailure(tracker);
  tracker.recordCall({ phase: "repair", codeSha256: "same" });
  tracker.recordResult({ phase: "repair", isError: false });
  validateFailure(tracker);
  for (let attempt = 0; attempt <= POLICY.maxPrematureFinalizations; attempt += 1) {
    tracker.recordCall({ phase: "repair", codeSha256: "same" });
  }
  assert.equal(tracker.snapshot().state, "budget_exhausted");
  assert.equal(tracker.snapshot().terminalReason, "SAGE_CANDIDATE_UNCHANGED_BUDGET_EXHAUSTED");
});

test("il tetto di chiamate totali chiude il turno", () => {
  const tracker = begin();
  tracker.totalCallCount = POLICY.maxTotalToolCalls;
  const call = tracker.recordCall({ phase: "compute" });
  assert.equal(call.allowed, false);
  assert.equal(call.code, "SAGE_TOTAL_CALL_BUDGET_EXHAUSTED");
  assert.equal(tracker.isTerminal(), true);
});

test("il wall clock esaurito chiude il turno", () => {
  const tracker = begin();
  tracker.startedAt = Date.now() - POLICY.maxWallClockMs - 1;
  const call = tracker.recordCall({ phase: "compute" });
  assert.equal(call.allowed, false);
  assert.equal(call.code, "SAGE_WALL_CLOCK_EXHAUSTED");
});

test("uno stato terminale rifiuta ogni fase successiva", () => {
  const tracker = begin();
  tracker.fail("SAGE_EXECUTION_FAILED");
  for (const phase of ["compute", "repair", "validate", "plot"]) {
    assert.equal(tracker.canRun({ phase }), false);
  }
  assert.equal(tracker.mustContinue(), false);
});

test("reset azzera stato, budget, pubblicazione e blocchi", () => {
  const tracker = begin();
  compute(tracker);
  tracker.recordPrematureFinalization();
  tracker.reset();
  const snapshot = tracker.snapshot();
  assert.equal(snapshot.state, "idle");
  assert.equal(snapshot.runId, null);
  assert.equal(snapshot.executeCount, 0);
  assert.equal(snapshot.computeCount, 0);
  assert.equal(snapshot.validationCount, 0);
  assert.equal(snapshot.candidateRevision, 0);
  assert.equal(snapshot.publishable, false);
  assert.equal(snapshot.blockedFinalizations, 0);
  assert.deepEqual(snapshot.artifactKinds, []);
});

test("lo stato Sage non blocca l'esecuzione di altri tool", async () => {
  const tracker = begin();
  tracker.fail("SAGE_FINALIZATION_BLOCKED");
  const executeGenericTool = async () => ({ content: "ok", isError: false });
  assert.deepEqual(await executeGenericTool(), { content: "ok", isError: false });
  assert.equal(tracker.canRun({ phase: "compute" }), false);
});

test("nextDecision espone il budget residuo e la fase richiesta", () => {
  const tracker = begin("function_study");
  compute(tracker);
  const decision = tracker.nextDecision();
  assert.equal(decision.requiredNextPhase, "validate");
  assert.equal(decision.mustContinue, true);
  assert.equal(decision.terminal, false);
  assert.equal(decision.attemptsRemaining.repair, POLICY.maxRepairAttempts);
  assert.equal(decision.attemptsRemaining.validate, POLICY.maxValidationAttempts);
  assert.deepEqual(decision.missingArtifactKinds, ALL_PLOTS);
});

test("§26 il rollback ferma l'orchestrazione autonoma ma non apre il gate", () => {
  const rolledBack = resolveSageOrchestrationConfig(
    { DS4_SAGE_AUTONOMOUS_ORCHESTRATION: "0" },
    {}
  );
  assert.equal(rolledBack.enabled, false);

  const tracker = new SageTurnTracker(rolledBack);
  tracker.begin({ runId: "run-rollback", taskType: "solve" });
  assert.equal(tracker.recordCall({ phase: "compute" }).allowed, true);
  tracker.recordResult({ phase: "compute", isError: true });

  // Il runtime non pretende piu' la fase successiva...
  assert.equal(tracker.mustContinue(), false);
  // ...ma un candidato non validato resta non pubblicabile.
  assert.equal(tracker.canFinalize(), false);
  assert.equal(tracker.snapshot().publishable, false);
});
