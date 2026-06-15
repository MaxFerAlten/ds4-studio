import test from "node:test";
import assert from "node:assert/strict";
import { GeminiResearchEngine } from "./geminiResearchEngine.mjs";

function fakeCtx(gemini) {
  const emitted = [];
  return {
    state: { sessionId: "rs_x", status: "running", query: "q", sources: [], finalReport: null, nodes: {}, seq: 0, interactionId: null },
    config: { gemini: { model: "deep-research-preview-04-2026", tools: ["google_search"] } },
    signal: undefined,
    save: async () => {},
    emit: (type, content, nodeName) => emitted.push({ type, content, nodeName }),
    gemini,
    emitted
  };
}

test("creates an interaction, polls to completion, maps report + citations", async () => {
  let getCalls = 0;
  const gemini = {
    async createInteraction() { return "v1_1"; },
    async getInteraction() {
      getCalls += 1;
      if (getCalls < 2) return { status: "in_progress", outputText: "", citations: [] };
      return { status: "completed", outputText: "Final report", citations: [{ url: "https://a", title: "A" }] };
    }
  };
  const ctx = fakeCtx(gemini);
  const engine = new GeminiResearchEngine({ pollIntervalMs: 1 });
  await engine.run(ctx);
  assert.equal(ctx.state.interactionId, "v1_1");
  assert.equal(ctx.state.finalReport, "Final report");
  assert.equal(ctx.state.sources.length, 1);
  assert.equal(ctx.state.sources[0].url, "https://a");
  assert.equal(ctx.state.status, "completed");
  const types = ctx.emitted.map((e) => e.type);
  assert.ok(types.includes("research_started"));
  assert.ok(types.includes("source_found"));
  assert.ok(types.includes("report_completed"));
  assert.ok(types.includes("research_completed"));
});

test("tolerates a transient poll error then completes", async () => {
  let getCalls = 0;
  const gemini = {
    async createInteraction() { return "v1_t"; },
    async getInteraction() {
      getCalls += 1;
      if (getCalls === 1) throw new Error("HTTP 429: rate limited");
      return { status: "completed", outputText: "ok", citations: [] };
    }
  };
  const ctx = fakeCtx(gemini);
  const engine = new GeminiResearchEngine({ pollIntervalMs: 1, maxPollErrors: 5 });
  await engine.run(ctx);
  assert.equal(ctx.state.status, "completed");
  assert.equal(ctx.state.finalReport, "ok");
});

test("gives up after maxPollErrors consecutive poll failures", async () => {
  const gemini = {
    async createInteraction() { return "v1_e"; },
    async getInteraction() { throw new Error("HTTP 500"); }
  };
  const ctx = fakeCtx(gemini);
  const engine = new GeminiResearchEngine({ pollIntervalMs: 1, maxPollErrors: 3 });
  await engine.run(ctx);
  assert.equal(ctx.state.status, "failed");
  assert.match(ctx.state.error, /HTTP 500/);
});

test("a failed interaction maps to research_error", async () => {
  const gemini = {
    async createInteraction() { return "v1_2"; },
    async getInteraction() { return { status: "failed", outputText: "", citations: [] }; }
  };
  const ctx = fakeCtx(gemini);
  const engine = new GeminiResearchEngine({ pollIntervalMs: 1 });
  await engine.run(ctx);
  assert.equal(ctx.state.status, "failed");
  assert.match(ctx.state.error, /failed/);
  assert.ok(ctx.emitted.some((e) => e.type === "research_error"));
});

test("a create error maps to research_error", async () => {
  const gemini = {
    async createInteraction() { throw new Error("HTTP 400: bad key"); },
    async getInteraction() { throw new Error("should not be called"); }
  };
  const ctx = fakeCtx(gemini);
  const engine = new GeminiResearchEngine({ pollIntervalMs: 1 });
  await engine.run(ctx);
  assert.equal(ctx.state.status, "failed");
  assert.match(ctx.state.error, /bad key/);
});
