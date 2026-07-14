import assert from "node:assert/strict";
import test from "node:test";

import { executeAuthoritativeSage } from "./sageAuthoritativeExecutor.mjs";

const normalizedReport = Object.freeze({
  authority: "runtime",
  validationPassed: true,
  kind: "function_study",
  title: "Studio di funzione",
  function: { formula: "f(x)=x^3", variable: "x" },
  domain: { latex: "\\mathbb{R}" },
  derivatives: {
    first: { formula: "3x^2" },
    second: { formula: "6x" }
  },
  monotonicity: [{ interval: "(-\\infty,+\\infty)", direction: "increasing" }],
  extrema: [{ x: "0", y: "0", classification: "stationary_non_extremum" }],
  range: { latex: "\\mathbb{R}" },
  inflections: [{ x: "0", y: "0" }]
});

function artifact(runId, kind, fill) {
  const sha256 = fill.repeat(64);
  const artifactId = `sha256:${sha256}`;
  return {
    artifactId,
    runId,
    kind,
    name: `${kind}.png`,
    mediaType: "image/png",
    sha256,
    sizeBytes: 128,
    createdAt: "2026-07-13T00:00:00.000Z",
    url: `/api/sage/artifacts/${runId}/${encodeURIComponent(artifactId)}`
  };
}

function rawCandidate(runId, fill) {
  const artifacts = [
    artifact(runId, "function_plot", fill),
    artifact(runId, "first_derivative_plot", fill),
    artifact(runId, "second_derivative_plot", fill)
  ];
  return {
    content: "candidate",
    isError: false,
    sageResult: {
      contractVersion: "sage_result_v1",
      tool: "sage",
      runId,
      taskType: "function_study",
      phase: "validate",
      state: "computed",
      status: "ok",
      display: { title: "SageMath", stage: "Validazione", summary: "ok" },
      model: { content: "candidate", latex: [], facts: [] },
      candidateReport: normalizedReport,
      artifacts,
      execution: { ok: true, exitCode: 0, timedOut: false },
      validation: { authoritative: false, passed: false, checks: [], errors: [] },
      publication: { publishable: false, markdown: "", reasonCodes: [] }
    },
    artifacts
  };
}

const validator = async () => ({
  authoritative: true,
  passed: true,
  checks: [
    { code: "DOMAIN", passed: true },
    { code: "DERIVATIVES", passed: true },
    { code: "CLASSIFICATION", passed: true }
  ],
  errors: [],
  normalizedReport
});

const markdown = [
  "# Studio di funzione",
  "",
  "$$f(x)=x^3$$",
  "",
  "Dominio: $\\mathbb{R}$",
  "",
  "Punto stazionario non estremo: $(0,0)$"
].join("\n");

function parityProjection(result) {
  return {
    contractVersion: result.contractVersion,
    taskType: result.sageResult.taskType,
    normalizedReport: result.sageResult.normalizedReport,
    validationChecks: result.sageResult.validation.checks,
    publishable: result.publishable,
    finalMarkdown: result.finalMarkdown,
    artifactKinds: result.artifacts.map((item) => item.kind).sort(),
    numericValues: result.sageResult.normalizedReport.extrema,
    formulaStrings: [
      result.sageResult.normalizedReport.function.formula,
      result.sageResult.normalizedReport.derivatives.first.formula,
      result.sageResult.normalizedReport.derivatives.second.formula
    ]
  };
}

test("direct and wrapper execution arms preserve authoritative Sage semantics", async () => {
  const args = { code: "f(x)=x^3", task_type: "function_study", phase: "validate" };
  const common = {
    authoritativeLoopEnabledFn: () => true,
    validator,
    formatter: () => markdown,
    artifactValidator: () => ({ passed: true, reasonCodes: [] })
  };
  const direct = await executeAuthoritativeSage(args, {
    ...common,
    runId: "direct-run",
    rawExecutor: async () => rawCandidate("direct-run", "a"),
    sageV2EnabledFn: () => false
  });
  const wrapper = await executeAuthoritativeSage(args, {
    ...common,
    runId: "wrapper-run",
    rawExecutor: async () => {
      throw new Error("raw executor must not run in wrapper arm");
    },
    sageV2EnabledFn: () => true,
    bridgeExecutor: async () => rawCandidate("wrapper-run", "b")
  });

  assert.equal(direct.publishable, true);
  assert.equal(wrapper.publishable, true);
  assert.deepEqual(parityProjection(direct), parityProjection(wrapper));
  assert.notEqual(direct.runId, wrapper.runId);
  assert.notEqual(direct.artifacts[0].artifactId, wrapper.artifacts[0].artifactId);
});
