/** Test origin: DS4 acceptance contract sections 24-29. */

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { LiveEvidenceError, bindLiveEvidenceToRevision, validateLiveEvidence, verifyLiveEvidenceHashes } from "./evolutionLiveEvidence.mjs";
import { sha256 } from "./evolutionIntegrity.mjs";

function validEvidence(overrides = {}) {
  return {
    schema: "ds4_evolution_live_evidence_v1",
    executed: true,
    runsRequested: 3,
    runsCompleted: 3,
    runsPassed: 3,
    model: "gpt-4o",
    modelEndpointHash: "a".repeat(64),
    taskFixtureHash: "b".repeat(64),
    runArtifacts: [
      { runId: "run-001", artifactHash: "c".repeat(64), passed: true },
      { runId: "run-002", artifactHash: "d".repeat(64), passed: true },
      { runId: "run-003", artifactHash: "e".repeat(64), passed: true }
    ],
    rollbackDrillPassed: true,
    sourceRevision: "abc123+sha256:def456",
    decidedAt: "2026-07-22T12:00:00.000Z",
    ...overrides
  };
}

test("BEH-LIVE-EV-001 valid live evidence passes validation", () => {
  const record = validEvidence();
  const result = validateLiveEvidence(record);
  assert.equal(result.executed, true);
  assert.equal(result.runsRequested, 3);
  assert.equal(result.runsPassed, 3);
  assert.equal(result.runArtifacts.length, 3);
  assert.equal(result.schema, "ds4_evolution_live_evidence_v1");
});

test("BEH-LIVE-EV-002 missing required fields are rejected", () => {
  assert.throws(() => validateLiveEvidence({}), (error) => error instanceof LiveEvidenceError);
  assert.throws(() => validateLiveEvidence(null), (error) => error instanceof LiveEvidenceError);
  assert.throws(() => validateLiveEvidence("string"), (error) => error instanceof LiveEvidenceError);
  assert.throws(() => validateLiveEvidence({ schema: "ds4_evolution_live_evidence_v1" }), (error) => error instanceof LiveEvidenceError);
  const partial = validEvidence();
  delete partial.model;
  assert.throws(() => validateLiveEvidence(partial), (error) => error instanceof LiveEvidenceError);
  const noRuns = validEvidence();
  noRuns.runArtifacts = "not-array";
  assert.throws(() => validateLiveEvidence(noRuns), (error) => error instanceof LiveEvidenceError);
  const badRun = validEvidence();
  badRun.runArtifacts = [{ runId: "r1" }];
  assert.throws(() => validateLiveEvidence(badRun), (error) => error instanceof LiveEvidenceError);
});

test("SEC-LIVE-EV-001 evidence from wrong source revision is rejected", () => {
  const record = validEvidence({ sourceRevision: "original+sha256:aaa" });
  assert.throws(
    () => bindLiveEvidenceToRevision(record, "different+sha256:bbb"),
    (error) => {
      assert.equal(error.code, "LIVE_EVIDENCE_SOURCE_REVISION_MISMATCH");
      return true;
    }
  );
  assert.equal(bindLiveEvidenceToRevision(record, "original+sha256:aaa"), true);
});

test("SEC-LIVE-EV-002 artifact hash mismatch is detected", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ds4-evo-live-hash-"));
  try {
    const content = JSON.stringify({ output: "run result" });
    const actualHash = sha256(content);
    const wrongHash = "f".repeat(64);
    const artifactPath = path.join(root, "run-001.json");
    await fs.writeFile(artifactPath, content);
    const evidence = validEvidence({
      runArtifacts: [{ runId: "run-001", artifactHash: wrongHash, passed: true }]
    });
    await assert.rejects(
      verifyLiveEvidenceHashes(evidence, root),
      (error) => {
        assert.equal(error.code, "ARTIFACT_HASH_MISMATCH");
        return true;
      }
    );
    const correctEvidence = validEvidence({
      runArtifacts: [{ runId: "run-001", artifactHash: actualHash, passed: true }]
    });
    await assert.doesNotReject(verifyLiveEvidenceHashes(correctEvidence, root));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("SEC-LIVE-EV-002 missing artifact file is detected", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ds4-evo-live-missing-"));
  try {
    const evidence = validEvidence({
      runArtifacts: [{ runId: "nonexistent", artifactHash: "a".repeat(64), passed: true }]
    });
    await assert.rejects(
      verifyLiveEvidenceHashes(evidence, root),
      (error) => {
        assert.equal(error.code, "ARTIFACT_HASH_MISMATCH");
        return true;
      }
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
