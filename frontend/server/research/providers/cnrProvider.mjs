import { BaseSearchProvider, timeoutSignal } from "./baseSearchProvider.mjs";

// CNR Publications API (https://publications.cnr.it/api/v1/search) — the public,
// key-less Solr-backed REST API over CNR IRIS. Free-text search via the TEXT
// catch-all field; responds with a Solr XML document parsed here without an XML
// dependency.
const DEFAULT_ENDPOINT = "https://publications.cnr.it/api/v1/search";
// Solr query metacharacters; stripped from the user query so free text never
// produces a 400 from the Solr parser.
const SOLR_META = /[+\-!(){}\[\]^"~*?:\\/&|]/g;

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

export function toSolrTextQuery(query) {
  const terms = String(query || "")
    .replace(SOLR_META, " ")
    .split(/\s+/)
    .filter(Boolean);
  return terms.length ? `TEXT:(${terms.join(" ")})` : "TEXT:(*)";
}

function strField(block, name) {
  const m = block.match(new RegExp(`<str name="${name}">([\\s\\S]*?)</str>`, "i"));
  return m ? decodeXml(m[1]).replace(/\s+/g, " ").trim() : "";
}

function arrField(block, name) {
  const m = block.match(new RegExp(`<arr name="${name}">([\\s\\S]*?)</arr>`, "i"));
  if (!m) return [];
  return [...m[1].matchAll(/<str>([\s\S]*?)<\/str>/gi)].map((x) => decodeXml(x[1]).replace(/\s+/g, " ").trim());
}

// Parse the Solr <doc> records from a CNR publications XML response.
export function parseCnrSolr(xml) {
  const docs = String(xml).match(/<doc>[\s\S]*?<\/doc>/gi) || [];
  return docs.map((block) => ({
    id: strField(block, "ID"),
    title: strField(block, "titolo_s-s"),
    abstract: strField(block, "abstract_s-s"),
    authors: arrField(block, "autori_s-i-s-m"),
    year: strField(block, "anno_s-i-s"),
    doi: arrField(block, "doi_s-i-s-m")[0] || strField(block, "doi_s-i-s-m"),
    journal: arrField(block, "source_s-s-m")[0] || strField(block, "rivista_s-i-s")
  }));
}

export class CnrProvider extends BaseSearchProvider {
  name() {
    return "cnr";
  }

  supports() {
    return ["ACADEMIC_RESEARCH"];
  }

  async search(query, { maxResults = 8, signal, timeoutMs } = {}) {
    const endpoint = this.config.endpoint || DEFAULT_ENDPOINT;
    const url =
      `${endpoint}?q=${encodeURIComponent(toSolrTextQuery(query))}` +
      `&rows=${maxResults}&start=0`;
    const res = await this.fetchImpl(url, {
      headers: { Accept: "application/xml" },
      signal: timeoutSignal(signal, timeoutMs)
    });
    if (!res.ok) throw new Error(`cnr HTTP ${res.status}`);
    const xml = await res.text();
    const results = parseCnrSolr(xml)
      .filter((d) => d.title)
      .map((d, index) => ({
        provider: "cnr",
        platform: "ACADEMIC_RESEARCH",
        sourceType: "paper",
        title: d.title,
        url: d.doi ? `https://doi.org/${d.doi}` : `https://publications.cnr.it/handle/${d.id}`,
        authors: d.authors,
        snippet: d.abstract.slice(0, 400),
        content: [
          d.authors.length ? `Authors: ${d.authors.join(", ")}` : "",
          d.year ? `Year: ${d.year}` : "",
          d.journal ? `Source: ${d.journal}` : "",
          d.abstract
        ]
          .filter(Boolean)
          .join("\n"),
        providerRank: index + 1,
        raw: {}
      }));
    const warnings = results.length ? [] : ["cnr: no results"];
    return { provider: "cnr", query, results, warnings };
  }
}
