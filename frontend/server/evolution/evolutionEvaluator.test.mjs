/** Test origin: DS4 acceptance requirements BEH-EVAL-001..004 and SEC-EVAL-003..004. */

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createCommandEvaluator, EvolutionEvaluatorRegistry, securityPolicyEvaluator } from "./evolutionEvaluator.mjs";

function context(overrides = {}) {
  return {
    revision: 1,
    candidate: { audit: { filesChanged: 1, addedLines: 2, deletedLines: 0 }, securityViolations: [] },
    taskContract: {
      budgets: { maxFilesChanged: 2, maxAddedLines: 10, maxDeletedLines: 10, maxWallTimeMsPerRevision: 1_000 },
      evaluators: [
        { id: "correctness", required: true, configuration: { type: "fixture-pass" } },
        { id: "optional", required: false, configuration: { type: "fixture-optional" } }
      ]
    },
    ...overrides
  };
}

const reproducibility = { commandHash: "a".repeat(64), environmentHash: "b".repeat(64), seed: 42 };

test("BEH-EVAL-001 aggregates required and optional evaluators deterministically", async () => {
  const registry = new EvolutionEvaluatorRegistry({
    adapters: {
      "fixture-pass": async () => ({ status: "passed", metrics: { correct: true }, violations: [], artifacts: [], reproducibility }),
      "fixture-optional": async () => ({ status: "failed", metrics: { style: false }, violations: ["STYLE"], artifacts: [], reproducibility })
    }
  });
  const result = await registry.evaluateAll(context());
  assert.equal(result.status, "partial");
  assert.deepEqual(result.aggregateMetrics, { correct: true, style: false });
  assert.deepEqual(result.hardFailures, []);
});

test("SEC-EVAL-004 a required evaluator error is a hard failure", async () => {
  const registry = new EvolutionEvaluatorRegistry({ adapters: { "fixture-pass": async () => { throw new Error("offline"); } } });
  const task = context();
  task.taskContract.evaluators = [task.taskContract.evaluators[0]];
  const result = await registry.evaluateAll(task);
  assert.equal(result.status, "error");
  assert.ok(result.hardFailures.includes("REQUIRED_EVALUATOR_ERROR:correctness"));
});

test("BEH-EVAL-004 missing reproducibility metadata blocks required output", async () => {
  const registry = new EvolutionEvaluatorRegistry({
    adapters: { "fixture-pass": async () => ({ status: "passed", metrics: { correct: true }, violations: [], artifacts: [], reproducibility: {} }) }
  });
  const task = context();
  task.taskContract.evaluators = [task.taskContract.evaluators[0]];
  const result = await registry.evaluateAll(task);
  assert.ok(result.hardFailures.includes("REPRODUCIBILITY_METADATA_MISSING:correctness"));
});

test("SEC-EVAL-003 candidate-created evaluation fields are ignored", async () => {
  const registry = new EvolutionEvaluatorRegistry({
    adapters: { "fixture-pass": async () => ({ status: "failed", metrics: { correct: false }, violations: ["REAL_FAILURE"], artifacts: [], reproducibility }) }
  });
  const task = context({ candidate: { evaluation: { status: "passed", metrics: { correct: true } } } });
  task.taskContract.evaluators = [task.taskContract.evaluators[0]];
  const result = await registry.evaluateAll(task);
  assert.equal(result.status, "failed");
  assert.equal(result.aggregateMetrics.correct, false);
});

test("metric conflicts fail closed", async () => {
  const registry = new EvolutionEvaluatorRegistry({
    adapters: {
      left: async () => ({ status: "passed", metrics: { score: 1 }, violations: [], artifacts: [], reproducibility }),
      right: async () => ({ status: "passed", metrics: { score: 2 }, violations: [], artifacts: [], reproducibility })
    }
  });
  const task = context();
  task.taskContract.evaluators = [
    { id: "left", required: true, configuration: { type: "left" } },
    { id: "right", required: true, configuration: { type: "right" } }
  ];
  const result = await registry.evaluateAll(task);
  assert.ok(result.hardFailures.includes("METRIC_CONFLICT:score"));
});

test("command evaluator cannot override the task timeout budget", async () => {
  let received;
  const evaluator = createCommandEvaluator({
    execute: async (input) => {
      received = input;
      return {
        status: "success",
        stdoutPreview: JSON.stringify({ status: "passed", metrics: { correct: true } }),
        stdoutArtifact: null,
        stderrArtifact: null,
        violations: [],
        reproducibility
      };
    }
  });
  await evaluator({
    runId: "run",
    revision: 1,
    candidateWorkspace: "/workspace",
    descriptor: {
      id: "correctness",
      required: true,
      configuration: { executable: "node", args: [], timeoutMs: 20_000 }
    },
    taskContract: { budgets: { maxWallTimeMsPerRevision: 1_000 } },
    executionLimits: { timeoutMs: 50_000, maxOutputBytes: 32 }
  });
  assert.equal(received.limits.timeoutMs, 1_000);
  assert.equal(received.limits.maxOutputBytes, 32);
});

test("security policy scans configured candidate files instead of trusting candidate metadata", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "ds4-evo-security-policy-"));
  try {
    const file = path.join(directory, "frontend", "server");
    await fs.mkdir(file, { recursive: true });
    await fs.writeFile(path.join(file, "example.mjs"), "import express from 'express';\napp.listen(3000);\n", "utf8");
    const result = await securityPolicyEvaluator({
      candidateWorkspace: directory,
      candidate: { securityViolations: [] },
      descriptor: {
        id: "security-policy",
        configuration: {
          type: "security-policy",
          files: ["frontend/server/example.mjs"],
          forbiddenPatterns: [
            { code: "APP_LISTEN_FORBIDDEN", pattern: "\\bapp\\.listen\\s*\\(" },
            { code: "EXPRESS_IMPORT_FORBIDDEN", pattern: "\\bfrom\\s+[\\\"']express[\\\"']" }
          ]
        }
      }
    });
    assert.equal(result.status, "failed");
    assert.equal(result.metrics.security_passed, false);
    assert.deepEqual(result.violations, [
      "APP_LISTEN_FORBIDDEN:frontend/server/example.mjs",
      "EXPRESS_IMPORT_FORBIDDEN:frontend/server/example.mjs"
    ]);
    assert.ok(result.reproducibility.environmentHash);
    assert.equal(result.reproducibility.environmentHash, result.reproducibility.commandHash);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("security policy passes a side-effect-free fixture", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "ds4-evo-security-policy-"));
  try {
    await fs.mkdir(path.join(directory, "frontend", "server"), { recursive: true });
    await fs.writeFile(path.join(directory, "frontend", "server", "example.mjs"), "export const ok = true;\n", "utf8");
    const result = await securityPolicyEvaluator({
      candidateWorkspace: directory,
      descriptor: {
        id: "security-policy",
        configuration: {
          type: "security-policy",
          files: ["frontend/server/example.mjs"],
          forbiddenPatterns: [{ code: "APP_LISTEN_FORBIDDEN", pattern: "\\bapp\\.listen\\s*\\(" }]
        }
      }
    });
    assert.equal(result.status, "passed");
    assert.equal(result.metrics.security_passed, true);
    assert.deepEqual(result.violations, []);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("security policy protects legacy contracts with no explicit pattern configuration", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "ds4-evo-security-policy-"));
  try {
    await fs.mkdir(path.join(directory, "frontend", "server"), { recursive: true });
    await fs.writeFile(path.join(directory, "frontend", "server", "example.mjs"), "app.listen(3000);\n", "utf8");
    const result = await securityPolicyEvaluator({
      candidateWorkspace: directory,
      candidate: {
        audit: { changes: [{ path: "frontend/server/example.mjs" }] }
      },
      descriptor: { id: "security-policy", configuration: { type: "security-policy" } }
    });
    assert.equal(result.status, "failed");
    assert.deepEqual(result.violations, ["APP_LISTEN_FORBIDDEN:frontend/server/example.mjs"]);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
