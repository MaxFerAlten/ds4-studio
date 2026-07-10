import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs/promises";
import crypto from "node:crypto";
import {
  summarizeToolResultForEvidence,
  appendContextEvidence,
  readContextEvidence,
  markEvidenceStaleByTarget,
  looksSecretLike
} from "./contextEvidence.mjs";
import { sessionContextDir } from "./contextPaths.mjs";

function freshKey() {
  return `test-evidence-${crypto.randomUUID()}`;
}
async function cleanup(key) {
  await fs.rm(sessionContextDir(key), { recursive: true, force: true });
}

test("file read produces kind=file_read", () => {
  const ev = summarizeToolResultForEvidence({ tool: "read", args: { path: "a.c" }, resultText: "x" });
  assert.equal(ev.kind, "file_read");
  assert.equal(ev.target, "a.c");
});

test("crawl produces kind=crawl", () => {
  const ev = summarizeToolResultForEvidence({ tool: "web_crawl", args: { url: "http://x" }, resultText: "x" });
  assert.equal(ev.kind, "crawl");
  assert.equal(ev.target, "http://x");
});

test("summary does not exceed 800 chars", () => {
  const ev = summarizeToolResultForEvidence({ tool: "read", args: {}, resultText: "a".repeat(5000) });
  assert.ok(ev.summary.length <= 800);
});

test("blobIds add a limitation", () => {
  const ev = summarizeToolResultForEvidence({ tool: "read", args: {}, resultText: "x", blobIds: ["b1"] });
  assert.equal(ev.limitations.length, 1);
  assert.deepEqual(ev.blobIds, ["b1"]);
});

test("append/read preserves order", async () => {
  const key = freshKey();
  try {
    for (let i = 0; i < 5; i++) {
      await appendContextEvidence(key, summarizeToolResultForEvidence({ tool: "read", args: {}, resultText: `r${i}` }));
    }
    const all = await readContextEvidence(key);
    assert.equal(all.length, 5);
    assert.equal(all[0].summary, "r0");
    assert.equal(all[4].summary, "r4");
  } finally {
    await cleanup(key);
  }
});

test("target extracted from path/url/query/command", () => {
  assert.equal(summarizeToolResultForEvidence({ tool: "x", args: { query: "q" } }).target, "q");
  assert.equal(summarizeToolResultForEvidence({ tool: "x", args: { command: "ls" } }).target, "ls");
  assert.equal(summarizeToolResultForEvidence({ tool: "x", args: {} }).target, null);
});

test("secret-like content is redacted", () => {
  assert.equal(looksSecretLike("Authorization: Bearer abc"), true);
  const ev = summarizeToolResultForEvidence({ tool: "read", args: {}, resultText: "OPENAI_API_KEY=sk-123" });
  assert.equal(ev.summary, "[redacted: secret-like content omitted]");
});

test("readContextEvidence returns [] when missing", async () => {
  assert.deepEqual(await readContextEvidence(freshKey()), []);
});

test("markEvidenceStaleByTarget flips read/crawl snapshots for a target", async () => {
  const key = freshKey();
  try {
    await appendContextEvidence(key, summarizeToolResultForEvidence({ tool: "read", args: { path: "a.c" }, resultText: "old" }));
    await appendContextEvidence(key, summarizeToolResultForEvidence({ tool: "read", args: { path: "b.c" }, resultText: "keep" }));
    const flipped = await markEvidenceStaleByTarget(key, "a.c");
    assert.equal(flipped, 1);
    const all = await readContextEvidence(key);
    assert.equal(all.find((e) => e.target === "a.c").stale, true);
    assert.equal(all.find((e) => e.target === "b.c").stale, false);
  } finally {
    await cleanup(key);
  }
});

test("markEvidenceStaleByTarget is a no-op for unknown target / missing file", async () => {
  assert.equal(await markEvidenceStaleByTarget(freshKey(), "nope.c"), 0);
  assert.equal(await markEvidenceStaleByTarget(freshKey(), ""), 0);
});
