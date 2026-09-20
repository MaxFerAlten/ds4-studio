/**
 * DS4 Quantum Fix — challenge extraction and anti-sycophancy.
 *
 * QF-07 §29, and the home of EPI-016: a user's criticism is not evidence.
 *
 * When someone says the answer is wrong, the pipeline is
 *   challenge -> source/tool verification -> supported or rejected -> state change
 * and never "latest speaker wins" (§90). This module maps a criticism onto the
 * claims it contests and marks them CHALLENGED. It does not mark them REJECTED,
 * and the replacement the user proposes enters as PROPOSED with the same
 * evidence burden as any other new claim.
 *
 * The sycophancy detector is the other half. F25 is the shape where the
 * assistant answers a critique with "you are right" and a substitute claim,
 * carrying the critic's authority instead of any evidence. Agreement is only
 * earned once the replacement has been verified.
 */

import { createChallenge, createClaim } from "./epistemicLedger.mjs";
import { CHALLENGE_EXTRACTOR_PROMPT } from "./epistemicPrompts.mjs";

export const CHALLENGE_EXTRACTION_STATUS = Object.freeze({
  COMPLETE: "CHALLENGE_EXTRACTION_COMPLETE",
  PARTIAL: "CHALLENGE_EXTRACTION_PARTIAL"
});

/**
 * Word boundaries that hold next to accented letters too.
 *
 * `\b` is ASCII-only, so /\bè falso\b/ can never match "quel valore è falso":
 * the boundary before `è` waits for a preceding word character that a space
 * will never be. Half the Italian triggers below start or end on an accent.
 */
const B = String.raw`(?<![\p{L}\p{N}_])`;
const E = String.raw`(?![\p{L}\p{N}_])`;

/**
 * Wording that contests a previous answer. Both languages, as in claimGuard:
 * a detector that only reads English is a detector with a documented bypass.
 */
export const CHALLENGE_TRIGGER = new RegExp(
  `${B}(hai sbagliato|ti sbagli|è (?:falso|sbagliato|errato)|non esiste|il dato corretto è|il valore corretto è|quel doi è errato|non è vero|you(?:'re| are) wrong|that(?:'s| is) (?:false|wrong|incorrect)|does not exist|doesn't exist|the correct (?:value|figure|number) is|that doi is wrong|not true)${E}`,
  "iu"
);

/**
 * The assistant conceding. On its own this is ordinary politeness; paired with
 * a substitute claim and no new evidence it is F25.
 */
export const CONCESSION_PATTERN = new RegExp(
  `${B}(hai (?:perfettamente )?ragione|ha ragione|mi correggo|correggo|you(?:'re| are) (?:right|correct)|good catch|my mistake|i was wrong|apologies, you)${E}`,
  "iu"
);

/** A replacement assertion offered right after conceding. */
const REPLACEMENT_PATTERN = new RegExp(
  `${B}(?:in realtà|in effetti|il valore (?:corretto|giusto) è|il dato corretto è|actually|the correct (?:value|figure|number) is|it(?:'s| is) actually|the real value is)${E}`,
  "iu"
);

/** Whether a user message contests the previous answer. */
export function isChallenge(userText) {
  return CHALLENGE_TRIGGER.test(String(userText || ""));
}

/**
 * Detect the F25 shape in an assistant reply to a critique.
 *
 * `hasNewEvidence` is the caller's answer to "did anything run since the
 * critique". Conceding after actually checking is correct behaviour; conceding
 * because someone pushed back is the failure.
 *
 * @param {string} assistantText
 * @param {{isReplyToChallenge?: boolean, hasNewEvidence?: boolean}} [context]
 * @returns {{sycophantic: boolean, failureCodes: string[], reason: string|null, concession: string|null}}
 */
export function detectSycophancy(assistantText, context = {}) {
  const text = String(assistantText || "");
  const concession = text.match(CONCESSION_PATTERN)?.[0] ?? null;
  const none = { sycophantic: false, failureCodes: [], reason: null, concession };

  if (!concession) return none;
  if (context.isReplyToChallenge !== true) return none;
  // Agreement after verification is not sycophancy, it is the loop working.
  if (context.hasNewEvidence === true) return none;

  const replaced = REPLACEMENT_PATTERN.test(text);
  return {
    sycophantic: true,
    // F25 is the echo itself. A substitute claim carried in on the critic's
    // authority is additionally an unverified fact presented as a correction.
    failureCodes: replaced ? ["F25", "F11"] : ["F25"],
    reason: replaced
      ? "conceded to a critique and asserted a replacement value without verifying either"
      : "conceded to a critique without verifying it",
    concession
  };
}

/** Coerce one model-produced challenge, dropping anything unmappable. */
function challengeFromModel(raw, knownClaimIds) {
  const targetClaimId = String(raw?.targetClaimId ?? "");
  if (!targetClaimId || !knownClaimIds.has(targetClaimId)) return null;
  const challengeText = String(raw?.challengeText ?? "").trim();
  if (!challengeText) return null;

  const replacementText =
    typeof raw?.proposedReplacement === "string" ? raw.proposedReplacement.trim() : "";

  return {
    challenge: createChallenge({ targetClaimId, challengerType: "user", challengeText }),
    // The replacement is a claim like any other: PROPOSED, no evidence, and it
    // has to be verified before it can replace anything. createClaim refuses to
    // build it in any other state.
    replacement: replacementText
      ? createClaim({ text: replacementText, epistemicType: "UNKNOWN" })
      : null
  };
}

/**
 * Map a user's criticism onto the claims it contests.
 *
 * Without a model this falls back to attaching the criticism to the claims the
 * caller says are in scope, and reports PARTIAL: a lexical pass cannot tell
 * which of several claims a sentence is aimed at, and guessing one would leave
 * the others silently unchallenged.
 *
 * @param {object} options
 * @param {string} options.userText - the criticism.
 * @param {object[]} [options.priorClaims] - claims the criticism may target.
 * @param {object} [options.client] - a StructuredModelClient, or null.
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<{status: string, challenges: object[], replacements: object[], source: string, reason?: string}>}
 */
export async function extractChallenges({
  userText,
  priorClaims = [],
  client = null,
  signal
} = {}) {
  const text = String(userText || "").trim();
  const empty = { challenges: [], replacements: [] };

  if (!text || priorClaims.length === 0 || !isChallenge(text)) {
    return { status: CHALLENGE_EXTRACTION_STATUS.COMPLETE, ...empty, source: "none" };
  }

  const knownClaimIds = new Set(priorClaims.map((c) => c.id));

  const lexicalFallback = (reason) => ({
    status: CHALLENGE_EXTRACTION_STATUS.PARTIAL,
    // Every claim in scope is challenged rather than one guessed at: an
    // unchallenged claim keeps an authority the criticism may have removed.
    challenges: priorClaims.map((claim) =>
      createChallenge({ targetClaimId: claim.id, challengerType: "user", challengeText: text })
    ),
    replacements: [],
    source: "lexical",
    reason
  });

  if (!client || typeof client.completeRole !== "function") {
    return lexicalFallback("no model client available; the criticism was mapped to every claim in scope");
  }

  try {
    const response = await client.completeRole({
      roleName: "epistemic_challenge_extractor",
      systemPrompt: CHALLENGE_EXTRACTOR_PROMPT,
      userPrompt: JSON.stringify({
        criticism: text,
        priorClaims: priorClaims.map((c) => ({ id: c.id, text: c.text }))
      }),
      json: true,
      signal
    });
    const raw = Array.isArray(response?.json?.challenges) ? response.json.challenges : null;
    if (!raw) return lexicalFallback("model response contained no challenges array");

    const mapped = raw.map((item) => challengeFromModel(item, knownClaimIds)).filter(Boolean);
    if (mapped.length === 0) {
      return lexicalFallback("model returned no challenge that maps to a known claim");
    }
    return {
      status: CHALLENGE_EXTRACTION_STATUS.COMPLETE,
      challenges: mapped.map((m) => m.challenge),
      replacements: mapped.map((m) => m.replacement).filter(Boolean),
      source: "model"
    };
  } catch (err) {
    return lexicalFallback(`model challenge extraction failed: ${String(err?.message ?? err)}`);
  }
}

/**
 * Apply extracted challenges to a ledger.
 *
 * Targets move to CHALLENGED and no further; replacements are added as ordinary
 * PROPOSED claims. Nothing here decides who was right.
 *
 * @returns {{challenged: string[], replacements: string[], skipped: {id: string, reason: string}[]}}
 */
export function applyChallenges(ledger, { challenges = [], replacements = [] } = {}) {
  const challenged = [];
  const skipped = [];

  for (const challenge of challenges) {
    try {
      ledger.challenge(challenge);
      challenged.push(challenge.targetClaimId);
    } catch (err) {
      // A claim whose state cannot accept a challenge is reported, not forced.
      skipped.push({ id: challenge.targetClaimId, reason: String(err?.code ?? err?.message ?? err) });
    }
  }

  const added = [];
  for (const replacement of replacements) {
    try {
      ledger.addClaim(replacement);
      added.push(replacement.id);
    } catch (err) {
      skipped.push({ id: replacement.id, reason: String(err?.code ?? err?.message ?? err) });
    }
  }

  return { challenged, replacements: added, skipped };
}
