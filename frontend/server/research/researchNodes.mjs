// Phase 2 research-loop nodes: evidence gathering, per-step researchers, the
// research-team synthesis, and a bounded reflection self-check. These build on
// the session RAG index (ctx.rag) and the source layer.

import { renderPrompt } from "./researchPrompts.mjs";
import { multiQuerySearch, searchChunks } from "./researchRag.mjs";
import {
  attachEvidence,
  citedSourceIds,
  dedupeSources,
  normalizeSources,
  rankSources
} from "./researchSources.mjs";

const SNIPPET_CHARS = 1200;

function sourcesForPrompt(sources) {
  return sources.map((s) => ({
    id: s.id,
    title: s.title,
    snippet: s.snippet.slice(0, SNIPPET_CHARS)
  }));
}

// Gather evidence: local RAG over uploaded documents PLUS, when web search is
// enabled, live web sources. Both are folded into the unified source list,
// which assigns the citation ids. No LLM call here (spec §11.3).
export async function backgroundInvestigatorNode(ctx) {
  // Always include the original query alongside the rewrites so retrieval does
  // not depend solely on the rewriter's phrasing.
  const queries = [...new Set([ctx.state.query, ...(ctx.state.optimizedQueries || [])])].filter(Boolean);
  const raw = [];

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
  return { sourceCount: ctx.state.sources.length, webEnabled };
}

// Pick the sources most relevant to one plan step. Uses the RAG index when
// present to map the step question to chunk ids, then back to sources; falls
// back to BM25 ranking over source snippets.
export function relevantSourcesFor(ctx, step) {
  const sources = ctx.state.sources || [];
  if (!sources.length) return [];
  const limit = ctx.config.maxSourcesPerQuery;
  if (ctx.rag && ctx.rag.index) {
    const hits = searchChunks(ctx.rag.index, step.question || "", { topK: limit });
    const chunkIds = new Set(hits.map((h) => h.id));
    const matched = sources.filter((s) => (s.chunks || []).some((c) => chunkIds.has(c.id)));
    if (matched.length) return matched.slice(0, limit);
  }
  return rankSources(step.question || ctx.state.query, sources).slice(0, limit);
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
    signal: ctx.signal
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
    signal: ctx.signal
  });
  return out.json;
}

// Local, LLM-free reflection: the report must cite sources when sources exist.
export function reflectionNode(ctx) {
  if (!ctx.config.reflection?.enabled) return { pass: true, issues: [] };
  const sources = ctx.state.sources || [];
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
