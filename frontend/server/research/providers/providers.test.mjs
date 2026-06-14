import test from "node:test";
import assert from "node:assert/strict";
import { WikipediaProvider } from "./wikipediaProvider.mjs";
import { OpenAlexProvider, abstractInvertedIndexToText } from "./openAlexProvider.mjs";
import { TavilyProvider } from "./tavilyProvider.mjs";
import { JinaReaderProvider } from "./jinaReaderProvider.mjs";

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

test("wikipedia: searches titles then enriches with REST summary", async () => {
  const calls = [];
  const provider = new WikipediaProvider({
    fetchImpl: async (url) => {
      calls.push(url);
      if (url.includes("list=search")) {
        return json({ query: { search: [{ title: "Redis", pageid: 1, snippet: "<b>in-memory</b> store" }] } });
      }
      return json({ extract: "Redis is an in-memory data structure store." });
    }
  });
  const out = await provider.search("redis", { maxResults: 1 });
  assert.equal(out.provider, "wikipedia");
  assert.equal(out.results.length, 1);
  assert.equal(out.results[0].sourceType, "encyclopedia");
  assert.match(out.results[0].content, /in-memory data structure store/);
  assert.match(out.results[0].url, /en\.wikipedia\.org\/wiki\/Redis/);
  assert.ok(calls.some((u) => u.includes("rest_v1/page/summary")));
});

test("wikipedia: survives a failing summary fetch with a warning", async () => {
  const provider = new WikipediaProvider({
    fetchImpl: async (url) => {
      if (url.includes("list=search")) {
        return json({ query: { search: [{ title: "X", pageid: 2, snippet: "snip" }] } });
      }
      return new Response("err", { status: 500 });
    }
  });
  const out = await provider.search("x", { maxResults: 1 });
  assert.equal(out.results.length, 1);
  assert.equal(out.results[0].content, "snip");
});

test("openalex: converts the inverted index abstract", () => {
  assert.equal(
    abstractInvertedIndexToText({ Redis: [0], is: [1], fast: [2] }),
    "Redis is fast"
  );
  assert.equal(abstractInvertedIndexToText(null), "");
});

test("openalex: maps works to paper sources", async () => {
  const provider = new OpenAlexProvider({
    fetchImpl: async () =>
      json({
        results: [
          {
            title: "Quantum decoding",
            doi: "https://doi.org/10.1/x",
            abstract_inverted_index: { quantum: [0], decoding: [1] },
            publication_date: "2025-01-01",
            relevance_score: 12.3,
            cited_by_count: 5
          }
        ]
      })
  });
  const out = await provider.search("quantum decoding", { maxResults: 1 });
  assert.equal(out.results[0].sourceType, "paper");
  assert.equal(out.results[0].url, "https://doi.org/10.1/x");
  assert.match(out.results[0].content, /quantum decoding/);
  assert.equal(out.results[0].raw.citedByCount, 5);
});

test("tavily: requires a key and normalizes results", async () => {
  const noKey = new TavilyProvider({ fetchImpl: async () => json({}) });
  assert.equal(noKey.isConfigured(), false);
  await assert.rejects(() => noKey.search("x"), /missing API key/);

  let captured;
  const provider = new TavilyProvider({
    apiKey: "k",
    fetchImpl: async (url, opts) => {
      captured = { url, body: JSON.parse(opts.body) };
      return json({ results: [{ title: "T", url: "https://e.com/a", content: "snippet", score: 0.9 }] });
    }
  });
  assert.equal(provider.isConfigured(), true);
  const out = await provider.search("redis", { maxResults: 3 });
  assert.equal(captured.url, "https://api.tavily.com/search");
  assert.equal(captured.body.api_key, "k");
  assert.equal(out.results[0].url, "https://e.com/a");
  assert.equal(out.results[0].provider, "tavily");
});

test("jina reader: reads a page and blocks SSRF targets", async () => {
  const provider = new JinaReaderProvider({
    apiKey: "k",
    fetchImpl: async (url, opts) => {
      assert.match(url, /^https:\/\/r\.jina\.ai\//);
      assert.equal(opts.headers.Authorization, "Bearer k");
      return new Response("clean page text", { status: 200 });
    }
  });
  const out = await provider.read("https://example.com/article");
  assert.equal(out.contentSource, "jina");
  assert.match(out.content, /clean page text/);

  await assert.rejects(() => provider.read("http://169.254.169.254/"), /SSRF blocked/);
});
