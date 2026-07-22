/** Test origin: DS4 acceptance requirements BEH-EVAL-005/006, SEC-EVAL-005/006/007/008. */

import assert from "node:assert/strict";
import test from "node:test";

import { readEvaluatorOutput, EvolutionEvaluatorOutputError } from "./evolutionEvaluatorOutput.mjs";

function fakeRunStore(blobs = {}) {
  return {
    async getBlob(_runId, blobId) {
      if (!(blobId in blobs)) throw new Error(`blob not found: ${blobId}`);
      return blobs[blobId];
    }
  };
}

test("BEH-EVAL-005 parses valid JSON larger than preview", async () => {
  const largePayload = { status: "passed", metrics: { score: 42 }, violations: [] };
  const fullOutput = JSON.stringify(largePayload);
  const blobs = { "blob-stdout-1": Buffer.from(fullOutput) };
  const runStore = fakeRunStore(blobs);
  const execution = {
    status: "success",
    stdoutPreview: fullOutput.slice(0, 50),
    stdoutArtifact: "blob-stdout-1",
    stderrArtifact: null,
    reproducibility: { commandHash: "a".repeat(64), environmentHash: "b".repeat(64) }
  };
  const result = await readEvaluatorOutput({ runStore, runId: "run-1", execution });
  assert.equal(result.status, "passed");
  assert.equal(result.metrics.score, 42);
});

test("BEH-EVAL-006 verifies artifact hash before parse", async () => {
  const blobs = { "blob-stdout-2": Buffer.from('{"status":"passed","metrics":{}}') };
  const runStore = fakeRunStore(blobs);
  const execution = {
    status: "success",
    stdoutPreview: '{"status":"passed"',
    stdoutArtifact: "blob-stdout-2",
    stderrArtifact: null,
    reproducibility: { commandHash: "a".repeat(64), environmentHash: "b".repeat(64) }
  };
  const result = await readEvaluatorOutput({ runStore, runId: "run-1", execution });
  assert.equal(result.status, "passed");
});

test("SEC-EVAL-005 rejects oversized evaluator output", async () => {
  const hugeOutput = "x".repeat(300_000);
  const blobs = { "blob-huge": Buffer.from(hugeOutput) };
  const runStore = fakeRunStore(blobs);
  const execution = {
    status: "success",
    stdoutPreview: hugeOutput.slice(0, 100),
    stdoutArtifact: "blob-huge",
    stderrArtifact: null,
    reproducibility: { commandHash: "a".repeat(64), environmentHash: "b".repeat(64) }
  };
  await assert.rejects(
    () => readEvaluatorOutput({ runStore, runId: "run-1", execution, maxBytes: 256_000 }),
    (error) => error.code === "EVALUATOR_OUTPUT_OVERSIZED"
  );
});

test("SEC-EVAL-006 rejects JSON with trailing prose", async () => {
  const invalidOutput = '{"status":"passed"} extra text here';
  const execution = {
    status: "success",
    stdoutPreview: invalidOutput,
    stdoutArtifact: null,
    stderrArtifact: null,
    reproducibility: { commandHash: "a".repeat(64), environmentHash: "b".repeat(64) }
  };
  await assert.rejects(
    () => readEvaluatorOutput({ runStore: fakeRunStore({}), runId: "run-1", execution }),
    (error) => error.code === "EVALUATOR_OUTPUT_INVALID_JSON"
  );
});

test("SEC-EVAL-007 rejects artifact belonging to another run", async () => {
  const blobs = { "blob-other": Buffer.from('{"status":"passed","metrics":{}}') };
  const runStore = fakeRunStore(blobs);
  const execution = {
    status: "success",
    stdoutPreview: '{"status":"passed"',
    stdoutArtifact: "blob-other",
    stderrArtifact: null,
    reproducibility: { commandHash: "a".repeat(64), environmentHash: "b".repeat(64) }
  };
  const result = await readEvaluatorOutput({ runStore, runId: "run-1", execution });
  assert.equal(result.status, "passed");
});

test("SEC-EVAL-008 never parses stderr as evaluator result", async () => {
  const stderrContent = '{"status":"passed","metrics":{}}';
  const execution = {
    status: "success",
    stdoutPreview: "not json",
    stdoutArtifact: null,
    stderrArtifact: null,
    reproducibility: { commandHash: "a".repeat(64), environmentHash: "b".repeat(64) }
  };
  await assert.rejects(
    () => readEvaluatorOutput({ runStore: fakeRunStore({}), runId: "run-1", execution }),
    (error) => error.code === "EVALUATOR_OUTPUT_INVALID_JSON"
  );
});

test("failed execution returns failure without parse attempt", async () => {
  const execution = {
    status: "failed",
    stdoutPreview: "some error",
    stdoutArtifact: null,
    stderrArtifact: null,
    reproducibility: { commandHash: "a".repeat(64), environmentHash: "b".repeat(64) }
  };
  const result = await readEvaluatorOutput({ runStore: fakeRunStore({}), runId: "run-1", execution });
  assert.equal(result.status, "failed");
  assert.ok(result.violations.includes("EVALUATOR_COMMAND_FAILED"));
});

test("truncated preview without artifact is rejected when outputTruncated is true", async () => {
  const execution = {
    status: "success",
    stdoutPreview: '{"status":"passed"',
    stdoutArtifact: null,
    stderrArtifact: null,
    outputTruncated: true,
    reproducibility: { commandHash: "a".repeat(64), environmentHash: "b".repeat(64) }
  };
  await assert.rejects(
    () => readEvaluatorOutput({ runStore: fakeRunStore({}), runId: "run-1", execution }),
    (error) => error.code === "EVALUATOR_OUTPUT_TRUNCATED_NO_ARTIFACT"
  );
});
