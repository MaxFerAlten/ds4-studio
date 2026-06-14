import { BaseSearchProvider, timeoutSignal } from "./baseSearchProvider.mjs";

// Generic keyed POST. The operator must provide the account-specific endpoint.
export class AliyunProvider extends BaseSearchProvider {
  name() {
    return "aliyun";
  }

  supports() {
    return ["GENERAL_RESEARCH", "ACADEMIC_RESEARCH"];
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
        provider: "aliyun",
        query,
        results: [],
        warnings: ["aliyun disabled: key and endpoint required"]
      };
    }
    const res = await this.fetchImpl(this.config.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`
      },
      body: JSON.stringify({ query, top_k: maxResults }),
      signal: timeoutSignal(signal, timeoutMs)
    });
    if (!res.ok) throw new Error(`aliyun HTTP ${res.status}`);
    const data = await res.json();
    const items = data.results || data.data || [];
    const results = items.slice(0, maxResults).map((item, index) => ({
      provider: "aliyun",
      platform: "GENERAL_RESEARCH",
      sourceType: "unknown",
      title: item.title || item.url || item.link,
      url: item.url || item.link,
      snippet: String(item.snippet || item.content || item.abstract || "").slice(0, 400),
      content: item.content || item.snippet || item.abstract || "",
      providerRank: index + 1,
      raw: {}
    }));
    return {
      provider: "aliyun",
      query,
      results,
      warnings: []
    };
  }
}
