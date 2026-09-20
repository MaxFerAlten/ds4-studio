/**
 * DS4 Quantum Fix — session-level claim persistence.
 *
 * QF-18 §40. A claim verified in one turn should not need re-verifying in the
 * next, and a claim rejected in one turn must not quietly come back in the
 * next. Both need state that outlives the turn.
 *
 * What this deliberately is not: chat messages. §40 is explicit that the ledger
 * must not contaminate the transcript hash, so it lives beside the messages as
 * a separate serialisable field and never enters `state.messages`.
 *
 * The asymmetry between accepted and rejected is the point. Accepted claims are
 * promoted only from a turn the gates allowed; rejected ones are kept as
 * negative provenance and cannot be re-promoted without new evidence, which is
 * what stops a refused claim from being re-proposed until it gets through.
 */

import { normalizeClaimText } from "./epistemicLedger.mjs";

/**
 * R05-PATCH-11: schema version bumps because the session format now carries a
 * per-claim event history (v3). v1/v2 load with an empty event history rather
 * than being discarded, so an older session's accepted/rejected state survives.
 */
export const SESSION_LEDGER_VERSION = "epistemic_session_v3";

/**
 * Schemas this build can still load (§84).
 *
 * v1 carried no corrective history. Its claims load with empty debt rather
 * than being discarded — losing a session's accepted claims to a schema bump
 * would be a worse failure than reading them without their history.
 * v2 carried corrective history on each claim but no separate event map.
 */
const READABLE_LEDGER_VERSIONS = new Set([
  "epistemic_session_v1",
  "epistemic_session_v2",
  SESSION_LEDGER_VERSION
]);

/** Events kept per claim between turns; enough for an audit, bounded for memory. */
export const MAX_EVENTS_PER_CLAIM = 64;

/** Rem-002: defensive clone for nested verifier-contract records. */
function cloneRecordValue(value) {
  if (!value || typeof value !== "object") return null;
  try {
    return structuredClone(value);
  } catch {
    return typeof value === "object" ? { ...value } : null;
  }
}

/** The fields worth keeping between turns. A claim's full text is not one. */
function persistable(claim) {
  return {
    id: claim.id,
    normalizedText: claim.normalizedText || normalizeClaimText(claim.text),
    text: String(claim.text ?? "").slice(0, 500),
    epistemicType: claim.epistemicType ?? "UNKNOWN",
    status: claim.status ?? "PROPOSED",
    severity: Number.isInteger(claim.severity) ? claim.severity : 0,
    failureCodes: [...(claim.failureCodes ?? [])],
    evidenceIds: [...(claim.evidenceIds ?? [])],
    dependencies: [...(claim.dependencies ?? [])],
    verificationRequirements: [...(claim.verificationRequirements ?? [])],
    verifierResults: (claim.verifierResults ?? []).map((result) => ({
      ...result,
      evidenceIds: [...(result.evidenceIds ?? [])],
      failureCodes: [...(result.failureCodes ?? [])],
      // REM-002: the verifier contract (checkId/certificate/scope/subcheck)
      // must survive session serialization so nothing the dispatcher
      // established is dropped across turns.
      certificate: cloneRecordValue(result.certificate),
      scope: cloneRecordValue(result.scope),
      subcheckAggregate: cloneRecordValue(result.subcheckAggregate)
    })),
    flags: claim.flags && typeof claim.flags === "object" ? { ...claim.flags } : {},
    // §82: what the claim already owes. Without these a claim challenged in
    // one turn comes back clean in the next, which is the failure this whole
    // report exists to stop.
    historyEventIds: [...(claim.historyEventIds ?? [])],
    challengeDebtIds: [...(claim.challengeDebtIds ?? [])],
    correctiveEpoch: Number.isInteger(claim.correctiveEpoch) ? claim.correctiveEpoch : 0,
    lastQualifiedEvidenceEpoch: Number.isInteger(claim.lastQualifiedEvidenceEpoch)
      ? claim.lastQualifiedEvidenceEpoch
      : 0,
    negativeProvenance: [...(claim.negativeProvenance ?? [])],
    inheritedClaimRelation: claim.inheritedClaimRelation ?? null,
    turn: claim.turn ?? null
  };
}

export class EpistemicSessionLedger {
  constructor() {
    this.clear();
  }

  /** Wipe everything. Called on session start, stop and reset. */
  clear() {
    /** Claims a completed turn was allowed to publish, by normalized text. */
    this.accepted = new Map();
    /** Claims a turn refused, kept so they cannot come back unchanged. */
    this.rejected = new Map();
    /** Claims still UNKNOWN/PARTIAL; retained for audit, never promoted as truth. */
    this.unresolved = new Map();
    /** Claim id -> the epistemic events recorded against it (§82). */
    this.events = new Map();
    this.turn = 0;
    this.candidate = [];
    return this;
  }

  /** Open a turn. The candidate scope from any previous turn is dropped. */
  beginTurn() {
    this.turn += 1;
    this.candidate = [];
    return this.turn;
  }

  /**
   * Stage claims for this turn. Nothing is accepted until the gates allow it.
   *
   * R05-PATCH-07/08: when the caller passes the turn's claim history, the
   * bounded epistemic events for each claim are copied into the session event
   * map. This is the persistence the event map previously lacked. Raw reasoning
   * is never copied; only structured events (kind, origin, severity, ids).
   */
  stageClaims(claims = [], { history } = {}) {
    for (const claim of claims) {
      if (claim?.id) {
        this.candidate.push({ ...persistable(claim), turn: this.turn });
        if (history && typeof history.events === "function") {
          this.#persistEvents(claim.id, history.events(claim.id));
        }
      }
    }
    return this.candidate.length;
  }

  #persistEvents(claimId, events = []) {
    if (!claimId || !Array.isArray(events)) return;
    const existing = this.events.get(claimId) ?? [];
    const seen = new Set(existing.map((event) => event.eventId));
    const bounded = [];
    for (const event of events) {
      if (!event?.eventId || seen.has(event.eventId)) continue;
      seen.add(event.eventId);
      bounded.push({
        claimId,
        eventId: event.eventId,
        kind: event.kind ?? null,
        challengeId: event.challengeId ?? null,
        origin: event.origin ?? null,
        severity: Number.isInteger(event.severity) ? event.severity : null,
        evidenceIds: [...(event.evidenceIds ?? [])],
        at: event.at ?? null
      });
      if (existing.length + bounded.length >= MAX_EVENTS_PER_CLAIM) break;
    }
    if (bounded.length > 0) {
      this.events.set(claimId, [
        ...existing,
        ...bounded
      ].slice(-MAX_EVENTS_PER_CLAIM));
    }
  }

  /**
   * Promote this turn's candidates into accepted session state.
   *
   * Only called for a final answer every gate allowed. A claim that is itself
   * REJECTED or CONTRADICTED is recorded as negative provenance instead of
   * being accepted, even in an allowed turn: the turn passing does not make
   * every claim in it true.
   */
  commitClaims(claims = null) {
    const staged = Array.isArray(claims) && claims.length > 0
      ? claims.map((c) => ({ ...persistable(c), turn: this.turn }))
      : this.candidate;
    const accepted = [];
    const rejected = [];
    const unresolved = [];
    for (const claim of staged) {
      if (claim.status === "VERIFIED") {
        this.accepted.set(claim.normalizedText, claim);
        this.rejected.delete(claim.normalizedText);
        this.unresolved.delete(claim.normalizedText);
        accepted.push(claim.id);
        continue;
      }
      if (["REJECTED", "CONTRADICTED", "INVALIDATED"].includes(claim.status)) {
        this.rejected.set(claim.normalizedText, claim);
        this.accepted.delete(claim.normalizedText);
        this.unresolved.delete(claim.normalizedText);
        rejected.push(claim.id);
        continue;
      }
      this.unresolved.set(claim.normalizedText, claim);
      this.accepted.delete(claim.normalizedText);
      unresolved.push(claim.id);
    }
    this.candidate = [];
    return { accepted, rejected, unresolved };
  }

  /**
   * Drop the candidate scope of a turn the gates refused.
   *
   * §40: a rejected candidate's claims are not promoted into accepted session
   * state. They are kept as negative provenance so the next attempt cannot
   * simply restate them.
   */
  discardCandidate(reason = "") {
    const discarded = [];
    for (const claim of this.candidate) {
      this.rejected.set(claim.normalizedText, { ...claim, status: "REJECTED", discardReason: String(reason) });
      discarded.push(claim.id);
    }
    this.candidate = [];
    return discarded;
  }

  /** The accepted claim carrying this assertion, if the session has one. */
  findAccepted(text) {
    return this.accepted.get(normalizeClaimText(text)) ?? null;
  }

  /** The rejected record for this assertion, if it was refused before. */
  findRejected(text) {
    return this.rejected.get(normalizeClaimText(text)) ?? null;
  }

  /**
   * R05-PATCH-01: every prior claim, in matching priority order, as defensive
   * copies. Rejected claims lead (they must be caught if restated), then
   * unresolved, then accepted. This feeds cross-turn semantic claim matching so
   * a paraphrase of a rejected claim cannot silently escape its rejection.
   */
  priorClaimsForMatching() {
    const defensively = (map) =>
      [...map.values()].map((claim) => persistable(claim));
    return [
      ...defensively(this.rejected),
      ...defensively(this.unresolved),
      ...defensively(this.accepted)
    ];
  }

  acceptedClaims() {
    return [...this.accepted.values()].map((claim) => persistable(claim));
  }

  /**
   * Whether an assertion may be published again.
   *
   * A previously rejected claim needs evidence the rejection did not have.
   * Restating it with the same evidence is the same claim, and the answer to
   * it has not changed.
   *
   * @param {string} text
   * @param {string[]} [evidenceIds] - evidence backing the new attempt.
   */
  canPromote(text, evidenceIds = []) {
    const previous = this.findRejected(text);
    if (!previous) return { allowed: true, reason: null, previous: null };
    const known = new Set(previous.evidenceIds ?? []);
    const fresh = [...new Set(evidenceIds)].filter((id) => id && !known.has(id));
    return fresh.length > 0
      ? { allowed: true, reason: "new evidence", previous, newEvidenceIds: fresh }
      : {
          allowed: false,
          reason: "this claim was rejected in this session and no new evidence has been produced",
          previous
        };
  }

  get size() {
    return this.accepted.size;
  }

  /** Plain, serialisable, and separate from the transcript by construction. */
  toJSON() {
    return {
      version: SESSION_LEDGER_VERSION,
      turn: this.turn,
      accepted: [...this.accepted.values()],
      rejected: [...this.rejected.values()],
      unresolved: [...this.unresolved.values()],
      // R05-PATCH-09: the per-claim event history, in a serialisable shape.
      events: [...this.events.entries()].map(([claimId, items]) => ({
        claimId,
        items: [...items]
      }))
    };
  }

  static fromJSON(data) {
    const ledger = new EpistemicSessionLedger();
    if (!data || !READABLE_LEDGER_VERSIONS.has(data.version)) return ledger;
    ledger.turn = Number.isInteger(data.turn) ? data.turn : 0;
    for (const claim of data.accepted ?? []) {
      if (claim?.normalizedText) ledger.accepted.set(claim.normalizedText, claim);
    }
    for (const claim of data.rejected ?? []) {
      if (claim?.normalizedText) ledger.rejected.set(claim.normalizedText, claim);
    }
    for (const claim of data.unresolved ?? []) {
      if (claim?.normalizedText) ledger.unresolved.set(claim.normalizedText, claim);
    }
    // R05-PATCH-10/11: v3 carries the event history; v1/v2 migrate to a
    // readable ledger with an empty event map (defensive - no event id reuse).
    if (data.version === SESSION_LEDGER_VERSION) {
      for (const entry of data.events ?? []) {
        const items = Array.isArray(entry?.items) ? entry.items : [];
        if (!entry?.claimId || items.length === 0) continue;
        ledger.events.set(
          entry.claimId,
          items.map((event) => ({ ...event })).slice(-MAX_EVENTS_PER_CLAIM)
        );
      }
    }
    return ledger;
  }
}
