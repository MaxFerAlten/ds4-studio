import assert from "node:assert/strict";
import { test } from "node:test";

import { SageTurnTracker } from "./sageTurnTracker.mjs";

function begin(taskType = "solve", options = {}) {
  const tracker = new SageTurnTracker();
  tracker.begin({ runId: "run-1", taskType, ...options });
  return tracker;
}

function compute(tracker) {
  assert.equal(tracker.recordCall({ phase: "compute" }).allowed, true);
  tracker.recordResult({ phase: "compute", isError: false });
}

function validateReady(tracker, overrides = {}) {
  assert.equal(tracker.recordCall({ phase: "validate" }).allowed, true);
  return tracker.recordResult({
    phase: "validate",
    isError: false,
    authoritative: true,
    validationPassed: true,
    publishable: true,
    reportReady: true,
    finalMarkdownReady: true,
    ...overrides
  });
}

test("validate before compute is blocked", () => {
  const tracker = begin();
  assert.equal(tracker.canRun({ phase: "validate" }), false);
  assert.equal(tracker.recordCall({ phase: "validate" }).allowed, false);
});

test("plot before validate is blocked", () => {
  const tracker = begin("function_study");
  compute(tracker);
  assert.equal(tracker.recordCall({ phase: "plot" }).allowed, false);
});

test("compute after validate is blocked", () => {
  const tracker = begin();
  compute(tracker);
  validateReady(tracker);
  assert.equal(tracker.recordCall({ phase: "compute" }).allowed, false);
});

test("non-authoritative model validation cannot complete", () => {
  const tracker = begin();
  compute(tracker);
  const snapshot = validateReady(tracker, { authoritative: false });
  assert.equal(snapshot.state, "failed");
  assert.equal(tracker.canFinalize(), false);
});

test("publication false cannot complete", () => {
  const tracker = begin();
  compute(tracker);
  validateReady(tracker, { publishable: false });
  assert.equal(tracker.canFinalize(), false);
});

test("a missing report cannot complete", () => {
  const tracker = begin();
  compute(tracker);
  validateReady(tracker, { reportReady: false });
  assert.equal(tracker.canFinalize(), false);
});

test("function study requires the complete plot package", () => {
  const tracker = begin("function_study", { requiresPlots: true });
  compute(tracker);
  validateReady(tracker);
  assert.equal(tracker.snapshot().state, "validated");
  tracker.recordCall({ phase: "plot" });
  tracker.recordResult({
    phase: "plot",
    artifactKinds: ["function_plot", "first_derivative_plot"]
  });
  assert.equal(tracker.canFinalize(), false);
});

test("generic validated task can become ready without plots", () => {
  const tracker = begin("evaluate");
  compute(tracker);
  const snapshot = validateReady(tracker);
  assert.equal(snapshot.state, "ready");
  assert.equal(snapshot.completed, true);
});

test("ready state permits finalization", () => {
  const tracker = begin();
  compute(tracker);
  validateReady(tracker);
  assert.equal(tracker.canFinalize(), true);
});

test("failed state rejects every later phase", () => {
  const tracker = begin();
  tracker.fail("SAGE_EXECUTION_FAILED");
  for (const phase of ["compute", "repair", "validate", "plot"]) {
    assert.equal(tracker.canRun({ phase }), false);
  }
});

test("reset clears state, budgets, publication, and finalization blocks", () => {
  const tracker = begin();
  compute(tracker);
  tracker.recordPrematureFinalization();
  tracker.reset();
  const snapshot = tracker.snapshot();
  assert.equal(snapshot.state, "idle");
  assert.equal(snapshot.runId, null);
  assert.equal(snapshot.executeCount, 0);
  assert.equal(snapshot.validationCount, 0);
  assert.equal(snapshot.publishable, false);
  assert.equal(snapshot.blockedFinalizations, 0);
  assert.deepEqual(snapshot.artifactKinds, []);
});

test("Sage state never gates unrelated tool execution", async () => {
  const tracker = begin();
  tracker.fail("SAGE_FINALIZATION_BLOCKED");
  const executeGenericTool = async () => ({ content: "ok", isError: false });
  assert.deepEqual(await executeGenericTool(), { content: "ok", isError: false });
  assert.equal(tracker.canRun({ phase: "compute" }), false);
});

test("one compute and two repair attempts are the hard budget", () => {
  const tracker = begin();
  tracker.recordCall({ phase: "compute" });
  tracker.recordResult({ phase: "compute", isError: true });
  assert.equal(tracker.recordCall({ phase: "repair" }).allowed, true);
  tracker.recordResult({ phase: "repair", isError: true });
  assert.equal(tracker.recordCall({ phase: "repair" }).allowed, true);
  tracker.recordResult({ phase: "repair", isError: true });
  assert.equal(tracker.snapshot().state, "failed");
  assert.equal(tracker.recordCall({ phase: "repair" }).allowed, false);
});

test("function study becomes ready after all required plot kinds", () => {
  const tracker = begin("function_study");
  compute(tracker);
  validateReady(tracker);
  tracker.recordCall({ phase: "plot" });
  tracker.recordResult({
    phase: "plot",
    artifactKinds: [
      "function_plot",
      "first_derivative_plot",
      "second_derivative_plot"
    ]
  });
  assert.equal(tracker.canFinalize(), true);
});

test("function study can become ready at validate when the complete plot package is present", () => {
  const tracker = begin("function_study");
  compute(tracker);
  const snapshot = validateReady(tracker, {
    artifactKinds: [
      "function_plot",
      "first_derivative_plot",
      "second_derivative_plot"
    ]
  });
  assert.equal(snapshot.state, "ready");
  assert.equal(tracker.canFinalize(), true);
});

test("premature finalization permits one retry and then fails", () => {
  const tracker = begin();
  compute(tracker);
  const first = tracker.recordPrematureFinalization();
  assert.equal(first.retryAllowed, true);
  assert.match(first.guidance, /SAGE_FINALIZATION_BLOCKED/);
  const second = tracker.recordPrematureFinalization();
  assert.equal(second.retryAllowed, false);
  assert.equal(tracker.snapshot().state, "failed");
});
