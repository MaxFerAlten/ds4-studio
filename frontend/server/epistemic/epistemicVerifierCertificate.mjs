import { randomUUID } from "node:crypto";

export const VERIFIER_CERTIFICATE_VERDICT = Object.freeze({
  PASSED: "PASSED",
  FAILED: "FAILED",
  UNKNOWN: "UNKNOWN"
});

const VALID_VERDICTS = new Set(Object.values(VERIFIER_CERTIFICATE_VERDICT));

function requiredString(value, name) {
  if (typeof value !== "string" || !value.trim()) {
    throw new TypeError(`${name} must be a non-empty string`);
  }
  return value.trim();
}

function optionalString(value, name) {
  if (value === null || value === undefined || value === "") return null;
  return requiredString(value, name);
}

function uniqueStrings(values, name) {
  if (!Array.isArray(values)) throw new TypeError(`${name} must be an array`);
  return [...new Set(values.map((value) => requiredString(value, `${name} item`)))];
}

function immutableCopy(value) {
  if (Array.isArray(value)) return Object.freeze(value.map(immutableCopy));
  if (value && typeof value === "object") {
    return Object.freeze(
      Object.fromEntries(Object.entries(value).map(([key, item]) => [key, immutableCopy(item)]))
    );
  }
  return value;
}

/**
 * Build the claim-bound description of what a verifier actually checked.
 *
 * A successful tool call without `checkedStatement` is deliberately rejected:
 * there is no proposition whose authority a scope gate could evaluate.
 */
export function createVerifierCertificate({
  id = null,
  verifier,
  claimId,
  requirement,
  checkedStatement,
  formalizationKind = "UNKNOWN",
  domain = "GENERAL",
  assumptionsUsed = [],
  propertiesEstablished = [],
  propertiesNotEstablished = [],
  evidenceIds = [],
  verdict,
  rawResultRef = null,
  toolCallId = null,
  toolResultId = null,
  artifactHash = null,
  issuedAt = null,
  metadata = {}
} = {}) {
  const normalizedVerdict = requiredString(verdict, "verdict");
  if (!VALID_VERDICTS.has(normalizedVerdict)) {
    throw new TypeError(`unknown verifier certificate verdict: ${normalizedVerdict}`);
  }
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    throw new TypeError("metadata must be an object");
  }

  return immutableCopy({
    id: id ? requiredString(id, "id") : `certificate_${randomUUID()}`,
    verifier: requiredString(verifier, "verifier"),
    claimId: requiredString(claimId, "claimId"),
    requirement: requiredString(requirement, "requirement"),
    checkedStatement: requiredString(checkedStatement, "checkedStatement"),
    formalizationKind: requiredString(formalizationKind, "formalizationKind"),
    domain: requiredString(domain, "domain"),
    assumptionsUsed: uniqueStrings(assumptionsUsed, "assumptionsUsed"),
    propertiesEstablished: uniqueStrings(propertiesEstablished, "propertiesEstablished"),
    propertiesNotEstablished: uniqueStrings(
      propertiesNotEstablished,
      "propertiesNotEstablished"
    ),
    evidenceIds: uniqueStrings(evidenceIds, "evidenceIds"),
    verdict: normalizedVerdict,
    rawResultRef: immutableCopy(rawResultRef),
    toolCallId: optionalString(toolCallId, "toolCallId"),
    toolResultId: optionalString(toolResultId, "toolResultId"),
    artifactHash: optionalString(artifactHash, "artifactHash"),
    issuedAt: issuedAt ? requiredString(issuedAt, "issuedAt") : new Date().toISOString(),
    metadata: immutableCopy(metadata)
  });
}
