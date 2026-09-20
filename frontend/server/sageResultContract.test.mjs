import assert from "node:assert/strict";
import { test } from "node:test";

import {
  SAGE_LEGACY_RESULT_CONTRACT_VERSION,
  SAGE_RESULT_CONTRACT_VERSION,
  attachSageOrchestration,
  buildLegacySageResult,
  buildSageOrchestration,
  normalizeSagePhase,
  normalizeSageTaskType,
  publicSageResult,
  validateSageResult
} from "./sageResultContract.mjs";

function minimalResult(overrides = {}) {
  return {
    contractVersion: SAGE_RESULT_CONTRACT_VERSION,
    tool: "sage",
    runId: "run-1",
    taskType: "auto",
    phase: "compute",
    state: "ready",
    status: "ok",
    attempt: 1,
    display: {
      title: "SageMath",
      stage: "Calcolo",
      summary: "Calcolo completato.",
      detailsAvailable: true
    },
    model: { content: "4", latex: [], facts: [] },
    report: null,
    artifacts: [],
    execution: { ok: true, exitCode: 0, timedOut: false },
    validation: {
      authoritative: true,
      passed: true,
      checks: [{ code: "EXECUTION_OK", passed: true, message: "ok", evidence: {} }],
      errors: [],
      warnings: []
    },
    publication: { publishable: true, markdown: "4", reasonCodes: [] },
    debug: {
      exitCode: 0,
      signal: null,
      killed: false,
      durationMs: 10,
      stdoutBytes: 1,
      stderrBytes: 0,
      stdoutPreview: "4",
      stderrPreview: ""
    },
    ...overrides
  };
}

function functionStudyReport() {
  return {
    kind: "function_study_v1",
    title: "Studio della funzione",
    function: { plain: "x^2", latex: "x^2" },
    domain: { latex: "\\mathbb{R}", excluded: [] },
    firstDerivative: { latex: "2x", criticalPoints: [], monotonicityIntervals: [] },
    secondDerivative: { latex: "2", inflectionPoints: [], concavityIntervals: [] },
    conclusion: "La funzione è convessa."
  };
}

test("normalizes Sage task types", () => {
  assert.equal(normalizeSageTaskType("  LINEAR_ALGEBRA "), "linear_algebra");
  assert.equal(normalizeSageTaskType("unknown"), "auto");
  assert.equal(normalizeSageTaskType(undefined), "auto");
});

test("normalizes Sage phases", () => {
  assert.equal(normalizeSagePhase(" VALIDATE "), "validate");
  assert.equal(normalizeSagePhase("unknown"), "compute");
  assert.equal(normalizeSagePhase(undefined), "compute");
});

test("accepts a valid minimal envelope", () => {
  assert.deepEqual(validateSageResult(minimalResult()).errors, []);
  assert.equal(validateSageResult(minimalResult()).ok, true);
});

test("uses v2 as the authoritative contract and keeps v1 as legacy", () => {
  assert.equal(SAGE_RESULT_CONTRACT_VERSION, "sage_result_v2");
  assert.equal(SAGE_LEGACY_RESULT_CONTRACT_VERSION, "sage_result_v1");
});

test("rejects a non-authoritative validation pass", () => {
  const value = minimalResult({
    validation: {
      authoritative: false,
      passed: true,
      checks: [{ code: "CLAIM", passed: true }],
      errors: []
    }
  });
  const result = validateSageResult(value);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.code === "NON_AUTHORITATIVE_PASS"));
});

test("rejects a validation pass without checks", () => {
  const value = minimalResult({
    validation: { authoritative: true, passed: true, checks: [], errors: [] }
  });
  const result = validateSageResult(value);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.code === "VALIDATION_CHECKS_EMPTY"));
});

test("rejects a validation pass with a failed check", () => {
  const value = minimalResult({
    validation: {
      authoritative: true,
      passed: true,
      checks: [{ code: "FAILED", passed: false }],
      errors: []
    }
  });
  const result = validateSageResult(value);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.code === "VALIDATION_CHECK_FAILED"));
});

test("rejects publishable results without Markdown", () => {
  const result = validateSageResult(minimalResult({
    publication: { publishable: true, markdown: "", reasonCodes: [] }
  }));
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.code === "FINAL_MARKDOWN_MISSING"));
});

test("rejects publishable results without authoritative validation", () => {
  const result = validateSageResult(minimalResult({
    validation: {
      authoritative: false,
      passed: false,
      checks: [],
      errors: ["NOT_VALIDATED"]
    }
  }));
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.code === "INVALID_PUBLICATION_AUTHORITY"));
});

test("accepts v1 only as a non-publishable legacy result", () => {
  const legacy = buildLegacySageResult({ stdout: "2", stderr: "", exitCode: 0 });
  assert.equal(legacy.contractVersion, SAGE_LEGACY_RESULT_CONTRACT_VERSION);
  assert.equal(validateSageResult(legacy).ok, true);
  assert.equal(legacy.validation.authoritative, false);
  assert.equal(legacy.validation.passed, false);
  assert.equal(legacy.publication.publishable, false);
});

test("rejects an unknown Sage state", () => {
  const result = validateSageResult(minimalResult({ state: "imagined" }));
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.path === "state"));
});

test("rejects a wrong contract version", () => {
  const result = validateSageResult(minimalResult({ contractVersion: "sage_result_v0" }));
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.path === "contractVersion"));
});

test("rejects a non-Sage tool", () => {
  const result = validateSageResult(minimalResult({ tool: "bash" }));
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.path === "tool"));
});

test("legacy fallback excludes stderr from model content", () => {
  const result = buildLegacySageResult({
    stdout: "answer: 4",
    stderr: "Traceback: private diagnostics",
    exitCode: 1,
    taskType: "evaluate",
    phase: "compute"
  });

  assert.match(result.model.content, /answer: 4/);
  assert.doesNotMatch(result.model.content, /Traceback|private diagnostics/);
  assert.equal(result.status, "error");
});

test("legacy fallback keeps bounded stderr in debug", () => {
  const stderr = "x".repeat(10_000);
  const result = buildLegacySageResult({ stdout: "", stderr, exitCode: 1 });

  assert.equal(result.debug.stderrBytes, 10_000);
  assert.equal(Buffer.byteLength(result.debug.stderrPreview, "utf8"), 8 * 1024);
});

test("accepts a generic math report", () => {
  const report = {
    kind: "math_report",
    title: "Risoluzione",
    sections: [{ id: "result", title: "Risultato", markdown: "4", formulas: [] }]
  };
  assert.equal(validateSageResult(minimalResult({ report })).ok, true);
});

const FUNCTION_STUDY_ARTIFACTS = [
  { kind: "function_plot" },
  { kind: "first_derivative_plot" },
  { kind: "second_derivative_plot" }
];

test("accepts a complete function-study report", () => {
  assert.equal(
    validateSageResult(minimalResult({
      taskType: "function_study",
      report: functionStudyReport(),
      artifacts: FUNCTION_STUDY_ARTIFACTS
    })).ok,
    true
  );
});

test("a publishable function study without its three plots is rejected", () => {
  const result = validateSageResult(minimalResult({
    taskType: "function_study",
    report: functionStudyReport(),
    artifacts: [{ kind: "function_plot" }]
  }));
  assert.equal(result.ok, false);
  const codes = result.errors.map((error) => error.code);
  assert.ok(codes.includes("FUNCTION_STUDY_ARTIFACTS_INCOMPLETE"));
});

test("rejects a function study without a domain", () => {
  const report = functionStudyReport();
  delete report.domain;
  const result = validateSageResult(minimalResult({ report }));

  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.path === "report.domain"));
});

test("validation does not mutate its input", () => {
  const input = minimalResult({ report: functionStudyReport() });
  const before = structuredClone(input);
  validateSageResult(input);
  assert.deepEqual(input, before);
});

test("public result omits model content, report, and debug previews", () => {
  const publicResult = publicSageResult(minimalResult({ report: functionStudyReport() }));

  assert.equal("model" in publicResult, false);
  assert.equal("report" in publicResult, false);
  assert.equal("stdoutPreview" in publicResult.debug, false);
  assert.equal(publicResult.display.summary, "Calcolo completato.");
  assert.equal(publicResult.runId, "run-1");
  assert.equal(publicResult.state, "ready");
  assert.equal(publicResult.validation.authoritative, true);
  assert.equal(publicResult.publication.publishable, true);
  assert.equal(publicResult.publication.markdown, "4");
});

test("orchestration: retryable e terminal non convivono", () => {
  const result = validateSageResult(minimalResult({
    publication: { publishable: false, markdown: "", reasonCodes: ["X"] },
    orchestration: buildSageOrchestration(
      { terminal: true, retryable: true, nextPhase: "publish" },
      { candidateRevision: 1, validatedRevision: 1, state: "ready" }
    )
  }));
  assert.equal(result.ok, false);
  const codes = result.errors.map((error) => error.code);
  assert.ok(codes.includes("ORCHESTRATION_RETRYABLE_TERMINAL"));
});

test("orchestration: nextPhase deve essere coerente con lo stato", () => {
  const result = validateSageResult(minimalResult({
    state: "repair_required",
    publication: { publishable: false, markdown: "", reasonCodes: ["X"] },
    orchestration: buildSageOrchestration(
      { terminal: false, retryable: true, nextPhase: "plot" },
      { candidateRevision: 2, validatedRevision: null, state: "repair_required" }
    )
  }));
  assert.equal(result.ok, false);
  assert.ok(result.errors.map((error) => error.code).includes("NEXT_PHASE_STATE_MISMATCH"));
});

test("orchestration: pubblicare una revisione diversa da quella validata e' rifiutato", () => {
  const result = validateSageResult(minimalResult({
    orchestration: buildSageOrchestration(
      { terminal: true, retryable: false, publishable: true, nextPhase: "publish" },
      { candidateRevision: 3, validatedRevision: 2, state: "ready" }
    )
  }));
  assert.equal(result.ok, false);
  assert.ok(result.errors.map((error) => error.code).includes("VALIDATED_REVISION_MISMATCH"));
});

test("orchestration: un risultato pubblicabile porta una decisione pubblicabile", () => {
  const ok = validateSageResult(minimalResult({
    orchestration: buildSageOrchestration(
      { terminal: true, retryable: false, publishable: true, nextPhase: "publish" },
      { candidateRevision: 1, validatedRevision: 1, state: "ready" }
    )
  }));
  assert.equal(ok.ok, true);

  const mismatch = validateSageResult(minimalResult({
    orchestration: buildSageOrchestration(
      { terminal: false, retryable: true, publishable: false, nextPhase: "publish" },
      { candidateRevision: 1, validatedRevision: 1, state: "ready" }
    )
  }));
  assert.equal(mismatch.ok, false);
  assert.ok(mismatch.errors.map((error) => error.code).includes("ORCHESTRATION_PUBLISHABLE_MISMATCH"));
});

test("publicSageResult conserva la decisione di orchestrazione", () => {
  const orchestration = buildSageOrchestration(
    {
      terminal: false,
      retryable: true,
      failureClass: "math_validation_failed",
      nextPhase: "repair",
      nextAction: "Correggi la derivata prima.",
      diagnosticFingerprint: "sha256:abc"
    },
    {
      candidateRevision: 2,
      validatedRevision: 1,
      state: "repair_required",
      attemptsRemaining: { compute: 0, repair: 3, validate: 4, plot: 2, total: 8 }
    }
  );
  const publicView = publicSageResult(minimalResult({
    state: "repair_required",
    publication: { publishable: false, markdown: "", reasonCodes: ["X"] },
    orchestration
  }));
  assert.equal(publicView.orchestration.nextPhase, "repair");
  assert.equal(publicView.orchestration.candidateRevision, 2);
  assert.equal(publicView.orchestration.attemptsRemaining.repair, 3);
});

test("attachSageOrchestration espone anche le chiavi piatte per il client nativo", () => {
  const result = attachSageOrchestration(
    { tool: "sage" },
    buildSageOrchestration(
      { terminal: false, retryable: true, failureClass: "artifact_missing", nextPhase: "plot",
        nextAction: "Genera i grafici mancanti." },
      { candidateRevision: 2, validatedRevision: 2, state: "plot_required" }
    )
  );
  assert.equal(result.orchestrationNextPhase, "plot");
  assert.equal(result.orchestrationTerminal, false);
  assert.equal(result.orchestrationRetryable, true);
  assert.equal(result.orchestrationFailureClass, "artifact_missing");
  assert.equal(result.orchestrationCandidateRevision, 2);
  assert.equal(result.orchestrationState, "plot_required");
});
