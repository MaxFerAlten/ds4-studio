import assert from "node:assert/strict";
import { test } from "node:test";
import {
  PENDING_AGENT_RUN_KEY, PENDING_AGENT_RUN_MAX_AGE_MS,
  savePendingAgentRun, readPendingAgentRun, clearPendingAgentRun
} from "./appLogic.mjs";

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k)
  };
}

const run = { runId: "r1", payload: { message: "x", messages: [] }, text: "x", sessionKey: "tab_a", startedAt: 1000 };

test("a pending agent run round-trips for its own tab session only", () => {
  const storage = memoryStorage();
  assert.equal(savePendingAgentRun(storage, run), true);
  assert.deepEqual(readPendingAgentRun(storage, { sessionKey: "tab_a", now: 2000 }), run);
  assert.equal(readPendingAgentRun(storage, { sessionKey: "tab_b", now: 2000 }), null);
  assert.equal(readPendingAgentRun(storage, { sessionKey: "tab_a", now: 1000 + PENDING_AGENT_RUN_MAX_AGE_MS }), null);
});

test("clear removes only the matching run; bad data and full storage are harmless", () => {
  const storage = memoryStorage();
  savePendingAgentRun(storage, run);
  clearPendingAgentRun(storage, "other");
  assert.ok(readPendingAgentRun(storage, { sessionKey: "tab_a", now: 2000 }));
  clearPendingAgentRun(storage, "r1");
  assert.equal(storage.getItem(PENDING_AGENT_RUN_KEY), null);

  storage.setItem(PENDING_AGENT_RUN_KEY, "{not json");
  assert.equal(readPendingAgentRun(storage, { sessionKey: "tab_a", now: 2000 }), null);
  const full = { ...memoryStorage(), setItem: () => { throw new Error("QuotaExceededError"); } };
  assert.equal(savePendingAgentRun(full, run), false);
});
