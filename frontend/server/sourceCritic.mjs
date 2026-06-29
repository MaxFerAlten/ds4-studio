/**
 * Source Critic — judges a fetched source instead of trusting it verbatim.
 *
 * Pure heuristics over (url, text): classify the source, score it, flag
 * limitations, and decide the next action. The agent uses this so it weighs an
 * editorial "Top 10" list differently from an official venue page or a link hub.
 *
 * Heuristics are deliberately conservative and tunable — they are a floor, not
 * a verifier. // ponytail: heuristic classifier; swap in an LLM judge if recall matters.
 */

import { extractUrls } from "./agentTaskState.mjs";

export const SOURCE_TYPES = {
  PRIMARY_OFFICIAL: "PRIMARY_OFFICIAL",
  RANKING_DATABASE: "RANKING_DATABASE",
  SECONDARY_EDITORIAL: "SECONDARY_EDITORIAL",
  LINK_HUB: "LINK_HUB",
  THIN_PAGE: "THIN_PAGE",
  UNRELATED: "UNRELATED",
  COMMERCIAL_NOISE: "COMMERCIAL_NOISE"
};

const THIN_PAGE_CHARS = 400;
const LINK_HUB_MIN_LINKS = 15; // §16.2: many links…
const LINK_HUB_MAX_WORDS = 600; // …and little prose

// Known ranking/bibliometric databases (host fragments).
const RANKING_HOSTS = [
  "core.edu.au", "portal.core.edu.au", "scimagojr.com", "scholar.google",
  "openalex.org", "dblp.org", "guide2research.com", "research.com"
];

function hostOf(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function isErrorOrBlocked(text) {
  return /\b(404|not found|access denied|forbidden|are you a robot|captcha|enable javascript to|page not available)\b/i.test(text);
}

export function isUnrelated(text) {
  // Text-only signal: an unusable page (error/blocked/empty) is "unrelated" for
  // our purposes. True topical relevance needs the query and is left to the model.
  return !text.trim() || isErrorOrBlocked(text);
}

/**
 * §16.2: a landing/hub page is many links with little prose (a calendar/listing
 * that points elsewhere rather than answering anything itself).
 * @param {{ content?: string, links?: string[] }} evidence
 */
export function detectLinkHub(evidence = {}) {
  const text = evidence.content || "";
  const links = evidence.links || extractUrls(text);
  const words = text.split(/\s+/).filter(Boolean).length;
  return links.length >= LINK_HUB_MIN_LINKS && words < LINK_HUB_MAX_WORDS;
}

export function isLinkHub(text) {
  return detectLinkHub({ content: text });
}

export function isThinPage(text) {
  return text.trim().length < THIN_PAGE_CHARS;
}

export function hasUsefulClaims(text) {
  return text.trim().length >= THIN_PAGE_CHARS && /[.!?]/.test(text);
}

const EDITORIAL_RE = /\btop\s*\d+|best\s+\w+|curated|ranking of|tier\s*1|must[- ]attend|our picks|editorial|listicle\b/i;
const COMMERCIAL_RE = /\b(affiliate|sponsored|buy now|add to cart|free trial|coupon|discount code|pricing plans?|sign up now)\b/i;

export function classifySourceType(url, text) {
  const host = hostOf(url);
  if (COMMERCIAL_RE.test(text)) return SOURCE_TYPES.COMMERCIAL_NOISE;
  if (RANKING_HOSTS.some((h) => host.includes(h))) return SOURCE_TYPES.RANKING_DATABASE;
  if ((host.endsWith(".gov") || host.endsWith(".edu") || host.endsWith(".org")) &&
      /call for papers|official|proceedings|submission deadline|program committee/i.test(text)) {
    return SOURCE_TYPES.PRIMARY_OFFICIAL;
  }
  if (EDITORIAL_RE.test(text)) return SOURCE_TYPES.SECONDARY_EDITORIAL;
  if (isLinkHub(text)) return SOURCE_TYPES.LINK_HUB;
  if (isUnrelated(text)) return SOURCE_TYPES.UNRELATED; // error/empty before thin
  if (isThinPage(text)) return SOURCE_TYPES.THIN_PAGE;
  return SOURCE_TYPES.SECONDARY_EDITORIAL;
}

export function classifyContentType(text) {
  if (isErrorOrBlocked(text)) return "error";
  if (EDITORIAL_RE.test(text) || /\n\s*[-*•]\s/.test(text)) return "ranking_or_list";
  if (hasUsefulClaims(text)) return "article";
  return "thin";
}

const QUALITY_BY_TYPE = {
  PRIMARY_OFFICIAL: "authoritative",
  RANKING_DATABASE: "authoritative",
  SECONDARY_EDITORIAL: "useful but not authoritative",
  LINK_HUB: "low",
  THIN_PAGE: "low",
  UNRELATED: "unusable",
  COMMERCIAL_NOISE: "unusable"
};

export function scoreQuality(url, text) {
  return QUALITY_BY_TYPE[classifySourceType(url, text)] || "unknown";
}

export function detectLimitations(text) {
  const limits = [];
  if (EDITORIAL_RE.test(text)) {
    limits.push("editorial ranking, not authoritative — verify rank/metrics against an official/primary source");
  }
  if (/subscribe to read|sign in to continue|members only|paywall/i.test(text)) {
    limits.push("paywalled/partial content");
  }
  if (isThinPage(text)) limits.push("little usable content");
  if (isErrorOrBlocked(text)) limits.push("page errored or blocked the crawler");
  return limits;
}

export function decideNextAction(url, text) {
  if (isUnrelated(text)) return "discard";
  if (isLinkHub(text)) return "extract_links_and_crawl_selected";
  if (isThinPage(text)) return "seek_better_source";
  if (hasUsefulClaims(text)) return "extract_claims";
  return "keep_with_low_confidence";
}

/**
 * @param {{ url?: string, content?: string, summary?: string }} evidence
 */
export function classifySource(evidence = {}) {
  const url = evidence.url || "";
  const text = evidence.content || evidence.summary || "";
  return {
    sourceType: classifySourceType(url, text),
    contentType: classifyContentType(text),
    quality: scoreQuality(url, text),
    limitations: detectLimitations(text),
    nextAction: decideNextAction(url, text)
  };
}

const ACTION_HINT = {
  discard: "discard — unrelated/unusable",
  extract_links_and_crawl_selected: "link hub — crawl the relevant links",
  seek_better_source: "thin — seek a better source",
  extract_claims: "extract claims",
  keep_with_low_confidence: "keep with low confidence"
};

/** One-line critique for embedding under a source/page in tool output. */
export function critiqueLine(evidence) {
  const c = classifySource(evidence);
  const limits = c.limitations.length ? ` | limits: ${c.limitations.join("; ")}` : "";
  return `↳ critique: ${c.sourceType} (${c.quality}) → ${ACTION_HINT[c.nextAction] || c.nextAction}${limits}`;
}
