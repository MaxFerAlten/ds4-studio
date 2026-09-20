/**
 * Q2-013 (remediation.Quantiom.002 §17, §68) — authority of a summary.
 *
 * RC-10: every individual claim in the QHO transcript could be defended one way
 * or another — one narrow theorem really did check, one proof really was
 * attempted, one analogy really was labelled somewhere upstream. The final
 * paragraph then added them together and called the sum "tre pilastri
 * matematici formalmente verificati", which no component supported.
 *
 * The rule is monotonicity: Authority(summary) <= min Authority(component).
 * A summary is a claim about other claims, so it is exactly as strong as the
 * weakest one it needs, and a component that was never established at all
 * contributes UNKNOWN rather than nothing.
 */

import { SEVERITY } from "./epistemicContracts.mjs";

/** Ordered strongest to weakest; the numeric level is what gets compared. */
export const SYNTHESIS_AUTHORITY = Object.freeze({
  VERIFIED_FACT: "VERIFIED_FACT",
  PARTIAL: "PARTIAL",
  QUALIFIED_ANALOGY: "QUALIFIED_ANALOGY",
  HYPOTHESIS: "HYPOTHESIS",
  UNKNOWN: "UNKNOWN"
});

const LEVEL = Object.freeze({
  [SYNTHESIS_AUTHORITY.VERIFIED_FACT]: 0,
  [SYNTHESIS_AUTHORITY.PARTIAL]: 1,
  [SYNTHESIS_AUTHORITY.QUALIFIED_ANALOGY]: 2,
  [SYNTHESIS_AUTHORITY.HYPOTHESIS]: 3,
  [SYNTHESIS_AUTHORITY.UNKNOWN]: 4
});

/** §17 — wording that asserts something about a set of results at once. */
const AGGREGATE_ASSERTION =
  /\b(?:tutt[ei]\s+(?:le\s+dimostrazioni|i\s+risultati|le\s+prove|i\s+claim|le\s+affermazioni)|i\s+tre\s+pilastri|abbiamo\s+(?:verificat|dimostrat|provat)\w*|(?:sono|risultano)\s+(?:tutti\s+)?formalmente\s+verificat\w+|formalmente\s+verificat\w+|le\s+dimostrazioni\s+\w+\s+verificano|these\s+results\s+establish|all\s+(?:of\s+)?(?:these\s+)?(?:claims?|results?|proofs?)\s+(?:are|have\s+been)\s+(?:verified|proven|established)|all\s+proven|the\s+(?:three\s+)?pillars|conclusioni\s+dimostrate|proven\s+conclusions|risultati\s+dimostrati)\b/iu;

/**
 * §6.2, §31 — an aggregate sentence that reports what was NOT established is
 * the honest repair, not an overclaim.
 */
const EXPLICIT_LIMITATION =
  /\b(?:solo|soltanto|unicamente|only|non\s+verificat\w+|resta\s+(?:non\s+verificat\w+|un'?ipotesi|apert\w+|ignot\w+)|remains?\s+(?:unverified|a\s+hypothesis|open|unknown)|not\s+(?:verified|proven|established))\b/iu;

/** Claim statuses that establish nothing the summary can lean on. */
const UNSETTLED_STATUS = new Set([
  "UNKNOWN",
  "PROPOSED",
  "VERIFICATION_PENDING",
  "CHALLENGED",
  "REJECTED",
  "CONTRADICTED",
  "INVALIDATED"
]);

/**
 * The strongest thing a summary may say on this component's authority.
 *
 * The epistemic type is a ceiling the status cannot lift: an analogy that every
 * verifier agrees with is still an analogy (§66).
 *
 * @param {object} claim
 * @returns {string} a SYNTHESIS_AUTHORITY value.
 */
export function synthesisAuthorityForClaim(claim) {
  const type = String(claim?.epistemicType ?? "").toUpperCase();
  const status = String(claim?.status ?? "").toUpperCase();

  if (type === "ANALOGY") return SYNTHESIS_AUTHORITY.QUALIFIED_ANALOGY;
  if (type === "HYPOTHESIS") return SYNTHESIS_AUTHORITY.HYPOTHESIS;
  if (status === "PARTIAL") return SYNTHESIS_AUTHORITY.PARTIAL;
  if (status === "VERIFIED") return SYNTHESIS_AUTHORITY.VERIFIED_FACT;
  if (UNSETTLED_STATUS.has(status)) return SYNTHESIS_AUTHORITY.UNKNOWN;
  return SYNTHESIS_AUTHORITY.UNKNOWN;
}

function weakest(authorities) {
  return authorities.reduce(
    (worst, authority) => (LEVEL[authority] > LEVEL[worst] ? authority : worst),
    SYNTHESIS_AUTHORITY.VERIFIED_FACT
  );
}

/**
 * Decide what a named summary claim may assert over its named components.
 *
 * @param {{summaryClaim?: object, referencedClaimIds?: string[], claims?: object[]}} input
 * @returns {{allowed: boolean, maxAssertionLevel: string, weakestStatus: string, uncoveredClaimIds: string[], failureCodes: string[]}}
 */
export function evaluateSynthesisAuthorization({
  summaryClaim = null,
  referencedClaimIds = [],
  claims = []
} = {}) {
  const index = new Map(
    (Array.isArray(claims) ? claims.filter(Boolean) : []).map((claim) => [claim.id, claim])
  );
  const referenced = Array.isArray(referencedClaimIds) ? referencedClaimIds : [];
  const uncoveredClaimIds = referenced.filter((id) => !index.has(id));
  const components = referenced.map((id) => index.get(id)).filter(Boolean);

  const authorities = components.map(synthesisAuthorityForClaim);
  // §17: a component nobody can find is not a verified one.
  if (uncoveredClaimIds.length > 0) authorities.push(SYNTHESIS_AUTHORITY.UNKNOWN);

  const maxAssertionLevel = authorities.length === 0 ? SYNTHESIS_AUTHORITY.UNKNOWN : weakest(authorities);
  const weakestComponent = components.reduce(
    (worst, claim) =>
      worst === null || LEVEL[synthesisAuthorityForClaim(claim)] > LEVEL[synthesisAuthorityForClaim(worst)]
        ? claim
        : worst,
    null
  );
  const weakestStatus =
    uncoveredClaimIds.length > 0 ? "UNKNOWN" : String(weakestComponent?.status ?? "UNKNOWN").toUpperCase();

  const asserted = AGGREGATE_ASSERTION.test(String(summaryClaim?.text ?? ""))
    ? SYNTHESIS_AUTHORITY.VERIFIED_FACT
    : maxAssertionLevel;
  const allowed = LEVEL[asserted] >= LEVEL[maxAssertionLevel];

  return Object.freeze({
    allowed,
    maxAssertionLevel,
    weakestStatus,
    uncoveredClaimIds: Object.freeze(uncoveredClaimIds),
    failureCodes: Object.freeze(allowed ? [] : ["F33"])
  });
}

/**
 * Whether the candidate's aggregate wording is authorized by its own claims.
 *
 * Unlike the per-claim form, this has no explicit component list: the answer
 * says "all of these", so every live claim in the turn is a component.
 *
 * @param {{assistantContent?: string, claims?: object[]}} input
 * @returns {null|{code: string, failureCodes: string[], severity: number, blockedClaimIds: string[], guidance: string}}
 */
export function assessSynthesisAuthorization({ assistantContent = "", claims = [] } = {}) {
  const content = String(assistantContent ?? "");
  // Per sentence, not per answer: a qualification elsewhere in the response does
  // not qualify the sentence that makes the aggregate assertion.
  const overclaiming = content
    .split(/(?<=[.!?])\s+|\n+/)
    .some((sentence) => AGGREGATE_ASSERTION.test(sentence) && !EXPLICIT_LIMITATION.test(sentence));
  if (!overclaiming) return null;

  const components = Array.isArray(claims) ? claims.filter(Boolean) : [];
  if (components.length === 0) return null;

  const understrength = components.filter(
    (claim) => LEVEL[synthesisAuthorityForClaim(claim)] > LEVEL[SYNTHESIS_AUTHORITY.VERIFIED_FACT]
  );
  if (understrength.length === 0) return null;

  return Object.freeze({
    code: "EPISTEMIC_SYNTHESIS_OVERCLAIM",
    failureCodes: Object.freeze(["F33", "F18"]),
    severity: SEVERITY.HIGH,
    blockedClaimIds: Object.freeze(understrength.map((claim) => claim.id).filter(Boolean)),
    guidance:
      "The closing summary asserts more than its components carry. State what was verified and name " +
      "the unverified, analogical or hypothetical parts separately; a summary is never stronger than " +
      "the weakest claim it rests on."
  });
}
