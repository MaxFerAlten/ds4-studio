/**
 * DS4 Quantum Fix — bibliographic identity.
 *
 * QF-08 §30. A citation names a paper twice: once in prose (title, authors,
 * year) and once as an identifier (DOI, arXiv id). The failure this module
 * exists for is the two halves naming different papers — a real author/title
 * tuple carrying an identifier that resolves to something else. Both halves
 * look right in isolation, and the identifier is the half nobody reads.
 *
 * The resolver never decides a citation is fine because it is well-formed.
 * VERIFIED means an identifier was resolved against a provider and the record
 * it returned agrees with the prose. Everything short of that is PARTIAL:
 * §262's rule, that a check which could not run is not a check that passed.
 */

import { FAILURE_SEVERITY, SEVERITY } from "./epistemicContracts.mjs";

export const IDENTITY_VERDICT = Object.freeze({
  /** An identifier resolved and the record agrees with the prose. */
  VERIFIED: "VERIFIED",
  /** Nothing contradicts the citation, and nothing confirms its identity. */
  PARTIAL: "PARTIAL",
  /** The identifier resolves to a different paper than the prose names. */
  MISMATCH: "MISMATCH",
  /** The identifier resolves to nothing at all. */
  NOT_FOUND: "NOT_FOUND"
});

/** Title agreement at or above this counts as the same paper. */
const TITLE_MATCH = 0.6;
/** Below this the two titles are unrelated, not merely differently phrased. */
const TITLE_UNRELATED = 0.3;
/** Share of the cited authors that must appear in the resolved record. */
const AUTHOR_MATCH = 0.5;

/** A DOI reduced to its bare form, or null when the string is not one. */
export function normalizeDoi(value) {
  const doi = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/^(?:https?:\/\/)?(?:dx\.)?doi\.org\//, "")
    .replace(/^doi:\s*/, "");
  return /^10\.\d{4,9}\/\S+$/.test(doi) ? doi : null;
}

/** An arXiv id reduced to its bare, version-free form, or null. */
export function normalizeArxivId(value) {
  const id = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/^(?:https?:\/\/)?arxiv\.org\/(?:abs|pdf)\//, "")
    .replace(/^arxiv:\s*/, "")
    .replace(/\.pdf$/, "")
    .replace(/v\d+$/, "");
  // Modern (0710.2724) and pre-2007 (math.gt/0309136) forms.
  return /^\d{4}\.\d{4,5}$/.test(id) || /^[a-z-]+(?:\.[a-z]{2})?\/\d{7}$/.test(id) ? id : null;
}

const TITLE_STOPWORDS = new Set(["the", "a", "an", "of", "on", "in", "for", "and", "to", "with", "by"]);

export function titleTokens(title) {
  return String(title ?? "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !TITLE_STOPWORDS.has(t));
}

/**
 * Jaccard overlap of two titles' content words.
 *
 * Deliberately crude: it separates "the same paper, punctuated differently"
 * from "a different paper", which is the only distinction the verdict rests on.
 * An empty title on either side scores 0 — unknown, not agreeing.
 */
export function titleOverlap(a, b) {
  const left = new Set(titleTokens(a));
  const right = new Set(titleTokens(b));
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const token of left) if (right.has(token)) shared += 1;
  return shared / (left.size + right.size - shared);
}

/** The surname an author is likely to be indexed under. */
export function surname(name) {
  const parts = String(name ?? "")
    .toLowerCase()
    .replace(/[^\p{L}\s-]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
  return parts.length ? parts[parts.length - 1] : "";
}

/**
 * Share of the cited authors that appear in the resolved record.
 *
 * Surnames only: initials, ordering and transliteration vary between providers,
 * and none of that variation makes it a different person.
 */
export function authorOverlap(claimed = [], actual = []) {
  const cited = [...new Set(claimed.map(surname).filter(Boolean))];
  const found = new Set(actual.map(surname).filter(Boolean));
  if (cited.length === 0 || found.size === 0) return null;
  return cited.filter((s) => found.has(s)).length / cited.length;
}

function yearOf(value) {
  const m = String(value ?? "").match(/\b(1[6-9]\d{2}|20\d{2})\b/);
  return m ? Number(m[1]) : null;
}

/** Compare one resolved record against what the citation claimed. */
function compare(claimed, record) {
  const title = titleOverlap(claimed.title, record.title);
  const authors = authorOverlap(claimed.authors, record.authors);
  const recordYear = yearOf(record.publishedAt);
  const yearAgrees =
    claimed.year === null || recordYear === null ? null : Math.abs(claimed.year - recordYear) <= 1;

  const check = { source: record.source, titleOverlap: title, authorOverlap: authors, yearAgrees };

  // An identifier resolving to an unrelated paper is the §30 invariant, and it
  // holds whatever the authors say: a real author list attached to someone
  // else's identifier is exactly the shape being caught.
  if (title < TITLE_UNRELATED) return { verdict: IDENTITY_VERDICT.MISMATCH, check };
  if (title < TITLE_MATCH) {
    return authors !== null && authors >= AUTHOR_MATCH
      ? { verdict: IDENTITY_VERDICT.PARTIAL, check }
      : { verdict: IDENTITY_VERDICT.MISMATCH, check };
  }
  // Title agrees. Authors confirm identity; their absence leaves it unconfirmed
  // rather than confirmed, and a disagreeing year is a reason to look again.
  if (authors === null || authors < AUTHOR_MATCH || yearAgrees === false) {
    return { verdict: IDENTITY_VERDICT.PARTIAL, check };
  }
  return { verdict: IDENTITY_VERDICT.VERIFIED, check };
}

const RANK = { VERIFIED: 0, PARTIAL: 1, NOT_FOUND: 2, MISMATCH: 3 };

/**
 * Resolve a citation's identifiers and check them against its prose.
 *
 * @param {{title?: string, authors?: string[], doi?: string, arxivId?: string, year?: number|string}} citation
 * @param {{arxivProvider?: {lookup: Function}, openAlexProvider?: {lookup: Function}}} providers
 * @param {{renderedAsVerified?: boolean, signal?: AbortSignal}} [options]
 * @returns {Promise<{verdict: string, failureCodes: string[], severity: number, reason: string, claimed: object, resolved: object[], checks: object[], errors: string[]}>}
 */
export async function resolveBibliographicIdentity(citation = {}, providers = {}, options = {}) {
  const claimed = {
    title: String(citation.title ?? ""),
    authors: Array.isArray(citation.authors) ? citation.authors.map(String) : [],
    doi: normalizeDoi(citation.doi),
    arxivId: normalizeArxivId(citation.arxivId),
    year: yearOf(citation.year)
  };

  const resolved = [];
  const errors = [];
  // A cited identifier that is not identifier-shaped is dropped from the
  // lookups above, and would otherwise vanish silently — leaving a citation
  // carrying a made-up DOI indistinguishable from one carrying none.
  if (citation.doi && !claimed.doi) errors.push(`doi: "${citation.doi}" is not a DOI`);
  if (citation.arxivId && !claimed.arxivId) {
    errors.push(`arxiv: "${citation.arxivId}" is not an arXiv id`);
  }
  const lookups = [
    { id: claimed.arxivId, provider: providers.arxivProvider, name: "arxiv" },
    { id: claimed.doi, provider: providers.openAlexProvider, name: "openalex" }
  ];

  let attempted = 0;
  for (const { id, provider, name } of lookups) {
    if (!id) continue;
    if (typeof provider?.lookup !== "function") {
      errors.push(`${name}: no provider available to resolve ${id}`);
      continue;
    }
    attempted += 1;
    try {
      const record = await provider.lookup(id, { signal: options.signal });
      if (record) resolved.push({ ...record, requestedId: id });
    } catch (err) {
      // A provider that failed says nothing about the citation. Treating a
      // network fault as a missing paper would manufacture an F01.
      errors.push(`${name}: ${String(err?.message ?? err)}`);
    }
  }

  const finish = (verdict, reason, checks = []) => {
    const failureCodes =
      verdict === IDENTITY_VERDICT.MISMATCH
        ? ["F17"]
        : verdict === IDENTITY_VERDICT.NOT_FOUND
          ? ["F01"]
          : [];
    return {
      verdict,
      failureCodes,
      // §30: a mismatch rendered to the user as a verified citation is S5. The
      // failure is the same; presenting it as settled is what makes it critical.
      severity: failureCodes.length
        ? options.renderedAsVerified === true
          ? SEVERITY.CRITICAL
          : Math.max(...failureCodes.map((c) => FAILURE_SEVERITY[c] ?? SEVERITY.CRITICAL))
        : SEVERITY.NONE,
      reason,
      claimed,
      resolved,
      checks,
      errors
    };
  };

  if (!claimed.doi && !claimed.arxivId) {
    return finish(
      IDENTITY_VERDICT.PARTIAL,
      "no resolvable identifier: a title and an author list cannot establish which paper this is"
    );
  }
  if (attempted === 0) {
    return finish(IDENTITY_VERDICT.PARTIAL, "no provider could resolve the cited identifier");
  }
  if (resolved.length === 0) {
    return errors.length > 0
      ? finish(IDENTITY_VERDICT.PARTIAL, `identifier lookup failed: ${errors.join("; ")}`)
      : finish(IDENTITY_VERDICT.NOT_FOUND, "the cited identifier resolves to no record");
  }
  if (titleTokens(claimed.title).length === 0) {
    return finish(
      IDENTITY_VERDICT.PARTIAL,
      "the identifier resolved but the citation carried no title to compare it against"
    );
  }

  const results = resolved.map((record) => compare(claimed, record));
  const checks = results.map((r) => r.check);

  // Two identifiers that resolve to different papers is a mismatch even when
  // each agrees with the prose on its own.
  if (resolved.length > 1 && titleOverlap(resolved[0].title, resolved[1].title) < TITLE_UNRELATED) {
    return finish(
      IDENTITY_VERDICT.MISMATCH,
      "the cited DOI and arXiv id resolve to different papers",
      checks
    );
  }

  const worst = results.reduce((a, b) => (RANK[b.verdict] > RANK[a.verdict] ? b : a));
  const reasons = {
    [IDENTITY_VERDICT.VERIFIED]: "the identifier resolves to the paper the citation names",
    [IDENTITY_VERDICT.PARTIAL]: "the identifier resolved but identity could not be confirmed",
    [IDENTITY_VERDICT.MISMATCH]: "the identifier resolves to a different paper than the citation names"
  };
  return finish(worst.verdict, reasons[worst.verdict], checks);
}
