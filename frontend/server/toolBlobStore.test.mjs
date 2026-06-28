import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { ToolBlobStore } from "./toolBlobStore.mjs";

async function withTempDir(fn) {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "ds4-blob-store-"));
  try {
    await fn(tmp);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
}

test("ToolBlobStore constructor requires a non-empty baseDir", () => {
  assert.throws(() => new ToolBlobStore(""), /baseDir is required/);
  assert.throws(() => new ToolBlobStore(null), /baseDir is required/);
  assert.throws(() => new ToolBlobStore(undefined), /baseDir is required/);
  assert.doesNotThrow(() => new ToolBlobStore("/tmp/test"));
});

test("ToolBlobStore.put stores text and returns id with sha256: prefix", async () => {
  await withTempDir(async (dir) => {
    const store = new ToolBlobStore(dir);
    const result = await store.put("hello world");

    assert.equal(typeof result.id, "string");
    assert.ok(result.id.startsWith("sha256:"));
    assert.equal(result.id.length, 64 + 7); // "sha256:" + 64 hex chars
    assert.equal(result.bytes, 11);
    assert.ok(result.created);

    // Verify the file was written
    const hex = result.id.slice("sha256:".length);
    const filePath = path.join(dir, "sha256", `${hex}.txt`);
    const content = await fs.readFile(filePath, "utf8");
    assert.equal(content, "hello world");
  });
});

test("ToolBlobStore.put deduplicates identical content", async () => {
  await withTempDir(async (dir) => {
    const store = new ToolBlobStore(dir);

    const first = await store.put("same text");
    assert.ok(first.created);

    const second = await store.put("same text");
    assert.equal(second.id, first.id);
    assert.equal(second.bytes, 9);
    assert.ok(!second.created); // not created, was deduplicated
  });
});

test("ToolBlobStore.put rejects non-string input", async () => {
  await withTempDir(async (dir) => {
    const store = new ToolBlobStore(dir);
    await assert.rejects(() => store.put(123), /text must be a string/);
    await assert.rejects(() => store.put(null), /text must be a string/);
    await assert.rejects(() => store.put(undefined), /text must be a string/);
  });
});

test("ToolBlobStore.get reads full text when no offset/length given", async () => {
  await withTempDir(async (dir) => {
    const store = new ToolBlobStore(dir);
    const { id } = await store.put("abcdefghijklmnopqrstuvwxyz");

    const text = await store.get(id);
    assert.equal(text, "abcdefghijklmnopqrstuvwxyz");
  });
});

test("ToolBlobStore.get reads a partial range", async () => {
  await withTempDir(async (dir) => {
    const store = new ToolBlobStore(dir);
    const { id } = await store.put("abcdefghijklmnopqrstuvwxyz");

    const text = await store.get(id, 5, 10);
    assert.equal(text, "fghijklmno"); // offset 5, length 10
  });
});

test("ToolBlobStore.get returns empty string when offset past EOF", async () => {
  await withTempDir(async (dir) => {
    const store = new ToolBlobStore(dir);
    const { id } = await store.put("short");

    const text = await store.get(id, 100, 10);
    assert.equal(text, "");
  });
});

test("ToolBlobStore.get returns null for invalid id", async () => {
  await withTempDir(async (dir) => {
    const store = new ToolBlobStore(dir);
    assert.equal(await store.get("sha256:bad"), null);
    assert.equal(await store.get("invalid"), null);
    assert.equal(await store.get(""), null);
    assert.equal(await store.get(null), null);
  });
});

test("ToolBlobStore.get returns null for non-existent blob", async () => {
  await withTempDir(async (dir) => {
    const store = new ToolBlobStore(dir);
    const result = await store.get("sha256:0000000000000000000000000000000000000000000000000000000000000000");
    assert.equal(result, null);
  });
});

test("ToolBlobStore.get rejects out-of-bounds length", async () => {
  await withTempDir(async (dir) => {
    const store = new ToolBlobStore(dir);
    const { id } = await store.put("hello");
    assert.equal(await store.get(id, 0, 200_001), null);
    assert.equal(await store.get(id, 0, -1), null);
  });
});

test("ToolBlobStore.isValidId validates blob id format", () => {
  assert.ok(ToolBlobStore.isValidId("sha256:" + "a".repeat(64)));
  assert.ok(ToolBlobStore.isValidId("sha256:" + "f".repeat(64)));
  assert.ok(ToolBlobStore.isValidId("sha256:" + "0".repeat(64)));
  assert.ok(!ToolBlobStore.isValidId("sha256:" + "g".repeat(64))); // 'g' not hex
  assert.ok(!ToolBlobStore.isValidId("sha256:" + "a".repeat(63))); // too short
  assert.ok(!ToolBlobStore.isValidId("sha256:" + "a".repeat(65))); // too long
  assert.ok(!ToolBlobStore.isValidId("sha256:"));
  assert.ok(!ToolBlobStore.isValidId(""));
  assert.ok(!ToolBlobStore.isValidId(null));
  assert.ok(!ToolBlobStore.isValidId(undefined));
});

test("ToolBlobStore.get clamps length to actual remaining bytes", async () => {
  await withTempDir(async (dir) => {
    const store = new ToolBlobStore(dir);
    const { id } = await store.put("short");

    const text = await store.get(id, 2, 100); // requests 100, but only 3 remain
    assert.equal(text, "ort"); // offset 2, length clamped to 3
  });
});
