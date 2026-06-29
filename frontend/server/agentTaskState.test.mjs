import { test } from "node:test";
import assert from "node:assert/strict";
import { extractUrls, unresolvedLinks, createTaskState } from "./agentTaskState.mjs";

test("extractUrls finds urls, strips trailing punctuation, dedups", () => {
  const urls = extractUrls("see http://aideadlines.org/ and (https://mi-research.net/news/712). also http://aideadlines.org/");
  assert.deepEqual(urls, ["http://aideadlines.org/", "https://mi-research.net/news/712"]);
});

test("extractUrls returns [] for empty/non-string", () => {
  assert.deepEqual(extractUrls(""), []);
  assert.deepEqual(extractUrls(null), []);
});

test("unresolvedLinks collects links the assistant surfaced", () => {
  const messages = [
    { role: "user", content: "find conferences" },
    { role: "assistant", content: "LINK_FOUND_NOT_OPENED: http://aideadlines.org/ and https://mi-research.net/news/712" }
  ];
  assert.deepEqual(unresolvedLinks(messages), [
    { url: "http://aideadlines.org/" },
    { url: "https://mi-research.net/news/712" }
  ]);
});

test("unresolvedLinks excludes links already opened via a crawl/web_read tool call", () => {
  const messages = [
    { role: "assistant", content: "links: http://a.test/ http://b.test/" },
    {
      role: "assistant",
      content: null,
      tool_calls: [{ id: "1", type: "function", function: { name: "crawl", arguments: JSON.stringify({ url: "http://a.test/" }) } }]
    }
  ];
  assert.deepEqual(unresolvedLinks(messages), [{ url: "http://b.test/" }]);
});

test("unresolvedLinks ignores raw tool-result dumps", () => {
  const messages = [
    { role: "tool", tool_call_id: "1", content: "noise http://tracker.test/pixel.gif more http://ads.test/x" },
    { role: "assistant", content: "real link http://wanted.test/" }
  ];
  assert.deepEqual(unresolvedLinks(messages), [{ url: "http://wanted.test/" }]);
});

test("createTaskState exposes unresolvedLinks bound to its messages", () => {
  const ts = createTaskState([{ role: "assistant", content: "http://x.test/" }]);
  assert.deepEqual(ts.unresolvedLinks(), [{ url: "http://x.test/" }]);
});
