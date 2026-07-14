import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  SAGE_POLICY_PATH,
  normalizeSageOrchestratorPayload,
  runSageOrchestrator,
  runSageRuntimeValidator,
  sagePolicyDescriptor,
  sageV2Enabled,
  sageV2Readiness
} from "./sageOrchestratorBridge.mjs";

function validPayload() {
  return {
    content: "runtime document",
    isError: false,
    candidateReport: { kind: "math_report" },
    execution: { ok: true, exitCode: 0, timedOut: false },
    validationEvidence: {
      source: "sage_runtime_validator",
      authoritative: true,
      passed: true,
      checks: [{ code: "EXACT", passed: true }],
      errors: [],
      normalizedReport: { kind: "math_report", authority: "runtime" }
    },
    artifacts: [{ kind: "function_plot", name: "plot.png" }]
  };
}

test("feature flag requires an available orchestrator module", async () => {
  const previous = process.env.DS4_SAGE_ORCHESTRATION_V2;
  process.env.DS4_SAGE_ORCHESTRATION_V2 = "true";
  const tmp = await mkdtemp(path.join(os.tmpdir(), "sage-v2-missing-"));
  try {
    assert.equal(sageV2Enabled(), true);
    assert.equal(sageV2Enabled({ modulePath: path.join(tmp, "missing.py") }), false);
  } finally {
    if (previous === undefined) delete process.env.DS4_SAGE_ORCHESTRATION_V2;
    else process.env.DS4_SAGE_ORCHESTRATION_V2 = previous;
    await rm(tmp, { recursive: true, force: true });
  }
});

test("readiness fails when the feature is disabled", async () => {
  const previous = process.env.DS4_SAGE_ORCHESTRATION_V2;
  delete process.env.DS4_SAGE_ORCHESTRATION_V2;
  try {
    assert.deepEqual(await sageV2Readiness(), {
      ready: false,
      code: "SAGE_ORCHESTRATOR_UNAVAILABLE"
    });
  } finally {
    if (previous !== undefined) process.env.DS4_SAGE_ORCHESTRATION_V2 = previous;
  }
});

test("valid bridge JSON is normalized", async () => {
  const result = await runSageOrchestrator({ code: "1+1" }, {
    bridgeRunner: async () => ({ exitCode: 0, stdout: JSON.stringify(validPayload()), stderr: "" })
  });
  assert.equal(result.isError, false);
  assert.equal(result.execution.ok, true);
  assert.equal(result.validationEvidence.authoritative, true);
});

test("invalid bridge JSON is controlled", async () => {
  const result = await runSageOrchestrator({}, {
    bridgeRunner: async () => ({ exitCode: 0, stdout: "not json", stderr: "secret" })
  });
  assert.equal(result.isError, true);
  assert.doesNotMatch(result.content, /not json|secret/);
});

test("nonzero bridge exit is controlled and does not expose stderr", async () => {
  const result = await runSageOrchestrator({}, {
    bridgeRunner: async () => ({ exitCode: 7, stdout: "", stderr: "private traceback" })
  });
  assert.equal(result.isError, true);
  assert.equal(result.execution.exitCode, 7);
  assert.doesNotMatch(result.content, /private traceback/);
});

test("bridge timeout is controlled", async () => {
  const result = await runSageOrchestrator({}, {
    bridgeRunner: async () => ({ exitCode: null, stdout: "", stderr: "", timedOut: true })
  });
  assert.equal(result.execution.timedOut, true);
  assert.equal(result.isError, true);
});

test("untrusted metadata cannot claim runtime authority", () => {
  const result = normalizeSageOrchestratorPayload({
    ...validPayload(),
    validationEvidence: { authoritative: true, passed: true, checks: [{ passed: true }] },
    publication: { publishable: true }
  });
  assert.equal(result.validationEvidence, null);
  assert.equal("publication" in result, false);
});

test("bridge preserves artifact descriptors", () => {
  const result = normalizeSageOrchestratorPayload(validPayload());
  assert.deepEqual(result.artifacts, [{ kind: "function_plot", name: "plot.png" }]);
});

test("runtime-owned evidence is accepted without trusting model claims", async () => {
  const evidence = validPayload().validationEvidence;
  const result = await runSageRuntimeValidator({ validationEvidence: evidence });
  assert.equal(result.authoritative, true);
  assert.equal(result.passed, true);
  assert.equal(result.checks.length, 1);
});

test("runtime validator subprocess returns structured authoritative checks", async () => {
  const result = await runSageRuntimeValidator({
    taskType: "evaluate",
    execution: { ok: true, exitCode: 0, timedOut: false },
    candidateReport: { kind: "math_report", title: "Result", sections: [] },
    artifacts: []
  });
  assert.equal(result.authoritative, true);
  assert.equal(result.passed, true);
  assert.ok(result.checks.length > 0);
  assert.equal(result.normalizedReport.authority, "runtime");
});

test("bridge policy descriptor points to the canonical skill and hashes exact content", async () => {
  const raw = await readFile(SAGE_POLICY_PATH, "utf8");
  const descriptor = sagePolicyDescriptor();

  assert.match(descriptor.path, /skills\/sage\/SKILL\.md$/);
  assert.equal(descriptor.ready, true);
  assert.equal(descriptor.revision, createHash("sha1").update(raw).digest("hex"));
});

test("policy revision mismatch fails before orchestration", async () => {
  let called = false;
  const result = await runSageOrchestrator({ code: "1+1" }, {
    policyRevision: "0".repeat(40),
    bridgeRunner: async () => {
      called = true;
      return { exitCode: 0, stdout: JSON.stringify(validPayload()), stderr: "" };
    }
  });

  assert.equal(called, false);
  assert.equal(result.isError, true);
  assert.equal(result.debug.bridgeError, "SAGE_POLICY_REVISION_MISMATCH");
});


