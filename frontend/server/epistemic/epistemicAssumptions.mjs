import { randomUUID } from "node:crypto";

export const ASSUMPTION_STATUS = Object.freeze({
  UNVERIFIED: "UNVERIFIED",
  VERIFICATION_PENDING: "VERIFICATION_PENDING",
  VERIFIED: "VERIFIED",
  REJECTED: "REJECTED",
  UNKNOWN: "UNKNOWN"
});

const VALID_STATUSES = new Set(Object.values(ASSUMPTION_STATUS));

function requiredString(value, name) {
  if (typeof value !== "string" || !value.trim()) {
    throw new TypeError(`${name} must be a non-empty string`);
  }
  return value.trim();
}

function uniqueStrings(values, name) {
  if (!Array.isArray(values)) throw new TypeError(`${name} must be an array`);
  return Object.freeze([
    ...new Set(values.map((value) => requiredString(value, `${name} item`)))
  ]);
}

export function createAssumption({
  id = null,
  claimId,
  text,
  normalizedStatement = null,
  status = ASSUMPTION_STATUS.UNVERIFIED,
  mandatory = true,
  evidenceIds = [],
  verifierResultIds = [],
  createdAt = null
} = {}) {
  const normalizedStatus = requiredString(status, "status");
  if (!VALID_STATUSES.has(normalizedStatus)) {
    throw new TypeError(`unknown assumption status: ${normalizedStatus}`);
  }
  const normalizedEvidenceIds = uniqueStrings(evidenceIds, "evidenceIds");
  const normalizedVerifierIds = uniqueStrings(verifierResultIds, "verifierResultIds");
  if (
    normalizedStatus === ASSUMPTION_STATUS.VERIFIED &&
    (normalizedEvidenceIds.length === 0 || normalizedVerifierIds.length === 0)
  ) {
    throw new TypeError("a VERIFIED assumption requires evidence and a verifier result");
  }
  const assumptionText = requiredString(text, "text");
  return Object.freeze({
    id: id ? requiredString(id, "id") : `assumption_${randomUUID()}`,
    claimId: requiredString(claimId, "claimId"),
    text: assumptionText,
    normalizedStatement: normalizedStatement
      ? requiredString(normalizedStatement, "normalizedStatement")
      : assumptionText.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim(),
    status: normalizedStatus,
    mandatory: mandatory !== false,
    evidenceIds: normalizedEvidenceIds,
    verifierResultIds: normalizedVerifierIds,
    createdAt: createdAt ? requiredString(createdAt, "createdAt") : new Date().toISOString()
  });
}

function assumptionId(value) {
  return typeof value === "string" ? value : value?.id;
}

export function assessClaimAssumptions({ claim, assumptions = [] } = {}) {
  const requiredIds = [...new Set((claim?.assumptions ?? []).map(assumptionId).filter(Boolean))];
  const byId = new Map(
    (Array.isArray(assumptions) ? assumptions : []).map((assumption) => [assumption.id, assumption])
  );
  const required = requiredIds.map((id) => byId.get(id) ?? { id, status: ASSUMPTION_STATUS.UNKNOWN });
  const rejected = required.filter((item) => item.status === ASSUMPTION_STATUS.REJECTED);
  const unresolved = required.filter(
    (item) => item.status !== ASSUMPTION_STATUS.VERIFIED && item.status !== ASSUMPTION_STATUS.REJECTED
  );
  const verified = required.filter((item) => item.status === ASSUMPTION_STATUS.VERIFIED);
  const eligibleForFullVerification = rejected.length === 0 && unresolved.length === 0;

  return Object.freeze({
    eligibleForFullVerification,
    downstreamInvalidated: rejected.length > 0,
    maxAssertionLevel: rejected.length > 0
      ? "WITHHOLD"
      : unresolved.length > 0
        ? "CONDITIONAL"
        : "ASSERT",
    verifiedIds: Object.freeze(verified.map((item) => item.id)),
    unresolvedIds: Object.freeze(unresolved.map((item) => item.id)),
    rejectedIds: Object.freeze(rejected.map((item) => item.id)),
    failureCodes: Object.freeze(eligibleForFullVerification ? [] : ["F31"]),
    reason: rejected.length > 0
      ? "a mandatory assumption was rejected"
      : unresolved.length > 0
        ? "one or more mandatory assumptions remain unresolved"
        : "all declared mandatory assumptions are verified"
  });
}
