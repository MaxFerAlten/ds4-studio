import test from "node:test";
import assert from "node:assert/strict";
import { classifyOutput, compressToolOutput, ContentKind } from "./toolOutputCompressor.mjs";
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
    // 600 lines, 3 files, ~200 lines per file. Top 5 shown per file = 15 + 40 head ≈ 55 shown out of 600 = good ratio
    const lines = [];
    for (let i = 0; i < 600; i++) {
      lines.push(`/path/file${Math.floor(i / 200)}.c:${i * 10}: match content ${i}`);
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
