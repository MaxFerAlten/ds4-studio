export const CLAIM_RELATION = Object.freeze({
  EXACT: "EXACT",
  PARAPHRASE: "PARAPHRASE",
  NARROWER: "NARROWER",
  BROADER: "BROADER",
  OVERLAPPING: "OVERLAPPING",
  UNRELATED: "UNRELATED"
});

const VALID_RELATIONS = new Set(Object.values(CLAIM_RELATION));

export const CLAIM_EQUIVALENCE_PROMPT = `Compare old and new claims semantically.
Return JSON only as {"relation":"EXACT|PARAPHRASE|NARROWER|BROADER|OVERLAPPING|UNRELATED"}.
Do not treat synonym or verification-wording changes as unrelated.
NARROWER means the new claim asserts a strict subset of the old claim.
BROADER means the new claim adds assertions or scope.
Do not use confidence to erase inherited challenge state.`;

const PROTECTED_GROUPING_PHRASES = [
  /\b(?:lean\s+)?(?:has\s+)?(?:proved|proves|verified|certified|checked)\b/giu,
  /\b(?:formally|machine)\s+(?:proved|verified|certified|checked)\b/giu,
  /\b(?:ha\s+)?(?:provato|verificato|certificato|controllato)\b/giu,
  /\b(?:formalmente|dalla macchina)\s+(?:provato|verificato|certificato)\b/giu
];

const STOP_WORDS = new Set([
  "a", "an", "and", "as", "be", "been", "by", "has", "have", "is", "of", "the", "was",
  "un", "una", "e", "è", "come", "da", "della", "di", "ha", "il", "la", "lo", "stato"
]);

function textOf(claim) {
  return String(claim?.text ?? claim ?? "");
}

export function normalizeClaimForGrouping(claim, { stripProtectedLanguage = false } = {}) {
  let text = textOf(claim).normalize("NFKC").toLowerCase();
  if (stripProtectedLanguage) {
    for (const phrase of PROTECTED_GROUPING_PHRASES) text = text.replace(phrase, " ");
  }
  return text
    .replace(/[-_/]+/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(claim) {
  return new Set(
    normalizeClaimForGrouping(claim, { stripProtectedLanguage: true })
      .split(" ")
      .filter((token) => token && !STOP_WORDS.has(token))
  );
}

function overlapScore(a, b) {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const token of a) if (b.has(token)) shared += 1;
  return shared / Math.min(a.size, b.size);
}

function deterministicRelation(oldClaim, newClaim) {
  const exactOld = normalizeClaimForGrouping(oldClaim);
  const exactNew = normalizeClaimForGrouping(newClaim);
  if (exactOld && exactOld === exactNew) return CLAIM_RELATION.EXACT;

  const groupedOld = normalizeClaimForGrouping(oldClaim, { stripProtectedLanguage: true });
  const groupedNew = normalizeClaimForGrouping(newClaim, { stripProtectedLanguage: true });
  if (groupedOld && groupedOld === groupedNew) return CLAIM_RELATION.PARAPHRASE;

  const oldTokens = tokens(oldClaim);
  const newTokens = tokens(newClaim);
  const score = overlapScore(oldTokens, newTokens);
  if (score >= 0.75) return CLAIM_RELATION.PARAPHRASE;
  if (score >= 0.4) return CLAIM_RELATION.OVERLAPPING;
  return CLAIM_RELATION.UNRELATED;
}

export async function compareClaims({ oldClaim, newClaim, client = null, signal } = {}) {
  const deterministic = deterministicRelation(oldClaim, newClaim);
  if (
    deterministic === CLAIM_RELATION.EXACT ||
    deterministic === CLAIM_RELATION.PARAPHRASE ||
    !client ||
    typeof client.completeRole !== "function"
  ) {
    return Object.freeze({ relation: deterministic, source: "deterministic" });
  }

  try {
    const response = await client.completeRole({
      roleName: "epistemic_claim_equivalence",
      systemPrompt: CLAIM_EQUIVALENCE_PROMPT,
      userPrompt: JSON.stringify({ oldClaim: textOf(oldClaim), newClaim: textOf(newClaim) }),
      json: true,
      signal
    });
    const relation = String(response?.json?.relation ?? "");
    if (VALID_RELATIONS.has(relation)) return Object.freeze({ relation, source: "model" });
  } catch {
    // The deterministic result is the fail-safe when semantic comparison is unavailable.
  }
  return Object.freeze({ relation: deterministic, source: "deterministic" });
}

const INHERITING_RELATIONS = new Set([
  CLAIM_RELATION.EXACT,
  CLAIM_RELATION.PARAPHRASE,
  CLAIM_RELATION.BROADER
]);

export function carryForwardClaimState({ oldClaim, newClaim, relation }) {
  if (!VALID_RELATIONS.has(relation)) throw new TypeError(`unknown claim relation: ${relation}`);
  const linked = {
    ...newClaim,
    inheritedFromClaimId: oldClaim?.id ?? null,
    inheritedClaimRelation: relation,
    // REM-006: capture the stable semantic root so a whole paraphrase chain
    // collapses to one repair identity. BROADER inherits the root; NARROWER
    // must not (it is a fresh claim, fresh subtree, fresh repair identity —
    // otherwise a later paraphrase of the narrowed claim would collapse back
    // onto the original root's exhausted budget).
    semanticRootClaimId:
      relation === CLAIM_RELATION.NARROWER
        ? newClaim.id ?? null
        : oldClaim?.semanticRootClaimId ?? oldClaim?.id ?? null
  };
  if (!INHERITING_RELATIONS.has(relation)) return linked;

  return {
    ...linked,
    historyEventIds: [...new Set([...(oldClaim?.historyEventIds ?? []), ...(newClaim?.historyEventIds ?? [])])],
    challengeDebtIds: [...new Set([...(oldClaim?.challengeDebtIds ?? []), ...(newClaim?.challengeDebtIds ?? [])])],
    failureCodes: [...new Set([...(oldClaim?.failureCodes ?? []), ...(newClaim?.failureCodes ?? [])])],
    negativeProvenance: [
      ...new Set([...(oldClaim?.negativeProvenance ?? []), ...(newClaim?.negativeProvenance ?? [])])
    ],
    correctiveEpoch: Math.max(
      Number(oldClaim?.correctiveEpoch ?? 0),
      Number(newClaim?.correctiveEpoch ?? 0)
    ),
    lastQualifiedEvidenceEpoch: Math.max(
      Number(oldClaim?.lastQualifiedEvidenceEpoch ?? 0),
      Number(newClaim?.lastQualifiedEvidenceEpoch ?? 0)
    )
  };
}

const RELATION_PRIORITY = Object.freeze({
  EXACT: 6,
  PARAPHRASE: 5,
  NARROWER: 4,
  BROADER: 3,
  OVERLAPPING: 2,
  UNRELATED: 1
});

export async function inheritFromPriorClaims({
  claim,
  priorClaims = [],
  client = null,
  signal,
  maxComparisons = 32
} = {}) {
  let best = null;
  for (const oldClaim of priorClaims.slice(0, Math.max(0, maxComparisons))) {
    const comparison = await compareClaims({ oldClaim, newClaim: claim, client, signal });
    if (!best || RELATION_PRIORITY[comparison.relation] > RELATION_PRIORITY[best.relation]) {
      best = { oldClaim, ...comparison };
    }
    if (best.relation === CLAIM_RELATION.EXACT) break;
  }
  if (!best || best.relation === CLAIM_RELATION.UNRELATED) return claim;
  return carryForwardClaimState({ oldClaim: best.oldClaim, newClaim: claim, relation: best.relation });
}
