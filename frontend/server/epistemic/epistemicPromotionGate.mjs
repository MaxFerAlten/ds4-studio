/**
 * DS4 Quantum Fix — claim promotion gate.
 *
 * QF-12 §34. Where QF-05 through QF-11 each answer one question about a claim,
 * this decides what the claim is allowed to become. It is a pure function in
 * the style of evolutionPromotionGate.mjs: no I/O, no clock, no model, and a
 * frozen result — the same inputs give the same decision, which is what makes
 * a gate auditable rather than persuadable.
 *
 * The rule underneath every branch: a claim is promoted because its
 * verification requirements were met by evidence that exists, never because
 * nothing objected. An unrun verifier produces UNKNOWN, not VERIFY.
 */

import {
  FAILURE_SEVERITY,
  FORBIDDEN_TYPE_PROMOTIONS,
  PROMOTION_EVIDENCE_KINDS,
  SEVERITY
} from "./epistemicContracts.mjs";
import { openChallengeDebt } from "./epistemicChallengeDebt.mjs";
import { CLAIM_EVENT_KIND } from "./epistemicClaimHistory.mjs";

export const PROMOTION_DECISION = Object.freeze({
  VERIFY: "VERIFY",
  PARTIAL: "PARTIAL",
  REJECT: "REJECT",
  UNKNOWN: "UNKNOWN"
});

/** Dependency states that remove a premise the claim was resting on. */
const BROKEN_DEPENDENCY_STATES = new Set([
  "REJECTED",
  "CONTRADICTED",
  "INVALIDATED",
  "CHALLENGED"
]);

export const DEFAULT_PROMOTION_POLICY = Object.freeze({
  /** Severity at or above which nothing may be promoted. §35: S4/S5 block. */
  blockSeverity: SEVERITY.HIGH,
  /** A passing verifier must cite evidence that is present in this turn. */
  requireEvidenceForVerify: true,
  /** Whether a claim with some requirements unmet may still be published as PARTIAL. */
  allowPartial: true
});

/** The repair each hard failure asks for, keyed by its code prefix. */
const REPAIR_FOR = Object.freeze({
  CLAIM_MISSING: "supply a claim to decide on",
  REQUIREMENT_UNMET: "run the verifier for the unmet requirement",
  REQUIREMENT_FAILED: "correct the claim; a verifier refuted it",
  EVIDENCE_MISSING: "attach the evidence the passing verifier cited",
  EVIDENCE_UNKNOWN: "record the evidence in this turn before citing it",
  DEPENDENCY_BROKEN: "re-verify or retract the premise this claim rests on",
  FORBIDDEN_PROMOTION: "produce the evidence the promotion requires, or keep the current type",
  CONFIDENCE_AS_EVIDENCE: "remove the confidence score; it cannot authorise a promotion",
  SEVERITY_BLOCKED: "resolve the high-severity failures before publishing this claim",
  OPEN_CHALLENGE_DEBT: "resolve or narrow every material challenge before verification",
  CORRECTIVE_STATE_REGRESSION: "add qualifying evidence after the last corrective event"
});

const CORRECTIVE_EVENT_KINDS = new Set([
  CLAIM_EVENT_KIND.CHALLENGED,
  CLAIM_EVENT_KIND.DOWNGRADED,
  CLAIM_EVENT_KIND.CONTRADICTED,
  CLAIM_EVENT_KIND.INVALIDATED
]);

/** Failures that withhold a claim without refuting it (F36 §7, F39 §10, F29 coverage). */
const DEBT_FAILURE_CODES = new Set(["F36", "F39", "F29"]);

const QUALIFYING_EVENT_KINDS = new Set([
  CLAIM_EVENT_KIND.EVIDENCE_BOUND,
  CLAIM_EVENT_KIND.VERIFIER_RESULT,
  CLAIM_EVENT_KIND.CHALLENGE_RESOLVED
]);

function correctiveState(claim, history) {
  const events = history && typeof history.events === "function" ? history.events(claim.id) : [];
  const lastCorrectiveIndex = events.findLastIndex((event) => CORRECTIVE_EVENT_KINDS.has(event.kind));
  const correctionCount = events.filter((event) => CORRECTIVE_EVENT_KINDS.has(event.kind)).length;
  const correctiveEpoch = Math.max(Number(claim.correctiveEpoch ?? 0), correctionCount);
  if (correctiveEpoch === 0 && lastCorrectiveIndex < 0) {
    return { hasCorrection: false, hasNewQualifyingEvidence: true };
  }

  const evidenceAfterCorrection = events.slice(lastCorrectiveIndex + 1).some((event) => {
    if (!QUALIFYING_EVENT_KINDS.has(event.kind) || event.qualifying === false) return false;
    if (event.kind === CLAIM_EVENT_KIND.VERIFIER_RESULT) {
      return event.status === "PASSED" && (event.evidenceIds ?? []).length > 0;
    }
    return (event.evidenceIds ?? []).length > 0 || event.kind === CLAIM_EVENT_KIND.EVIDENCE_BOUND;
  });
  const epochEvidence = Number(claim.lastQualifiedEvidenceEpoch ?? 0) >= correctiveEpoch;
  return {
    hasCorrection: true,
    hasNewQualifyingEvidence: evidenceAfterCorrection || epochEvidence
  };
}

function repairFor(hardFailures) {
  for (const failure of hardFailures) {
    const key = failure.split(":")[0];
    if (REPAIR_FOR[key]) return REPAIR_FOR[key];
  }
  return null;
}

/**
 * Decide what a claim may be promoted to.
 *
 * @param {object} input
 * @param {object} input.claim - a ledger claim.
 * @param {object[]} [input.verifierResults] - results answering the claim's requirements.
 * @param {Object<string,string>} [input.dependencyStates] - claim id -> status, for the claim's dependencies.
 * @param {object[]} [input.evidence] - evidence items available this turn.
 * @param {object} [input.policy]
 * @returns {{decision: string, hardFailures: string[], failureCodes: string[], severity: number, requiredRepair: string|null, metRequirements: string[], unmetRequirements: string[]}}
 */
export function decideClaimPromotion({
  claim,
  verifierResults = [],
  dependencyStates = {},
  evidence = [],
  history = null,
  policy = {}
} = {}) {
  const settings = { ...DEFAULT_PROMOTION_POLICY, ...policy };
  const hardFailures = new Set();
  const failureCodes = new Set();

  if (!claim || typeof claim !== "object") {
    return freeze({
      decision: PROMOTION_DECISION.UNKNOWN,
      hardFailures: ["CLAIM_MISSING"],
      failureCodes: [],
      severity: SEVERITY.NONE,
      requiredRepair: REPAIR_FOR.CLAIM_MISSING,
      metRequirements: [],
      unmetRequirements: []
    });
  }

  // A confidence score is not evidence, and a caller passing one has to be
  // told rather than quietly ignored (QF-04 draws the same line).
  if ("modelConfidence" in (policy ?? {}) || "modelConfidence" in claim) {
    hardFailures.add("CONFIDENCE_AS_EVIDENCE");
  }

  const results = Array.isArray(verifierResults) ? verifierResults : [];
  const knownEvidenceIds = new Set(
    (Array.isArray(evidence) ? evidence : []).map((e) => e?.id).filter(Boolean)
  );

  for (const code of claim.failureCodes ?? []) failureCodes.add(code);
  for (const result of results) {
    for (const code of result?.failureCodes ?? []) failureCodes.add(code);
  }

  let openDebtCount = Array.isArray(claim.challengeDebtIds) ? claim.challengeDebtIds.length : 0;
  if (history && typeof history.events === "function") {
    const debt = openChallengeDebt({ claimId: claim.id, history });
    openDebtCount = Math.max(openDebtCount, debt.material);
  }
  if (openDebtCount > 0) {
    hardFailures.add(`OPEN_CHALLENGE_DEBT:${openDebtCount}`);
    failureCodes.add("F39");
  }

  const correction = correctiveState(claim, history);
  if (correction.hasCorrection && !correction.hasNewQualifyingEvidence) {
    hardFailures.add("CORRECTIVE_STATE_REGRESSION");
    failureCodes.add("F36");
    failureCodes.add("F23");
  }

  const requirements = Array.isArray(claim.verificationRequirements)
    ? [...new Set(claim.verificationRequirements)]
    : [];
  const met = [];
  const unmet = [];

  for (const requirement of requirements) {
    const answering = results.filter((r) => r?.requirement === requirement);
    if (answering.length === 0) {
      unmet.push(requirement);
      hardFailures.add(`REQUIREMENT_UNMET:${requirement}`);
      continue;
    }
    if (answering.some((r) => r.status === "FAILED")) {
      unmet.push(requirement);
      hardFailures.add(`REQUIREMENT_FAILED:${requirement}`);
      continue;
    }
    const passed = answering.filter((r) => r.status === "PASSED");
    if (passed.length === 0) {
      // Ran and reported nothing usable. Not a failure of the claim, and not a
      // reason to promote it either.
      unmet.push(requirement);
      hardFailures.add(`REQUIREMENT_UNMET:${requirement}`);
      continue;
    }
    if (settings.requireEvidenceForVerify) {
      const cited = passed.flatMap((r) => (Array.isArray(r.evidenceIds) ? r.evidenceIds : []));
      if (cited.length === 0) {
        unmet.push(requirement);
        hardFailures.add(`EVIDENCE_MISSING:${requirement}`);
        continue;
      }
      // Evidence the turn does not contain cannot support anything in it.
      if (!cited.some((id) => knownEvidenceIds.has(id))) {
        unmet.push(requirement);
        hardFailures.add(`EVIDENCE_UNKNOWN:${requirement}`);
        continue;
      }
    }
    met.push(requirement);
  }

  // REM-003: the plan reconciliation is authoritative for promotion. A claim
  // that declares verification requirements may only verify when the plan
  // summary shows full mandatory coverage; a missing, failed or unknown
  // mandatory check is a coverage gap (F29) that no downstream status can
  // hide. A claim with no requirements needs no plan and is unaffected.
  const planSummary = claim.verificationPlanSummary ?? null;
  if (requirements.length > 0) {
    const planOk =
      planSummary &&
      planSummary.status === "PASSED" &&
      planSummary.coverage === 1 &&
      (planSummary.mandatoryFailedOrMissing ?? 0) === 0;
    if (!planOk) {
      hardFailures.add("PLAN_COVERAGE_INCOMPLETE");
      failureCodes.add("F29");
    }
  }

  for (const [dependencyId, state] of Object.entries(dependencyStates ?? {})) {
    if (BROKEN_DEPENDENCY_STATES.has(state)) {
      // F24: a claim whose premise fell may not keep the standing the premise
      // gave it, whatever its own verifiers said.
      hardFailures.add(`DEPENDENCY_BROKEN:${dependencyId}:${state}`);
      failureCodes.add("F24");
    }
  }

  // §34's forbidden promotions. `targetType` is what the caller wants the claim
  // to become; absent, nothing is being promoted and there is nothing to check.
  const from = claim.epistemicType;
  const to = claim.targetType ?? null;
  if (to && to !== from && (FORBIDDEN_TYPE_PROMOTIONS[from] ?? []).includes(to)) {
    const needed = PROMOTION_EVIDENCE_KINDS[to];
    const provided = results.some(
      (r) => r?.status === "PASSED" && (r.requirement === needed || r.evidenceKind === needed)
    );
    if (!provided) {
      hardFailures.add(`FORBIDDEN_PROMOTION:${from}->${to}:${needed}`);
      failureCodes.add("F23");
    }
  }

  const severity = [...failureCodes].reduce(
    (worst, code) => Math.max(worst, FAILURE_SEVERITY[code] ?? SEVERITY.CRITICAL),
    Number.isInteger(claim.severity) ? claim.severity : SEVERITY.NONE
  );
  if (severity >= settings.blockSeverity) hardFailures.add(`SEVERITY_BLOCKED:${severity}`);

  const refuted = [...hardFailures].some(
    (f) => f.startsWith("REQUIREMENT_FAILED") || f.startsWith("DEPENDENCY_BROKEN") || f.startsWith("FORBIDDEN_PROMOTION")
  );

  // REM-003: incomplete mandatory coverage (F29) is a *withhold*, not a
  // refutation — it removes VERIFY but never triggers the terminal REJECT on
  // its own. F29 therefore lives in DEBT_FAILURE_CODES above, alongside the
  // other withholds (F36 correction, F39 challenge debt). A coverage-gap-only
  // claim resolves to PARTIAL (when a requirement is met and partial
  // publication is allowed) or UNKNOWN, which a later turn can retry.
  const coverageIncomplete = hardFailures.has("PLAN_COVERAGE_INCOMPLETE");

  // §5: an open challenge says the claim is not established, not that it was
  // refuted — the objection may itself be wrong. When debt is the only thing
  // blocking, the claim goes to UNKNOWN, which a later turn can still verify,
  // rather than to the terminal REJECTED that also invalidates its dependents.
  // The decision uses failure codes (never the stored claim.severity, which the
  // ledger may have set from a withhold code) so a debt is never turned into a
  // REJECT by virtue of carrying a HIGH severity.
  const debtOnly =
    !refuted &&
    [...failureCodes].every(
      (code) =>
        DEBT_FAILURE_CODES.has(code) ||
        (FAILURE_SEVERITY[code] ?? SEVERITY.CRITICAL) < settings.blockSeverity
    );

  let decision;
  if (refuted || (severity >= settings.blockSeverity && !debtOnly)) {
    decision = PROMOTION_DECISION.REJECT;
  } else if (coverageIncomplete && met.length > 0 && settings.allowPartial) {
    decision = PROMOTION_DECISION.PARTIAL;
  } else if (debtOnly && severity >= settings.blockSeverity) {
    decision = PROMOTION_DECISION.UNKNOWN;
  } else if (hardFailures.size === 0) {
    // Requirements all met — or none required, in which case there was never
    // anything to check and the claim was never a candidate for verification.
    decision = requirements.length === 0 ? PROMOTION_DECISION.UNKNOWN : PROMOTION_DECISION.VERIFY;
  } else if (hardFailures.has("CONFIDENCE_AS_EVIDENCE")) {
    // Not REJECT: the claim was not refuted, the call was malformed. Not
    // PARTIAL either — a caller offering a confidence score gets no promotion
    // out of this gate at all.
    decision = PROMOTION_DECISION.UNKNOWN;
  } else if (met.length > 0 && settings.allowPartial) {
    decision = PROMOTION_DECISION.PARTIAL;
  } else {
    decision = PROMOTION_DECISION.UNKNOWN;
  }

  const sortedFailures = [...hardFailures].sort();
  return freeze({
    decision,
    hardFailures: sortedFailures,
    failureCodes: [...failureCodes].sort(),
    severity,
    requiredRepair: repairFor(sortedFailures),
    metRequirements: met,
    unmetRequirements: [...new Set(unmet)]
  });
}

function freeze(result) {
  return Object.freeze({
    ...result,
    hardFailures: Object.freeze(result.hardFailures),
    failureCodes: Object.freeze(result.failureCodes),
    metRequirements: Object.freeze(result.metRequirements),
    unmetRequirements: Object.freeze(result.unmetRequirements)
  });
}
