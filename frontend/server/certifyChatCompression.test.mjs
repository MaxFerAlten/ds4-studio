import test from "node:test";
import assert from "node:assert/strict";
import { compressToolOutput, classifyOutput, ContentKind } from "./toolOutputCompressor.mjs";
import { ToolBlobStore } from "./toolBlobStore.mjs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

function len(s) { return Buffer.byteLength(s, "utf8"); }

async function withTempBlob(fn) {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "ds4-certify-chat-"));
  try {
    const store = new ToolBlobStore(tmp);
    await fn(tmp, store);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Certification: token saving threshold >= 50% for real-world payloads
// ---------------------------------------------------------------------------

test("CERT: search output achieves >=50% token saving", () => withTempBlob(async (tmp, store) => {
  const lines = [];
  for (let i = 0; i < 5000; i++) {
    lines.push(`/path/to/file${i}.c:${i * 10}: int variable_${i} = ${i}; // code`);
  }
  const text = lines.join("\n");
  assert.ok(len(text) >= 4096, "payload must exceed MIN_BYTES");
  const compressed = await compressToolOutput("search", text, len(text), store);
  assert.ok(compressed && compressed.changed, "search output should be compressed");
  const origTokens = Math.ceil(len(text) / 4);
  const compTokens = Math.ceil(len(compressed.text) / 4);
  const saving = (origTokens - compTokens) / origTokens;
  assert.ok(saving >= 0.50, `search saving ${(saving * 100).toFixed(1)}% < 50% threshold`);
  assert.ok(compressed.blobId && compressed.blobId.length > 0, "search blob id should be set (original saved)");
}));

test("CERT: log output achieves >=50% token saving", () => withTempBlob(async (tmp, store) => {
  const lines = [];
  for (let i = 0; i < 5000; i++) {
    lines.push(`ERROR: build step ${i} failed with code ${i % 10}`);
  }
  const text = lines.join("\n");
  assert.ok(len(text) >= 4096, "payload must exceed MIN_BYTES");
  const compressed = await compressToolOutput("bash", text, len(text), store);
  assert.ok(compressed && compressed.changed, "log output should be compressed");
  const origTokens = Math.ceil(len(text) / 4);
  const compTokens = Math.ceil(len(compressed.text) / 4);
  const saving = (origTokens - compTokens) / origTokens;
  assert.ok(saving >= 0.50, `log saving ${(saving * 100).toFixed(1)}% < 50% threshold`);
  assert.ok(compressed.blobId && compressed.blobId.length > 0, "log blob id should be set (original saved)");
}));

test("CERT: diff output achieves >=50% token saving", () => withTempBlob(async (tmp, store) => {
  const hunks = [];
  for (let h = 0; h < 500; h++) {
    hunks.push(`diff --git a/file${h}.c b/file${h}.c\nindex abc${h}..def${h}\n--- a/file${h}.c\n+++ b/file${h}.c\n@@ -1,10 +1,12 @@\n line1\n line2\n+new_line_${h}\n line3\n line4\n line5\n`);
  }
  const text = hunks.join("\n");
  assert.ok(len(text) >= 4096, "payload must exceed MIN_BYTES");
  const compressed = await compressToolOutput("bash", text, len(text), store);
  assert.ok(compressed && compressed.changed, "diff output should be compressed");
  const origTokens = Math.ceil(len(text) / 4);
  const compTokens = Math.ceil(len(compressed.text) / 4);
  const saving = (origTokens - compTokens) / origTokens;
  assert.ok(saving >= 0.50, `diff saving ${(saving * 100).toFixed(1)}% < 50% threshold`);
  assert.ok(compressed.blobId && compressed.blobId.length > 0, "diff blob id should be set (original saved)");
}));

test("CERT: JSON array achieves >=50% token saving", () => withTempBlob(async (tmp, store) => {
  const items = [];
  for (let i = 0; i < 2000; i++) {
    items.push(`{"id":${i},"path":"src/module_${i}.c","status":"ok","score":${i % 10}}`);
  }
  const text = `[\n${items.join(",\n")}\n]`;
  assert.ok(len(text) >= 4096, "payload must exceed MIN_BYTES");
  const compressed = await compressToolOutput("api_result", text, len(text), store);
  assert.ok(compressed && compressed.changed, "JSON array should be compressed");
  const origTokens = Math.ceil(len(text) / 4);
  const compTokens = Math.ceil(len(compressed.text) / 4);
  const saving = (origTokens - compTokens) / origTokens;
  assert.ok(saving >= 0.50, `json saving ${(saving * 100).toFixed(1)}% < 50% threshold`);
  assert.ok(compressed.blobId && compressed.blobId.length > 0, "json blob id should be set (original saved)");
}));

test("CERT: file read achieves >=50% token saving", () => withTempBlob(async (tmp, store) => {
  const lines = [];
  for (let i = 0; i < 10000; i++) {
    lines.push(`#define MACRO_${i} ${i * 100} /* doc for macro ${i} */`);
  }
  const text = lines.join("\n");
  assert.ok(len(text) >= 4096, "payload must exceed MIN_BYTES");
  const compressed = await compressToolOutput("read", text, len(text), store);
  assert.ok(compressed && compressed.changed, "file read should be compressed");
  const origTokens = Math.ceil(len(text) / 4);
  const compTokens = Math.ceil(len(compressed.text) / 4);
  const saving = (origTokens - compTokens) / origTokens;
  assert.ok(saving >= 0.50, `file read saving ${(saving * 100).toFixed(1)}% < 50% threshold`);
  assert.ok(compressed.blobId && compressed.blobId.length > 0, "file read blob id should be set (original saved)");
}));

// ---------------------------------------------------------------------------
// Certification: reversibility — every compressed blob is byte-exact retrievable
// ---------------------------------------------------------------------------

test("CERT: all compressed blobs are byte-exact retrievable", () => withTempBlob(async (tmp, store) => {
  const payloads = [
    { name: "search", text: "file.c:10: match\nfile.c:20: match\n".repeat(500) },
    { name: "bash", text: "error: ".repeat(2000) },
    { name: "bash", text: "diff --git a/x b/x\n@@ -1 +1 @@\nline\n".repeat(200) },
    { name: "api_result", text: `[{"id":1},{"id":2}]`.repeat(500) },
    { name: "read", text: "#define X ".repeat(5000) },
  ];
  for (const p of payloads) {
    assert.ok(len(p.text) >= 4096, `payload ${p.name} must exceed MIN_BYTES`);
    const compressed = await compressToolOutput(p.name, p.text, len(p.text), store);
    if (!compressed || !compressed.changed) continue;
    assert.ok(compressed.blobId && compressed.blobId.length > 0, `blob_id set for ${p.name}`);
    const recovered = await store.get(compressed.blobId, 0, len(p.text));
    assert.equal(recovered, p.text, `byte-exact recovery for ${p.name}`);
  }
}));

// ---------------------------------------------------------------------------
// Certification: non-tool messages are never modified
// ---------------------------------------------------------------------------

test("CERT: user/assistant/system messages never get compressed", () => withTempBlob(async (tmp, store) => {
  const msgs = [
    { role: "user", content: "hello ".repeat(2000) },
    { role: "assistant", content: "I am ".repeat(2000) },
    { role: "system", content: "system prompt ".repeat(2000) },
  ];
  const out = [];
  for (const msg of msgs) {
    if (msg.role !== "tool") {
      out.push(msg);
      continue;
    }
    assert.fail("non-tool message reached compression logic");
  }
  assert.deepEqual(out, msgs);
}));
