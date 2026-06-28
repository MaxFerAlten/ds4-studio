import test from "node:test";
import assert from "node:assert/strict";
import { compressToolOutput, ContentKind } from "./toolOutputCompressor.mjs";
import { ToolBlobStore } from "./toolBlobStore.mjs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

function len(s) { return Buffer.byteLength(s, "utf8"); }

async function withTempBlob(fn) {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "ds4-chat-compression-"));
  try {
    const store = new ToolBlobStore(tmp);
    await fn(tmp, store);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Non-regression: messages that are NOT tool results pass through unchanged
// ---------------------------------------------------------------------------

test("nonreg: user/assistant/system messages pass through unchanged", () => withTempBlob(async (tmp, store) => {
  const msgs = [
    { role: "user", content: "hello world" },
    { role: "assistant", content: "I am an assistant" },
    { role: "system", content: "you are helpful" },
    { role: "user", content: "" }
  ];
  const result = await compressToolResultsInMessages(msgs, store);
  assert.deepEqual(result, msgs);
}));

test("nonreg: tool message below 4k threshold passes through unchanged", () => withTempBlob(async (tmp, store) => {
  const msgs = [{ role: "tool", content: "small text", name: "bash" }];
  const result = await compressToolResultsInMessages(msgs, store);
  assert.deepEqual(result, msgs);
}));

test("nonreg: compressEnabled=false passes all messages through unchanged", () => withTempBlob(async (tmp, store) => {
  const msgs = [{ role: "tool", content: "x".repeat(10000), name: "search" }];
  const result = await compressToolResultsInMessages(msgs, null);
  assert.deepEqual(result, msgs);
}));

// ---------------------------------------------------------------------------
// Non-regression: compressEnabled=true compresses large tool results
// ---------------------------------------------------------------------------

test("nonreg: large tool result is compressed and carries blob marker", () => withTempBlob(async (tmp, store) => {
  const lines = [];
  for (let i = 0; i < 2000; i++) {
    lines.push(`error: build failed at step ${i} with code ${i % 10}`);
  }
  const big = lines.join("\n");
  const msgs = [{ role: "tool", content: big, name: "bash" }];
  const result = await compressToolResultsInMessages(msgs, store);
  assert(result[0].content !== big);
  assert(result[0].content.includes("blob_id"));
  assert(result[0].content.includes("retrieve_context_blob"));
  assert(result[0].content.includes("original_bytes"));
  assert(result[0].content.includes("compressed_bytes"));
}));

test("nonreg: compression does not expand the output", () => withTempBlob(async (tmp, store) => {
  const big = "error: ".repeat(2000);
  const msgs = [{ role: "tool", content: big, name: "bash" }];
  const result = await compressToolResultsInMessages(msgs, store);
  assert.ok(result[0].content.length <= big.length, "compressed should not be longer than original");
}));

test("nonreg: multiple tool messages are compressed independently", () => withTempBlob(async (tmp, store) => {
  const msgs = [
    { role: "tool", content: "short", name: "bash" },
    { role: "tool", content: "file.c:10: match\nfile.c:20: match\n".repeat(500), name: "search" },
    { role: "tool", content: "medium", name: "bash" },
  ];
  const result = await compressToolResultsInMessages(msgs, store);
  assert.equal(result[0].content, "short");
  assert(result[1].content !== msgs[1].content);
  assert.equal(result[2].content, "medium");
}));

// ---------------------------------------------------------------------------
// Non-regression: blob store integration
// ---------------------------------------------------------------------------

test("nonreg: compressed tool result is recoverable via blob retrieve", () => withTempBlob(async (tmp, store) => {
  const lines = [];
  for (let i = 0; i < 2000; i++) {
    lines.push("error: line " + i + " failed with code " + (i % 10));
  }
  const original = lines.join("\n");
  const compressed = await compressToolOutput("bash", original, len(original), store);
  assert.ok(compressed && compressed.changed, "should compress");
  assert.ok(compressed.blobId && compressed.blobId.length > 0, "blob id set");
  const recovered = await store.get(compressed.blobId, 0, len(original));
  assert.equal(recovered, original);
}));

test("nonreg: retrieve_context_blob output is never recompressed", () => withTempBlob(async (tmp, store) => {
  const original = "test content " + "x".repeat(2000);
  const blobResult = await store.put(original);
  assert.ok(blobResult.id.length > 0);
  const retrieveOutput = `context_blob id=${blobResult.id} offset=0 bytes=${len(original)} requested_length=20000\n<context_blob_range>\n${original}\n</context_blob_range>\n`;
  const compressed = await compressToolOutput("retrieve_context_blob", retrieveOutput, len(retrieveOutput), store);
  assert.equal(compressed, null, "retrieve output must not be recompressed");
}));

// ---------------------------------------------------------------------------
// Helper: compressToolResultsInMessages (mirrors the one in index.mjs)
// ---------------------------------------------------------------------------

async function compressToolResultsInMessages(messages, toolBlobStore) {
  if (!toolBlobStore) return messages;
  const out = [];
  for (const msg of messages) {
    if (msg.role !== "tool" || !msg.content || Buffer.byteLength(msg.content, "utf8") < 4096) {
      out.push(msg);
      continue;
    }
    const compressed = await compressToolOutput(
      msg.name || "tool",
      msg.content,
      Buffer.byteLength(msg.content, "utf8"),
      toolBlobStore
    );
    if (!compressed || !compressed.changed || !compressed.text) {
      out.push(msg);
      continue;
    }
    out.push({ ...msg, content: compressed.text });
  }
  return out;
}
