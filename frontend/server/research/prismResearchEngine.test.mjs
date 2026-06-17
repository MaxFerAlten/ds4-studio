import test from "node:test";
import assert from "node:assert/strict";
import { PrismResearchEngine } from "./prismResearchEngine.mjs";

function fakeCtx(prism, overrides = {}) {
  const emitted = [];
  return {
    state: {
      sessionId: "rs_x",
      status: "running",
      query: "q",
      sources: [],
      finalReport: null,
      nodes: {},
      seq: 0,
      interactionId: null,
      ...overrides.state
    },
    config: {
      prism: {
        cliPath: "prism-pp-cli",
        cookiesEnv: "PRISM_COOKIES",
        reasoningEffort: "medium",
        timeoutMs: 90000,
        pollIntervalMs: 1000,
        ...overrides.prismConfig
      }
    },
    signal: overrides.signal,
    save: async () => {},
    emit: (type, content, nodeName) => emitted.push({ type, content, nodeName }),
    prism,
    emitted
  };
}

test("runs the printing-press Prism workflow and maps report + citations", async () => {
  let captured = null;
  const prism = {
    async runResearch(input) {
      captured = input;
      return {
        status: "completed",
        outputText: "Final report",
        conversationId: "conv_1",
        citations: [{ url: "https://a.example", title: "A" }]
      };
    }
  };
  const ctx = fakeCtx(prism);
  const engine = new PrismResearchEngine({ pollIntervalMs: 1 });
  await engine.run(ctx);
  assert.deepEqual(captured, {
    input: "q",
    signal: undefined,
    timeoutMs: 90000,
    pollIntervalMs: 1000,
    reasoningEffort: "medium"
  });
  assert.equal(ctx.state.interactionId, "conv_1");
  assert.equal(ctx.state.finalReport, "Final report");
  assert.equal(ctx.state.sources[0].provider, "prism");
  assert.equal(ctx.state.status, "completed");
  assert.ok(ctx.emitted.some((e) => e.type === "source_found"));
  assert.ok(ctx.emitted.some((e) => e.type === "research_completed"));
});

test("failed workflow status maps to research_error", async () => {
  const prism = {
    async runResearch() {
      return { status: "failed", outputText: "", error: "sandbox_reconnecting", citations: [] };
    }
  };
  const ctx = fakeCtx(prism);
  await new PrismResearchEngine({ pollIntervalMs: 1 }).run(ctx);
  assert.equal(ctx.state.status, "failed");
  assert.match(ctx.state.error, /sandbox_reconnecting/);
  assert.ok(ctx.emitted.some((e) => e.type === "research_error"));
});

test("cli errors map to failed research state", async () => {
  const prism = {
    async runResearch() {
      throw new Error("prism cli exited 1");
    }
  };
  const ctx = fakeCtx(prism);
  await new PrismResearchEngine({ pollIntervalMs: 1 }).run(ctx);
  assert.equal(ctx.state.status, "failed");
  assert.match(ctx.state.error, /prism cli exited 1/);
});

test("abort errors cancel the research state", async () => {
  const prism = {
    async runResearch() {
      throw Object.assign(new Error("aborted"), { name: "AbortError" });
    }
  };
  const ctx = fakeCtx(prism);
  await new PrismResearchEngine({ pollIntervalMs: 1 }).run(ctx);
  assert.equal(ctx.state.status, "cancelled");
  assert.ok(ctx.emitted.some((e) => e.type === "research_cancelled"));
});
