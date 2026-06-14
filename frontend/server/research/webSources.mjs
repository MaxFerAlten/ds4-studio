// Helpers shared by the web-search providers: URL canonicalization, content-
// stable hashing, dedup, source-type trust weighting, and ranking. These build
// "web raw sources" that the graph later folds into the unified source list
// (which assigns the citation ids).

import { createHash } from "node:crypto";

const TRACKING_PARAMS = new Set([
  "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
  "fbclid", "gclid", "mc_cid", "mc_eid", "ref", "ref_src"
]);

const TRUST_BY_SOURCE_TYPE = {
  official: 1.0,
  paper: 0.95,
  dataset: 0.95,
  docs: 0.9,
  encyclopedia: 0.75,
  news: 0.7,
  blog: 0.55,
  forum: 0.4,
  unknown: 0.35
};

export function canonicalUrl(rawUrl) {
  try {
    const u = new URL(rawUrl);
    u.protocol = u.protocol === "http:" ? "https:" : u.protocol;
    u.hash = "";
    for (const p of [...u.searchParams.keys()]) {
      if (TRACKING_PARAMS.has(p.toLowerCase())) u.searchParams.delete(p);
    }
    u.hostname = u.hostname.replace(/^www\./, "").toLowerCase();
    if (u.pathname.length > 1) u.pathname = u.pathname.replace(/\/+$/, "");
    return u.toString().replace(/\/$/, "");
  } catch {
    return String(rawUrl || "").trim();
  }
}

export function domainOf(rawUrl) {
  try {
    return new URL(rawUrl).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

export function stableSourceHash({ provider = "", url = "", title = "" }) {
  const key = `${provider}|${canonicalUrl(url)}|${String(title).trim().toLowerCase()}`;
  return createHash("sha256").update(key).digest("hex").slice(0, 12);
}

export function trustWeight(sourceType) {
  return TRUST_BY_SOURCE_TYPE[sourceType] ?? TRUST_BY_SOURCE_TYPE.unknown;
}

function domainBoost(url) {
  const d = domainOf(url);
  if (!d) return 0;
  if (d.endsWith(".gov")) return 0.15;
  if (d.endsWith(".edu")) return 0.1;
  if (d.endsWith(".int")) return 0.1;
  if (d === "arxiv.org" || d.endsWith(".arxiv.org")) return 0.1;
  if (d === "openalex.org" || d.endsWith(".openalex.org")) return 0.1;
  return 0;
}

// Normalize one provider result into a "web raw source".
export function toWebSource(raw, { provider, query, platform } = {}) {
  const url = raw.url || "";
  const sourceType = raw.sourceType || "unknown";
  const snippet = String(raw.snippet || raw.content || "").slice(0, 2000);
  return {
    kind: "web",
    provider: raw.provider || provider || "unknown",
    platform: raw.platform || platform || null,
    query: raw.query || query || "",
    hash: stableSourceHash({ provider: raw.provider || provider, url, title: raw.title }),
    title: raw.title || url || "untitled",
    url,
    canonicalUrl: canonicalUrl(url),
    authors: Array.isArray(raw.authors) ? raw.authors : [],
    snippet,
    content: String(raw.content || raw.snippet || ""),
    sourceType,
    providerRank: typeof raw.providerRank === "number" ? raw.providerRank : null,
    providerScore: typeof raw.score === "number" ? raw.score : 0,
    trustWeight: trustWeight(sourceType),
    publishedAt: raw.publishedAt || null,
    retrievedAt: new Date().toISOString(),
    raw: raw.raw || null
  };
}

// Dedup web sources by canonical URL (then by hash). First occurrence wins but
// records the union of providers that surfaced it.
export function dedupeWebSources(sources = []) {
  const byKey = new Map();
  for (const s of sources) {
    const key = s.canonicalUrl || s.hash;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, { ...s, providers: [s.provider] });
    } else if (!existing.providers.includes(s.provider)) {
      existing.providers.push(s.provider);
    }
  }
  return [...byKey.values()];
}

function rankScore(s) {
  const providerRankScore = s.providerRank ? 1 / s.providerRank : s.providerScore || 0.3;
  const multiProvider = (s.providers?.length || 1) > 1 ? 0.1 : 0;
  const emptyPenalty = s.content && s.content.length > 80 ? 0 : -0.15;
  return providerRankScore * 0.35 + s.trustWeight * 0.4 + domainBoost(s.url) + multiProvider + emptyPenalty;
}

// Rank deduped web sources, attach the computed score, and cap the total.
export function rankWebSources(sources = [], { maxSourcesTotal = 30 } = {}) {
  return sources
    .map((s) => ({ ...s, score: Number(rankScore(s).toFixed(4)) }))
    .sort((a, b) => b.score - a.score || (a.hash < b.hash ? -1 : 1))
    .slice(0, maxSourcesTotal);
}
