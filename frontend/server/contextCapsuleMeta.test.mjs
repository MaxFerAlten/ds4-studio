import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { readCapsuleMeta, writeCapsuleMeta, clearCapsuleMeta } from "./contextCapsuleMeta.mjs";
import { sessionContextDir, sessionCapsuleMetaPath } from "./contextPaths.mjs";

function freshKey() {
  return `test-meta-${crypto.randomUUID()}`;
}
async function cleanup(key) {
  await fs.rm(sessionContextDir(key), { recursive: true, force: true });
}

test("read missing returns null", async () => {
  assert.equal(await readCapsuleMeta(freshKey()), null);
});

test("write/read roundtrip", async () => {
  const key = freshKey();
  try {
    const meta = { hash: "abc", tokens: 1430, updatedAt: "t", lastPayloadMode: "delta", lastReason: null };
    await writeCapsuleMeta(key, meta);
    assert.deepEqual(await readCapsuleMeta(key), meta);
  } finally {
    await cleanup(key);
  }
});

test("invalid JSON returns null and does not throw", async () => {
  const key = freshKey();
  try {
    const file = sessionCapsuleMetaPath(key);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, "{ not json", "utf8");
    assert.equal(await readCapsuleMeta(key), null);
  } finally {
    await cleanup(key);
  }
});

test("clear deletes file", async () => {
  const key = freshKey();
  try {
    await writeCapsuleMeta(key, { hash: "x" });
    await clearCapsuleMeta(key);
    assert.equal(await readCapsuleMeta(key), null);
    await clearCapsuleMeta(key); // idempotent, no throw
  } finally {
    await cleanup(key);
  }
});

test("does not store sessionKey in cleartext", async () => {
  const key = freshKey();
  try {
    await writeCapsuleMeta(key, { hash: "x", tokens: 1 });
    const text = await fs.readFile(sessionCapsuleMetaPath(key), "utf8");
    assert.ok(!text.includes(key));
  } finally {
    await cleanup(key);
  }
});
