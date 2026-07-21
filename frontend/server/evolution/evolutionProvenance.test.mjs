/** Test origin: DS4 acceptance requirements CR-001..006. */

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { scanEvolutionProvenance } from "./evolutionProvenance.mjs";

const HEADER = `/**
 * DS4 Evolution — independently designed clean-room implementation.
 * External source code or prompts copied: none.
 */\n`;

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ds4-evo-provenance-"));
  const productionDir = path.join(root, "frontend/server/evolution");
  await fs.mkdir(productionDir, { recursive: true });
  await fs.writeFile(path.join(productionDir, "sample.mjs"), `${HEADER}export const value = 1;\n`, "utf8");
  await fs.writeFile(path.join(productionDir, "sample.test.mjs"), "/** Test origin: DS4 acceptance requirement CR-003. */\n", "utf8");
  await fs.mkdir(path.join(root, "frontend"), { recursive: true });
  await fs.writeFile(path.join(root, "frontend/package.json"), JSON.stringify({ name: "fixture", dependencies: {} }), "utf8");
  const newFiles = [
    "frontend/server/evolution/provenance-manifest.json",
    "frontend/server/evolution/sample.mjs",
    "frontend/server/evolution/sample.test.mjs"
  ];
  await fs.writeFile(path.join(productionDir, "provenance-manifest.json"), JSON.stringify({
    schema: "ds4_clean_room_provenance_v1",
    change_id: "CR-TEST-001",
    requirements: ["CR-001", "CR-002", "CR-003", "CR-004", "CR-005", "CR-006"],
    ds4_components_reused: [],
    external_code_copied: false,
    external_prompts_copied: false,
    external_tests_copied: false,
    new_files: newFiles,
    modified_files: [],
    author_attestation: "independently implemented from DS4 specifications",
    review_status: "test-fixture"
  }), "utf8");
  return { root, productionDir };
}

test("CR-001..006 clean-room scan accepts an independent, fully attested tree", async () => {
  const f = await fixture();
  try {
    const report = await scanEvolutionProvenance({ repositoryRoot: f.root, productionDir: f.productionDir });
    assert.equal(report.passed, true);
    assert.equal(report.checks.length, 6);
    assert.deepEqual(report.violations, []);
  } finally {
    await fs.rm(f.root, { recursive: true, force: true });
  }
});
test("CR-001/002 dependency or import contamination fails closed", async () => {
  const f = await fixture();
  try {
    await fs.writeFile(path.join(f.productionDir, "sample.mjs"), `${HEADER}import value from "sia-agent";\nexport default value;\n`, "utf8");
    await fs.writeFile(path.join(f.root, "frontend/package.json"), JSON.stringify({ dependencies: { "sia-agent": "1.0.0" } }), "utf8");
    const report = await scanEvolutionProvenance({ repositoryRoot: f.root, productionDir: f.productionDir });
    assert.equal(report.passed, false);
    assert.equal(report.checks.find((entry) => entry.testId === "CR-001").status, "FAIL");
    assert.equal(report.checks.find((entry) => entry.testId === "CR-002").status, "FAIL");
  } finally {
    await fs.rm(f.root, { recursive: true, force: true });
  }
});

test("CR-003/004 missing direct tests or manifest entries fail closed", async () => {
  const f = await fixture();
  try {
    await fs.writeFile(path.join(f.productionDir, "extra.mjs"), "export const unreviewed = true;\n", "utf8");
    const report = await scanEvolutionProvenance({ repositoryRoot: f.root, productionDir: f.productionDir });
    assert.equal(report.passed, false);
    assert.ok(report.violations.some((value) => value.includes("PROVENANCE_HEADER_MISSING")));
    assert.ok(report.violations.some((value) => value.includes("UNDECLARED_IMPLEMENTATION_FILE")));
  } finally {
    await fs.rm(f.root, { recursive: true, force: true });
  }
});
