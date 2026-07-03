import { test } from "node:test";
import assert from "node:assert/strict";
import { buildAuditRecord } from "./pageAgentAudit.mjs";

test("buildAuditRecord creates a record with defaults", () => {
  const record = buildAuditRecord({ action: "click", target: "chat-send-button" });
  assert.equal(record.tool, "page_action");
  assert.equal(record.action, "click");
  assert.equal(record.target, "chat-send-button");
  assert.equal(record.ok, false);
  assert.equal(typeof record.ts, "string");
});

test("buildAuditRecord includes safety info", () => {
  const record = buildAuditRecord({
    action: "input",
    target: "chat-input",
    ok: true,
    safety: { allowed: true }
  });
  assert.equal(record.ok, true);
  assert.deepEqual(record.safety, { allowed: true });
});

test("buildAuditRecord accepts custom sessionId and url", () => {
  const record = buildAuditRecord({
    sessionId: "test-session",
    url: "http://localhost:5173",
    action: "click",
    target: "test"
  });
  assert.equal(record.sessionId, "test-session");
  assert.equal(record.url, "http://localhost:5173");
});
