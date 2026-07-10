import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs/promises";
import crypto from "node:crypto";
import { appendContextEvent, readContextEvents, normalizeContextEvent } from "./contextLedger.mjs";
import { sessionContextDir, sessionLedgerPath } from "./contextPaths.mjs";

function freshKey() {
  return `test-ledger-${crypto.randomUUID()}`;
}

async function cleanup(key) {
  await fs.rm(sessionContextDir(key), { recursive: true, force: true });
}

test("appendContextEvent creates directory and file", async () => {
  const key = freshKey();
  try {
    await appendContextEvent(key, { type: "user_goal", summary: "hello" });
    const stat = await fs.stat(sessionLedgerPath(key));
    assert.ok(stat.isFile());
  } finally {
    await cleanup(key);
  }
});

test("normalizes event with missing fields", () => {
  const ev = normalizeContextEvent("k", {});
  assert.ok(ev.id.startsWith("evt_"));
  assert.equal(ev.type, "tool_result");
  assert.equal(ev.source, "agent");
  assert.equal(ev.target, null);
  assert.deepEqual(ev.evidenceIds, []);
});

test("truncates summary beyond 1200 chars", () => {
  const ev = normalizeContextEvent("k", { summary: "a".repeat(5000) });
  assert.equal(ev.summary.length, 1200);
});

test("unknown type maps to safe default", () => {
  const ev = normalizeContextEvent("k", { type: "totally_unknown" });
  assert.equal(ev.type, "tool_result");
  const ok = normalizeContextEvent("k", { type: "decision" });
  assert.equal(ok.type, "decision");
});

test("readContextEvents(limit) reads only last N", async () => {
  const key = freshKey();
  try {
    for (let i = 0; i < 10; i++) {
      await appendContextEvent(key, { type: "claim", summary: `evt-${i}` });
    }
    const last3 = await readContextEvents(key, { limit: 3 });
    assert.equal(last3.length, 3);
    assert.equal(last3[2].summary, "evt-9");
    assert.equal(last3[0].summary, "evt-7");
  } finally {
    await cleanup(key);
  }
});

test("sessionKey does not appear in cleartext in file", async () => {
  const key = freshKey();
  try {
    await appendContextEvent(key, { type: "user_goal", summary: "x" });
    const text = await fs.readFile(sessionLedgerPath(key), "utf8");
    assert.ok(!text.includes(key));
    assert.ok(text.includes(crypto.createHash("sha1").update(key).digest("hex")));
  } finally {
    await cleanup(key);
  }
});

test("readContextEvents returns [] when file missing", async () => {
  const events = await readContextEvents(freshKey());
  assert.deepEqual(events, []);
});

test("appendContextEvent honors maxEvents cap", async () => {
  const key = freshKey();
  try {
    for (let i = 0; i < 60; i++) await appendContextEvent(key, { type: "claim", summary: `e${i}` }, { maxEvents: 10 });
    const all = await readContextEvents(key, { limit: 1000 });
    assert.ok(all.length <= 12, `rows=${all.length}`);
    // most recent survive
    assert.equal(all[all.length - 1].summary, "e59");
  } finally {
    await cleanup(key);
  }
});
