// LeanRunRegistry unit tests: ownership, TTL, capacity, concurrency caps,
// cached dedup and idempotent cancellation.
import test from "node:test";
import assert from "node:assert/strict";

import { LeanRunRegistry } from "./leanRunRegistry.mjs";

const SHA = (n) => n.toString(16).padStart(64, "0");
const SID = "session-a";
const RUN = (n) => `lean-${"a".repeat(12)}-${n}-${n}`;

function makeRegistry(overrides = {}) {
  let clock = 0;
  return {
    registry: new LeanRunRegistry({ now: () => clock, ...overrides }),
    advance(ms) {
      clock += ms;
    },
  };
}

test("reserve accepts a valid id pair and records ownership", () => {
  const { registry } = makeRegistry();
  const res = registry.reserve({ sessionId: SID, runId: RUN(1), sourceSha: SHA(1) });
  assert.equal(res.ok, true);
  assert.equal(res.entry.sessionId, SID);
  assert.equal(res.entry.status, "running");
  assert.equal(registry.size, 1);
});

test("runId colon or path traversal is rejected before touching the map", () => {
  const { registry } = makeRegistry();
  for (const runId of ["lean-aaaaaaaaaaaa-1-1:../etc", "lean-aaaaaaaaaaaa-1-1/../../x", "..%2F..%2Fetc"]) {
    const res = registry.reserve({ sessionId: SID, runId, sourceSha: SHA(1) });
    assert.equal(res.ok, false);
    assert.equal(res.error.code, "LEAN_RUN_ID_INVALID");
    assert.equal(registry.size, 0);
  }
});

test("invalid sessionId is rejected before touching the map", () => {
  const { registry } = makeRegistry();
  for (const sessionId of ["../a", "a:b", "", null, "x".repeat(300)]) {
    const res = registry.reserve({ sessionId, runId: RUN(1), sourceSha: SHA(1) });
    assert.equal(res.ok, false);
    assert.equal(res.error.code, "LEAN_SESSION_ID_INVALID");
    assert.equal(registry.size, 0);
  }
});

test("re-reserving a running run returns a conflict, not a spawn", () => {
  const { registry } = makeRegistry();
  registry.reserve({ sessionId: SID, runId: RUN(1), sourceSha: SHA(1) });
  const res = registry.reserve({ sessionId: SID, runId: RUN(1), sourceSha: SHA(1) });
  assert.equal(res.ok, false);
  assert.equal(res.error.code, "LEAN_RUN_ID_CONFLICT");
  assert.equal(res.error.statusCode, 409);
});

test("duplicate completed run with same source returns a cached result", () => {
  const { registry } = makeRegistry();
  const first = registry.reserve({ sessionId: SID, runId: RUN(1), sourceSha: SHA(1) });
  registry.complete({
    sessionId: SID,
    runId: RUN(1),
    result: { status: "checked" },
    httpStatus: 200,
  });

  const res = registry.reserve({ sessionId: SID, runId: RUN(1), sourceSha: SHA(1) });
  assert.equal(res.ok, true);
  assert.equal(res.cached, true);
  assert.deepEqual(res.entry.result, { status: "checked" });
  assert.equal(registry.size, 1);
});

test("duplicate completed run with different source returns 409", () => {
  const { registry } = makeRegistry();
  registry.reserve({ sessionId: SID, runId: RUN(1), sourceSha: SHA(1) });
  registry.complete({ sessionId: SID, runId: RUN(1), result: {}, httpStatus: 200 });

  const res = registry.reserve({ sessionId: SID, runId: RUN(1), sourceSha: SHA(2) });
  assert.equal(res.ok, false);
  assert.equal(res.error.code, "LEAN_RUN_ID_REUSED_WITH_DIFFERENT_INPUT");
  assert.equal(res.error.statusCode, 409);
});

test("session A cannot read or cancel session B runs", () => {
  const { registry } = makeRegistry();
  registry.reserve({ sessionId: "session-a", runId: RUN(1), sourceSha: SHA(1) });

  assert.equal(registry.get({ sessionId: "session-b", runId: RUN(1) }), undefined);
  const cancel = registry.cancel({ sessionId: "session-b", runId: RUN(1) });
  assert.deepEqual(cancel, { found: false, cancelled: false });
  assert.equal(registry.size, 1);
  assert.equal(registry.get({ sessionId: "session-a", runId: RUN(1) }).status, "running");
});

test("global concurrency cap returns 429 without reserving", () => {
  const { registry } = makeRegistry({ maxGlobalRuns: 2 });
  registry.reserve({ sessionId: "session-a", runId: RUN(1), sourceSha: SHA(1) });
  registry.reserve({ sessionId: "session-b", runId: RUN(2), sourceSha: SHA(2) });

  const res = registry.reserve({ sessionId: "session-c", runId: RUN(3), sourceSha: SHA(3) });
  assert.equal(res.ok, false);
  assert.equal(res.error.code, "LEAN_CONCURRENCY_LIMIT");
  assert.equal(res.error.statusCode, 429);
  assert.equal(registry.size, 2);
});

test("per-session concurrency cap returns 429 without reserving", () => {
  const { registry } = makeRegistry({ maxRunsPerSession: 1 });
  registry.reserve({ sessionId: "session-a", runId: RUN(1), sourceSha: SHA(1) });

  const res = registry.reserve({ sessionId: "session-a", runId: RUN(2), sourceSha: SHA(2) });
  assert.equal(res.ok, false);
  assert.equal(res.error.code, "LEAN_CONCURRENCY_LIMIT");
  assert.equal(res.error.statusCode, 429);
  assert.equal(registry.size, 1);

  const other = registry.reserve({ sessionId: "session-b", runId: RUN(2), sourceSha: SHA(2) });
  assert.equal(other.ok, true, "a different session must still be admitted");
});

test("completed runs are pruned after ttlMs", () => {
  const { registry, advance } = makeRegistry({ ttlMs: 1000 });
  registry.reserve({ sessionId: SID, runId: RUN(1), sourceSha: SHA(1) });
  registry.complete({ sessionId: SID, runId: RUN(1), result: {}, httpStatus: 200 });

  advance(1001);
  assert.equal(registry.prune(), 1);
  assert.equal(registry.size, 0);

  const res = registry.reserve({ sessionId: SID, runId: RUN(1), sourceSha: SHA(1) });
  assert.equal(res.ok, true, "after prune the same runId is reservable again");
});

test("running entries are never pruned", () => {
  const { registry, advance } = makeRegistry({ ttlMs: 1 });
  registry.reserve({ sessionId: SID, runId: RUN(1), sourceSha: SHA(1) });
  advance(10_000);
  assert.equal(registry.prune(), 0);
  assert.equal(registry.size, 1);
});

test("capacity cap evicts oldest completed, rejects when nothing to evict", () => {
  const { registry } = makeRegistry({ capacity: 2, ttlMs: 60_000 });
  registry.reserve({ sessionId: "a", runId: RUN(1), sourceSha: SHA(1) });
  registry.complete({ sessionId: "a", runId: RUN(1), result: {}, httpStatus: 200 });
  registry.reserve({ sessionId: "b", runId: RUN(2), sourceSha: SHA(2) });
  registry.complete({ sessionId: "b", runId: RUN(2), result: {}, httpStatus: 200 });

  const res = registry.reserve({ sessionId: "c", runId: RUN(3), sourceSha: SHA(3) });
  assert.equal(res.ok, true, "oldest completed must be evicted to make room");
  assert.equal(registry.size, 2);
  assert.equal(registry.get({ sessionId: "a", runId: RUN(1) }), undefined);
});

test("cancel is idempotent and frees the concurrency slot", () => {
  const { registry } = makeRegistry({ maxRunsPerSession: 1 });
  registry.reserve({ sessionId: SID, runId: RUN(1), sourceSha: SHA(1) });

  const first = registry.cancel({ sessionId: SID, runId: RUN(1) });
  assert.equal(first.cancelled, true);

  const second = registry.cancel({ sessionId: SID, runId: RUN(1) });
  assert.equal(second.cancelled, false);
  assert.equal(second.reason, "already cancelled");

  const after = registry.reserve({ sessionId: SID, runId: RUN(2), sourceSha: SHA(2) });
  assert.equal(after.ok, true, "a cancelled run must not hold the per-session slot");
});

test("cancel of a completed run reports already completed", () => {
  const { registry } = makeRegistry();
  registry.reserve({ sessionId: SID, runId: RUN(1), sourceSha: SHA(1) });
  registry.complete({ sessionId: SID, runId: RUN(1), result: {}, httpStatus: 200 });

  const res = registry.cancel({ sessionId: SID, runId: RUN(1) });
  assert.equal(res.cancelled, false);
  assert.equal(res.reason, "already completed");
});

test("complete overwrites the final result after cancellation", () => {
  const { registry } = makeRegistry();
  registry.reserve({ sessionId: SID, runId: RUN(1), sourceSha: SHA(1) });
  registry.cancel({ sessionId: SID, runId: RUN(1) });

  const done = registry.complete({
    sessionId: SID,
    runId: RUN(1),
    result: { status: "cancelled" },
    httpStatus: 200,
  });
  assert.equal(done, true);
  assert.equal(registry.get({ sessionId: SID, runId: RUN(1) }).status, "completed");
  assert.deepEqual(registry.get({ sessionId: SID, runId: RUN(1) }).result, { status: "cancelled" });
});

test("complete on an unknown run is a no-op", () => {
  const { registry } = makeRegistry();
  assert.equal(registry.complete({ sessionId: SID, runId: RUN(9), result: {}, httpStatus: 200 }), false);
});
