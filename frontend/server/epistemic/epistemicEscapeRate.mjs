/**
 * DS4 Quantum Fix — offline/e2e Epistemic Escape Rate (§65).
 *
 * The input is normally a sequence of `ds4_epistemic_telemetry_v1` audit
 * events, but plain claim outcomes are accepted so archived regression results
 * can be measured without reconstructing a server process.
 */

import { FAILURE_SEVERITY, SEVERITY } from "./epistemicContracts.mjs";

export const EPISTEMIC_ESCAPE_MIN_SEVERITY = SEVERITY.HIGH;

const NOT_RENDERED_STATES = new Set(["REJECTED", "CONTRADICTED"]);

function failureCodes(claim) {
  return Array.isArray(claim?.failureCodes)
    ? [...new Set(claim.failureCodes.map(String).filter(Boolean))]
    : [];
}

function claimSeverity(claim, codes) {
  let severity = Number.isInteger(claim?.severity) ? claim.severity : SEVERITY.NONE;
  for (const code of codes) severity = Math.max(severity, FAILURE_SEVERITY[code] ?? SEVERITY.NONE);
  return severity;
}

function publishedFor(record, claim) {
  if (typeof claim?.published === "boolean") return claim.published;
  if (typeof record?.published === "boolean") return record.published;
  if (record?.decision?.allowed !== true) return false;
  return !NOT_RENDERED_STATES.has(String(claim?.status ?? "").toUpperCase());
}

function observations(records) {
  const out = [];
  for (const [recordIndex, record] of records.entries()) {
    const claims = Array.isArray(record?.claims)
      ? record.claims
      : (record?.claim ? [record.claim] : [record]);
    for (const [claimIndex, claim] of claims.entries()) {
      if (!claim || typeof claim !== "object") continue;
      const codes = failureCodes(claim);
      out.push({
        id: String(claim.id || record?.id || `anonymous_${recordIndex}_${claimIndex}`),
        invalid: claim.invalid === true || record?.invalid === true || codes.length > 0,
        severity: claimSeverity(claim, codes),
        published: publishedFor(record, claim)
      });
    }
  }
  return out;
}

/**
 * Calculate invalid S4/S5 claim escapes, deduplicated by claim ID.
 *
 * Repeated audit observations merge monotonically: once a claim is found
 * invalid or observed published, that fact remains true. This prevents repair
 * retries from inflating the denominator while still detecting a claim that
 * was published before a later verifier exposed it as invalid.
 */
export function calculateEpistemicEscapeRate(records = [], {
  minimumSeverity = EPISTEMIC_ESCAPE_MIN_SEVERITY
} = {}) {
  if (!Array.isArray(records)) throw new TypeError("epistemic escape-rate records must be an array");
  if (!Number.isInteger(minimumSeverity) || minimumSeverity < SEVERITY.NONE || minimumSeverity > SEVERITY.CRITICAL) {
    throw new RangeError("minimumSeverity must be an integer from 0 through 5");
  }

  const claims = new Map();
  for (const observation of observations(records)) {
    const current = claims.get(observation.id) ?? {
      id: observation.id,
      invalid: false,
      severity: SEVERITY.NONE,
      published: false
    };
    current.invalid ||= observation.invalid;
    current.severity = Math.max(current.severity, observation.severity);
    current.published ||= observation.published;
    claims.set(observation.id, current);
  }

  const generated = [...claims.values()].filter(
    (claim) => claim.invalid && claim.severity >= minimumSeverity
  );
  const published = generated.filter((claim) => claim.published);
  const denominator = generated.length;
  const numerator = published.length;

  return Object.freeze({
    schema: "ds4_epistemic_escape_rate_v1",
    minimumSeverity,
    invalidHighSeverityClaimsGenerated: denominator,
    invalidHighSeverityClaimsPublished: numerator,
    escapeRate: denominator === 0 ? null : numerator / denominator,
    hasCoverage: denominator > 0,
    target: 0,
    targetMet: denominator > 0 && numerator === 0,
    generatedClaimIds: Object.freeze(generated.map((claim) => claim.id).sort()),
    publishedClaimIds: Object.freeze(published.map((claim) => claim.id).sort())
  });
}
