/**
 * Claim guard — cheap lexical bridge (Quantum Fix QF-05 §27).
 *
 * What this file does NOT do: decide that something is verified. It is regex
 * over prose. It marks a passage as a high-risk candidate and says which kind
 * of evidence the wording is implicitly promising; the verdict belongs to the
 * verifiers and the promotion gate.
 *
 * §73 is explicit that this must stay lexical — no LLM call here. It runs on
 * every completed response, so it has to be cheap enough to be unconditional.
 */

const STRONG_CLAIM_RE =
  /\b(fixato|corretto|validato|compilato|verificato|verified|proved|dimostrato|dimostrata|tested|confirmed|fixed|validated|make cpu|certify_all|passa|passed)\b|\bstato\s*:\s*verified\b|\blean ha verificato\b/i;

const CLAIM_NEGATION_RE =
  /\b(?:not|never|without|isn't|aren't|wasn't|weren't|hasn't|haven't|hadn't|can't|cannot|couldn't|didn't|doesn't|won't|wouldn't)\b(?:\s+(?:yet|been|still|currently|actually|really|ever|fully|formally|necessarily|successfully|truly|as\s+yet|so\s+far)){0,3}\s*$|\bnon\b(?:\s+(?:è|e|era|sono|stato|stata|ancora|risulta|risultato|risultata|abbiamo|ho|hanno|ha|si|sia|stati|state)){0,4}\s*$/i;

const DOCUMENTED_CLAIM_RE =
  /\b(il documento dichiara|il file dichiara|document states|according to the document|nel documento)\b/i;

const EVIDENCE_RE =
  /\b(make cpu|certify_all|node --test|gitnexus detect|detect_changes|diff --git|test result|exit code 0|passed|status=checked|lean_result_v1)\b/i;

/**
 * Wording that asserts more than prose can establish, by category.
 *
 * Both languages, because the assistant answers in either and a guard that
 * only reads English is a guard with a documented bypass.
 */
export const PROTECTED_LANGUAGE = Object.freeze({
  VERIFICATION:
    /\b(verified|confirmed|validated|proved|proven|theorem|verificato|verificata|confermato|confermata|validato|validata|dimostrato|dimostrata|teorema)\b/i,
  EXECUTION:
    /\b(working code|works correctly|ran successfully|executed|tested|passes tests|passed the tests|benchmarked|benchmark shows|codice funzionante|eseguito|eseguita|testato|testata|i test passano)\b/i,
  OBSERVATION:
    /\b(we measured|i measured|measured|observed|internal analysis|our analysis|spectrum shows|experiment shows|experiment confirmed|abbiamo misurato|misurato|osservato|analisi interna|l'esperimento (?:mostra|conferma))\b/i,
  BIBLIOGRAPHIC_PRECISION:
    /\b(exact doi|exact arxiv|doi\s*:\s*10\.|arxiv\s*:\s*\d{4}\.\d{4,5}|doi esatto)\b/i,
  OFFICIALITY:
    /\b(official|officially|exact architecture|real value|ground truth|verified value|ufficiale|ufficialmente|architettura esatta|valore reale)\b/i
});

/**
 * The evidence each category's wording implicitly promises. These are hints
 * for the verifier stage, not a verdict.
 */
export const CATEGORY_REQUIREMENTS = Object.freeze({
  VERIFICATION: "verifier_result",
  EXECUTION: "execution_evidence",
  OBSERVATION: "observation_evidence",
  BIBLIOGRAPHIC_PRECISION: "source_identity",
  OFFICIALITY: "primary_source"
});

/**
 * Which protected categories a passage uses.
 *
 * @param {string} text
 * @returns {{highRiskCandidate: boolean, protectedClaims: {category: string, match: string}[], requirements: string[]}}
 */
export function scanProtectedLanguage(text) {
  const content = String(text || "");
  const protectedClaims = [];
  for (const [category, re] of Object.entries(PROTECTED_LANGUAGE)) {
    const found = content.match(re);
    if (found) protectedClaims.push({ category, match: found[0] });
  }
  return {
    // "Candidate", not "violation": the wording is worth verifying, which is
    // not the same as the wording being wrong.
    highRiskCandidate: protectedClaims.length > 0,
    protectedClaims,
    requirements: [...new Set(protectedClaims.map((c) => CATEGORY_REQUIREMENTS[c.category]))]
  };
}

/**
 * @param {string} text - the assistant's completed response.
 * @param {string} [evidenceText] - the turn's evidence, as text.
 * @param {{mode?: "block"|"warn"}} [options]
 * @returns {undefined|{block: boolean, warn: boolean, type: string, reason: string, guidance: string, risk: object}}
 *   undefined when there is nothing to say, exactly as before.
 */
export function checkVerifiedClaim(text, evidenceText = "", { mode = "block" } = {}) {
  const content = String(text || "");
  const hasUnsupportedPositiveClaim = [...content.matchAll(new RegExp(STRONG_CLAIM_RE.source, "gi"))]
    .some((match) => {
      const prefix = content.slice(Math.max(0, match.index - 100), match.index);
      const currentSentence = prefix.split(/[.!?;\n]/).at(-1) || "";
      return !CLAIM_NEGATION_RE.test(currentSentence);
    });
  if (!hasUnsupportedPositiveClaim) return undefined;
  if (DOCUMENTED_CLAIM_RE.test(content)) return undefined;
  if (EVIDENCE_RE.test(String(evidenceText || ""))) return undefined;

  return {
    block: mode === "block",
    warn: mode === "warn",
    type: "STOP_UNSUPPORTED_VERIFIED_CLAIM",
    reason: "Assistant made a verified/fixed/compiled claim without direct evidence in this turn.",
    guidance: "Rewrite as documented claim: 'the document states...' unless build/test/source evidence was actually observed in this turn.",
    // Additive: the decision above is unchanged, this says which wording drove
    // it and what would have to exist for the wording to be earned.
    risk: scanProtectedLanguage(content)
  };
}

/**
 * Verifier tools whose success the assistant may report. A family's success
 * comes only from that family's own receipts: Lean evidence never earns a
 * SageMath claim (audit F27). Matching here is on tool identifiers, not on
 * what the sentence means; it decides provenance, never mathematics.
 */
export const ATTESTED_TOOL_FAMILIES = Object.freeze({
  sage: { label: "SageMath", mention: /\bsage(?:math)?\b/i, tools: ["sage"] },
  lean: { label: "Lean 4", mention: /\blean(?:\s*4)?\b/i, tools: ["lean_check"] }
});

const ATTESTATION_CLAIM_RE =
  /\b(verified|confirmed|validated|proved|proven|checked|executed|ran|passed|verificat[oaie]|confermat[oaie]|validat[oaie]|dimostrat[oaie]|eseguit[oaie]|controllat[oaie]|compilat[oaie]|riprodott[oaie]|esclus[oaie])\b/gi;

// A hypothetical ("would confirm", "potrebbe verificare") promises nothing.
const HYPOTHETICAL_RE =
  /\b(would|could|might|can|should|if|avrebbe|avrebbero|potrebbe|potrebbero|può|possono|dovrebbe|se)\b/i;

/**
 * Sentences that attribute a positive result to a verifier with no successful
 * receipt for that verifier in this turn.
 *
 * @param {string} text - the assistant's completed response.
 * @param {{tool: string, ok: boolean}[]} receipts - dispatcher records, never model text.
 * @returns {undefined|{type: string, tools: string[], sentences: string[], reason: string, guidance: string}}
 */
export function checkToolAttestations(text, receipts = []) {
  const content = String(text || "");
  const succeeded = new Set(receipts.filter((r) => r?.ok).map((r) => r.tool));
  const violations = new Map();
  for (const sentence of content.split(/(?<=[.!?;])\s+|\n+/)) {
    for (const [family, spec] of Object.entries(ATTESTED_TOOL_FAMILIES)) {
      if (!spec.mention.test(sentence) || spec.tools.some((tool) => succeeded.has(tool))) continue;
      const positive = [...sentence.matchAll(ATTESTATION_CLAIM_RE)].some((match) => {
        const prefix = sentence.slice(0, match.index);
        return !CLAIM_NEGATION_RE.test(prefix) && !HYPOTHETICAL_RE.test(prefix.split(/[,:]/).at(-1) || "");
      });
      if (positive) violations.set(family, [...(violations.get(family) || []), sentence.trim().slice(0, 200)]);
    }
  }
  if (!violations.size) return undefined;
  const labels = [...violations.keys()].map((family) => ATTESTED_TOOL_FAMILIES[family].label);
  return {
    type: "TOOL_ATTESTATION_UNSUPPORTED",
    tools: [...violations.keys()],
    sentences: [...violations.values()].flat().slice(0, 4),
    reason: `The answer reports a result from ${labels.join(" and ")}, but this turn has no successful call to it.`,
    guidance: `Rewrite the answer: say that ${labels.join(" and ")} was not run in this turn and attribute no result to it. ` +
      "Report only results whose tool call actually completed; other tools' results do not count."
  };
}

/** Server-written note for an answer published after the rewrite budget ran out. */
export function toolAttestationNote(decision) {
  const labels = decision.tools.map((family) => ATTESTED_TOOL_FAMILIES[family].label);
  return `\n\n> [DS4 Studio] Nessuna esecuzione riuscita di ${labels.join(" e ")} in questo turno: ` +
    "le affermazioni del testo su questo strumento non sono attestate.";
}
