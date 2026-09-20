/**
 * FI-006 / FI-007 (formal hardening) — versioned EPI regression manifest.
 *
 * The registry (`EPI_REGRESSION_SUITE`) records id/module/testName/semanticScenario.
 * This module derives a CANONICAL manifest from it: a per-entry SHA-256 over
 * `id␟module␟testName␟semanticScenario` and a global `EPI_MANIFEST_SHA256` over the
 * ordered canonical entries.
 *
 * The manifest gives the certification a stable identity for "the EPI-001..068 suite".
 * A substantial semantic change must introduce a NEW EPI id (never silently reuse or
 * mutate an existing one); if the meaning of an id changes, so does its testName /
 * semanticScenario and therefore the manifest hash — the certification cannot claim
 * "the same suite" across two releases with different hashes.
 */

import { createHash } from "node:crypto";

import { EPI_REGRESSION_SUITE } from "./epistemicRegressionSuite.mjs";

export const EPI_MANIFEST_SCHEMA = "ds4_epistemic_regression_manifest_v1";
export const EPI_MANIFEST_REVISION = 1;

/** Canonical per-entry hash over `id␟module␟testName␟semanticScenario`. */
export function scenarioSha256(entry) {
  const canonical = `${entry.id}\u241F${entry.module}\u241F${entry.testName}\u241F${entry.semanticScenario}`;
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

/** Global manifest hash over the ordered canonical entry block. */
export function epiManifestSha256(entries) {
  const canonicalBlock = entries
    .map((e) => `${e.id}\u241F${e.module}\u241F${e.testName}\u241F${e.semanticScenario}`)
    .join("\n");
  return createHash("sha256").update(canonicalBlock, "utf8").digest("hex");
}

export function buildEpicRegressionManifest() {
  const entries = EPI_REGRESSION_SUITE.map((entry) => ({
    id: entry.id,
    module: entry.module,
    testName: entry.testName,
    semanticScenario: entry.semanticScenario,
    scenarioSha256: scenarioSha256(entry)
  }));
  const manifestSha256 = epiManifestSha256(entries);
  return {
    schema: EPI_MANIFEST_SCHEMA,
    revision: EPI_MANIFEST_REVISION,
    count: entries.length,
    range: entries.length > 0 ? `${entries[0].id}..${entries[entries.length - 1].id}` : null,
    manifestSha256,
    entries
  };
}

export const EPI_MANIFEST = buildEpicRegressionManifest();
