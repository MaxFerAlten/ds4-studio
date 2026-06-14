// Local, dependency-free retrieval: BM25 over document chunks + reciprocal
// rank fusion (spec §12 Level 1). Deterministic — no embeddings, no network.

import { splitMarkdownChunks } from "../fileIngestion.mjs";

const BM25_K1 = 1.5;
const BM25_B = 0.75;
const TOKEN_RE = /[\p{L}\p{N}]+/gu;

export function tokenize(text) {
  const out = String(text || "").toLowerCase().match(TOKEN_RE);
  return out ? out : [];
}

// Chunk a document into small retrieval units. Reuses the markdown splitter
// with a small target so each chunk is a focused passage, then tags ids.
export function chunkDocument(text, { docId = "doc", targetTokens = 400 } = {}) {
  const raw = splitMarkdownChunks(text, targetTokens);
  return raw.map((chunk, i) => ({
    id: `${docId}_c${String(i).padStart(3, "0")}`,
    docId,
    index: i,
    title: chunk.title || "",
    text: chunk.body,
    approxTokens: chunk.approxTokens
  }));
}

// Build a BM25 index over an array of {id, text, ...} chunks.
export function buildIndex(chunks) {
  const docs = chunks.map((chunk) => {
    const terms = tokenize(`${chunk.title ? `${chunk.title} ` : ""}${chunk.text}`);
    const tf = new Map();
    for (const term of terms) tf.set(term, (tf.get(term) || 0) + 1);
    return { chunk, tf, length: terms.length };
  });
  const df = new Map();
  for (const doc of docs) {
    for (const term of doc.tf.keys()) df.set(term, (df.get(term) || 0) + 1);
  }
  const totalLength = docs.reduce((sum, d) => sum + d.length, 0);
  return {
    docs,
    df,
    docCount: docs.length,
    avgdl: docs.length ? totalLength / docs.length : 0
  };
}

function idf(index, term) {
  const n = index.df.get(term) || 0;
  // BM25 idf, floored at a small positive value so common terms still rank.
  return Math.max(1e-6, Math.log(1 + (index.docCount - n + 0.5) / (n + 0.5)));
}

// Score every chunk against the query; return the topK as
// [{ id, score, chunk }], highest first. Zero-score chunks are dropped.
export function searchChunks(index, query, { topK = 8 } = {}) {
  if (!index || !index.docCount) return [];
  const queryTerms = [...new Set(tokenize(query))];
  const scored = [];
  for (const doc of index.docs) {
    let score = 0;
    for (const term of queryTerms) {
      const f = doc.tf.get(term);
      if (!f) continue;
      const denom = f + BM25_K1 * (1 - BM25_B + (BM25_B * doc.length) / (index.avgdl || 1));
      score += idf(index, term) * ((f * (BM25_K1 + 1)) / denom);
    }
    if (score > 0) scored.push({ id: doc.chunk.id, score, chunk: doc.chunk });
  }
  scored.sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1));
  return scored.slice(0, topK);
}

// Reciprocal Rank Fusion of several ranked id-lists.
// Each list is an array of items carrying `id`. Returns [{ id, score }] desc.
export function rrfFuse(rankedLists, { k = 60, topK = Infinity } = {}) {
  const scores = new Map();
  for (const list of rankedLists) {
    list.forEach((item, rank) => {
      const id = typeof item === "string" ? item : item.id;
      if (id === undefined) return;
      scores.set(id, (scores.get(id) || 0) + 1 / (k + rank + 1));
    });
  }
  const fused = [...scores.entries()].map(([id, score]) => ({ id, score }));
  fused.sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1));
  return Number.isFinite(topK) ? fused.slice(0, topK) : fused;
}

// Convenience: run several queries against an index and RRF-fuse the results,
// returning the fused chunks (with their best raw chunk attached) up to topK.
export function multiQuerySearch(index, queries, { perQueryK = 8, topK = 8 } = {}) {
  const byId = new Map();
  const lists = [];
  for (const query of queries) {
    const hits = searchChunks(index, query, { topK: perQueryK });
    for (const hit of hits) byId.set(hit.id, hit.chunk);
    lists.push(hits);
  }
  return rrfFuse(lists, { topK }).map((entry) => ({
    id: entry.id,
    score: entry.score,
    chunk: byId.get(entry.id)
  }));
}
