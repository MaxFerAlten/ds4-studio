/**
 * DS4 Quantum Fix — repair transaction.
 *
 * QF-16 §38. When the gate refuses an answer, something has to say what the
 * next attempt must do differently. sageRepairPolicy and leanRepairPolicy do
 * this for their domains: classify the failure, decide whether another round is
 * worth taking, and hand back guidance the model can act on.
 *
 * The distinctive risk here is F16, recursive repair hallucination — a repair
 * round that invents a replacement rather than retrieving one, and a summary
 * that carries the withdrawn claims back in. So the guidance withdraws claims
 * by id rather than describing them, names the evidence each replacement owes,
 * and the round count is bounded: a repair that has not converged is reported
 * as unresolved, not attempted again forever.
 */

import { FAILURE_SEVERITY, SEVERITY, TERMINAL_CLAIM_STATES } from "./epistemicContracts.mjs";
import { REPAIR_PROMPT } from "./epistemicPrompts.mjs";

/**
 * The failure classes §38 says open a repair.
 *
 * Each is a claim that cannot be published as-is and cannot be fixed by
 * rewording: a fabricated source, a fabricated experiment, unexecuted code
 * called executed, a repair that hallucinated, a citation naming another work,
 * a false verification claim, and a summary reintroducing unverified claims.
 *
 * R06-PATCH-01: F27..F40 are listed explicitly even where severity already
 * catches them. The policy must be explicit, not accidental via severity — a
 * scope mismatch (F27), a hidden failed subcheck (F29), a circular validation
 * (F30), an unverified assumption (F31), a domain-model mismatch (F32), an
 * aggregation overclaim (F33), an axiom presented as a proof (F35), a
 * corrective regression (F36), a capability gap (F38), an open challenge debt
 * (F39) and an unaudited proof dependency (F40) all open a repair.
 */
export const REPAIR_TRIGGER_CODES = Object.freeze([
  "F01",
  "F03",
  "F04",
  "F16",
  "F17",
  "F18",
  "F26",
  "F27",
  "F28",
  "F29",
  "F30",
  "F31",
  "F32",
  "F33",
  "F34",
  "F35",
  "F36",
  "F37",
  "F38",
  "F39",
  "F40"
]);

export const REPAIR_STATUS = Object.freeze({
  /** Nothing in the candidate needs withdrawing. */
  NOT_REQUIRED: "NOT_REQUIRED",
  /** A repair round is owed. */
  REQUIRED: "REPAIR_REQUIRED",
  /** The rounds are spent and the failure stands. */
  EXHAUSTED: "REPAIR_EXHAUSTED",
  /** A previous repair round cleared the failures it opened for. */
  RESOLVED: "REPAIR_RESOLVED"
});

const DEFAULT_MAX_ROUNDS = 2;
const TRIGGERS = new Set(REPAIR_TRIGGER_CODES);

let _repairCounter = 0;

/** Claims still standing: a rejected claim is already withdrawn. */
function live(claims) {
  return claims.filter((c) => c && !TERMINAL_CLAIM_STATES.has(c.status));
}

function claimSeverity(claim) {
  const fromCodes = (claim.failureCodes ?? []).reduce(
    (worst, code) => Math.max(worst, FAILURE_SEVERITY[code] ?? SEVERITY.CRITICAL),
    SEVERITY.NONE
  );
  return Math.max(Number.isInteger(claim.severity) ? claim.severity : SEVERITY.NONE, fromCodes);
}

/**
 * Which claims oblige a repair: a trigger code, or severity at or above the
 * blocking threshold. §38 lists S4 and S5 alongside the codes.
 */
export function repairTriggers(claims = [], { blockSeverity = SEVERITY.HIGH } = {}) {
  return live(Array.isArray(claims) ? claims : []).filter(
    (c) => (c.failureCodes ?? []).some((code) => TRIGGERS.has(code)) || claimSeverity(c) >= blockSeverity
  );
}

/**
 * Everything that rested on a withdrawn claim, transitively.
 *
 * Computed from the claims' own dependency lists so this stays a pure function:
 * a repair decision must be reproducible from the state it was handed.
 */
export function dependentClaimIds(claims = [], rootIds = []) {
  const withdrawn = new Set(rootIds);
  const found = new Set();
  let changed = true;
  while (changed) {
    changed = false;
    for (const claim of claims) {
      if (!claim?.id || withdrawn.has(claim.id) || found.has(claim.id)) continue;
      const rests = (claim.dependencies ?? []).some((id) => withdrawn.has(id) || found.has(id));
      if (rests) {
        found.add(claim.id);
        changed = true;
      }
    }
  }
  return [...found];
}

/**
 * The guidance §38 injects, with the ids filled in.
 *
 * Ids rather than prose: "withdraw the claim about the DOI" is something a
 * model can satisfy by rephrasing it. An id is not rephraseable.
 */
export function buildRepairGuidance({ rootClaimIds = [], invalidatedClaimIds = [] } = {}) {
  const list = (ids) => (ids.length ? ids.join(", ") : "(none)");
  return [
    "EPISTEMIC_REPAIR_REQUIRED",
    "",
    REPAIR_PROMPT,
    "",
    "The previous candidate contains claims that cannot be published.",
    "Do not defend or restate them.",
    "",
    `Withdraw root claims:\n${list(rootClaimIds)}`,
    "",
    `Claims invalidated by dependency:\n${list(invalidatedClaimIds)}`,
    "",
    "For replacements:",
    "- external facts require source evidence;",
    "- bibliography requires resolver identity;",
    "- computations require Sage/tool evidence;",
    "- code execution requires execution trace.",
    "",
    "Do not introduce new exact DOI/arXiv/numeric results from memory.",
    "Return a corrected answer that preserves UNKNOWN where evidence is missing."
  ].join("\n");
}

/**
 * R06-PATCH-03/04/05: code-specific repair guidance. A repair round must do
 * something the previous one did not — narrowing, resolving, or producing the
 * missing scope/formalization — rather than restating the same claim.
 */
export function codeSpecificGuidance(code) {
  switch (code) {
    case "F27":
      return [
        "SCOPE_REPAIR F27: Do not rerun the same verifier and repeat the broad claim.",
        "Either:",
        "1. narrow the claim to the certificate scope; or",
        "2. produce a formalization/certificate matching the broader scope."
      ].join("\n");
    case "F35":
      return [
        "AXIOM_REPAIR F35: Do not present an axiom as a proof.",
        "Either:",
        "- state the theorem conditionally under the axiom; or",
        "- remove the axiom and supply a proof from accepted premises."
      ].join("\n");
    case "F39":
      return [
        "DEBT_REPAIR F39: Open challenge debt. Do not rephrase the claim.",
        "Must: resolve the challenge, or narrow the claim."
      ].join("\n");
    // Q2-015 (§27) — the remediation.Quantiom.002 repair classes.
    case "F18":
      return [
        "FORMAL_ARTIFACT_REPAIR F18: A displayed formal proof has no successful matching certificate.",
        "Either:",
        "1. remove the artifact; or",
        "2. label it explicitly as an unverified attempt; or",
        "3. obtain a checked certificate over the exact source shown.",
        "A timeout or an environment failure is not a refutation, and it is not a proof."
      ].join("\n");
    case "F08":
      return [
        "ANALOGY_REPAIR F08: The claim is an analogy rendered as a real-world mechanism.",
        "Either:",
        "1. restore explicit analogy/model wording; or",
        "2. supply a verified claim-bound modeling bridge for every required correspondence."
      ].join("\n");
    case "F13":
      return [
        "SOURCE_IDENTITY_REPAIR F13: The cited work is not identity-certified from a primary record.",
        "Retrieve the canonical arXiv/DOI/publisher page before calling it verified or published.",
        "Peer review is a separate claim and needs venue evidence of its own."
      ].join("\n");
    case "F33":
      return [
        "SYNTHESIS_REPAIR F33: The summary asserts more than its components carry.",
        "Restate what was verified, and name the unverified, analogical or hypothetical parts separately."
      ].join("\n");
    default:
      return null;
  }
}

/** Build bounded, verifier-specific guidance for the next candidate. */
export function buildVerificationRepairGuidance({
  blockedClaims = [],
  promotions = [],
  repairRound = 0,
  maxRepairRounds = 0
} = {}) {
  const byClaim = new Map(
    (Array.isArray(promotions) ? promotions : []).map((entry) => [entry?.claimId, entry])
  );
  const lines = [
    "EPISTEMIC_REPAIR_REQUIRED",
    `REPAIR_ROUND ${repairRound}/${maxRepairRounds}`,
    "The replacement candidate will be checked by the full epistemic pipeline again."
  ];

  const emittedCodeGuidance = new Set();

  for (const claim of Array.isArray(blockedClaims) ? blockedClaims : []) {
    if (!claim?.id) continue;
    const entry = byClaim.get(claim.id);
    const promotion = entry?.promotion ?? {};
    const failed = (claim.verifierResults ?? [])
      .filter((result) => result?.status === "FAILED")
      .map((result) => `${result.requirement}:${result.reasonCode ?? "FAILED"}`);
    const unmet = promotion.unmetRequirements ?? [];
    const codes = Array.isArray(claim.failureCodes) ? claim.failureCodes : [];
    const openDebt = Array.isArray(claim.challengeDebtIds) ? claim.challengeDebtIds.length : 0;

    // R06-PATCH-02: machine-readable debt, printed only when available.
    const scopes = (claim.verifierResults ?? []).map((r) => r?.scope?.status).filter(Boolean);
    const scope = scopes[0] ?? null;
    const missingScopeProps = [
      ...new Set((claim.verifierResults ?? []).flatMap((r) => r?.scope?.missing ?? []))
    ];
    const aggregates = (claim.verifierResults ?? []).filter((r) => r?.subcheckAggregate);
    const failedSubchecks = [];
    for (const r of aggregates) {
      failedSubchecks.push(
        `${r.requirement}:failed=${r.subcheckAggregate.failedChecks ?? 0}:unknown=${r.subcheckAggregate.unknownChecks ?? 0}:missing=${r.subcheckAggregate.missingChecks ?? 0}`
      );
    }
    const coverage = aggregates[0]?.subcheckAggregate?.coverage;
    const certificateKinds = [
      ...new Set((claim.verifierResults ?? []).map((r) => r?.certificate?.formalizationKind).filter(Boolean))
    ];

    lines.push(
      "",
      `CLAIM_ID ${claim.id}`,
      `CURRENT_STATUS ${entry?.finalState ?? claim.status ?? "UNKNOWN"}`,
      `FAILED_REQUIREMENTS ${failed.length ? failed.join(",") : "(none)"}`,
      `UNMET_REQUIREMENTS ${unmet.length ? unmet.join(",") : "(none)"}`,
      `FAILURE_CODES ${codes.length ? codes.join(",") : "(none)"}`
    );
    if (openDebt > 0) lines.push(`OPEN_CHALLENGE_DEBT ${openDebt}`);
    if (scope) lines.push(`SCOPE_STATUS ${scope}`);
    if (missingScopeProps.length > 0) lines.push(`MISSING_SCOPE_PROPERTIES ${missingScopeProps.join(",")}`);
    if (certificateKinds.length > 0) lines.push(`CERTIFICATE_KINDS ${certificateKinds.join(",")}`);
    if (coverage !== undefined) lines.push(`MANDATORY_COVERAGE ${coverage}`);
    if (failedSubchecks.length > 0) lines.push(`FAILED_SUBCHECKS ${failedSubchecks.join(";")}`);
    lines.push(`REPAIR_ACTION ${promotion.requiredRepair ?? "remove authoritative wording or produce claim-specific evidence"}`);

    // R06-PATCH-03/04/05: emit the specific guidance once, first claim that needs it.
    for (const code of ["F27", "F35", "F39"]) {
      if (!codes.includes(code) || emittedCodeGuidance.has(code)) continue;
      const specific = codeSpecificGuidance(code);
      if (specific) {
        lines.push("", specific);
        emittedCodeGuidance.add(code);
      }
    }
  }

  lines.push(
    "",
    "Do not invent replacement DOI/arXiv identifiers, measurements, test results or numeric values.",
    "Use the designated verifier or keep the claim explicitly UNKNOWN."
  );
  return lines.join("\n");
}

/**
 * REM-006: the stable repair identity of a claim.
 *
 * A paraphrase/broader restatement of the same semantic claim must NOT open a
 * fresh anti-repeat budget — that would let rephrasing evade the guard forever.
 * So every claim that inherits from a prior one (via `carryForwardClaimState`)
 * collapses onto the same root identity as its ancestors. Only a NARROWER claim
 * is genuinely new and starts its own fingerprint budget.
 *
 * @param {object|null} claim
 * @returns {string} the identity used in repair fingerprints.
 */
export function repairIdentityForClaim(claim) {
  if (!claim) return "";
  if (claim.inheritedClaimRelation === "NARROWER") return claim.id ?? "";
  return claim.semanticRootClaimId ?? claim.inheritedFromClaimId ?? claim.id ?? "";
}

/**
 * Decide whether a repair round is owed, and what it must do.
 *
 * Pure: the same claims and the same previous state give the same decision.
 *
 * @param {object} input
 * @param {object[]} [input.claims] - this turn's claims.
 * @param {object|null} [input.previous] - the repair state from the prior round.
 * @param {string[]} [input.replacementClaimIds] - claims offered as replacements (QF-07).
 * @param {{maxRepairRounds?: number, blockSeverity?: number}} [input.config]
 * @returns {{repairId: string|null, rootFailureClaimId: string|null, rootClaimIds: string[], invalidatedClaimIds: string[], replacementClaimIds: string[], evidenceIds: string[], round: number, maxRounds: number, status: string, failureCodes: string[], guidance: string}}
 */
export function decideEpistemicRepair({
  claims = [],
  previous = null,
  replacementClaimIds = [],
  config = {}
} = {}) {
  const maxRounds = Number.isInteger(config.maxRepairRounds) ? config.maxRepairRounds : DEFAULT_MAX_ROUNDS;
  const blockSeverity = Number.isInteger(config.blockSeverity) ? config.blockSeverity : SEVERITY.HIGH;
  const all = Array.isArray(claims) ? claims.filter(Boolean) : [];
  const triggering = repairTriggers(all, { blockSeverity });

  const base = {
    repairId: previous?.repairId ?? null,
    rootFailureClaimId: null,
    rootClaimIds: [],
    invalidatedClaimIds: [],
    replacementClaimIds: [...replacementClaimIds],
    evidenceIds: [],
    round: previous?.round ?? 0,
    maxRounds,
    status: REPAIR_STATUS.NOT_REQUIRED,
    failureCodes: [],
    seenFailures: previous?.seenFailures ?? {},
    guidance: ""
  };

  if (triggering.length === 0) {
    // A repair that opened and now finds nothing to withdraw did its job. Said
    // explicitly so a caller can tell it apart from a turn that never needed one.
    return Object.freeze({
      ...base,
      status: previous?.status === REPAIR_STATUS.REQUIRED ? REPAIR_STATUS.RESOLVED : REPAIR_STATUS.NOT_REQUIRED
    });
  }

  // Deterministic: worst severity first, then by id, so the same inputs always
  // name the same root.
  const ranked = [...triggering].sort(
    (a, b) => claimSeverity(b) - claimSeverity(a) || String(a.id).localeCompare(String(b.id))
  );
  const rootClaimIds = ranked.map((c) => c.id);
  const invalidatedClaimIds = dependentClaimIds(all, rootClaimIds);
  const failureCodes = [...new Set(ranked.flatMap((c) => c.failureCodes ?? []))].sort();
  const evidenceIds = [...new Set(ranked.flatMap((c) => c.evidenceIds ?? []))].sort();
  const round = (previous?.round ?? 0) + 1;

  // R06-PATCH-06: cumulative anti-repeat guard. Every round that stays stuck on
  // the same fingerprint increments how many times it has appeared. The same
  // semantic claim failing the same code a third time must NOT be re-offered as
  // another restatement — it is narrowed or abandoned, not paraphrased forever.
  const fingerprints = new Set(
    failureCodes.flatMap((code) => rootClaimIds.map((id) => {
      const c = ranked.find((r) => r.id === id);
      return `${repairIdentityForClaim(c)}:${code}`;
    }))
  );
  const seenFailures = { ...(previous?.seenFailures ?? {}) };
  for (const fp of fingerprints) seenFailures[fp] = (seenFailures[fp] ?? 0) + 1;
  const repeated = Object.keys(seenFailures).filter((fp) => seenFailures[fp] >= 3);

  const state = {
    ...base,
    repairId: previous?.repairId ?? `repair_${Date.now()}_${++_repairCounter}`,
    rootFailureClaimId: ranked[0].id,
    rootClaimIds,
    invalidatedClaimIds,
    evidenceIds,
    round,
    failureCodes,
    seenFailures
  };

  // R06-PATCH-06 + EPI-057: the same claim:code has now recurred three times.
  // Another semantic restatement cannot clear it — force narrowing or abort.
  if (repeated.length > 0) {
    return Object.freeze({
      ...state,
      round: maxRounds,
      status: REPAIR_STATUS.EXHAUSTED,
      guidance:
        "EPISTEMIC_REPAIR_CANNOT_PARAPHRASE: the same failure has recurred in " +
        `consecutive rounds (${repeated.join(", ")}). Rephrasing the claim cannot resolve it. ` +
        "The claim must be narrowed to what the verifier can actually certify, or withdrawn " +
        "and reported explicitly UNKNOWN. Do not rephrase the identical claim."
    });
  }

  if (round > maxRounds) {
    // F16 is what an unbounded repair loop turns into. The answer has to report
    // the failure instead of attempting the same correction again.
    return Object.freeze({
      ...state,
      round: maxRounds,
      status: REPAIR_STATUS.EXHAUSTED,
      guidance:
        "EPISTEMIC_REPAIR_EXHAUSTED: the repair rounds are spent and these claims are still " +
        `unpublishable (${rootClaimIds.join(", ")}). State plainly what could not be verified. ` +
        "Do not attempt the same correction again."
    });
  }

  const targeted = buildVerificationRepairGuidance({
    blockedClaims: ranked,
    promotions: all,
    repairRound: round,
    maxRepairRounds: maxRounds
  });
  return Object.freeze({
    ...state,
    status: REPAIR_STATUS.REQUIRED,
    guidance:
      targeted + "\n\n" + buildRepairGuidance({ rootClaimIds, invalidatedClaimIds })
  });
}

/**
 * REM-008: the pure repair-transition state machine, shared by the production
 * blocked path (index.mjs) and the behavioral tests — no test-only duplicate.
 *
 * A blocked turn may repair, is exhausted, or is incoherent (the policy reports
 * NOT_REQUIRED/RESOLVED while the current gate is still blocked).
 */
export const REPAIR_NEXT = Object.freeze({
  REPAIR: "repair",
  EXHAUSTED: "exhausted",
  BLOCKED: "blocked"
});

export function evaluateRepairTransition({ claims = [], previous = null, config = {} } = {}) {
  const decision = decideEpistemicRepair({ claims, previous, config });
  let next = REPAIR_NEXT.BLOCKED;
  if (decision.status === REPAIR_STATUS.REQUIRED) next = REPAIR_NEXT.REPAIR;
  else if (decision.status === REPAIR_STATUS.EXHAUSTED) next = REPAIR_NEXT.EXHAUSTED;
  return Object.freeze({ decision, status: decision.status, next });
}

/**
 * Q2-015 (§40) — the bounded repair debt a blocked candidate owes.
 *
 * One flat, machine-readable object rather than prose: a repair round has to be
 * able to tell whether it closed a debt or merely moved it, and §56 requires a
 * repair that trades one bad claim for a new uncovered one to stay blocked.
 *
 * @param {{claimCoverage?: object, formalArtifacts?: object[], claims?: object[]}} input
 * @returns {Readonly<object>} the debt, with a `total` for the "is it clean" test.
 */
export function buildRepairDebt({
  claimCoverage = null,
  formalArtifacts = [],
  claims = []
} = {}) {
  const withCode = (code) =>
    (Array.isArray(claims) ? claims.filter(Boolean) : [])
      .filter((claim) => (claim.failureCodes ?? []).includes(code))
      .map((claim) => claim.id)
      .filter(Boolean);

  const uncoveredClaims = [...(claimCoverage?.uncoveredSpans ?? [])];
  const unboundFormalArtifacts = (Array.isArray(formalArtifacts) ? formalArtifacts : [])
    .filter((artifact) => artifact && artifact.status !== "CHECKED_BOUND")
    .map((artifact) => artifact.artifactId)
    .filter(Boolean);
  const scopeMismatches = withCode("F27");
  const unresolvedFormalFailures = withCode("F18");
  const unverifiedSourceIdentities = [...new Set([...withCode("F13"), ...withCode("F01"), ...withCode("F17")])];
  const sourceRoleMismatches = withCode("F37");
  const analogyPromotions = [...new Set([...withCode("F08"), ...withCode("F09")])];
  const synthesisOverclaims = withCode("F33");

  const groups = [
    uncoveredClaims,
    unboundFormalArtifacts,
    scopeMismatches,
    unresolvedFormalFailures,
    unverifiedSourceIdentities,
    sourceRoleMismatches,
    analogyPromotions,
    synthesisOverclaims
  ];

  return Object.freeze({
    uncoveredClaims: Object.freeze(uncoveredClaims),
    unboundFormalArtifacts: Object.freeze(unboundFormalArtifacts),
    scopeMismatches: Object.freeze(scopeMismatches),
    unresolvedFormalFailures: Object.freeze(unresolvedFormalFailures),
    unverifiedSourceIdentities: Object.freeze(unverifiedSourceIdentities),
    sourceRoleMismatches: Object.freeze(sourceRoleMismatches),
    analogyPromotions: Object.freeze(analogyPromotions),
    synthesisOverclaims: Object.freeze(synthesisOverclaims),
    total: groups.reduce((sum, group) => sum + group.length, 0)
  });
}
