import test from "node:test";
import assert from "node:assert/strict";

import { EPI_REGRESSION_SUITE } from "./epistemicRegressionSuite.mjs";
import {
  EPI_MANIFEST,
  EPI_MANIFEST_REVISION,
  EPI_MANIFEST_SCHEMA,
  buildEpicRegressionManifest,
  epiManifestSha256,
  scenarioSha256
} from "./epistemicRegressionManifest.mjs";

test("FI-011: manifest covers every registered EPI entry contiguously", () => {
  assert.equal(EPI_MANIFEST.schema, EPI_MANIFEST_SCHEMA);
  assert.equal(EPI_MANIFEST.revision, EPI_MANIFEST_REVISION);
  assert.equal(EPI_MANIFEST.count, EPI_REGRESSION_SUITE.length);
  assert.equal(EPI_MANIFEST.range, "EPI-001..EPI-076");
  assert.deepEqual(
    EPI_MANIFEST.entries.map((e) => e.id),
    EPI_REGRESSION_SUITE.map((e) => e.id)
  );
});

test("FI-011: per-entry and global hashes are stable and canonical", () => {
  assert.equal(buildEpicRegressionManifest().manifestSha256, buildEpicRegressionManifest().manifestSha256);
  assert.match(EPI_MANIFEST.manifestSha256, /^[0-9a-f]{64}$/);
  assert.match(EPI_MANIFEST.entries[0].scenarioSha256, /^[0-9a-f]{64}$/);
  // Canonical per-entry hash is independent of property ordering.
  const entry = EPI_REGRESSION_SUITE[0];
  assert.equal(
    scenarioSha256(entry),
    scenarioSha256({ id: entry.id, module: entry.module, testName: entry.testName, semanticScenario: entry.semanticScenario })
  );
});

test("FI-012: mutating a semantic scenario changes the manifest hash", () => {
  const original = buildEpicRegressionManifest();
  const mutated = original.entries.map((e) =>
    e.id === "EPI-001" ? { ...e, semanticScenario: "a DIFFERENT meaning for EPI-001" } : e
  );
  assert.notEqual(epiManifestSha256(mutated), original.manifestSha256);
});

test("FI-012: mutating a testName changes the manifest hash", () => {
  const original = buildEpicRegressionManifest();
  const mutated = original.entries.map((e) =>
    e.id === "EPI-002" ? { ...e, testName: "some other test title" } : e
  );
  assert.notEqual(epiManifestSha256(mutated), original.manifestSha256);
});
