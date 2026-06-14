import { BaseSearchProvider, timeoutSignal } from "./baseSearchProvider.mjs";

// Generic keyed POST. The operator must provide the account-specific endpoint.
export class BaiduProvider extends BaseSearchProvider {
  name() {
    return "baidu";
  }

  supports() {
    return ["GENERAL_RESEARCH", "LIFESTYLE_TRAVEL"];
  }

  requiresApiKey() {
    return true;
  }

  isConfigured() {
    return Boolean(
      this.apiKey &&
      typeof this.config.endpoint === "string" &&
      this.config.endpoint.trim()
    );
  }

  async search(query, { maxResults = 8, signal, timeoutMs } = {}) {
    if (!this.isConfigured()) {
      return {
        provider: "baidu",
        query,
        results: [],
        warnings: ["baidu disabled: key and endpoint required"]
      };
    }
    const res = await this.fetchImpl(this.config.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`
      },
      body: JSON.stringify({ query, num: maxResults }),
      signal: timeoutSignal(signal, timeoutMs)
    });
    if (!res.ok) throw new Error(`baidu HTTP ${res.status}`);
    const data = await res.json();
    const items = data.data || data.results || [];
    const results = items.slice(0, maxResults).map((item, index) => ({
      provider: "baidu",
      platform: "GENERAL_RESEARCH",
      sourceType: "unknown",
      title: item.title || item.link || item.url,
      url: item.link || item.url,
      snippet: String(item.abstract || item.snippet || item.content || "").slice(0, 400),
      content: item.content || item.abstract || item.snippet || "",
      providerRank: index + 1,
      raw: {}
    }));
    return {
      provider: "baidu",
      query,
      results,
      warnings: []
    };
  }
}
