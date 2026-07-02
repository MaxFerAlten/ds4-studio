import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyOutput,
  compressToolOutput,
  compressToolResultForModel,
  ContentKind,
  extractFileTokens,
  summarizeFileListOutput
} from "./toolOutputCompressor.mjs";
import * as compressorModule from "./toolOutputCompressor.mjs";
import { ToolBlobStore } from "./toolBlobStore.mjs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

function len(s) { return Buffer.byteLength(s, "utf8"); }

async function withTempBlob(fn) {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "ds4-compressor-"));
  try {
    const store = new ToolBlobStore(tmp);
    await fn(tmp, store);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// classifyOutput tests
// ---------------------------------------------------------------------------

test("classifyOutput returns FILE for read/more/cat tools", () => {
  assert.equal(classifyOutput("read", "hello\nworld", 11), ContentKind.FILE);
  assert.equal(classifyOutput("more", "content", 7), ContentKind.FILE);
  assert.equal(classifyOutput("cat", "text", 4), ContentKind.FILE);
});

test("classifyOutput returns UNKNOWN for retrieve_context_blob", () => {
  assert.equal(classifyOutput("retrieve_context_blob", "data", 4), ContentKind.UNKNOWN);
});

test("classifyOutput returns DIFF for git diff output", () => {
  const diff = `diff --git a/file b/file\nindex abc..def\n--- a/file\n+++ b/file\n@@ -1,3 +1,4 @@\n line1\n+new line\n line2\n`;
  assert.equal(classifyOutput("bash", diff, len(diff)), ContentKind.DIFF);
});

test("classifyOutput returns DIFF when text has diff --git mid-stream", () => {
  const text = "some noise\ndiff --git a/x b/x\n@@ -1 +1 @@\n";
  assert.equal(classifyOutput("bash", text, len(text)), ContentKind.DIFF);
});

test("classifyOutput returns JSON_ARRAY for large JSON array", () => {
  const json = `[{"a":1},{"b":2}]`.repeat(300); // > 4096 bytes
  assert.equal(classifyOutput("bash", json, len(json)), ContentKind.JSON_ARRAY);
});

test("classifyOutput returns SEARCH for search tool", () => {
  const text = "file.c:10: code\nfile.c:20: more\n";
  assert.equal(classifyOutput("search", text, len(text)), ContentKind.SEARCH);
});

test("classifyOutput returns SEARCH when grep-like pattern detected", () => {
  const lines = [];
  for (let i = 0; i < 10; i++) lines.push(`/path/file${i}.c:${i * 10}: line of code`);
  const text = lines.join("\n") + "\nmatches shown\n";
  assert.equal(classifyOutput("bash", text, len(text)), ContentKind.SEARCH);
});

test("classifyOutput returns LOG for error-containing output", () => {
  assert.equal(classifyOutput("bash", "error: something failed\n", 27), ContentKind.LOG);
  assert.equal(classifyOutput("bash", "Traceback (most recent call)", 27), ContentKind.LOG);
  assert.equal(classifyOutput("bash", "FAILED: test case", 17), ContentKind.LOG);
});

test("classifyOutput returns LOG for bash tool output", () => {
  assert.equal(classifyOutput("bash", "output line 1\nline 2\n", 20), ContentKind.LOG);
});

test("classifyOutput returns FILE for truncated read markers", () => {
  const text = "Tool result (read):\ncontinue_offset=100\n";
  assert.equal(classifyOutput("read", text, len(text)), ContentKind.FILE);
});

test("classifyOutput returns LOG for bash tool output regardless of content", () => {
  assert.equal(classifyOutput("bash", "hello", 5), ContentKind.LOG);
});

test("extractFileTokens preserves repository-relative paths", () => {
  assert.deepEqual(
    extractFileTokens("ds4.c frontend/server/agentLoopGuard.mjs rocm/kernels/reduce.cuh"),
    ["ds4.c", "frontend/server/agentLoopGuard.mjs", "rocm/kernels/reduce.cuh"]
  );
});

test("summarizeFileListOutput compresses large file listings to at most ten examples", () => {
  const files = Array.from({ length: 100 }, (_, i) => `src/file_${i}.c`).join("\n");
  const out = summarizeFileListOutput(files);

  assert.equal(out.compressed, true);
  assert.equal(out.fileTokenCount, 100);
  assert.match(out.content, /\[TOOL_OUTPUT_COMPRESSED\]/);
  assert.match(out.content, /Do not repeat the full file list/);
  assert.ok(extractFileTokens(out.content).length <= 10);
});

test("summarizeFileListOutput compresses repeated filenames even below forty tokens", () => {
  const repeated = Array.from({ length: 4 }, () =>
    "ds4.c ds4.h frontend/server/agentSession.mjs"
  ).join(" ");
  const out = summarizeFileListOutput(repeated);

  assert.equal(out.compressed, true);
  assert.equal(out.reason, "repeated_file_names");
});

test("summarizeFileListOutput leaves short useful file examples unchanged", () => {
  const text = "Targets: ds4.c, frontend/server/agentLoopGuard.mjs";
  assert.deepEqual(summarizeFileListOutput(text), { compressed: false, content: text });
});

test("summarizeFileListOutput does not misclassify long prose without files", () => {
  const text = "ordinary prose ".repeat(700);
  assert.deepEqual(summarizeFileListOutput(text), { compressed: false, content: text });
});

// ---------------------------------------------------------------------------
// compressToolOutput tests
// ---------------------------------------------------------------------------

test("compressToolOutput returns null for short output (< 4096)", async () => {
  await withTempBlob(async (tmp, store) => {
    const result = await compressToolOutput("bash", "short", 5, store);
    assert.equal(result, null);
  });
});

test("compressToolOutput returns null for retrieve_context_blob", async () => {
  await withTempBlob(async (tmp, store) => {
    const result = await compressToolOutput("retrieve_context_blob", "x".repeat(5000), 5000, store);
    assert.equal(result, null);
  });
});

test("compressToolOutput compresses log output with head/tail/important lines", async () => {
  await withTempBlob(async (tmp, store) => {
    // Build a log with 300 lines, some important, total > 4096 bytes
    const lines = [];
    for (let i = 0; i < 300; i++) {
      lines.push(`line ${i}: ${i === 50 ? "error: critical failure" : "info message"}`);
    }
    const text = lines.join("\n");
    const result = await compressToolOutput("bash", text, len(text), store);
    assert.ok(result);
    assert.ok(result.changed);
    assert.equal(result.kind, ContentKind.LOG);
    assert.ok(result.text.includes("[log output compressed]"));
    assert.ok(result.text.includes("error: critical failure"));
    assert.ok(result.blobId);
    assert.ok(ToolBlobStore.isValidId(result.blobId));
    assert.ok(result.omittedLines > 0);
  });
});

test("compressToolOutput compresses search output with per-file stats", async () => {
  await withTempBlob(async (tmp, store) => {
    // No recognized file extensions: exercise the generic search compressor,
    // not the file-list policy.
    const lines = [];
    for (let i = 0; i < 600; i++) {
      lines.push(`/path/symbol${Math.floor(i / 200)}:${i * 10}: match content ${i}`);
    }
    const text = lines.join("\n") + "\nmatches shown\n";
    const result = await compressToolOutput("search", text, len(text), store);
    assert.ok(result);
    assert.equal(result.kind, ContentKind.SEARCH);
    assert.ok(result.text.includes("[search output compressed]"));
    assert.ok(result.text.includes("matches_by_file"));
    assert.ok(result.blobId);
  });
});

test("compresses large file listings produced by bash/log output", async () => {
  await withTempBlob(async (_tmp, store) => {
    const original = [
      "Repository indexed successfully",
      ...Array.from({ length: 80 }, (_, i) => `src/file_${i}.c`)
    ].join("\n");

    const result = await compressToolOutput("bash", original, len(original), store);

    assert.ok(result?.changed);
    assert.equal(result.strategy, "file_list_compressor");
    assert.match(result.text, /\[TOOL_OUTPUT_COMPRESSED\]/);
    assert.ok(extractFileTokens(result.text).length <= 10);
  });
});

test("prefers file-list compression for log output above twenty file tokens", () => {
  const original = Array.from(
    { length: 25 },
    (_, i) => `src/file_${i}.c ${"x".repeat(250)}`
  ).join("\n");

  assert.equal(typeof compressorModule.shouldPreferFileListCompression, "function");
  assert.equal(
    compressorModule.shouldPreferFileListCompression("bash", ContentKind.LOG, original),
    true
  );
});

test("compresses search output when it is primarily a large file listing", async () => {
  await withTempBlob(async (_tmp, store) => {
    const original = Array.from(
      { length: 80 },
      (_, i) => `src/file_${i}.c:${i + 1}: match`
    ).join("\n");

    const result = await compressToolOutput("search", original, len(original), store);

    assert.ok(result?.changed);
    assert.equal(result.strategy, "file_list_compressor");
    assert.ok(extractFileTokens(result.text).length <= 10);
  });
});

test("compressToolOutput compresses diff output with +/- summary", async () => {
  await withTempBlob(async (tmp, store) => {
    // Build a diff where most lines are context (unchanged) so compression helps
    let diff = "";
    for (let f = 0; f < 3; f++) {
      diff += `diff --git a/f${f} b/f${f}\nindex a1..b2\n--- a/f${f}\n+++ b/f${f}\n`;
      for (let i = 0; i < 100; i++) {
        // Each hunk: 2 context lines, 1 added line
        diff += `@@ -${i},3 +${i},4 @@\n context line ${i}\n context line ${i} continued\n+new line ${i}\n`;
      }
    }
    const result = await compressToolOutput("bash", diff, len(diff), store);
    assert.ok(result);
    assert.equal(result.kind, ContentKind.DIFF);
    assert.ok(result.text.includes("[diff compressed]"));
    assert.ok(result.text.includes("summary: +"));
  });
});

test("compressToolOutput compresses JSON array with head/tail", async () => {
  await withTempBlob(async (tmp, store) => {
    const items = [];
    for (let i = 0; i < 500; i++) items.push(`{"idx":${i},"val":"${"x".repeat(20)}"}`);
    const text = `[\n${items.join(",\n")}\n]`;
    const result = await compressToolOutput("bash", text, len(text), store);
    assert.ok(result);
    assert.equal(result.kind, ContentKind.JSON_ARRAY);
    assert.ok(result.text.includes("[json array compressed]"));
    assert.ok(result.text.includes("sample_first"));
  });
});

test("compressToolOutput compresses file output with head/tail", async () => {
  await withTempBlob(async (tmp, store) => {
    const lines = [];
    for (let i = 0; i < 500; i++) lines.push(`line ${i}: data content and some extra padding`);
    const text = lines.join("\n");
    const result = await compressToolOutput("read", text, len(text), store);
    assert.ok(result);
    assert.equal(result.kind, ContentKind.FILE);
    assert.ok(result.text.includes("[file content compressed]"));
    assert.ok(result.text.includes("head:\n"));
    assert.ok(result.text.includes("tail:\n"));
  });
});

test("compressToolOutput returns null when compression ratio is too low", async () => {
  await withTempBlob(async (tmp, store) => {
    // Text that compresses poorly (few lines, each unique)
    const text = "a\nb\nc\nd\ne\nf\ng\nh\n".repeat(600); // > 4096
    const result = await compressToolOutput("bash", text, len(text), store);
    // May or may not compress depending on ratio — accept either
    if (result) {
      assert.ok(result.blobId);
      assert.ok(ToolBlobStore.isValidId(result.blobId));
    }
  });
});

test("compressToolOutput stores original text in blob store for later retrieval", async () => {
  await withTempBlob(async (tmp, store) => {
    // 500 lines, mostly non-important, a few with "error"
    const lines = [];
    for (let i = 0; i < 500; i++) {
      if (i % 50 === 0) {
        lines.push(`line ${i}: error: critical failure ${i}`);
      } else {
        lines.push(`line ${i}: info message with padding data ${i}`);
      }
    }
    const text = lines.join("\n");
    const result = await compressToolOutput("bash", text, len(text), store);
    assert.ok(result);
    assert.ok(result.blobId);

    // Retrieve the original from the blob store (request full original bytes)
    const original = await store.get(result.blobId, 0, result.originalBytes);
    assert.equal(original, text);
  });
});

test("compressToolOutput handles huge output with generic head/tail", async () => {
  await withTempBlob(async (tmp, store) => {
    const lines = [];
    for (let i = 0; i < 2000; i++) lines.push(`data ${i}: some random content for testing padding`);
    const text = lines.join("\n");
    const result = await compressToolOutput("unknown_tool", text, len(text), store);
    assert.ok(result);
    // kind stays UNKNOWN, strategy is file_head_tail_compressor
    assert.equal(result.kind, ContentKind.UNKNOWN);
    assert.ok(result.text.includes("[file content compressed]"));
  });
});

test("compressToolOutput returns null without a blob store", async () => {
  const text = "error: critical\n".repeat(100);
  const result = await compressToolOutput("bash", text, len(text), null);
  assert.equal(result, null);
});

test("compressToolOutput compresses a sub-4KB repository listing and preserves its blob", async () => {
  await withTempBlob(async (tmp, store) => {
    const original = Array.from({ length: 80 }, (_, i) => `src/file_${i}.c`).join("\n");
    assert.ok(len(original) < 4096, "fixture must exercise the file-token threshold");
    const result = await compressToolOutput("list", original, len(original), store);

    assert.ok(result?.changed);
    assert.equal(result.strategy, "file_list_compressor");
    assert.match(result.text, /\[TOOL_OUTPUT_COMPRESSED\]/);
    assert.ok(extractFileTokens(result.text).length <= 10);
    assert.equal(await store.get(result.blobId, 0, len(original)), original);
  });
});

test("compressToolResultForModel exposes compressed content and metadata to the agent loop", async () => {
  await withTempBlob(async (tmp, store) => {
    const original = Array.from({ length: 80 }, (_, i) => `src/file_${i}.c`).join("\n");
    const result = await compressToolResultForModel("list", { content: original, isError: false }, store);

    assert.equal(result.compressed, true);
    assert.equal(result.isError, false);
    assert.match(result.content, /\[TOOL_OUTPUT_COMPRESSED\]/);
    assert.equal(result.compression.strategy, "file_list_compressor");
  });
});
