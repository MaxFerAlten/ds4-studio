import { BaseSearchProvider, timeoutSignal } from "./baseSearchProvider.mjs";

// arXiv API (https://info.arxiv.org/help/api/basics.html). Free, key-less.
// Returns an Atom XML feed of papers; parsed here without an XML dependency.
const DEFAULT_ENDPOINT = "https://export.arxiv.org/api/query";

function decodeXml(str) {
  return String(str)
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&amp;/g, "&");
}

function tag(block, name) {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i"));
  return m ? decodeXml(m[1]).replace(/\s+/g, " ").trim() : "";
}

// Parse <entry> blocks from an arXiv Atom feed into raw paper records.
export function parseArxivFeed(xml) {
  const entries = String(xml).match(/<entry\b[\s\S]*?<\/entry>/gi) || [];
  return entries.map((block) => {
    const authors = [...block.matchAll(/<author>[\s\S]*?<name>([\s\S]*?)<\/name>[\s\S]*?<\/author>/gi)].map(
      (m) => decodeXml(m[1]).trim()
    );
    return {
      id: tag(block, "id"),
      title: tag(block, "title"),
      summary: tag(block, "summary"),
      published: tag(block, "published"),
      authors
    };
  });
}

export class ArxivProvider extends BaseSearchProvider {
  name() {
    return "arxiv";
  }

  supports() {
    return ["ACADEMIC_RESEARCH"];
  }

  async search(query, { maxResults = 8, signal, timeoutMs } = {}) {
    const endpoint = this.config.endpoint || DEFAULT_ENDPOINT;
    const url =
      `${endpoint}?search_query=${encodeURIComponent(`all:${query}`)}` +
      `&start=0&max_results=${maxResults}`;
    const res = await this.fetchImpl(url, {
      headers: { Accept: "application/atom+xml" },
      signal: timeoutSignal(signal, timeoutMs)
    });
    if (!res.ok) throw new Error(`arxiv HTTP ${res.status}`);
    const xml = await res.text();
    const results = parseArxivFeed(xml)
      .filter((e) => e.id && e.title)
      .map((e, index) => ({
        provider: "arxiv",
        platform: "ACADEMIC_RESEARCH",
        sourceType: "paper",
        title: e.title,
        url: e.id,
        authors: e.authors,
        snippet: e.summary.slice(0, 400),
        content: [e.authors.length ? `Authors: ${e.authors.join(", ")}` : "", e.summary]
          .filter(Boolean)
          .join("\n"),
        providerRank: index + 1,
        raw: {}
      }));
    const warnings = results.length ? [] : ["arxiv: no results"];
    return { provider: "arxiv", query, results, warnings };
  }
}
