import { test } from "node:test";
import assert from "node:assert/strict";
import { searchChatHistory, formatHistoryResults } from "./historyTool.mjs";
import { executeTool } from "./agentTools.mjs";
import { AGENT_TOOLS } from "./agentSession.mjs";

const convo = [
  { role: "user", content: "find AI conferences" },
  { role: "assistant", content: "LINK_FOUND_NOT_OPENED: http://aideadlines.org/ and https://mi-research.net/news/712" },
  { role: "tool", tool_call_id: "1", content: "search result: NeurIPS acceptance rate 26%" },
  { role: "assistant", content: "ICML ranks tier 1 with a 21% acceptance rate." }
];

test("links kind recovers prior links, deduped", () => {
  const rows = searchChatHistory(convo, { kind: "links" });
  const urls = rows.map((r) => r.url);
  assert.deepEqual(urls, ["http://aideadlines.org/", "https://mi-research.net/news/712"]);
  assert.ok(rows.every((r) => r.kind === "link"));
});

test("pending_actions kind finds LINK_FOUND_NOT_OPENED messages", () => {
  const rows = searchChatHistory(convo, { kind: "pending_actions" });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].kind, "pending_action");
});

test("tool_results kind returns tool messages, filtered by query", () => {
  assert.equal(searchChatHistory(convo, { kind: "tool_results" }).length, 1);
  assert.equal(searchChatHistory(convo, { kind: "tool_results", query: "neurips" }).length, 1);
  assert.equal(searchChatHistory(convo, { kind: "tool_results", query: "nothing" }).length, 0);
});

test("claims kind extracts claim-like sentences from assistant turns", () => {
  const rows = searchChatHistory(convo, { kind: "claims" });
  assert.ok(rows.some((r) => /21% acceptance/.test(r.text)));
});

test("maxResults caps output", () => {
  const many = Array.from({ length: 20 }, (_, i) => ({ role: "assistant", content: `link http://x.test/${i}` }));
  assert.equal(searchChatHistory(many, { kind: "links", maxResults: 5 }).length, 5);
});

test("chat_history_search is registered and executeTool routes it over opts.history", async () => {
  assert.ok(AGENT_TOOLS.find((t) => t.function?.name === "chat_history_search"), "tool must be registered");
  const res = await executeTool("chat_history_search", { kind: "links" }, { history: convo });
  assert.equal(res.isError, false);
  assert.ok(!/Unknown tool/.test(res.content));
  assert.match(res.content, /aideadlines\.org/);
});

test("formatHistoryResults renders links and a no-match message", () => {
  const out = formatHistoryResults(searchChatHistory(convo, { kind: "links" }));
  assert.match(out, /\[link\].*aideadlines\.org/);
  assert.match(formatHistoryResults([], { query: "zzz" }), /No matching chat history for "zzz"/);
});
