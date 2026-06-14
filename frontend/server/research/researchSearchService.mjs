// Orchestrator — the Node port of DeepResearch's SearchInfoService. Selects a
// provider per query, runs it with retry + fallback, normalizes/dedupes the
// results, optionally enriches them with full page text (Jina, then direct
// fetch), ranks, and caps. Returns ranked "web raw sources".

import { selectPlatform } from "./searchPlatformSelector.mjs";
import { dedupeWebSources, rankWebSources, toWebSource } from "./webSources.mjs";
import { tryReadPage } from "./pageReader.mjs";
import { WikipediaProvider } from "./providers/wikipediaProvider.mjs";
import { OpenAlexProvider } from "./providers/openAlexProvider.mjs";
import { TavilyProvider } from "./providers/tavilyProvider.mjs";
import { JinaReaderProvider } from "./providers/jinaReaderProvider.mjs";
import { SerpApiProvider } from "./providers/serpApiProvider.mjs";
import { ScrapingBeeProvider } from "./providers/scrapingBeeProvider.mjs";
import { ArxivProvider } from "./providers/arxivProvider.mjs";
import { CnrProvider } from "./providers/cnrProvider.mjs";
import { WorldBankProvider } from "./providers/worldBankProvider.mjs";
import { OpenTripMapProvider } from "./providers/openTripMapProvider.mjs";
import { TripAdvisorProvider } from "./providers/tripAdvisorProvider.mjs";
import { AliyunProvider } from "./providers/aliyunProvider.mjs";
import { BaiduProvider } from "./providers/baiduProvider.mjs";
import { SourceCache } from "./sourceCache.mjs";
import { RateLimiter } from "./rateLimiter.mjs";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export class ResearchSearchService {
  constructor({
    config,
    providers = {},
    jinaReader = null,
    fetchImpl = fetch,
    selectPlatformFn = selectPlatform,
    logger = console,
    cache = null,
    rateLimiter = null
  }) {
    this.config = config;
    this.providers = providers;
    this.jinaReader = jinaReader;
    this.fetchImpl = fetchImpl;
    this.selectPlatformFn = selectPlatformFn;
    this.logger = logger;
    this.cache = cache;
    this.rateLimiter = rateLimiter;
  }

  availableProviders() {
    return Object.entries(this.providers)
      .filter(([, p]) => p.isConfigured())
      .map(([name]) => name);
  }

  enabled() {
    return Boolean(this.config?.enabled) && this.availableProviders().length > 0;
  }

  async #withRetry(fn) {
    const { retryCount = 2, retryDelayMs = 0 } = this.config;
    let lastErr;
    for (let attempt = 0; attempt <= retryCount; attempt++) {
      try {
        return await fn();
      } catch (err) {
        lastErr = err;
        if (attempt < retryCount && retryDelayMs) await sleep(retryDelayMs);
      }
    }
    throw lastErr;
  }

  async #runProvider(name, query, signal) {
    const provider = this.providers[name];
    if (!provider || !provider.isConfigured()) return null;
    const options = {
      maxResults: this.config.maxResultsPerQuery,
      timeoutMs: this.config.timeoutMs
    };
    if (this.cache) {
      const cached = await this.cache.get(name, query, options);
      if (cached) return cached;
    }

    const run = () =>
      this.#withRetry(() => provider.search(query, { ...options, signal }));
    const result = this.rateLimiter
      ? await (async () => {
          const release = await this.rateLimiter.acquire(name);
          try {
            return await run();
          } finally {
            release();
          }
        })()
      : await run();

    if (this.cache && result && result.results) {
      await this.cache.set(name, query, options, result);
    }
    return result;
  }

  // Try the selected provider, then its fallback chain, until one yields results.
  async #searchWithFallback(query, selection, signal, emit) {
    const chain = selection.chain || [selection.provider, selection.fallbackProvider].filter(Boolean);
    for (const name of chain) {
      try {
        const out = await this.#runProvider(name, query, signal);
        if (out && out.results && out.results.length) {
          emit?.("search_provider_completed", { query, provider: name, count: out.results.length });
          return out.results.map((r) => ({ ...r, provider: r.provider || name }));
        }
      } catch (err) {
        emit?.("search_provider_warning", { query, provider: name, error: err.message });
        this.logger?.warn?.(`research search: provider ${name} failed: ${err.message}`);
      }
    }
    return [];
  }

  // Enrich the highest-ranked sources with full page text (best-effort).
  async #enrich(sources, signal, emit) {
    if (!this.config.enablePageReader) return sources;
    const maxPages = this.config.maxFetchedPages;
    let fetched = 0;
    for (const s of sources) {
      if (fetched >= maxPages) break;
      if (!s.url || (s.content && s.content.length > 600)) continue;
      let read = null;
      if (this.jinaReader) {
        try {
          read = await this.jinaReader.read(s.url, { signal, maxChars: this.config.maxCharsPerPage, timeoutMs: this.config.timeoutMs });
        } catch (err) {
          emit?.("search_provider_warning", { provider: "jina", url: s.url, error: err.message });
        }
      }
      if (!read && this.config.enableDirectFetchFallback) {
        read = await tryReadPage(s.url, {
          fetchImpl: this.fetchImpl,
          signal,
          maxChars: this.config.maxCharsPerPage,
          timeoutMs: this.config.timeoutMs
        });
      }
      if (read && read.content) {
        s.content = read.content;
        s.contentSource = read.contentSource || "fetch";
        fetched += 1;
        emit?.("source_enriched", { url: s.url, chars: read.content.length });
      }
    }
    return sources;
  }

  // Run all queries, returning ranked web sources.
  async gather(queries, { signal, emit } = {}) {
    if (!this.enabled()) return [];
    const available = this.availableProviders();
    emit?.("search_started", { queries, providers: available });
    const collected = [];
    for (const query of queries) {
      const selection = this.selectPlatformFn(query, { availableProviders: available });
      emit?.("search_platform_selected", { query, selection });
      if (!selection.provider) continue;
      const raw = await this.#searchWithFallback(query, selection, signal, emit);
      for (const r of raw) {
        collected.push(toWebSource(r, { provider: r.provider, query, platform: selection.agentType }));
      }
    }
    let sources = dedupeWebSources(collected);
    sources = rankWebSources(sources, { maxSourcesTotal: this.config.maxSourcesTotal });
    sources = await this.#enrich(sources, signal, emit);
    emit?.("search_completed", { count: sources.length });
    return sources;
  }
}

// Build a service from a research.search config block, wiring real providers
// and reading API keys from the environment. Disabled/unconfigured providers
// are skipped with a warning.
export function buildSearchService(searchConfig, { fetchImpl = fetch, env = process.env, logger = console } = {}) {
  const factories = {
    wikipedia: (cfg, apiKey) =>
      new WikipediaProvider({ config: cfg, fetchImpl, apiKey }),
    arxiv: (cfg, apiKey) =>
      new ArxivProvider({ config: cfg, fetchImpl, apiKey }),
    cnr: (cfg, apiKey) =>
      new CnrProvider({ config: cfg, fetchImpl, apiKey }),
    openalex: (cfg, apiKey) =>
      new OpenAlexProvider({ config: cfg, fetchImpl, apiKey }),
    worldbank: (cfg, apiKey) =>
      new WorldBankProvider({ config: cfg, fetchImpl, apiKey }),
    tavily: (cfg, apiKey) =>
      new TavilyProvider({ config: cfg, fetchImpl, apiKey }),
    serpapi: (cfg, apiKey) =>
      new SerpApiProvider({
        config: cfg,
        fetchImpl,
        apiKey,
        name: "serpapi"
      }),
    googlescholar: (cfg, apiKey) =>
      new SerpApiProvider({
        config: { ...cfg, engine: "google_scholar" },
        fetchImpl,
        apiKey,
        name: "googlescholar"
      }),
    scrapingbee: (cfg, apiKey) =>
      new ScrapingBeeProvider({ config: cfg, fetchImpl, apiKey }),
    opentripmap: (cfg, apiKey) =>
      new OpenTripMapProvider({ config: cfg, fetchImpl, apiKey }),
    tripadvisor: (cfg, apiKey) =>
      new TripAdvisorProvider({ config: cfg, fetchImpl, apiKey }),
    aliyun: (cfg, apiKey) =>
      new AliyunProvider({ config: cfg, fetchImpl, apiKey }),
    baidu: (cfg, apiKey) =>
      new BaiduProvider({ config: cfg, fetchImpl, apiKey })
  };
  const providers = {};
  for (const [name, make] of Object.entries(factories)) {
    const pcfg = searchConfig.providers?.[name];
    if (!pcfg?.enabled) continue;
    const apiKey = pcfg.apiKeyEnv ? env[pcfg.apiKeyEnv] || null : null;
    const inst = make(pcfg, apiKey);
    if (inst.isConfigured()) providers[name] = inst;
    else {
      logger?.warn?.(
        `research search: provider ${name} enabled but not configured`
      );
    }
  }
  let jinaReader = null;
  const jcfg = searchConfig.providers?.jina;
  if (jcfg?.enabled) {
    const apiKey = jcfg.apiKeyEnv ? env[jcfg.apiKeyEnv] || null : null;
    jinaReader = new JinaReaderProvider({ config: jcfg, fetchImpl, apiKey });
  }
  const cache = new SourceCache({
    dir: searchConfig.cache?.dir || "data/research/cache",
    enabled: searchConfig.cache?.enabled !== false,
    defaultTtlMs: searchConfig.cache?.defaultTtlMs,
    freshQueryTtlMs: searchConfig.cache?.freshQueryTtlMs
  });
  const rateLimiter = new RateLimiter(searchConfig.rateLimits || {});
  return new ResearchSearchService({
    config: searchConfig,
    providers,
    jinaReader,
    fetchImpl,
    logger,
    cache,
    rateLimiter
  });
}
