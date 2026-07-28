import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AgnoToolAudit, digestArgs } from "./agnoToolAudit.mjs";

async function withTempDir(fn) {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "agno-tool-audit-"));
  try {
    await fn(tmp);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
}

async function readLines(dir, file) {
  const text = await fs.readFile(path.join(dir, file), "utf8");
  return text.trim().split("\n").map((line) => JSON.parse(line));
}

test("write() creates the audit dir and appends a JSONL line to today's UTC date file", async () => {
  await withTempDir(async (dir) => {
    const audit = new AgnoToolAudit({ auditDir: dir });
    await audit.write({ toolName: "read", sessionId: "s1", runId: "r1", args: { path: "a.txt" } });

    const today = new Date().toISOString().slice(0, 10);
    const files = await fs.readdir(dir);
    assert.deepEqual(files, [`${today}.jsonl`]);

    const [record] = await readLines(dir, `${today}.jsonl`);
    assert.equal(record.toolName, "read");
    assert.equal(record.sessionId, "s1");
    assert.equal(record.runId, "r1");
  });
});

test("record never contains raw arguments, only argumentDigest, for every tool", async () => {
  await withTempDir(async (dir) => {
    const audit = new AgnoToolAudit({ auditDir: dir });
    for (const toolName of ["read", "bash", "write", "edit"]) {
      await audit.write({ toolName, args: { command: "rm -rf /", path: "/etc/passwd" } });
    }

    const today = new Date().toISOString().slice(0, 10);
    const records = await readLines(dir, `${today}.jsonl`);
    assert.equal(records.length, 4);
    for (const record of records) {
      assert.equal(record.args, undefined);
      assert.equal(record.arguments, undefined);
      assert.ok(record.argumentDigest.startsWith("sha256:"));
      assert.equal(record.argumentDigest.length, "sha256:".length + 64);
    }
  });
});

test("digestArgs is deterministic and independent of key order", () => {
  const a = digestArgs({ path: "x", limit: 5 });
  const b = digestArgs({ limit: 5, path: "x" });
  assert.equal(a, b);
});

test("digestArgs differs for different arguments", () => {
  assert.notEqual(digestArgs({ path: "a" }), digestArgs({ path: "b" }));
});

test("digestArgs is stable for missing/undefined args", () => {
  assert.equal(digestArgs(undefined), digestArgs({}));
});

test("contentBytes derives from content via Buffer.byteLength when not explicit", async () => {
  await withTempDir(async (dir) => {
    const audit = new AgnoToolAudit({ auditDir: dir });
    await audit.write({ toolName: "read", content: "héllo" }); // multi-byte char

    const today = new Date().toISOString().slice(0, 10);
    const [record] = await readLines(dir, `${today}.jsonl`);
    assert.equal(record.contentBytes, Buffer.byteLength("héllo", "utf8"));
  });
});

test("explicit contentBytes overrides content length", async () => {
  await withTempDir(async (dir) => {
    const audit = new AgnoToolAudit({ auditDir: dir });
    await audit.write({ toolName: "read", content: "short", contentBytes: 12345 });

    const today = new Date().toISOString().slice(0, 10);
    const [record] = await readLines(dir, `${today}.jsonl`);
    assert.equal(record.contentBytes, 12345);
  });
});

test("multiple writes append multiple lines without overwriting", async () => {
  await withTempDir(async (dir) => {
    const audit = new AgnoToolAudit({ auditDir: dir });
    await audit.write({ toolName: "read" });
    await audit.write({ toolName: "search" });
    await audit.write({ toolName: "list" });

    const today = new Date().toISOString().slice(0, 10);
    const records = await readLines(dir, `${today}.jsonl`);
    assert.equal(records.length, 3);
    assert.deepEqual(records.map((r) => r.toolName), ["read", "search", "list"]);
  });
});

test("write() honors a caller-supplied ts to pick the UTC date file", async () => {
  await withTempDir(async (dir) => {
    const audit = new AgnoToolAudit({ auditDir: dir });
    await audit.write({ toolName: "read", ts: "2024-01-15T23:59:59.000Z" });

    const files = await fs.readdir(dir);
    assert.deepEqual(files, ["2024-01-15.jsonl"]);
  });
});

test("write() defaults isError/guarded to false and durationMs to null when absent", async () => {
  await withTempDir(async (dir) => {
    const audit = new AgnoToolAudit({ auditDir: dir });
    await audit.write({ toolName: "read" });

    const today = new Date().toISOString().slice(0, 10);
    const [record] = await readLines(dir, `${today}.jsonl`);
    assert.equal(record.isError, false);
    assert.equal(record.guarded, false);
    assert.equal(record.durationMs, null);
  });
});
