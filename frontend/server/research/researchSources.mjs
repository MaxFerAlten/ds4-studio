// Source normalization, dedup, ranking, and citation formatting (spec §14).
// A "source" is anything a finding can cite: a file chunk, a tool result, a
// manual note, or (Phase 2b) a web page.

import { createHash } from "node:crypto";
import { buildIndex, searchChunks } from "./researchRag.mjs";

function sourceId(seq) {
  return `src_${String(seq).padStart(3, "0")}`;
}

function textHash(text) {
  return createHash("sha256").update(String(text || "")).digest("hex").slice(0, 16);
}

// Normalize one raw source into the canonical shape with a stable id.
export function normalizeSource(raw = {}, seq = 1) {
  const snippet = String(raw.snippet || raw.text || "").slice(0, 2000);
  return {
    id: raw.id || sourceId(seq),
    kind: raw.kind || (raw.url ? "web" : raw.filename ? "file" : "manual"),
    title: raw.title || raw.filename || raw.url || `source ${seq}`,
    url: raw.url || null,
    filename: raw.filename || null,
    provider: raw.provider || null,
    sourceType: raw.sourceType || null,
    score: typeof raw.score === "number" ? raw.score : null,
    retrievedAt: raw.retrievedAt || new Date().toISOString(),
    textHash: raw.textHash || textHash(raw.text || snippet),
    snippet,
    authors: Array.isArray(raw.authors) ? raw.authors : [],
    chunks: Array.isArray(raw.chunks) ? raw.chunks : []
  };
}

// Normalize a list and assign stable ids in order. Existing ids are preserved.
export function normalizeSources(rawList = []) {
  let seq = 0;
  return rawList.map((raw) => {
    seq += 1;
    return normalizeSource(raw, seq);
  });
}

// Dedup by url, then by textHash. First occurrence wins (keeps its id).
export function dedupeSources(sources = []) {
  const seenUrl = new Set();
  const seenHash = new Set();
  const out = [];
  for (const s of sources) {
    const urlKey = s.url ? `u:${s.url}` : null;
    const hashKey = s.textHash ? `h:${s.textHash}` : null;
    if (urlKey && seenUrl.has(urlKey)) continue;
    if (hashKey && seenHash.has(hashKey)) continue;
    if (urlKey) seenUrl.add(urlKey);
    if (hashKey) seenHash.add(hashKey);
    out.push(s);
  }
  return out;
}

// Rank sources by lexical relevance of their snippet to the query (BM25).
// Returns a new array sorted desc; unscored sources keep their relative order
// after scored ones.
export function rankSources(query, sources = []) {
  if (!sources.length) return [];
  const index = buildIndex(sources.map((s) => ({ id: s.id, text: `${s.title} ${s.snippet}` })));
  const scoreById = new Map(searchChunks(index, query, { topK: sources.length }).map((h) => [h.id, h.score]));
  return [...sources].sort(
    (a, b) => (scoreById.get(b.id) || 0) - (scoreById.get(a.id) || 0)
  );
}

// Attach evidence source-refs to a finding, dropping refs to unknown ids.
export function attachEvidence(finding = {}, knownIds = []) {
  const known = new Set(knownIds);
  const evidence = Array.isArray(finding.evidence) ? finding.evidence : [];
  return {
    ...finding,
    evidence: evidence.filter((e) => known.has(e.source_id))
  };
}

// Find every src_xxx token referenced in the report body.
export function citedSourceIds(markdown) {
  const ids = new Set();
  const re = /\bsrc_\d{3,}\b/g;
  let m;
  while ((m = re.exec(String(markdown || "")))) ids.add(m[0]);
  return [...ids];
}

// Append a "## Fonti" section listing the cited sources, and report any cited
// id that does not correspond to a known source (spec §14 anti-hallucination).
export function formatCitations(markdown, sources = [], { heading = "Fonti" } = {}) {
  const byId = new Map(sources.map((s) => [s.id, s]));
  const cited = citedSourceIds(markdown);
  const missingIds = cited.filter((id) => !byId.has(id));
  const presentIds = cited.filter((id) => byId.has(id));

  let out = markdown;
  if (presentIds.length) {
    const lines = presentIds.map((id) => {
      const s = byId.get(id);
      const where = s.url || s.filename || s.kind;
      return `- [${id}] ${s.title}${where ? ` — ${where}` : ""}`;
    });
    out = `${markdown.trimEnd()}\n\n## ${heading}\n\n${lines.join("\n")}\n`;
  }
  return { markdown: out, citedIds: presentIds, missingIds };
}
