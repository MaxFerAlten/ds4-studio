/**
 * Fase S0 del piano di orchestrazione autonoma Sage: riproduzione dei difetti.
 *
 * Questi test descrivono il comportamento TARGET. Prima della patch devono
 * fallire — è il gate §4.3 del piano ("non procedere se il test non riproduce
 * il difetto"). Dopo le fasi S1..S3 devono passare senza essere riscritti.
 *
 * Le costanti qui sono lette dalla policy canonica quando esiste; finché non
 * esiste, i test asseriscono soltanto il minimo che il piano richiede (almeno
 * 4 repair, almeno una validate per candidate), così non vanno riscritti al
 * cambio dei numeri.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { SageTurnTracker } from "./sageTurnTracker.mjs";

const REPAIRABLE_VALIDATION_FAILURE = Object.freeze({
  phase: "validate",
  isError: true,
  authoritative: true,
  validationPassed: false,
  publishable: false,
  reportReady: false,
  finalMarkdownReady: false,
  failureClass: "math_validation_failed",
  reasonCodes: ["MATHEMATICAL_VALIDATION"]
});

function computedTracker({ taskType = "symbolic_generic", requiresPlots = false } = {}) {
  const tracker = new SageTurnTracker();
  tracker.begin({ runId: "sage-repro-1", taskType, requiresPlots });
  tracker.recordCall({ phase: "compute" });
  tracker.recordResult({ phase: "compute", isError: false });
  return tracker;
}

test("S0-01 il percorso JS ammette lo stesso numero di repair del nativo", () => {
  const tracker = computedTracker();
  // Il C consente 5 repair, il JS 2: due autorità, due budget. Il target è una
  // sola policy, e la policy consigliata dal piano è 4 repair — ciascuna dopo
  // una validazione fallita, che è l'unico modo in cui una repair ha senso.
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    tracker.recordCall({ phase: "validate" });
    tracker.recordResult({ ...REPAIRABLE_VALIDATION_FAILURE });
    const call = tracker.recordCall({ phase: "repair" });
    assert.equal(call.allowed, true, `repair ${attempt} rifiutato dal tracker JS`);
    tracker.recordResult({ phase: "repair", isError: false });
  }
});

test("S0-02 dopo una repair il candidate può essere validato di nuovo", () => {
  const tracker = computedTracker();
  tracker.recordCall({ phase: "validate" });
  tracker.recordResult({ ...REPAIRABLE_VALIDATION_FAILURE });

  const repair = tracker.recordCall({ phase: "repair" });
  assert.equal(repair.allowed, true, "repair non ammessa dopo validazione fallita");
  tracker.recordResult({ phase: "repair", isError: false });

  const revalidate = tracker.recordCall({ phase: "validate" });
  assert.equal(revalidate.allowed, true, "seconda validate bloccata dal budget a 1");
});

test("S0-03 una validazione matematica fallita è riparabile, non terminale", () => {
  const tracker = computedTracker();
  tracker.recordCall({ phase: "validate" });
  const snapshot = tracker.recordResult({ ...REPAIRABLE_VALIDATION_FAILURE });

  assert.equal(snapshot.failed, false, "la validazione fallita ha chiuso il turno");
  assert.equal(snapshot.state, "repair_required");
});

test("S0-06 uno studio di funzione con un solo plot chiede il plot mancante", () => {
  const tracker = new SageTurnTracker();
  tracker.begin({ runId: "sage-repro-2", taskType: "function_study", requiresPlots: true });
  tracker.recordCall({ phase: "compute" });
  tracker.recordResult({ phase: "compute", isError: false });
  tracker.recordCall({ phase: "validate" });

  // Matematica e KaTeX validate, ma il bridge ha prodotto un solo artefatto.
  const snapshot = tracker.recordResult({
    phase: "validate",
    isError: false,
    authoritative: true,
    validationPassed: true,
    publishable: false,
    reportReady: true,
    finalMarkdownReady: false,
    artifactKinds: ["function_plot"],
    failureClass: "artifact_missing",
    reasonCodes: ["SAGE_ARTIFACT_MISSING:first_derivative_plot"]
  });

  assert.equal(snapshot.failed, false, "artefatti incompleti hanno chiuso il turno");
  assert.equal(snapshot.state, "plot_required");
  assert.equal(tracker.canRun({ phase: "plot" }), true);
});

test("S0-10 la prosa prematura non termina il turno al secondo episodio", () => {
  const tracker = computedTracker();
  const first = tracker.recordPrematureFinalization();
  assert.equal(first.retryAllowed, true);
  const second = tracker.recordPrematureFinalization();
  assert.equal(second.retryAllowed, true, "secondo episodio già terminale");
});
