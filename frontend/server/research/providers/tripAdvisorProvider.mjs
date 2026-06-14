import { BaseSearchProvider, timeoutSignal } from "./baseSearchProvider.mjs";

// Official Content API only. No HTML scraping or anti-bot bypass.
export class TripAdvisorProvider extends BaseSearchProvider {
  name() {
    return "tripadvisor";
  }

  supports() {
    return ["LIFESTYLE_TRAVEL"];
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
        provider: "tripadvisor",
        query,
        results: [],
        warnings: [
          "TripAdvisor disabled: official API key and endpoint required (no scraping)"
        ]
      };
    }

    const url = `${this.config.endpoint}?key=${encodeURIComponent(this.apiKey)}&searchQuery=${encodeURIComponent(query)}&language=en`;
    const res = await this.fetchImpl(url, {
      signal: timeoutSignal(signal, timeoutMs)
    });
    if (!res.ok) throw new Error(`tripadvisor HTTP ${res.status}`);
    const data = await res.json();
    const items = (data.data || []).slice(0, maxResults);
    const results = items.map((item, index) => ({
      provider: "tripadvisor",
      platform: "LIFESTYLE_TRAVEL",
      sourceType: "travel",
      title: item.name,
      url: `https://www.tripadvisor.com/${item.location_id}`,
      snippet: item.address_obj?.address_string || "",
      content: [item.name, item.address_obj?.address_string]
        .filter(Boolean)
        .join(" - "),
      providerRank: index + 1,
      raw: { locationId: item.location_id }
    }));
    return {
      provider: "tripadvisor",
      query,
      results,
      warnings: []
    };
  }
}
