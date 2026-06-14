// Phase 2 certification suite.
//
// Proves the deep research loop works end to end: documents become a RAG corpus,
// the background investigator turns retrieval into sources, researchers produce
// observations, the reporter cites real sources, reflection corrects an uncited
// report, and the session exports to Markdown/HTML — all over the single shared
// model endpoint. Real store + graph + runtime + rag + sources + export; the
// only seam is fetch.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { ResearchRuntime } from "./researchRuntime.mjs";
import { ResearchStateStore } from "./researchStateStore.mjs";
import { ResearchModelClient } from "./researchModelClient.mjs";
import { RESEARCH_DEFAULTS } from "./researchConfig.mjs";
import { exportSession } from "./researchExport.mjs";

const BASE_URL = "http://127.0.0.1:8000";
const DOC = "# Sentinel\n\nredis sentinel failover monitoring quorum election\n\n# Cluster\n\nredis cluster sharding gossip resharding";
const HINT_MARKER = "cite the relevant [src_xxx]";

const COORD_DEEP = JSON.stringify({ enable_deepresearch: true, language: "it" });
const REWRITE = JSON.stringify({ optimized_queries: ["sentinel failover", "cluster sharding"], search_intent: "x" });
const PLAN = JSON.stringify({
  plan: {
    objective: "valutare sentinel vs cluster",
    steps: [
      { id: "s1", question: "sentinel failover?", method: "rag", expected_evidence: "e1" },
      { id: "s2", question: "cluster sharding?", method: "rag", expected_evidence: "e2" }
    ],
    risks: [],
    acceptance_criteria: []
  }
});
const FINDING = JSON.stringify({
  finding: "ok",
  evidence: [{ source_id: "src_001", quote_or_summary: "failover", relevance: 0.9 }],
  confidence: "high",
  open_questions: []
});
const TEAM = JSON.stringify({ summary: "s", conflicts: [], missing_evidence: [], ready_for_report: true });
const REPORT_CITED = "# Report\n\n## Sintesi\nFatti basati su [src_001].\n\n## Limiti\nfonti locali.";
const REPORT_UNCITED = "# Report\n\n## Sintesi\nNessuna citazione.\n\n## Limiti\n-";

function makeFakeFetch({ urls, reporterAlwaysCites = true }) {
  return async function fakeFetch(url, options = {}) {
    urls.push(url);
    const body = options.body ? JSON.parse(options.body) : {};
    const system = body.messages?.find((m) => m.role === "system")?.content || "";
    let content = "{}";
    if (/coordinator node/.test(system)) content = COORD_DEEP;
    else if (/query rewriter node/.test(system)) content = REWRITE;
    else if (/planner node/.test(system)) content = PLAN;
    else if (/researcher node/.test(system)) content = FINDING;
    else if (/research_team node/.test(system)) content = TEAM;
    else if (/reporter node/.test(system)) {
      content = reporterAlwaysCites || system.includes(HINT_MARKER) ? REPORT_CITED : REPORT_UNCITED;
    }

    if (body.stream) {
      const chunks = [
        `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`,
        "data: [DONE]\n\n"
      ];
      const stream = new ReadableStream({
        start(controller) {
          const enc = new TextEncoder();
          for (const c of chunks) controller.enqueue(enc.encode(c));
          controller.close();
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

async function makeHarness(t, { reporterAlwaysCites = true, config = {} } = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ds4-phase2-cert-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const urls = [];
  const store = new ResearchStateStore({ rootDir: dir });
  const cfg = { ...RESEARCH_DEFAULTS, enabled: true, autoAcceptPlan: true, ...config };
  const runtime = new ResearchRuntime({
    store,
    getConfig: () => cfg,
    clientFactory: () =>
      new ResearchModelClient({
        baseUrl: BASE_URL,
        modelConfig: cfg.model,
        fetchImpl: makeFakeFetch({ urls, reporterAlwaysCites })
      }),
    logger: { error: () => {} }
  });
  return { runtime, store, urls };
}

async function waitForStatus(store, sessionId, status, timeoutMs = 3000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const state = await store.loadState(sessionId);
    if (state?.status === status) return state;
    await new Promise((r) => setTimeout(r, 10));
  }
  const last = await store.loadState(sessionId);
  throw new Error(`timed out waiting for ${status}; last: ${last?.status}`);
}

async function runWithDoc(runtime, store, { reporterAlwaysCites } = {}) {
  const { sessionId } = await runtime.createSession("redis sentinel failover");
  await runtime.addDocument(sessionId, { name: "redis.md", markdown: DOC });
  await runtime.launch(sessionId);
  return waitForStatus(store, sessionId, "completed");
}

// ---------------------------------------------------------------------------

test("CERT 1: an uploaded document becomes a searchable RAG corpus with sources", async (t) => {
  const h = await makeHarness(t);
  const state = await runWithDoc(h.runtime, h.store);
  assert.ok(state.sources.length >= 1, "background investigator must produce sources from the doc");
  assert.ok(state.sources.every((s) => s.id.startsWith("src_")));
  assert.ok(state.sources.some((s) => /sentinel|cluster/.test(s.snippet)));
});

test("CERT 2: the researchers run and produce observations with evidence", async (t) => {
  const h = await makeHarness(t);
  const state = await runWithDoc(h.runtime, h.store);
  assert.equal(state.observations.length, 2, "one observation per plan step");
  assert.ok(state.observations.every((o) => o.step_id));
});

test("CERT 3: the report cites a real source and a Fonti section is appended", async (t) => {
  const h = await makeHarness(t);
  const state = await runWithDoc(h.runtime, h.store);
  assert.match(state.finalReport, /\[src_001\]/, "report must cite a source");
  assert.match(state.finalReport, /## Fonti/, "citations must be listed");
  assert.equal(state.nodes.reporter.missingIds.length, 0, "no dangling citations");
});

test("CERT 4: reflection re-runs the reporter when sources are ignored, then passes", async (t) => {
  const h = await makeHarness(t, { reporterAlwaysCites: false });
  const state = await runWithDoc(h.runtime, h.store);
  assert.equal(state.reflectionAttempts, 1, "reflection must trigger one retry");
  assert.match(state.finalReport, /\[src_001\]/, "the corrected report cites a source");
  assert.equal(state.nodes.reflection.pass, true);
});

test("CERT 5: export produces Markdown and HTML carrying the report and sources", async (t) => {
  const h = await makeHarness(t);
  const state = await runWithDoc(h.runtime, h.store);
  const md = exportSession(state, "md");
  const html = exportSession(state, "html");
  assert.match(md.body, /src_001/);
  assert.match(md.body, /## Fonti/);
  assert.match(html.body, /^<!doctype html>/);
  assert.match(html.body, /src_001/);
});

test("CERT 6: the whole deep loop still hits only the one shared endpoint", async (t) => {
  const h = await makeHarness(t);
  await runWithDoc(h.runtime, h.store);
  assert.ok(h.urls.length >= 6, "coordinator+rewrite+planner+researcher*2+team+reporter");
  for (const url of h.urls) {
    assert.equal(url, `${BASE_URL}/v1/chat/completions`, `unexpected endpoint: ${url}`);
  }
});

test("CERT 7: live web search ships disabled (offline-deterministic Phase 2)", () => {
  assert.equal(RESEARCH_DEFAULTS.searchEnabled, false);
  assert.equal(RESEARCH_DEFAULTS.webFetchEnabled, false);
  assert.equal(RESEARCH_DEFAULTS.ragEnabled, true);
});
