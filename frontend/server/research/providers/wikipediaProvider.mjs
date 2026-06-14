// Wikipedia provider (no API key). Two steps: search titles, then fetch the
// REST summary extract for each hit. sourceType = encyclopedia.

import { BaseSearchProvider, timeoutSignal } from "./baseSearchProvider.mjs";

const DEFAULT_API = "https://en.wikipedia.org/w/api.php";
const DEFAULT_REST = "https://en.wikipedia.org/api/rest_v1/page/summary";

export class WikipediaProvider extends BaseSearchProvider {
  name() {
    return "wikipedia";
  }

  supports() {
    return ["ENCYCLOPEDIA", "GENERAL_RESEARCH"];
  }

  async search(query, { maxResults = 5, signal, timeoutMs } = {}) {
    const api = this.config.endpoint || DEFAULT_API;
    const rest = this.config.restEndpoint || DEFAULT_REST;
    const warnings = [];
    const url = `${api}?action=query&list=search&format=json&srlimit=${maxResults}&srsearch=${encodeURIComponent(query)}`;
    const res = await this.fetchImpl(url, { signal: timeoutSignal(signal, timeoutMs) });
    if (!res.ok) throw new Error(`wikipedia search HTTP ${res.status}`);
    const data = await res.json();
    const hits = data?.query?.search || [];
    const results = [];
    for (const hit of hits) {
      const title = hit.title;
      const pageUrl = `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}`;
      let content = String(hit.snippet || "").replace(/<[^>]+>/g, "");
      try {
        const sres = await this.fetchImpl(`${rest}/${encodeURIComponent(title.replace(/ /g, "_"))}`, {
          signal: timeoutSignal(signal, timeoutMs)
        });
        if (sres.ok) {
          const summary = await sres.json();
          if (summary.extract) content = summary.extract;
        }
      } catch {
        warnings.push(`wikipedia summary failed for ${title}`);
      }
      results.push({
        provider: "wikipedia",
        platform: "ENCYCLOPEDIA",
        sourceType: "encyclopedia",
        title,
        url: pageUrl,
        snippet: content.slice(0, 400),
        content,
        providerRank: results.length + 1,
        raw: { pageid: hit.pageid }
      });
    }
    return { provider: "wikipedia", query, results, warnings };
  }
}
