/**
 * DS4 Evolution — independently designed clean-room implementation.
 * Behavioral inputs: docs/evolution/behavioral-specification.md.
 * External source code or prompts copied: none.
 * Existing DS4 mechanisms reused: none; this module is a versioned boundary contract.
 */

import path from "node:path";

export const EVOLUTION_TASK_VERSION = "ds4_evolution_task_v1";
export const EVOLUTION_PROPOSAL_VERSION = "ds4_evolution_proposal_v1";
export const EVOLUTION_PROVENANCE_VERSION = "ds4_clean_room_provenance_v1";
export const DEFAULT_MAX_CONTRACT_BYTES = 256_000;
export const DEFAULT_MAX_PROPOSAL_BYTES = 128_000;

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const METRIC_DIRECTIONS = new Set(["maximize", "minimize", "exact", "boolean"]);
const APPROVAL_MODES = new Set(["manual", "auto_for_low_risk", "always_auto"]);
const RISK_LEVELS = new Set(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);
const TASK_KEYS = new Set([
  "contractVersion", "taskId", "title", "objective", "workspaceRoot", "mutablePaths",
  "immutablePaths", "baselineRef", "evaluators", "metrics", "budgets", "approvalPolicy"
]);
const BUDGET_KEYS = [
  "maxRevisions", "maxFilesChanged", "maxAddedLines", "maxDeletedLines",
  "maxWallTimeMsPerRevision", "maxPromptTokensPerRevision", "maxCompletionTokensPerRevision"
];

export class EvolutionContractError extends Error {
  constructor(code, message, issues = []) {
    super(message);
    this.name = "EvolutionContractError";
    this.code = code;
    this.issues = issues.length ? issues : [{ code, path: "", message }];
  }
}

function plainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype;
}

function issue(issues, code, field, message) {
  issues.push({ code, path: field, message });
}

function knownKeys(value, allowed, field, issues) {
  if (!plainObject(value)) {
    issue(issues, "INVALID_TYPE", field, `${field || "value"} must be an object`);
    return false;
  }
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) issue(issues, "UNKNOWN_FIELD", field ? `${field}.${key}` : key, "unknown field");
  }
  return true;
}

function serializedBytes(value, limit, label) {
  let text;
  try {
    text = JSON.stringify(value);
  } catch {
    throw new EvolutionContractError("INVALID_JSON", `${label} must be JSON-serializable`);
  }
  const bytes = Buffer.byteLength(text ?? "", "utf8");
  if (bytes > limit) {
    throw new EvolutionContractError("STRUCTURED_OUTPUT_TOO_LARGE", `${label} exceeds ${limit} bytes`);
  }
}

function normalizeScopePath(value, field, issues) {
  if (typeof value !== "string" || !value.trim()) {
    issue(issues, "INVALID_PATH", field, "path must be a non-empty string");
    return null;
  }
  if (value.includes("\0") || path.isAbsolute(value) || path.win32.isAbsolute(value)) {
    issue(issues, "INVALID_PATH", field, "path must be relative and contain no NUL byte");
    return null;
  }
  const normalized = path.posix.normalize(value.replaceAll("\\", "/")).replace(/^\.\//, "").replace(/\/$/, "");
  if (!normalized || normalized === "." || normalized === ".." || normalized.startsWith("../")) {
    issue(issues, "INVALID_PATH", field, "path escapes or aliases the workspace root");
    return null;
  }
  return normalized;
}

function pathOverlap(left, right) {
  return left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`);
}

function requireString(value, field, issues, { max = 10_000 } = {}) {
  if (typeof value !== "string" || !value.trim() || value.length > max) {
    issue(issues, "INVALID_STRING", field, `must be a non-empty string no longer than ${max}`);
    return "";
  }
  return value.trim();
}

function normalizeEvaluators(value, issues) {
  if (!Array.isArray(value) || value.length === 0) {
    issue(issues, "MISSING_EVALUATOR", "evaluators", "at least one evaluator is required");
    return [];
  }
  const ids = new Set();
  return value.map((entry, index) => {
    const field = `evaluators[${index}]`;
    knownKeys(entry, new Set(["id", "required", "configuration"]), field, issues);
    const id = requireString(entry?.id, `${field}.id`, issues, { max: 128 });
    if (id && !SAFE_ID.test(id)) issue(issues, "INVALID_ID", `${field}.id`, "unsafe evaluator id");
    if (ids.has(id)) issue(issues, "DUPLICATE_ID", `${field}.id`, "duplicate evaluator id");
    ids.add(id);
    if (typeof entry?.required !== "boolean") issue(issues, "INVALID_TYPE", `${field}.required`, "must be boolean");
    const rawConfiguration = entry?.configuration ?? {};
    if (!plainObject(rawConfiguration)) {
      issue(issues, "INVALID_TYPE", `${field}.configuration`, "must be an object");
    }
    const configuration = plainObject(rawConfiguration) ? { ...rawConfiguration } : {};
    if (Object.hasOwn(configuration, "hiddenPaths")) {
      if (!Array.isArray(configuration.hiddenPaths)) {
        issue(issues, "INVALID_TYPE", `${field}.configuration.hiddenPaths`, "must be an array");
        configuration.hiddenPaths = [];
      } else {
        configuration.hiddenPaths = [...new Set(configuration.hiddenPaths.map((hiddenPath, hiddenIndex) =>
          normalizeScopePath(hiddenPath, `${field}.configuration.hiddenPaths[${hiddenIndex}]`, issues)
        ).filter(Boolean))].sort();
      }
    } else {
      configuration.hiddenPaths = [];
    }
    return { id, required: entry?.required === true, configuration: Object.freeze(configuration) };
  });
}

function normalizeMetrics(value, issues) {
  if (!Array.isArray(value) || value.length === 0) {
    issue(issues, "MISSING_METRIC_SEMANTICS", "metrics", "at least one metric is required");
    return [];
  }
  const names = new Set();
  const metrics = value.map((entry, index) => {
    const field = `metrics[${index}]`;
    knownKeys(entry, new Set(["name", "direction", "required", "baselineTolerance", "target", "weight"]), field, issues);
    const name = requireString(entry?.name, `${field}.name`, issues, { max: 128 });
    if (names.has(name)) issue(issues, "DUPLICATE_ID", `${field}.name`, "duplicate metric name");
    names.add(name);
    const direction = entry?.direction;
    if (!METRIC_DIRECTIONS.has(direction)) {
      issue(issues, "MISSING_METRIC_SEMANTICS", `${field}.direction`, "unknown metric direction");
    }
    const tolerance = entry?.baselineTolerance;
    if (!Number.isFinite(tolerance) || tolerance < 0) {
      issue(issues, "INVALID_NUMBER", `${field}.baselineTolerance`, "must be a finite non-negative number");
    }
    const weight = entry?.weight;
    if (!Number.isFinite(weight) || weight < 0) issue(issues, "INVALID_NUMBER", `${field}.weight`, "must be non-negative");
    if (typeof entry?.required !== "boolean") issue(issues, "INVALID_TYPE", `${field}.required`, "must be boolean");
    if (direction === "exact" && entry?.target === null) issue(issues, "MISSING_METRIC_TARGET", `${field}.target`, "exact metric requires target");
    if (direction === "boolean" && typeof entry?.target !== "boolean") {
      issue(issues, "MISSING_METRIC_TARGET", `${field}.target`, "boolean metric requires boolean target");
    }
    return {
      name,
      direction,
      required: entry?.required === true,
      baselineTolerance: tolerance,
      target: entry?.target ?? null,
      weight
    };
  });
  if (!metrics.some((metric) => metric.required)) {
    issue(issues, "MISSING_REQUIRED_METRIC", "metrics", "at least one metric must be required");
  }
  return metrics;
}

function normalizeBudgets(value, issues) {
  if (!knownKeys(value, new Set(BUDGET_KEYS), "budgets", issues)) return {};
  const result = {};
  for (const key of BUDGET_KEYS) {
    if (!Number.isSafeInteger(value[key]) || value[key] <= 0) {
      issue(issues, "INVALID_BUDGET", `budgets.${key}`, "budget must be a positive safe integer");
    }
    result[key] = value[key];
  }
  return result;
}

function normalizeApprovalPolicy(value, issues) {
  if (!knownKeys(value, new Set(["mode", "allowedRiskLevels"]), "approvalPolicy", issues)) {
    return { mode: "manual", allowedRiskLevels: [] };
  }
  if (!APPROVAL_MODES.has(value.mode)) issue(issues, "INVALID_APPROVAL_POLICY", "approvalPolicy.mode", "unknown approval mode");
  if (!Array.isArray(value.allowedRiskLevels) || value.allowedRiskLevels.some((risk) => !RISK_LEVELS.has(risk))) {
    issue(issues, "INVALID_APPROVAL_POLICY", "approvalPolicy.allowedRiskLevels", "contains an unknown risk level");
  }
  return { mode: value.mode, allowedRiskLevels: [...new Set(value.allowedRiskLevels ?? [])] };
}

function throwIssues(issues) {
  if (!issues.length) return;
  const preferred = issues.find((entry) => entry.code === "PATH_SCOPE_CONFLICT") ?? issues[0];
  throw new EvolutionContractError(preferred.code, preferred.message, issues);
}

export function validateEvolutionTask(input, options = {}) {
  serializedBytes(input, options.maxBytes ?? DEFAULT_MAX_CONTRACT_BYTES, "task contract");
  const issues = [];
  knownKeys(input, TASK_KEYS, "", issues);
  if (input?.contractVersion !== EVOLUTION_TASK_VERSION) {
    issue(issues, "UNSUPPORTED_CONTRACT_VERSION", "contractVersion", "unsupported contractVersion");
  }
  const taskId = requireString(input?.taskId, "taskId", issues, { max: 128 });
  if (taskId && !SAFE_ID.test(taskId)) issue(issues, "INVALID_ID", "taskId", "unsafe taskId");
  const title = requireString(input?.title, "title", issues, { max: 500 });
  const objective = requireString(input?.objective, "objective", issues, { max: 20_000 });
  const baselineRef = requireString(input?.baselineRef, "baselineRef", issues, { max: 500 });

  const repositoryRoot = path.resolve(options.repositoryRoot ?? process.cwd());
  let workspaceRoot = "";
  if (typeof input?.workspaceRoot !== "string" || !input.workspaceRoot.trim()) {
    issue(issues, "INVALID_PATH", "workspaceRoot", "workspaceRoot is required");
  } else {
    workspaceRoot = path.resolve(repositoryRoot, input.workspaceRoot);
    const relative = path.relative(repositoryRoot, workspaceRoot);
    if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      issue(issues, "WORKSPACE_ROOT_ESCAPE", "workspaceRoot", "workspaceRoot escapes repositoryRoot");
    }
  }

  const mutablePaths = Array.isArray(input?.mutablePaths)
    ? input.mutablePaths.map((value, index) => normalizeScopePath(value, `mutablePaths[${index}]`, issues)).filter(Boolean)
    : (issue(issues, "INVALID_TYPE", "mutablePaths", "must be an array"), []);
  const immutablePaths = Array.isArray(input?.immutablePaths)
    ? input.immutablePaths.map((value, index) => normalizeScopePath(value, `immutablePaths[${index}]`, issues)).filter(Boolean)
    : (issue(issues, "INVALID_TYPE", "immutablePaths", "must be an array"), []);
  if (!mutablePaths.length) issue(issues, "EMPTY_MUTABLE_SCOPE", "mutablePaths", "at least one mutable path is required");
  for (const mutable of mutablePaths) {
    for (const immutable of immutablePaths) {
      if (pathOverlap(mutable, immutable)) {
        issue(issues, "PATH_SCOPE_CONFLICT", "mutablePaths", `${mutable} overlaps immutable path ${immutable}`);
      }
    }
  }

  const evaluators = normalizeEvaluators(input?.evaluators, issues);
  for (const [index, evaluator] of evaluators.entries()) {
    for (const hiddenPath of evaluator.configuration.hiddenPaths) {
      if (!inScope(hiddenPath, immutablePaths)) {
        issue(issues, "HIDDEN_PATH_NOT_IMMUTABLE", `evaluators[${index}].configuration.hiddenPaths`,
          `${hiddenPath} must be contained by immutablePaths`);
      }
    }
  }
  const metrics = normalizeMetrics(input?.metrics, issues);
  const budgets = normalizeBudgets(input?.budgets, issues);
  const approvalPolicy = normalizeApprovalPolicy(input?.approvalPolicy, issues);
  throwIssues(issues);
  return Object.freeze({
    contractVersion: EVOLUTION_TASK_VERSION,
    taskId,
    title,
    objective,
    workspaceRoot,
    mutablePaths: Object.freeze([...new Set(mutablePaths)].sort()),
    immutablePaths: Object.freeze([...new Set(immutablePaths)].sort()),
    baselineRef,
    evaluators: Object.freeze(evaluators.map(Object.freeze)),
    metrics: Object.freeze(metrics.map(Object.freeze)),
    budgets: Object.freeze({ ...budgets }),
    approvalPolicy: Object.freeze(approvalPolicy)
  });
}

export function checkEvolutionTask(input, options = {}) {
  try {
    return { ok: true, value: validateEvolutionTask(input, options), errors: [] };
  } catch (error) {
    if (!(error instanceof EvolutionContractError)) throw error;
    return { ok: false, value: null, errors: error.issues };
  }
}

function inScope(candidate, scopes) {
  return scopes.some((scope) => candidate === scope || candidate.startsWith(`${scope}/`));
}

export function validateProposal(input, taskContract, options = {}) {
  serializedBytes(input, options.maxBytes ?? DEFAULT_MAX_PROPOSAL_BYTES, "proposal");
  const issues = [];
  knownKeys(input, new Set([
    "proposalVersion", "revision", "summary", "hypothesis", "targetFiles", "targetSymbols",
    "plannedChanges", "testsToRun", "knownRisks", "stopInstead", "impactAnalysis"
  ]), "", issues);
  if (input?.proposalVersion !== EVOLUTION_PROPOSAL_VERSION) {
    issue(issues, "UNSUPPORTED_PROPOSAL_VERSION", "proposalVersion", "unsupported proposalVersion");
  }
  if (!Number.isSafeInteger(input?.revision) || input.revision <= 0) issue(issues, "INVALID_REVISION", "revision", "must be positive integer");
  const summary = requireString(input?.summary, "summary", issues, { max: 10_000 });
  const hypothesis = requireString(input?.hypothesis, "hypothesis", issues, { max: 10_000 });
  const targetFiles = Array.isArray(input?.targetFiles)
    ? input.targetFiles.map((value, index) => normalizeScopePath(value, `targetFiles[${index}]`, issues)).filter(Boolean)
    : (issue(issues, "INVALID_TYPE", "targetFiles", "must be an array"), []);
  for (const file of targetFiles) {
    if (!inScope(file, taskContract.mutablePaths) || inScope(file, taskContract.immutablePaths)) {
      issue(issues, "IMMUTABLE_PATH_WRITE", "targetFiles", `${file} is outside mutable scope`);
    }
  }
  if (targetFiles.length > taskContract.budgets.maxFilesChanged) {
    issue(issues, "FILE_BUDGET_EXCEEDED", "targetFiles", "target file budget exceeded");
  }
  const targetSymbols = Array.isArray(input?.targetSymbols) ? input.targetSymbols.map(String) : [];
  const testsToRun = Array.isArray(input?.testsToRun) ? input.testsToRun.map(String) : [];
  const evaluatorIds = new Set(taskContract.evaluators.map(({ id }) => id));
  if (!testsToRun.length || testsToRun.some((id) => !evaluatorIds.has(id))) {
    issue(issues, "INVALID_TEST_PLAN", "testsToRun", "test plan must reference configured evaluators");
  }
  if (!Array.isArray(input?.plannedChanges) || (!input.plannedChanges.length && input?.stopInstead !== true)) {
    issue(issues, "EMPTY_CHANGE_PLAN", "plannedChanges", "a non-stop proposal requires planned changes");
  }
  if (typeof input?.stopInstead !== "boolean") issue(issues, "INVALID_TYPE", "stopInstead", "must be boolean");
  if (targetSymbols.length && !plainObject(input?.impactAnalysis)) {
    issue(issues, "MISSING_IMPACT_ANALYSIS", "impactAnalysis", "targeted symbols require GitNexus impact evidence");
  }
  throwIssues(issues);
  return Object.freeze({
    ...input,
    summary,
    hypothesis,
    targetFiles: Object.freeze([...new Set(targetFiles)].sort()),
    targetSymbols: Object.freeze(targetSymbols),
    testsToRun: Object.freeze(testsToRun)
  });
}

export function validateProvenanceRecord(input) {
  serializedBytes(input, 64_000, "provenance record");
  const issues = [];
  knownKeys(input, new Set([
    "schema", "change_id", "requirements", "ds4_components_reused", "external_code_copied",
    "external_prompts_copied", "external_tests_copied", "new_files", "modified_files",
    "author_attestation", "review_status"
  ]), "", issues);
  if (input?.schema !== EVOLUTION_PROVENANCE_VERSION) issue(issues, "INVALID_PROVENANCE_SCHEMA", "schema", "unsupported provenance schema");
  if (!SAFE_ID.test(String(input?.change_id ?? ""))) issue(issues, "INVALID_ID", "change_id", "unsafe change id");
  if (!Array.isArray(input?.requirements) || !input.requirements.length) issue(issues, "MISSING_ATTESTATION", "requirements", "requirements are required");
  for (const field of ["external_code_copied", "external_prompts_copied", "external_tests_copied"]) {
    if (input?.[field] !== false) issue(issues, "CLEAN_ROOM_ATTESTATION_FAILED", field, `${field} must be false`);
  }
  requireString(input?.author_attestation, "author_attestation", issues, { max: 500 });
  requireString(input?.review_status, "review_status", issues, { max: 100 });
  for (const field of ["ds4_components_reused", "new_files", "modified_files"]) {
    if (!Array.isArray(input?.[field])) issue(issues, "MISSING_ATTESTATION", field, `${field} must be an array`);
  }
  throwIssues(issues);
  return Object.freeze({ ...input });
}
