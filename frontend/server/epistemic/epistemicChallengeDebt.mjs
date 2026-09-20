import { CLAIM_EVENT_KIND } from "./epistemicClaimHistory.mjs";

export const CHALLENGE_ORIGIN = Object.freeze({
  USER: "USER",
  MODEL_SELF: "MODEL_SELF",
  VERIFIER: "VERIFIER",
  DOMAIN_INVARIANT: "DOMAIN_INVARIANT",
  SOURCE: "SOURCE",
  CONSISTENCY_CHECKER: "CONSISTENCY_CHECKER"
});

export const CHALLENGE_STATUS = Object.freeze({
  OPEN: "OPEN",
  RESOLVED_SUPPORTED: "RESOLVED_SUPPORTED",
  RESOLVED_REJECTED: "RESOLVED_REJECTED",
  RESOLVED_NARROWED: "RESOLVED_NARROWED",
  SUPERSEDED: "SUPERSEDED"
});

const VALID_ORIGINS = new Set(Object.values(CHALLENGE_ORIGIN));
const RESOLVED_STATUSES = new Set(
  Object.values(CHALLENGE_STATUS).filter((status) => status !== CHALLENGE_STATUS.OPEN)
);

function requiredString(value, name) {
  if (typeof value !== "string" || !value.trim()) {
    throw new TypeError(`${name} must be a non-empty string`);
  }
  return value.trim();
}

function normalizedSeverity(value) {
  const severity = Number(value);
  if (!Number.isInteger(severity) || severity < 0 || severity > 5) {
    throw new TypeError("challenge severity must be an integer from 0 to 5");
  }
  return severity;
}

function challengeFromEvent(event) {
  const id = requiredString(event.challengeId, "challengeId");
  const origin = requiredString(event.origin, "challenge origin");
  if (!VALID_ORIGINS.has(origin)) throw new TypeError(`unknown challenge origin: ${origin}`);
  return {
    id,
    claimId: event.claimId,
    origin,
    text: requiredString(event.text ?? event.reason, "challenge text"),
    status: CHALLENGE_STATUS.OPEN,
    severity: normalizedSeverity(event.severity),
    material: event.material !== false,
    evidenceIds: [...new Set((event.evidenceIds ?? []).map(String).filter(Boolean))],
    verifierResultIds: [...new Set((event.verifierResultIds ?? []).map(String).filter(Boolean))],
    createdAt: event.at,
    createdEventId: event.eventId,
    resolvedAt: null,
    resolutionEventId: null
  };
}

export function challengeDebt({ claimId, history }) {
  const normalizedClaimId = requiredString(claimId, "claimId");
  if (!history || typeof history.events !== "function") {
    throw new TypeError("history must expose events(claimId)");
  }

  const byId = new Map();
  for (const event of history.events(normalizedClaimId)) {
    if (event.kind === CLAIM_EVENT_KIND.CHALLENGED) {
      const item = challengeFromEvent(event);
      if (byId.has(item.id)) throw new TypeError(`duplicate challenge id: ${item.id}`);
      byId.set(item.id, item);
      continue;
    }
    if (event.kind !== CLAIM_EVENT_KIND.CHALLENGE_RESOLVED) continue;

    const challengeId = requiredString(event.challengeId, "challengeId");
    const item = byId.get(challengeId);
    if (!item) throw new TypeError(`resolution targets unknown challenge: ${challengeId}`);
    const status = requiredString(event.status, "challenge resolution status");
    if (!RESOLVED_STATUSES.has(status)) {
      throw new TypeError(`invalid challenge resolution status: ${status}`);
    }
    if (item.status !== CHALLENGE_STATUS.OPEN) {
      throw new TypeError(`challenge already resolved: ${challengeId}`);
    }
    item.status = status;
    item.resolvedAt = event.at;
    item.resolutionEventId = event.eventId;
    item.evidenceIds = [
      ...new Set([...item.evidenceIds, ...(event.evidenceIds ?? []).map(String).filter(Boolean)])
    ];
    item.verifierResultIds = [
      ...new Set([
        ...item.verifierResultIds,
        ...(event.verifierResultIds ?? []).map(String).filter(Boolean)
      ])
    ];
  }

  return Object.freeze(
    [...byId.values()].map((item) =>
      Object.freeze({
        ...item,
        evidenceIds: Object.freeze([...item.evidenceIds]),
        verifierResultIds: Object.freeze([...item.verifierResultIds])
      })
    )
  );
}

export function openChallengeDebt({ claimId, history }) {
  const items = challengeDebt({ claimId, history }).filter(
    (item) => item.status === CHALLENGE_STATUS.OPEN
  );
  return Object.freeze({
    total: items.length,
    material: items.filter((item) => item.material).length,
    items: Object.freeze(items)
  });
}
