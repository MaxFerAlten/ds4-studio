import assert from "node:assert/strict";
import { test } from "node:test";

import {
  applySageArtifact,
  applySageStatus,
  createSageActivity,
  finalizeSageActivity,
  toolResultMessages,
  visibleSageSteps
} from "./sageActivityState.mjs";

test("non-Sage tool results retain visible tool and assistant messages", () => {
  const messages = toolResultMessages({
    name: "bash",
    content: "ok",
    isError: false,
    guarded: false
  });

  assert.equal(messages.length, 2);
  assert.equal(messages[0].role, "tool");
  assert.equal(messages[0].name, "bash");
  assert.equal(messages[1].role, "assistant");
});

test("compact Sage tool results do not create visible tool messages", () => {
  const messages = toolResultMessages({
    name: "sage",
    content: "Calcolo completato.",
    hiddenByDefault: true
  });
  assert.deepEqual(messages, []);
});

test("Sage statuses produce ordered generic steps", () => {
  let activity = applySageStatus(null, {
    runId: "run-1",
    taskType: "solve",
    phase: "compute",
    state: "computing",
    status: "running",
    attempt: 1
  });
  activity = applySageStatus(activity, {
    runId: "run-1",
    phase: "compute",
    state: "computing",
    status: "done",
    summary: "Sistema risolto."
  });
  activity = applySageStatus(activity, {
    runId: "run-1",
    phase: "validate",
    state: "validating",
    status: "done",
    validationPassed: true
  });
  activity = applySageStatus(activity, {
    runId: "run-1",
    state: "composing",
    status: "running"
  });

  assert.deepEqual(
    visibleSageSteps(activity).map((step) => step.label),
    ["Preparazione", "Calcolo", "Validazione", "Composizione finale"]
  );
  assert.deepEqual(
    visibleSageSteps(activity).map((step) => step.status),
    ["done", "done", "done", "running"]
  );
});

test("Sage artifacts are added once and make the plot step visible", () => {
  let activity = createSageActivity({ runId: "run-artifact" });
  const event = {
    runId: "run-artifact",
    artifact: { name: "plot.png", url: "/api/sage/artifacts/s/plot.png" }
  };
  activity = applySageArtifact(activity, event);
  activity = applySageArtifact(activity, event);

  assert.equal(activity.artifacts.length, 1);
  assert.ok(visibleSageSteps(activity).some((step) => step.id === "plot"));
});

test("two repair calls are represented as two ordered corrections", () => {
  let activity = applySageStatus(null, {
    runId: "run-repair",
    phase: "compute",
    state: "computing",
    status: "error",
    attempt: 1
  });
  activity = applySageStatus(activity, {
    runId: "run-repair",
    callId: "repair-1",
    phase: "repair",
    state: "repairing",
    status: "done",
    attempt: 2,
    repairCount: 1
  });
  activity = applySageStatus(activity, {
    runId: "run-repair",
    callId: "repair-2",
    phase: "repair",
    state: "repairing",
    status: "done",
    attempt: 3,
    repairCount: 2
  });

  assert.equal(activity.repairCount, 2);
  assert.deepEqual(
    visibleSageSteps(activity)
      .filter((step) => step.label.startsWith("Correzione"))
      .map((step) => step.label),
    ["Correzione 1", "Correzione 2"]
  );
});

test("completion finalizes the composition step", () => {
  let activity = applySageStatus(null, {
    runId: "run-complete",
    phase: "compute",
    state: "computing",
    status: "done"
  });
  activity = finalizeSageActivity(activity);

  assert.equal(activity.state, "completed");
  assert.equal(activity.status, "completed");
  assert.equal(
    visibleSageSteps(activity).find((step) => step.id === "compose").status,
    "done"
  );
});

test("failure marks the active step and stores a safe summary", () => {
  let activity = applySageStatus(null, {
    runId: "run-error",
    phase: "compute",
    state: "computing",
    status: "running"
  });
  activity = applySageStatus(activity, {
    runId: "run-error",
    phase: "compute",
    state: "failed",
    status: "error",
    summary: "Calcolo non completato."
  });

  assert.equal(activity.state, "failed");
  assert.equal(activity.error, "Calcolo non completato.");
  assert.equal(
    visibleSageSteps(activity).find((step) => step.id === "compute").status,
    "error"
  );
});

test("function-study steps keep their required section order", () => {
  let activity = applySageStatus(null, {
    runId: "run-function",
    taskType: "function_study",
    phase: "compute",
    state: "computing",
    status: "done"
  });
  activity = applySageStatus(activity, {
    phase: "validate",
    state: "validating",
    status: "done"
  });
  activity = applySageStatus(activity, {
    phase: "plot",
    state: "plotting",
    status: "done"
  });
  activity = applySageStatus(activity, {
    state: "composing",
    status: "running"
  });

  assert.deepEqual(
    visibleSageSteps(activity).map((step) => step.id),
    [
      "definition",
      "analysis",
      "first_derivative",
      "second_derivative",
      "validate",
      "plot",
      "compose"
    ]
  );
});
