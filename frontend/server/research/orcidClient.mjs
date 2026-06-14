// ORCID Public API client (https://pub.orcid.org) — key-less. Used to gauge the
// credibility of paper authors: an author whose name matches a real ORCID record
// with institutional affiliations is a positive trust signal. This is a NAME
// match (a hint), not exact identity proof, since sources rarely carry the iD.

const DEFAULT_BASE_URL = "https://pub.orcid.org/v3.0";
const SOLR_META = /[+\-!(){}\[\]^"~*?:\\/&|]/g;

function clean(token) {
  return String(token || "").replace(SOLR_META, " ").replace(/\.$/, "").trim();
}

function isInitial(token) {
  const t = token.replace(/\./g, "");
  return t.length <= 2 && /^[A-Za-z]+$/.test(t);
}

// Split a free-form author string into { given, family }. Handles "Family, Given",
// "Initial. Family" (arXiv), and "Family Initial." (CNR).
export function parseAuthorName(raw) {
  const s = String(raw || "").trim();
  if (!s) return { given: "", family: "" };
  if (s.includes(",")) {
    const [family, given = ""] = s.split(",");
    return { given: clean(given), family: clean(family) };
  }
  const tokens = s.split(/\s+/).filter(Boolean);
  if (tokens.length === 1) return { given: "", family: clean(tokens[0]) };
  const last = tokens[tokens.length - 1];
  const first = tokens[0];
  if (isInitial(last) && !isInitial(first)) {
    return { given: clean(last), family: clean(tokens.slice(0, -1).join(" ")) };
  }
  if (isInitial(first) && !isInitial(last)) {
    return { given: clean(first), family: clean(tokens.slice(1).join(" ")) };
  }
  return { given: clean(first), family: clean(tokens.slice(1).join(" ")) };
}

export class OrcidClient {
  constructor({ baseUrl = DEFAULT_BASE_URL, fetchImpl = fetch, timeoutMs = 8000 } = {}) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
  }

  // Look up an author name. Returns a verification record; never throws — a
  // failed lookup is reported as unverified so it cannot break the research run.
  async verifyAuthor(name, { signal } = {}) {
    const { given, family } = parseAuthorName(name);
    const base = { name: String(name || "").trim(), found: false, orcidId: null, institutions: [], numFound: 0 };
    if (!family) return base;
    const terms = [`family-name:${family}`];
    if (given) terms.push(`given-names:${given}`);
    const q = encodeURIComponent(terms.join(" AND "));
    try {
      const res = await this.fetchImpl(`${this.baseUrl}/expanded-search/?q=${q}&rows=1`, {
        headers: { Accept: "application/json" },
        signal: signal ?? AbortSignal.timeout(this.timeoutMs)
      });
      if (!res.ok) return base;
      const data = await res.json();
      const numFound = Number(data["num-found"]) || 0;
      const top = Array.isArray(data["expanded-result"]) ? data["expanded-result"][0] : null;
      if (!top) return { ...base, numFound };
      return {
        ...base,
        found: true,
        orcidId: top["orcid-id"] || null,
        institutions: Array.isArray(top["institution-name"]) ? top["institution-name"] : [],
        numFound
      };
    } catch {
      return base;
    }
  }
}
