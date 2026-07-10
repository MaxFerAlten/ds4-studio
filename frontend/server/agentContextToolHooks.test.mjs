import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs/promises";
import crypto from "node:crypto";
import { recordToolContext } from "./agentContextToolHooks.mjs";
import { readContextEvidence } from "./contextEvidence.mjs";
import { readContextEvents } from "./contextLedger.mjs";
import { sessionContextDir } from "./contextPaths.mjs";

function freshKey() {
  return `test-toolhooks-${crypto.randomUUID()}`;
}
async function cleanup(key) {
  await fs.rm(sessionContextDir(key), { recursive: true, force: true });
}
const cfg = { enabled: true, previewOnly: false };

test("read tool produces file_read evidence + ledger event", async () => {
  const key = freshKey();
  try {
    await recordToolContext({
      sessionKey: key, tool: "read", args: { path: "src/x.c" },
      rawResult: { content: "int main(){}", isError: false }, compressed: { content: "int main(){}", compressed: false }, config: cfg
    });
    const evidence = await readContextEvidence(key);
    assert.equal(evidence.length, 1);
    assert.equal(evidence[0].kind, "file_read");
    const events = await readContextEvents(key);
    assert.equal(events[events.length - 1].type, "file_read");
  } finally {
    await cleanup(key);
  }
});

test("compressed-with-blob stores only blobIds, not full content", async () => {
  const key = freshKey();
  try {
    const huge = "y".repeat(100000);
    await recordToolContext({
      sessionKey: key, tool: "crawl", args: { url: "http://x" },
      rawResult: { content: huge, isError: false },
      compressed: { content: "[compressed summary]", compressed: true, blobId: "blob_123" }, config: cfg
    });
    const [ev] = await readContextEvidence(key);
    assert.deepEqual(ev.blobIds, ["blob_123"]);
    assert.ok(ev.summary.length <= 800);
    assert.ok(!ev.summary.includes(huge));
  } finally {
    await cleanup(key);
  }
});

test("tool error produces error event", async () => {
  const key = freshKey();
  try {
    await recordToolContext({
      sessionKey: key, tool: "read", args: { path: "missing" },
      rawResult: { content: "ENOENT", isError: true }, compressed: null, config: cfg
    });
    const events = await readContextEvents(key);
    assert.equal(events[events.length - 1].type, "error");
  } finally {
    await cleanup(key);
  }
});

test("disabled config is a no-op", async () => {
  const key = freshKey();
  try {
    const res = await recordToolContext({
      sessionKey: key, tool: "read", args: {}, rawResult: { content: "x" }, compressed: null,
      config: { enabled: false, previewOnly: false }
    });
    assert.equal(res, null);
    assert.deepEqual(await readContextEvidence(key), []);
  } finally {
    await cleanup(key);
  }
});

test("summary never exceeds 800 chars from a large raw result", async () => {
  const key = freshKey();
  try {
    await recordToolContext({
      sessionKey: key, tool: "bash", args: { command: "ls" },
      rawResult: { content: "z".repeat(50000), isError: false }, compressed: null, config: cfg
    });
    const [ev] = await readContextEvidence(key);
    assert.ok(ev.summary.length <= 800);
  } finally {
    await cleanup(key);
  }
});
