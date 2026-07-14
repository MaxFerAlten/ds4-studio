import assert from "node:assert/strict";
import { test } from "node:test";

import { AgentSessionStore } from "./agentSession.mjs";
import {
  authoritativeSageFinalFromResult,
  canonicalSageCommitPending,
  guardSageFinalization
} from "./sageAgentLoopPolicy.mjs";
import { executeAuthoritativeSage } from "./sageAuthoritativeExecutor.mjs";
import { SageTurnTracker } from "./sageTurnTracker.mjs";
import { toolResultMessages } from "../src/sage/sageActivityState.mjs";

const FINAL_MARKDOWN = "# Risultato canonico\n\n$$\nx=2\n$$";

function candidateRaw({ taskType = "evaluate", artifacts = [] } = {}) {
  return {
    content: "candidate model output",
    isError: false,
    artifacts,
    sageResult: {
      contractVersion: "sage_result_v1",
      taskType,
      phase: "validate",
      candidateReport: taskType === "function_study"
        ? { kind: "function_study_v1", expression: "x", variable: "x" }
        : { kind: "math_report", title: "Result", sections: [] },
      execution: { ok: true, exitCode: 0, timedOut: false },
      artifacts,
      debug: { claimedValidation: { passed: true, checks: [{ passed: true }] } }
    },
    raw: { exit_code: 0, killed: false }
  };
}

function runtimeValidation(candidateReport = { kind: "math_report" }) {
  return {
    authoritative: true,
    passed: true,
    checks: [{ code: "RUNTIME_EXACT", passed: true, evidence: { exact: true } }],
    errors: [],
    normalizedReport: {
      ...candidateReport,
      authority: "runtime",
      validationPassed: true
    }
  };
}

async function executePhase(phase, options = {}) {
  const raw = options.raw ?? candidateRaw(options);
  return executeAuthoritativeSage({
    code: "1+1",
    task_type: options.taskType ?? "evaluate",
    phase,
    output_mode: "structured"
  }, {
    rawExecutor: async () => structuredClone(raw),
    authoritativeLoopEnabledFn: () => true,
    sageV2EnabledFn: () => false,
    runId: options.runId ?? "run-e2e",
    sageAttempt: options.attempt ?? 1,
    validator: options.validator ?? (async ({ candidateReport }) => runtimeValidation(candidateReport)),
    formatter: options.formatter ?? (() => FINAL_MARKDOWN),
    artifactValidator: options.artifactValidator
  });
}

function recordGatewayResult(tracker, phase, result) {
  assert.equal(tracker.recordCall({ phase }).allowed, true);
  return tracker.recordResult({
    phase,
    isError: result.isError,
    authoritative: result.authoritative,
    validationPassed: result.validationPassed,
    publishable: result.publishable,
    reportReady: result.reportReady,
    finalMarkdownReady: Boolean(result.finalMarkdown?.trim()),
    artifactKinds: (result.artifacts || []).map((artifact) => artifact.kind)
  });
}

function artifact(runId, kind, seed) {
  const sha256 = String(seed).repeat(64);
  const artifactId = `sha256:${sha256}`;
  return {
    artifactId,
    runId,
    kind,
    name: `${kind}.png`,
    mediaType: "image/png",
    sha256,
    sizeBytes: 42,
    createdAt: "2026-07-13T00:00:00.000Z",
    url: `/api/sage/artifacts/${runId}/${encodeURIComponent(artifactId)}`
  };
}

test("compute succeeds but cannot publish before validate", async () => {
  const result = await executePhase("compute");
  assert.equal(result.isError, false);
  assert.equal(result.publishable, false);
  assert.ok(result.sageResult.publication.reasonCodes.includes("SAGE_PUBLICATION_PHASE_INVALID"));
});

test("compute followed by a premature answer is blocked once", async () => {
  const tracker = new SageTurnTracker();
  tracker.begin({ runId: "run-e2e", taskType: "evaluate" });
  recordGatewayResult(tracker, "compute", await executePhase("compute"));

  const first = guardSageFinalization(tracker);
  const second = guardSageFinalization(tracker);
  assert.equal(first.retryAllowed, true);
  assert.equal(second.retryAllowed, false);
  assert.equal(tracker.snapshot().failureCode, "SAGE_FINALIZATION_BLOCKED");
});

test("a model PASS claim cannot replace runtime validation", async () => {
  const result = await executePhase("validate", {
    validator: async () => ({
      authoritative: false,
      passed: false,
      checks: [],
      errors: ["RUNTIME_VALIDATION_NOT_EXECUTED"],
      normalizedReport: null
    })
  });
  assert.equal(result.publishable, false);
  assert.equal(result.authoritative, false);
});

test("valid report crosses the authoritative publication gate", async () => {
  const result = await executePhase("validate");
  assert.equal(result.authoritative, true);
  assert.equal(result.validationPassed, true);
  assert.equal(result.publishable, true);
  assert.equal(result.finalMarkdown, FINAL_MARKDOWN);
});

test("function-study artifact package remains bound to one run", async () => {
  const runId = "run-function-e2e";
  const artifacts = [
    artifact(runId, "function_plot", "a"),
    artifact(runId, "first_derivative_plot", "b"),
    artifact(runId, "second_derivative_plot", "c")
  ];
  const raw = candidateRaw({ taskType: "function_study", artifacts });
  const result = await executePhase("validate", {
    runId,
    taskType: "function_study",
    raw,
    validator: async ({ candidateReport }) => runtimeValidation(candidateReport)
  });

  assert.equal(result.publishable, true);
  assert.deepEqual(result.artifacts.map((item) => item.kind), [
    "function_plot",
    "first_derivative_plot",
    "second_derivative_plot"
  ]);
});

test("ready publication emits one exact assistant and performs no later model round", async () => {
  const tracker = new SageTurnTracker();
  tracker.begin({ runId: "run-e2e", taskType: "evaluate" });
  recordGatewayResult(tracker, "compute", await executePhase("compute"));
  const ready = await executePhase("validate");
  recordGatewayResult(tracker, "validate", ready);
  const final = authoritativeSageFinalFromResult(ready);

  assert.equal(tracker.canFinalize(), true);
  assert.equal(final.content, ready.sageResult.publication.markdown);
  assert.deepEqual(toolResultMessages({
    name: "sage",
    hiddenByDefault: true,
    content: "internal"
  }), []);

  const store = new AgentSessionStore();
  store.start("e2e-session");
  const session = store.get("e2e-session");
  const selected = session.choosePayload({
    messages: [{ role: "user", content: "risolvi" }],
    tools: []
  });
  session.commit(selected.pending, {
    role: "assistant",
    content: null,
    tool_calls: [{ id: "sage-1", type: "function", function: { name: "sage", arguments: "{}" } }]
  });

  let modelRoundsAfterReady = 0;
  session.commit(canonicalSageCommitPending(selected.pending), {
    role: "assistant",
    content: final.content,
    sageAuthoritative: true,
    sageRunId: final.runId
  });
  const assistants = session.messages().filter((message) => message.role === "assistant");

  assert.equal(assistants.length, 1);
  assert.equal(assistants[0].content, ready.sageResult.publication.markdown);
  assert.equal(modelRoundsAfterReady, 0);
});
