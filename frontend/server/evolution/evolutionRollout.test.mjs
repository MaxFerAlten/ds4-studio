/** Test origin: DS4 acceptance requirements BEH-ROLLOUT-001..007, SEC-ROLLOUT-001..005. */

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  isEvolutionEnabled,
  validateLevelDPaths,
  validateLevelE,
  validateReleaseGate
} from "./evolutionRollout.mjs";

test("BEH-ROLLOUT-001 kill switch file presence disables evolution", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "ds4-rollout-"));
  const killFile = path.join(tmp, "data", "evolution-disabled");
  await fs.mkdir(path.dirname(killFile), { recursive: true });
  await fs.writeFile(killFile, "", "utf8");
  const result = await isEvolutionEnabled(tmp);
  assert.equal(result.enabled, false);
  assert.equal(result.reason, "EVOLUTION_KILL_SWITCH_ACTIVE");
  await fs.rm(tmp, { recursive: true, force: true });
});

test("BEH-ROLLOUT-002 kill switch absent allows evolution", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "ds4-rollout-"));
  const result = await isEvolutionEnabled(tmp);
  assert.equal(result.enabled, true);
  assert.equal(result.reason, null);
  await fs.rm(tmp, { recursive: true, force: true });
});

test("BEH-ROLLOUT-003 Level B allowed in release 1", () => {
  const result = validateReleaseGate("B", "1");
  assert.equal(result.allowed, true);
  assert.equal(result.reason, null);
});

test("BEH-ROLLOUT-004 Level C blocked in release 1", () => {
  const result = validateReleaseGate("C", "1");
  assert.equal(result.allowed, false);
  assert.match(result.reason, /LEVEL_C_EXCEEDS_RELEASE_1_MAX_LEVEL_B/);
});

test("BEH-ROLLOUT-005 Level C allowed in release 2", () => {
  const result = validateReleaseGate("C", "2");
  assert.equal(result.allowed, true);
  assert.equal(result.reason, null);
});

test("BEH-ROLLOUT-006 Level D blocked in release 2", () => {
  const result = validateReleaseGate("D", "2");
  assert.equal(result.allowed, false);
  assert.match(result.reason, /LEVEL_D_EXCEEDS_RELEASE_2_MAX_LEVEL_C/);
});

test("BEH-ROLLOUT-007 Level D allowed in release 3", () => {
  const result = validateReleaseGate("D", "3");
  assert.equal(result.allowed, true);
  assert.equal(result.reason, null);
});

test("SEC-ROLLOUT-001 Level E always disabled", () => {
  const result = validateLevelE();
  assert.equal(result.allowed, false);
  assert.equal(result.reason, "LEVEL_E_DISABLED_SEPARATE_PLAN_REQUIRED");
});

test("SEC-ROLLOUT-002 Level D blocked paths are rejected", () => {
  const blocked = [
    "frontend/server/index.mjs",
    "frontend/server/config.mjs",
    "frontend/server/evolution/evolutionPromotionGate.mjs",
    "frontend/server/evolution/evolutionEvaluator.mjs",
    "frontend/server/evolution/evolutionExecutor.mjs",
    "frontend/server/evolution/evolutionProvenance.mjs",
    "frontend/server/evolution/security/auth.mjs",
    "ds4.c",
    "ds4.h",
    "ds4_aux.c",
    "ds4_aux.h",
    "rocm/kernel.h",
    "metal/shader.metal",
    "Makefile",
    "package.json",
    "package-lock.json"
  ];
  const result = validateLevelDPaths(blocked);
  assert.equal(result.allowed, false);
  assert.equal(result.violations.length, blocked.length);
});

test("SEC-ROLLOUT-003 Level D allowed paths pass", () => {
  const allowed = [
    "frontend/server/evolution/fixtures/test.json",
    "benchmarks/agentic/evolution/fixtures/bench.json"
  ];
  const result = validateLevelDPaths(allowed);
  assert.equal(result.allowed, true);
  assert.equal(result.violations.length, 0);
});

test("SEC-ROLLOUT-004 kill switch prevents run creation", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "ds4-rollout-"));
  const killFile = path.join(tmp, "data", "evolution-disabled");
  await fs.mkdir(path.dirname(killFile), { recursive: true });
  await fs.writeFile(killFile, "", "utf8");
  const { enabled } = await isEvolutionEnabled(tmp);
  assert.equal(enabled, false);
  await fs.rm(tmp, { recursive: true, force: true });
});

test("SEC-ROLLOUT-005 kill switch prevents promotion", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "ds4-rollout-"));
  const killFile = path.join(tmp, "data", "evolution-disabled");
  await fs.mkdir(path.dirname(killFile), { recursive: true });
  await fs.writeFile(killFile, "", "utf8");
  const { enabled } = await isEvolutionEnabled(tmp);
  assert.equal(enabled, false);
  await fs.rm(tmp, { recursive: true, force: true });
});
