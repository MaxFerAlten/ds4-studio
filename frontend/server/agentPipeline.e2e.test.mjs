// End-to-end pipeline test (§19) — exercises the real modules wired together
// (research_discover → source critic → planner → task state → crawl tool →
// summarizer → evidence store → synthesis engine) with fetch/service mocked.
// Mirrors the 3-turn scenario from the plan without spinning the HTTP server.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { executeTool } from "./agentTools.mjs";
import { planTools } from "./toolPlanner.mjs";
import { createTaskState } from "./agentTaskState.mjs";
import { evidenceFromCrawlManifest, EvidenceStore } from "./evidenceStore.mjs";
import { buildSynthesisBrief } from "./synthesisEngine.mjs";
import { AgentSessionManager } from "./agentSession.mjs";
import { ToolBlobStore } from "./toolBlobStore.mjs";
import { compressToolResultForModel } from "./toolOutputCompressor.mjs";

// --- fixtures: per-URL crawl content driving source classification ----------
const PAGE_CONTENT = {
  "https://neuronfeed.test/top": "Top 10 best AI conferences, curated ranking. Tier 1 must-attend events. Acceptance rate around 18%.",
  "https://portal.core.edu.au/ranks": "ICML A* rank. NeurIPS A* rank. Official conference ranking database entries.",
  "https://someconf.org/cfp": "Official call for papers. Submission deadline May 2026. Program committee listed.",
  "https://aideadlines.test/hub": Array.from({ length: 18 }, (_, i) => `https://aideadlines.test/c/${i}`).join(" ")
};
const FOUND_URLS = Object.keys(PAGE_CONTENT);

function crawlFetchMock() {
  let pendingUrl = null;
  return async (url, init) => {
    if (url.endsWith("/jobs")) {
      pendingUrl = JSON.parse(init.body).url;
      return { ok: true, status: 200, text: async () => JSON.stringify({ job_id: "job-1" }) };
    }
    const manifest = { pages: [{ url: pendingUrl, state: "succeeded", content: PAGE_CONTENT[pendingUrl] ?? "" }] };
    return { ok: true, status: 200, text: async () => JSON.stringify({ state: "succeeded", result_manifest: manifest }) };
  };
}

test("turn 1: research_discover returns judged sources, no verified-ranking claim", async () => {
  const researchService = {
    enabled: () => true,
    gather: async () => [
      { url: "https://neuronfeed.test/top", title: "Top sites", provider: "tavily", content: "Top 10 best, curated ranking." },
      { url: "https://portal.core.edu.au/ranks", title: "CORE", provider: "core", content: "ICML A* rank database." }
    ]
  };
  const res = await executeTool("research_discover", { query: "best 5 sites to publish AI papers", depth: "shallow" }, { researchService });
  assert.equal(res.isError, false);
  assert.match(res.content, /neuronfeed\.test/);
  // the editorial source is flagged, not presented as an authoritative ranking
  assert.match(res.content, /SECONDARY_EDITORIAL/);
  assert.match(res.content, /not authoritative|do not paste/i);
});

test("turn 2: 'crawl every LINK_FOUND_NOT_OPENED' → one crawl per unresolved link, summarized (no raw dump)", async () => {
  // transcript after turn 1: the assistant surfaced the links it found
  const transcript = [
    { role: "user", content: "mi cerchi i migliori 5 siti per pubblicare paper sulla AI" },
    { role: "assistant", content: `LINK_FOUND_NOT_OPENED:\n${FOUND_URLS.join("\n")}` }
  ];
  const taskState = createTaskState(transcript);
  const unresolved = taskState.unresolvedLinks();
  assert.equal(unresolved.length, FOUND_URLS.length);

  const actions = planTools({
    userText: "per ogni LINK_FOUND_NOT_OPENED usa crawl e riassumi in tabella",
    taskState,
    capabilities: { crawl: true }
  });
  assert.equal(actions.length, FOUND_URLS.length, "one crawl action per unresolved link");

  const realFetch = globalThis.fetch;
  globalThis.fetch = crawlFetchMock();
  const store = new EvidenceStore();
  try {
    for (const action of actions) {
      const res = await executeTool("crawl", { url: action.args.url }, { crawlBaseUrl: "http://crawl", signal: undefined });
      assert.equal(res.isError, false);
      const raw = PAGE_CONTENT[action.args.url];
      assert.ok(res.content.length < raw.length + 4000, "summarized, not a raw dump");
      assert.match(res.content, /↳ critique:/); // source critic ran per page
      store.addMany(evidenceFromCrawlManifest(res.raw.manifest));
    }
  } finally {
    globalThis.fetch = realFetch;
  }

  // turn 2 output substance: distinct source types incl. editorial + hub + official + ranking-db
  const types = new Set(store.items.map((e) => e.sourceType));
  assert.ok(types.has("SECONDARY_EDITORIAL"));
  assert.ok(types.has("LINK_HUB"));
  assert.ok(types.has("PRIMARY_OFFICIAL"));
  assert.ok(types.has("RANKING_DATABASE"));
  // the link hub is flagged for follow-up (§16)
  assert.ok(store.unresolved().some((e) => e.sourceType === "LINK_HUB"));

  // turn 3: synthesize with a criterion — brief weights sources, flags editorial
  const brief = buildSynthesisBrief(store.useful(), { question: "adesso dimmi i 5 migliori con criterio" });
  assert.match(brief, /Prefer PRIMARY_OFFICIAL and RANKING_DATABASE/);
  assert.match(brief, /flag SECONDARY_EDITORIAL/);
  assert.match(brief, /someconf\.org/); // primary source carried into the brief
  assert.match(brief, /adesso dimmi i 5 migliori/);
});

test("large list result forces observe-compress-target-verdict before further analysis", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "ds4-agent-flow-"));
  try {
    const blobStore = new ToolBlobStore(tmp);
    const session = new AgentSessionManager();
    session.start();
    const original = Array.from({ length: 100 }, (_, i) => `src/file_${i}.c`).join("\n");

    const result = await compressToolResultForModel(
      "list",
      { content: original, isError: false },
      blobStore
    );

    assert.equal(result.compressed, true);
    assert.match(result.content, /\[TOOL_OUTPUT_COMPRESSED\]/);
    assert.equal(await blobStore.get(result.compression.blobId, 0, original.length), original);

    session.loopGuard.recordCompressedObservation();
    const bad = session.loopGuard.checkAssistantText("I will keep reading more files.");
    assert.equal(bad?.type, "STOP_MISSING_OBSERVATION_FLOW");

    session.loopGuard.recordCompressedObservation();
    const good = [
      "[OBSERVATION] the listing is broad and repetitive.",
      "[COMPRESSED] the relevant files are concentrated under frontend/server.",
      "[TARGET_SELECTED] inspect the agent loop guard next.",
      "[VERDICT] enough evidence is available to continue."
    ].join("\n");
    assert.equal(session.loopGuard.checkAssistantText(good), undefined);
    assert.equal(session.loopGuard.requiresStructuredObservation(), false);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});
