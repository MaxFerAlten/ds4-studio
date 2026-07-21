/** Test origin: DS4 observability requirements and BEH-API-002 bounded status. */

import assert from "node:assert/strict";
import test from "node:test";

import { summarizeEvolutionRun } from "./evolutionTelemetry.mjs";

test("telemetry derives bounded counters without exposing raw payloads", () => {
  const summary = summarizeEvolutionRun({
    runId: "evo_00000000000000000001",
    state: "REJECTED",
    sequence: 3,
    events: [
      { type: "RUN_CREATED", revision: 0, timestamp: "2026-01-01T00:00:00Z", payload: { secret: "must-not-leak" } },
      { type: "STATE_TRANSITION", revision: 1, timestamp: "2026-01-01T00:00:01Z", payload: { from: "GATING", to: "REJECTED", reasonCode: "METRIC_REGRESSION" } },
      { type: "PROMOTION_REVERTED", revision: 1, timestamp: "2026-01-01T00:00:02Z", payload: {} }
    ]
  });
  assert.equal(summary.durationMs, 2_000);
  assert.equal(summary.revisions, 1);
  assert.equal(summary.rejectionReasons.METRIC_REGRESSION, 1);
  assert.equal(JSON.stringify(summary).includes("must-not-leak"), false);
});
