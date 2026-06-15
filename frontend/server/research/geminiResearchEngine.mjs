// Gemini Deep Research engine: drives the Interactions API client and emits the
// same events as the local graph so the UI/store/export are identical.
//
// RESUME REQUEST SHAPE: the plan-approval resume below (a follow-up interaction
// with previous_interaction_id + collaborative_planning:false) is the documented
// default. It is UNVERIFIED against the live beta API (live check deferred — needs
// a real GEMINI_API_KEY). If live testing shows a different resume mechanism,
// change ONLY this engine + geminiResearchClient, not the UI.

import { normalizeSource } from "./researchSources.mjs";

const NODE = "researcher";

export class GeminiResearchEngine {
  async run(ctx) {
    const stream = ctx.gemini.createInteraction({
      input: ctx.state.query,
      agent: ctx.config.gemini.model,
      tools: ctx.config.gemini.tools,
      agentConfig: this.#agentConfig(ctx),
      previousInteractionId: ctx.state.interactionId || undefined
    });
    return this.#drive(ctx, stream);
  }

  async submitFeedback(ctx, action) {
    if (action === "accept") {
      ctx.state.status = "running";
      ctx.emit("feedback_received", { action }, NODE);
      const stream = ctx.gemini.createInteraction({
        input: "Approve the plan and proceed.",
        agent: ctx.config.gemini.model,
        tools: ctx.config.gemini.tools,
        agentConfig: { ...this.#agentConfig(ctx), collaborative_planning: false },
        previousInteractionId: ctx.state.interactionId
      });
      return this.#drive(ctx, stream);
    }
    ctx.state.currentPlan = null;
    ctx.emit("feedback_received", { action }, NODE);
    return this.run(ctx);
  }

  cancel(ctx) {
    ctx.state.status = "cancelled";
    ctx.emit("research_cancelled", {});
    return ctx.state;
  }

  #agentConfig(ctx) {
    return {
      collaborative_planning: Boolean(ctx.config.gemini.collaborativePlanning),
      thinking_summaries: ctx.config.gemini.thinkingSummaries ? "auto" : "none"
    };
  }

  async #drive(ctx, stream) {
    if (ctx.state.status !== "waiting_feedback") {
      ctx.state.status = "running";
      ctx.emit("research_started", { query: ctx.state.query });
    }
    try {
      for await (const ev of stream) {
        if (ctx.signal?.aborted) return this.cancel(ctx);
        await this.#apply(ctx, ev);
        if (ctx.state.status === "waiting_feedback") {
          await ctx.save();
          return ctx.state;
        }
      }
    } catch (err) {
      ctx.state.status = "failed";
      ctx.state.error = err?.message || "gemini engine error";
      await ctx.save();
      ctx.emit("research_error", { error: ctx.state.error });
      return ctx.state;
    }
    ctx.state.status = "completed";
    await ctx.save();
    ctx.emit("research_completed", { reportLength: ctx.state.finalReport?.length || 0 });
    return ctx.state;
  }

  async #apply(ctx, ev) {
    switch (ev.type) {
      case "created":
        ctx.state.interactionId = ev.interactionId;
        ctx.state.nodes.researcher = { status: "running" };
        ctx.emit("node_started", {}, NODE);
        break;
      case "delta":
        if (ev.deltaType === "text") {
          ctx.state.finalReport = (ctx.state.finalReport || "") + ev.text;
          ctx.emit("report_delta", { content: ev.text }, "reporter");
        }
        break;
      case "plan":
        ctx.state.currentPlan = ev.plan || { steps: [] };
        ctx.state.status = "waiting_feedback";
        ctx.emit("plan_generated", { plan: ctx.state.currentPlan, planIterations: 1 }, "planner");
        ctx.emit("feedback_required", { plan: ctx.state.currentPlan });
        break;
      case "completed": {
        if (ev.outputText) ctx.state.finalReport = ev.outputText;
        const sources = (ev.citations || []).map((c, i) =>
          normalizeSource({ url: c.url, title: c.title, snippet: c.snippet || "", provider: "gemini", sourceType: "web" }, i + 1)
        );
        ctx.state.sources = sources;
        for (const s of sources) ctx.emit("source_found", { source: s }, NODE);
        ctx.emit("report_completed", { report: ctx.state.finalReport }, "reporter");
        break;
      }
      case "error":
        throw new Error(ev.error);
      default:
        break;
    }
  }
}
