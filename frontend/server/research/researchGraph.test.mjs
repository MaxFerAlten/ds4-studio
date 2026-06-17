import test from "node:test";
import assert from "node:assert/strict";
import { reporterNode, runResearchGraph } from "./researchGraph.mjs";
import { initialState } from "./researchStateStore.mjs";
import { normalizeSources } from "./researchSources.mjs";

const COORD_DEEP = {
  enable_deepresearch: true,
  research_depth: "standard",
  needs_web: false,
  needs_files: false,
  needs_code: false,
  language: "en"
};
const REWRITE = {
  optimized_queries: ["a", "b"],
  search_intent: "x",
  must_include_terms: [],
  must_exclude_terms: []
};
const FINDING = { finding: "f", evidence: [], confidence: "medium", open_questions: [] };
const TEAM = { summary: "s", conflicts: [], missing_evidence: [], ready_for_report: true };
function makePlan() {
  return {
    plan: {
      objective: "o",
      steps: [{ id: "s1", question: "?", method: "reasoning", expected_evidence: "e" }],
      risks: [],
      acceptance_criteria: []
    }
  };
}

function fakeClient(responses) {
  return {
    calls: [],
    requests: [],
    async completeRole({ roleName, systemPrompt, onDelta }) {
      this.calls.push(roleName);
      this.requests.push({ roleName, systemPrompt });
      const r = responses[roleName];
      const item = Array.isArray(r) ? r.shift() : r;
      if (item === undefined) throw new Error(`no fake response for ${roleName}`);
      if (typeof item === "string") {
        if (onDelta) for (const ch of item) onDelta({ content: ch });
        return { content: item, reasoning: "", usage: null };
      }
      return { content: JSON.stringify(item), reasoning: "", usage: null, json: item };
    }
  };
}

// Default responses cover the full deep pipeline; individual tests override.
function deepResponses(overrides = {}) {
  return {
    coordinator: COORD_DEEP,
    query_rewriter: REWRITE,
    planner: makePlan(),
    researcher: { ...FINDING },
    research_team: { ...TEAM },
    reporter: "# Report",
    ...overrides
  };
}

function makeCtx({ query = "q", config = {}, responses = {} } = {}) {
  const events = [];
  return {
    state: initialState(query),
    config: { autoAcceptPlan: true, maxPlanIterations: 3, maxSteps: 12, maxSourcesPerQuery: 8, ...config },
    client: fakeClient(responses),
    rag: null,
    signal: new AbortController().signal,
    save: async () => {},
    emit: (type, content, nodeName) => events.push({ type, content, nodeName }),
    events
  };
}

test("simple query skips research and reports directly", async () => {
  const ctx = makeCtx({
    responses: { coordinator: { enable_deepresearch: false }, reporter: "ciao" }
  });
  await runResearchGraph(ctx);
  assert.equal(ctx.state.status, "completed");
  assert.equal(ctx.state.finalReport, "ciao");
  assert.deepEqual(ctx.client.calls, ["coordinator", "reporter"]);
});

test("deep query with autoAcceptPlan runs the full research pipeline", async () => {
  const ctx = makeCtx({ responses: deepResponses() });
  await runResearchGraph(ctx);
  assert.deepEqual(ctx.client.calls, [
    "coordinator",
    "query_rewriter",
    "planner",
    "researcher",
    "research_team",
    "reporter"
  ]);
  assert.deepEqual(ctx.state.optimizedQueries, ["a", "b"]);
  assert.equal(ctx.state.currentPlan.objective, "o");
  assert.equal(ctx.state.observations.length, 1);
  assert.equal(ctx.state.planIterations, 1);
  assert.equal(ctx.state.status, "completed");
  assert.ok(ctx.events.some((e) => e.type === "plan_generated"));
  assert.ok(ctx.events.some((e) => e.type === "research_step_completed"));
  assert.ok(ctx.events.some((e) => e.type === "report_delta"));
  assert.ok(ctx.events.some((e) => e.type === "research_completed"));
});

test("pauses for feedback before running the researchers", async () => {
  const ctx = makeCtx({ config: { autoAcceptPlan: false }, responses: deepResponses() });
  await runResearchGraph(ctx);
  assert.equal(ctx.state.status, "waiting_feedback");
  assert.equal(ctx.state.finalReport, null);
  assert.equal(ctx.state.observations.length, 0, "no research before approval");
  assert.deepEqual(ctx.client.calls, ["coordinator", "query_rewriter", "planner"]);
  assert.ok(ctx.events.some((e) => e.type === "feedback_required"));
});

test("re-entry after accepted feedback resumes without re-running earlier nodes", async () => {
  const ctx = makeCtx({ config: { autoAcceptPlan: false }, responses: deepResponses({ reporter: "done" }) });
  await runResearchGraph(ctx);
  ctx.state.feedback = { action: "accept", accepted: true };
  ctx.state.status = "running";
  await runResearchGraph(ctx);
  assert.equal(ctx.state.status, "completed");
  assert.equal(ctx.state.finalReport, "done");
  assert.deepEqual(ctx.client.calls, [
    "coordinator",
    "query_rewriter",
    "planner",
    "researcher",
    "research_team",
    "reporter"
  ]);
});

test("empty rewrite output falls back to the original query", async () => {
  const ctx = makeCtx({ responses: deepResponses({ query_rewriter: { optimized_queries: [] } }) });
  await runResearchGraph(ctx);
  assert.deepEqual(ctx.state.optimizedQueries, ["q"]);
});

test("planner without steps raises", async () => {
  const ctx = makeCtx({
    responses: deepResponses({ planner: { plan: { objective: "o", steps: [] } } })
  });
  await assert.rejects(() => runResearchGraph(ctx), /planner returned no steps/);
});

test("reflection retries the reporter once when sources are ignored", async () => {
  const ctx = makeCtx({
    config: { reflection: { enabled: true, maxAttempts: 2 } },
    responses: deepResponses({ reporter: ["no citations", "grounded in [src_001]"] })
  });
  // seed a source so reflection expects a citation
  ctx.state.sources = [{ id: "src_001", title: "Doc", snippet: "x", kind: "file" }];
  await runResearchGraph(ctx);
  const reporterCalls = ctx.client.calls.filter((c) => c === "reporter").length;
  assert.equal(reporterCalls, 2, "reporter re-runs once after reflection");
  assert.equal(ctx.state.reflectionAttempts, 1);
  assert.match(ctx.state.finalReport, /src_001/);
});

test("reporter prompt exposes only citable sources as available references", async () => {
  const ctx = makeCtx({ responses: { reporter: "Grounded in [src_001]." } });
  ctx.state.currentPlan = makePlan().plan;
  ctx.state.sources = normalizeSources([
    { url: "https://arxiv.org/abs/1234.5678", title: "Paper", snippet: "paper text" },
    { url: "https://reddit.com/r/science/comments/1", title: "Thread", snippet: "thread text" }
  ]);

  await reporterNode(ctx);

  const prompt = ctx.client.requests.find((r) => r.roleName === "reporter").systemPrompt;
  assert.match(prompt, /src_001/);
  assert.match(prompt, /Paper/);
  assert.doesNotMatch(prompt, /src_002/);
  assert.doesNotMatch(prompt, /Thread/);
});
