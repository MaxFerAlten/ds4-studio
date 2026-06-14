export const RESEARCH_DEFAULTS = Object.freeze({
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
  reflection: Object.freeze({
    enabled: true,
    maxAttempts: 2
  }),
  search: Object.freeze({
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
    providers: Object.freeze({
      // Public, key-less providers default ON; keyed providers default OFF.
      wikipedia: Object.freeze({ enabled: true }),
      openalex: Object.freeze({ enabled: true }),
      worldbank: Object.freeze({ enabled: true }),
      tavily: Object.freeze({ enabled: false, apiKeyEnv: "TAVILY_API_KEY" }),
      serpapi: Object.freeze({ enabled: false, apiKeyEnv: "SERPAPI_KEY", engine: "google" }),
      googlescholar: Object.freeze({ enabled: false, apiKeyEnv: "SERPAPI_KEY" }),
      opentripmap: Object.freeze({ enabled: false, apiKeyEnv: "OPENTRIPMAP_API_KEY" }),
      tripadvisor: Object.freeze({ enabled: false, apiKeyEnv: "TRIPADVISOR_API_KEY", endpoint: "" }),
      aliyun: Object.freeze({ enabled: false, apiKeyEnv: "ALIYUN_AI_SEARCH_API_KEY", endpoint: "" }),
      baidu: Object.freeze({ enabled: false, apiKeyEnv: "BAIDU_SEARCH_API_KEY", endpoint: "" }),
      jina: Object.freeze({ enabled: false, apiKeyEnv: "JINA_API_KEY" })
    }),
    cache: Object.freeze({
      enabled: true,
      dir: "data/research/cache",
      defaultTtlMs: 86400000,
      freshQueryTtlMs: 900000
    }),
    rateLimits: Object.freeze({
      default: Object.freeze({ perMinute: 30, concurrent: 2 })
    })
  }),
  model: Object.freeze({
    temperature: 0,
    top_p: 1,
    max_tokens: 8192
  })
});

function plainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function mergeSearch(input) {
  const src = plainObject(input);
  const providersIn = plainObject(src.providers);
  const providers = {};
  for (const [name, def] of Object.entries(RESEARCH_DEFAULTS.search.providers)) {
    providers[name] = { ...def, ...plainObject(providersIn[name]) };
  }
  // Allow user-defined providers beyond the built-in set.
  for (const [name, val] of Object.entries(providersIn)) {
    if (!providers[name]) providers[name] = { ...plainObject(val) };
  }
  return {
    ...RESEARCH_DEFAULTS.search,
    ...src,
    providers,
    cache: { ...RESEARCH_DEFAULTS.search.cache, ...plainObject(src.cache) },
    rateLimits: { ...RESEARCH_DEFAULTS.search.rateLimits, ...plainObject(src.rateLimits) }
  };
}

export function mergeResearchConfig(input = {}) {
  const src = plainObject(input);
  return {
    ...RESEARCH_DEFAULTS,
    ...src,
    reflection: { ...RESEARCH_DEFAULTS.reflection, ...plainObject(src.reflection) },
    search: mergeSearch(src.search),
    model: { ...RESEARCH_DEFAULTS.model, ...plainObject(src.model) }
  };
}

function intInRange(value, min, max) {
  return Number.isInteger(value) && value >= min && value <= max;
}

function validateSearchConfig(search) {
  if (typeof search.enabled !== "boolean") return "enabled must be boolean";
  for (const [key, max] of [
    ["maxResultsPerQuery", 50],
    ["maxSourcesTotal", 200],
    ["maxFetchedPages", 100],
    ["maxCharsPerPage", 200000],
    ["retryCount", 10],
    ["retryDelayMs", 60000],
    ["timeoutMs", 120000]
  ]) {
    if (!intInRange(search[key], key === "retryCount" ? 0 : 1, max)) {
      return `${key} must be an integer between ${key === "retryCount" ? 0 : 1} and ${max}`;
    }
  }
  for (const key of ["enablePageReader", "enableDirectFetchFallback"]) {
    if (typeof search[key] !== "boolean") return `${key} must be boolean`;
  }
  if (!search.providers || typeof search.providers !== "object" || Array.isArray(search.providers)) {
    return "providers must be an object";
  }
  for (const [name, p] of Object.entries(search.providers)) {
    if (!p || typeof p !== "object") return `provider ${name} must be an object`;
    if (typeof p.enabled !== "boolean") return `provider ${name}.enabled must be boolean`;
  }
  const cache = search.cache || {};
  if (typeof cache.enabled !== "boolean") return "cache.enabled must be boolean";
  if (typeof cache.dir !== "string" || !cache.dir.trim()) return "cache.dir is required";
  if (!intInRange(cache.defaultTtlMs, 1000, 2592000000)) return "cache.defaultTtlMs out of range";
  if (!intInRange(cache.freshQueryTtlMs, 1000, 2592000000)) return "cache.freshQueryTtlMs out of range";
  if (!search.rateLimits || typeof search.rateLimits !== "object") return "rateLimits must be an object";
  for (const [name, rl] of Object.entries(search.rateLimits)) {
    if (!rl || typeof rl !== "object") return `rateLimits.${name} must be an object`;
    if (!intInRange(rl.perMinute, 1, 100000)) return `rateLimits.${name}.perMinute out of range`;
    if (!intInRange(rl.concurrent, 1, 1000)) return `rateLimits.${name}.concurrent out of range`;
  }
  return "";
}

export function validateResearchConfig(research = {}) {
  const errors = {};
  for (const key of ["enabled", "autoAcceptPlan", "ragEnabled", "searchEnabled", "webFetchEnabled", "exportEnabled"]) {
    if (typeof research[key] !== "boolean") errors[key] = "must be boolean";
  }
  if (!intInRange(research.maxPlanIterations, 1, 10)) {
    errors.maxPlanIterations = "must be an integer between 1 and 10";
  }
  if (!intInRange(research.researcherCount, 1, 8)) {
    errors.researcherCount = "must be an integer between 1 and 8";
  }
  if (!intInRange(research.maxSteps, 1, 50)) {
    errors.maxSteps = "must be an integer between 1 and 50";
  }
  if (!intInRange(research.maxSourcesPerQuery, 1, 50)) {
    errors.maxSourcesPerQuery = "must be an integer between 1 and 50";
  }
  if (!intInRange(research.maxContextChars, 1000, 2000000)) {
    errors.maxContextChars = "must be an integer between 1000 and 2000000";
  }
  if (typeof research.stateDir !== "string" || !research.stateDir.trim()) {
    errors.stateDir = "is required";
  }
  const reflection = research.reflection || {};
  if (typeof reflection.enabled !== "boolean") {
    errors.reflection = "enabled must be boolean";
  } else if (!intInRange(reflection.maxAttempts, 0, 5)) {
    errors.reflection = "maxAttempts must be an integer between 0 and 5";
  }
  const search = research.search || {};
  const searchError = validateSearchConfig(search);
  if (searchError) errors.search = searchError;
  const model = research.model || {};
  if (typeof model.temperature !== "number" || model.temperature < 0 || model.temperature > 2) {
    errors.model = "temperature must be a number between 0 and 2";
  } else if (typeof model.top_p !== "number" || model.top_p <= 0 || model.top_p > 1) {
    errors.model = "top_p must be a number in (0, 1]";
  } else if (!intInRange(model.max_tokens, 256, 131072)) {
    errors.model = "max_tokens must be an integer between 256 and 131072";
  }
  return errors;
}
