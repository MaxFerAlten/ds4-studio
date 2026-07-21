/** Test origin: DS4 acceptance contract sections 3 and 24-29. */

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createCertificationBundle, LEVEL_B_TEST_CATALOG } from "./evolutionCertification.mjs";

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

test("acceptance evidence bundle contains all eight required artifacts and passes only complete evidence", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ds4-evo-cert-"));
  try {
    const result = await createCertificationBundle({
      repositoryRoot: root,
      outputDir: path.join(root, "bundle"),
      now: () => new Date("2026-01-01T00:00:00.000Z"),
      testFiles: { unit: ["unit.test.mjs"], security: ["security.test.mjs"] },
      suiteRunner: async ({ name }) => ({ name, passed: true, exitCode: 0, durationMs: 1, outputHash: "a".repeat(64), outputPreview: "ok" }),
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
      suiteRunner: async ({ name }) => ({ name, passed: name !== "security", exitCode: name === "security" ? 1 : 0, durationMs: 1, outputHash: "b".repeat(64), outputPreview: "fixture" }),
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
