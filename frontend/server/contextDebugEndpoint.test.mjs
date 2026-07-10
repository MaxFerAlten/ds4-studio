import assert from "node:assert/strict";
import { test } from "node:test";
import { contextStatusPayload } from "./agentContextIntegration.mjs";

test("responds even when nothing exists (missing files)", () => {
  const out = contextStatusPayload({ config: { enabled: false, previewOnly: true }, meta: null, telemetry: [], events: [] });
  assert.equal(out.enabled, false);
  assert.equal(out.previewOnly, true);
  assert.equal(out.capsule, null);
  assert.deepEqual(out.recentTelemetry, []);
  assert.deepEqual(out.recentEvents, []);
});

test("does not expose sessionKey or blob content", () => {
  const events = [{
    id: "evt_1", at: "t", type: "tool_result", target: "http://x", summary: "s",
    sessionKeyHash: "hash", blobIds: ["blob_secret"], meta: { compressed: true }
  }];
  const out = contextStatusPayload({ config: {}, meta: { hash: "h", tokens: 5, updatedAt: "t" }, telemetry: [], events });
  const json = JSON.stringify(out);
  assert.ok(!json.includes("blob_secret"), "must not leak blob ids");
  assert.equal(out.recentEvents[0].blobIds, undefined);
  // top-level payload carries no raw sessionKey field
  assert.equal(out.sessionKey, undefined);
});

test("capsule exposes only tokens/hash/updatedAt, not full text", () => {
  const meta = { hash: "abc", tokens: 1420, updatedAt: "t", text: "[DS4_CONTEXT_CAPSULE] secret body" };
  const out = contextStatusPayload({ config: {}, meta, telemetry: [], events: [] });
  assert.deepEqual(out.capsule, { tokens: 1420, hash: "abc", updatedAt: "t" });
  assert.ok(!JSON.stringify(out).includes("secret body"));
});

test("maps every provided event without dropping the read limit", () => {
  const events = Array.from({ length: 20 }, (_, i) => ({ id: `evt_${i}`, at: "t", type: "claim", target: null, summary: `s${i}` }));
  const out = contextStatusPayload({ config: {}, meta: null, telemetry: [], events });
  assert.equal(out.recentEvents.length, 20);
});
