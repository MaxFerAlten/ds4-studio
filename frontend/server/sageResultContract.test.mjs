import assert from "node:assert/strict";
import { test } from "node:test";

import {
  SAGE_LEGACY_RESULT_CONTRACT_VERSION,
  SAGE_RESULT_CONTRACT_VERSION,
  buildLegacySageResult,
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

test("accepts a complete function-study report", () => {
  assert.equal(
    validateSageResult(minimalResult({
      taskType: "function_study",
      report: functionStudyReport()
    })).ok,
    true
  );
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
