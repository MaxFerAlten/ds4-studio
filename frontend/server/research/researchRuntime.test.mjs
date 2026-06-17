import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ResearchRuntime } from "./researchRuntime.mjs";
import { ResearchStateStore } from "./researchStateStore.mjs";
import { RESEARCH_DEFAULTS } from "./researchConfig.mjs";

const COORD_DEEP = { enable_deepresearch: true, language: "en" };
const REWRITE = { optimized_queries: ["a"], search_intent: "x" };
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
// The deep pipeline now runs researcher + research_team between planner and
// reporter; deep-flow tests must supply fakes for those roles too.
function deepDefaults() {
  return { researcher: { ...FINDING }, research_team: { ...TEAM } };
}

function fakeClient(responses) {
  return {
    async completeRole({ roleName, onDelta }) {
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

async function makeRuntime(t, { responses = {}, config = {}, client } = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ds4-research-rt-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const store = new ResearchStateStore({ rootDir: dir });
  const runtime = new ResearchRuntime({
    store,
    clientFactory: () => client || fakeClient(responses),
    getConfig: () => ({ ...RESEARCH_DEFAULTS, enabled: true, autoAcceptPlan: true, ...config }),
    logger: { error: () => {} }
  });
  return { runtime, store };
}

async function waitForStatus(store, sessionId, status, timeoutMs = 2000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const state = await store.loadState(sessionId);
    if (state?.status === status) return state;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`timed out waiting for status ${status}`);
}

test("start runs a simple query to completion and persists events", async (t) => {
  const { runtime, store } = await makeRuntime(t, {
    responses: { coordinator: { enable_deepresearch: false }, reporter: "ciao" }
  });
  const { sessionId } = await runtime.start("hello");
  const state = await waitForStatus(store, sessionId, "completed");
  assert.equal(state.finalReport, "ciao");
  await runtime.flush(sessionId);
  const events = await store.readEvents(sessionId);
  assert.equal(events[0].type, "research_started");
  assert.ok(events.some((e) => e.type === "research_completed"));
});

test("start rejects empty query", async (t) => {
  const { runtime } = await makeRuntime(t, {});
  await assert.rejects(() => runtime.start("   "), /query is required/);
});

test("feedback accept resumes a paused session", async (t) => {
  const { runtime, store } = await makeRuntime(t, {
    config: { autoAcceptPlan: false },
    responses: {
      coordinator: COORD_DEEP,
      query_rewriter: REWRITE,
      planner: makePlan(),
      ...deepDefaults(),
      reporter: "rep"
    }
  });
  const { sessionId } = await runtime.start("q");
  await waitForStatus(store, sessionId, "waiting_feedback");
  await runtime.feedback(sessionId, { action: "accept" });
  const state = await waitForStatus(store, sessionId, "completed");
  assert.equal(state.finalReport, "rep");
});

test("feedback regenerate re-runs the planner", async (t) => {
  const { runtime, store } = await makeRuntime(t, {
    config: { autoAcceptPlan: false },
    responses: {
      coordinator: COORD_DEEP,
      query_rewriter: REWRITE,
      planner: [makePlan(), makePlan()],
      reporter: "rep"
    }
  });
  const { sessionId } = await runtime.start("q");
  await waitForStatus(store, sessionId, "waiting_feedback");
  await runtime.feedback(sessionId, { action: "regenerate" });
  const paused = await waitForStatus(store, sessionId, "waiting_feedback");
  assert.equal(paused.planIterations, 2);
});

test("regenerate respects maxPlanIterations", async (t) => {
  const { runtime, store } = await makeRuntime(t, {
    config: { autoAcceptPlan: false, maxPlanIterations: 1 },
    responses: { coordinator: COORD_DEEP, query_rewriter: REWRITE, planner: makePlan() }
  });
  const { sessionId } = await runtime.start("q");
  await waitForStatus(store, sessionId, "waiting_feedback");
  await assert.rejects(
    () => runtime.feedback(sessionId, { action: "regenerate" }),
    /plan iteration limit/
  );
});

test("feedback edit replaces the plan", async (t) => {
  const { runtime, store } = await makeRuntime(t, {
    config: { autoAcceptPlan: false },
    responses: {
      coordinator: COORD_DEEP,
      query_rewriter: REWRITE,
      planner: makePlan(),
      ...deepDefaults(),
      reporter: "rep"
    }
  });
  const { sessionId } = await runtime.start("q");
  await waitForStatus(store, sessionId, "waiting_feedback");
  const edited = {
    objective: "edited",
    steps: [{ id: "s1", question: "edited?", method: "reasoning", expected_evidence: "e" }]
  };
  await runtime.feedback(sessionId, { action: "edit", plan: edited });
  const state = await waitForStatus(store, sessionId, "completed");
  assert.equal(state.currentPlan.objective, "edited");
});

test("feedback on a non-waiting session raises 409", async (t) => {
  const { runtime, store } = await makeRuntime(t, {
    responses: { coordinator: { enable_deepresearch: false }, reporter: "x" }
  });
  const { sessionId } = await runtime.start("q");
  await waitForStatus(store, sessionId, "completed");
  await assert.rejects(
    () => runtime.feedback(sessionId, { action: "accept" }),
    /not waiting for feedback/
  );
});

test("feedback on unknown session raises 404", async (t) => {
  const { runtime } = await makeRuntime(t, {});
  await assert.rejects(
    () => runtime.feedback("rs_000000000000", { action: "accept" }),
    /session not found/
  );
});

test("cancel while waiting_feedback marks the session cancelled", async (t) => {
  const { runtime, store } = await makeRuntime(t, {
    config: { autoAcceptPlan: false },
    responses: { coordinator: COORD_DEEP, query_rewriter: REWRITE, planner: makePlan() }
  });
  const { sessionId } = await runtime.start("q");
  await waitForStatus(store, sessionId, "waiting_feedback");
  await runtime.cancel(sessionId);
  const state = await store.loadState(sessionId);
  assert.equal(state.status, "cancelled");
  await runtime.flush(sessionId);
  const events = await store.readEvents(sessionId);
  assert.ok(events.some((e) => e.type === "research_cancelled"));
});

test("model error marks the session failed with research_error event", async (t) => {
  const { runtime, store } = await makeRuntime(t, {
    client: {
      async completeRole() {
        throw new Error("backend down");
      }
    }
  });
  const { sessionId } = await runtime.start("q");
  const state = await waitForStatus(store, sessionId, "failed");
  assert.match(state.error, /backend down/);
  await runtime.flush(sessionId);
  const events = await store.readEvents(sessionId);
  assert.ok(events.some((e) => e.type === "research_error"));
});

test("createSession + addDocument + launch feeds RAG sources to the run", async (t) => {
  const { runtime, store } = await makeRuntime(t, {
    config: { autoAcceptPlan: true },
    responses: {
      coordinator: COORD_DEEP,
      query_rewriter: REWRITE,
      planner: makePlan(),
      ...deepDefaults(),
      reporter: "grounded in [src_001]"
    }
  });
  const { sessionId } = await runtime.createSession("redis failover");
  const draft = await store.loadState(sessionId);
  assert.equal(draft.status, "draft");
  await runtime.addDocument(sessionId, {
    name: "redis.md",
    markdown: "# Redis\n\nredis sentinel failover monitoring quorum election"
  });
  await runtime.launch(sessionId);
  const done = await waitForStatus(store, sessionId, "completed");
  assert.ok(done.sources.length >= 1, "RAG should yield at least one source");
  assert.ok(done.finalReport.includes("src_001"));
});

test("addDocument is rejected once research has started", async (t) => {
  const { runtime, store } = await makeRuntime(t, {
    responses: { coordinator: { enable_deepresearch: false }, reporter: "x" }
  });
  const { sessionId } = await runtime.start("q");
  await waitForStatus(store, sessionId, "completed");
  await assert.rejects(
    () => runtime.addDocument(sessionId, { name: "a", markdown: "text" }),
    /only be added before research starts/
  );
});

test("launch rejects an already-started session", async (t) => {
  const { runtime, store } = await makeRuntime(t, {
    responses: { coordinator: { enable_deepresearch: false }, reporter: "x" }
  });
  const { sessionId } = await runtime.start("q");
  await waitForStatus(store, sessionId, "completed");
  await assert.rejects(() => runtime.launch(sessionId), /already started/);
});

test("subscribe receives live events", async (t) => {
  const { runtime, store } = await makeRuntime(t, {
    config: { autoAcceptPlan: false },
    responses: { coordinator: COORD_DEEP, query_rewriter: REWRITE, planner: makePlan() }
  });
  const { sessionId } = await runtime.start("q");
  const seen = [];
  const unsubscribe = runtime.subscribe(sessionId, (e) => seen.push(e.type));
  await waitForStatus(store, sessionId, "waiting_feedback");
  assert.ok(seen.includes("feedback_required"));
  unsubscribe();
});

test("routes cloud sessions to the selected engine, local by default", async (t) => {
  const { runtime, store } = await makeRuntime(t, {
    responses: { coordinator: { enable_deepresearch: false }, reporter: "x" }
  });
  const calls = [];
  const spy = (name) => ({
    run: async (ctx) => {
      calls.push(name);
      ctx.state.status = "completed";
      ctx.state.finalReport = name;
      await ctx.save();
      return ctx.state;
    }
  });
  runtime.engines = { local: spy("local"), gemini: spy("gemini"), prism: spy("prism") };
  const { sessionId } = await runtime.createSession("q");
  const state = await store.loadState(sessionId);
  state.engine = "prism";
  await store.saveState(state);
  await runtime.launch(sessionId);
  await waitForStatus(store, sessionId, "completed");
  assert.deepEqual(calls, ["prism"]);
});

test("gemini engine uses direct apiKey from config before environment", async (t) => {
  const { runtime, store } = await makeRuntime(t, {
    config: {
      gemini: {
        ...RESEARCH_DEFAULTS.gemini,
        apiKey: "DIRECT_GEMINI_KEY",
        apiKeyEnv: "DS4_TEST_EMPTY_GEMINI_KEY"
      }
    },
    responses: { coordinator: { enable_deepresearch: false }, reporter: "x" }
  });
  delete process.env.DS4_TEST_EMPTY_GEMINI_KEY;
  runtime.engines.gemini = {
    run: async (ctx) => {
      assert.equal(ctx.gemini.apiKey, "DIRECT_GEMINI_KEY");
      ctx.state.status = "completed";
      await ctx.save();
      return ctx.state;
    }
  };
  const { sessionId } = await runtime.createSession("q", { engine: "gemini" });
  await runtime.launch(sessionId);
  await waitForStatus(store, sessionId, "completed");
});

test("prism engine uses direct CLI path from config before environment", async (t) => {
  const { runtime, store } = await makeRuntime(t, {
    config: {
      prism: {
        ...RESEARCH_DEFAULTS.prism,
        cliPath: "/direct/prism-pp-cli",
        cliPathEnv: "DS4_TEST_PRISM_CLI_PATH",
        cookiesEnv: "DS4_TEST_PRISM_COOKIES",
        reasoningEffort: "high",
        projectId: "project-1",
        userId: "user-1"
      }
    },
    responses: { coordinator: { enable_deepresearch: false }, reporter: "x" }
  });
  process.env.DS4_TEST_PRISM_CLI_PATH = "/env/prism-pp-cli";
  t.after(() => delete process.env.DS4_TEST_PRISM_CLI_PATH);
  runtime.engines.prism = {
    run: async (ctx) => {
      assert.equal(ctx.prism.cliPath, "/direct/prism-pp-cli");
      assert.equal(ctx.prism.cookiesEnv, "DS4_TEST_PRISM_COOKIES");
      assert.equal(ctx.prism.reasoningEffort, "high");
      assert.equal(ctx.prism.projectId, "project-1");
      assert.equal(ctx.prism.userId, "user-1");
      ctx.state.status = "completed";
      await ctx.save();
      return ctx.state;
    }
  };
  const { sessionId } = await runtime.createSession("q", { engine: "prism" });
  await runtime.launch(sessionId);
  await waitForStatus(store, sessionId, "completed");
});

test("prism engine uses PRISM_CLI_PATH-style env when cliPath is blank", async (t) => {
  const { runtime, store } = await makeRuntime(t, {
    config: {
      prism: {
        ...RESEARCH_DEFAULTS.prism,
        cliPath: "",
        cliPathEnv: "DS4_TEST_PRISM_CLI_PATH"
      }
    },
    responses: { coordinator: { enable_deepresearch: false }, reporter: "x" }
  });
  process.env.DS4_TEST_PRISM_CLI_PATH = "/env/prism-pp-cli";
  t.after(() => delete process.env.DS4_TEST_PRISM_CLI_PATH);
  runtime.engines.prism = {
    run: async (ctx) => {
      assert.equal(ctx.prism.cliPath, "/env/prism-pp-cli");
      ctx.state.status = "completed";
      await ctx.save();
      return ctx.state;
    }
  };
  const { sessionId } = await runtime.createSession("q", { engine: "prism" });
  await runtime.launch(sessionId);
  await waitForStatus(store, sessionId, "completed");
});
