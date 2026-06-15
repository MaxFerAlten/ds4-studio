import test from "node:test";
import assert from "node:assert/strict";
import { GeminiResearchEngine } from "./geminiResearchEngine.mjs";

function fakeCtx(events) {
  const emitted = [];
  return {
    state: { sessionId: "rs_x", status: "running", sources: [], finalReport: null, nodes: {}, seq: 0 },
    config: { gemini: { model: "deep-research-preview-04-2026", tools: ["google_search"], collaborativePlanning: false } },
    signal: undefined,
    save: async () => {},
    emit: (type, content, nodeName) => emitted.push({ type, content, nodeName }),
    gemini: { async *createInteraction() { for (const e of events) yield e; }, async getInteraction() { return {}; } },
    emitted
  };
}

test("maps a non-plan run to deltas, sources, and completion", async () => {
  const ctx = fakeCtx([
    { type: "created", interactionId: "ix_1" },
    { type: "delta", deltaType: "thought", text: "thinking" },
    { type: "delta", deltaType: "text", text: "Hello " },
    { type: "delta", deltaType: "text", text: "world" },
    { type: "completed", outputText: "Hello world", citations: [{ title: "T", url: "https://x", snippet: "s" }] }
  ]);
  const engine = new GeminiResearchEngine();
  await engine.run(ctx);
  assert.equal(ctx.state.interactionId, "ix_1");
  assert.equal(ctx.state.finalReport, "Hello world");
  assert.equal(ctx.state.sources.length, 1);
  assert.equal(ctx.state.sources[0].url, "https://x");
  assert.equal(ctx.state.status, "completed");
  const types = ctx.emitted.map((e) => e.type);
  assert.ok(types.includes("research_started"));
  assert.ok(types.includes("report_delta"));
  assert.ok(types.includes("source_found"));
  assert.ok(types.includes("research_completed"));
});

test("a plan event pauses at the feedback gate", async () => {
  const ctx = fakeCtx([
    { type: "created", interactionId: "ix_2" },
    { type: "plan", plan: { steps: [{ question: "q1" }] } }
  ]);
  ctx.config.gemini.collaborativePlanning = true;
  const engine = new GeminiResearchEngine();
  await engine.run(ctx);
  assert.equal(ctx.state.status, "waiting_feedback");
  assert.equal(ctx.state.currentPlan.steps.length, 1);
  assert.ok(ctx.emitted.some((e) => e.type === "feedback_required"));
});

test("an error event maps to research_error", async () => {
  const ctx = fakeCtx([
    { type: "created", interactionId: "ix_3" },
    { type: "error", error: "boom" }
  ]);
  const engine = new GeminiResearchEngine();
  await engine.run(ctx);
  assert.equal(ctx.state.status, "failed");
  assert.match(ctx.state.error, /boom/);
  assert.ok(ctx.emitted.some((e) => e.type === "research_error"));
});
