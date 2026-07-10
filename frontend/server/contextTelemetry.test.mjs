import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs/promises";
import crypto from "node:crypto";
import { appendContextTelemetry, readContextTelemetry, sanitizeTelemetryEvent } from "./contextTelemetry.mjs";
import { sessionContextDir, sessionTelemetryPath } from "./contextPaths.mjs";

function freshKey() {
  return `test-telemetry-${crypto.randomUUID()}`;
}
async function cleanup(key) {
  await fs.rm(sessionContextDir(key), { recursive: true, force: true });
}

test("append creates file", async () => {
  const key = freshKey();
  try {
    await appendContextTelemetry(key, { ok: true, capsuleTokens: 10 });
    const stat = await fs.stat(sessionTelemetryPath(key));
    assert.ok(stat.isFile());
  } finally {
    await cleanup(key);
  }
});

test("limit works", async () => {
  const key = freshKey();
  try {
    for (let i = 0; i < 8; i++) await appendContextTelemetry(key, { i });
    const last2 = await readContextTelemetry(key, { limit: 2 });
    assert.equal(last2.length, 2);
    assert.equal(last2[1].i, 7);
  } finally {
    await cleanup(key);
  }
});

test("sessionKey not stored in cleartext", async () => {
  const key = freshKey();
  try {
    await appendContextTelemetry(key, { ok: true });
    const text = await fs.readFile(sessionTelemetryPath(key), "utf8");
    assert.ok(!text.includes(key));
    assert.ok(text.includes(crypto.createHash("sha1").update(key).digest("hex")));
  } finally {
    await cleanup(key);
  }
});

test("truncates string fields and drops full capsule content", () => {
  const ev = sanitizeTelemetryEvent("k", {
    payloadReason: "z".repeat(1000),
    text: "[DS4_CONTEXT_CAPSULE] full secret capsule body",
    content: "raw",
    capsuleTokens: 1420
  });
  assert.ok(ev.payloadReason.length <= 300);
  assert.equal(ev.text, undefined);
  assert.equal(ev.content, undefined);
  assert.equal(ev.capsuleTokens, 1420);
});

test("telemetry disabled by config is a no-op", async () => {
  const key = freshKey();
  try {
    const res = await appendContextTelemetry(key, { ok: true }, { enabled: false });
    assert.equal(res, null);
    assert.deepEqual(await readContextTelemetry(key), []);
  } finally {
    await cleanup(key);
  }
});
