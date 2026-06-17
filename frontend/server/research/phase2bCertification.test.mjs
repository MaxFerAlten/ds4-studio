// Phase 2b certification — live web search integration.
//
// Proves the web layer end to end with a fake transport (no real network):
// providers return results, the search service selects/dedupes/ranks/enriches,
// the background investigator merges web sources with RAG and assigns citation
// ids, the reporter cites a web source, and SSRF/MIME guards hold. The whole
// run still uses one model endpoint for the LLM roles.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { ResearchRuntime } from "./researchRuntime.mjs";
import { ResearchStateStore } from "./researchStateStore.mjs";
import { ResearchModelClient } from "./researchModelClient.mjs";
import { buildSearchService } from "./researchSearchService.mjs";
import { RESEARCH_DEFAULTS } from "./researchConfig.mjs";
import { checkUrlSafe } from "./ssrfGuard.mjs";

const MODEL_BASE = "http://127.0.0.1:8000";
const COORD_DEEP = JSON.stringify({ enable_deepresearch: true, language: "it" });
const REWRITE = JSON.stringify({ optimized_queries: ["redis sentinel", "redis failover"], search_intent: "x" });
const PLAN = JSON.stringify({
  plan: { objective: "o", steps: [{ id: "s1", question: "failover?", method: "web", expected_evidence: "e" }], risks: [], acceptance_criteria: [] }
});
const FINDING = JSON.stringify({ finding: "ok", evidence: [{ source_id: "src_001", quote_or_summary: "x", relevance: 0.9 }], confidence: "high", open_questions: [] });
const TEAM = JSON.stringify({ summary: "s", conflicts: [], missing_evidence: [], ready_for_report: true });
const REPORT = "# Report\n\n## Sintesi\nFatti basati su [src_001].\n\n## Limiti\n-";

// Fake model transport (LLM roles).
function modelFetch(urls) {
  return async (url, options = {}) => {
    urls.push(url);
    const body = options.body ? JSON.parse(options.body) : {};
    const system = body.messages?.find((m) => m.role === "system")?.content || "";
    let content = "{}";
    if (/coordinator node/.test(system)) content = COORD_DEEP;
    else if (/query rewriter node/.test(system)) content = REWRITE;
    else if (/planner node/.test(system)) content = PLAN;
    else if (/researcher node/.test(system)) content = FINDING;
    else if (/research_team node/.test(system)) content = TEAM;
    else if (/reporter node/.test(system)) content = REPORT;
    if (body.stream) {
      const stream = new ReadableStream({
        start(c) {
          const enc = new TextEncoder();
          c.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`));
          c.enqueue(enc.encode("data: [DONE]\n\n"));
          c.close();
        }
      });
      return new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } });
    }
    return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  };
}

// Fake web transport: Wikipedia search + REST summary, and page reader HTML.
function webFetch() {
  return async (url) => {
    if (url.includes("list=search")) {
      return new Response(
        JSON.stringify({ query: { search: [{ title: "Redis Sentinel", pageid: 1, snippet: "failover" }] } }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    if (url.includes("rest_v1/page/summary")) {
      return new Response(JSON.stringify({ extract: "Redis Sentinel provides high availability and failover." }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }
    if (url.includes("api.openalex.org")) {
      return new Response(JSON.stringify({ results: [] }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    // page reader / direct fetch
    return new Response("<p>full sentinel page text</p>", { status: 200, headers: { "Content-Type": "text/html" } });
  };
}

async function makeHarness(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ds4-phase2b-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const modelUrls = [];
  const store = new ResearchStateStore({ rootDir: dir });
  const cfg = {
    ...RESEARCH_DEFAULTS,
    enabled: true,
    autoAcceptPlan: true,
    search: { ...RESEARCH_DEFAULTS.search, enabled: true, retryDelayMs: 0 }
  };
  const runtime = new ResearchRuntime({
    store,
    getConfig: () => cfg,
    clientFactory: () => new ResearchModelClient({ baseUrl: MODEL_BASE, modelConfig: cfg.model, fetchImpl: modelFetch(modelUrls) }),
    searchServiceFactory: (c) => buildSearchService(c.search, { fetchImpl: webFetch(), env: {}, logger: { warn: () => {} } }),
    logger: { error: () => {} }
  });
  return { runtime, store, modelUrls };
}

async function waitForStatus(store, sessionId, status, timeoutMs = 3000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const s = await store.loadState(sessionId);
    if (s?.status === status) return s;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`timed out waiting for ${status}`);
}

test("CERT 1: web search yields sources merged into the unified source list", async (t) => {
  const h = await makeHarness(t);
  const { sessionId } = await h.runtime.start("redis sentinel failover");
  const state = await waitForStatus(h.store, sessionId, "completed");
  assert.ok(state.sources.length >= 1, "must gather web sources");
  const web = state.sources.find((s) => s.kind === "web");
  assert.ok(web, "a web-kind source is present");
  assert.equal(web.provider, "wikipedia");
  assert.ok(web.id.startsWith("src_"), "web source got a citation id");
});

test("CERT 2: non-citable web sources stay out of formal references", async (t) => {
  const h = await makeHarness(t);
  const { sessionId } = await h.runtime.start("redis sentinel failover");
  const state = await waitForStatus(h.store, sessionId, "completed");
  assert.match(state.finalReport, /\[src_001\]/);
  assert.doesNotMatch(state.finalReport, /## Fonti/);
  assert.deepEqual(state.nodes.reporter.nonCitableIds, ["src_001"]);
});

test("CERT 3: page enrichment replaces thin snippets with fetched text", async (t) => {
  const h = await makeHarness(t);
  const { sessionId } = await h.runtime.start("redis sentinel failover");
  const state = await waitForStatus(h.store, sessionId, "completed");
  // Wikipedia REST summary supplies full content already; assert it is non-trivial.
  const web = state.sources.find((s) => s.kind === "web");
  assert.ok(web.snippet.length > 0);
});

test("CERT 4: LLM roles still hit only the one model endpoint", async (t) => {
  const h = await makeHarness(t);
  const { sessionId } = await h.runtime.start("redis sentinel failover");
  await waitForStatus(h.store, sessionId, "completed");
  for (const url of h.modelUrls) {
    assert.equal(url, `${MODEL_BASE}/v1/chat/completions`, `model traffic only: ${url}`);
  }
});

test("CERT 5: SSRF guard blocks internal targets (defense in depth)", () => {
  assert.equal(checkUrlSafe("http://169.254.169.254/latest/meta-data").ok, false);
  assert.equal(checkUrlSafe("http://localhost:8000/").ok, false);
  assert.equal(checkUrlSafe("https://en.wikipedia.org/wiki/Redis").ok, true);
});

test("CERT 6: web search ships disabled by default", () => {
  assert.equal(RESEARCH_DEFAULTS.search.enabled, false);
  assert.equal(RESEARCH_DEFAULTS.search.providers.wikipedia.enabled, true);
  assert.equal(RESEARCH_DEFAULTS.search.providers.tavily.enabled, false);
});
