import test from "node:test";
import assert from "node:assert/strict";
import { classifyQuery, selectPlatform } from "./searchPlatformSelector.mjs";

test("classifyQuery routes academic queries to openalex", () => {
  assert.equal(classifyQuery("trova studi su quantum decoding").agentType, "ACADEMIC_RESEARCH");
  assert.equal(classifyQuery("papers about transformers arxiv").providerPreference[0], "openalex");
});

test("classifyQuery routes encyclopedic queries to wikipedia", () => {
  assert.equal(classifyQuery("cos'è Redis").agentType, "ENCYCLOPEDIA");
  assert.equal(classifyQuery("history of OpenAlex").providerPreference[0], "wikipedia");
});

test("classifyQuery routes data queries to worldbank", () => {
  assert.equal(classifyQuery("andamento popolazione Italia world bank").agentType, "DATA_ANALYSIS");
});

test("classifyQuery falls back to general research", () => {
  assert.equal(classifyQuery("Redis Cluster vs Sentinel tradeoffs").agentType, "GENERAL_RESEARCH");
});

test("selectPlatform picks the first preferred available provider", () => {
  const s = selectPlatform("cos'è Redis", { availableProviders: ["wikipedia", "tavily"] });
  assert.equal(s.agentType, "ENCYCLOPEDIA");
  assert.equal(s.provider, "wikipedia");
  assert.equal(s.fallbackProvider, "tavily");
});

test("selectPlatform falls back when the preferred provider is unavailable", () => {
  // academic prefers openalex, but only tavily is available
  const s = selectPlatform("papers about arxiv preprint", { availableProviders: ["tavily"] });
  assert.equal(s.provider, "tavily");
});

test("academic prefers openalex then googlescholar when available", () => {
  const s = selectPlatform("papers on arxiv preprint", {
    availableProviders: ["googlescholar", "tavily"]
  });
  assert.equal(s.provider, "googlescholar");
});

test("selectPlatform appends remaining providers as last resort", () => {
  const s = selectPlatform("random general query", { availableProviders: ["openalex"] });
  assert.equal(s.provider, "openalex");
});

test("selectPlatform returns null provider when none available", () => {
  const s = selectPlatform("anything", { availableProviders: [] });
  assert.equal(s.provider, null);
  assert.match(s.reason, /no provider available/);
});
