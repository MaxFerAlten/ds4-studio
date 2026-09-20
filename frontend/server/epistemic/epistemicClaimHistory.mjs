import { randomUUID } from "node:crypto";

export const CLAIM_EVENT_KIND = Object.freeze({
  CREATED: "CREATED",
  CLASSIFIED: "CLASSIFIED",
  EVIDENCE_BOUND: "EVIDENCE_BOUND",
  VERIFIER_RESULT: "VERIFIER_RESULT",
  CHALLENGED: "CHALLENGED",
  CHALLENGE_RESOLVED: "CHALLENGE_RESOLVED",
  PROMOTION_ATTEMPT: "PROMOTION_ATTEMPT",
  PROMOTED: "PROMOTED",
  DOWNGRADED: "DOWNGRADED",
  CONTRADICTED: "CONTRADICTED",
  INVALIDATED: "INVALIDATED",
  REPAIRED: "REPAIRED"
});

const VALID_EVENT_KINDS = new Set(Object.values(CLAIM_EVENT_KIND));

function nonEmptyString(value, name) {
  if (typeof value !== "string" || !value.trim()) {
    throw new TypeError(`${name} must be a non-empty string`);
  }
  return value.trim();
}

function frozenCopy(value) {
  if (Array.isArray(value)) {
    return Object.freeze(value.map(frozenCopy));
  }
  if (value && typeof value === "object") {
    return Object.freeze(
      Object.fromEntries(Object.entries(value).map(([key, item]) => [key, frozenCopy(item)]))
    );
  }
  return value;
}

export function validateClaimEvent(event) {
  if (!event || typeof event !== "object" || Array.isArray(event)) {
    throw new TypeError("claim event must be an object");
  }
  nonEmptyString(event.claimId, "claimId");
  const kind = nonEmptyString(event.kind, "kind");
  if (!VALID_EVENT_KINDS.has(kind)) {
    throw new TypeError(`unknown claim event kind: ${kind}`);
  }
  if (event.eventId !== undefined) nonEmptyString(event.eventId, "eventId");
  if (event.at !== undefined) nonEmptyString(event.at, "at");
  return true;
}

export class ClaimHistory {
  #eventsByClaim = new Map();
  #eventIds = new Set();

  append(event) {
    validateClaimEvent(event);
    const eventId = event.eventId?.trim() || randomUUID();
    if (this.#eventIds.has(eventId)) {
      throw new TypeError(`duplicate claim event id: ${eventId}`);
    }

    const frozen = frozenCopy({
      ...event,
      claimId: event.claimId.trim(),
      kind: event.kind.trim(),
      eventId,
      at: event.at?.trim() || new Date().toISOString()
    });
    const existing = this.#eventsByClaim.get(frozen.claimId) ?? [];
    existing.push(frozen);
    this.#eventsByClaim.set(frozen.claimId, existing);
    this.#eventIds.add(eventId);
    return frozen;
  }

  events(claimId) {
    const normalized = nonEmptyString(claimId, "claimId");
    return [...(this.#eventsByClaim.get(normalized) ?? [])];
  }

  allEvents() {
    return [...this.#eventsByClaim.values()].flat();
  }
}
