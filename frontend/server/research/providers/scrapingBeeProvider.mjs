import { BaseSearchProvider, timeoutSignal } from "./baseSearchProvider.mjs";

// ScrapingBee Google Search API (https://app.scrapingbee.com/api/v1/store/google).
// A keyed general web-search provider: given a query it returns Google organic
// results. Distinct from SerpAPI — both can be enabled together.
const DEFAULT_ENDPOINT = "https://app.scrapingbee.com/api/v1/store/google";

export class ScrapingBeeProvider extends BaseSearchProvider {
  name() {
    return "scrapingbee";
  }

  supports() {
    return ["GENERAL_RESEARCH", "ACADEMIC_RESEARCH", "DATA_ANALYSIS"];
  }

  requiresApiKey() {
    return true;
  }

  async search(query, { maxResults = 8, signal, timeoutMs } = {}) {
    if (!this.apiKey) throw new Error("scrapingbee: missing API key");
    const endpoint = this.config.endpoint || DEFAULT_ENDPOINT;
    const url =
      `${endpoint}?api_key=${encodeURIComponent(this.apiKey)}` +
      `&search=${encodeURIComponent(query)}&nb_results=${maxResults}`;
    const res = await this.fetchImpl(url, {
      signal: timeoutSignal(signal, timeoutMs)
    });
    if (!res.ok) throw new Error(`scrapingbee HTTP ${res.status}`);
    const data = await res.json();
    const organic = Array.isArray(data.organic_results) ? data.organic_results : [];
    const results = organic
      .filter((r) => r && r.url)
      .map((r, index) => ({
        provider: "scrapingbee",
        platform: "GENERAL_RESEARCH",
        sourceType: "unknown",
        title: r.title || r.displayed_url || r.url,
        url: r.url,
        snippet: String(r.description || "").slice(0, 400),
        content: String(r.description || ""),
        providerRank: r.position || index + 1,
        raw: {}
      }));
    return {
      provider: "scrapingbee",
      query,
      results,
      warnings: []
    };
  }
}
