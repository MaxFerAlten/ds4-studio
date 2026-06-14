// OpenAlex provider (no API key). Academic works search. Converts the
// abstract_inverted_index back into readable text. sourceType = paper.

import { BaseSearchProvider, timeoutSignal } from "./baseSearchProvider.mjs";

const DEFAULT_API = "https://api.openalex.org";

export function abstractInvertedIndexToText(index) {
  if (!index || typeof index !== "object") return "";
  const positions = [];
  for (const [word, idxs] of Object.entries(index)) {
    for (const i of idxs) positions[i] = word;
  }
  return positions.filter((w) => w !== undefined).join(" ");
}

export class OpenAlexProvider extends BaseSearchProvider {
  name() {
    return "openalex";
  }

  supports() {
    return ["ACADEMIC_RESEARCH", "GENERAL_RESEARCH"];
  }

  async search(query, { maxResults = 8, signal, timeoutMs } = {}) {
    const api = this.config.endpoint || DEFAULT_API;
    const url = `${api}/works?search=${encodeURIComponent(query)}&per-page=${maxResults}`;
    const res = await this.fetchImpl(url, {
      signal: timeoutSignal(signal, timeoutMs),
      headers: { "User-Agent": "ds4-studio-research/1.0" }
    });
    if (!res.ok) throw new Error(`openalex search HTTP ${res.status}`);
    const data = await res.json();
    const works = data?.results || [];
    const results = works.map((w, i) => {
      const abstract = abstractInvertedIndexToText(w.abstract_inverted_index);
      const url = w.doi || w.primary_location?.landing_page_url || w.id;
      return {
        provider: "openalex",
        platform: "ACADEMIC_RESEARCH",
        sourceType: "paper",
        title: w.title || w.display_name || "untitled work",
        url,
        snippet: abstract.slice(0, 400),
        content: abstract,
        publishedAt: w.publication_date || null,
        score: typeof w.relevance_score === "number" ? w.relevance_score : 0,
        providerRank: i + 1,
        raw: {
          citedByCount: w.cited_by_count,
          venue: w.host_venue?.display_name || w.primary_location?.source?.display_name || null
        }
      };
    });
    return { provider: "openalex", query, results, warnings: [] };
  }
}
