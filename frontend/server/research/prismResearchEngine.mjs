import { normalizeSource } from "./researchSources.mjs";

const NODE = "researcher";
const DEFAULT_POLL_MS = 8000;

function intOr(value, fallback) {
  return Number.isInteger(value) ? value : fallback;
}

export class PrismResearchEngine {
  constructor({ pollIntervalMs = DEFAULT_POLL_MS } = {}) {
    this.pollIntervalMs = pollIntervalMs;
  }

  async run(ctx) {
    const prismConfig = ctx.config.prism || {};
    const pollIntervalMs = intOr(prismConfig.pollIntervalMs, this.pollIntervalMs);

    ctx.state.status = "running";
    ctx.emit("research_started", { query: ctx.state.query });
    ctx.state.nodes.researcher = { status: "running" };
    ctx.emit("node_started", {}, NODE);
    await ctx.save();

    try {
      const result = await ctx.prism.runResearch({
        input: ctx.state.query,
        signal: ctx.signal,
        timeoutMs: prismConfig.timeoutMs,
        pollIntervalMs,
        reasoningEffort: prismConfig.reasoningEffort
      });
      if (ctx.signal?.aborted) return this.cancel(ctx);
      ctx.state.interactionId = result.conversationId || ctx.state.interactionId || null;
      if (result.status === "completed") return this.#complete(ctx, result);
      const detail = result.error?.message || result.error || result.status;
      return this.#fail(ctx, new Error(`prism response ${detail}`));
    } catch (err) {
      if (ctx.signal?.aborted || err?.name === "AbortError") return this.cancel(ctx);
      return this.#fail(ctx, err);
    }
  }

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
      normalizeSource({ url: c.url, title: c.title, snippet: "", provider: "prism", sourceType: "web" }, i + 1)
    );
    ctx.state.sources = sources;
    ctx.state.nodes.researcher = { status: "done" };
    ctx.emit("node_completed", {}, NODE);
    for (const s of sources) ctx.emit("source_found", { source: s }, NODE);
    ctx.emit("report_completed", { report: ctx.state.finalReport }, "reporter");
    ctx.state.status = "completed";
    if (Array.isArray(result.artifacts)) ctx.state.artifacts = result.artifacts;
    await ctx.save();
    ctx.emit("research_completed", { reportLength: ctx.state.finalReport.length });
    return ctx.state;
  }

  async #fail(ctx, err) {
    ctx.state.status = "failed";
    ctx.state.error = err?.message || "prism engine error";
    await ctx.save();
    ctx.emit("research_error", { error: ctx.state.error });
    return ctx.state;
  }

}
