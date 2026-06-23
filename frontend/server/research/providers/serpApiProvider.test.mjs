import test from "node:test";
import assert from "node:assert/strict";
import { SerpApiProvider } from "./providers.mjs";

function json(body) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}

test("serpapi requires a key", () => {
  assert.equal(
    new SerpApiProvider({ fetchImpl: async () => json({}) }).isConfigured(),
    false
  );
});

test("serpapi (google) normalizes organic_results", async () => {
  let captured;
  const provider = new SerpApiProvider({
    apiKey: "k",
    config: { engine: "google" },
    fetchImpl: async (url) => {
      captured = url;
      return json({
        organic_results: [
          {
            position: 1,
            title: "Redis",
            link: "https://redis.io",
            snippet: "store",
            displayed_link: "redis.io"
          }
        ]
      });
    }
  });
  const out = await provider.search("redis", { maxResults: 5 });
  assert.match(captured, /engine=google&/);
  assert.match(captured, /api_key=k/);
  assert.equal(out.results[0].url, "https://redis.io");
  assert.equal(out.results[0].provider, "serpapi");
  assert.equal(out.results[0].providerRank, 1);
});

test("google scholar engine maps publication_info into content", async () => {
  let captured;
  const provider = new SerpApiProvider({
    apiKey: "k",
    config: { engine: "google_scholar" },
    name: "googlescholar",
    fetchImpl: async (url) => {
      captured = url;
      return json({
        organic_results: [
          {
            title: "Paper",
            link: "https://x/p",
            snippet: "abstract",
            publication_info: { summary: "J. Smith, 2024" }
          }
        ]
      });
    }
  });
  const out = await provider.search("decoding", { maxResults: 3 });
  assert.match(captured, /engine=google_scholar/);
  assert.equal(out.results[0].sourceType, "paper");
  assert.match(out.results[0].content, /J\. Smith, 2024/);
  assert.equal(out.provider, "googlescholar");
});
