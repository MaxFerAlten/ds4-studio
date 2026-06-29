import { test } from "node:test";
import assert from "node:assert/strict";
import { executeTool } from "./agentTools.mjs";
import { AGENT_TOOLS } from "./agentSession.mjs";

test("crawl is a registered agent tool so the model can act instead of asking the user", () => {
  const crawl = AGENT_TOOLS.find((t) => t.function?.name === "crawl");
  assert.ok(crawl, "AGENT_TOOLS must include a crawl tool");
  assert.match(crawl.function.description, /rather than telling the user/i);
});

test("executeTool routes crawl and returns summarized (not raw) content", async () => {
  const big = "y".repeat(50000);
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const body = url.endsWith("/jobs")
      ? { job_id: "job-1" }
      : { state: "succeeded", result_manifest: { pages: [{ url: "https://a.test", state: "succeeded", content: big }] } };
    return { ok: true, status: 200, text: async () => JSON.stringify(body) };
  };
  try {
    const res = await executeTool("crawl", { url: "https://a.test" }, { crawlBaseUrl: "http://crawl" });
    assert.equal(res.isError, false);
    assert.ok(!/Unknown tool/.test(res.content), "crawl must be routed, not reported unknown");
    assert.ok(res.content.length < big.length, "must summarize, not dump raw page content");
    assert.match(res.content, /do not paste them back verbatim/i);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("executeTool crawl reports a clear error when the service is not configured", async () => {
  const res = await executeTool("crawl", { url: "https://a.test" }, {});
  assert.equal(res.isError, true);
  assert.match(res.content, /not configured/i);
});
