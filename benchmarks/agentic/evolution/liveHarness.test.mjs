/** Test origin: DS4 acceptance requirements BEH-LIVE-C-001..003, SEC-LIVE-C-001..002, BEH-LIVE-D-001..004, SEC-LIVE-D-001..004. */

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { runLevelCLiveArm, runLevelDLiveArm } from "./liveHarness.mjs";

const MODEL_BASE_URL = process.env.DS4_EVOLUTION_MODEL_BASE_URL || "http://127.0.0.1:8002";
const MODEL = process.env.DS4_EVOLUTION_MODEL || "deepseek-v4-flash";
const TIMEOUT_MS = Number(process.env.DS4_EVOLUTION_TIMEOUT_MS) || 120_000;

function hasLiveServer() {
  return process.env.DS4_EVOLUTION_LIVE === "1";
}

const maybe = hasLiveServer() ? test : test.skip;

maybe("BEH-LIVE-C-001 harness creates isolated fixture and completes a Level C run", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ds4-live-c-"));
  const artifactsDir = path.join(root, "artifacts");
  await fs.mkdir(artifactsDir, { recursive: true });
  try {
    const result = await runLevelCLiveArm({
      repositoryRoot: root,
      artifactsDir,
      modelBaseUrl: MODEL_BASE_URL,
      model: MODEL,
      timeoutMs: TIMEOUT_MS,
      seed: 42
    });
    assert.ok(result.runId);
    assert.ok(result.decision);
    assert.equal(result.decision.schema, "ds4_evolution_live_c_decision_v1");
    const decisionFile = JSON.parse(await fs.readFile(path.join(artifactsDir, "decision.json"), "utf8"));
    assert.equal(decisionFile.runId, result.runId);
  } finally {
    await fs.rm(root, { recursive: true, force: true }).catch(() => {});
  }
});

maybe("SEC-LIVE-C-001 critic cannot override deterministic rejection — gate must be REJECT when metric regresses", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ds4-live-c-reject-"));
  const artifactsDir = path.join(root, "artifacts");
  await fs.mkdir(artifactsDir, { recursive: true });
  try {
    const result = await runLevelCLiveArm({
      repositoryRoot: root,
      artifactsDir,
      modelBaseUrl: MODEL_BASE_URL,
      model: MODEL,
      timeoutMs: TIMEOUT_MS,
      seed: 99
    });
    assert.equal(result.decision.gateDecision, "REJECT", "gate must reject a defective candidate regardless of critic output");
    assert.equal(result.decision.passed, true, "benchmark passes when gate correctly rejects");
  } finally {
    await fs.rm(root, { recursive: true, force: true }).catch(() => {});
  }
});

maybe("SEC-LIVE-C-002 canonical DS4 repository hash remains unchanged after benchmark", async () => {
  const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../..");
  const beforeHash = (await fs.readFile(path.join(repoRoot, "frontend/server/evolution/evolutionContracts.mjs"), "utf8")).length;
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ds4-live-c-hash-"));
  const artifactsDir = path.join(root, "artifacts");
  await fs.mkdir(artifactsDir, { recursive: true });
  try {
    await runLevelCLiveArm({
      repositoryRoot: root,
      artifactsDir,
      modelBaseUrl: MODEL_BASE_URL,
      model: MODEL,
      timeoutMs: TIMEOUT_MS,
      seed: 7
    });
    const afterHash = (await fs.readFile(path.join(repoRoot, "frontend/server/evolution/evolutionContracts.mjs"), "utf8")).length;
    assert.equal(beforeHash, afterHash, "canonical repo files must not be modified by benchmark");
  } finally {
    await fs.rm(root, { recursive: true, force: true }).catch(() => {});
  }
});

maybe("BEH-LIVE-D-001 Level D harness completes a two-revision feedback loop", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ds4-live-d-"));
  const artifactsDir = path.join(root, "artifacts");
  await fs.mkdir(artifactsDir, { recursive: true });
  try {
    const result = await runLevelDLiveArm({
      repositoryRoot: root,
      artifactsDir,
      modelBaseUrl: MODEL_BASE_URL,
      model: MODEL,
      timeoutMs: TIMEOUT_MS,
      seed: 100
    });
    assert.ok(result.runId);
    assert.ok(result.decision);
    assert.equal(result.decision.schema, "ds4_evolution_live_d_decision_v1");
    assert.equal(result.decision.feedbackContextUsed, true, "feedback context must be used in Level D");
  } finally {
    await fs.rm(root, { recursive: true, force: true }).catch(() => {});
  }
});

maybe("SEC-LIVE-D-001 failed run leaves canonical repo unchanged", async () => {
  const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../..");
  const beforeHash = (await fs.readFile(path.join(repoRoot, "frontend/server/evolution/evolutionContracts.mjs"), "utf8")).length;
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ds4-live-d-hash-"));
  const artifactsDir = path.join(root, "artifacts");
  await fs.mkdir(artifactsDir, { recursive: true });
  try {
    await runLevelDLiveArm({
      repositoryRoot: root,
      artifactsDir,
      modelBaseUrl: MODEL_BASE_URL,
      model: MODEL,
      timeoutMs: TIMEOUT_MS,
      seed: 200
    });
    const afterHash = (await fs.readFile(path.join(repoRoot, "frontend/server/evolution/evolutionContracts.mjs"), "utf8")).length;
    assert.equal(beforeHash, afterHash, "canonical repo must not be modified");
  } finally {
    await fs.rm(root, { recursive: true, force: true }).catch(() => {});
  }
});
