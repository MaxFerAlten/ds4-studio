/** Test origin: DS4 acceptance contract sections 3 and 24-29. */

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createCertificationBundle, LEVEL_B_TEST_CATALOG, LEVEL_C_TEST_CATALOG, runCertificationSuite } from "./evolutionCertification.mjs";

const provenanceReport = {
  schema: "ds4_evolution_provenance_report_v1",
  passed: true,
  checks: Array.from({ length: 6 }, (_, index) => ({ testId: `CR-${String(index + 1).padStart(3, "0")}`, status: "PASS" })),
  violations: []
};
const environment = { schema: "fixture-environment", node: process.version };
const sourceRevision = { schema: "fixture-revision", revision: "fixture+sha256:test", treeHash: "a".repeat(64), files: [] };

test("Level B catalog has unique, fully mapped requirement IDs", () => {
  const ids = LEVEL_B_TEST_CATALOG.map((entry) => entry.testId);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.includes("BEH-CONTRACT-001"));
  assert.ok(ids.includes("SEC-ROLLBACK-003"));
  assert.ok(ids.includes("CR-006"));
  for (const entry of LEVEL_B_TEST_CATALOG) {
    assert.ok(entry.command);
    assert.ok(entry.expected);
    assert.ok(entry.artifact);
  }
});

function subtestsFor(suite) {
  return LEVEL_B_TEST_CATALOG.filter((entry) => entry.suite === suite).map((entry) => ({ title: entry.testId, ok: true }));
}

test("acceptance evidence bundle contains all eight required artifacts and passes only complete evidence", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ds4-evo-cert-"));
  try {
    const result = await createCertificationBundle({
      repositoryRoot: root,
      outputDir: path.join(root, "bundle"),
      now: () => new Date("2026-01-01T00:00:00.000Z"),
      testFiles: { unit: ["unit.test.mjs"], security: ["security.test.mjs"] },
      suiteRunner: async ({ name }) => ({ name, passed: true, exitCode: 0, durationMs: 1, outputHash: "a".repeat(64), outputPreview: "ok", subtests: subtestsFor(name) }),
      provenanceReport,
      environment,
      sourceRevision
    });
    assert.equal(result.decision.decision, "PASS");
    assert.equal(result.decision.requiredTests, LEVEL_B_TEST_CATALOG.length);
    assert.equal(result.artifacts.length, 8);
    for (const name of result.artifacts) await fs.access(path.join(result.outputDir, name));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
test("a required suite failure makes the acceptance decision fail closed", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ds4-evo-cert-fail-"));
  try {
    const result = await createCertificationBundle({
      repositoryRoot: root,
      outputDir: path.join(root, "bundle"),
      testFiles: { unit: ["unit.test.mjs"], security: ["security.test.mjs"] },
      suiteRunner: async ({ name }) => ({ name, passed: name !== "security", exitCode: name === "security" ? 1 : 0, durationMs: 1, outputHash: "b".repeat(64), outputPreview: "fixture", subtests: name === "security" ? [] : subtestsFor(name) }),
      provenanceReport,
      environment,
      sourceRevision
    });
    assert.equal(result.decision.decision, "FAIL");
    assert.ok(result.decision.hardFailures.includes("SECURITY_SUITE_FAILED"));
    assert.ok(result.decision.failed > 0);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
test("requirement ID extraction honors slash/range combo notation and denies credit to a bare prefix without a number", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ds4-evo-cert-combo-"));
  try {
    const comboSubtests = [
      { title: "BEH-GATE-004/005 budget and rollback failures reject", ok: true },
      { title: "SEC-RISK-001..003 native, build, and security paths cannot auto-promote", ok: true },
      { title: "SEC-SIMPLIFY bare prefix mention earns no credit for any numbered ID", ok: true }
    ];
    const result = await createCertificationBundle({
      repositoryRoot: root,
      outputDir: path.join(root, "bundle"),
      testFiles: { unit: ["unit.test.mjs"], security: ["security.test.mjs"] },
      suiteRunner: async ({ name }) => ({ name, passed: true, exitCode: 0, durationMs: 1, outputHash: "d".repeat(64), outputPreview: "fixture", subtests: name === "unit" ? comboSubtests : subtestsFor(name) }),
      provenanceReport,
      environment,
      sourceRevision
    });
    const testResults = JSON.parse(await fs.readFile(path.join(result.outputDir, "test-results.json"), "utf8"));
    const statusOf = (testId) => testResults.tests.find((entry) => entry.testId === testId)?.status;
    assert.equal(statusOf("BEH-GATE-004"), "PASS");
    assert.equal(statusOf("BEH-GATE-005"), "PASS");
    assert.equal(statusOf("SEC-RISK-001"), "PASS");
    assert.equal(statusOf("SEC-RISK-002"), "PASS");
    assert.equal(statusOf("SEC-RISK-003"), "PASS");
    assert.equal(statusOf("SEC-SIMPLIFY-001"), "FAIL");
    assert.equal(statusOf("SEC-SIMPLIFY-002"), "FAIL");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
test("runCertificationSuite parses real --test-reporter=tap output into per-subtest pass/fail records", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ds4-evo-cert-tap-"));
  try {
    await fs.writeFile(path.join(root, "fixture.test.mjs"), [
      "import test from \"node:test\";",
      "import assert from \"node:assert/strict\";",
      "test(\"BEH-GATE-004/005 combo passes\", () => { assert.ok(true); });",
      "test(\"intentionally fails for fixture\", () => { assert.fail(\"expected failure\"); });"
    ].join("\n"));
    const result = await runCertificationSuite({ name: "fixture", files: ["fixture.test.mjs"], repositoryRoot: root });
    assert.equal(result.passed, false);
    assert.notEqual(result.exitCode, 0);
    assert.equal(result.subtests.length, 2);
    assert.equal(result.subtests.find((s) => s.title.includes("combo passes"))?.ok, true);
    assert.equal(result.subtests.find((s) => s.title.includes("intentionally fails"))?.ok, false);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
test("a subtest whose title lacks a requirement ID gives no credit, and a passing suite with a genuinely failed subtest still fails that ID", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ds4-evo-cert-partial-"));
  try {
    const unitSubtests = subtestsFor("unit");
    unitSubtests[0] = { title: unitSubtests[0].title, ok: false };
    const result = await createCertificationBundle({
      repositoryRoot: root,
      outputDir: path.join(root, "bundle"),
      testFiles: { unit: ["unit.test.mjs"], security: ["security.test.mjs"] },
      suiteRunner: async ({ name }) => ({ name, passed: true, exitCode: 0, durationMs: 1, outputHash: "c".repeat(64), outputPreview: "fixture", subtests: name === "unit" ? unitSubtests : subtestsFor(name) }),
      provenanceReport,
      environment,
      sourceRevision
    });
    assert.equal(result.decision.decision, "FAIL");
    assert.ok(result.decision.hardFailures.includes(`REQUIRED_TEST_FAIL:${unitSubtests[0].title}`));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

function liveEvidenceFixture(overrides = {}) {
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
    sourceRevision: "fixture+sha256:test",
    decidedAt: "2026-07-22T12:00:00.000Z",
    ...overrides
  };
}

test("BEH-CERT-001 Level B can pass offline with mode offline-selftest", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ds4-evo-cert-offline-"));
  try {
    const result = await createCertificationBundle({
      repositoryRoot: root,
      outputDir: path.join(root, "bundle"),
      now: () => new Date("2026-01-01T00:00:00.000Z"),
      testFiles: { unit: ["unit.test.mjs"], security: ["security.test.mjs"] },
      suiteRunner: async ({ name }) => ({ name, passed: true, exitCode: 0, durationMs: 1, outputHash: "a".repeat(64), outputPreview: "ok", subtests: subtestsFor(name) }),
      provenanceReport,
      environment,
      sourceRevision
    });
    assert.equal(result.decision.decision, "PASS");
    assert.equal(result.decision.mode, "offline-selftest");
    assert.equal(result.decision.liveEvidence, null);
    const summary = JSON.parse(await fs.readFile(path.join(result.outputDir, "benchmark-summary.json"), "utf8"));
    assert.equal(summary.mode, "offline-selftest");
    assert.equal(summary.liveArmsExecuted, false);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("BEH-CERT-002 Level C fails without live evidence", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ds4-evo-cert-c-no-live-"));
  try {
    const levelCSubtests = LEVEL_C_TEST_CATALOG.filter((e) => e.suite === "unit").map((e) => ({ title: e.testId, ok: true }));
    const result = await createCertificationBundle({
      level: "C",
      live: true,
      repositoryRoot: root,
      outputDir: path.join(root, "bundle"),
      now: () => new Date("2026-01-01T00:00:00.000Z"),
      testFiles: { unit: ["unit.test.mjs"], security: ["security.test.mjs"] },
      suiteRunner: async ({ name }) => ({ name, passed: true, exitCode: 0, durationMs: 1, outputHash: "a".repeat(64), outputPreview: "ok", subtests: name === "unit" ? levelCSubtests : subtestsFor(name) }),
      provenanceReport,
      environment,
      sourceRevision
    });
    assert.equal(result.decision.decision, "FAIL");
    assert.ok(result.decision.hardFailures.includes("LIVE_EVIDENCE_MISSING"));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("BEH-CERT-003 Level C passes with valid critic live evidence", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ds4-evo-cert-c-live-"));
  try {
    const levelCSubtests = LEVEL_C_TEST_CATALOG.filter((e) => e.suite === "unit").map((e) => ({ title: e.testId, ok: true }));
    const result = await createCertificationBundle({
      level: "C",
      live: true,
      liveEvidence: liveEvidenceFixture(),
      repositoryRoot: root,
      outputDir: path.join(root, "bundle"),
      now: () => new Date("2026-01-01T00:00:00.000Z"),
      testFiles: { unit: ["unit.test.mjs"], security: ["security.test.mjs"] },
      suiteRunner: async ({ name }) => ({ name, passed: true, exitCode: 0, durationMs: 1, outputHash: "a".repeat(64), outputPreview: "ok", subtests: name === "unit" ? levelCSubtests : subtestsFor(name) }),
      provenanceReport,
      environment,
      sourceRevision
    });
    assert.equal(result.decision.decision, "PASS");
    assert.equal(result.decision.mode, "live");
    assert.ok(result.decision.liveEvidence !== null);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("BEH-CERT-004 Level D fails with only mock evidence", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ds4-evo-cert-d-mock-"));
  try {
    const result = await createCertificationBundle({
      level: "D",
      live: true,
      liveEvidence: null,
      repositoryRoot: root,
      outputDir: path.join(root, "bundle"),
      now: () => new Date("2026-01-01T00:00:00.000Z"),
      testFiles: { unit: ["unit.test.mjs"], security: ["security.test.mjs"] },
      suiteRunner: async ({ name }) => ({ name, passed: true, exitCode: 0, durationMs: 1, outputHash: "a".repeat(64), outputPreview: "ok", subtests: subtestsFor(name) }),
      provenanceReport,
      environment,
      sourceRevision
    });
    assert.equal(result.decision.decision, "FAIL");
    assert.ok(result.decision.hardFailures.includes("LIVE_EVIDENCE_MISSING"));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("BEH-CERT-005 Level D validates success threshold and rollback", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ds4-evo-cert-d-threshold-"));
  try {
    const tooFewPassed = liveEvidenceFixture({ runsRequested: 3, runsCompleted: 3, runsPassed: 1, rollbackDrillPassed: false });
    const result = await createCertificationBundle({
      level: "D",
      live: true,
      liveEvidence: tooFewPassed,
      repositoryRoot: root,
      outputDir: path.join(root, "bundle"),
      now: () => new Date("2026-01-01T00:00:00.000Z"),
      testFiles: { unit: ["unit.test.mjs"], security: ["security.test.mjs"] },
      suiteRunner: async ({ name }) => ({ name, passed: true, exitCode: 0, durationMs: 1, outputHash: "a".repeat(64), outputPreview: "ok", subtests: subtestsFor(name) }),
      provenanceReport,
      environment,
      sourceRevision
    });
    assert.equal(result.decision.decision, "FAIL");
    assert.ok(result.decision.hardFailures.includes("LIVE_SUCCESS_RATE_BELOW_THRESHOLD"));
    assert.ok(result.decision.hardFailures.includes("LIVE_ROLLBACK_DRILL_FAILED"));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("SEC-CERT-001 live artifact hashes are verified", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ds4-evo-cert-sec-hash-"));
  const artifactsDir = await fs.mkdtemp(path.join(os.tmpdir(), "ds4-evo-cert-sec-hash-art-"));
  try {
    const levelCSubtests = LEVEL_C_TEST_CATALOG.filter((e) => e.suite === "unit").map((e) => ({ title: e.testId, ok: true }));
    const evidence = liveEvidenceFixture({
      runArtifacts: [{ runId: "run-001", artifactHash: "wrong".padEnd(64, "0"), passed: true }]
    });
    const result = await createCertificationBundle({
      level: "C",
      live: true,
      liveEvidence: evidence,
      liveArtifactsDir: artifactsDir,
      repositoryRoot: root,
      outputDir: path.join(root, "bundle"),
      now: () => new Date("2026-01-01T00:00:00.000Z"),
      testFiles: { unit: ["unit.test.mjs"], security: ["security.test.mjs"] },
      suiteRunner: async ({ name }) => ({ name, passed: true, exitCode: 0, durationMs: 1, outputHash: "a".repeat(64), outputPreview: "ok", subtests: name === "unit" ? levelCSubtests : subtestsFor(name) }),
      provenanceReport,
      environment,
      sourceRevision
    });
    assert.ok(result.decision.hardFailures.includes("LIVE_EVIDENCE_INVALID:ARTIFACT_HASH_MISMATCH"),
      `expected ARTIFACT_HASH_MISMATCH failure, got: ${JSON.stringify(result.decision.hardFailures)}`);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(artifactsDir, { recursive: true, force: true });
  }
});

test("SEC-CERT-002 evidence from another source revision rejected", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ds4-evo-cert-sec-rev-"));
  try {
    const levelCSubtests = LEVEL_C_TEST_CATALOG.filter((e) => e.suite === "unit").map((e) => ({ title: e.testId, ok: true }));
    const evidence = liveEvidenceFixture({ sourceRevision: "different-revision+sha256:abc" });
    const result = await createCertificationBundle({
      level: "C",
      live: true,
      liveEvidence: evidence,
      repositoryRoot: root,
      outputDir: path.join(root, "bundle"),
      now: () => new Date("2026-01-01T00:00:00.000Z"),
      testFiles: { unit: ["unit.test.mjs"], security: ["security.test.mjs"] },
      suiteRunner: async ({ name }) => ({ name, passed: true, exitCode: 0, durationMs: 1, outputHash: "a".repeat(64), outputPreview: "ok", subtests: name === "unit" ? levelCSubtests : subtestsFor(name) }),
      provenanceReport,
      environment,
      sourceRevision
    });
    assert.equal(result.decision.decision, "FAIL");
    assert.ok(result.decision.hardFailures.includes("LIVE_CANONICAL_REPOSITORY_MUTATED"));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
