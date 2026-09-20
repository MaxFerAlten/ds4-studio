// End-to-end regression for the autonomous Sage orchestration (§21 del piano).
//
// One user message per scenario. What is stubbed is the Python bridge — the
// process that would run SageMath — and nothing else: the real publication
// gate, the real artifact validator, the real failure classifier and the real
// SageTurnTracker decide every step. Every "may I answer now" question is asked
// of the same tracker the agent loop uses, so a regression that lets a
// candidate through before the gate fails here.
//
// The four scenarios are the ones the plan requires: an algebraic task that
// needs two repairs, a function study whose plot package arrives incomplete, a
// missing validator, and a model that keeps writing prose while a phase is
// still owed.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";

import { executeAuthoritativeSage } from "./sageAuthoritativeExecutor.mjs";
import { normalizeSageOrchestratorPayload } from "./sageOrchestratorBridge.mjs";
import { createSageMetrics, sageTransitionEvent } from "./sageMetrics.mjs";
import { guardSageFinalization } from "./sageAgentLoopPolicy.mjs";
import { SageTurnTracker, sha256Hex } from "./sageTurnTracker.mjs";

// The formatter turns a normalized report into the user-facing document. It is
// presentation, not decision, so a fixed rendering keeps the test about the
// orchestration.
const FORMATTER = () => "## Risultato\n\n$x = 1$\n";

function artifactFor(runId, kind, index) {
  const sha256 = createHash("sha256").update(`${runId}:${kind}`).digest("hex");
  const artifactId = `sha256:${sha256}`;
  return {
    kind,
    name: `${kind}.png`,
    runId,
    sha256,
    artifactId,
    sizeBytes: 1024 + index,
    url: `/api/sage/artifacts/${encodeURIComponent(runId)}/${encodeURIComponent(artifactId)}`
  };
}

/**
 * Build what the Python bridge would return, then normalize it with the real
 * normalizer — a payload this test invented but the bridge would reject is not
 * evidence of anything.
 */
function bridgePayload({
  ok = true,
  passed = null,
  errors = [],
  artifacts = [],
  content = "runtime document"
} = {}) {
  return normalizeSageOrchestratorPayload({
    content,
    isError: !ok,
    candidateReport: { kind: "math_report", title: "Candidate", sections: [] },
    execution: { ok, exitCode: ok ? 0 : 1, timedOut: false },
    validationEvidence: passed === null
      ? null
      : {
          source: "sage_runtime_validator",
          authoritative: true,
          passed,
          checks: [{ code: "EXACT", passed }],
          errors,
          normalizedReport: { kind: "math_report", authority: "runtime" }
        },
    artifacts
  });
}

/**
 * One tool call, exactly as the agent loop performs it: authorise the phase,
 * run it, record the outcome, emit the audit transition.
 */
async function sageCall(context, { phase, code, payload, validator }) {
  const { tracker, taskType, runId, metrics } = context;
  const before = tracker.snapshot();
  const gate = tracker.beforeCall({ phase, codeSha256: sha256Hex(code) });
  if (!gate.allowed) {
    metrics?.record(sageTransitionEvent(before, tracker.snapshot(), gate.code));
    return { allowed: false, gate, result: null };
  }

  const result = await executeAuthoritativeSage(
    { code, task_type: taskType, phase },
    {
      rawExecutor: async () => {
        throw new Error("the bridge must be used, not the legacy executor");
      },
      sageV2EnabledFn: () => true,
      authoritativeLoopEnabledFn: () => true,
      bridgeExecutor: async () => payload,
      runId,
      phase,
      formatter: FORMATTER,
      ...(validator === undefined ? {} : { validator })
    }
  );

  const beforeResult = tracker.snapshot();
  tracker.recordResult({ phase, result });
  metrics?.record(sageTransitionEvent(beforeResult, tracker.snapshot(), `PHASE_${phase.toUpperCase()}`));
  return { allowed: true, gate, result };
}

function newContext(taskType, runId) {
  return {
    tracker: new SageTurnTracker(),
    taskType,
    runId,
    metrics: createSageMetrics()
  };
}

test("§21.1 un solo messaggio utente porta un compito algebrico a pubblicazione dopo due riparazioni", async () => {
  const context = newContext("solve", "run-algebraic");
  context.tracker.begin({ runId: context.runId, taskType: context.taskType });

  const userMessages = ["Risolvi l'equazione con Sage"];

  // compute: il candidato non gira nemmeno.
  const compute = await sageCall(context, {
    phase: "compute",
    code: "solve(x^2 - 1 == 0, x",
    payload: bridgePayload({ ok: false, content: "SyntaxError" })
  });
  assert.equal(compute.allowed, true);
  assert.equal(context.tracker.snapshot().state, "repair_required");
  assert.equal(context.tracker.snapshot().candidateRevision, 1);
  assert.equal(context.tracker.canFinalize(), false);

  // repair -> revisione 2.
  await sageCall(context, {
    phase: "repair",
    code: "solve(x^2 - 1 == 0, x)",
    payload: bridgePayload({ ok: true })
  });
  assert.equal(context.tracker.snapshot().candidateRevision, 2);
  assert.equal(context.tracker.snapshot().requiredNextPhase, "validate");

  // validate: la matematica non regge. È una riparazione, non la fine.
  await sageCall(context, {
    phase: "validate",
    code: "solve(x^2 - 1 == 0, x)",
    payload: bridgePayload({ ok: true, passed: false, errors: ["MATHEMATICAL_VALIDATION"] })
  });
  const afterFailedValidation = context.tracker.snapshot();
  assert.equal(afterFailedValidation.state, "repair_required");
  assert.equal(afterFailedValidation.failureClass, "math_validation_failed");
  assert.equal(context.tracker.mustContinue(), true);
  assert.equal(context.tracker.canFinalize(), false);

  // repair -> revisione 3, e la revisione riparata va rivalidata.
  await sageCall(context, {
    phase: "repair",
    code: "solve(x^2 - 1 == 0, x, to_poly_solve=True)",
    payload: bridgePayload({ ok: true })
  });
  assert.equal(context.tracker.snapshot().candidateRevision, 3);
  assert.equal(context.tracker.snapshot().requiredNextPhase, "validate");

  // validate: passa. Solo ora esiste un risultato pubblicabile.
  const published = await sageCall(context, {
    phase: "validate",
    code: "solve(x^2 - 1 == 0, x, to_poly_solve=True)",
    payload: bridgePayload({ ok: true, passed: true })
  });

  const final = context.tracker.snapshot();
  assert.equal(final.state, "ready");
  assert.equal(final.validatedRevision, 3);
  assert.equal(final.candidateRevision, 3);
  assert.equal(context.tracker.canFinalize(), true);
  assert.equal(guardSageFinalization(context.tracker).blocked, false);

  assert.equal(published.result.publishable, true);
  assert.equal(published.result.authoritative, true);
  assert.equal(published.result.validationPassed, true);
  assert.match(published.result.finalMarkdown, /Risultato/);

  // Un solo messaggio utente: il loop non ne ha mai chiesto un secondo.
  assert.equal(userMessages.length, 1);
  assert.equal(final.computeCount, 1);
  assert.equal(final.repairCount, 2);
  assert.equal(final.validationCount, 2);

  const metrics = context.metrics.snapshot();
  assert.equal(metrics.sage_runs_total, 1);
  assert.equal(metrics.sage_publishable_total, 1);
  assert.equal(metrics.sage_not_publishable_total, 0);
  assert.equal(metrics.sage_candidate_revisions_total, 3);
  assert.equal(metrics.sage_repair_total, 2);
  assert.equal(metrics.sage_revalidation_total, 2);
  assert.equal(metrics.sage_failure_class_total.math_validation_failed, 1);
});

test("§21.2 uno studio di funzione non pubblica finché mancano i tre artefatti", async () => {
  const context = newContext("function_study", "run-function-study");
  context.tracker.begin({ runId: context.runId, taskType: context.taskType });
  assert.equal(context.tracker.snapshot().requiresPlots, true);

  const code = "f(x) = (x^2 - 1)/(x - 2)";
  await sageCall(context, { phase: "compute", code, payload: bridgePayload({ ok: true }) });
  assert.equal(context.tracker.snapshot().requiredNextPhase, "validate");

  // La matematica passa, ma il pacchetto grafico è vuoto: non è un errore
  // matematico, è un artefatto mancante — e non si pubblica lo stesso.
  const firstValidation = await sageCall(context, {
    phase: "validate",
    code,
    payload: bridgePayload({ ok: true, passed: true, artifacts: [] })
  });
  assert.equal(firstValidation.result.publishable, false);
  assert.equal(firstValidation.result.finalMarkdown, "");
  const afterValidation = context.tracker.snapshot();
  assert.equal(afterValidation.state, "plot_required");
  assert.equal(afterValidation.failureClass, "artifact_missing");
  assert.equal(context.tracker.canFinalize(), false);

  // plot incompleto: due artefatti su tre non bastano.
  await sageCall(context, {
    phase: "plot",
    code,
    payload: bridgePayload({
      ok: true,
      artifacts: [
        artifactFor(context.runId, "function_plot", 0),
        artifactFor(context.runId, "first_derivative_plot", 1)
      ]
    })
  });
  assert.equal(context.tracker.snapshot().state, "plot_required");
  assert.equal(context.tracker.canFinalize(), false);
  assert.deepEqual(
    context.tracker.nextDecision().missingArtifactKinds,
    ["second_derivative_plot"]
  );

  // plot completo: i tre artefatti ci sono, ma il documento va rivalidato.
  await sageCall(context, {
    phase: "plot",
    code,
    payload: bridgePayload({
      ok: true,
      artifacts: [
        artifactFor(context.runId, "function_plot", 0),
        artifactFor(context.runId, "first_derivative_plot", 1),
        artifactFor(context.runId, "second_derivative_plot", 2)
      ]
    })
  });
  assert.equal(context.tracker.snapshot().state, "validation_required");
  assert.deepEqual(context.tracker.nextDecision().missingArtifactKinds, []);

  const published = await sageCall(context, {
    phase: "validate",
    code,
    payload: bridgePayload({
      ok: true,
      passed: true,
      artifacts: [
        artifactFor(context.runId, "function_plot", 0),
        artifactFor(context.runId, "first_derivative_plot", 1),
        artifactFor(context.runId, "second_derivative_plot", 2)
      ]
    })
  });

  assert.equal(context.tracker.snapshot().state, "ready");
  assert.equal(context.tracker.canFinalize(), true);
  assert.equal(published.result.publishable, true);
  assert.equal(published.result.artifacts.length, 3);
  assert.equal(context.tracker.snapshot().plotCount, 2);
});

test("§21.3 un validatore assente è un blocco infrastrutturale, e non pubblica matematica", async () => {
  const context = newContext("evaluate", "run-infrastructure");
  context.tracker.begin({ runId: context.runId, taskType: context.taskType });

  await sageCall(context, {
    phase: "compute",
    code: "integrate(sin(x), x)",
    payload: bridgePayload({ ok: true })
  });

  const blocked = await sageCall(context, {
    phase: "validate",
    code: "integrate(sin(x), x)",
    payload: bridgePayload({ ok: true, passed: true }),
    validator: null
  });

  const snapshot = context.tracker.snapshot();
  assert.equal(snapshot.state, "infrastructure_block");
  assert.equal(snapshot.terminal, true);
  assert.equal(context.tracker.mustContinue(), false, "non c'è nulla da riparare");
  assert.equal(context.tracker.canFinalize(), false, "nessuna matematica può essere pubblicata");
  assert.equal(blocked.result.publishable, false);
  assert.equal(blocked.result.finalMarkdown, "");

  // La risposta viene riscritta una volta come NOT_PUBLISHABLE; poi il modello
  // può parlare, altrimenti il turno resterebbe appeso per sempre.
  const first = guardSageFinalization(context.tracker);
  assert.equal(first.blocked, true);
  assert.equal(first.retryAllowed, true);
  assert.match(first.guidance, /SAGE_TERMINAL_NOT_PUBLISHABLE/);
  assert.match(first.guidance, /Do not present the candidate mathematics as a result/);
  assert.equal(guardSageFinalization(context.tracker).blocked, false);

  const metrics = context.metrics.snapshot();
  assert.equal(metrics.sage_not_publishable_total, 1);
  assert.equal(metrics.sage_publishable_total, 0);
  assert.equal(metrics.sage_failure_class_total.runtime_unavailable, 1);
});

test("§21.4 due prose premature vengono scartate e il turno prosegue fino alla pubblicazione", async () => {
  const context = newContext("evaluate", "run-premature");
  context.tracker.begin({ runId: context.runId, taskType: context.taskType });

  const code = "limit(sin(x)/x, x=0)";
  await sageCall(context, { phase: "compute", code, payload: bridgePayload({ ok: true }) });

  const discarded = [];
  for (const prose of ["Il limite vale 1.", "Come dicevo, il risultato è 1."]) {
    const block = guardSageFinalization(context.tracker);
    assert.equal(block.blocked, true, `la prosa "${prose}" non può essere pubblicata`);
    assert.equal(block.retryAllowed, true, "il secondo episodio non termina il turno");
    discarded.push(block.guidance);
  }

  for (const guidance of discarded) {
    assert.match(guidance, /SAGE_ORCHESTRATION/);
    assert.match(guidance, /nextPhase=validate/);
    assert.match(guidance, /FINALIZATION_ALLOWED=false/);
    // La guidance non deve mai chiedere all'utente un altro messaggio.
    assert.doesNotMatch(guidance, /ask the user/i);
  }
  assert.equal(context.tracker.snapshot().prematureFinalizations, 2);

  const published = await sageCall(context, {
    phase: "validate",
    code,
    payload: bridgePayload({ ok: true, passed: true })
  });

  assert.equal(context.tracker.snapshot().state, "ready");
  assert.equal(context.tracker.canFinalize(), true);
  assert.equal(guardSageFinalization(context.tracker).blocked, false);
  assert.equal(published.result.publishable, true);
  assert.match(published.result.finalMarkdown, /Risultato/);
});

test("un compito non grafico non pretende artefatti", async () => {
  const context = newContext("evaluate", "run-no-plots");
  context.tracker.begin({ runId: context.runId, taskType: context.taskType });
  assert.equal(context.tracker.snapshot().requiresPlots, false);

  await sageCall(context, { phase: "compute", code: "2+2", payload: bridgePayload({ ok: true }) });
  await sageCall(context, {
    phase: "validate",
    code: "2+2",
    payload: bridgePayload({ ok: true, passed: true, artifacts: [] })
  });

  assert.equal(context.tracker.snapshot().state, "ready");
  assert.equal(context.tracker.snapshot().plotCount, 0);
  assert.deepEqual(context.tracker.nextDecision().missingArtifactKinds, []);
});
