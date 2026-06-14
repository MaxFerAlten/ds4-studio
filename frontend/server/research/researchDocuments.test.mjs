import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ResearchStateStore } from "./researchStateStore.mjs";
import { searchChunks } from "./researchRag.mjs";

async function tmpStore(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ds4-research-docs-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return new ResearchStateStore({ rootDir: dir });
}

test("addDocument chunks and records in the manifest", async (t) => {
  const store = await tmpStore(t);
  const { sessionId } = await store.createSession("q");
  const entry = await store.addDocument(sessionId, {
    name: "redis.md",
    markdown: "# Redis\n\nredis sentinel failover monitoring\n\n# Cluster\n\nsharding gossip"
  });
  assert.equal(entry.docId, "doc000");
  assert.ok(entry.chunkCount >= 1);
  const manifest = await store.loadDocuments(sessionId);
  assert.equal(manifest.length, 1);
  assert.equal(manifest[0].name, "redis.md");
});

test("addDocument rejects empty markdown", async (t) => {
  const store = await tmpStore(t);
  const { sessionId } = await store.createSession("q");
  await assert.rejects(() => store.addDocument(sessionId, { name: "x", markdown: "  " }), /empty/);
});

test("loadRagIndex builds a searchable index over all documents", async (t) => {
  const store = await tmpStore(t);
  const { sessionId } = await store.createSession("q");
  await store.addDocument(sessionId, { name: "a.md", markdown: "redis sentinel failover" });
  await store.addDocument(sessionId, { name: "b.md", markdown: "postgres streaming replication" });
  const rag = await store.loadRagIndex(sessionId);
  assert.ok(rag, "index should exist when docs present");
  const hits = searchChunks(rag.index, "sentinel failover", { topK: 3 });
  assert.ok(hits.length >= 1);
  assert.match(hits[0].chunk.text, /sentinel/);
});

test("loadRagIndex returns null with no documents", async (t) => {
  const store = await tmpStore(t);
  const { sessionId } = await store.createSession("q");
  assert.equal(await store.loadRagIndex(sessionId), null);
  assert.deepEqual(await store.loadDocuments(sessionId), []);
});

test("a second document gets the next doc id and accumulates chunks", async (t) => {
  const store = await tmpStore(t);
  const { sessionId } = await store.createSession("q");
  await store.addDocument(sessionId, { name: "a.md", markdown: "alpha beta" });
  const second = await store.addDocument(sessionId, { name: "b.md", markdown: "gamma delta" });
  assert.equal(second.docId, "doc001");
  const chunks = await store.loadAllChunks(sessionId);
  assert.ok(chunks.length >= 2);
});
