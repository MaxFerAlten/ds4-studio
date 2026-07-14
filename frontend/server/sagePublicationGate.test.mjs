import assert from "node:assert/strict";
import { test } from "node:test";

import {
  authorizeSageCandidate,
  canPublishSageResult,
  publicationFailureResult
} from "./sagePublicationGate.mjs";

function rawCandidate(overrides = {}) {
  return {
    content: "candidate",
    isError: false,
    sageResult: {
      contractVersion: "sage_result_v1",
      tool: "sage",
      runId: null,
      taskType: "evaluate",
      phase: "validate",
      state: "computed",
      status: "ok",
      display: { title: "SageMath", stage: "Validazione", summary: "ok" },
      model: { content: "candidate", latex: [], facts: [] },
      candidateReport: { kind: "math_report", title: "Result", sections: [] },
      artifacts: [],
      execution: { ok: true, exitCode: 0, timedOut: false },
      validation: { authoritative: false, passed: false, checks: [], errors: [] },
      publication: { publishable: false, markdown: "", reasonCodes: [] },
      ...overrides
    }
  };
}

const passingValidation = () => ({
  authoritative: true,
  passed: true,
  checks: [{ code: "EXACT", passed: true, message: "ok", evidence: {} }],
  errors: [],
  normalizedReport: {
    authority: "runtime",
    validationPassed: true,
    kind: "math_report",
    title: "Result",
    sections: []
  }
});

async function authorize(raw = rawCandidate(), overrides = {}) {
  return authorizeSageCandidate({
    args: { code: "1+1", task_type: "evaluate", phase: "validate" },
    raw,
    runId: "run-1",
    validator: async () => passingValidation(),
    formatter: () => "# Result\n\n2",
    artifactValidator: () => ({ passed: true, reasonCodes: [] }),
    ...overrides
  });
}

test("authoritative validation pass is publishable", async () => {
  const result = await authorize();
  assert.equal(result.publishable, true);
  assert.equal(result.authoritative, true);
  assert.equal(result.validationPassed, true);
  assert.equal(result.finalMarkdown, "# Result\n\n2");
  assert.equal(canPublishSageResult(result.sageResult), true);
});

test("execution success without a validator fails closed", async () => {
  const result = await authorizeSageCandidate({
    args: { code: "1+1" },
    raw: rawCandidate(),
    runId: "run-1",
    validator: null
  });
  assert.equal(result.publishable, false);
  assert.equal(result.authoritative, false);
  assert.ok(result.sageResult.publication.reasonCodes.includes("VALIDATOR_UNAVAILABLE"));
});

test("empty checks are not publishable", async () => {
  const result = await authorize(undefined, {
    validator: async () => ({ ...passingValidation(), checks: [] })
  });
  assert.equal(result.publishable, false);
});

test("a failed check is not publishable", async () => {
  const result = await authorize(undefined, {
    validator: async () => ({
      ...passingValidation(),
      passed: false,
      checks: [{ code: "EXACT", passed: false }],
      errors: ["FAILED"]
    })
  });
  assert.equal(result.publishable, false);
});

test("empty Markdown is not publishable", async () => {
  const result = await authorize(undefined, { formatter: () => "" });
  assert.equal(result.publishable, false);
});

test("a missing artifact blocks publication", async () => {
  const result = await authorize(undefined, {
    artifactValidator: () => ({ passed: false, reasonCodes: ["SAGE_ARTIFACT_MISSING"] })
  });
  assert.equal(result.publishable, false);
  assert.ok(result.sageResult.publication.reasonCodes.includes("SAGE_ARTIFACT_MISSING"));
});

test("legacy version is never directly publishable", () => {
  assert.equal(canPublishSageResult(rawCandidate().sageResult), false);
});

test("a model validation claim does not authorize publication", async () => {
  const raw = rawCandidate({
    debug: { claimedValidation: { passed: true, checks: [{ passed: true }] } }
  });
  const result = await authorize(raw, {
    validator: async () => ({
      authoritative: false,
      passed: false,
      checks: [],
      errors: ["RUNTIME_VALIDATION_NOT_EXECUTED"],
      normalizedReport: null
    })
  });
  assert.equal(result.publishable, false);
  assert.equal(result.authoritative, false);
});

test("validator exceptions become controlled failures", async () => {
  const result = await authorize(undefined, {
    validator: async () => {
      throw new Error("private validator failure");
    }
  });
  assert.equal(result.isError, true);
  assert.equal(result.publishable, false);
  assert.doesNotMatch(result.content, /private validator failure/);
});

test("failure result preserves legacy content", () => {
  const result = publicationFailureResult({ raw: rawCandidate() }, ["VALIDATOR_UNAVAILABLE"]);
  assert.equal(result.content, "candidate");
  assert.equal(result.publishable, false);
});

test("a compute-phase result cannot cross the publication gate", async () => {
  const result = await authorizeSageCandidate({
    args: { code: "1+1", task_type: "evaluate", phase: "compute" },
    raw: rawCandidate(),
    runId: "run-1",
    validator: async () => passingValidation(),
    formatter: () => "# Result\n\n2",
    artifactValidator: () => ({ passed: true, reasonCodes: [] })
  });

  assert.equal(result.publishable, false);
  assert.ok(result.sageResult.publication.reasonCodes.includes("SAGE_PUBLICATION_PHASE_INVALID"));
});

function artifactManifest(runId, kind) {
  const sha256 = kind.padEnd(64, "0").slice(0, 64).replace(/[^a-f0-9]/g, "a");
  const artifactId = `sha256:${sha256}`;
  return {
    artifactId,
    runId,
    kind,
    name: `${kind}.png`,
    mediaType: "image/png",
    sha256,
    sizeBytes: 10,
    createdAt: "2026-07-13T00:00:00.000Z",
    url: `/api/sage/artifacts/${runId}/${encodeURIComponent(artifactId)}`
  };
}

test("function-study publication requires a complete current-run artifact package", async () => {
  const runId = "run-function";
  const raw = rawCandidate({
    taskType: "function_study",
    artifacts: [
      artifactManifest(runId, "function_plot"),
      artifactManifest(runId, "first_derivative_plot"),
      artifactManifest(runId, "second_derivative_plot")
    ]
  });
  const result = await authorize(raw, {
    args: { code: "f(x)=x", task_type: "function_study", phase: "validate" },
    runId,
    artifactValidator: undefined
  });

  assert.equal(result.publishable, true);
});

test("artifact run mismatch and legacy latest URLs fail closed", async () => {
  const runId = "run-function";
  const artifacts = [
    artifactManifest("other-run", "function_plot"),
    artifactManifest(runId, "first_derivative_plot"),
    {
      ...artifactManifest(runId, "second_derivative_plot"),
      url: "/api/sage/artifacts/by-name/second_derivative_plot.png"
    }
  ];
  const result = await authorize(rawCandidate({ taskType: "function_study", artifacts }), {
    args: { code: "f(x)=x", task_type: "function_study", phase: "validate" },
    runId,
    artifactValidator: undefined
  });

  assert.equal(result.publishable, false);
  assert.ok(result.sageResult.publication.reasonCodes.includes("SAGE_ARTIFACT_RUN_MISMATCH"));
  assert.ok(result.sageResult.publication.reasonCodes.includes("SAGE_ARTIFACT_HASH_MISMATCH"));
});
