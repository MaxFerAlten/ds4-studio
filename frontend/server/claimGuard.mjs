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
  if (!STRONG_CLAIM_RE.test(content)) return undefined;
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
