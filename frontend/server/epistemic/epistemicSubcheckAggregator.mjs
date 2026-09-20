export const SUBCHECK_STATUS = Object.freeze({
  PASSED: "PASSED",
  FAILED: "FAILED",
  UNKNOWN: "UNKNOWN",
  ERROR: "ERROR",
  MISSING: "MISSING"
});

export const SUBCHECK_AGGREGATE_STATUS = Object.freeze({
  PASSED: "PASSED",
  PARTIAL: "PARTIAL",
  FAILED: "FAILED",
  UNKNOWN: "UNKNOWN"
});

const VALID_STATUSES = new Set(Object.values(SUBCHECK_STATUS));

function normalizedCheck(check, index) {
  if (!check || typeof check !== "object") throw new TypeError(`checks[${index}] must be an object`);
  const id = String(check.id ?? "").trim();
  if (!id) throw new TypeError(`checks[${index}].id must be a non-empty string`);
  const status = check.status === undefined ? SUBCHECK_STATUS.MISSING : String(check.status);
  if (!VALID_STATUSES.has(status)) throw new TypeError(`unknown subcheck status: ${status}`);
  return Object.freeze({
    ...check,
    id,
    mandatory: check.mandatory !== false,
    status
  });
}

export function aggregateSubchecks(checks = []) {
  if (!Array.isArray(checks)) throw new TypeError("checks must be an array");
  const normalized = checks.map(normalizedCheck);
  if (new Set(normalized.map((check) => check.id)).size !== normalized.length) {
    throw new TypeError("subcheck IDs must be unique");
  }

  const mandatory = normalized.filter((check) => check.mandatory);
  const optional = normalized.filter((check) => !check.mandatory);
  const count = (status, values = normalized) => values.filter((check) => check.status === status).length;
  const mandatoryBlocking = mandatory.filter((check) =>
    [SUBCHECK_STATUS.FAILED, SUBCHECK_STATUS.ERROR].includes(check.status)
  );
  const mandatoryInconclusive = mandatory.filter((check) =>
    [SUBCHECK_STATUS.UNKNOWN, SUBCHECK_STATUS.MISSING].includes(check.status)
  );
  const mandatoryPassed = count(SUBCHECK_STATUS.PASSED, mandatory);
  const optionalProblem = optional.some((check) =>
    [SUBCHECK_STATUS.FAILED, SUBCHECK_STATUS.ERROR, SUBCHECK_STATUS.UNKNOWN].includes(check.status)
  );

  let status = SUBCHECK_AGGREGATE_STATUS.UNKNOWN;
  if (mandatoryBlocking.length > 0) status = SUBCHECK_AGGREGATE_STATUS.FAILED;
  else if (mandatoryInconclusive.length > 0 || mandatory.length === 0) {
    status = SUBCHECK_AGGREGATE_STATUS.UNKNOWN;
  } else if (mandatoryPassed === mandatory.length) {
    status = optionalProblem ? SUBCHECK_AGGREGATE_STATUS.PARTIAL : SUBCHECK_AGGREGATE_STATUS.PASSED;
  }

  const mandatoryFailedOrMissing = mandatoryBlocking.length + mandatoryInconclusive.length;
  return Object.freeze({
    status,
    requestedChecks: normalized.length,
    completedChecks: normalized.length - count(SUBCHECK_STATUS.MISSING),
    passedChecks: count(SUBCHECK_STATUS.PASSED),
    failedChecks: count(SUBCHECK_STATUS.FAILED),
    unknownChecks: count(SUBCHECK_STATUS.UNKNOWN),
    errorChecks: count(SUBCHECK_STATUS.ERROR),
    missingChecks: count(SUBCHECK_STATUS.MISSING),
    mandatoryRequested: mandatory.length,
    mandatoryPassed,
    mandatoryFailedOrMissing,
    coverage: mandatory.length > 0 ? mandatoryPassed / mandatory.length : 0,
    failureCodes: Object.freeze(mandatoryFailedOrMissing > 0 ? ["F29"] : []),
    checks: Object.freeze(normalized)
  });
}
