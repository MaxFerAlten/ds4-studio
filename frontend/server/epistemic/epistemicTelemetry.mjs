/**
 * DS4 Quantum Fix — compact audit events and in-memory telemetry (§64).
 *
 * Events deliberately contain claim/evidence identifiers and verdict metadata,
 * never assistant text, evidence bodies, tool output, prompts, or session keys.
 * The counters are process-health signals: they reset when the server restarts
 * and are not suitable for billing.
 */

export const EPISTEMIC_TELEMETRY_METRICS = Object.freeze([
  "claims_total",
  "claims_verified",
  "claims_partial",
  "claims_rejected",
  "claims_unknown",
  "promotion_block_total",
  "fabricated_experiment_block_total",
  "execution_claim_block_total",
  "citation_identity_mismatch_total",
  "entailment_absent_total",
  "challenge_total",
  "challenge_supported_total",
  "challenge_rejected_total",
  "repair_opened_total",
  "repair_failed_total",
  "critique_echo_block_total",
  "post_compile_block_total",
  "claim_extraction_complete_total",
  "claim_extraction_partial_total",
  "verifier_call_total",
  "verifier_pass_total",
  "verifier_fail_total",
  "verifier_unknown_total",
  "verifier_budget_exhausted_total",
  "unresolved_requirement_total",
  "promotion_verify_total",
  "promotion_partial_total",
  "promotion_reject_total",
  "promotion_unknown_total",
  "session_repromotion_block_total",
  "js_native_mode_mismatch_total",
  // report.fix.Quantium.001 §127 — the corrective-history vocabulary.
  "self_challenge_total",
  "open_challenge_debt_total",
  "corrective_state_regression_block_total",
  "local_axiom_proof_claim_block_total",
  "model_capability_mismatch_total",
  "source_role_promotion_block_total",
  "paraphrase_escape_block_total"
]);

const PROMOTION_FAILURES = new Set(["F08", "F09", "F11", "F12", "F13", "F23"]);
const EXECUTION_FAILURES = new Set(["F04", "F18", "F19", "F22"]);
const REJECTED_STATES = new Set(["REJECTED", "CONTRADICTED", "INVALIDATED"]);
const REPAIR_FAILURE_CODE = /(?:REPAIR.*(?:FAILED|EXHAUSTED|BUDGET)|(?:FAILED|EXHAUSTED).*REPAIR)/i;

function bounded(value, max = 160) {
  return String(value ?? "").slice(0, max);
}

function safeIds(values) {
  return Array.isArray(values) ? values.map((value) => bounded(value)).filter(Boolean).slice(0, 100) : [];
}

function claimStatusCounts(claims) {
  const counts = { total: 0, verified: 0, partial: 0, rejected: 0, unknown: 0 };
  for (const claim of claims) {
    counts.total += 1;
    const status = bounded(claim?.status).toUpperCase();
    if (status === "VERIFIED") counts.verified += 1;
    else if (status === "PARTIAL") counts.partial += 1;
    else if (REJECTED_STATES.has(status)) counts.rejected += 1;
    else counts.unknown += 1;
  }
  return counts;
}

function compactClaim(claim) {
  return Object.freeze({
    id: bounded(claim?.id),
    status: bounded(claim?.status).toUpperCase() || "UNKNOWN",
    epistemicType: bounded(claim?.epistemicType).toUpperCase() || "UNKNOWN",
    severity: Number.isInteger(claim?.severity) ? claim.severity : 0,
    failureCodes: Object.freeze(safeIds(claim?.failureCodes)),
    evidenceIds: Object.freeze(safeIds(claim?.evidenceIds)),
    verificationRequirementCount: Array.isArray(claim?.verificationRequirements)
      ? claim.verificationRequirements.length
      : 0,
    verifierResultCount: Array.isArray(claim?.verifierResults) ? claim.verifierResults.length : 0,
    // §127: how much verification debt this claim is still carrying, and
    // whether it inherited it from a claim it only rephrased.
    openChallengeDebt: Array.isArray(claim?.challengeDebtIds) ? claim.challengeDebtIds.length : 0,
    inheritedRelation: bounded(claim?.inheritedClaimRelation) || null
  });
}

function compactVerifierResults(claims) {
  return claims.flatMap((claim) =>
    (Array.isArray(claim?.verifierResults) ? claim.verifierResults : []).map((result) =>
      Object.freeze({
        claimId: bounded(claim?.id),
        requirement: bounded(result?.requirement),
        verifier: bounded(result?.verifier),
        status: bounded(result?.status).toUpperCase() || "UNKNOWN",
        failureCode: bounded(result?.failureCodes?.[0] || result?.reasonCode)
      })
    )
  );
}

function compactPromotions(promotions) {
  return (Array.isArray(promotions) ? promotions : []).map((entry) =>
    Object.freeze({
      claimId: bounded(entry?.claimId),
      decision: bounded(entry?.promotion?.decision || entry?.decision).toUpperCase() || "UNKNOWN",
      unmetRequirements: Object.freeze(safeIds(
        entry?.promotion?.unmetRequirements ?? entry?.unmetRequirements
      ))
    })
  );
}

function challengeStatusCounts(challenges, fallbackTotal = 0) {
  if (!Array.isArray(challenges)) {
    return { total: Math.max(0, Number(fallbackTotal) || 0), supported: 0, rejected: 0 };
  }
  const out = { total: challenges.length, supported: 0, rejected: 0 };
  for (const challenge of challenges) {
    const status = bounded(challenge?.status).toUpperCase();
    if (status === "SUPPORTED" || status === "VERIFIED") out.supported += 1;
    if (status === "REJECTED") out.rejected += 1;
  }
  return out;
}

/**
 * Build one raw-content-free audit event for a final-candidate decision.
 *
 * `claims` and `challenges` may be supplied directly. When omitted, claims and
 * the challenge total are read from the decision snapshot produced by
 * evaluateEpistemicTurn.
 */
export function epistemicTelemetryEvent(input = {}) {
  const decision = input?.decision && typeof input.decision === "object" ? input.decision : {};
  const snapshot = decision.snapshot && typeof decision.snapshot === "object" ? decision.snapshot : {};
  const claims = Array.isArray(input.claims)
    ? input.claims
    : (Array.isArray(snapshot.claims) ? snapshot.claims : []);
  const compactClaims = claims.map(compactClaim);
  const verifierResults = compactVerifierResults(claims);
  const promotions = compactPromotions(input.promotions ?? decision.promotions);
  const claimCounts = claimStatusCounts(compactClaims);
  const challengeCounts = challengeStatusCounts(input.challenges, snapshot.challengeCount);
  const failureCodes = new Set([
    ...safeIds(input.failureCodes),
    ...safeIds(decision.failureCodes),
    ...safeIds(snapshot.failureCodes),
    ...compactClaims.flatMap((claim) => claim.failureCodes)
  ]);
  const code = bounded(decision.code || input.decisionCode);
  const wouldBlock = decision.wouldBlock === true || input.wouldBlock === true;
  const blocked = decision.allowed === false || wouldBlock || input.blocked === true;
  const repairInput = input.repair && typeof input.repair === "object" ? input.repair : {};
  const repairFailed = repairInput.failed === true || REPAIR_FAILURE_CODE.test(code);
  const repairOpened = repairInput.opened === true || repairFailed || (blocked && decision.mustContinue === true);
  const extractionStatus = bounded(
    input.extraction?.status ?? decision.extraction?.status
  ).toUpperCase();
  const verifierCallCount = Math.max(
    0,
    Number(input.verifierCallCount ?? decision.verifierSummary?.budgetUsed) || 0
  );
  const unresolvedRequirementCount = promotions.reduce(
    (total, promotion) => total + promotion.unmetRequirements.length,
    0
  );
  const sessionRepromotionBlocks = Math.max(
    0,
    Number(input.sessionRepromotionBlocks ?? decision.verifierSummary?.sessionBlocks) || 0
  );

  // §127: challenge debt is counted per claim, because one answer can carry
  // several claims and the escape rate is a per-claim quantity.
  const openDebtClaims = compactClaims.filter((claim) => claim.openChallengeDebt > 0);
  const inheritedDebtClaims = openDebtClaims.filter((claim) => claim.inheritedRelation);

  const blocks = Object.freeze({
    promotion: blocked && [...failureCodes].some((failure) => PROMOTION_FAILURES.has(failure)),
    fabricatedExperiment: blocked && failureCodes.has("F03"),
    executionClaim: blocked && (
      code === "EPISTEMIC_EXECUTION_CLAIM_WITHOUT_TRACE" ||
      [...failureCodes].some((failure) => EXECUTION_FAILURES.has(failure))
    ),
    citationIdentity: blocked && (
      code === "EPISTEMIC_CITATION_IDENTITY_MISMATCH" || failureCodes.has("F17")
    ),
    entailmentAbsent: blocked && failureCodes.has("F02"),
    critiqueEcho: blocked && (
      code === "EPISTEMIC_CHALLENGE_ACCEPTED_WITHOUT_VERIFICATION" || failureCodes.has("F25")
    ),
    postCompile: blocked,
    correctiveStateRegression: blocked && failureCodes.has("F36"),
    localAxiomProofClaim: blocked && failureCodes.has("F35"),
    modelCapabilityMismatch: blocked && failureCodes.has("F38"),
    sourceRolePromotion: blocked && failureCodes.has("F37"),
    paraphraseEscape: blocked && inheritedDebtClaims.length > 0
  });

  return Object.freeze({
    schema: "ds4_epistemic_telemetry_v1",
    type: "epistemic_audit",
    at: bounded(input.at || new Date().toISOString()),
    revision: Number.isInteger(input.revision) ? input.revision : (snapshot.revision ?? null),
    mode: bounded(input.mode || snapshot.mode || "off"),
    decision: Object.freeze({
      code,
      allowed: decision.allowed !== false,
      mustContinue: decision.mustContinue === true,
      wouldBlock,
      blockedClaimIds: Object.freeze(safeIds(decision.blockedClaimIds))
    }),
    claims: Object.freeze(compactClaims),
    extraction: Object.freeze({ status: extractionStatus || null }),
    verifierResults: Object.freeze(verifierResults),
    verifierCallCount,
    verifierBudgetExhausted: verifierResults.some(
      (result) => result.failureCode === "VERIFIER_BUDGET_EXHAUSTED"
    ),
    promotions: Object.freeze(promotions),
    unresolvedRequirementCount,
    sessionRepromotionBlocks,
    jsNativeModeMismatch: input.jsNativeModeMismatch === true,
    selfChallengeCount: compactClaims.filter((claim) => claim.failureCodes.includes("F34")).length,
    openChallengeDebtCount: openDebtClaims.reduce((total, claim) => total + claim.openChallengeDebt, 0),
    claimCounts: Object.freeze(claimCounts),
    failureCodes: Object.freeze([...failureCodes].sort()),
    challengeCounts: Object.freeze(challengeCounts),
    repair: Object.freeze({
      opened: repairOpened,
      failed: repairFailed,
      round: Number.isInteger(repairInput.round) ? repairInput.round : 0
    }),
    blocks
  });
}

/** In-memory accumulator for the exact §64 metric vocabulary. */
export function createEpistemicTelemetry() {
  const counters = Object.fromEntries(EPISTEMIC_TELEMETRY_METRICS.map((name) => [name, 0]));

  return Object.freeze({
    record(input = {}) {
      const event = input?.type === "epistemic_audit" ? input : epistemicTelemetryEvent(input);
      const claims = event.claimCounts ?? {};
      const challenges = event.challengeCounts ?? {};

      counters.claims_total += Number(claims.total) || 0;
      counters.claims_verified += Number(claims.verified) || 0;
      counters.claims_partial += Number(claims.partial) || 0;
      counters.claims_rejected += Number(claims.rejected) || 0;
      counters.claims_unknown += Number(claims.unknown) || 0;
      counters.challenge_total += Number(challenges.total) || 0;
      counters.challenge_supported_total += Number(challenges.supported) || 0;
      counters.challenge_rejected_total += Number(challenges.rejected) || 0;
      if (event.repair?.opened) counters.repair_opened_total += 1;
      if (event.repair?.failed) counters.repair_failed_total += 1;
      if (event.blocks?.promotion) counters.promotion_block_total += 1;
      if (event.blocks?.fabricatedExperiment) counters.fabricated_experiment_block_total += 1;
      if (event.blocks?.executionClaim) counters.execution_claim_block_total += 1;
      if (event.blocks?.citationIdentity) counters.citation_identity_mismatch_total += 1;
      if (event.blocks?.entailmentAbsent) counters.entailment_absent_total += 1;
      if (event.blocks?.critiqueEcho) counters.critique_echo_block_total += 1;
      if (event.blocks?.postCompile) counters.post_compile_block_total += 1;
      if (["COMPLETE", "EXTRACTION_COMPLETE"].includes(event.extraction?.status)) {
        counters.claim_extraction_complete_total += 1;
      }
      if (["PARTIAL", "EXTRACTION_PARTIAL"].includes(event.extraction?.status)) {
        counters.claim_extraction_partial_total += 1;
      }
      counters.verifier_call_total += Number(event.verifierCallCount) || 0;
      counters.verifier_pass_total += (event.verifierResults ?? []).filter(
        (result) => result.status === "PASSED"
      ).length;
      counters.verifier_fail_total += (event.verifierResults ?? []).filter(
        (result) => result.status === "FAILED"
      ).length;
      counters.verifier_unknown_total += (event.verifierResults ?? []).filter(
        (result) => result.status === "UNKNOWN"
      ).length;
      if (event.verifierBudgetExhausted) counters.verifier_budget_exhausted_total += 1;
      counters.unresolved_requirement_total += Number(event.unresolvedRequirementCount) || 0;
      for (const promotion of event.promotions ?? []) {
        const key = `promotion_${promotion.decision.toLowerCase()}_total`;
        if (Object.prototype.hasOwnProperty.call(counters, key)) counters[key] += 1;
      }
      counters.session_repromotion_block_total += Number(event.sessionRepromotionBlocks) || 0;
      if (event.jsNativeModeMismatch) counters.js_native_mode_mismatch_total += 1;
      counters.self_challenge_total += Number(event.selfChallengeCount) || 0;
      counters.open_challenge_debt_total += Number(event.openChallengeDebtCount) || 0;
      if (event.blocks?.correctiveStateRegression) counters.corrective_state_regression_block_total += 1;
      if (event.blocks?.localAxiomProofClaim) counters.local_axiom_proof_claim_block_total += 1;
      if (event.blocks?.modelCapabilityMismatch) counters.model_capability_mismatch_total += 1;
      if (event.blocks?.sourceRolePromotion) counters.source_role_promotion_block_total += 1;
      if (event.blocks?.paraphraseEscape) counters.paraphrase_escape_block_total += 1;
      return event;
    },

    snapshot() {
      return { ...counters };
    }
  });
}
