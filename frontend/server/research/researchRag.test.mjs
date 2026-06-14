import test from "node:test";
import assert from "node:assert/strict";
import {
  buildIndex,
  chunkDocument,
  multiQuerySearch,
  rrfFuse,
  searchChunks,
  tokenize
} from "./researchRag.mjs";

test("tokenize lowercases and splits on non-alphanumerics", () => {
  assert.deepEqual(tokenize("Redis-Cluster, vs. Sentinel!"), ["redis", "cluster", "vs", "sentinel"]);
  assert.deepEqual(tokenize(""), []);
});

test("chunkDocument tags stable ids and keeps text", () => {
  const md = "# A\n\nalpha beta gamma\n\n# B\n\ndelta epsilon zeta";
  const chunks = chunkDocument(md, { docId: "d1", targetTokens: 50 });
  assert.ok(chunks.length >= 1);
  assert.match(chunks[0].id, /^d1_c000$/);
  assert.equal(chunks[0].docId, "d1");
  assert.ok(chunks.every((c) => typeof c.text === "string" && c.text.length));
});

test("searchChunks ranks the lexically relevant chunk first", () => {
  const chunks = [
    { id: "c0", title: "", text: "redis cluster sharding and gossip protocol" },
    { id: "c1", title: "", text: "redis sentinel failover and monitoring" },
    { id: "c2", title: "", text: "postgres replication streaming" }
  ];
  const index = buildIndex(chunks);
  const hits = searchChunks(index, "sentinel failover", { topK: 3 });
  assert.equal(hits[0].id, "c1");
  assert.ok(hits.every((h) => h.score > 0));
  assert.ok(!hits.some((h) => h.id === "c2"), "irrelevant chunk must score zero and be dropped");
});

test("searchChunks returns [] for an empty index or no match", () => {
  assert.deepEqual(searchChunks(buildIndex([]), "anything"), []);
  const index = buildIndex([{ id: "c0", text: "alpha" }]);
  assert.deepEqual(searchChunks(index, "zzzzz"), []);
});

test("rrfFuse rewards items ranked highly across lists", () => {
  const a = [{ id: "x" }, { id: "y" }, { id: "z" }];
  const b = [{ id: "y" }, { id: "x" }, { id: "w" }];
  const fused = rrfFuse([a, b]);
  // y is rank 2 then rank 1; x is rank 1 then rank 2 — both beat z and w.
  assert.deepEqual(fused.slice(0, 2).map((e) => e.id).sort(), ["x", "y"]);
  assert.ok(fused.find((e) => e.id === "z").score < fused.find((e) => e.id === "x").score);
});

test("rrfFuse honors topK and accepts plain id strings", () => {
  const fused = rrfFuse([["a", "b", "c"], ["b", "c", "a"]], { topK: 2 });
  assert.equal(fused.length, 2);
});

test("multiQuerySearch fuses several queries into ranked chunks", () => {
  const chunks = [
    { id: "c0", text: "redis cluster sharding" },
    { id: "c1", text: "redis sentinel failover monitoring" },
    { id: "c2", text: "unrelated kafka topic partition" }
  ];
  const index = buildIndex(chunks);
  const fused = multiQuerySearch(index, ["sentinel", "failover"], { topK: 2 });
  assert.equal(fused[0].id, "c1");
  assert.ok(fused[0].chunk.text.includes("sentinel"));
});
