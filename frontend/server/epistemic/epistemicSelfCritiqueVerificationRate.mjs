/**
 * DS4 Quantum Fix — offline Self-Critique Verification Rate (§66).
 *
 * Input records are status-change audit facts. They carry identifiers and
 * verifier metadata only; assistant prose and evidence bodies are unnecessary
 * for this metric and must remain outside it.
 */

import { VERIFIER_FOR } from "./epistemicSelfCritique.mjs";

const CONCLUSIVE_VERIFIER_STATUSES = new Set(["PASSED", "FAILED"]);
const SELF_VERIFIERS = new Set([
  "assistant",
  "model",
  "self",
  "self_critique",
  "epistemicselfcritique"
]);

function requestsFor(change) {
  const requests = Array.isArray(change?.requests)
    ? change.requests
    : (change?.request ? [change.request] : []);
  if (requests.length > 0) return requests.filter(Boolean);
  if (!change?.requirement) return [];
  return [{
    requirement: change.requirement,
    verifier: change.expectedVerifier ?? VERIFIER_FOR[change.requirement] ?? null
  }];
}

function resultsFor(change) {
  if (Array.isArray(change?.verifierResults)) return change.verifierResults.filter(Boolean);
  return change?.verifierResult ? [change.verifierResult] : [];
}

function resultBacksRequest(result, request) {
  const requirement = String(request?.requirement ?? "");
  const expectedVerifier = String(request?.verifier ?? VERIFIER_FOR[requirement] ?? "");
  const verifier = String(result?.verifier ?? "");
  const status = String(result?.status ?? "").toUpperCase();
  if (!requirement || !expectedVerifier || !verifier) return false;
  if (result?.independent === false) return false;
  if (SELF_VERIFIERS.has(verifier.toLowerCase())) return false;
  return (
    verifier === expectedVerifier &&
    String(result?.requirement ?? "") === requirement &&
    CONCLUSIVE_VERIFIER_STATUSES.has(status)
  );
}

function isBacked(change) {
  const requests = requestsFor(change);
  const results = resultsFor(change);
  return requests.length > 0 && requests.every(
    (request) => results.some((result) => resultBacksRequest(result, request))
  );
}

/**
 * Calculate SCVR for status changes produced during self-critique.
 *
 * Duplicate records are ignored only when they carry the same explicit ID.
 * A corpus without any actual status change has no measurable rate and cannot
 * satisfy the regression target vacuously.
 */
export function calculateSelfCritiqueVerificationRate(changes = []) {
  if (!Array.isArray(changes)) throw new TypeError("self-critique status changes must be an array");

  const seenIds = new Set();
  const measured = [];
  for (const [index, change] of changes.entries()) {
    if (!change || typeof change !== "object") continue;
    const from = String(change.from ?? "");
    const to = String(change.to ?? "");
    if (!from || !to || from === to || change.selfCritique === false) continue;
    const explicitId = change.id ? String(change.id) : null;
    if (explicitId && seenIds.has(explicitId)) continue;
    if (explicitId) seenIds.add(explicitId);
    measured.push({
      id: explicitId ?? `self_critique_change_${index + 1}`,
      backed: isBacked(change)
    });
  }

  const backed = measured.filter((change) => change.backed);
  const denominator = measured.length;
  const numerator = backed.length;
  return Object.freeze({
    schema: "ds4_self_critique_verification_rate_v1",
    statusChangesTotal: denominator,
    statusChangesBackedByIndependentVerifier: numerator,
    scvr: denominator === 0 ? null : numerator / denominator,
    hasCoverage: denominator > 0,
    target: 1,
    targetMet: denominator > 0 && numerator === denominator,
    backedChangeIds: Object.freeze(backed.map((change) => change.id).sort()),
    unbackedChangeIds: Object.freeze(
      measured.filter((change) => !change.backed).map((change) => change.id).sort()
    )
  });
}
