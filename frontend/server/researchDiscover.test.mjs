import { test } from "node:test";
import assert from "node:assert/strict";
import { executeTool } from "./agentTools.mjs";
import { AGENT_TOOLS } from "./agentSession.mjs";

test("research_discover is a registered agent tool", () => {
  const tool = AGENT_TOOLS.find((t) => t.function?.name === "research_discover");
  assert.ok(tool, "AGENT_TOOLS must include research_discover");
  assert.deepEqual(tool.function.parameters.required, ["query"]);
});

test("executeTool routes research_discover through the service and formats ranked sources", async () => {
  let gatheredQuery = null;
  const service = {
    enabled: () => true,
    gather: async (queries) => {
      gatheredQuery = queries[0];
      return [{ title: "Paper", url: "https://p.test", provider: "arxiv", citable: true, content: "finding" }];
    }
  };
  const res = await executeTool("research_discover", { query: "diffusion models", depth: "shallow" }, { researchService: service });
  assert.equal(res.isError, false);
  assert.equal(gatheredQuery, "diffusion models");
  assert.match(res.content, /Paper/);
  assert.match(res.content, /https:\/\/p\.test/);
  assert.ok(!/Unknown tool/.test(res.content));
});

test("executeTool research_discover surfaces gather errors", async () => {
  const service = { enabled: () => true, gather: async () => { throw new Error("provider down"); } };
  const res = await executeTool("research_discover", { query: "x" }, { researchService: service });
  assert.equal(res.isError, true);
  assert.match(res.content, /provider down/);
});

test("executeTool research_discover bypasses a disabled service and falls back to web_search", async () => {
  let gatherCalled = false;
  const service = { enabled: () => false, gather: async () => { gatherCalled = true; return []; } };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, status: 200, text: async () => "", json: async () => ({}) });
  try {
    const res = await executeTool("research_discover", { query: "x" }, { researchService: service });
    assert.equal(gatherCalled, false, "disabled service must not be queried");
    // Fallback path either returns a web_search note or a clean error — never an unknown-tool reply.
    assert.ok(!/Unknown tool/.test(res.content));
  } finally {
    globalThis.fetch = realFetch;
  }
});
