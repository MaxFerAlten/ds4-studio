import test from "node:test";
import assert from "node:assert/strict";
import {
  applyResearchEvent,
  formatNodeResult,
  initialResearchView,
  researchViewFromState
} from "./researchStore.mjs";

function feed(view, type, content = {}, nodeName = null, seq) {
  return applyResearchEvent(view, { type, content, nodeName, seq, sessionId: "rs_x" });
}

test("event stream builds the view through the full happy path", () => {
  let v = initialResearchView();
  v = feed(v, "research_started", { query: "q" }, null, 1);
  assert.equal(v.status, "running");
  v = feed(v, "node_started", {}, "coordinator", 2);
  assert.equal(v.nodes[0].status, "running");
  v = feed(v, "node_completed", { result: { enable_deepresearch: true } }, "coordinator", 3);
  assert.equal(v.nodes[0].status, "done");
  v = feed(v, "plan_generated", { plan: { objective: "o", steps: [] }, planIterations: 1 }, "planner", 4);
  assert.equal(v.plan.objective, "o");
  v = feed(v, "feedback_required", {}, null, 5);
  assert.equal(v.status, "waiting_feedback");
  v = feed(v, "feedback_received", { action: "accept" }, null, 6);
  assert.equal(v.status, "running");
  v = feed(v, "report_delta", { content: "# R" }, "reporter", 7);
  v = feed(v, "report_delta", { content: "ep" }, "reporter", 8);
  v = feed(v, "research_completed", {}, null, 9);
  assert.equal(v.report, "# Rep");
  assert.equal(v.status, "completed");
  assert.equal(v.lastSeq, 9);
});

test("duplicate or stale seq is ignored", () => {
  let v = initialResearchView();
  v = feed(v, "report_delta", { content: "a" }, "reporter", 1);
  v = feed(v, "report_delta", { content: "a" }, "reporter", 1);
  assert.equal(v.report, "a");
});

test("regenerate feedback clears the plan", () => {
  let v = initialResearchView();
  v = feed(v, "plan_generated", { plan: { objective: "o", steps: [] }, planIterations: 1 }, "planner", 1);
  v = feed(v, "feedback_received", { action: "regenerate" }, null, 2);
  assert.equal(v.plan, null);
});

test("source_found accumulates unique sources", () => {
  let v = initialResearchView();
  v = feed(v, "source_found", { source: { id: "src_001", title: "A" } }, null, 1);
  v = feed(v, "source_found", { source: { id: "src_002", title: "B" } }, null, 2);
  v = feed(v, "source_found", { source: { id: "src_001", title: "A dup" } }, null, 3);
  assert.deepEqual(v.sources.map((s) => s.id), ["src_001", "src_002"]);
});

test("report_completed replaces the streamed body with the authoritative report", () => {
  let v = initialResearchView();
  v = feed(v, "report_delta", { content: "partial draft" }, "reporter", 1);
  v = feed(v, "report_completed", { report: "# Final\n\ngrounded [src_001]" }, "reporter", 2);
  assert.equal(v.report, "# Final\n\ngrounded [src_001]");
});

test("research_error and research_cancelled set terminal states", () => {
  let v = feed(initialResearchView(), "research_error", { error: "boom" }, null, 1);
  assert.equal(v.status, "failed");
  assert.equal(v.error, "boom");
  let w = feed(initialResearchView(), "research_cancelled", {}, null, 1);
  assert.equal(w.status, "cancelled");
});

test("researchViewFromState reconstructs an authoritative persisted view", () => {
  const view = researchViewFromState({
    sessionId: "rs_saved",
    status: "completed",
    seq: 42,
    planIterations: 2,
    currentPlan: { objective: "explain", steps: [] },
    sources: [{ id: "src_001", title: "Source" }],
    finalReport: "# Final",
    error: null,
    nodes: {
      coordinator: { enable_deepresearch: true },
      reporter: { length: 7 }
    }
  });

  assert.equal(view.sessionId, "rs_saved");
  assert.equal(view.status, "completed");
  assert.equal(view.lastSeq, 42);
  assert.equal(view.plan.objective, "explain");
  assert.equal(view.planIterations, 2);
  assert.deepEqual(view.sources.map((source) => source.id), ["src_001"]);
  assert.equal(view.report, "# Final");
  assert.deepEqual(
    view.nodes.map((node) => ({
      name: node.name,
      title: node.title,
      status: node.status,
      result: node.result
    })),
    [
      {
        name: "coordinator",
        title: "Coordinator",
        status: "done",
        result: { enable_deepresearch: true }
      },
      {
        name: "reporter",
        title: "Reporter",
        status: "done",
        result: { length: 7 }
      }
    ]
  );
});

test("formatNodeResult renders strings, objects, and empties for the thought chain", () => {
  assert.equal(formatNodeResult(null), "");
  assert.equal(formatNodeResult(undefined), "");
  assert.equal(formatNodeResult({}), "");
  assert.equal(formatNodeResult([]), "");
  assert.equal(formatNodeResult("done reasoning"), "done reasoning");
  assert.equal(
    formatNodeResult({ enable_deepresearch: true, language: "it" }),
    '{\n  "enable_deepresearch": true,\n  "language": "it"\n}'
  );
  assert.equal(formatNodeResult(["a", "b"]), '[\n  "a",\n  "b"\n]');
});

test("researchViewFromState preserves an in-progress session with safe defaults", () => {
  const view = researchViewFromState({
    sessionId: "rs_running",
    status: "running",
    seq: 3,
    nodes: { coordinator: { enable_deepresearch: true } }
  });

  assert.equal(view.status, "running");
  assert.equal(view.report, "");
  assert.deepEqual(view.sources, []);
  assert.equal(view.nodes[0].status, "done");
});
