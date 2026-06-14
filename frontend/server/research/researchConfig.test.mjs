import test from "node:test";
import assert from "node:assert/strict";
import { mergeResearchConfig, validateResearchConfig } from "./researchConfig.mjs";

test("mergeResearchConfig fills defaults for empty input", () => {
  assert.deepEqual(mergeResearchConfig(), {
    enabled: false,
    maxPlanIterations: 3,
    autoAcceptPlan: false,
    stateDir: "data/research",
    ragEnabled: true,
    searchEnabled: false,
    webFetchEnabled: false,
    researcherCount: 3,
    maxSteps: 12,
    maxSourcesPerQuery: 8,
    maxContextChars: 120000,
    exportEnabled: true,
    reflection: { enabled: true, maxAttempts: 2 },
    search: {
      enabled: false,
      maxResultsPerQuery: 8,
      maxSourcesTotal: 30,
      maxFetchedPages: 8,
      maxCharsPerPage: 12000,
      timeoutMs: 12000,
      retryCount: 2,
      retryDelayMs: 500,
      enablePageReader: true,
      enableDirectFetchFallback: true,
      providers: {
        wikipedia: { enabled: true },
        openalex: { enabled: true },
        worldbank: { enabled: true },
        tavily: { enabled: false, apiKeyEnv: "TAVILY_API_KEY" },
        serpapi: { enabled: false, apiKeyEnv: "SERPAPI_KEY", engine: "google" },
        googlescholar: { enabled: false, apiKeyEnv: "SERPAPI_KEY" },
        opentripmap: { enabled: false, apiKeyEnv: "OPENTRIPMAP_API_KEY" },
        tripadvisor: { enabled: false, apiKeyEnv: "TRIPADVISOR_API_KEY", endpoint: "" },
        aliyun: { enabled: false, apiKeyEnv: "ALIYUN_AI_SEARCH_API_KEY", endpoint: "" },
        baidu: { enabled: false, apiKeyEnv: "BAIDU_SEARCH_API_KEY", endpoint: "" },
        jina: { enabled: false, apiKeyEnv: "JINA_API_KEY" }
      },
      cache: {
        enabled: true,
        dir: "data/research/cache",
        defaultTtlMs: 86400000,
        freshQueryTtlMs: 900000
      },
      rateLimits: {
        default: { perMinute: 30, concurrent: 2 }
      }
    },
    model: { temperature: 0, top_p: 1, max_tokens: 8192 }
  });
});

test("mergeResearchConfig deep-merges search providers and keeps key envs", () => {
  const merged = mergeResearchConfig({ search: { enabled: true, providers: { tavily: { enabled: true } } } });
  assert.equal(merged.search.enabled, true);
  assert.equal(merged.search.providers.tavily.enabled, true);
  assert.equal(merged.search.providers.tavily.apiKeyEnv, "TAVILY_API_KEY");
  assert.equal(merged.search.providers.wikipedia.enabled, true);
});

test("mergeResearchConfig keeps the new keyed providers' env names", () => {
  const m = mergeResearchConfig();
  assert.equal(m.search.providers.serpapi.apiKeyEnv, "SERPAPI_KEY");
  assert.equal(m.search.providers.serpapi.engine, "google");
  assert.equal(m.search.providers.worldbank.enabled, true);
  assert.equal(m.search.providers.googlescholar.apiKeyEnv, "SERPAPI_KEY");
});

test("mergeResearchConfig deep-merges cache and rateLimits", () => {
  const m = mergeResearchConfig({
    search: {
      cache: { enabled: false },
      rateLimits: { tavily: { perMinute: 5, concurrent: 1 } }
    }
  });
  assert.equal(m.search.cache.enabled, false);
  assert.equal(m.search.cache.dir, "data/research/cache");
  assert.equal(m.search.rateLimits.tavily.perMinute, 5);
  assert.equal(m.search.rateLimits.default.perMinute, 30);
});

test("validateResearchConfig rejects a bad rate limit", () => {
  const base = mergeResearchConfig();
  const bad = {
    ...base,
    search: {
      ...base.search,
      rateLimits: { default: { perMinute: 0, concurrent: 1 } }
    }
  };
  assert.match(validateResearchConfig(bad).search, /perMinute out of range/);
});

test("validateResearchConfig rejects a bad search block", () => {
  const base = mergeResearchConfig();
  assert.match(
    validateResearchConfig({ ...base, search: { ...base.search, maxResultsPerQuery: 0 } }).search,
    /maxResultsPerQuery/
  );
  assert.match(
    validateResearchConfig({ ...base, search: { ...base.search, enabled: "yes" } }).search,
    /enabled must be boolean/
  );
});

test("mergeResearchConfig deep-merges reflection", () => {
  const merged = mergeResearchConfig({ reflection: { maxAttempts: 0 } });
  assert.equal(merged.reflection.enabled, true);
  assert.equal(merged.reflection.maxAttempts, 0);
});

test("validateResearchConfig rejects bad Phase 2 ranges", () => {
  const base = mergeResearchConfig();
  assert.match(validateResearchConfig({ ...base, researcherCount: 0 }).researcherCount, /between 1 and 8/);
  assert.match(validateResearchConfig({ ...base, ragEnabled: "no" }).ragEnabled, /boolean/);
  assert.match(
    validateResearchConfig({ ...base, reflection: { enabled: true, maxAttempts: 99 } }).reflection,
    /maxAttempts/
  );
});

test("mergeResearchConfig keeps overrides and deep-merges model", () => {
  const merged = mergeResearchConfig({ enabled: true, model: { max_tokens: 4096 } });
  assert.equal(merged.enabled, true);
  assert.equal(merged.model.max_tokens, 4096);
  assert.equal(merged.model.temperature, 0);
});

test("validateResearchConfig accepts defaults", () => {
  assert.deepEqual(validateResearchConfig(mergeResearchConfig()), {});
});

test("validateResearchConfig rejects bad values", () => {
  const errors = validateResearchConfig({
    enabled: "yes",
    autoAcceptPlan: false,
    maxPlanIterations: 0,
    stateDir: "",
    model: { temperature: 0, top_p: 1, max_tokens: 8192 }
  });
  assert.equal(errors.enabled, "must be boolean");
  assert.equal(errors.maxPlanIterations, "must be an integer between 1 and 10");
  assert.equal(errors.stateDir, "is required");
});

test("validateResearchConfig rejects bad model params", () => {
  const base = mergeResearchConfig();
  assert.match(
    validateResearchConfig({ ...base, model: { ...base.model, max_tokens: 0 } }).model,
    /max_tokens/
  );
  assert.match(
    validateResearchConfig({ ...base, model: { ...base.model, temperature: 9 } }).model,
    /temperature/
  );
});
