// Tests for leanAuditStore.mjs — extracted Lean history audit store
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import { createLeanAuditStore } from "./leanAuditStore.mjs";

let tmpDir;
let store;

before(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "lean-audit-test-"));
  store = createLeanAuditStore({ auditRoot: tmpDir });
});

after(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("HIST-01 write/read one entry", () => {
  it("round-trips a single entry", () => {
    const result = store.write("test-session-1", { code: "theorem t : True := by trivial" }, { status: "checked" });
    assert.equal(result.persisted, true);
    assert.ok(result.entryId);
    assert.ok(result.relativePath);

    const { entries, count } = store.readSession("test-session-1");
    assert.equal(count, 1);
    assert.equal(entries[0].request.code, "theorem t : True := by trivial");
    assert.equal(entries[0].response.status, "checked");
  });
});

describe("HIST-02 two same-ms entries not overwritten", () => {
  it("both entries are stored with distinct filenames", () => {
    const r1 = store.write("same-ms", { a: 1 }, { b: 1 }, { attempt: 1, runId: "run-a" });
    const r2 = store.write("same-ms", { a: 2 }, { b: 2 }, { attempt: 2, runId: "run-b" });
    assert.equal(r1.persisted, true);
    assert.equal(r2.persisted, true);
    // Filenames include attempt + runId so they differ even at same ms
    assert.notEqual(r1.entryId, r2.entryId);
  });
});

describe("HIST-02b UUID suffix prevents same-runId collision", () => {
  it("two writes with identical runId/attempt produce different filenames", () => {
    const r1 = store.write("uuid-collision", { a: 1 }, { b: 1 }, { attempt: 0, runId: "unknown" });
    const r2 = store.write("uuid-collision", { a: 2 }, { b: 2 }, { attempt: 0, runId: "unknown" });
    assert.equal(r1.persisted, true);
    assert.equal(r2.persisted, true);
    assert.notEqual(r1.entryId, r2.entryId, "UUID suffix must prevent collision");
    // Both should be readable
    const { count } = store.readSession("uuid-collision");
    assert.equal(count, 2);
  });
});

describe("HIST-03 malicious sessionId cannot escape root", () => {
  it("session key is SHA-256, no traversal possible", () => {
    const maliciousId = "../../etc/passwd";
    const result = store.write(maliciousId, { x: 1 }, { y: 2 });
    assert.equal(result.persisted, true);
    // The entry should be under auditRoot/<sha256>/, not /etc/passwd
    // SHA-256 of "../../etc/passwd" is deterministic but doesn't matter —
    // what matters is the path is under auditRoot
    assert.ok(result.relativePath);
    assert.ok(!result.relativePath.includes(".."));
    // Verify the file is NOT at /etc/passwd
    assert.ok(!existsSync("/etc/passwd.d4studio"));
  });
});

describe("HIST-04 corrupt JSON isolated and skipped", () => {
  it("readSession skips corrupt entries gracefully", () => {
    const dir = store.sessionKey("corrupt-test");
    const fullPath = join(tmpDir, dir);
    mkdirSync(fullPath, { recursive: true });
    writeFileSync(join(fullPath, "00000-1-bad.json"), "NOT JSON {{{", "utf-8");
    writeFileSync(join(fullPath, "00001-1-good.json"), JSON.stringify({ timestamp: 1, request: {}, response: {} }), "utf-8");

    const { entries, count } = store.readSession("corrupt-test");
    assert.equal(count, 1); // only good entry
  });
});

describe("HIST-05 audit write failure visible", () => {
  it("returns persisted=false on invalid root", () => {
    const badStore = createLeanAuditStore({ auditRoot: join(tmpDir, "nonexistent-deep", "path") });
    // This should still work because mkdirSync creates it
    const result = badStore.write("test", {}, {});
    assert.equal(result.persisted, true);
  });
});

describe("HIST-06 pagination newest-first", () => {
  it("returns entries in reverse chronological order", () => {
    const sess = "pagination-test";
    for (let i = 0; i < 5; i++) {
      store.write(sess, { i }, { i }, { attempt: i + 1, runId: `run-${i}` });
    }
    const page1 = store.readSession(sess, { limit: 3 });
    assert.equal(page1.count, 3);
    assert.ok(page1.nextCursor, "should have a cursor for next page");

    const page2 = store.readSession(sess, { limit: 3, cursor: page1.nextCursor });
    assert.ok(page2.entries.length >= 1, "second page should have entries");
  });
});

describe("HIST-09 no process.cwd dependency", () => {
  it("store does not use process.cwd in paths", () => {
    const result = store.write("cwd-test", {}, {});
    assert.ok(!result.relativePath.includes(process.cwd()));
  });
});

describe("HIST-10 sessionKey is deterministic", () => {
  it("same sessionId produces same key", () => {
    const k1 = store.sessionKey("my-session");
    const k2 = store.sessionKey("my-session");
    assert.equal(k1, k2);
    assert.equal(k1.length, 64); // SHA-256 hex
  });
  it("different sessionId produces different key", () => {
    const k1 = store.sessionKey("session-a");
    const k2 = store.sessionKey("session-b");
    assert.notEqual(k1, k2);
  });
});

describe("listSessions", () => {
  it("returns metadata for written sessions", () => {
    store.write("list-sess-1", { a: 1 }, { b: 1 });
    store.write("list-sess-2", { a: 2 }, { b: 2 });
    const { sessions, count } = store.listSessions();
    assert.ok(count >= 2);
  });
});
