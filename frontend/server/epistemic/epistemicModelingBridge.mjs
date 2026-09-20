import { randomUUID } from "node:crypto";

export const MODELING_BRIDGE_STATUS = Object.freeze({
  UNVERIFIED: "UNVERIFIED",
  VERIFIED: "VERIFIED",
  REJECTED: "REJECTED"
});

const VALID_STATUSES = new Set(Object.values(MODELING_BRIDGE_STATUS));

function requiredString(value, name) {
  if (typeof value !== "string" || !value.trim()) {
    throw new TypeError(`${name} must be a non-empty string`);
  }
  return value.trim();
}

function uniqueStrings(values, name) {
  if (!Array.isArray(values)) throw new TypeError(`${name} must be an array`);
  return [...new Set(values.map((value) => requiredString(value, `${name} item`)))];
}

function frozen(value) {
  if (Array.isArray(value)) return Object.freeze(value.map(frozen));
  if (value && typeof value === "object") {
    return Object.freeze(
      Object.fromEntries(Object.entries(value).map(([key, item]) => [key, frozen(item)]))
    );
  }
  return value;
}

export function createModelingBridge({
  id = null,
  claimId,
  sourceDomain,
  targetDomain,
  formalObject,
  intendedObject,
  correspondence = [],
  assumptions = [],
  status = MODELING_BRIDGE_STATUS.UNVERIFIED,
  verifierResultIds = [],
  evidenceIds = [],
  failureCodes = [],
  createdAt = null
} = {}) {
  const normalizedStatus = requiredString(status, "status");
  if (!VALID_STATUSES.has(normalizedStatus)) {
    throw new TypeError(`unknown modeling bridge status: ${normalizedStatus}`);
  }
  const normalizedVerifierIds = uniqueStrings(verifierResultIds, "verifierResultIds");
  const normalizedEvidenceIds = uniqueStrings(evidenceIds, "evidenceIds");
  if (
    normalizedStatus === MODELING_BRIDGE_STATUS.VERIFIED &&
    (normalizedVerifierIds.length === 0 || normalizedEvidenceIds.length === 0)
  ) {
    throw new TypeError("a VERIFIED modeling bridge requires verifier results and evidence");
  }

  return frozen({
    id: id ? requiredString(id, "id") : `bridge_${randomUUID()}`,
    claimId: requiredString(claimId, "claimId"),
    sourceDomain: requiredString(sourceDomain, "sourceDomain"),
    targetDomain: requiredString(targetDomain, "targetDomain"),
    formalObject: requiredString(formalObject, "formalObject"),
    intendedObject: requiredString(intendedObject, "intendedObject"),
    correspondence: uniqueStrings(correspondence, "correspondence"),
    assumptions: uniqueStrings(assumptions, "assumptions"),
    status: normalizedStatus,
    verifierResultIds: normalizedVerifierIds,
    evidenceIds: normalizedEvidenceIds,
    failureCodes: uniqueStrings(failureCodes, "failureCodes"),
    createdAt: createdAt ? requiredString(createdAt, "createdAt") : new Date().toISOString()
  });
}

export function assessModelingBridge({ bridge, requiredCorrespondence = [] } = {}) {
  const required = uniqueStrings(requiredCorrespondence, "requiredCorrespondence");
  if (!bridge || typeof bridge !== "object") {
    return frozen({
      status: MODELING_BRIDGE_STATUS.UNVERIFIED,
      established: [],
      missing: required,
      failureCodes: ["F32"],
      reason: "no modeling bridge was supplied"
    });
  }

  const established = required.filter((item) => bridge.correspondence?.includes(item));
  const missing = required.filter((item) => !bridge.correspondence?.includes(item));
  const evidenceBacked =
    (bridge.verifierResultIds?.length ?? 0) > 0 && (bridge.evidenceIds?.length ?? 0) > 0;
  const verified =
    bridge.status === MODELING_BRIDGE_STATUS.VERIFIED && missing.length === 0 && evidenceBacked;
  const rejected = bridge.status === MODELING_BRIDGE_STATUS.REJECTED || missing.length > 0;

  return frozen({
    status: verified
      ? MODELING_BRIDGE_STATUS.VERIFIED
      : rejected
        ? MODELING_BRIDGE_STATUS.REJECTED
        : MODELING_BRIDGE_STATUS.UNVERIFIED,
    established,
    missing,
    failureCodes: verified ? [] : ["F32"],
    reason: verified
      ? "the formal-to-intended-object correspondence is evidence-backed"
      : missing.length > 0
        ? `missing modeling correspondence: ${missing.join(", ")}`
        : "the modeling bridge has no independent verifier evidence"
  });
}

/**
 * Q2-009 (§12, §38) — the objects a cross-domain claim is actually about.
 *
 * `C^V` with a token-indexed canonical basis is a real vector space and its
 * basis really is orthogonal. None of that is a fact about an LLM: the learned
 * embedding matrix is a different object, in a different dimension, with no
 * orthogonality. Naming both "the token space" is what let the transcript
 * publish a theorem about the first as a property of the second.
 */
export const BRIDGE_OBJECT = Object.freeze({
  ABSTRACT_TOKEN_INDEX_SPACE: "ABSTRACT_TOKEN_INDEX_SPACE",
  LEARNED_EMBEDDING_SPACE: "LEARNED_EMBEDDING_SPACE",
  HIDDEN_STATE_SPACE: "HIDDEN_STATE_SPACE",
  ATTENTION_MECHANISM: "ATTENTION_MECHANISM",
  TRANSFORMER_LAYER_MAP: "TRANSFORMER_LAYER_MAP",
  QUANTUM_MEASUREMENT: "QUANTUM_MEASUREMENT",
  UNITARY_EVOLUTION: "UNITARY_EVOLUTION"
});

/**
 * Wording that keeps a claim inside the auxiliary construction. A sentence that
 * says it is defining an abstract object is not asserting anything about a real
 * model, and §50 requires it to stay allowed.
 */
const AUXILIARY_FRAMING =
  /\b(?:spazio\s+astratto|astratt\w+|ausiliari\w+|auxiliary|abstract|formale\s+ausiliario|per\s+costruzione|by\s+construction|definiamo|definisco|we\s+(?:define|introduce|construct)|si\s+introduce|si\s+definisce|consideriamo)\b/iu;

/** §12 — a claim about the learned embedding space, dressed as C^V. */
const LEARNED_EMBEDDING_CLAIM =
  /\b(?:vocabolario|vocabulary|token\s+embeddings?|embeddings?)\b[^.]{0,160}\b(?:base\s+(?:ortogonal\w+|ortonormal\w+|complet\w+)|basi\s+ortogonal\w+|orthogonal\s+basis|orthonormal\s+basis|complete\s+basis|spanning\s+set)\b|\b(?:base\s+(?:ortogonal\w+|ortonormal\w+|complet\w+)|orthogonal\s+basis|orthonormal\s+basis|complete\s+basis)\b[^.]{0,160}\b(?:vocabolario|vocabulary|token\s+embeddings?|embeddings?|spazio\s+semantico|semantic\s+space|embedding\s+space)\b/iu;

/** §38 — attention presented as a quantum measurement of a real superposition. */
const ATTENTION_MEASUREMENT_CLAIM =
  /\b(?:attenzione|attention)\b[^.]{0,160}\b(?:misura(?:zione)?\s+quantistic\w+|quantum\s+measurement|collass\w+|collapse[sd]?|born\s+rule|regola\s+di\s+born|proiezione\s+di\s+misura)\b|\b(?:misura(?:zione)?\s+quantistic\w+|quantum\s+measurement|collass\w+|collapse[sd]?)\b[^.]{0,160}\b(?:attenzione|attention|sovrapposizione\s+(?:di\s+)?significat\w+|superposition\s+of\s+meanings)\b/iu;

/** §38 — a Transformer layer presented as unitary Hamiltonian evolution. */
const TRANSFORMER_UNITARY_CLAIM =
  /\b(?:transformer|attenzione|attention|strat\w+|layers?)\b[^.]{0,160}\b(?:operatore\s+unitari\w+|unitary\s+(?:operator|evolution|map)|evoluzione\s+unitaria|schr(?:ö|o)dinger|hamiltonian\s+dynamics|u\s*\(\s*t\s*\))\b|\b(?:operatore\s+unitari\w+|unitary\s+(?:operator|evolution)|evoluzione\s+unitaria)\b[^.]{0,160}\b(?:transformer|layers?|strat\w+)\b/iu;

/**
 * The correspondences each cross-domain claim class must establish before the
 * auxiliary model may be spoken of as the real thing.
 */
const BRIDGE_PROFILES = Object.freeze([
  Object.freeze({
    id: "TOKEN_SPACE_TO_LEARNED_EMBEDDING",
    pattern: LEARNED_EMBEDDING_CLAIM,
    formalObject: BRIDGE_OBJECT.ABSTRACT_TOKEN_INDEX_SPACE,
    intendedObject: BRIDGE_OBJECT.LEARNED_EMBEDDING_SPACE,
    sourceDomain: "MATHEMATICS",
    targetDomain: "TRANSFORMER",
    requiredCorrespondence: Object.freeze([
      "TOKEN_ID_TO_LEARNED_VECTOR_MAP",
      "DIMENSION_MATCH",
      "LINEAR_INDEPENDENCE",
      "ORTHOGONALITY",
      "SPANNING",
      "REPRESENTATION_IDENTITY"
    ])
  }),
  Object.freeze({
    id: "QUANTUM_MEASUREMENT_TO_ATTENTION",
    pattern: ATTENTION_MEASUREMENT_CLAIM,
    formalObject: BRIDGE_OBJECT.QUANTUM_MEASUREMENT,
    intendedObject: BRIDGE_OBJECT.ATTENTION_MECHANISM,
    sourceDomain: "PHYSICS",
    targetDomain: "TRANSFORMER",
    requiredCorrespondence: Object.freeze([
      "STATE_SPACE_CORRESPONDENCE",
      "PROBABILITY_RULE",
      "OBSERVABLE_OR_MEASUREMENT_MAP",
      "NORMALIZATION",
      "POST_MEASUREMENT_STATE_RULE",
      "EMPIRICAL_OR_FORMAL_JUSTIFICATION"
    ])
  }),
  Object.freeze({
    id: "UNITARY_EVOLUTION_TO_TRANSFORMER",
    pattern: TRANSFORMER_UNITARY_CLAIM,
    formalObject: BRIDGE_OBJECT.UNITARY_EVOLUTION,
    intendedObject: BRIDGE_OBJECT.TRANSFORMER_LAYER_MAP,
    sourceDomain: "PHYSICS",
    targetDomain: "TRANSFORMER",
    requiredCorrespondence: Object.freeze([
      "INNER_PRODUCT_DOMAIN_MATCH",
      "LINEARITY",
      "ADJOINT_IDENTITY",
      "NORM_PRESERVATION",
      "INVERTIBILITY"
    ])
  })
]);

/**
 * Which modeling bridge a claim needs, if any.
 *
 * @param {string} claimText
 * @returns {object|null} the profile, or null when the claim stays inside its
 *   auxiliary construction (§50) or is not cross-domain at all.
 */
export function requiredBridgeForClaim(claimText) {
  const text = String(claimText ?? "");
  if (!text.trim()) return null;
  // §50: a sentence that says it is defining an abstract object asserts nothing
  // about a real model, so it owes no bridge.
  if (AUXILIARY_FRAMING.test(text)) return null;
  for (const profile of BRIDGE_PROFILES) {
    if (profile.pattern.test(text)) return profile;
  }
  return null;
}
