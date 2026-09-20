/**
 * Citation entailment for the research reporter (QF-19 §41).
 *
 * The reporter already cites only ids that exist, and formatCitations already
 * enforces that deterministically. Neither answers the question that matters:
 * does the passage behind [src_007] actually say what the sentence citing it
 * says. A real paper on the right topic is not evidence for a formula it does
 * not contain.
 *
 * So this is a layer before publication, not a change to formatCitations —
 * §41 is explicit that formatCitations stays deterministic id integrity and
 * never becomes an LLM verifier. This reads the bindings out of the report,
 * checks each against the supplied passages, and removes the ones the source
 * refutes or is silent on. Bindings it could not check are left alone: an
 * unchecked citation is not a disproved one.
 */

import { ENTAILMENT_VERDICT, checkEntailment } from "../epistemic/epistemicEntailment.mjs";

const SOURCE_ID = /\bsrc_\d{3,}\b/g;
const DEFAULT_MAX_CHECKS = 12;

/** Split a report into sentences, keeping the offsets so edits stay local. */
function sentences(markdown) {
  const text = String(markdown ?? "");
  const out = [];
  let start = 0;
  // A single newline counts: a report is markdown, and a heading or a list
  // item on its own line is its own unit even without terminal punctuation.
  const boundary = /(?<=[.!?])\s+|\n+/g;
  let match;
  while ((match = boundary.exec(text))) {
    out.push({ text: text.slice(start, match.index), start, end: match.index });
    start = boundary.lastIndex;
  }
  if (start < text.length) out.push({ text: text.slice(start), start, end: text.length });
  return out.filter((s) => s.text.trim().length > 0);
}

/**
 * The claim/source bindings a report asserts: one per sentence that cites.
 *
 * The sentence is the claim. A citation at the end of a paragraph binds to the
 * sentence it sits in, which is the granularity the reporter writes at.
 */
export function citationBindings(markdown) {
  const bindings = [];
  for (const sentence of sentences(markdown)) {
    const ids = [...new Set(sentence.text.match(SOURCE_ID) ?? [])];
    if (ids.length === 0) continue;
    bindings.push({
      claim: sentence.text
        .replace(SOURCE_ID, "")
        .replace(/\[\s*\]/g, "")
        .replace(/\s+/g, " ")
        // The removed citation leaves a gap before the full stop.
        .replace(/\s+([.,;:!?])/g, "$1")
        .trim(),
      sourceIds: ids,
      start: sentence.start,
      end: sentence.end
    });
  }
  return bindings;
}

/** The passages a source can be checked against. */
function passagesOf(source) {
  if (Array.isArray(source?.chunks) && source.chunks.length > 0) return source.chunks;
  const text = String(source?.content || source?.snippet || "");
  return text.trim() ? [text] : [];
}

/**
 * Check every citation binding in a report against its source's passages.
 *
 * @param {object} input
 * @param {string} input.markdown - the drafted report.
 * @param {object[]} input.sources - normalized sources.
 * @param {object} [input.client] - a model client with completeRole.
 * @param {number} [input.maxChecks] - bound on model calls per report.
 * @param {AbortSignal} [input.signal]
 * @returns {Promise<{findings: object[], checked: number, unsupported: number, partial: number, unchecked: number}>}
 */
export async function verifyCitationBindings({
  markdown,
  sources = [],
  client = null,
  maxChecks = DEFAULT_MAX_CHECKS,
  signal
} = {}) {
  const byId = new Map((sources ?? []).map((s) => [s?.id, s]).filter(([id]) => id));
  const findings = [];
  let checked = 0;

  for (const binding of citationBindings(markdown)) {
    for (const sourceId of binding.sourceIds) {
      const source = byId.get(sourceId);
      if (!source) {
        // formatCitations already reports an id that resolves to nothing; this
        // layer has nothing to check and says so rather than guessing.
        findings.push({ ...binding, sourceId, verdict: ENTAILMENT_VERDICT.UNKNOWN, reason: "unknown source id" });
        continue;
      }
      if (checked >= maxChecks) {
        findings.push({ ...binding, sourceId, verdict: ENTAILMENT_VERDICT.UNKNOWN, reason: "check budget exhausted" });
        continue;
      }
      checked += 1;
      const result = await checkEntailment({
        claim: binding.claim,
        source,
        passages: passagesOf(source),
        client,
        signal
      });
      findings.push({
        ...binding,
        sourceId,
        verdict: result.verdict,
        reason: result.reason,
        supportingSpans: result.supportingSpans,
        unsupportedSubclaims: result.unsupportedSubclaims
      });
    }
  }

  const count = (verdict) => findings.filter((f) => f.verdict === verdict).length;
  return {
    findings,
    checked,
    unsupported: count(ENTAILMENT_VERDICT.ABSENT) + count(ENTAILMENT_VERDICT.CONTRADICTED),
    partial: count(ENTAILMENT_VERDICT.PARTIAL),
    unchecked: count(ENTAILMENT_VERDICT.UNKNOWN)
  };
}

/**
 * Remove the citation ids whose binding the source does not support.
 *
 * Only ABSENT and CONTRADICTED are stripped. PARTIAL keeps its citation — the
 * source does support part of the claim — and UNKNOWN keeps it because nothing
 * was established: removing a citation nobody checked would assert a conclusion
 * this layer does not have.
 *
 * The prose is untouched. Only the binding is withdrawn, which is what stops
 * the Fonti list from implying a support that was never there.
 */
export function stripUnsupportedCitations(markdown, findings = []) {
  const refuted = new Map();
  for (const finding of findings) {
    if (finding.verdict !== ENTAILMENT_VERDICT.ABSENT && finding.verdict !== ENTAILMENT_VERDICT.CONTRADICTED) {
      continue;
    }
    if (!refuted.has(finding.start)) refuted.set(finding.start, { end: finding.end, ids: new Set() });
    refuted.get(finding.start).ids.add(finding.sourceId);
  }
  if (refuted.size === 0) return { markdown: String(markdown ?? ""), removed: [] };

  const text = String(markdown ?? "");
  const removed = [];
  // Right to left so the offsets of the untouched spans stay valid.
  const spans = [...refuted.entries()].sort((a, b) => b[0] - a[0]);
  let out = text;
  for (const [start, { end, ids }] of spans) {
    let segment = out.slice(start, end);
    for (const id of ids) {
      const pattern = new RegExp(`\\s*\\[\\s*${id}\\s*\\]`, "g");
      if (pattern.test(segment)) {
        segment = segment.replace(pattern, "");
        removed.push(id);
      }
    }
    out = out.slice(0, start) + segment + out.slice(end);
  }
  return { markdown: out, removed: [...new Set(removed)] };
}
