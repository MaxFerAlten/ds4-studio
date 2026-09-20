/**
 * Evidence Store — structured memory for what the agent has read.
 *
 * Tool results today are just text dropped into the chat. This turns a crawl
 * manifest or a research source into normalized EvidenceItems (source type,
 * quality, limitations, extracted claims, follow-up links) so the final answer
 * can be built from judged evidence instead of a raw tool transcript (§11.4).
 *
 * Claim extraction is heuristic. // ponytail: regex claim sniffer; swap an LLM extractor if precision matters.
 */

import { createHash } from "node:crypto";
import { classifySource, SOURCE_TYPES } from "./sourceCritic.mjs";
import { extractUrls } from "./agentTaskState.mjs";

/**
 * The status a heuristically extracted sentence carries.
 *
 * It used to be SUPPORTED_BY_THIS_SOURCE, which claimed far more than the
 * regex behind it can establish: a sentence appearing in a page may be there
 * to deny the claim, to report it as rumour, to describe a different entity,
 * or to aggregate someone else's reporting. "Extracted from" is what actually
 * happened. Entailment is a separate step and a separate verdict.
 */
export const EXTRACTED_FROM_SOURCE = "EXTRACTED_FROM_SOURCE";

let _counter = 0;

const SUMMARY_CHARS = 600;
const MAX_CLAIMS = 5;
const MAX_NEXT_LINKS = 20;
// nextActions that still require work before the source is usable.
const UNRESOLVED_ACTIONS = new Set(["extract_links_and_crawl_selected", "seek_better_source"]);

// Sentences that look like a factual claim worth tracking/verifying.
const CLAIM_RE = /\d|%|\branks?\b|\branked\b|#\d|\bbest\b|\bfirst\b|\btop\b|\bdeadline\b|\bacceptance rate\b|\btier\b/i;

export function extractClaims(text, { max = MAX_CLAIMS, scope = "reported" } = {}) {
  const sentences = String(text || "")
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const claims = [];
  for (const sentence of sentences) {
    if (claims.length >= max) break;
    if (sentence.length > 300) continue; // skip undelimited blobs
    if (CLAIM_RE.test(sentence)) {
      claims.push({
        claim: sentence,
        status: EXTRACTED_FROM_SOURCE,
        scope,
        evidenceText: sentence
      });
    }
  }
  return claims;
}

/** SHA-256 over the evidence text, same convention as researchSources.mjs. */
export function evidenceContentHash(text) {
  return createHash("sha256").update(String(text || "")).digest("hex");
}

/**
 * Every field below `nextLinks` is additive provenance (QF-03 §25.3): what
 * produced this evidence, when, and over which bytes. Existing callers keep
 * working unchanged — they simply leave the new fields at their defaults.
 *
 * The distinction the old shape could not make is between a tool that actually
 * ran and prose describing a tool that ran. `evidenceType`, `toolCallId`,
 * `executionId` and `exactResult` exist so that difference survives into the
 * gate instead of being flattened into a text blob.
 */
export function normalizeEvidenceItem(item = {}) {
  const text = typeof item.contentSummary === "string" ? item.contentSummary : "";
  return {
    id: item.id || `ev_${Date.now()}_${++_counter}`,
    url: item.url || "",
    title: item.title || "",
    sourceType: item.sourceType || SOURCE_TYPES.SECONDARY_EDITORIAL,
    quality: item.quality || "unknown",
    acquisition: item.acquisition || "unknown",
    status: item.status || (text.trim() ? "FETCHED" : "EMPTY"),
    contentSummary: text,
    extractedClaims: Array.isArray(item.extractedClaims) ? item.extractedClaims : [],
    limitations: Array.isArray(item.limitations) ? item.limitations : [],
    nextAction: item.nextAction || "none",
    nextLinks: Array.isArray(item.nextLinks) ? item.nextLinks : [],

    evidenceType: item.evidenceType || "source_document",
    retrievedAt: item.retrievedAt || new Date().toISOString(),
    sourceHash: item.sourceHash || evidenceContentHash(text),
    toolName: item.toolName || "",
    toolCallId: item.toolCallId || "",
    executionId: item.executionId || "",
    // exactResult marks evidence read off a machine result rather than
    // summarised prose; isError marks a tool that ran and failed, which is
    // evidence too and must never read as a success.
    exactResult: item.exactResult === true,
    isError: item.isError === true,
    // What ran and how it ended (QF-11 §33). null, not 0: an absent exit code
    // means nothing reported one, and defaulting it to 0 would turn a tool
    // that never started into a successful run.
    command: item.command || "",
    exitCode: Number.isInteger(item.exitCode) ? item.exitCode : null,
    supportsClaimIds: Array.isArray(item.supportsClaimIds) ? item.supportsClaimIds : [],
    contradictsClaimIds: Array.isArray(item.contradictsClaimIds) ? item.contradictsClaimIds : [],
    sourceSpans: Array.isArray(item.sourceSpans) ? item.sourceSpans : []
  };
}

function scopeFor(sourceType) {
  if (sourceType === SOURCE_TYPES.SECONDARY_EDITORIAL) return "third_party_ranking";
  if (sourceType === SOURCE_TYPES.PRIMARY_OFFICIAL) return "official";
  return "reported";
}

/**
 * Build one EvidenceItem from a fetched source, fusing the source critic's
 * judgment with claim extraction.
 * @param {{ url?, title?, content?, summary?, state? }} evidence
 * @param {{ acquisition?: string }} [opts]
 */
export function buildEvidenceItem(evidence = {}, { acquisition = "unknown" } = {}) {
  const url = evidence.url || "";
  const title = evidence.title || "";
  const text = String(evidence.content || evidence.summary || "");
  const critique = classifySource({ url, content: text });
  const hasText = text.trim().length > 0;

  return normalizeEvidenceItem({
    url,
    title,
    sourceType: critique.sourceType,
    quality: critique.quality,
    acquisition,
    status: !hasText ? "EMPTY" : acquisition === "crawl" ? "CRAWLED" : "FETCHED",
    contentSummary: text.slice(0, SUMMARY_CHARS),
    extractedClaims: extractClaims(text, { scope: scopeFor(critique.sourceType) }),
    limitations: critique.limitations,
    nextAction: critique.nextAction,
    nextLinks: critique.nextAction === "extract_links_and_crawl_selected"
      ? extractUrls(text).slice(0, MAX_NEXT_LINKS)
      : []
  });
}

export function evidenceFromCrawlManifest(manifest) {
  const pages = Array.isArray(manifest?.pages) ? manifest.pages : [];
  return pages.map((page) => buildEvidenceItem(page, { acquisition: "crawl" }));
}

export function evidenceFromResearchSources(sources) {
  const list = Array.isArray(sources) ? sources : [];
  return list.map((source) => buildEvidenceItem(source, { acquisition: "research" }));
}

export class EvidenceStore {
  constructor() {
    this.items = [];
  }

  add(item) {
    const normalized = normalizeEvidenceItem(item);
    this.items.push(normalized);
    return normalized.id;
  }

  addMany(items = []) {
    return items.map((item) => this.add(item));
  }

  byUrl(url) {
    return this.items.filter((e) => e.url === url);
  }

  // Sources worth citing: not unrelated and not empty.
  useful() {
    return this.items.filter((e) => e.sourceType !== SOURCE_TYPES.UNRELATED && e.status !== "EMPTY");
  }

  // Sources that still need follow-up (crawl their links / find a better source).
  unresolved() {
    return this.items.filter((e) => UNRESOLVED_ACTIONS.has(e.nextAction));
  }
}
