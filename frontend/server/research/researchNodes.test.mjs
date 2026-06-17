import test from "node:test";
import assert from "node:assert/strict";
import {
  backgroundInvestigatorNode,
  parallelExecutorNode,
  reflectionNode,
  relevantSourcesFor,
  researchTeamNode,
  researcherNode
} from "./researchNodes.mjs";
import { buildIndex, chunkDocument } from "./researchRag.mjs";
import { initialState } from "./researchStateStore.mjs";

function ragFor(markdown, docId = "doc000") {
  const chunks = chunkDocument(markdown, { docId, targetTokens: 60 });
  return { index: buildIndex(chunks), chunks };
}

function fakeClient(responses) {
  return {
    calls: [],
    async completeRole({ roleName }) {
      this.calls.push(roleName);
      const r = responses[roleName];
      const item = Array.isArray(r) ? r.shift() : r;
      if (item === undefined) throw new Error(`no fake response for ${roleName}`);
      return { content: JSON.stringify(item), reasoning: "", usage: null, json: item };
    }
  };
}

function makeCtx({ query = "redis sentinel failover", config = {}, responses = {}, rag = null } = {}) {
  const events = [];
  const state = initialState(query);
  state.optimizedQueries = [query];
  return {
    state,
    rag,
    config: { maxSourcesPerQuery: 8, maxSteps: 12, reflection: { enabled: true, maxAttempts: 2 }, ...config },
    client: fakeClient(responses),
    signal: new AbortController().signal,
    emit: (type, content, nodeName) => events.push({ type, content, nodeName }),
    events
  };
}

test("backgroundInvestigatorNode builds sources from the RAG index", async () => {
  const rag = ragFor("# Redis\n\nredis sentinel failover monitoring quorum\n\n# Kafka\n\nkafka topic partition");
  const ctx = makeCtx({ rag });
  const result = await backgroundInvestigatorNode(ctx);
  assert.ok(result.sourceCount >= 1);
  assert.ok(ctx.state.sources[0].id.startsWith("src_"));
  assert.ok(ctx.events.some((e) => e.type === "source_found"));
});

test("backgroundInvestigatorNode yields zero sources without RAG or web", async () => {
  const ctx = makeCtx({ rag: null });
  assert.deepEqual(await backgroundInvestigatorNode(ctx), { sourceCount: 0, webEnabled: false });
  assert.deepEqual(ctx.state.sources, []);
});

test("backgroundInvestigatorNode merges web sources when a search service is enabled", async () => {
  const ctx = makeCtx({ rag: null });
  ctx.searchService = {
    enabled: () => true,
    gather: async () => [
      { title: "Redis docs", url: "https://redis.io/docs", content: "sentinel failover", snippet: "sentinel", provider: "wikipedia", sourceType: "encyclopedia", score: 0.9 }
    ]
  };
  const result = await backgroundInvestigatorNode(ctx);
  assert.equal(result.webEnabled, true);
  assert.ok(result.sourceCount >= 1);
  const web = ctx.state.sources.find((s) => s.kind === "web");
  assert.ok(web, "web source merged");
  assert.equal(web.provider, "wikipedia");
});

test("relevantSourcesFor maps a step to its matching source", async () => {
  const rag = ragFor("# A\n\nredis sentinel failover\n\n# B\n\npostgres streaming replication");
  const ctx = makeCtx({ rag });
  await backgroundInvestigatorNode(ctx);
  const relevant = relevantSourcesFor(ctx, { id: "s1", question: "sentinel failover" });
  assert.ok(relevant.length >= 1);
  assert.match(relevant[0].snippet, /sentinel/);
});

test("relevantSourcesFor retrieves real page passages (relevantText), not just the snippet", async () => {
  const ctx = makeCtx({ rag: null });
  ctx.searchService = {
    enabled: () => true,
    gather: async () => [
      {
        title: "QHO",
        url: "https://x",
        snippet: "short snippet",
        content:
          "Intro about unrelated cats and dogs.\n\nThe ladder operators a and a-dagger raise and lower the energy eigenstates of the quantum harmonic oscillator by one quantum of hbar omega.\n\nUnrelated footer text.",
        provider: "tavily",
        sourceType: "web",
        score: 0.9
      }
    ]
  };
  await backgroundInvestigatorNode(ctx);
  const rel = relevantSourcesFor(ctx, { id: "s1", question: "ladder operators energy eigenstates" });
  assert.ok(rel.length >= 1);
  assert.ok(rel[0].relevantText, "attaches relevantText");
  assert.match(rel[0].relevantText, /ladder operators/);
  // the retrieved passage is richer than the 13-char provider snippet
  assert.ok(rel[0].relevantText.length > "short snippet".length);
});

test("researcherNode returns a finding with evidence restricted to known sources", async () => {
  const rag = ragFor("# A\n\nredis sentinel failover quorum monitoring");
  const ctx = makeCtx({
    rag,
    responses: {
      researcher: {
        finding: "sentinel handles failover",
        evidence: [
          { source_id: "src_001", quote_or_summary: "failover", relevance: 0.9 },
          { source_id: "src_999", quote_or_summary: "ghost", relevance: 0.5 }
        ],
        confidence: "high",
        open_questions: []
      }
    }
  });
  await backgroundInvestigatorNode(ctx);
  const finding = await researcherNode(ctx, { id: "s1", question: "sentinel failover" });
  assert.equal(finding.step_id, "s1");
  assert.ok(finding.evidence.every((e) => e.source_id !== "src_999"), "unknown source ids dropped");
});

test("parallelExecutorNode runs a researcher per step and collects observations", async () => {
  const rag = ragFor("# A\n\nredis sentinel failover\n\n# B\n\nredis cluster sharding gossip");
  const ctx = makeCtx({
    rag,
    responses: {
      researcher: [
        { finding: "f1", evidence: [], confidence: "medium", open_questions: [] },
        { finding: "f2", evidence: [], confidence: "medium", open_questions: [] }
      ]
    }
  });
  await backgroundInvestigatorNode(ctx);
  ctx.state.currentPlan = {
    objective: "o",
    steps: [
      { id: "s1", question: "failover?", method: "rag" },
      { id: "s2", question: "sharding?", method: "rag" }
    ]
  };
  const result = await parallelExecutorNode(ctx);
  assert.equal(result.observationCount, 2);
  assert.equal(ctx.state.observations.length, 2);
  assert.ok(ctx.events.some((e) => e.type === "research_step_completed"));
});

test("researchTeamNode synthesizes observations", async () => {
  const ctx = makeCtx({
    responses: {
      research_team: { summary: "ok", conflicts: [], missing_evidence: [], ready_for_report: true }
    }
  });
  ctx.state.observations = [{ step_id: "s1", finding: "f" }];
  const out = await researchTeamNode(ctx);
  assert.equal(out.ready_for_report, true);
  assert.equal(ctx.client.calls[0], "research_team");
});

test("reflectionNode fails when sources exist but the report cites none", () => {
  const ctx = makeCtx({});
  ctx.state.sources = [{ id: "src_001" }];
  ctx.state.finalReport = "# Report\n\nno citations here.";
  const out = reflectionNode(ctx);
  assert.equal(out.pass, false);
  assert.equal(out.issues[0].type, "missing_source");
});

test("reflectionNode passes when the report cites a source", () => {
  const ctx = makeCtx({});
  ctx.state.sources = [{ id: "src_001" }];
  ctx.state.finalReport = "# Report\n\ngrounded in [src_001].";
  assert.equal(reflectionNode(ctx).pass, true);
});

test("reflectionNode ignores sources that are not citable references", () => {
  const ctx = makeCtx({});
  ctx.state.sources = [
    { id: "src_001", title: "Thread", url: "https://reddit.com/r/science/comments/1", citable: false }
  ];
  ctx.state.finalReport = "# Report\n\nbackground only.";
  assert.deepEqual(reflectionNode(ctx), { pass: true, issues: [] });
});

test("reflectionNode is a no-op when disabled", () => {
  const ctx = makeCtx({ config: { reflection: { enabled: false, maxAttempts: 0 } } });
  ctx.state.sources = [{ id: "src_001" }];
  ctx.state.finalReport = "no citations";
  assert.deepEqual(reflectionNode(ctx), { pass: true, issues: [] });
});
