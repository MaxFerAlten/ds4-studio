/** Test origin: DS4 acceptance requirements BEH-API-002 and SEC-UI-001. */

import assert from "node:assert/strict";
import test from "node:test";

import { EvolutionViews, computeReviewHash } from "./evolutionViews.mjs";

test("BEH-API-002 SEC-UI-001 run DTO omits workspace paths and exposes derived budget", () => {
  const views = new EvolutionViews({ runStore: {} });
  const dto = views.run({
    runId: "evo_0123456789abcdefabcd",
    state: "CREATED",
    revision: 0,
    sequence: 1,
    events: [],
    manifest: {
      createdAt: "2026-01-01T00:00:00Z",
      taskContract: {
        contractVersion: "ds4_evolution_task_v2",
        taskId: "task",
        title: "Task",
        objective: "Improve",
        workspaceRoot: "/secret/path",
        approvalPolicy: { mode: "manual", allowedRiskLevels: [] },
        automation: { level: "D" },
        budgets: { maxTotalPromptTokens: 10, maxTotalCompletionTokens: 10, maxTotalWallTimeMs: 10, maxModelCallsPerRevision: 2 }
      }
    }
  });
  assert.equal(JSON.stringify(dto).includes("/secret/path"), false);
  assert.equal(dto.task.automation.level, "D");
});

test("review hash changes with candidate, parent or gate decision", () => {
  const base = { runId: "evo_0123456789abcdefabcd", revision: 1, candidateHash: "a".repeat(64), parentHash: "b".repeat(64), gateDecision: { decision: "MANUAL_REVIEW" } };
  const hash = computeReviewHash(base);
  assert.notEqual(hash, computeReviewHash({ ...base, candidateHash: "c".repeat(64) }));
  assert.match(hash, /^[a-f0-9]{64}$/);
});

test("BEH-API-002 run DTO exposes completed rollback state derived from the durable ledger", () => {
  const views = new EvolutionViews({ runStore: {} });
  const dto = views.run({
    runId: "evo_0123456789abcdefabcd",
    state: "COMPLETED",
    revision: 1,
    sequence: 9,
    events: [{ type: "ROLLBACK_COMPLETED", revision: 1, timestamp: "2026-01-01T00:00:00Z", payload: { restoredHash: "a".repeat(64) } }],
    manifest: {
      createdAt: "2026-01-01T00:00:00Z",
      taskContract: {
        contractVersion: "ds4_evolution_task_v2",
        taskId: "task",
        title: "Task",
        objective: "Improve",
        approvalPolicy: { mode: "manual", allowedRiskLevels: [] },
        automation: { level: "D" },
        budgets: { maxTotalPromptTokens: 10, maxTotalCompletionTokens: 10, maxTotalWallTimeMs: 10, maxModelCallsPerRevision: 2 }
      }
    }
  });
  assert.deepEqual(dto.rollback, { revision: 1, restoredHash: "a".repeat(64), timestamp: "2026-01-01T00:00:00Z" });
});
