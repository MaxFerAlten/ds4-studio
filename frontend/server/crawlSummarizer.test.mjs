import { test } from "node:test";
import assert from "node:assert/strict";
import { summarizeCrawlManifest } from "./crawlSummarizer.mjs";

test("forDisplay produces a clean human extract (no directive/critique, links+images stripped)", () => {
  const manifest = { pages: [{
    url: "https://a.test", state: "succeeded", title: "T",
    content: "See ![pic](https://img.test/x.png) and [LearnPrompting](https://learnprompting.org/blog) for papers."
  }] };
  const out = summarizeCrawlManifest(manifest, { forDisplay: true });
  assert.ok(!/Synthesize an answer/.test(out), "no model directive");
  assert.ok(!/↳ critique:/.test(out), "no critique line");
  assert.ok(!out.includes("https://img.test"), "image url stripped");
  assert.ok(!out.includes("https://learnprompting.org/blog"), "link url stripped");
  assert.match(out, /LearnPrompting/, "link text kept");
  assert.match(out, /URL: https:\/\/a\.test/, "page URL header kept");
});

test("forDisplay does not truncate and shows code blocks inline (no fence box)", () => {
  const big = "Sentence. ".repeat(500); // ~5000 chars, well over the agent cap
  const manifest = { pages: [{ url: "https://a.test", state: "succeeded",
    content: `${big}\n\`\`\`bibtex\n@article{x, title={DeepSeek-V2}}\n\`\`\`` }] };
  const out = summarizeCrawlManifest(manifest, { forDisplay: true });
  assert.ok(!/truncated \d+ chars/.test(out), "no truncation marker in display mode");
  assert.ok(out.includes(big.trim()), "full content kept");
  assert.ok(!out.includes("```"), "code fences stripped (no separate box)");
  assert.match(out, /@article\{x, title=\{DeepSeek-V2\}\}/, "bibtex kept inline as text");
});

test("default (agent) mode still emits the synthesis directive + critique", () => {
  const out = summarizeCrawlManifest({ pages: [{ url: "https://a.test", state: "succeeded", content: "x" }] });
  assert.match(out, /do not paste them back verbatim/i);
  assert.match(out, /↳ critique:/);
});

test("summary includes page metadata", () => {
  const out = summarizeCrawlManifest({
    pages: [{ url: "https://a.test", state: "succeeded", title: "A", content: "short body" }]
  });
  assert.match(out, /https:\/\/a\.test/);
  assert.match(out, /State: succeeded/);
  assert.match(out, /Title: A/);
  assert.match(out, /short body/);
});

test("summary truncates long content instead of dumping it raw", () => {
  const big = "x".repeat(50000);
  const out = summarizeCrawlManifest({ pages: [{ url: "https://a.test", state: "succeeded", content: big }] }, { maxCharsPerPage: 100 });
  assert.ok(out.length < big.length, "output must be smaller than raw content");
  assert.ok(!out.includes(big), "must not contain the full raw content");
  assert.match(out, /truncated \d+ chars/);
});

test("summary tells the agent to synthesize, not paste", () => {
  const out = summarizeCrawlManifest({ pages: [{ url: "https://a.test", state: "succeeded", content: "x" }] });
  assert.match(out, /do not paste them back verbatim/i);
});

test("summary caps the number of pages", () => {
  const pages = Array.from({ length: 30 }, (_, i) => ({ url: `https://a.test/${i}`, state: "succeeded", content: "x" }));
  const out = summarizeCrawlManifest({ pages }, { maxPages: 5 });
  assert.match(out, /showing first 5/);
  assert.ok(!out.includes("https://a.test/5"), "page 6 must be omitted");
});

test("summary tolerates a missing/empty manifest", () => {
  assert.match(summarizeCrawlManifest(null), /Crawled 0 pages/);
  assert.match(summarizeCrawlManifest({ pages: [] }), /Crawled 0 pages/);
});
