import { BaseSearchProvider, timeoutSignal } from "./baseSearchProvider.mjs";

const DEFAULT_API = "https://api.opentripmap.com/0.1/en/places";
const STOPWORDS = /\b(attractions?|attrazioni|things to do|travel|viaggio|in|near|around|the|a)\b/gi;

export class OpenTripMapProvider extends BaseSearchProvider {
  name() {
    return "opentripmap";
  }

  supports() {
    return ["LIFESTYLE_TRAVEL"];
  }

  requiresApiKey() {
    return true;
  }

  #placeName(query) {
    return String(query).replace(STOPWORDS, " ").replace(/\s+/g, " ").trim() || query;
  }

  async search(query, { maxResults = 8, signal, timeoutMs } = {}) {
    if (!this.apiKey) throw new Error("opentripmap: missing API key");
    const api = this.config.endpoint || DEFAULT_API;
    const requestSignal = () => timeoutSignal(signal, timeoutMs);
    const name = this.#placeName(query);
    const geoRes = await this.fetchImpl(
      `${api}/geoname?name=${encodeURIComponent(name)}&apikey=${encodeURIComponent(this.apiKey)}`,
      { signal: requestSignal() }
    );
    if (!geoRes.ok) throw new Error(`opentripmap geoname HTTP ${geoRes.status}`);
    const geo = await geoRes.json();
    if (typeof geo.lat !== "number" || typeof geo.lon !== "number") {
      return {
        provider: "opentripmap",
        query,
        results: [],
        warnings: [`could not geocode "${name}"`]
      };
    }

    const radiusRes = await this.fetchImpl(
      `${api}/radius?radius=5000&lon=${geo.lon}&lat=${geo.lat}&limit=${maxResults}&apikey=${encodeURIComponent(this.apiKey)}`,
      { signal: requestSignal() }
    );
    if (!radiusRes.ok) {
      throw new Error(`opentripmap radius HTTP ${radiusRes.status}`);
    }
    const data = await radiusRes.json();
    const features = data.features || [];
    const results = features
      .filter((feature) => feature.properties?.name)
      .map((feature, index) => ({
        provider: "opentripmap",
        platform: "LIFESTYLE_TRAVEL",
        sourceType: "travel",
        title: feature.properties.name,
        url: `https://opentripmap.com/en/card/${feature.properties.xid}`,
        snippet: feature.properties.kinds || "",
        content: `${feature.properties.name} (${feature.properties.kinds || "place"}) near ${geo.name}`,
        providerRank: index + 1,
        raw: {
          xid: feature.properties.xid,
          kinds: feature.properties.kinds,
          rate: feature.properties.rate
        }
      }));
    return {
      provider: "opentripmap",
      query,
      results,
      warnings: []
    };
  }
}
