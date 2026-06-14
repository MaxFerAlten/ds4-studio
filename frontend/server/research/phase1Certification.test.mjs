// Phase 1 certification suite.
//
// Proves the Deep Research MVP meets the acceptance criteria of the spec
// (doc/deepresearch.md §25) and the Phase 1 plan, end to end, through the REAL
// store + graph + runtime + prompts + model client. The only seam is fetch:
// a fake transport that records every URL it is asked to hit, so the suite can
// prove the runtime never loads a second model and only ever talks to the one
// shared OpenAI-compatible endpoint.
//
// No live DS4 backend is required. If every test here passes, Phase 1 is done.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { ResearchRuntime } from "./researchRuntime.mjs";
import { ResearchStateStore } from "./researchStateStore.mjs";
import { ResearchModelClient } from "./researchModelClient.mjs";
import { RESEARCH_EVENT_TYPES } from "./researchEvents.mjs";
import { loadPrompt } from "./researchPrompts.mjs";
import { RESEARCH_DEFAULTS } from "./researchConfig.mjs";

// --- canned model replies, keyed by the user/system text the role sends ------

const COORD_DEEP = JSON.stringify({
  enable_deepresearch: true,
  research_depth: "standard",
  needs_web: false,
  needs_files: false,
  needs_code: false,
  language: "it"
});
const COORD_SIMPLE = JSON.stringify({ enable_deepresearch: false, language: "it" });
const REWRITE = JSON.stringify({
  optimized_queries: ["q tecnica", "q ufficiale", "q critica"],
  search_intent: "x"
});
const PLAN = JSON.stringify({
  plan: {
    objective: "valutare X",
    steps: [
      { id: "s1", question: "pro?", method: "reasoning", expected_evidence: "e1" },
      { id: "s2", question: "contro?", method: "reasoning", expected_evidence: "e2" }
    ],
    risks: [],
    acceptance_criteria: ["copre pro e contro"]
  }
});
const REPORT = "# Report\n\n## Sintesi\nok\n\n## Limiti\nnessuna fonte live.";

// A fake fetch that classifies the request by the system prompt fingerprint and
// records every URL. Returns non-streaming JSON for role calls; the reporter is
// the only streamed call (the client sets stream:true when onDelta is given).
function makeFakeFetch({ urls }) {
  return async function fakeFetch(url, options = {}) {
    urls.push(url);
    const body = options.body ? JSON.parse(options.body) : {};
    const system = body.messages?.find((m) => m.role === "system")?.content || "";

    let content = "{}";
    if (/coordinator node/.test(system)) {
      content = system.includes("__SIMPLE__") ? COORD_SIMPLE : COORD_DEEP;
    } else if (/query rewriter node/.test(system)) {
      content = REWRITE;
    } else if (/planner node/.test(system)) {
      content = PLAN;
    } else if (/reporter node/.test(system)) {
      content = REPORT;
    }

    if (body.stream) {
      const chunks = [
        `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`,
        `data: ${JSON.stringify({ usage: { total_tokens: 5 } })}\n\n`,
        "data: [DONE]\n\n"
      ];
      const stream = new ReadableStream({
        start(controller) {
          const enc = new TextEncoder();
          for (const c of chunks) controller.enqueue(enc.encode(c));
          controller.close();
        }
      });
      return new Response(stream, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" }
      });
    }
    return new Response(
      JSON.stringify({ choices: [{ message: { content } }], usage: { total_tokens: 5 } }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  };
}

const BASE_URL = "http://127.0.0.1:8000";

async function makeHarness(t, { autoAcceptPlan = false, simple = false } = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ds4-phase1-cert-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const urls = [];
  const fetchImpl = makeFakeFetch({ urls });
  const store = new ResearchStateStore({ rootDir: dir });
  const config = {
    ...RESEARCH_DEFAULTS,
    enabled: true,
    autoAcceptPlan,
    maxPlanIterations: 3
  };
  const runtime = new ResearchRuntime({
    store,
    getConfig: () => config,
    clientFactory: () =>
      new ResearchModelClient({
        baseUrl: BASE_URL,
        model: "deepseek-v4-flash",
        modelConfig: config.model,
        fetchImpl
      }),
    logger: { error: () => {} }
  });
  // The simple-query path keys off a marker injected into the coordinator system
  // prompt; the runtime always sends the raw query, so we smuggle the marker in
  // the query text and the fake fetch keys off it.
  return { runtime, store, urls, dir, config, queryFor: (q) => (simple ? `${q} __SIMPLE__` : q) };
}

async function waitForStatus(store, sessionId, status, timeoutMs = 3000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const state = await store.loadState(sessionId);
    if (state?.status === status) return state;
    await new Promise((r) => setTimeout(r, 10));
  }
  const last = await store.loadState(sessionId);
  throw new Error(`timed out waiting for ${status}; last status: ${last?.status}`);
}

// ---------------------------------------------------------------------------
// CRITERION 1 — structural completeness of the Phase 1 surface
// ---------------------------------------------------------------------------

test("CERT 1: every required artifact of the Phase 1 surface exists", async () => {
  // backend modules
  for (const mod of [
    "researchConfig.mjs",
    "researchEvents.mjs",
    "researchStateStore.mjs",
    "researchModelClient.mjs",
    "researchPrompts.mjs",
    "researchGraph.mjs",
    "researchRuntime.mjs"
  ]) {
    await fs.access(path.join(import.meta.dirname, mod));
  }
  // prompts
  for (const name of ["coordinator", "rewrite", "planner", "reporter"]) {
    const text = await loadPrompt(name);
    assert.ok(text.length > 100, `${name} prompt missing/empty`);
  }
  // UI modules
  const uiDir = path.resolve(import.meta.dirname, "../../src/research");
  for (const f of [
    "researchStore.mjs",
    "researchApi.mjs",
    "ResearchPanel.jsx",
    "ResearchThoughtChain.jsx",
    "ResearchPlanReview.jsx"
  ]) {
    await fs.access(path.join(uiDir, f));
  }
  // the full event protocol is declared
  for (const t of [
    "research_started",
    "plan_generated",
    "feedback_required",
    "report_delta",
    "research_completed",
    "research_error",
    "research_cancelled"
  ]) {
    assert.ok(RESEARCH_EVENT_TYPES.includes(t), `missing event type ${t}`);
  }
});

// ---------------------------------------------------------------------------
// CRITERION 2 — a simple query answers directly, no research, no plan
// ---------------------------------------------------------------------------

test("CERT 2: a trivial query produces a direct answer without a plan", async (t) => {
  const h = await makeHarness(t, { simple: true, autoAcceptPlan: true });
  const { sessionId } = await h.runtime.start(h.queryFor("ciao"));
  const state = await waitForStatus(h.store, sessionId, "completed");
  assert.equal(state.currentPlan, null, "simple query must not build a plan");
  assert.ok(state.finalReport.length > 0, "simple query must still answer");
});

// ---------------------------------------------------------------------------
// CRITERION 3 — a deep query: plan -> human feedback -> accept -> report
// ---------------------------------------------------------------------------

test("CERT 3: deep query pauses for plan review, then completes a cited-structure report on accept", async (t) => {
  const h = await makeHarness(t, { autoAcceptPlan: false });
  const { sessionId } = await h.runtime.start(h.queryFor("Vantaggi e limiti di X"));

  const paused = await waitForStatus(h.store, sessionId, "waiting_feedback");
  assert.ok(paused.currentPlan, "must produce a plan");
  assert.equal(paused.currentPlan.steps.length, 2, "plan must carry its steps");
  assert.equal(paused.finalReport, null, "must not write the report before approval");
  assert.deepEqual(paused.optimizedQueries.length > 1, true, "must expand into multi-queries");

  await h.runtime.feedback(sessionId, { action: "accept" });
  const done = await waitForStatus(h.store, sessionId, "completed");
  assert.ok(done.finalReport.includes("## Limiti"), "report must follow the structured template");
});

// ---------------------------------------------------------------------------
// CRITERION 4 — plan can be modified (edit) and regenerated
// ---------------------------------------------------------------------------

test("CERT 4: plan review supports edit and regenerate", async (t) => {
  // edit
  const h1 = await makeHarness(t, { autoAcceptPlan: false });
  const s1 = (await h1.runtime.start(h1.queryFor("q"))).sessionId;
  await waitForStatus(h1.store, s1, "waiting_feedback");
  await h1.runtime.feedback(s1, {
    action: "edit",
    plan: { objective: "modificato", steps: [{ id: "s1", question: "?", method: "reasoning", expected_evidence: "e" }] }
  });
  const edited = await waitForStatus(h1.store, s1, "completed");
  assert.equal(edited.currentPlan.objective, "modificato");

  // regenerate
  const h2 = await makeHarness(t, { autoAcceptPlan: false });
  const s2 = (await h2.runtime.start(h2.queryFor("q"))).sessionId;
  await waitForStatus(h2.store, s2, "waiting_feedback");
  await h2.runtime.feedback(s2, { action: "regenerate" });
  const regen = await waitForStatus(h2.store, s2, "waiting_feedback");
  assert.equal(regen.planIterations, 2, "regenerate must re-run the planner");
});

// ---------------------------------------------------------------------------
// CRITERION 5 — cancel works
// ---------------------------------------------------------------------------

test("CERT 5: cancel stops a running session and records the event", async (t) => {
  const h = await makeHarness(t, { autoAcceptPlan: false });
  const { sessionId } = await h.runtime.start(h.queryFor("q"));
  await waitForStatus(h.store, sessionId, "waiting_feedback");
  await h.runtime.cancel(sessionId);
  const state = await h.store.loadState(sessionId);
  assert.equal(state.status, "cancelled");
  await h.runtime.flush(sessionId);
  const events = await h.store.readEvents(sessionId);
  assert.ok(events.some((e) => e.type === "research_cancelled"));
});

// ---------------------------------------------------------------------------
// CRITERION 6 — resume survives a frontend-server restart
// ---------------------------------------------------------------------------

test("CERT 6: a paused session resumes on a brand-new runtime over the same state dir", async (t) => {
  const h = await makeHarness(t, { autoAcceptPlan: false });
  const { sessionId } = await h.runtime.start(h.queryFor("q"));
  await waitForStatus(h.store, sessionId, "waiting_feedback");

  // Simulate a frontend-server restart: discard the runtime (in-memory jobs),
  // build a fresh one bound to the SAME persisted store dir.
  const urls = [];
  const restarted = new ResearchRuntime({
    store: new ResearchStateStore({ rootDir: h.dir }),
    getConfig: () => h.config,
    clientFactory: () =>
      new ResearchModelClient({
        baseUrl: BASE_URL,
        modelConfig: h.config.model,
        fetchImpl: makeFakeFetch({ urls })
      }),
    logger: { error: () => {} }
  });
  const loaded = await restarted.getState(sessionId);
  assert.equal(loaded.status, "waiting_feedback", "restart must rehydrate the paused session");

  await restarted.feedback(sessionId, { action: "accept" });
  const done = await waitForStatus(restarted.store, sessionId, "completed");
  assert.ok(done.finalReport.length > 0, "resumed session must finish the report");
});

// ---------------------------------------------------------------------------
// CRITERION 7 — single model, single endpoint (no second LLM process)
// ---------------------------------------------------------------------------

test("CERT 7: the whole workflow only ever calls the one shared chat-completions endpoint", async (t) => {
  const h = await makeHarness(t, { autoAcceptPlan: true });
  const { sessionId } = await h.runtime.start(h.queryFor("Vantaggi e limiti di X"));
  await waitForStatus(h.store, sessionId, "completed");
  await h.runtime.flush(sessionId);

  assert.ok(h.urls.length >= 4, "expected at least coordinator+rewrite+planner+reporter calls");
  for (const url of h.urls) {
    assert.equal(
      url,
      `${BASE_URL}/v1/chat/completions`,
      `unexpected endpoint hit: ${url} (no second model / no extra service allowed)`
    );
  }
});

// ---------------------------------------------------------------------------
// CRITERION 8 — events are persisted in order and replayable
// ---------------------------------------------------------------------------

test("CERT 8: a completed session has an ordered, replayable event log", async (t) => {
  const h = await makeHarness(t, { autoAcceptPlan: true });
  const { sessionId } = await h.runtime.start(h.queryFor("Vantaggi e limiti di X"));
  await waitForStatus(h.store, sessionId, "completed");
  await h.runtime.flush(sessionId);

  const events = await h.store.readEvents(sessionId);
  const seqs = events.map((e) => e.seq);
  assert.deepEqual(seqs, [...seqs].sort((a, b) => a - b), "events must be monotonically ordered");
  assert.equal(events[0].type, "research_started");
  assert.equal(events.at(-1).type, "research_completed");
  for (const required of ["plan_generated", "report_delta", "report_completed"]) {
    assert.ok(events.some((e) => e.type === required), `event log missing ${required}`);
  }
});

// ---------------------------------------------------------------------------
// CRITERION 9 — the feature is gated and off by default
// ---------------------------------------------------------------------------

test("CERT 9: research ships disabled by default", () => {
  assert.equal(RESEARCH_DEFAULTS.enabled, false, "research must default to OFF");
});
