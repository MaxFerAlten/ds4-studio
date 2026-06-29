// E2E: non-agentic chat web search flow.
// Certifies the chain the UI drives when a user types `/web-search start`
// and then asks a question while Web Search Mode is on:
//
//   frontend command `/web-search start`  -> enables Web Search Mode
//   plain chat message (mode on)          -> POST /api/agent/web-search { query }
//   Node handler                          -> webSearch() -> Chrome via puppeteer-core
//   search results                        -> injected into the LLM prompt
//
// The headline failure this guards against (see ds4-conversation export
// 2026-06-26): web search results were pushed to the chat as `agentNotice`,
// which buildChatMessages drops from the prompt, so the model answered the news
// question with no web data and hallucinated. injectSearchResults fixes that.

import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { parseAgentInput } from "../src/utils.mjs";
import { buildChatMessages, injectSearchResults } from "../src/appLogic.mjs";

const CHROME_PATH = "/usr/bin/google-chrome";

// Verbatim copy of the real route (frontend/server/index.mjs:1261) so the test
// exercises the actual dynamic import + webSearch path.
function webSearchHandler() {
  return async (req, res) => {
    const { validateSearchQuery } = await import("./searchQueryGuard.mjs");
    const validation = validateSearchQuery(req.body?.query);

    if (!validation.ok) {
      return res.status(400).json({
        ok: false,
        error: "invalid search query",
        reason: validation.reason,
        query: validation.query
      });
    }

    try {
      const { webSearch } = await import("./webSearchTool.mjs");
      const result = await webSearch(validation.query);
      res.json({ ok: true, result, query: validation.query });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  };
}

async function withServer(body) {
  const app = express();
  app.use(express.json());
  app.post("/api/agent/web-search", webSearchHandler());
  const server = createServer(app);
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/agent/web-search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    return { status: res.status, json: await res.json().catch(() => null) };
  } finally {
    await new Promise((r) => server.close(r));
  }
}

// --- Stage 1: frontend command dispatch (deterministic) --------------------

test("`/web-search start` enables Web Search Mode", () => {
  const parsed = parseAgentInput("/web-search start", false);
  assert.deepEqual(parsed, { type: "webSearchMode", action: "set", enabled: true });
});

test("news question is a plain chat message (routed to web search when mode on)", () => {
  const parsed = parseAgentInput("cercami sul web le 10 news della giornata", false);
  assert.equal(parsed, null);
});

// --- Stage 2: search results actually reach the model (the real bug) -------

test("agentNotice search results are dropped from the prompt (the original bug)", () => {
  const messages = [
    { role: "user", content: "le 10 news della giornata" },
    { role: "assistant", content: "WEB_RESULTS", agentNotice: true }
  ];
  const prompt = buildChatMessages(messages, { system: "" });
  assert.ok(
    !prompt.some((m) => m.content?.includes("WEB_RESULTS")),
    "agentNotice results never reach the model — this is why the answer was hallucinated"
  );
});

test("injectSearchResults feeds the results into the user turn the model sees", () => {
  // Mirror sendMessage's array: user turn + trailing empty assistant placeholder.
  const nextMessages = [
    { role: "user", content: "cercami sul web le 10 news della giornata" },
    { role: "assistant", content: "", reasoning: "" }
  ];
  const searchResult =
    'web_search results for "le 10 news della giornata":\n\n1. Big headline today\n   URL: https://x';

  const prompt = buildChatMessages(
    injectSearchResults(nextMessages, searchResult),
    { system: "" }
  );
  const userMsg = prompt.find((m) => m.role === "user");
  assert.ok(userMsg, "user turn must reach the model");
  assert.match(userMsg.content, /Live web search results/);
  assert.match(userMsg.content, /do not invent/);
  assert.match(userMsg.content, /Big headline today/);
});

// --- Stage 2b: search query guard blocks reasoning before browser search ----

test("web search route rejects reasoning/metatext query before browser search", async () => {
  const { status, json } = await withServer({ query: "We need to understand what the user is asking" });

  assert.equal(status, 400);
  assert.equal(json.ok, false);
  assert.equal(json.error, "invalid search query");
  assert.match(json.reason, /reasoning|metatext/i);
});

// --- Stage 3: real Chrome launch via puppeteer-core (e2e) ------------------

test("news question launches Chrome via puppeteer-core", { timeout: 60000 }, async (t) => {
  if (!existsSync(CHROME_PATH)) {
    t.skip(`Chrome not installed at ${CHROME_PATH}`);
    return;
  }
  const { status, json } = await withServer({ query: "le 10 news della giornata" });

  // 200 + ok:true == getBrowser() returned a live browser == puppeteer-core
  // imported AND Chrome launched. A launch failure would be a 500.
  assert.equal(status, 200, `expected 200 (Chrome launched), got ${status}: ${json?.error}`);
  assert.equal(json.ok, true);
  assert.equal(typeof json.result, "string");

  // Real results, not the bot-block empty page. Google bot-blocks headless
  // traffic; the headful + persistent-profile browser (ported from ds4-agent)
  // is served normally. (Needs network; skip the content assert when offline.)
  if (/failed to search|net::ERR/i.test(json.result)) {
    t.skip(`network unavailable: ${json.result.slice(0, 80)}`);
    return;
  }
  // A news query must surface real dated headlines (Google News RSS), not just
  // the news-site homepages the Google SERP returns.
  assert.match(json.result, /# Recent news \(Google News/, "news query must return dated headlines");
  assert.match(json.result, /\n1\. .+\n   URL: https?:\/\//, "first headline must have a title + real URL");
  // The Google SERP block is still appended below the news.
  assert.match(json.result, /# Google search results/);
  assert.match(json.result, /## Visible links/);
});

// --- Stage 4: web_read / visit_page port (real Chrome) ---------------------

test("web_read renders a page as Markdown via visit_page port", { timeout: 60000 }, async (t) => {
  if (!existsSync(CHROME_PATH)) {
    t.skip(`Chrome not installed at ${CHROME_PATH}`);
    return;
  }
  const { webReadPage } = await import("./webSearchTool.mjs");
  const md = await webReadPage("https://example.com/");
  if (/failed to read|net::ERR/i.test(md)) {
    t.skip(`network unavailable: ${md.slice(0, 80)}`);
    return;
  }
  assert.match(md, /^# /, "must start with a Markdown title heading");
  assert.match(md, /URL: https?:\/\/example\.com/);
  assert.match(md, /## Content/);
  assert.match(md, /Example Domain/, "must contain the page's visible text");
});

