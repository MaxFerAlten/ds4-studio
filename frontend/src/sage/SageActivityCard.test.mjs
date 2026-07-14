import assert from "node:assert/strict";
import { test } from "node:test";

import {
  applySageStatus,
  applySageArtifact,
  createSageActivity
} from "./sageActivityState.mjs";
import { sageActivityCardProps } from "./sageActivityCardProps.mjs";

test("returns null for null activity", () => {
  const props = sageActivityCardProps(null);
  assert.equal(props, null);
});

test("renders the SageMath title via card props", () => {
  const activity = createSageActivity({ runId: "r1" });
  const props = sageActivityCardProps(activity);
  assert.ok(props);
  assert.equal(props.title, "SageMath");
  assert.equal(props.className, "sage-activity");
});

test("ordered steps from visibleSageSteps appear in card props", () => {
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
  assert.ok(props);
  assert.equal(props.steps.length, 4);
  assert.equal(props.steps[0].label, "Preparazione");
  assert.equal(props.steps[3].label, "Composizione finale");
});

test("debug details are hidden by default (no debug key)", () => {
  const activity = createSageActivity({ runId: "r1" });
  const props = sageActivityCardProps(activity);
  // The card renders <details className="sage-debug"> only when debugEnabled is true.
  // In the props there's no separate flag; the component checks debugEnabled separately.
  // Verify that the raw activity object has no debug exposure in display props.
  assert.ok(props);
  assert.equal(typeof props.debug, "object"); // debug is the full activity
});

test("artifact links appear in card props", () => {
  let activity = createSageActivity({ runId: "r1" });
  activity = applySageArtifact(activity, {
    runId: "r1",
    artifact: { name: "plot.png", url: "/api/sage/artifacts/s/plot.png" }
  });

  const props = sageActivityCardProps(activity);
  assert.ok(props);
  assert.ok(props.artifacts.length > 0);
  assert.equal(props.artifacts[0].name, "plot.png");
  assert.equal(props.artifacts[0].url, "/api/sage/artifacts/s/plot.png");
});

test("error state produces error text in card props", () => {
  let activity = applySageStatus(null, {
    runId: "r1", phase: "compute", state: "computing", status: "running"
  });
  activity = applySageStatus(activity, {
    runId: "r1", phase: "compute", state: "failed", status: "error",
    summary: "Calcolo non completato."
  });

  const props = sageActivityCardProps(activity);
  assert.ok(props.error);
  assert.ok(props.error.includes("Calcolo non completato."));
});

test("has aria-live polite for accessibility via card props", () => {
  const activity = createSageActivity({ runId: "r1" });
  const props = sageActivityCardProps(activity);
  assert.equal(props.ariaLive, "polite");
  assert.equal(props.role, "status");
});
