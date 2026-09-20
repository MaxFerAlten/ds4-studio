import test from "node:test";
import assert from "node:assert/strict";

import {
  classifySageResult,
  normalizeSageMessage,
  sageDiagnosticFingerprint,
  SAGE_RETRYABLE_CLASSES,
  SAGE_TERMINAL_CLASSES
} from "./sageRepairPolicy.mjs";

function validateResult({ checks = [], errors = [], artifacts = [], publishable = false } = {}) {
  return {
    isError: !publishable,
    publishable,
    artifacts,
    sageResult: {
      taskType: "function_study",
      phase: "validate",
      execution: { ok: true, exitCode: 0, timedOut: false },
      artifacts,
      validation: { authoritative: true, passed: publishable, checks, errors },
      publication: { publishable, markdown: publishable ? "# ok" : "", reasonCodes: errors }
    }
  };
}

const THREE_PLOTS = [
  { kind: "function_plot" },
  { kind: "first_derivative_plot" },
  { kind: "second_derivative_plot" }
];

test("una validazione matematica fallita e' riparabile, non terminale", () => {
  const decision = classifySageResult(
    validateResult({
      checks: [
        { code: "FIRST_DERIVATIVE_EQUIVALENT", passed: false },
        { code: "DOMAIN_PRESENT", passed: true }
      ],
      errors: ["FIRST_DERIVATIVE_EQUIVALENT"],
      artifacts: THREE_PLOTS
    }),
    { phase: "validate", taskType: "function_study" }
  );
  assert.equal(decision.failureClass, "math_validation_failed");
  assert.equal(decision.terminal, false);
  assert.equal(decision.retryable, true);
  assert.equal(decision.nextPhase, "repair");
});

test("una validazione KaTeX fallita chiede una repair, non un plot", () => {
  const decision = classifySageResult(
    validateResult({
      checks: [{ code: "KATEX_TABLE_WELL_FORMED", passed: false }],
      errors: ["KATEX_TABLE_WELL_FORMED"],
      artifacts: THREE_PLOTS
    }),
    { phase: "validate", taskType: "function_study" }
  );
  assert.equal(decision.failureClass, "katex_validation_failed");
  assert.equal(decision.nextPhase, "repair");
});

test("artefatti incompleti chiedono la fase plot, non una nuova repair", () => {
  const decision = classifySageResult(
    validateResult({
      checks: [{ code: "PLOT_POINTS_MATCH_CLASSIFICATIONS", passed: false }],
      errors: ["SAGE_ARTIFACT_MISSING:second_derivative_plot"],
      artifacts: [{ kind: "function_plot" }, { kind: "first_derivative_plot" }]
    }),
    { phase: "validate", taskType: "function_study" }
  );
  assert.equal(decision.failureClass, "artifact_missing");
  assert.equal(decision.nextPhase, "plot");
  assert.deepEqual(decision.missingArtifactKinds, ["second_derivative_plot"]);
  assert.equal(decision.retryable, true);
});

test("un task non grafico non viene penalizzato dagli artefatti mancanti", () => {
  const decision = classifySageResult(
    validateResult({
      checks: [{ code: "GENERIC_REPORT_KIND", passed: true }],
      errors: [],
      artifacts: [],
      publishable: true
    }),
    { phase: "validate", taskType: "evaluate" }
  );
  assert.equal(decision.failureClass, "success_publishable");
  assert.equal(decision.nextPhase, "publish");
  assert.equal(decision.terminal, true);
  assert.equal(decision.publishable, true);
});

test("un blocco infrastrutturale e' terminale e non produce un report", () => {
  for (const [code, expected] of [
    ["VALIDATOR_UNAVAILABLE", "runtime_unavailable"],
    ["SAGE_POLICY_REVISION_MISMATCH", "policy_mismatch"],
    ["SAGE_BRIDGE_INVALID_JSON", "bridge_invalid_json"],
    ["SAGE_BRIDGE_INVALID_PAYLOAD", "bridge_invalid_payload"]
  ]) {
    const decision = classifySageResult(
      { isError: true, debug: { bridgeError: code }, sageResult: { execution: { ok: false } } },
      { phase: "validate" }
    );
    assert.equal(decision.failureClass, expected, code);
    assert.equal(decision.terminal, true);
    assert.equal(decision.retryable, false);
    assert.equal(decision.infrastructure, true);
    assert.equal(decision.nextPhase, "terminal");
    assert.equal(decision.terminalReason, code);
  }
});

test("un timeout e' riparabile con un candidato piu' leggero", () => {
  const decision = classifySageResult(
    {
      isError: true,
      sageResult: { execution: { ok: false, exitCode: null, timedOut: true }, status: "timeout" }
    },
    { phase: "compute" }
  );
  assert.equal(decision.failureClass, "timeout");
  assert.equal(decision.retryable, true);
  assert.equal(decision.nextPhase, "repair");
});

test("gli errori di esecuzione sono distinti per causa", () => {
  const cases = [
    ["SyntaxError: invalid syntax", "syntax_error"],
    ["ZeroDivisionError: symbolic division by zero", "domain_error"],
    ["RuntimeError: failed to isolate roots of the derivative", "numeric_isolation_error"],
    ["AttributeError: 'sage.symbolic' object has no attribute 'foo'", "execution_error"]
  ];
  for (const [stderr, expected] of cases) {
    const decision = classifySageResult(
      { isError: true, debug: { stderr }, sageResult: { execution: { ok: false, exitCode: 1 } } },
      { phase: "compute" }
    );
    assert.equal(decision.failureClass, expected, stderr);
    assert.equal(decision.retryable, true);
    assert.equal(decision.nextPhase, "repair");
  }
});

test("un compute riuscito non e' un fallimento: deve la validazione", () => {
  const decision = classifySageResult(
    { isError: false, publishable: false, sageResult: { execution: { ok: true, exitCode: 0 } } },
    { phase: "compute", taskType: "evaluate" }
  );
  assert.equal(decision.failureClass, "pending_validation");
  assert.equal(decision.nextPhase, "validate");
  assert.equal(decision.terminal, false);
  assert.equal(decision.retryable, false);
  // Nessun fingerprint: altrimenti una compute riuscita fra due fallimenti
  // identici spezzerebbe il conteggio del cambio di strategia.
  assert.equal(decision.diagnosticFingerprint, null);
});

test("lo stesso fallimento due volte impone un cambio di strategia", () => {
  const result = validateResult({
    checks: [{ code: "FIRST_DERIVATIVE_EQUIVALENT", passed: false }],
    errors: ["FIRST_DERIVATIVE_EQUIVALENT"],
    artifacts: THREE_PLOTS
  });
  const first = classifySageResult(result, { phase: "validate", taskType: "function_study" });
  assert.equal(first.strategyChangeRequired, false);

  const second = classifySageResult(result, {
    phase: "validate",
    taskType: "function_study",
    previousFingerprint: first.diagnosticFingerprint,
    sameFailureCount: first.sameFailureCount
  });
  assert.equal(second.sameFailureCount, 2);
  assert.equal(second.strategyChangeRequired, true);
  assert.match(second.nextAction, /change mathematical strategy/);
});

test("il fingerprint ignora la revisione del candidato e il rumore del run", () => {
  const base = {
    failureClass: "math_validation_failed",
    reasonCodes: ["FIRST_DERIVATIVE_EQUIVALENT"],
    failedChecks: ["FIRST_DERIVATIVE_EQUIVALENT"],
    missingArtifacts: [],
    stderr: "/tmp/sage-abc123/run.py line 12: mismatch after 1.25 s"
  };
  const other = {
    ...base,
    stderr: "/tmp/sage-def456/run.py line 40: mismatch after 9.5 s"
  };
  assert.equal(sageDiagnosticFingerprint(base), sageDiagnosticFingerprint(other));
  assert.equal(sageDiagnosticFingerprint({ failureClass: "success_publishable" }), null);
});

test("normalizeSageMessage rimuove path, runid, righe e durate", () => {
  const normalized = normalizeSageMessage(
    "Traceback /tmp/sage-run/x.py line 12 at 0xdeadbeef after 3.5 s"
  );
  assert.match(normalized, /<path>/);
  assert.match(normalized, /line <n>/);
  assert.match(normalized, /<addr>/);
  assert.match(normalized, /<qty>/);
});

test("le classi riparabili e terminali non si sovrappongono", () => {
  const overlap = SAGE_RETRYABLE_CLASSES.filter((cls) => SAGE_TERMINAL_CLASSES.includes(cls));
  assert.deepEqual(overlap, []);
});

test("ogni classe ha una guida imperativa e nessuna chiede un nuovo turno utente", () => {
  const seen = new Set();
  for (const failureClass of [...SAGE_RETRYABLE_CLASSES, ...SAGE_TERMINAL_CLASSES]) {
    const decision = classifySageResult(
      failureClass === "success_publishable"
        ? validateResult({ publishable: true, artifacts: THREE_PLOTS })
        : { isError: true, debug: { bridgeError: `X_${failureClass}` }, sageResult: {} },
      { phase: "validate" }
    );
    seen.add(decision.nextAction);
    assert.ok(decision.nextAction.length > 20);
    assert.doesNotMatch(decision.nextAction, /ask the user|wait for the user/i);
  }
  assert.ok(seen.size > 1);
});
