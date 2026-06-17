import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ResearchSearchService, buildSearchService } from "./researchSearchService.mjs";
import { RESEARCH_DEFAULTS } from "./researchConfig.mjs";
import { SourceCache } from "./sourceCache.mjs";
import { RateLimiter } from "./rateLimiter.mjs";

function fakeProvider(name, { results = [], configured = true, fail = false } = {}) {
  return {
    name: () => name,
    supports: () => ["GENERAL_RESEARCH"],
    isConfigured: () => configured,
    calls: 0,
    async search(query) {
      this.calls += 1;
      if (fail) throw new Error(`${name} boom`);
      return { provider: name, query, results, warnings: [] };
    }
  };
}

const searchCfg = (over = {}) => ({ ...RESEARCH_DEFAULTS.search, enabled: true, retryDelayMs: 0, enablePageReader: false, ...over });

test("availableProviders lists only configured ones", () => {
  const svc = new ResearchSearchService({
    config: searchCfg(),
    providers: { a: fakeProvider("a"), b: fakeProvider("b", { configured: false }) }
  });
  assert.deepEqual(svc.availableProviders(), ["a"]);
});

test("gather returns ranked web sources from a provider", async () => {
  const wiki = fakeProvider("wikipedia", {
    results: [{ title: "Redis", url: "https://en.wikipedia.org/wiki/Redis", snippet: "store", sourceType: "encyclopedia", content: "Redis is an in-memory store ".repeat(5) }]
  });
  const svc = new ResearchSearchService({
    config: searchCfg(),
    providers: { wikipedia: wiki },
    selectPlatformFn: () => ({ agentType: "ENCYCLOPEDIA", provider: "wikipedia", chain: ["wikipedia"] })
  });
  const out = await svc.gather(["redis"]);
  assert.equal(out.length, 1);
  assert.equal(out[0].provider, "wikipedia");
  assert.equal(out[0].kind, "web");
  assert.ok(typeof out[0].score === "number");
});

test("gather falls back to the next provider when the first fails", async () => {
  const primary = fakeProvider("tavily", { fail: true });
  const fallback = fakeProvider("wikipedia", {
    results: [{ title: "X", url: "https://e.com/x", content: "long ".repeat(40), sourceType: "encyclopedia" }]
  });
  const svc = new ResearchSearchService({
    config: searchCfg(),
    providers: { tavily: primary, wikipedia: fallback },
    selectPlatformFn: () => ({ agentType: "GENERAL_RESEARCH", provider: "tavily", chain: ["tavily", "wikipedia"] })
  });
  const out = await svc.gather(["q"]);
  assert.equal(primary.calls, 3, "primary retried retryCount+1 times before fallback");
  assert.ok(fallback.calls >= 1);
  assert.equal(out[0].provider, "wikipedia");
});

test("gather dedupes identical urls across queries", async () => {
  const p = fakeProvider("wikipedia", {
    results: [{ title: "Redis", url: "https://e.com/redis", content: "x".repeat(700), sourceType: "encyclopedia" }]
  });
  const svc = new ResearchSearchService({
    config: searchCfg(),
    providers: { wikipedia: p },
    selectPlatformFn: () => ({ agentType: "ENCYCLOPEDIA", provider: "wikipedia", chain: ["wikipedia"] })
  });
  const out = await svc.gather(["redis", "redis db"]);
  assert.equal(out.length, 1, "same url from two queries collapses");
});

test("gather emits lifecycle events", async () => {
  const p = fakeProvider("wikipedia", {
    results: [{ title: "X", url: "https://e.com/x", content: "x".repeat(700), sourceType: "encyclopedia" }]
  });
  const svc = new ResearchSearchService({
    config: searchCfg(),
    providers: { wikipedia: p },
    selectPlatformFn: () => ({ agentType: "ENCYCLOPEDIA", provider: "wikipedia", chain: ["wikipedia"] })
  });
  const events = [];
  await svc.gather(["q"], { emit: (type, data) => events.push({ type, data }) });
  const types = events.map((e) => e.type);
  assert.ok(types.includes("search_started"));
  assert.ok(types.includes("search_platform_selected"));
  assert.ok(types.includes("search_completed"));
});

test("gather enriches thin sources via the page reader", async () => {
  const p = fakeProvider("tavily", {
    results: [{ title: "X", url: "https://e.com/x", snippet: "tiny", content: "tiny", sourceType: "news" }]
  });
  const svc = new ResearchSearchService({
    config: searchCfg({ enablePageReader: true, enableDirectFetchFallback: true, maxFetchedPages: 5 }),
    providers: { tavily: p },
    fetchImpl: async () => new Response("<p>full article body here</p>", { status: 200, headers: { "Content-Type": "text/html" } }),
    selectPlatformFn: () => ({ agentType: "GENERAL_RESEARCH", provider: "tavily", chain: ["tavily"] })
  });
  const events = [];
  const out = await svc.gather(["q"], { emit: (t, d) => events.push({ t, d }) });
  assert.match(out[0].content, /full article body here/);
  assert.ok(events.some((e) => e.t === "source_enriched"));
});

test("gather returns [] when search disabled", async () => {
  const svc = new ResearchSearchService({ config: searchCfg({ enabled: false }), providers: { a: fakeProvider("a") } });
  assert.deepEqual(await svc.gather(["q"]), []);
});

test("buildSearchService wires public providers and skips keyless tavily", () => {
  const svc = buildSearchService(
    { ...RESEARCH_DEFAULTS.search, enabled: true, providers: { ...RESEARCH_DEFAULTS.search.providers, tavily: { enabled: true, apiKeyEnv: "TAVILY_API_KEY" } } },
    { fetchImpl: async () => new Response("{}"), env: {}, logger: { warn: () => {} } }
  );
  const avail = svc.availableProviders();
  assert.ok(avail.includes("wikipedia"));
  assert.ok(avail.includes("openalex"));
  assert.ok(!avail.includes("tavily"), "tavily without key is skipped");
});

test("buildSearchService enables tavily when key present", () => {
  const svc = buildSearchService(
    { ...RESEARCH_DEFAULTS.search, enabled: true, providers: { ...RESEARCH_DEFAULTS.search.providers, tavily: { enabled: true, apiKeyEnv: "TAVILY_API_KEY" } } },
    { fetchImpl: async () => new Response("{}"), env: { TAVILY_API_KEY: "k" } }
  );
  assert.ok(svc.availableProviders().includes("tavily"));
});

test("buildSearchService enables keyed providers from direct config apiKey", () => {
  const svc = buildSearchService(
    {
      ...RESEARCH_DEFAULTS.search,
      enabled: true,
      providers: {
        ...RESEARCH_DEFAULTS.search.providers,
        tavily: {
          enabled: true,
          apiKey: "direct-key",
          apiKeyEnv: "TAVILY_API_KEY"
        }
      }
    },
    { fetchImpl: async () => new Response("{}"), env: {} }
  );
  assert.ok(svc.availableProviders().includes("tavily"));
});

test("a cache hit skips the provider call", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ds4-svc-cache-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const cache = new SourceCache({ dir, defaultTtlMs: 100000 });
  let calls = 0;
  let acquisitions = 0;
  const rateLimiter = {
    async acquire() {
      acquisitions += 1;
      return () => {};
    }
  };
  const provider = {
    name: () => "wikipedia",
    isConfigured: () => true,
    supports: () => ["ENCYCLOPEDIA"],
    async search(query) {
      calls += 1;
      return {
        provider: "wikipedia",
        query,
        results: [
          {
            title: "X",
            url: "https://e.com/x",
            content: "c".repeat(700),
            sourceType: "encyclopedia"
          }
        ],
        warnings: []
      };
    }
  };
  const svc = new ResearchSearchService({
    config: searchCfg(),
    providers: { wikipedia: provider },
    cache,
    rateLimiter,
    selectPlatformFn: () => ({
      agentType: "ENCYCLOPEDIA",
      provider: "wikipedia",
      chain: ["wikipedia"]
    })
  });
  await svc.gather(["redis"]);
  await svc.gather(["redis"]);
  assert.equal(calls, 1, "second identical query served from cache");
  assert.equal(acquisitions, 1, "cache hit happens before the rate limiter");
});

test("rate limiter gates provider calls without dropping results", async () => {
  const rateLimiter = new RateLimiter({
    default: { perMinute: 1000, concurrent: 1 }
  });
  const acquire = rateLimiter.acquire.bind(rateLimiter);
  let acquisitions = 0;
  let releases = 0;
  rateLimiter.acquire = async (name) => {
    acquisitions += 1;
    const release = await acquire(name);
    return () => {
      releases += 1;
      release();
    };
  };
  const provider = {
    name: () => "wikipedia",
    isConfigured: () => true,
    supports: () => ["ENCYCLOPEDIA"],
    async search(query) {
      return {
        provider: "wikipedia",
        query,
        results: [
          {
            title: "X",
            url: `https://e.com/${query}`,
            content: "c".repeat(700),
            sourceType: "encyclopedia"
          }
        ],
        warnings: []
      };
    }
  };
  const svc = new ResearchSearchService({
    config: searchCfg(),
    providers: { wikipedia: provider },
    rateLimiter,
    selectPlatformFn: () => ({
      agentType: "ENCYCLOPEDIA",
      provider: "wikipedia",
      chain: ["wikipedia"]
    })
  });
  const out = await svc.gather(["a", "b"]);
  assert.equal(out.length, 2);
  assert.equal(acquisitions, 2);
  assert.equal(releases, 2);
});

test("buildSearchService registers the Phase 2c providers", () => {
  const searchConfig = {
    ...RESEARCH_DEFAULTS.search,
    enabled: true,
    providers: {
      ...RESEARCH_DEFAULTS.search.providers,
      serpapi: {
        enabled: true,
        apiKeyEnv: "SERPAPI_KEY",
        engine: "google"
      },
      googlescholar: { enabled: true, apiKeyEnv: "SERPAPI_KEY" },
      opentripmap: {
        enabled: true,
        apiKeyEnv: "OPENTRIPMAP_API_KEY"
      },
      tripadvisor: {
        enabled: true,
        apiKeyEnv: "TRIPADVISOR_API_KEY",
        endpoint: "https://tripadvisor.example/search"
      },
      aliyun: {
        enabled: true,
        apiKeyEnv: "ALIYUN_AI_SEARCH_API_KEY",
        endpoint: "https://aliyun.example/search"
      },
      baidu: {
        enabled: true,
        apiKeyEnv: "BAIDU_SEARCH_API_KEY",
        endpoint: "https://baidu.example/search"
      }
    }
  };
  const svc = buildSearchService(searchConfig, {
    fetchImpl: async () => new Response("{}"),
    env: {
      SERPAPI_KEY: "k",
      OPENTRIPMAP_API_KEY: "k2",
      TRIPADVISOR_API_KEY: "k3",
      ALIYUN_AI_SEARCH_API_KEY: "k4",
      BAIDU_SEARCH_API_KEY: "k5"
    }
  });
  const available = svc.availableProviders();
  assert.ok(available.includes("worldbank"), "worldbank is public");
  assert.ok(available.includes("serpapi"));
  assert.ok(available.includes("googlescholar"));
  assert.ok(available.includes("opentripmap"));
  assert.ok(available.includes("tripadvisor"));
  assert.ok(available.includes("aliyun"));
  assert.ok(available.includes("baidu"));
});

test("buildSearchService skips an enabled provider missing endpoint configuration", () => {
  const warnings = [];
  const searchConfig = {
    ...RESEARCH_DEFAULTS.search,
    enabled: true,
    providers: {
      ...RESEARCH_DEFAULTS.search.providers,
      tripadvisor: {
        enabled: true,
        apiKeyEnv: "TRIPADVISOR_API_KEY",
        endpoint: ""
      }
    }
  };
  const svc = buildSearchService(searchConfig, {
    fetchImpl: async () => new Response("{}"),
    env: { TRIPADVISOR_API_KEY: "k" },
    logger: { warn: (message) => warnings.push(message) }
  });
  assert.equal(svc.availableProviders().includes("tripadvisor"), false);
  assert.ok(warnings.some((message) => message.includes("tripadvisor")));
});
