import assert from "node:assert/strict";
import { test } from "node:test";

import { applySageStatus, applySageArtifact, createSageActivity, finalizeSageActivity } from "./sageActivityState.mjs";
import { sageActivityCardProps } from "./sageActivityCardProps.mjs";

test("returns null for null activity", () => {
  assert.equal(sageActivityCardProps(null), null);
});

test("returns props with correct className and role", () => {
  const activity = createSageActivity({ runId: "r1" });
  const props = sageActivityCardProps(activity);
  assert.equal(props.className, "sage-activity");
  assert.equal(props.role, "status");
  assert.equal(props.ariaLive, "polite");
  assert.equal(props.title, "SageMath");
});

test("returns ordered steps from visibleSageSteps", () => {
  let activity = applySageStatus(null, {
    runId: "r1", taskType: "solve", phase: "compute",
    state: "computing", status: "running", attempt: 1
  });
  activity = applySageStatus(activity, {
    runId: "r1", phase: "compute", state: "computing", status: "done"
  });
  activity = applySageStatus(activity, {
    runId: "r1", phase: "validate", state: "validating", status: "done"
  });
  activity = applySageStatus(activity, {
    runId: "r1", state: "composing", status: "running"
  });

  const props = sageActivityCardProps(activity);
  assert.equal(props.steps.length, 4);
  assert.equal(props.steps[0].label, "Preparazione");
  assert.equal(props.steps[0].status, "done");
  assert.equal(props.steps[3].label, "Composizione finale");
  assert.equal(props.steps[3].status, "running");
});

test("step icons match status", () => {
  let activity = applySageStatus(null, {
    runId: "r1", phase: "compute", state: "computing", status: "running"
  });
  const props = sageActivityCardProps(activity);
  const computeStep = props.steps.find((s) => s.id === "compute");
  assert.equal(computeStep.icon, "\u25B8"); // running
  const pendingStep = props.steps.find((s) => s.id === "validate");
  assert.equal(pendingStep.icon, "\u25CB"); // pending
});

test("footer line includes attempt and repair counts", () => {
  let activity = applySageStatus(null, {
    runId: "r1", phase: "compute", state: "computing", status: "error", attempt: 1
  });
  activity = applySageStatus(activity, {
    runId: "r1", callId: "repair-1", phase: "repair", state: "repairing",
    status: "done", attempt: 2, repairCount: 1
  });
  const props = sageActivityCardProps(activity);
  assert.ok(props.footerLine.includes("2 esecuzioni"));
  assert.ok(props.footerLine.includes("1 correzione"));
});

test("artifacts are included in props", () => {
  let activity = createSageActivity({ runId: "r1" });
  activity = applySageArtifact(activity, {
    runId: "r1",
    artifact: { name: "plot.png", url: "/api/sage/artifacts/s/plot.png" }
  });
  const props = sageActivityCardProps(activity);
  assert.equal(props.artifacts.length, 1);
  assert.equal(props.artifacts[0].name, "plot.png");
  assert.equal(props.artifacts[0].url, "/api/sage/artifacts/s/plot.png");
});

test("error is included in props", () => {
  let activity = applySageStatus(null, {
    runId: "r1", phase: "compute", state: "computing", status: "running"
  });
  activity = applySageStatus(activity, {
    runId: "r1", phase: "compute", state: "failed", status: "error",
    summary: "Calcolo non completato."
  });
  const props = sageActivityCardProps(activity);
  assert.ok(props.error.includes("Calcolo non completato."));
});

test("debug object contains full activity", () => {
  const activity = createSageActivity({ runId: "r1" });
  const props = sageActivityCardProps(activity);
  assert.equal(props.debug.runId, "r1");
  assert.equal(props.debug.state, "idle");
});

test("footer line is empty for fresh activity", () => {
  const activity = createSageActivity({ runId: "r1" });
  const props = sageActivityCardProps(activity);
  assert.equal(props.footerLine, "");
});

test("function study steps are ordered correctly", () => {
  let activity = applySageStatus(null, {
    runId: "r1", taskType: "function_study", phase: "compute",
    state: "computing", status: "done"
  });
  activity = applySageStatus(activity, { phase: "validate", state: "validating", status: "done" });
  activity = applySageStatus(activity, { phase: "plot", state: "plotting", status: "done" });
  activity = applySageStatus(activity, { state: "composing", status: "running" });
  const props = sageActivityCardProps(activity);
  assert.deepEqual(props.steps.map((s) => s.id), [
    "definition", "analysis", "first_derivative", "second_derivative",
    "validate", "plot", "compose"
  ]);
});
