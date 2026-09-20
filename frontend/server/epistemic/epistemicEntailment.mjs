/**
 * DS4 Quantum Fix — citation entailment.
 *
 * QF-09 §31. QF-08 answers "is this the paper the citation names". This answers
 * the next question, and the one that actually decides whether a claim earned
 * its source: does the paper say what is being attributed to it. A correctly
 * resolved DOI attached to a claim the paper never makes is still F02.
 *
 * Fail closed, per §31. Without a semantic verifier a claim cannot become
 * SOURCE_FACT VERIFIED on an entailment-sensitive use. What it may become is
 * "the source exists, support UNKNOWN" — which is the honest reading of having
 * found a paper and not having read it.
 */

import { FAILURE_SEVERITY, SEVERITY } from "./epistemicContracts.mjs";
import { ENTAILMENT_PROMPT } from "./epistemicPrompts.mjs";

export const ENTAILMENT_VERDICT = Object.freeze({
  /** The passages assert the claim. */
  SUPPORTED: "SUPPORTED",
  /** Some of the claim is supported; the rest is not. */
  PARTIAL: "PARTIAL",
  /** The passages were read and say nothing about the claim. */
  ABSENT: "ABSENT",
  /** The passages assert the opposite. */
  CONTRADICTED: "CONTRADICTED",
  /** Nothing was read, or nothing legible came back. Not a verdict on the claim. */
  UNKNOWN: "UNKNOWN"
});

const MODEL_VERDICTS = new Set(Object.keys(ENTAILMENT_VERDICT));
const MAX_PASSAGE_CHARS = 4000;
const MAX_PASSAGES = 12;

/** Passage text, from whichever shape the retrieval stage produced. */
function passageText(passage) {
  if (typeof passage === "string") return passage;
  return String(passage?.text ?? passage?.content ?? passage?.snippet ?? "");
}

function normalizePassages(passages) {
  return (Array.isArray(passages) ? passages : [])
    .map((p, i) => ({
      id: (typeof p === "object" && p?.id) || `p${i + 1}`,
      text: passageText(p).slice(0, MAX_PASSAGE_CHARS).trim()
    }))
    .filter((p) => p.text.length > 0)
    .slice(0, MAX_PASSAGES);
}

/** Text reduced to what a quote and its passage share when both are the same. */
function loose(text) {
  return String(text ?? "")
    .toLowerCase()
    .replace(/[\p{P}\p{S}]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Keep only the spans that are actually in the passages.
 *
 * A quoted span is the model's evidence for its own verdict. One that appears
 * in no passage was written rather than found, and a verdict resting on it
 * rests on nothing.
 */
export function verifySpans(spans, passages) {
  const haystack = passages.map((p) => loose(p.text));
  const supporting = [];
  const fabricated = [];
  for (const raw of Array.isArray(spans) ? spans : []) {
    const span = String(raw ?? "").trim();
    if (!span) continue;
    const needle = loose(span);
    if (needle && haystack.some((text) => text.includes(needle))) supporting.push(span);
    else fabricated.push(span);
  }
  return { supporting, fabricated };
}

function result({ verdict, reason, spans = [], unsupported = [], fabricated = [], passageCount = 0 }) {
  // F02 is the code for a source that does not carry the claim. PARTIAL and
  // UNKNOWN are not failures: one is an incomplete claim, the other is an
  // unread source, and neither is the source contradicting anything.
  const failureCodes =
    verdict === ENTAILMENT_VERDICT.ABSENT || verdict === ENTAILMENT_VERDICT.CONTRADICTED
      ? ["F02"]
      : [];
  return {
    verdict,
    // The fail-closed gate §31 asks for, in one field: only an actual
    // SUPPORTED verdict lets a claim be published as a source fact.
    canSupportSourceFact: verdict === ENTAILMENT_VERDICT.SUPPORTED,
    failureCodes,
    severity: failureCodes.length ? FAILURE_SEVERITY.F02 : SEVERITY.NONE,
    reason,
    supportingSpans: spans,
    unsupportedSubclaims: unsupported,
    fabricatedSpans: fabricated,
    passageCount
  };
}

/**
 * Judge whether the retrieved passages support one atomic claim.
 *
 * @param {object} options
 * @param {object|string} options.claim - the claim, or its text.
 * @param {object} [options.source] - a normalized source (QF-08 §30.3).
 * @param {Array<string|object>} [options.passages] - passages already retrieved.
 * @param {object} [options.client] - a StructuredModelClient, or null.
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<{verdict: string, canSupportSourceFact: boolean, failureCodes: string[], severity: number, reason: string, supportingSpans: string[], unsupportedSubclaims: string[], fabricatedSpans: string[], passageCount: number}>}
 */
export async function checkEntailment({ claim, source = null, passages = [], client = null, signal } = {}) {
  const claimText = String(typeof claim === "string" ? claim : (claim?.text ?? "")).trim();
  if (!claimText) {
    return result({ verdict: ENTAILMENT_VERDICT.UNKNOWN, reason: "no claim text to check" });
  }

  const items = normalizePassages(passages);
  if (items.length === 0) {
    // Not ABSENT: ABSENT means the source was read and is silent. Nothing was
    // read here, and calling that silence would put words in the paper.
    return result({
      verdict: ENTAILMENT_VERDICT.UNKNOWN,
      reason: "no passages were retrieved from the source; its support is unread, not missing"
    });
  }

  if (!client || typeof client.completeRole !== "function") {
    return result({
      verdict: ENTAILMENT_VERDICT.UNKNOWN,
      reason: "no semantic verifier available; the source exists and its support for the claim is unknown",
      passageCount: items.length
    });
  }

  let response;
  try {
    response = await client.completeRole({
      roleName: "epistemic_entailment",
      systemPrompt: ENTAILMENT_PROMPT,
      userPrompt: JSON.stringify({
        claim: claimText,
        source: source
          ? { id: source.id ?? null, title: source.title ?? null, doi: source.doi ?? null, arxivId: source.arxivId ?? null }
          : null,
        passages: items
      }),
      json: true,
      signal
    });
  } catch (err) {
    return result({
      verdict: ENTAILMENT_VERDICT.UNKNOWN,
      reason: `entailment check failed: ${String(err?.message ?? err)}`,
      passageCount: items.length
    });
  }

  const json = response?.json;
  const verdict = MODEL_VERDICTS.has(json?.verdict) ? json.verdict : null;
  if (!verdict) {
    return result({
      verdict: ENTAILMENT_VERDICT.UNKNOWN,
      reason: "the entailment verifier returned no usable verdict",
      passageCount: items.length
    });
  }

  const { supporting, fabricated } = verifySpans(json.supportingSpans, items);
  const unsupported = (Array.isArray(json.unsupportedSubclaims) ? json.unsupportedSubclaims : [])
    .map(String)
    .filter(Boolean);
  const reason = String(json.reason ?? "").slice(0, 1000);

  // A SUPPORTED verdict whose every quote is missing from the passages is a
  // verdict about something other than this source.
  if (verdict === ENTAILMENT_VERDICT.SUPPORTED && supporting.length === 0) {
    return result({
      verdict: ENTAILMENT_VERDICT.UNKNOWN,
      reason: fabricated.length
        ? "the verifier reported support but none of its quoted spans appear in the passages"
        : "the verifier reported support without quoting the passage that carries it",
      unsupported,
      fabricated,
      passageCount: items.length
    });
  }

  return result({
    verdict,
    reason: reason || `entailment verifier returned ${verdict}`,
    spans: supporting,
    unsupported,
    fabricated,
    passageCount: items.length
  });
}
