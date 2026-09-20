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
/**
 * The bare arXiv identifier behind a canonical `<id>` URL, version stripped:
 * 0710.2724v4 and 0710.2724v1 are the same paper, and citation identity is
 * about which paper, not which revision. Old-style ids (math.GT/0309136) come
 * through unchanged.
 */
export function arxivIdFromCanonicalUrl(id) {
  const m = String(id || "").match(/arxiv\.org\/abs\/(.+)$/i);
  return m ? m[1].replace(/v\d+$/, "") : null;
}

export function parseArxivFeed(xml) {
  const entries = String(xml).match(/<entry\b[\s\S]*?<\/entry>/gi) || [];
  return entries.map((block) => {
    const authors = [...block.matchAll(/<author>[\s\S]*?<name>([\s\S]*?)<\/name>[\s\S]*?<\/author>/gi)].map(
      (m) => decodeXml(m[1]).trim()
    );
    const id = tag(block, "id");
    return {
      id,
      arxivId: arxivIdFromCanonicalUrl(id),
      // Only the DOI arXiv actually publishes for the entry. A paper with no
      // <arxiv:doi> has no DOI here: deriving one from the arXiv id would be
      // inventing an identifier, which is the failure this feeds into (F17).
      doi: tag(block, "arxiv:doi") || null,
      title: tag(block, "title"),
      summary: tag(block, "summary"),
      published: tag(block, "published"),
      authors
    };
  });
}

/** The bibliographic record shape the identity resolver consumes. */
function arxivRecord(entry) {
  return {
    source: "arxiv",
    arxivId: entry.arxivId,
    doi: entry.doi,
    title: entry.title,
    authors: entry.authors,
    publishedAt: entry.published || null
  };
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
        arxivId: e.arxivId,
        doi: e.doi,
        publishedAt: e.published || null,
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

  /**
   * Resolve one canonical arXiv id to the record it actually names.
   *
   * `id_list` asks arXiv about that identifier rather than searching for its
   * digits, which is the whole point: the question is what this id resolves to,
   * not what looks like it. Expects an already-canonical id (no URL, no version
   * suffix); null when the identifier names nothing.
   */
  async lookup(arxivId, { signal, timeoutMs } = {}) {
    const id = String(arxivId || "").trim();
    if (!id) return null;
    const endpoint = this.config.endpoint || DEFAULT_ENDPOINT;
    const res = await this.fetchImpl(`${endpoint}?id_list=${encodeURIComponent(id)}&max_results=1`, {
      headers: { Accept: "application/atom+xml" },
      signal: timeoutSignal(signal, timeoutMs)
    });
    if (!res.ok) throw new Error(`arxiv lookup HTTP ${res.status}`);
    const [entry] = parseArxivFeed(await res.text());
    return entry && entry.title ? arxivRecord(entry) : null;
  }
}
