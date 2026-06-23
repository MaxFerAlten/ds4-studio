import test from "node:test";
import assert from "node:assert/strict";
import { AliyunProvider, BaiduProvider } from "./providers.mjs";

function json(body) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}

test("aliyun/baidu need key + endpoint to be configured", () => {
  assert.equal(new AliyunProvider({ apiKey: "k" }).isConfigured(), false);
  assert.equal(
    new AliyunProvider({
      apiKey: "k",
      config: { endpoint: "https://x" }
    }).isConfigured(),
    true
  );
  assert.equal(
    new BaiduProvider({ config: { endpoint: "https://x" } }).isConfigured(),
    false
  );
});

test("aliyun posts the query and normalizes a results array", async () => {
  let captured;
  const provider = new AliyunProvider({
    apiKey: "k",
    config: { endpoint: "https://ali/search" },
    fetchImpl: async (url, opts) => {
      captured = {
        url,
        method: opts.method,
        auth: opts.headers.Authorization,
        body: JSON.parse(opts.body)
      };
      return json({
        results: [
          { title: "T", url: "https://e.com", snippet: "s" }
        ]
      });
    }
  });
  const out = await provider.search("redis", { maxResults: 3 });
  assert.equal(captured.url, "https://ali/search");
  assert.equal(captured.method, "POST");
  assert.equal(captured.auth, "Bearer k");
  assert.deepEqual(captured.body, { query: "redis", top_k: 3 });
  assert.equal(out.results[0].provider, "aliyun");
  assert.equal(out.results[0].url, "https://e.com");
});

test("baidu reads a data array and tolerates missing fields", async () => {
  let captured;
  const provider = new BaiduProvider({
    apiKey: "k",
    config: { endpoint: "https://baidu/search" },
    fetchImpl: async (url, opts) => {
      captured = {
        url,
        method: opts.method,
        auth: opts.headers.Authorization,
        body: JSON.parse(opts.body)
      };
      return json({
        data: [
          { title: "B", link: "https://b.cn", abstract: "ab" }
        ]
      });
    }
  });
  const out = await provider.search("query", { maxResults: 4 });
  assert.equal(captured.url, "https://baidu/search");
  assert.equal(captured.method, "POST");
  assert.equal(captured.auth, "Bearer k");
  assert.deepEqual(captured.body, { query: "query", num: 4 });
  assert.equal(out.results[0].provider, "baidu");
  assert.equal(out.results[0].url, "https://b.cn");
  assert.match(out.results[0].snippet, /ab/);
});
