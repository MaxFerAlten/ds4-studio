/**
 * R04 — Claim-bound verification-language authorization.
 *
 * Builds, for every claim, a pure authorization object describing which
 * assertion level the answer is entitled to, and decides whether protected
 * verification wording in the assistant content exceeds that authorization.
 *
 * The P0 span binding is deliberately conservative: a protected phrase binds to
 * the claim whose text overlaps the sentence containing it (no perfect span
 * parser). A protected phrase that binds to NO claim cannot be authorized.
 */

import { SEVERITY } from "./epistemicContracts.mjs";

export const ASSERTION_LEVEL = Object.freeze({
  ASSERT: "ASSERT",
  QUALIFIED: "QUALIFIED",
  HYPOTHESIS: "HYPOTHESIS",
  UNKNOWN: "UNKNOWN",
  WITHHOLD: "WITHHOLD"
});

/**
 * R04-PATCH-04 — protected verification phrases (minimal P0, EN + IT).
 */
export const PROTECTED_VERIFICATION_PHRASES = Object.freeze([
  // English
  "verified",
  "proved",
  "formally verified",
  "formally checked",
  "machine checked",
  "confirmed",
  "certified",
  "all tests passed",
  "all formulas verified",
  "exact",
  "official",
  "validated",
  // Italian
  "verificato",
  "dimostrato",
  "formalmente verificato",
  "certificato",
  "confermato",
  "tutti i test passano",
  "tutte le formule verificate",
  "esatto",
  "ufficiale"
]);

/**
 * R04-PATCH-06 — codes whose presence forbids ASSERT-level language.
 */
export const ASSERT_BLOCKING_CODES = Object.freeze([
  "F18",
  "F22",
  "F27",
  "F29",
  "F30",
  "F31",
  "F32",
  "F33",
  "F35",
  "F36",
  "F39",
  "F40"
]);

export const ASSERTION_BLOCKING_CODES = Object.freeze(new Set(ASSERT_BLOCKING_CODES));

function claimText(claim) {
  return String(
    claim?.text ??
      claim?.verificationTarget?.normalizedStatement ??
      claim?.normalizedText ??
      ""
  ).toLowerCase();
}

function splitSentences(content) {
  return String(content ?? "")
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * REM2 §11, §31 — "non e stato verificato" contains "verificato".
 *
 * A substring test cannot tell an assertion from its denial, so the honest
 * repair the strict contract asks for ("I could not verify this") was being
 * blocked as an unauthorized verification claim. A phrase is discounted only
 * when a negator sits immediately before it in the same clause: the window is
 * short and stops at a comma or a subordinator, so "non importa quale sia il
 * metodo, il risultato e verificato" still counts as an assertion.
 */
const NEGATOR = /\b(?:non|not|never|mai|senza|nessun\w*|neither|nor)\b/giu;
const CLAUSE_BREAK = /[,;:()]|\b(?:che|which|that|perche|because|quindi|so)\b/iu;
const NEGATION_WINDOW = 30;

function negatedAt(lower, index) {
  const start = Math.max(0, index - NEGATION_WINDOW);
  const window = lower.slice(start, index);
  NEGATOR.lastIndex = 0;
  let match;
  let last = null;
  while ((match = NEGATOR.exec(window)) !== null) last = match;
  if (last === null) return false;
  return !CLAUSE_BREAK.test(window.slice(last.index + last[0].length));
}

function phrasesIn(text) {
  const lower = String(text ?? "").toLowerCase();
  return PROTECTED_VERIFICATION_PHRASES.filter((phrase) => {
    let index = lower.indexOf(phrase);
    while (index !== -1) {
      if (!negatedAt(lower, index)) return true;
      index = lower.indexOf(phrase, index + phrase.length);
    }
    return false;
  });
}

/**
 * R04-PATCH-05 — P0 phrase -> claim binding: a protected phrase occurrence is
 * attributed to the claim whose text shares the most words with the sentence
 * containing the phrase (nearest/overlapping extracted claim text).
 */
export function bindProtectedPhrasesToClaims({ assistantContent = "", claims = [] }) {
  const sentences = splitSentences(assistantContent);
  const live = Array.isArray(claims) ? claims.filter(Boolean) : [];
  const bindings = new Map();

  for (const sentence of sentences) {
    const present = phrasesIn(sentence);
    if (present.length === 0) continue;

    let bestClaim = null;
    let bestScore = 0;
    const sentenceTokens = new Set(sentence.split(/\W+/).filter(Boolean));
    for (const claim of live) {
      const text = claimText(claim);
      if (!text) continue;
      const claimTokens = new Set(text.split(/\W+/).filter(Boolean));
      let overlap = 0;
      for (const token of claimTokens) if (sentenceTokens.has(token)) overlap += 1;
      if (overlap > bestScore) {
        bestScore = overlap;
        bestClaim = claim;
      }
    }

    const key = bestClaim?.id ?? "unbound";
    const existing = bindings.get(key) ?? new Set();
    for (const phrase of present) existing.add(phrase);
    bindings.set(key, existing);
  }

  return bindings;
}

/**
 * REM-004.3 — certificate state for a claim. A protected ASSERT claim must show
 * at least one PASSED verifier result whose certificate is present AND whose
 * scope is MATCH, plus a complete plan. The returned `failureCode` picks the
 * specific withhold reason: F18 (no certificate at all), F27 (certificate
 * present but scope != MATCH), or F29 (plan coverage incomplete).
 */
function certificateAuthorizationState(claim) {
  const results = Array.isArray(claim?.verifierResults) ? claim.verifierResults : [];
  const passingScoped = results.filter(
    (r) =>
      r?.status === "PASSED" &&
      r?.certificate?.id &&
      r?.scope?.status === "MATCH"
  );
  const anyCertificate = results.some((r) => r?.certificate?.id);
  const plan = claim?.verificationPlanSummary ?? null;
  const coverageComplete = plan
    ? plan.status === "PASSED" &&
      plan.coverage === 1 &&
      (plan.mandatoryFailedOrMissing ?? 0) === 0
    : (claim?.verificationRequirements?.length ?? 0) === 0;

  let failureCode = null;
  if (!coverageComplete) failureCode = "F29";
  else if (anyCertificate && passingScoped.length === 0) failureCode = "F27";
  else if (passingScoped.length === 0) failureCode = "F18";

  return {
    hasMatchingCertificate: passingScoped.length > 0,
    coverageComplete,
    certificateIds: passingScoped.map((r) => r.certificate.id).filter(Boolean),
    failureCode
  };
}

function assertionLevelForClaim(claim, { protectedPhrasePresent = false } = {}) {
  const status = claim?.status ?? "UNKNOWN";
  const codes = new Set(claim?.failureCodes ?? []);
  const blocking = [...codes].filter((code) => ASSERTION_BLOCKING_CODES.has(code));
  const openDebt = Array.isArray(claim?.challengeDebtIds)
    ? claim.challengeDebtIds.length
    : 0;

  if (openDebt > 0 || blocking.length > 0) return ASSERTION_LEVEL.WITHHOLD;
  if (status === "VERIFIED") {
    // REM-004.4/.5: VERIFIED alone authorizes ASSERT for ordinary facts, but a
    // claim using protected verification language must also carry a matching
    // certificate (scope MATCH) and complete coverage; otherwise it is only
    // WITHHOLD — the language exceeds the certificate authorization.
    if (protectedPhrasePresent) {
      const cert = certificateAuthorizationState(claim);
      if (!cert.hasMatchingCertificate || !cert.coverageComplete) {
        return ASSERTION_LEVEL.WITHHOLD;
      }
    }
    return ASSERTION_LEVEL.ASSERT;
  }
  if (status === "PARTIAL") return ASSERTION_LEVEL.QUALIFIED;
  if (status === "REJECTED" || status === "CONTRADICTED") return ASSERTION_LEVEL.WITHHOLD;
  return ASSERTION_LEVEL.UNKNOWN;
}

/**
 * R04-PATCH-03 + R04-PATCH-12 — one authorization object per claim.
 */
export function buildVerificationAuthorization({ assistantContent = "", claims = [] }) {
  const live = Array.isArray(claims) ? claims.filter(Boolean) : [];
  const bindings = bindProtectedPhrasesToClaims({ assistantContent, claims: live });
  const authorizations = [];

  for (const claim of live) {
    const maybeBound = bindings.get(claim.id) ?? new Set();
    const protectedPhrasesPresent = [...maybeBound];
    const certState = certificateAuthorizationState(claim);
    const assertionLevel = assertionLevelForClaim(claim, {
      protectedPhrasePresent: protectedPhrasesPresent.length > 0
    });

    // R04-PATCH-06: only ASSERT authorizes the protected verification
    // vocabulary. At any weaker level a bound protected phrase is forbidden:
    // UNKNOWN may say "I could not verify X" but never "X is verified",
    // QUALIFIED may say "Sage verified X while Y remains unverified" but never
    // "all formulas verified". (Cases already blocked by earlier gate checks
    // — UNKNOWN/PARTIAL + protected language — are never reached here.)
    const forbiddenPhrases =
      assertionLevel === ASSERTION_LEVEL.ASSERT
        ? []
        : [...protectedPhrasesPresent];

    // REM-004.6: when a protected claim is WITHHELD, surface the precise reason
    // code: certificate failure (F18 no certificate, F27 scope mismatch, F29
    // coverage incomplete) or open challenge debt (F39), alongside any codes
    // already present on the claim.
    const authorizationFailureCodes = new Set(claim.failureCodes ?? []);
    if (protectedPhrasesPresent.length > 0 && assertionLevel === ASSERTION_LEVEL.WITHHOLD) {
      if (certState.failureCode) authorizationFailureCodes.add(certState.failureCode);
      if ((Array.isArray(claim.challengeDebtIds) ? claim.challengeDebtIds.length : 0) > 0) {
        authorizationFailureCodes.add("F39");
      }
    }

    authorizations.push({
      claimId: claim.id,
      assertionLevel,
      // REM-004.8/.9: authorize only the passing-scoped certificates (never the
      // whole verifierCertificateIds list, which proves reference, not scope).
      authorizedCertificateIds:
        assertionLevel === ASSERTION_LEVEL.ASSERT
          ? certState.certificateIds
          : [],
      openChallengeCount: Array.isArray(claim.challengeDebtIds)
        ? claim.challengeDebtIds.length
        : 0,
      failureCodes: [...authorizationFailureCodes],
      forbiddenPhrases: [...new Set(forbiddenPhrases)]
    });
  }

  // R04-PATCH-05 — a protected phrase that binds to no claim is unauthorized.
  const unbound = bindings.get("unbound");
  if (unbound && unbound.size > 0) {
    authorizations.push({
      claimId: null,
      assertionLevel: ASSERTION_LEVEL.UNKNOWN,
      authorizedCertificateIds: [],
      openChallengeCount: 0,
      failureCodes: [],
      forbiddenPhrases: [...unbound]
    });
  }

  return authorizations;
}

/**
 * R04-PATCH-13/14 — decide whether unauthorized protected wording blocks.
 * Returns an authorization decision or null when everything is authorized.
 */
export function assessVerificationAuthorization({ assistantContent = "", claims = [] }) {
  const authorizations = buildVerificationAuthorization({ assistantContent, claims });
  const offenders = authorizations.filter((auth) => (auth.forbiddenPhrases ?? []).length > 0);

  if (offenders.length === 0) return null;

  // REM-004.6: report the precise certificate withhold code (F18 no cert, F27
  // scope mismatch, F29 plan incomplete) when the offenders carry one; fall
  // back to F18 only when no claim-level certificate code was surfaced (an
  // unbound protected phrase, or a generic non-certificate withhold).
  const codeSet = new Set();
  for (const auth of offenders) {
    for (const code of auth.failureCodes ?? []) codeSet.add(code);
  }
  if (codeSet.size === 0) codeSet.add("F18");

  return {
    decision: "EPISTEMIC_VERIFICATION_LANGUAGE_UNAUTHORIZED",
    code: "EPISTEMIC_VERIFICATION_LANGUAGE_UNAUTHORIZED",
    failureCodes: [...codeSet],
    severity: SEVERITY.CRITICAL,
    blockedClaimIds: offenders.map((auth) => auth.claimId).filter(Boolean),
    guidance:
      "The candidate uses verification language that exceeds the claim-specific certificate authorization.",
    authorizations,
    offenders: offenders.map((auth) => ({
      claimId: auth.claimId,
      assertionLevel: auth.assertionLevel,
      forbiddenPhrases: auth.forbiddenPhrases
    }))
  };
}
