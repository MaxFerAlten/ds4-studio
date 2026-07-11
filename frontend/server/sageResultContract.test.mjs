import assert from "node:assert/strict";
import { test } from "node:test";

import {
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
    taskType: "auto",
    phase: "compute",
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
    validation: { passed: true, checks: [], warnings: [] },
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
});
