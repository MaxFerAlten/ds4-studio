import { BaseSearchProvider, timeoutSignal } from "./baseSearchProvider.mjs";

const DEFAULT_ENDPOINT = "https://serpapi.com/search.json";

export class SerpApiProvider extends BaseSearchProvider {
  constructor(opts = {}) {
    super(opts);
    this.providerName = opts.name || "serpapi";
    this.engine = opts.config?.engine || "google";
  }

  name() {
    return this.providerName;
  }

  supports() {
    return this.engine === "google_scholar"
      ? ["ACADEMIC_RESEARCH"]
      : ["GENERAL_RESEARCH", "ACADEMIC_RESEARCH", "DATA_ANALYSIS"];
  }

  requiresApiKey() {
    return true;
  }

  async search(query, { maxResults = 8, signal, timeoutMs } = {}) {
    if (!this.apiKey) throw new Error(`${this.providerName}: missing API key`);
    const endpoint = this.config.endpoint || DEFAULT_ENDPOINT;
    const url = `${endpoint}?engine=${this.engine}&q=${encodeURIComponent(query)}&num=${maxResults}&api_key=${encodeURIComponent(this.apiKey)}`;
    const res = await this.fetchImpl(url, {
      signal: timeoutSignal(signal, timeoutMs)
    });
    if (!res.ok) throw new Error(`${this.providerName} HTTP ${res.status}`);
    const data = await res.json();
    const organic = data.organic_results || [];
    const scholar = this.engine === "google_scholar";
    const results = organic.map((result, index) => ({
      provider: this.providerName,
      platform: scholar ? "ACADEMIC_RESEARCH" : "GENERAL_RESEARCH",
      sourceType: scholar ? "paper" : "unknown",
      title: result.title || result.link,
      url: result.link,
      snippet: String(result.snippet || "").slice(0, 400),
      content: [result.snippet, result.publication_info?.summary]
        .filter(Boolean)
        .join(" - "),
      providerRank: result.position || index + 1,
      raw: {}
    }));
    return {
      provider: this.providerName,
      query,
      results,
      warnings: []
    };
  }
}
