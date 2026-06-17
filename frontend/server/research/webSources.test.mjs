import test from "node:test";
import assert from "node:assert/strict";
import {
  canonicalUrl,
  dedupeWebSources,
  domainOf,
  rankWebSources,
  stableSourceHash,
  toWebSource,
  trustWeight
} from "./webSources.mjs";

test("canonicalUrl strips tracking params, hash, www, trailing slash, upgrades http", () => {
  assert.equal(
    canonicalUrl("http://www.Example.com/a/?utm_source=x&q=1#frag"),
    "https://example.com/a?q=1"
  );
  assert.equal(canonicalUrl("https://example.com/"), "https://example.com");
});

test("domainOf returns the registrable host without www", () => {
  assert.equal(domainOf("https://www.nature.com/articles/x"), "nature.com");
  assert.equal(domainOf("garbage"), "");
});

test("stableSourceHash is stable across irrelevant url noise", () => {
  const a = stableSourceHash({ provider: "tavily", url: "https://example.com/a?utm_source=x", title: "T" });
  const b = stableSourceHash({ provider: "tavily", url: "http://www.example.com/a/#y", title: "t" });
  assert.equal(a, b);
});

test("trustWeight maps known source types", () => {
  assert.equal(trustWeight("official"), 1.0);
  assert.equal(trustWeight("paper"), 0.95);
  assert.equal(trustWeight("blog"), 0.55);
  assert.equal(trustWeight("???"), 0.35);
});

test("toWebSource normalizes a provider result", () => {
  const s = toWebSource(
    { title: "Redis", url: "https://redis.io/docs", snippet: "sentinel", sourceType: "docs", score: 0.8, providerRank: 1 },
    { provider: "tavily", query: "redis", platform: "GENERAL_RESEARCH" }
  );
  assert.equal(s.kind, "web");
  assert.equal(s.provider, "tavily");
  assert.equal(s.canonicalUrl, "https://redis.io/docs");
  assert.equal(s.trustWeight, 0.9);
  assert.ok(s.hash.length === 12);
});

test("dedupeWebSources merges by canonical url and unions providers", () => {
  const a = toWebSource({ title: "X", url: "https://e.com/a?utm_source=z", snippet: "s" }, { provider: "tavily" });
  const b = toWebSource({ title: "X", url: "https://www.e.com/a/", snippet: "s" }, { provider: "serpapi" });
  const c = toWebSource({ title: "Y", url: "https://e.com/b", snippet: "s" }, { provider: "tavily" });
  const out = dedupeWebSources([a, b, c]);
  assert.equal(out.length, 2);
  const merged = out.find((s) => s.canonicalUrl === "https://e.com/a");
  assert.deepEqual(merged.providers.sort(), ["serpapi", "tavily"]);
});

test("rankWebSources favors high trust + gov boost and caps total", () => {
  const gov = toWebSource({ title: "G", url: "https://nasa.gov/x", content: "long content ".repeat(10), sourceType: "official" }, { provider: "tavily" });
  const blog = toWebSource({ title: "B", url: "https://blog.io/y", content: "long content ".repeat(10), sourceType: "blog" }, { provider: "tavily" });
  const ranked = rankWebSources(dedupeWebSources([blog, gov]), { maxSourcesTotal: 1 });
  assert.equal(ranked.length, 1);
  assert.equal(ranked[0].title, "G", "official .gov outranks blog");
  assert.ok(typeof ranked[0].score === "number");
});

test("rankWebSources keeps unsuitable links out of scientific web candidates", () => {
  const paper = toWebSource(
    { title: "Paper", url: "https://doi.org/10.1234/example", content: "long content ".repeat(10), sourceType: "paper" },
    { provider: "tavily" }
  );
  const reddit = toWebSource(
    { title: "Thread", url: "https://reddit.com/r/science/comments/1", content: "long content ".repeat(10), sourceType: "forum" },
    { provider: "tavily" }
  );
  const ranked = rankWebSources(dedupeWebSources([reddit, paper]), { maxSourcesTotal: 10 });

  assert.deepEqual(ranked.map((s) => s.title), ["Paper"]);
  assert.equal(ranked[0].citable, true);
  assert.equal(ranked[0].qualityTier, 1);
});
