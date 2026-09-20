/**
 * Q2-003 (remediation.Quantiom.002 §6) — strict claim coverage.
 *
 * RC-02: under a contract that governs *every* assertive claim, a response is
 * only as verified as the extractor's reach. If a factual sentence never became
 * a claim it was never verified, and the answer can be "fully verified" with an
 * unchecked assertion sitting in it — the cheapest possible false green.
 *
 * The segmentation is deliberately blunt. It counts sentences, drops the things
 * that plainly assert nothing (headings, fences, questions, explicit
 * inability), and asks whether each survivor was bound to a claim. Anything it
 * cannot bind is uncovered, which is the safe side.
 */

import { VERIFICATION_COVERAGE_MODE } from "./epistemicUserVerificationContract.mjs";

const FENCE = /^\s*(?:```|~~~)/;
const HEADING = /^\s*#{1,6}\s/;
const LIST_BULLET_ONLY = /^\s*(?:[-*+]|\d+[.)])\s*$/;
const TABLE_ROW = /^\s*\|/;
const BLOCK_MATH = /^\s*(?:\$\$|\\\[|\\\])/;

/**
 * Wording in which the answer says it did NOT establish something. §6.2: this
 * is the honest disclosure the contract explicitly allows, so counting it as an
 * uncovered assertion would punish exactly the repair we want.
 */
const EXPLICIT_UNCERTAINTY =
  /\b(?:non\s+(?:sono\s+riuscit\w+|ho\s+potuto|e\s+stato\s+possibile|risulta)\b|non\s+(?:e|è)\s+(?:stat[oaie]\s+)?(?:un[ao']?\s+)?(?:verificat|dimostrat|certificat|prov[ae]|dimostrazion|meccanism)\w*|resta\s+(?:non\s+verificat\w+|apert\w+|ignot\w+)|non\s+verificat\w+|sconosciut\w+|i\s+(?:could\s+not|was\s+not\s+able\s+to|cannot|can't)\b|not\s+(?:verified|established|proven|checked|certified|a\s+proof)\b|remains?\s+(?:unverified|unknown|open|an\s+analogy|a\s+hypothesis)\b|unknown\b)/iu;

/**
 * §6.2, §31 — a sentence that reports what kind of statement something is,
 * rather than asserting it. "This remains an analogy" and "C^V is an auxiliary
 * construction" are the disclosures the strict contract asks for; counting them
 * as uncovered assertions would make the honest repair unpublishable.
 */
const EPISTEMIC_FRAMING =
  /\b(?:resta\s+un[ao']?\s*(?:analogia|ipotesi|congettura|modello)|(?:e|è)\s+un[ao']?\s*(?:analogia|ipotesi|congettura|costruzione\s+ausiliaria|modello\s+ausiliario)|costruzione\s+ausiliaria|modello\s+giocattolo|is\s+an\s+analogy|is\s+a\s+hypothesis|is\s+an\s+auxiliary\s+(?:construction|model)|quantum[-\s]inspired\s+analogy)/iu;

/** Minimum length before a fragment counts as an assertion at all. */
const MIN_ASSERTIVE_CHARS = 12;

function stripFences(content) {
  const lines = String(content ?? "").split(/\r?\n/);
  const kept = [];
  let inFence = false;
  for (const line of lines) {
    if (FENCE.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    if (HEADING.test(line)) continue;
    if (TABLE_ROW.test(line)) continue;
    if (BLOCK_MATH.test(line)) continue;
    if (LIST_BULLET_ONLY.test(line)) continue;
    kept.push(line);
  }
  return kept.join("\n");
}

function sentences(text) {
  return String(text ?? "")
    .split(/(?<=[.!?])\s+|\n{2,}/)
    .map((sentence) => sentence.replace(/^\s*(?:[-*+]|\d+[.)])\s*/, "").trim())
    .filter(Boolean);
}

/** Whether a sentence asserts something the contract governs. */
function isAssertive(sentence) {
  if (sentence.length < MIN_ASSERTIVE_CHARS) return false;
  if (sentence.endsWith("?")) return false;
  if (EXPLICIT_UNCERTAINTY.test(sentence)) return false;
  if (EPISTEMIC_FRAMING.test(sentence)) return false;
  // A line with no letters is formatting, not a proposition.
  return /\p{L}{3}/u.test(sentence);
}

function tokens(text) {
  return new Set(
    String(text ?? "")
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((word) => word.length >= 3)
  );
}

// Short symbolic labels ("Claim A"/"Claim B", "C1"/"C2") carry the
// proposition identity but are intentionally absent from the content-word
// token set. Preserve them so high lexical overlap cannot bind the wrong atom.
function discriminators(text) {
  return new Set(String(text ?? "").match(/\b(?:[A-Z]|[A-Za-z]+\d+)\b/g) ?? []);
}

/**
 * Whether an extracted claim covers this sentence. Substring first (the usual
 * case: the extractor returns the sentence verbatim), then a token-overlap
 * fallback for lightly reworded claims.
 */
function boundToClaim(sentence, claimIndex) {
  const lower = sentence.toLowerCase();
  for (const { lower: claimLower, tokens: claimTokens, discriminators: claimDiscriminators } of claimIndex) {
    if (!claimLower) continue;
    if (lower.includes(claimLower) || claimLower.includes(lower)) return true;
    if (claimTokens.size === 0) continue;
    const sentenceTokens = tokens(sentence);
    if (sentenceTokens.size === 0) continue;
    const sentenceDiscriminators = discriminators(sentence);
    if (
      claimDiscriminators.size > 0 &&
      sentenceDiscriminators.size > 0 &&
      ![...claimDiscriminators].some((token) => sentenceDiscriminators.has(token))
    ) {
      continue;
    }
    let overlap = 0;
    for (const token of claimTokens) if (sentenceTokens.has(token)) overlap += 1;
    // Most of the claim's content words present in the sentence: the same
    // proposition, reworded. Anything looser would bind unrelated sentences.
    if (overlap / claimTokens.size >= 0.7) return true;
  }
  return false;
}

/**
 * Measure how much of the answer the contract actually governs and how much of
 * that reached a claim.
 *
 * @param {{assistantContent?: string, claims?: object[], verificationContract?: object, extractionStatus?: string}} input
 * @returns {{mode: string, assertiveSpanCount: number, boundClaimCount: number, uncoveredSpans: string[], coverage: number, extractionComplete: boolean, complete: boolean}}
 */
export function evaluateClaimCoverage({
  assistantContent = "",
  claims = [],
  verificationContract = null,
  extractionStatus = "EXTRACTION_PARTIAL"
} = {}) {
  const mode = verificationContract?.coverageMode ?? VERIFICATION_COVERAGE_MODE.DEFAULT;
  const strict = mode === VERIFICATION_COVERAGE_MODE.ALL_ASSERTIVE_CLAIMS;
  const extractionComplete = extractionStatus === "EXTRACTION_COMPLETE";

  if (!strict) {
    return Object.freeze({
      mode,
      assertiveSpanCount: 0,
      boundClaimCount: 0,
      uncoveredSpans: Object.freeze([]),
      coverage: 1,
      extractionComplete,
      complete: true
    });
  }

  const claimIndex = (Array.isArray(claims) ? claims : [])
    .filter(Boolean)
    .map((claim) => {
      const text = String(claim.text ?? "").trim();
      return {
        lower: text.toLowerCase(),
        tokens: tokens(text),
        discriminators: discriminators(text)
      };
    });

  const spans = sentences(stripFences(assistantContent)).filter(isAssertive);
  const uncovered = spans.filter((span) => !boundToClaim(span, claimIndex));
  const bound = spans.length - uncovered.length;
  // §55: no rounding. 999/1000 is not 1.
  const coverage = spans.length === 0 ? 1 : bound / spans.length;

  return Object.freeze({
    mode,
    assertiveSpanCount: spans.length,
    boundClaimCount: bound,
    uncoveredSpans: Object.freeze(uncovered.slice(0, 20)),
    coverage,
    extractionComplete,
    complete: extractionComplete && uncovered.length === 0
  });
}
