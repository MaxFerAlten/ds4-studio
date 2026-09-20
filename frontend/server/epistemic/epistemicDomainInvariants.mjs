/**
 * DS4 Quantum Fix — deterministic domain invariants.
 *
 * report.fix.Quantium.001 §55. A domain invariant is not a verifier and not an
 * opinion: it is an inference the mathematics of the domain refutes, so it can
 * be decided without calling anything. The profiles hold the statements; this
 * runs them and reports what a sentence violated.
 *
 * Negation is respected — "softmax does not make attention doubly stochastic"
 * is the correct statement, and flagging it would punish the fix.
 */

import { TRANSFORMER_INVARIANTS } from "./domainProfiles/transformerProfile.mjs";
import { QHO_INVARIANTS } from "./domainProfiles/qhoProfile.mjs";

const PROFILES = Object.freeze({
  TRANSFORMER: TRANSFORMER_INVARIANTS,
  QHO: QHO_INVARIANTS
});

const NEGATED = /\b(?:not|never|neither|nor|non|isn'?t|doesn'?t|cannot|can'?t|without)\b/iu;

/**
 * Whether the sentence denies the inference instead of making it.
 *
 * The negation usually sits inside the matched span ("softmax does not make it
 * doubly stochastic"), so the span is checked as well as the words before it.
 * Erring towards silence here is deliberate: flagging the correct statement
 * would punish exactly the repair this gate is asking for.
 */
function negated(text, match) {
  const prefix = text.slice(Math.max(0, match.index - 60), match.index);
  return NEGATED.test(match[0]) || NEGATED.test(prefix);
}

/**
 * Which invariants a piece of text violates.
 *
 * @param {string} text
 * @returns {{id: string, profile: string, failureCodes: string[], reason: string, span: string}[]}
 */
export function checkDomainInvariants(text) {
  const content = String(text ?? "");
  if (!content.trim()) return [];

  const violations = [];
  for (const [profile, invariants] of Object.entries(PROFILES)) {
    for (const invariant of invariants) {
      const match = invariant.pattern.exec(content);
      if (!match) continue;
      if (negated(content, match)) continue;
      violations.push({
        id: invariant.id,
        profile,
        failureCodes: [...invariant.failureCodes],
        reason: invariant.reason,
        span: match[0].slice(0, 200)
      });
    }
  }
  return violations;
}

/** The failure codes a text earns from every invariant it violates. */
export function domainInvariantFailureCodes(text) {
  return [...new Set(checkDomainInvariants(text).flatMap((v) => v.failureCodes))];
}
