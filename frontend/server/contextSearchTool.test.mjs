import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs/promises";
import crypto from "node:crypto";
import { contextSearch, CONTEXT_SEARCH_TOOL } from "./contextSearchTool.mjs";
import { appendContextEvent } from "./contextLedger.mjs";
import { appendContextEvidence, summarizeToolResultForEvidence } from "./contextEvidence.mjs";
import { sessionContextDir } from "./contextPaths.mjs";

function freshKey() {
  return `test-search-${crypto.randomUUID()}`;
}
async function cleanup(key) {
  await fs.rm(sessionContextDir(key), { recursive: true, force: true });
}

test("query finds a decision", async () => {
  const key = freshKey();
  try {
    await appendContextEvent(key, { type: "decision", summary: "avoid raw web echo, use blob store" });
    const res = await contextSearch({ sessionKey: key, query: "blob store" });
    assert.equal(res.status, "ok");
    assert.ok(res.results.some((r) => r.kind === "decision"));
  } finally {
    await cleanup(key);
  }
});

test("query finds a file target", async () => {
  const key = freshKey();
  try {
    await appendContextEvidence(key, summarizeToolResultForEvidence({ tool: "read", args: { path: "src/agent.c" }, resultText: "code" }));
    const res = await contextSearch({ sessionKey: key, query: "agent.c" });
    assert.ok(res.results.some((r) => r.id?.startsWith("ev_")));
  } finally {
    await cleanup(key);
  }
});

test("limit is respected", async () => {
  const key = freshKey();
  try {
    for (let i = 0; i < 8; i++) await appendContextEvent(key, { type: "claim", summary: `token match ${i}` });
    const res = await contextSearch({ sessionKey: key, query: "token", limit: 3 });
    assert.equal(res.results.length, 3);
  } finally {
    await cleanup(key);
  }
});

test("empty query returns safe error", async () => {
  const res = await contextSearch({ sessionKey: freshKey(), query: "  " });
  assert.equal(res.status, "error");
  assert.deepEqual(res.results, []);
});

test("results never carry raw blob content", async () => {
  const key = freshKey();
  try {
    await appendContextEvidence(key, summarizeToolResultForEvidence({
      tool: "crawl", args: { url: "http://x" }, resultText: "z".repeat(100000), blobIds: ["blob_1"]
    }));
    const res = await contextSearch({ sessionKey: key, query: "http" });
    for (const r of res.results) assert.ok((r.summary || "").length <= 800);
  } finally {
    await cleanup(key);
  }
});

test("tool schema requires query", () => {
  assert.deepEqual(CONTEXT_SEARCH_TOOL.function.parameters.required, ["query"]);
  assert.equal(CONTEXT_SEARCH_TOOL.function.name, "context_search");
});
