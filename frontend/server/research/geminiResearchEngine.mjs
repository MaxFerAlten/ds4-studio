// Gemini Deep Research engine: drives the Interactions API client and emits the
// same events as the local graph so the UI/store/export are identical.
//
// VERIFIED LIVE 2026-06-15: the deep-research agents are POLL-based (no delta
// stream) and reject collaborative_planning, so there is NO plan/feedback gate —
// the engine creates one background interaction and polls it to completion.

import { normalizeSource } from "./researchSources.mjs";

const NODE = "researcher";
const DEFAULT_POLL_MS = 8000;

export class GeminiResearchEngine {
  constructor({ pollIntervalMs = DEFAULT_POLL_MS } = {}) {
    this.pollIntervalMs = pollIntervalMs;
  }

  async run(ctx) {
    ctx.state.status = "running";
    ctx.emit("research_started", { query: ctx.state.query });
    let id;
    try {
      id = ctx.state.interactionId || (await ctx.gemini.createInteraction({
        input: ctx.state.query,
        agent: ctx.config.gemini.model,
        tools: ctx.config.gemini.tools,
        signal: ctx.signal
      }));
    } catch (err) {
      return this.#fail(ctx, err);
    }
    ctx.state.interactionId = id;
    ctx.state.nodes.researcher = { status: "running" };
    ctx.emit("node_started", {}, NODE);
    await ctx.save();

    while (true) {
      if (ctx.signal?.aborted) return this.cancel(ctx);
      let result;
      try {
        result = await ctx.gemini.getInteraction(id, { signal: ctx.signal });
      } catch (err) {
        if (ctx.signal?.aborted) return this.cancel(ctx);
        return this.#fail(ctx, err);
      }
      if (result.status === "completed") return this.#complete(ctx, result);
      if (result.status === "failed" || result.status === "cancelled") {
        return this.#fail(ctx, new Error(`gemini interaction ${result.status}`));
      }
      await this.#sleep(ctx);
    }
  }

  // No plan gate for Gemini; if the runtime ever asks to resume, just continue.
  submitFeedback(ctx) {
    return this.run(ctx);
  }

  cancel(ctx) {
    ctx.state.status = "cancelled";
    ctx.emit("research_cancelled", {});
    return ctx.state;
  }

  async #complete(ctx, result) {
    ctx.state.finalReport = result.outputText || "";
    const sources = (result.citations || []).map((c, i) =>
      normalizeSource({ url: c.url, title: c.title, snippet: "", provider: "gemini", sourceType: "web" }, i + 1)
    );
    ctx.state.sources = sources;
    ctx.state.nodes.researcher = { status: "done" };
    ctx.emit("node_completed", {}, NODE);
    for (const s of sources) ctx.emit("source_found", { source: s }, NODE);
    ctx.emit("report_completed", { report: ctx.state.finalReport }, "reporter");
    ctx.state.status = "completed";
    await ctx.save();
    ctx.emit("research_completed", { reportLength: ctx.state.finalReport.length });
    return ctx.state;
  }

  async #fail(ctx, err) {
    ctx.state.status = "failed";
    ctx.state.error = err?.message || "gemini engine error";
    await ctx.save();
    ctx.emit("research_error", { error: ctx.state.error });
    return ctx.state;
  }

  #sleep(ctx) {
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, this.pollIntervalMs);
      ctx.signal?.addEventListener?.("abort", () => {
        clearTimeout(timer);
        resolve();
      }, { once: true });
    });
  }
}
