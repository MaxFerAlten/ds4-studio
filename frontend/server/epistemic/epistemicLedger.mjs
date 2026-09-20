/**
 * DS4 Quantum Fix — claim ledger.
 *
 * QF-04 §26. Claims, the evidence attached to them, the dependencies between
 * them, and the challenges raised against them. The state machine lives in
 * epistemicContracts.mjs; this module owns the graph and enforces the one rule
 * §26 states outright: a claim reaches VERIFIED because its verification
 * requirements were met, never because the model sounded sure.
 *
 * Dependency tracking exists for F24. When a premise falls, every claim that
 * rested on it has to lose the authority it was granted, and it has to happen
 * by construction rather than by the model remembering to retract.
 */

import { createHash } from "node:crypto";
import { CLAIM_EVENT_KIND, ClaimHistory } from "./epistemicClaimHistory.mjs";
import { CHALLENGE_ORIGIN } from "./epistemicChallengeDebt.mjs";
import {
  CLAIM_DOMAIN,
  EPISTEMIC_TYPES,
  CLAIM_STATES,
  FAILURE_SEVERITY,
  SEVERITY,
  assertClaimTransition
} from "./epistemicContracts.mjs";

let _claimCounter = 0;
let _challengeCounter = 0;

export class EpistemicLedgerError extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.name = "EpistemicLedgerError";
    this.code = code;
  }
}

/**
 * Text reduced to what two phrasings of the same assertion share: case,
 * surrounding whitespace and trailing punctuation carry no epistemic weight.
 * Used for the claim's own identity, so restating a claim does not create a
 * second one that has to be verified again.
 */
export function normalizeClaimText(text) {
  return String(text ?? "")
    .normalize("NFC")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    // After the trim, not before: trailing punctuation only sits at the end
    // once the surrounding whitespace is gone.
    .replace(/[.!?;:,]+$/, "");
}

function claimFingerprint(normalizedText) {
  return createHash("sha256").update(normalizedText).digest("hex").slice(0, 16);
}

const nowIso = () => new Date().toISOString();

/**
 * REM-002.4: defensive clone for nested verifier-contract records. Never hold
 * a mutable reference shared with the caller; unknown/absent values become
 * null so serialization stays stable.
 */
function cloneRecordValue(value) {
  if (!value || typeof value !== "object") return null;
  try {
    return structuredClone(value);
  } catch {
    // structuredClone cannot clone functions/symbols on some records; fall
    // back to JSON where possible, else a spread copy.
    return typeof value === "object" ? { ...value } : null;
  }
}

/** The history event a state change is worth, keyed by the state entered. */
const TRANSITION_EVENT_KINDS = Object.freeze({
  VERIFIED: CLAIM_EVENT_KIND.PROMOTED,
  REJECTED: CLAIM_EVENT_KIND.DOWNGRADED,
  UNKNOWN: CLAIM_EVENT_KIND.DOWNGRADED,
  CONTRADICTED: CLAIM_EVENT_KIND.CONTRADICTED,
  INVALIDATED: CLAIM_EVENT_KIND.INVALIDATED
});

/** States a claim only reaches by losing standing (§25). */
const CORRECTIVE_STATES = Object.freeze(
  new Set(["REJECTED", "UNKNOWN", "CONTRADICTED", "INVALIDATED"])
);

const CHALLENGER_ORIGINS = Object.freeze({
  user: CHALLENGE_ORIGIN.USER,
  self: CHALLENGE_ORIGIN.MODEL_SELF,
  model: CHALLENGE_ORIGIN.MODEL_SELF,
  verifier: CHALLENGE_ORIGIN.VERIFIER,
  tool: CHALLENGE_ORIGIN.VERIFIER
});

const VALID_CHALLENGE_ORIGINS = new Set(Object.values(CHALLENGE_ORIGIN));

/**
 * Build a claim. Always starts at PROPOSED with no evidence and no verdict:
 * there is no constructor argument that can produce a verified claim.
 */
export function createClaim(input = {}) {
  const text = String(input.text ?? "");
  const normalizedText = normalizeClaimText(text);
  const epistemicType = EPISTEMIC_TYPES.includes(input.epistemicType)
    ? input.epistemicType
    : "UNKNOWN";

  return {
    id: input.id || `claim_${claimFingerprint(normalizedText)}_${++_claimCounter}`,
    text,
    normalizedText,
    epistemicType,
    status: "PROPOSED",
    domain: Object.values(CLAIM_DOMAIN).includes(input.domain) ? input.domain : CLAIM_DOMAIN.GENERAL,
    claimClass: input.claimClass ?? null,
    subject: input.subject ?? null,
    predicate: input.predicate ?? null,
    object: input.object ?? null,

    sourceTurnId: input.sourceTurnId ?? null,
    sourceMessageRevision: input.sourceMessageRevision ?? null,

    dependencies: Array.isArray(input.dependencies) ? [...input.dependencies] : [],
    assumptions: Array.isArray(input.assumptions) ? [...input.assumptions] : [],
    evidenceIds: Array.isArray(input.evidenceIds) ? [...input.evidenceIds] : [],
    verificationRequirements: Array.isArray(input.verificationRequirements)
      ? [...input.verificationRequirements]
      : [],
    verifierResults: [],
    verifierCertificateIds: Array.isArray(input.verifierCertificateIds)
      ? [...input.verifierCertificateIds]
      : [],
    verificationTarget:
      input.verificationTarget && typeof input.verificationTarget === "object"
        ? structuredClone(input.verificationTarget)
        : null,
    expectedCertificateScope:
      input.expectedCertificateScope && typeof input.expectedCertificateScope === "object"
        ? structuredClone(input.expectedCertificateScope)
        : null,
    verificationPlanSummary:
      input.verificationPlanSummary && typeof input.verificationPlanSummary === "object"
        ? structuredClone(input.verificationPlanSummary)
        : null,

    historyEventIds: Array.isArray(input.historyEventIds) ? [...input.historyEventIds] : [],
    challengeDebtIds: Array.isArray(input.challengeDebtIds) ? [...input.challengeDebtIds] : [],
    correctiveEpoch: Number.isInteger(input.correctiveEpoch) && input.correctiveEpoch >= 0
      ? input.correctiveEpoch
      : 0,
    lastQualifiedEvidenceEpoch:
      Number.isInteger(input.lastQualifiedEvidenceEpoch) && input.lastQualifiedEvidenceEpoch >= 0
        ? input.lastQualifiedEvidenceEpoch
        : 0,

    failureCodes: [],
    severity: SEVERITY.NONE,

    createdAt: input.createdAt || nowIso(),
    updatedAt: input.updatedAt || nowIso()
  };
}

export function createChallenge(input = {}) {
  return {
    id: input.id || `challenge_${++_challengeCounter}`,
    targetClaimId: String(input.targetClaimId ?? ""),
    // "user" is the common case: someone says the answer is wrong. That is a
    // challenge, not a verdict — EPI-016.
    challengerType: input.challengerType || "user",
    challengeText: String(input.challengeText ?? ""),
    proposedReplacement: input.proposedReplacement ?? null,
    evidenceIds: Array.isArray(input.evidenceIds) ? [...input.evidenceIds] : [],
    status: "UNVERIFIED",
    createdAt: input.createdAt || nowIso()
  };
}

export class EpistemicLedger {
  constructor() {
    this.claims = new Map();
    // RFQ001-02: the ledger is the only place every corrective event passes
    // through, so the history lives here rather than beside it, where a
    // caller could forget to append to it.
    this.history = new ClaimHistory();
    this.challenges = new Map();
    // parentId -> Set(childId): the child rests on the parent.
    this.dependents = new Map();
  }

  /**
   * REM-005.3 — read-only snapshot of the claim history, safe to hand across a
   * turn boundary for staging. Exposes only `events(claimId)` (which returns a
   * defensive copy) — never mutation.
   */
  historySnapshot() {
    const history = this.history;
    return Object.freeze({
      events(claimId) {
        return history.events(claimId);
      }
    });
  }

  addClaim(claim) {
    if (!claim || typeof claim !== "object" || !claim.id) {
      throw new EpistemicLedgerError("INVALID_CLAIM", "a claim with an id is required");
    }
    if (this.claims.has(claim.id)) {
      throw new EpistemicLedgerError("DUPLICATE_CLAIM", claim.id);
    }
    this.claims.set(claim.id, claim);
    this.#append(claim, { kind: CLAIM_EVENT_KIND.CREATED, status: claim.status });
    for (const parentId of claim.dependencies) this.#linkDependency(parentId, claim.id);
    return claim;
  }

  /** Import an internal, validated session snapshot without resetting its state. */
  importSnapshotClaim(snapshot) {
    if (!snapshot || typeof snapshot !== "object" || !snapshot.id) {
      throw new EpistemicLedgerError("INVALID_SNAPSHOT_CLAIM", "a snapshot claim id is required");
    }
    if (!CLAIM_STATES.includes(snapshot.status)) {
      throw new EpistemicLedgerError("INVALID_SNAPSHOT_STATE", String(snapshot.status));
    }
    if (!EPISTEMIC_TYPES.includes(snapshot.epistemicType)) {
      throw new EpistemicLedgerError("INVALID_SNAPSHOT_TYPE", String(snapshot.epistemicType));
    }
    const text = String(snapshot.text ?? "");
    const claim = {
      id: String(snapshot.id),
      text,
      normalizedText: snapshot.normalizedText || normalizeClaimText(text),
      epistemicType: snapshot.epistemicType,
      status: snapshot.status,
      domain: Object.values(CLAIM_DOMAIN).includes(snapshot.domain)
        ? snapshot.domain
        : CLAIM_DOMAIN.GENERAL,
      claimClass: snapshot.claimClass ?? null,
      subject: snapshot.subject ?? null,
      predicate: snapshot.predicate ?? null,
      object: snapshot.object ?? null,
      sourceTurnId: snapshot.sourceTurnId ?? null,
      sourceMessageRevision: snapshot.sourceMessageRevision ?? null,
      dependencies: [...(snapshot.dependencies ?? [])],
      assumptions: [...(snapshot.assumptions ?? [])],
      evidenceIds: [...(snapshot.evidenceIds ?? [])],
      verificationRequirements: [...(snapshot.verificationRequirements ?? [])],
      verifierResults: (snapshot.verifierResults ?? []).map((result) => ({
        ...result,
        evidenceIds: [...(result.evidenceIds ?? [])],
        failureCodes: [...(result.failureCodes ?? [])],
        // REM-002: nested verifier-contract records survive the clone
        // defensively (never a shared mutable reference).
        certificate: cloneRecordValue(result.certificate),
        scope: cloneRecordValue(result.scope),
        subcheckAggregate: cloneRecordValue(result.subcheckAggregate)
      })),
      verifierCertificateIds: [...(snapshot.verifierCertificateIds ?? [])],
      verificationTarget:
        snapshot.verificationTarget && typeof snapshot.verificationTarget === "object"
          ? structuredClone(snapshot.verificationTarget)
          : null,
      expectedCertificateScope:
        snapshot.expectedCertificateScope && typeof snapshot.expectedCertificateScope === "object"
          ? structuredClone(snapshot.expectedCertificateScope)
          : null,
      verificationPlanSummary:
        snapshot.verificationPlanSummary &&
        typeof snapshot.verificationPlanSummary === "object"
          ? structuredClone(snapshot.verificationPlanSummary)
          : null,
      historyEventIds: [...(snapshot.historyEventIds ?? [])],
      challengeDebtIds: [...(snapshot.challengeDebtIds ?? [])],
      correctiveEpoch:
        Number.isInteger(snapshot.correctiveEpoch) && snapshot.correctiveEpoch >= 0
          ? snapshot.correctiveEpoch
          : 0,
      lastQualifiedEvidenceEpoch:
        Number.isInteger(snapshot.lastQualifiedEvidenceEpoch) && snapshot.lastQualifiedEvidenceEpoch >= 0
          ? snapshot.lastQualifiedEvidenceEpoch
          : 0,
      failureCodes: [...(snapshot.failureCodes ?? [])],
      severity: Number.isInteger(snapshot.severity) ? snapshot.severity : SEVERITY.NONE,
      flags: snapshot.flags && typeof snapshot.flags === "object" ? { ...snapshot.flags } : {},
      createdAt: snapshot.createdAt || nowIso(),
      updatedAt: snapshot.updatedAt || nowIso(),
      importedFromSession: true
    };
    if (claim.status === "VERIFIED" && claim.evidenceIds.length === 0) {
      throw new EpistemicLedgerError(
        "INVALID_SNAPSHOT_EVIDENCE",
        `${claim.id}: a VERIFIED snapshot needs evidence`
      );
    }
    return this.addClaim(claim);
  }

  create(input) {
    return this.addClaim(createClaim(input));
  }

  getClaim(id) {
    return this.claims.get(id) ?? null;
  }

  allClaims() {
    return [...this.claims.values()];
  }

  /** The claim carrying this exact assertion, if one already exists. */
  findByText(text) {
    const normalized = normalizeClaimText(text);
    return this.allClaims().find((c) => c.normalizedText === normalized) ?? null;
  }

  #requireClaim(id) {
    const claim = this.claims.get(id);
    if (!claim) throw new EpistemicLedgerError("UNKNOWN_CLAIM", String(id));
    return claim;
  }

  #linkDependency(parentId, childId) {
    if (!this.dependents.has(parentId)) this.dependents.set(parentId, new Set());
    this.dependents.get(parentId).add(childId);
  }

  /** `childId` rests on `parentId`: if the parent falls, the child falls. */
  addDependency(parentId, childId) {
    const child = this.#requireClaim(childId);
    this.#requireClaim(parentId);
    if (parentId === childId) {
      throw new EpistemicLedgerError("SELF_DEPENDENCY", childId);
    }
    if (!child.dependencies.includes(parentId)) child.dependencies.push(parentId);
    this.#linkDependency(parentId, childId);
    child.updatedAt = nowIso();
    return child;
  }

  /**
   * Every claim that rests on `id`, directly or through a chain.
   *
   * Breadth-first with a visited set: a dependency cycle is a modelling error,
   * not a reason to hang the turn that hit it.
   */
  transitiveDependents(id) {
    const seen = new Set();
    const queue = [...(this.dependents.get(id) ?? [])];
    while (queue.length > 0) {
      const next = queue.shift();
      if (next === id || seen.has(next)) continue;
      seen.add(next);
      for (const child of this.dependents.get(next) ?? []) {
        if (!seen.has(child)) queue.push(child);
      }
    }
    return [...seen];
  }

  attachEvidence(claimId, evidenceId) {
    const claim = this.#requireClaim(claimId);
    const id = String(evidenceId ?? "");
    if (!id) throw new EpistemicLedgerError("INVALID_EVIDENCE_ID", claimId);
    if (!claim.evidenceIds.includes(id)) {
      claim.evidenceIds.push(id);
      this.#append(claim, { kind: CLAIM_EVENT_KIND.EVIDENCE_BOUND, evidenceIds: [id] });
    }
    claim.updatedAt = nowIso();
    return claim;
  }

  /**
   * Record what a verifier returned. Failure codes accumulate and the claim's
   * severity is the worst one seen, so a later clean verifier cannot erase an
   * earlier failure.
   */
  recordVerifierResult(claimId, result = {}) {
    const claim = this.#requireClaim(claimId);
    const codes = Array.isArray(result.failureCodes) ? result.failureCodes : [];
    claim.verifierResults.push({
      verifier: String(result.verifier ?? "unknown"),
      // Which of the claim's verificationRequirements this result answers. The
      // promotion gate needs it to tell a met requirement from an unmet one;
      // without it, a passing verifier for the wrong requirement would count.
      requirement: result.requirement ? String(result.requirement) : null,
      // REM-002: the verifier contract must survive dispatcher -> ledger. The
      // check id, certificate, scope and subcheck aggregate are all captured
      // here (deep-cloned) so nothing the dispatcher established is lost and
      // later modules (finalizer, promotion, audit) can rely on them.
      checkId: result.checkId ? String(result.checkId) : null,
      status: String(result.status ?? "UNKNOWN"),
      reasonCode: result.reasonCode ?? null,
      evidenceIds: Array.isArray(result.evidenceIds) ? [...result.evidenceIds] : [],
      failureCodes: [...codes],
      certificate: cloneRecordValue(result.certificate),
      scope: cloneRecordValue(result.scope),
      subcheckAggregate: cloneRecordValue(result.subcheckAggregate),
      observedAt: result.observedAt || nowIso()
    });
    // REM-002.5: index the certificate id on the claim so the finalizer can
    // find it without re-deriving it from the raw result.
    const certId = result.certificate?.id;
    if (certId && !claim.verifierCertificateIds.includes(certId)) {
      claim.verifierCertificateIds.push(certId);
    }
    const evidenceIds = Array.isArray(result.evidenceIds) ? [...result.evidenceIds] : [];
    this.#append(claim, {
      kind: CLAIM_EVENT_KIND.VERIFIER_RESULT,
      verifier: String(result.verifier ?? "unknown"),
      requirement: result.requirement ? String(result.requirement) : null,
      checkId: result.checkId ? String(result.checkId) : null,
      certificateId: certId ?? null,
      scopeStatus: result.scope?.status ?? null,
      subcheckStatus: result.subcheckAggregate?.status ?? null,
      status: String(result.status ?? "UNKNOWN"),
      evidenceIds
    });
    // §26: a verifier that ran, passed and bound evidence is the only thing
    // that moves a claim past a correction it already took.
    if (String(result.status ?? "") === "PASSED" && evidenceIds.length > 0) {
      claim.lastQualifiedEvidenceEpoch = claim.correctiveEpoch;
    }
    for (const code of codes) {
      if (!claim.failureCodes.includes(code)) claim.failureCodes.push(code);
    }
    for (const code of claim.failureCodes) {
      // An unrecognised code counts as CRITICAL, matching blocksPublication:
      // a class this build does not know is a reason to stop.
      const level = FAILURE_SEVERITY[code] ?? SEVERITY.CRITICAL;
      if (level > claim.severity) claim.severity = level;
    }
    claim.updatedAt = nowIso();
    return claim;
  }

  /** Persist failure codes produced by promotion/dependency policy. */
  recordFailureCodes(claimId, codes = []) {
    const claim = this.#requireClaim(claimId);
    for (const raw of Array.isArray(codes) ? codes : []) {
      const code = String(raw ?? "");
      if (code && !claim.failureCodes.includes(code)) claim.failureCodes.push(code);
    }
    for (const code of claim.failureCodes) {
      const level = FAILURE_SEVERITY[code] ?? SEVERITY.CRITICAL;
      if (level > claim.severity) claim.severity = level;
    }
    claim.updatedAt = nowIso();
    return claim;
  }

  /**
   * REM-003: persist the bounded plan-reconciliation summary on the claim so
   * the promotion gate can make mandatory coverage authoritative. When any
   * mandatory check is missing/failed/unknown, F29 propagates and the claim
   * cannot be promoted to VERIFIED.
   */
  recordVerificationPlanSummary(claimId, summary = null) {
    const claim = this.#requireClaim(claimId);
    claim.verificationPlanSummary = summary
      ? cloneRecordValue(summary)
      : null;
    if (
      !summary ||
      summary.status !== "PASSED" ||
      summary.coverage !== 1 ||
      (summary.mandatoryFailedOrMissing ?? 0) > 0
    ) {
      // REM-003.3: propagate F29 so the claim cannot reach VERIFIED. Do NOT
      // raise claim.severity here: F29 (HIGH) is a *withhold* — the promotion
      // gate maps it to PARTIAL/UNKNOWN, not a terminal severity block, and
      // elevating severity would turn the coverage gap into an unintended
      // REJECT through severeBlocker.
      if (!claim.failureCodes.includes("F29")) claim.failureCodes.push("F29");
    }
    claim.updatedAt = nowIso();
    return claim;
  }

  /**
   * Move a claim to `nextState`.
   *
   * The state machine decides whether the edge exists; this adds the evidence
   * precondition §26 requires. VERIFIED is authorised by
   * `options.requirementsComplete === true` and by nothing else — a
   * modelConfidence in the options is rejected outright rather than ignored,
   * because silently dropping it would let a caller believe it had been used.
   */
  transition(claimId, nextState, options = {}) {
    const claim = this.#requireClaim(claimId);

    if ("modelConfidence" in options) {
      throw new EpistemicLedgerError(
        "CONFIDENCE_IS_NOT_EVIDENCE",
        `${claimId} -> ${nextState}: modelConfidence cannot authorize a transition`
      );
    }

    if (nextState === "VERIFIED") {
      if (options.requirementsComplete !== true) {
        throw new EpistemicLedgerError(
          "REQUIREMENTS_INCOMPLETE",
          `${claimId} cannot be VERIFIED before its verification requirements are met`
        );
      }
      if (claim.evidenceIds.length === 0) {
        throw new EpistemicLedgerError(
          "NO_EVIDENCE",
          `${claimId} cannot be VERIFIED with no evidence attached`
        );
      }
    }

    assertClaimTransition(claim.status, nextState, options);
    claim.status = nextState;
    claim.updatedAt = nowIso();
    // §25: a state a claim was pushed down into is history the finalizer is
    // owed. CHALLENGED is left to noteChallenge, which is the only caller
    // that has the challenge itself to record.
    const kind = TRANSITION_EVENT_KINDS[nextState];
    if (kind) {
      this.#append(claim, { kind, status: nextState });
      if (CORRECTIVE_STATES.has(nextState)) claim.correctiveEpoch += 1;
    }
    return claim;
  }

  /**
   * Append one event to the claim's history and remember its id on the claim.
   *
   * Private on purpose: history is written as a side effect of the operations
   * that change a claim, never by a caller deciding what to record.
   */
  #append(claim, event) {
    const appended = this.history.append({ ...event, claimId: claim.id });
    claim.historyEventIds.push(appended.eventId);
    return appended;
  }

  /**
   * Record a material objection against a claim (§12).
   *
   * The claim's state is not touched: a challenge is verification debt, and a
   * challenger — user, verifier or the model objecting to itself — is not an
   * authority on whether the claim is wrong. Only resolveChallenge clears it.
   *
   * @returns {string} the challenge id, to resolve it with later.
   */
  noteChallenge({
    claimId,
    challengeId = null,
    origin = CHALLENGE_ORIGIN.MODEL_SELF,
    text = "",
    severity = 4,
    material = true,
    evidenceIds = [],
    challengeClass = null
  } = {}) {
    const claim = this.#requireClaim(claimId);
    if (!VALID_CHALLENGE_ORIGINS.has(origin)) {
      throw new EpistemicLedgerError("INVALID_CHALLENGE_ORIGIN", String(origin));
    }
    const body = String(text ?? "").trim();
    if (!body) throw new EpistemicLedgerError("EMPTY_CHALLENGE", claimId);

    const id = String(challengeId || `debt_${++_challengeCounter}`);
    this.#append(claim, {
      kind: CLAIM_EVENT_KIND.CHALLENGED,
      challengeId: id,
      origin,
      text: body,
      severity: Number.isInteger(severity) && severity >= 0 && severity <= 5 ? severity : 4,
      material: material !== false,
      challengeClass,
      evidenceIds: [...evidenceIds]
    });
    claim.correctiveEpoch += 1;
    if (!claim.challengeDebtIds.includes(id)) claim.challengeDebtIds.push(id);
    return id;
  }

  /**
   * Close a challenge with what answered it (§19).
   *
   * The evidence that closes it is part of the record, because "on second
   * thought this is fine" is not a resolution.
   */
  resolveChallenge({
    claimId,
    challengeId,
    status = "RESOLVED_SUPPORTED",
    evidenceIds = [],
    verifierResultIds = []
  } = {}) {
    const claim = this.#requireClaim(claimId);
    const id = String(challengeId ?? "");
    if (!claim.challengeDebtIds.includes(id)) {
      throw new EpistemicLedgerError("UNKNOWN_CHALLENGE", `${claimId}: ${id}`);
    }
    this.#append(claim, {
      kind: CLAIM_EVENT_KIND.CHALLENGE_RESOLVED,
      challengeId: id,
      status,
      evidenceIds: [...evidenceIds],
      verifierResultIds: [...verifierResultIds]
    });
    claim.challengeDebtIds = claim.challengeDebtIds.filter((debtId) => debtId !== id);
    return claim;
  }

  challenge(input) {
    const challenge = createChallenge(input);
    const claim = this.#requireClaim(challenge.targetClaimId);
    this.challenges.set(challenge.id, challenge);
    // A challenge sends the claim back through verification. It never decides
    // the outcome: the challenger being right is itself something to verify.
    this.transition(claim.id, "CHALLENGED", { kind: "challenge" });
    this.noteChallenge({
      claimId: claim.id,
      challengeId: challenge.id,
      origin: CHALLENGER_ORIGINS[challenge.challengerType] ?? CHALLENGE_ORIGIN.USER,
      text: challenge.challengeText || "challenge raised against this claim",
      evidenceIds: challenge.evidenceIds
    });
    return challenge;
  }

  getChallenge(id) {
    return this.challenges.get(id) ?? null;
  }

  challengesFor(claimId) {
    return [...this.challenges.values()].filter((c) => c.targetClaimId === claimId);
  }

  /**
   * Invalidate everything that rested on `rootId`.
   *
   * Claims in a state that cannot be invalidated (still pending, already
   * rejected) are skipped rather than forced: this reports what it changed
   * instead of pretending the whole subtree was settled.
   *
   * @returns {{invalidated: string[], skipped: {id: string, status: string}[]}}
   */
  invalidateDependents(rootId, reason) {
    this.#requireClaim(rootId);
    const reasonCode = String(reason ?? "");
    if (!/^[A-Z][A-Z0-9_:-]{2,127}$/.test(reasonCode)) {
      throw new EpistemicLedgerError(
        "INVALID_REASON_CODE",
        "invalidation must name the premise that failed"
      );
    }

    const invalidated = [];
    const skipped = [];
    for (const id of this.transitiveDependents(rootId)) {
      const claim = this.claims.get(id);
      try {
        this.transition(id, "INVALIDATED", { kind: "dependency_failure", reasonCode });
        invalidated.push(id);
      } catch {
        skipped.push({ id, status: claim?.status ?? "UNKNOWN" });
      }
    }
    return { invalidated, skipped };
  }

  /** Claims that are settled as usable knowledge right now. */
  verified() {
    return this.allClaims().filter((c) => c.status === "VERIFIED");
  }

  /** Claims carrying at least one failure code. */
  failing() {
    return this.allClaims().filter((c) => c.failureCodes.length > 0);
  }

  /** The worst severity anywhere in the ledger. */
  maxSeverity() {
    return this.allClaims().reduce((worst, c) => (c.severity > worst ? c.severity : worst), SEVERITY.NONE);
  }

  snapshot() {
    return {
      claimCount: this.claims.size,
      challengeCount: this.challenges.size,
      byStatus: this.allClaims().reduce((acc, c) => {
        acc[c.status] = (acc[c.status] ?? 0) + 1;
        return acc;
      }, {}),
      maxSeverity: this.maxSeverity(),
      failureCodes: [...new Set(this.allClaims().flatMap((c) => c.failureCodes))].sort(),
      claims: this.allClaims().map((c) => ({
        id: c.id,
        status: c.status,
        epistemicType: c.epistemicType,
        severity: c.severity,
        failureCodes: [...c.failureCodes],
        dependencies: [...c.dependencies],
        evidenceIds: [...c.evidenceIds]
      }))
    };
  }
}
