import { randomUUID } from "node:crypto";

export const VERIFICATION_PLAN_STATUS = Object.freeze({
  PASSED: "PASSED",
  FAILED: "FAILED",
  UNKNOWN: "UNKNOWN"
});

const RESULT_STATUSES = new Set(["PASSED", "FAILED", "UNKNOWN", "ERROR"]);

function requiredString(value, name) {
  if (typeof value !== "string" || !value.trim()) {
    throw new TypeError(`${name} must be a non-empty string`);
  }
  return value.trim();
}

function strings(values, name) {
  if (!Array.isArray(values)) throw new TypeError(`${name} must be an array`);
  return Object.freeze([...new Set(values.map((value) => requiredString(value, `${name} item`)))]);
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

function normalizeCheck(check, index) {
  if (!check || typeof check !== "object") throw new TypeError(`checks[${index}] must be an object`);
  return frozen({
    id: requiredString(check.id, `checks[${index}].id`),
    requirement: requiredString(check.requirement, `checks[${index}].requirement`),
    mandatory: check.mandatory !== false,
    method: requiredString(check.method, `checks[${index}].method`),
    expectedCertificateScope:
      check.expectedCertificateScope && typeof check.expectedCertificateScope === "object"
        ? check.expectedCertificateScope
        : null,
    successCriterion: requiredString(
      check.successCriterion,
      `checks[${index}].successCriterion`
    ),
    failureCriterion: requiredString(
      check.failureCriterion,
      `checks[${index}].failureCriterion`
    )
  });
}

export function createVerificationPlan({
  id = null,
  claimId,
  assumptions = [],
  checks = [],
  createdAt = null
} = {}) {
  if (!Array.isArray(checks)) throw new TypeError("checks must be an array");
  const normalizedChecks = checks.map(normalizeCheck);
  if (new Set(normalizedChecks.map((check) => check.id)).size !== normalizedChecks.length) {
    throw new TypeError("verification plan check IDs must be unique");
  }
  return frozen({
    id: id ? requiredString(id, "id") : `verification_plan_${randomUUID()}`,
    claimId: requiredString(claimId, "claimId"),
    assumptions: strings(assumptions, "assumptions"),
    checks: normalizedChecks,
    createdAt: createdAt ? requiredString(createdAt, "createdAt") : new Date().toISOString()
  });
}

function normalizedResult(result, index) {
  const status = requiredString(result?.status, `results[${index}].status`);
  if (!RESULT_STATUSES.has(status)) throw new TypeError(`unknown verification result status: ${status}`);
  return {
    checkId: requiredString(result?.checkId, `results[${index}].checkId`),
    status
  };
}

export function reconcileVerificationPlan(plan, results = []) {
  if (!plan || !Array.isArray(plan.checks)) throw new TypeError("a verification plan is required");
  if (!Array.isArray(results)) throw new TypeError("results must be an array");
  const normalizedResults = results.map(normalizedResult);
  const byCheckId = new Map(normalizedResults.map((result) => [result.checkId, result]));
  const mandatoryChecks = plan.checks.filter((check) => check.mandatory);
  const optionalChecks = plan.checks.filter((check) => !check.mandatory);
  const missingMandatory = mandatoryChecks.filter((check) => !byCheckId.has(check.id));
  const mandatoryResults = mandatoryChecks
    .map((check) => byCheckId.get(check.id))
    .filter(Boolean);
  const failedMandatory = mandatoryResults.filter((result) =>
    ["FAILED", "ERROR"].includes(result.status)
  );
  const unknownMandatory = mandatoryResults.filter((result) => result.status === "UNKNOWN");
  const passedMandatory = mandatoryResults.filter((result) => result.status === "PASSED");

  let status = VERIFICATION_PLAN_STATUS.UNKNOWN;
  if (failedMandatory.length > 0) status = VERIFICATION_PLAN_STATUS.FAILED;
  else if (
    mandatoryChecks.length > 0 &&
    missingMandatory.length === 0 &&
    unknownMandatory.length === 0 &&
    passedMandatory.length === mandatoryChecks.length
  ) {
    status = VERIFICATION_PLAN_STATUS.PASSED;
  }

  return frozen({
    status,
    requestedChecks: plan.checks.length,
    mandatoryRequested: mandatoryChecks.length,
    optionalRequested: optionalChecks.length,
    mandatoryPassed: passedMandatory.length,
    mandatoryFailedOrMissing:
      failedMandatory.length + unknownMandatory.length + missingMandatory.length,
    missingMandatoryCheckIds: missingMandatory.map((check) => check.id),
    failedMandatoryCheckIds: failedMandatory.map((result) => result.checkId),
    unknownMandatoryCheckIds: unknownMandatory.map((result) => result.checkId),
    coverage:
      mandatoryChecks.length > 0 ? passedMandatory.length / mandatoryChecks.length : 0,
    failureCodes:
      failedMandatory.length + unknownMandatory.length + missingMandatory.length > 0
        ? ["F29"]
        : []
  });
}
