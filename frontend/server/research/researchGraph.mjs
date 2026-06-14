import { renderPrompt } from "./researchPrompts.mjs";
import { RESEARCH_ROLE_OPTIONS } from "./researchModelClient.mjs";
import { formatCitations } from "./researchSources.mjs";
import { verifyCitedAuthors } from "./authorVerification.mjs";
import {
  backgroundInvestigatorNode,
  parallelExecutorNode,
  reflectionNode,
  researchTeamNode
} from "./researchNodes.mjs";

async function runNode(ctx, nodeName, fn) {
  ctx.emit("node_started", {}, nodeName);
  const result = (await fn(ctx)) ?? {};
  ctx.state.nodes[nodeName] = result;
  await ctx.save();
  ctx.emit("node_completed", { result }, nodeName);
  return result;
}

export async function coordinatorNode(ctx) {
  const systemPrompt = await renderPrompt("coordinator", { query: ctx.state.query });
  const out = await ctx.client.completeRole({
    roleName: "coordinator",
    systemPrompt,
    userPrompt: ctx.state.query,
    json: true,
    signal: ctx.signal,
    ...RESEARCH_ROLE_OPTIONS.coordinator
  });
  return out.json;
}

export async function rewriteMultiQueryNode(ctx) {
  const systemPrompt = await renderPrompt("rewrite", { query: ctx.state.query });
  const out = await ctx.client.completeRole({
    roleName: "query_rewriter",
    systemPrompt,
    userPrompt: ctx.state.query,
    json: true,
    signal: ctx.signal,
    ...RESEARCH_ROLE_OPTIONS.query_rewriter
  });
  const queries = Array.isArray(out.json.optimized_queries)
    ? out.json.optimized_queries.filter((q) => typeof q === "string" && q.trim())
    : [];
  ctx.state.optimizedQueries = queries.length ? queries : [ctx.state.query];
  return out.json;
}

export async function plannerNode(ctx) {
  const systemPrompt = await renderPrompt("planner", {
    query: ctx.state.query,
    optimized_queries: JSON.stringify(ctx.state.optimizedQueries),
    coordinator_json: JSON.stringify(ctx.state.nodes.coordinator || {})
  });
  const out = await ctx.client.completeRole({
    roleName: "planner",
    systemPrompt,
    userPrompt: ctx.state.query,
    json: true,
    signal: ctx.signal,
    ...RESEARCH_ROLE_OPTIONS.planner
  });
  const plan = out.json?.plan;
  if (!plan || !Array.isArray(plan.steps) || !plan.steps.length) {
    throw new Error("planner returned no steps");
  }
  ctx.state.currentPlan = plan;
  ctx.state.planIterations += 1;
  ctx.emit("plan_generated", { plan, planIterations: ctx.state.planIterations }, "planner");
  return { planIterations: ctx.state.planIterations };
}

export async function reporterNode(ctx) {
  const coordinator = ctx.state.nodes.coordinator || {};
  const simple = coordinator.enable_deepresearch === false;
  const sources = ctx.state.sources || [];
  const systemPrompt = await renderPrompt("reporter", {
    query: ctx.state.query,
    plan_json: JSON.stringify(ctx.state.currentPlan),
    observations_json: JSON.stringify(ctx.state.observations || []),
    team_json: JSON.stringify(ctx.state.nodes.research_team || {}),
    sources_json: JSON.stringify(
      sources.map((s) => ({ id: s.id, title: s.title, snippet: s.snippet.slice(0, 800) }))
    ),
    simple: simple ? "true" : "false",
    reflection_hint: ctx.state.reflectionHint || ""
  });
  const out = await ctx.client.completeRole({
    roleName: "reporter",
    systemPrompt,
    userPrompt: ctx.state.query,
    signal: ctx.signal,
    onDelta: ({ content }) => ctx.emit("report_delta", { content }, "reporter")
  });
  const formatted = formatCitations(out.content, sources);
  ctx.state.finalReport = formatted.markdown;
  ctx.emit(
    "report_completed",
    { report: formatted.markdown, citedIds: formatted.citedIds, missingIds: formatted.missingIds },
    "reporter"
  );
  return { length: formatted.markdown.length, citedIds: formatted.citedIds, missingIds: formatted.missingIds };
}

export function planNeedsFeedback(ctx) {
  return !ctx.config.autoAcceptPlan && !(ctx.state.feedback && ctx.state.feedback.accepted);
}

export async function runResearchGraph(ctx) {
  const { state } = ctx;

  if (!state.nodes.coordinator) await runNode(ctx, "coordinator", coordinatorNode);

  const deep = state.nodes.coordinator.enable_deepresearch !== false;

  if (deep) {
    if (!state.nodes.rewrite_multi_query) {
      await runNode(ctx, "rewrite_multi_query", rewriteMultiQueryNode);
    }
    const hasRag = ctx.config.ragEnabled && ctx.rag && ctx.rag.index;
    const hasWeb = Boolean(ctx.searchService && ctx.searchService.enabled && ctx.searchService.enabled());
    if ((hasRag || hasWeb) && !state.nodes.background_investigator) {
      await runNode(ctx, "background_investigator", backgroundInvestigatorNode);
    }
    if (!state.currentPlan) await runNode(ctx, "planner", plannerNode);

    if (planNeedsFeedback(ctx)) {
      state.status = "waiting_feedback";
      await ctx.save();
      ctx.emit("feedback_required", {
        plan: state.currentPlan,
        planIterations: state.planIterations
      });
      return state;
    }

    if (!state.nodes.parallel_executor) {
      await runNode(ctx, "parallel_executor", parallelExecutorNode);
    }
    if (!state.nodes.research_team) {
      await runNode(ctx, "research_team", researchTeamNode);
    }
  }

  if (state.finalReport === null) {
    await runNode(ctx, "reporter", reporterNode);

    // Bounded reflection: if the report ignored available sources, send the
    // reporter back once with a corrective hint.
    while (deep && ctx.config.reflection?.enabled) {
      const reflection = reflectionNode(ctx);
      state.nodes.reflection = reflection;
      if (reflection.pass || state.reflectionAttempts >= (ctx.config.reflection.maxAttempts || 0)) {
        break;
      }
      state.reflectionAttempts += 1;
      state.reflectionHint = reflection.issues.map((i) => i.required_fix).join("; ");
      state.finalReport = null;
      await runNode(ctx, "reporter", reporterNode);
    }
  }

  // Author credibility: verify the primary author of each cited source in ORCID.
  if (ctx.config.authorVerification?.enabled && ctx.orcid) {
    try {
      const summary = await verifyCitedAuthors(state, {
        client: ctx.orcid,
        maxAuthors: ctx.config.authorVerification.maxAuthors,
        signal: ctx.signal
      });
      if (summary.checked) {
        ctx.emit("authors_verified", { ...summary, sources: state.sources }, "reporter");
      }
    } catch {
      // Verification is best-effort; never fail a completed report over it.
    }
  }

  state.status = "completed";
  await ctx.save();
  ctx.emit("research_completed", {
    reportLength: state.finalReport ? state.finalReport.length : 0
  });
  return state;
}
