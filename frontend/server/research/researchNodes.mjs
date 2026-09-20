// Phase 2 research-loop nodes: evidence gathering, per-step researchers, the
// research-team synthesis, and a bounded reflection self-check. These build on
// the session RAG index (ctx.rag) and the source layer.

import { renderPrompt } from "./researchPrompts.mjs";
import { tryReadPage } from "./pageReader.mjs";
import { RESEARCH_ROLE_OPTIONS } from "./researchModelClient.mjs";
import { buildIndex, chunkDocument, multiQuerySearch, searchChunks } from "./researchRag.mjs";
import {
  attachEvidence,
  citedSourceIds,
  dedupeSources,
  isCitableSource,
  normalizeSources,
  rankSources
} from "./researchSources.mjs";

const SNIPPET_CHARS = 1200;
// A retrieved passage is richer than a snippet; allow more chars for it.
const RELEVANT_CHARS = 1600;
const MAX_PINNED_URLS = 4;

function sourcesForPrompt(sources) {
  return sources.map((s) => ({
    id: s.id,
    title: s.title,
    // Prefer the retrieved passage (real page text) over the short snippet.
    snippet: String(s.relevantText || s.snippet || "").slice(0, s.relevantText ? RELEVANT_CHARS : SNIPPET_CHARS)
  }));
}

// Gather evidence: local RAG over uploaded documents PLUS, when web search is
// enabled, live web sources. Both are folded into the unified source list,
// which assigns the citation ids. No LLM call here (spec §11.3).
// URLs the user typed into the request. Only the original query is scanned:
// the rewriter's queries are model-written, and fetching an address a model
// invented is a request this machine makes on the model's say-so, not the
// user's.
export function explicitUrlsIn(query) {
  const out = [];
  const seen = new Set();
  for (const raw of String(query || "").match(/https?:\/\/[^\s<>"'`\]),]+/gi) || []) {
    const url = raw.replace(/[.,;:!?)]+$/, "");
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      continue;
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") continue;
    const key = parsed.href;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

// Read the URLs the request names, as sources in their own right.
//
// The pipeline only ever had two source origins: uploaded files and web SEARCH.
// A URL in the prompt was therefore swallowed as search text -- asking for
// https://example.org/articles-peer produced the query
// "example.org <topic>" and the page itself was never opened.
async function pinnedSourcesFrom(ctx) {
  if (ctx.config.webFetchEnabled === false) return [];
  const urls = explicitUrlsIn(ctx.state.query);
  if (!urls.length) return [];

  const read = ctx.readPage || tryReadPage;
  const out = [];
  for (const url of urls.slice(0, MAX_PINNED_URLS)) {
    const page = await read(url, {
      signal: ctx.signal,
      maxChars: ctx.config.maxCharsPerPage,
      timeoutMs: ctx.config.timeoutMs
    });
    if (!page || !page.content) {
      ctx.emit?.("search_provider_warning", { provider: "requested-url", url, error: "could not be read" });
      continue;
    }
    out.push({
      kind: "web",
      title: page.title || url,
      url,
      text: page.content,
      snippet: String(page.content).slice(0, 400),
      provider: "requested-url",
      sourceType: "web",
      // The user named this one. It outranks anything a search engine guessed.
      pinned: true,
      score: Number.POSITIVE_INFINITY
    });
  }
  return out;
}

export async function backgroundInvestigatorNode(ctx) {
  // Always include the original query alongside the rewrites so retrieval does
  // not depend solely on the rewriter's phrasing.
  const queries = [...new Set([ctx.state.query, ...(ctx.state.optimizedQueries || [])])].filter(Boolean);
  const raw = [];

  // First, so a later duplicate from search cannot displace the pinned copy.
  raw.push(...await pinnedSourcesFrom(ctx));

  if (ctx.rag && ctx.rag.index) {
    const fused = multiQuerySearch(ctx.rag.index, queries, { topK: ctx.config.maxSourcesPerQuery });
    for (const f of fused) {
      raw.push({
        kind: "file",
        filename: f.chunk.docId,
        title: f.chunk.title || f.chunk.docId,
        text: f.chunk.text,
        sourceType: "file",
        chunks: [{ id: f.chunk.id, text: f.chunk.text, score: f.score }]
      });
    }
  }

  const webEnabled = Boolean(ctx.searchService && ctx.searchService.enabled && ctx.searchService.enabled());
  if (webEnabled) {
    const webSources = await ctx.searchService.gather(queries, { signal: ctx.signal, emit: ctx.emit });
    for (const w of webSources) {
      raw.push({
        kind: "web",
        title: w.title,
        url: w.url,
        text: w.content || w.snippet,
        snippet: w.snippet,
        provider: w.provider,
        sourceType: w.sourceType,
        score: w.score
      });
    }
  }

  ctx.state.sources = dedupeSources(normalizeSources(raw));
  for (const s of ctx.state.sources) ctx.emit("source_found", { source: s });
  const pinnedCount = ctx.state.sources.filter((s) => s.pinned).length;
  return { sourceCount: ctx.state.sources.length, webEnabled, pinnedCount };
}

// Lazily build (and cache on ctx) a BM25 index over every source's full content,
// so retrieval returns the passages that actually match a step — not just the
// short provider snippet. Rebuilt on demand so the feedback-resume path (where
// the gathering node does not re-run) still has an index.
function ensureSourceIndex(ctx) {
  if (ctx.sourceIndex !== undefined) return ctx.sourceIndex;
  const chunks = [];
  for (const s of ctx.state.sources || []) {
    if (s.content) for (const c of chunkDocument(s.content, { docId: s.id })) chunks.push(c);
  }
  ctx.sourceIndex = chunks.length ? buildIndex(chunks) : null;
  return ctx.sourceIndex;
}

// Pick the sources most relevant to one plan step. Retrieves the best-matching
// passages from the per-run source index and attaches `relevantText` (the real
// page text) to each returned source; falls back to BM25 over snippets.
export function relevantSourcesFor(ctx, step) {
  const sources = ctx.state.sources || [];
  if (!sources.length) return [];
  const limit = ctx.config.maxSourcesPerQuery;
  const query = step.question || ctx.state.query;
  const index = ensureSourceIndex(ctx);
  if (index && index.docCount) {
    const hits = searchChunks(index, query, { topK: limit * 3 });
    const byId = new Map(sources.map((s) => [s.id, s]));
    const picked = new Map(); // sourceId -> { ...source, relevantText }
    // A URL the user named holds its slot before BM25 spends any. Ranking it
    // like a search result means a page asked for by name can place ninth out
    // of eight and never reach the researcher at all.
    for (const src of sources) {
      if (src.pinned && picked.size < limit) picked.set(src.id, { ...src, relevantText: "" });
    }
    for (const hit of hits) {
      const src = byId.get(hit.chunk.docId);
      if (!src) continue;
      if (picked.has(src.id)) {
        const cur = picked.get(src.id);
        if (cur.relevantText.length < RELEVANT_CHARS) cur.relevantText += `\n${hit.chunk.text}`;
      } else if (picked.size < limit) {
        picked.set(src.id, { ...src, relevantText: hit.chunk.text });
      }
    }
    if (picked.size) {
      return [...picked.values()].map((s) => ({
        ...s,
        // A pinned page no passage matched still goes in, on its opening text:
        // it was requested, so "nothing scored" is not a reason to drop it.
        relevantText: (s.relevantText || String(s.content || "")).slice(0, RELEVANT_CHARS)
      }));
    }
  }
  const pinned = sources.filter((s) => s.pinned);
  const rest = rankSources(query, sources.filter((s) => !s.pinned));
  return [...pinned, ...rest].slice(0, limit);
}

// Run one researcher over a single step against its relevant sources.
export async function researcherNode(ctx, step) {
  const relevant = relevantSourcesFor(ctx, step);
  const systemPrompt = await renderPrompt("researcher", {
    step_json: JSON.stringify(step),
    sources_json: JSON.stringify(sourcesForPrompt(relevant))
  });
  const out = await ctx.client.completeRole({
    roleName: "researcher",
    systemPrompt,
    userPrompt: step.question || ctx.state.query,
    json: true,
    signal: ctx.signal,
    ...RESEARCH_ROLE_OPTIONS.researcher
  });
  const knownIds = relevant.map((s) => s.id);
  const finding = attachEvidence(
    { step_id: step.id, ...out.json },
    knownIds
  );
  return finding;
}

// Split the plan into research tasks, retrieve evidence in parallel, then run
// the researchers serially (single shared model). Appends findings to
// state.observations.
export async function parallelExecutorNode(ctx) {
  const steps = (ctx.state.currentPlan?.steps || []).slice(0, ctx.config.maxSteps);
  ctx.state.observations = [];
  for (const step of steps) {
    ctx.emit("research_step_started", { step }, "parallel_executor");
    const finding = await researcherNode(ctx, step);
    ctx.state.observations.push(finding);
    ctx.emit("research_step_completed", { step_id: step.id, finding }, "parallel_executor");
  }
  return { observationCount: ctx.state.observations.length };
}

// Synthesize the observations into conflicts / gaps / readiness.
export async function researchTeamNode(ctx) {
  const observations = ctx.state.observations || [];
  const systemPrompt = await renderPrompt("team", {
    observations_json: JSON.stringify(observations)
  });
  const out = await ctx.client.completeRole({
    roleName: "research_team",
    systemPrompt,
    userPrompt: ctx.state.query,
    json: true,
    signal: ctx.signal,
    ...RESEARCH_ROLE_OPTIONS.research_team
  });
  return out.json;
}

// Local, LLM-free reflection: the report must cite sources when sources exist.
export function reflectionNode(ctx) {
  if (!ctx.config.reflection?.enabled) return { pass: true, issues: [] };
  const sources = (ctx.state.sources || []).filter(isCitableSource);
  const cited = citedSourceIds(ctx.state.finalReport || "");
  const issues = [];
  if (sources.length > 0 && cited.length === 0) {
    issues.push({
      type: "missing_source",
      message: "the report cites no sources although retrieved sources are available",
      required_fix: "cite the relevant [src_xxx] ids inline where claims rest on them"
    });
  }
  return { pass: issues.length === 0, issues };
}
