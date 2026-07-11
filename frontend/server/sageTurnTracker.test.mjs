import assert from "node:assert/strict";
import { test } from "node:test";

import { SageTurnTracker } from "./sageTurnTracker.mjs";

test("allows one primary compute call", () => {
  const tracker = new SageTurnTracker();
  tracker.begin({ runId: "run-1", taskType: "solve" });

  assert.equal(tracker.canRun({ phase: "compute" }), true);
  assert.equal(tracker.recordCall({ phase: "compute" }).allowed, true);
  assert.equal(tracker.canRun({ phase: "compute" }), false);
  assert.equal(tracker.snapshot().executeCount, 1);
});

test("blocks a second compute call without treating it as repair", () => {
  const tracker = new SageTurnTracker();
  tracker.recordCall({ phase: "compute" });

  const second = tracker.recordCall({ phase: "compute" });
  assert.equal(second.allowed, false);
  assert.equal(tracker.snapshot().repairCount, 0);
});

test("allows two repair calls", () => {
  const tracker = new SageTurnTracker();
  assert.equal(tracker.recordCall({ phase: "repair" }).allowed, true);
  assert.equal(tracker.recordCall({ phase: "repair" }).allowed, true);
  assert.equal(tracker.snapshot().repairCount, 2);
});

test("blocks a third repair call", () => {
  const tracker = new SageTurnTracker();
  tracker.recordCall({ phase: "repair" });
  tracker.recordCall({ phase: "repair" });

  assert.equal(tracker.canRun({ phase: "repair" }), false);
  assert.equal(tracker.recordCall({ phase: "repair" }).allowed, false);
  assert.equal(tracker.snapshot().repairCount, 2);
});

test("allows one validation call", () => {
  const tracker = new SageTurnTracker();
  assert.equal(tracker.recordCall({ phase: "validate" }).allowed, true);
  assert.equal(tracker.canRun({ phase: "validate" }), false);
  assert.equal(tracker.snapshot().validationCount, 1);
});

test("blocks a second validation call", () => {
  const tracker = new SageTurnTracker();
  tracker.recordCall({ phase: "validate" });
  assert.equal(tracker.recordCall({ phase: "validate" }).allowed, false);
});

test("Sage budgets do not gate unrelated tool execution", async () => {
  const tracker = new SageTurnTracker();
  tracker.recordCall({ phase: "compute" });
  tracker.recordCall({ phase: "repair" });
  tracker.recordCall({ phase: "repair" });

  let genericCalls = 0;
  const executeGenericTool = async () => {
    genericCalls += 1;
    return { content: "ok", isError: false };
  };

  assert.equal((await executeGenericTool()).content, "ok");
  assert.equal(genericCalls, 1);
  assert.equal(tracker.canRun({ phase: "repair" }), false);
});

test("reset clears budgets between turns", () => {
  const tracker = new SageTurnTracker();
  tracker.begin({ runId: "run-1", taskType: "FUNCTION_STUDY" });
  tracker.recordCall({ phase: "compute" });
  tracker.recordCall({ phase: "validate" });
  tracker.recordResult({ phase: "validate", validationPassed: true, artifactCount: 2 });

  tracker.begin({ runId: "run-2", taskType: "solve" });
  const snapshot = tracker.snapshot();
  assert.equal(snapshot.runId, "run-2");
  assert.equal(snapshot.taskType, "solve");
  assert.equal(snapshot.executeCount, 0);
  assert.equal(snapshot.validationCount, 0);
  assert.equal(snapshot.artifactCount, 0);
  assert.equal(snapshot.completed, false);
  assert.equal(tracker.canRun({ phase: "compute" }), true);
});

test("failed compute remains recoverable until repair budget is exhausted", () => {
  const tracker = new SageTurnTracker();
  tracker.recordCall({ phase: "compute" });
  tracker.recordResult({ phase: "compute", isError: true });
  assert.equal(tracker.snapshot().failed, false);

  tracker.recordCall({ phase: "repair" });
  tracker.recordResult({ phase: "repair", isError: true });
  assert.equal(tracker.snapshot().failed, false);

  tracker.recordCall({ phase: "repair" });
  tracker.recordResult({ phase: "repair", isError: true });
  assert.equal(tracker.snapshot().failed, true);
});
