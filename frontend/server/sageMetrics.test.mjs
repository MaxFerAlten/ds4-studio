import assert from "node:assert/strict";
import { test } from "node:test";

import { createSageMetrics, sageTransitionEvent } from "./sageMetrics.mjs";

function snap(overrides = {}) {
  return {
    runId: "run-1",
    state: "prepared",
    candidateRevision: 0,
    validatedRevision: null,
    failureClass: null,
    strategyChangeRequired: false,
    terminalReason: null,
    ...overrides
  };
}

test("una transizione che non muove nulla non produce evento", () => {
  assert.equal(sageTransitionEvent(snap(), snap()), null);
});

test("una run senza runId non produce evento", () => {
  assert.equal(sageTransitionEvent(snap(), snap({ runId: null, state: "computed" })), null);
});

test("l'evento porta stato, revisione e reason code, mai il sorgente", () => {
  const event = sageTransitionEvent(
    snap({ state: "validating", candidateRevision: 2 }),
    snap({ state: "repair_required", candidateRevision: 2, failureClass: "math_validation_failed" }),
    "MATHEMATICAL_VALIDATION"
  );
  assert.equal(event.from, "validating");
  assert.equal(event.to, "repair_required");
  assert.equal(event.candidateRevision, 2);
  assert.equal(event.reasonCode, "MATHEMATICAL_VALIDATION");
  assert.equal(event.terminal, false);
  assert.equal(JSON.stringify(event).includes("code"), false);
});

test("una run pubblicabile e una non pubblicabile non si sommano due volte", () => {
  const metrics = createSageMetrics();
  const ready = sageTransitionEvent(
    snap({ state: "validating", candidateRevision: 1 }),
    snap({ state: "ready", candidateRevision: 1, validatedRevision: 1 }),
    "SAGE_PUBLISHABLE"
  );
  metrics.record(ready);
  metrics.record(ready);
  const out = metrics.snapshot();
  assert.equal(out.sage_runs_total, 1);
  assert.equal(out.sage_publishable_total, 1);
  assert.equal(out.sage_not_publishable_total, 0);
});

test("ogni revisione oltre la prima e' una repair, e la rivalidazione si conta", () => {
  const metrics = createSageMetrics();
  metrics.record(sageTransitionEvent(
    snap(), snap({ state: "validation_required", candidateRevision: 1 })
  ));
  metrics.record(sageTransitionEvent(
    snap({ state: "validation_required", candidateRevision: 1 }),
    snap({ state: "validating", candidateRevision: 1 })
  ));
  // Prima validazione della revisione 1: non e' una rivalidazione.
  metrics.record(sageTransitionEvent(
    snap({ state: "validating", candidateRevision: 1 }),
    snap({ state: "repair_required", candidateRevision: 1, failureClass: "math_validation_failed" })
  ));
  metrics.record(sageTransitionEvent(
    snap({ state: "repair_required", candidateRevision: 1 }),
    snap({ state: "validation_required", candidateRevision: 2 })
  ));
  metrics.record(sageTransitionEvent(
    snap({ state: "validation_required", candidateRevision: 2 }),
    snap({ state: "validating", candidateRevision: 2 })
  ));
  // Il candidato riparato viene validato di nuovo: questa lo e'.
  metrics.record(sageTransitionEvent(
    snap({ state: "validating", candidateRevision: 2 }),
    snap({ state: "ready", candidateRevision: 2, validatedRevision: 2 })
  ));

  const out = metrics.snapshot();
  assert.equal(out.sage_candidate_revisions_total, 2);
  assert.equal(out.sage_repair_total, 1);
  assert.equal(out.sage_revalidation_total, 1);
  assert.equal(out.sage_failure_class_total.math_validation_failed, 1);
  assert.equal(out.sage_publishable_total, 1);
});

test("budget esaurito conta come non pubblicabile con la sua causa", () => {
  const metrics = createSageMetrics();
  metrics.record(sageTransitionEvent(
    snap({ state: "repair_required", candidateRevision: 4 }),
    snap({
      state: "budget_exhausted",
      candidateRevision: 4,
      terminalReason: "SAGE_REPAIR_BUDGET_EXHAUSTED"
    })
  ));
  const out = metrics.snapshot();
  assert.equal(out.sage_budget_exhausted_total, 1);
  assert.equal(out.sage_not_publishable_total, 1);
  assert.equal(out.sage_publishable_total, 0);
});

test("i contatori fuori run accettano solo nomi noti", () => {
  const metrics = createSageMetrics();
  metrics.recordOrchestration("sage_premature_finalizations_blocked_total");
  metrics.recordOrchestration("sage_not_a_counter", 99);
  const out = metrics.snapshot();
  assert.equal(out.sage_premature_finalizations_blocked_total, 1);
  assert.equal(out.sage_not_a_counter, undefined);
});
