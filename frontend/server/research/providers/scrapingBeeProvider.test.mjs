import test from "node:test";
import assert from "node:assert/strict";
import { ScrapingBeeProvider } from "./scrapingBeeProvider.mjs";

function jsonRes(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

test("scrapingbee requires an API key", () => {
  const p = new ScrapingBeeProvider({});
  assert.equal(p.name(), "scrapingbee");
  assert.equal(p.requiresApiKey(), true);
  assert.equal(p.isConfigured(), false);
  const p2 = new ScrapingBeeProvider({ apiKey: "k" });
  assert.equal(p2.isConfigured(), true);
});

test("scrapingbee builds the Google endpoint and maps organic results", async () => {
  let calledUrl = null;
  const provider = new ScrapingBeeProvider({
    apiKey: "SECRET",
    fetchImpl: async (url) => {
      calledUrl = url;
      return jsonRes({
        organic_results: [
          { url: "https://a.com", title: "A", description: "desc a", position: 1 },
          { url: "https://b.com", displayed_url: "b.com", description: "desc b", position: 2 },
          { title: "no url - dropped" }
        ]
      });
    }
  });
  const out = await provider.search("quantum llm", { maxResults: 5 });
  assert.match(calledUrl, /app\.scrapingbee\.com\/api\/v1\/store\/google/);
  assert.match(calledUrl, /search=quantum%20llm/);
  assert.match(calledUrl, /nb_results=5/);
  assert.match(calledUrl, /api_key=SECRET/);
  assert.equal(out.provider, "scrapingbee");
  assert.equal(out.results.length, 2); // url-less result dropped
  assert.deepEqual(
    out.results[0],
    {
      provider: "scrapingbee",
      platform: "GENERAL_RESEARCH",
      sourceType: "unknown",
      title: "A",
      url: "https://a.com",
      snippet: "desc a",
      content: "desc a",
      providerRank: 1,
      raw: {}
    }
  );
  assert.equal(out.results[1].title, "b.com"); // falls back to displayed_url
});

test("scrapingbee throws on HTTP error and missing key", async () => {
  const provider = new ScrapingBeeProvider({ apiKey: "k", fetchImpl: async () => jsonRes({}, 401) });
  await assert.rejects(() => provider.search("x"), /HTTP 401/);
  const noKey = new ScrapingBeeProvider({});
  await assert.rejects(() => noKey.search("x"), /missing API key/);
});
