// Tavily provider (requires TAVILY_API_KEY). General-purpose web search.

import { BaseSearchProvider, timeoutSignal } from "./baseSearchProvider.mjs";

const DEFAULT_ENDPOINT = "https://api.tavily.com/search";

export class TavilyProvider extends BaseSearchProvider {
  name() {
    return "tavily";
  }

  supports() {
    return ["GENERAL_RESEARCH", "ACADEMIC_RESEARCH", "ENCYCLOPEDIA", "DATA_ANALYSIS"];
  }

  requiresApiKey() {
    return true;
  }

  async search(query, { maxResults = 8, signal, timeoutMs } = {}) {
    if (!this.apiKey) throw new Error("tavily: missing API key");
    const endpoint = this.config.endpoint || DEFAULT_ENDPOINT;
    const res = await this.fetchImpl(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: this.apiKey,
        query,
        max_results: maxResults,
        search_depth: "basic",
        include_answer: false
      }),
      signal: timeoutSignal(signal, timeoutMs)
    });
    if (!res.ok) throw new Error(`tavily search HTTP ${res.status}`);
    const data = await res.json();
    const items = data?.results || [];
    const results = items.map((r, i) => ({
      provider: "tavily",
      platform: "GENERAL_RESEARCH",
      sourceType: "unknown",
      title: r.title || r.url,
      url: r.url,
      snippet: String(r.content || "").slice(0, 400),
      content: r.raw_content || r.content || "",
      score: typeof r.score === "number" ? r.score : 0,
      providerRank: i + 1,
      raw: {}
    }));
    return { provider: "tavily", query, results, warnings: [] };
  }
}
