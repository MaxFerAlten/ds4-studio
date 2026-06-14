import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildSearchService } from "./researchSearchService.mjs";
import { RESEARCH_DEFAULTS } from "./researchConfig.mjs";

function json(body) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}

function routeFetch(counter) {
  return async (url) => {
    counter.calls = (counter.calls || 0) + 1;
    if (url.includes("serpapi.com")) {
      const engine = /engine=google_scholar/.test(url) ? "scholar" : "google";
      return json({
        organic_results: [
          {
            position: 1,
            title: `serp ${engine}`,
            link: `https://e.com/${engine}`,
            snippet: "x",
            publication_info: { summary: "A, 2024" }
          }
        ]
      });
    }
    if (url.includes("api.worldbank.org")) {
      return json([
        { total: 1 },
        [
          {
            indicator: { value: "Population" },
            country: { value: "Italy" },
            date: "2023",
            value: 5
          }
        ]
      ]);
    }
    if (url.includes("opentripmap")) {
      if (url.includes("/geoname")) {
        return json({ name: "Rome", lat: 41.9, lon: 12.5 });
      }
      return json({
        features: [
          {
            properties: {
              xid: "X1",
              name: "Colosseum",
              kinds: "historic"
            },
            geometry: { coordinates: [12.5, 41.9] }
          }
        ]
      });
    }
    return json({});
  };
}

function svcWith(extraProviders, env, counter) {
  const searchConfig = {
    ...RESEARCH_DEFAULTS.search,
    enabled: true,
    enablePageReader: false,
    cache: { ...RESEARCH_DEFAULTS.search.cache, enabled: false },
    providers: {
      ...RESEARCH_DEFAULTS.search.providers,
      ...extraProviders
    }
  };
  return buildSearchService(searchConfig, {
    fetchImpl: routeFetch(counter),
    env,
    logger: { warn: () => {} }
  });
}

test("CERT 1: serpapi and google scholar produce sources", async () => {
  const counter = {};
  const svc = svcWith(
    {
      openalex: { enabled: false },
      serpapi: {
        enabled: true,
        apiKeyEnv: "SERPAPI_KEY",
        engine: "google"
      },
      googlescholar: { enabled: true, apiKeyEnv: "SERPAPI_KEY" }
    },
    { SERPAPI_KEY: "k" },
    counter
  );
  const general = await svc.gather(["redis architecture"]);
  const academic = await svc.gather(["papers on arxiv preprint"]);
  assert.ok(general.some((source) => source.provider === "serpapi"));
  assert.ok(academic.some((source) => source.provider === "googlescholar"));
});

test("CERT 2: worldbank yields a dataset source for a data query", async () => {
  const counter = {};
  const svc = svcWith({}, {}, counter);
  const out = await svc.gather(["italy population world bank"]);
  assert.ok(out.some((source) => source.sourceType === "dataset"));
});

test("CERT 3: opentripmap geocodes and lists places", async () => {
  const counter = {};
  const svc = svcWith(
    {
      opentripmap: {
        enabled: true,
        apiKeyEnv: "OPENTRIPMAP_API_KEY"
      }
    },
    { OPENTRIPMAP_API_KEY: "k" },
    counter
  );
  const out = await svc.gather(["attractions in Rome"]);
  assert.ok(out.some((source) => source.sourceType === "travel"));
});

test("CERT 4: tripadvisor stays disabled without key and endpoint", () => {
  const counter = {};
  const svc = svcWith(
    {
      tripadvisor: {
        enabled: true,
        apiKeyEnv: "TRIPADVISOR_API_KEY",
        endpoint: ""
      }
    },
    {},
    counter
  );
  assert.equal(svc.availableProviders().includes("tripadvisor"), false);
  assert.equal(counter.calls || 0, 0);
});

test("CERT 5: cache short-circuits a repeated query", async (t) => {
  const counter = {};
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ds4-cert-cache-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const searchConfig = {
    ...RESEARCH_DEFAULTS.search,
    enabled: true,
    enablePageReader: false,
    cache: {
      ...RESEARCH_DEFAULTS.search.cache,
      enabled: true,
      dir
    },
    providers: { ...RESEARCH_DEFAULTS.search.providers }
  };
  const svc = buildSearchService(searchConfig, {
    fetchImpl: routeFetch(counter),
    env: {},
    logger: { warn: () => {} }
  });
  await svc.gather(["italy population world bank"]);
  const afterFirst = counter.calls;
  await svc.gather(["italy population world bank"]);
  assert.equal(
    counter.calls,
    afterFirst,
    "second identical query hits cache without a new fetch"
  );
});

test("CERT 6: all Phase 2c providers default to safe states", () => {
  const providers = RESEARCH_DEFAULTS.search.providers;
  assert.equal(providers.worldbank.enabled, true);
  for (const name of [
    "serpapi",
    "googlescholar",
    "opentripmap",
    "tripadvisor",
    "aliyun",
    "baidu"
  ]) {
    assert.equal(providers[name].enabled, false, `${name} must default OFF`);
  }
});
