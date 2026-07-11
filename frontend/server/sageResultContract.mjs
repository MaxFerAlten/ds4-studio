export const SAGE_RESULT_CONTRACT_VERSION = "sage_result_v1";

export const SAGE_TASK_TYPES = new Set([
  "auto",
  "evaluate",
  "simplify",
  "factor",
  "solve",
  "system",
  "calculus",
  "limit",
  "series",
  "function_study",
  "linear_algebra",
  "number_theory",
  "combinatorics",
  "probability",
  "geometry",
  "plot",
  "validation",
  "mixed"
]);

export const SAGE_PHASES = new Set([
  "prepare",
  "compute",
  "validate",
  "plot",
  "repair"
]);

const SAGE_STATUSES = new Set(["ok", "error", "timeout", "cancelled"]);
const DEBUG_PREVIEW_BYTES = 8 * 1024;

const PHASE_LABELS = {
  prepare: "Preparazione",
  compute: "Calcolo",
  validate: "Validazione",
  plot: "Grafici e artefatti",
  repair: "Correzione"
};

function normalizedString(value) {
  return String(value ?? "").trim().toLowerCase();
}

function utf8Preview(value, maxBytes = DEBUG_PREVIEW_BYTES) {
  const bytes = Buffer.from(String(value ?? ""), "utf8");
  return bytes.subarray(0, maxBytes).toString("utf8");
}

function normalizedLatex(value) {
  const values = Array.isArray(value) ? value : value ? [value] : [];
  return values
    .map((item) => String(item ?? "").trim())
    .filter(Boolean);
}

function legacyModelContent(stdout, latex) {
  const parts = [];
  const cleanStdout = String(stdout ?? "").trim();
  if (cleanStdout) parts.push(cleanStdout);
  for (const formula of latex) {
    if (!cleanStdout.includes(formula)) parts.push(`LaTeX: ${formula}`);
  }
  return parts.join("\n").trim() || "SageMath produced no standard output.";
}

export function normalizeSageTaskType(value) {
  const normalized = normalizedString(value);
  return SAGE_TASK_TYPES.has(normalized) ? normalized : "auto";
}

export function normalizeSagePhase(value) {
  const normalized = normalizedString(value);
  return SAGE_PHASES.has(normalized) ? normalized : "compute";
}

export function validateSageResult(value) {
  const errors = [];
  const addError = (code, path, message) => errors.push({ code, path, message });

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    addError("INVALID_TYPE", "$", "Sage result must be an object.");
    return { ok: false, errors, value };
  }

  if (value.contractVersion !== SAGE_RESULT_CONTRACT_VERSION) {
    addError("INVALID_CONTRACT_VERSION", "contractVersion", "Unsupported Sage result contract.");
  }
  if (value.tool !== "sage") {
    addError("INVALID_TOOL", "tool", "Sage result tool must be sage.");
  }
  if (!SAGE_STATUSES.has(value.status)) {
    addError("INVALID_STATUS", "status", "Sage result status is invalid.");
  }
  if (!value.display || typeof value.display !== "object" ||
      typeof value.display.summary !== "string" || !value.display.summary.trim()) {
    addError("INVALID_DISPLAY_SUMMARY", "display.summary", "A display summary is required.");
  }
  if (!value.model || typeof value.model !== "object" ||
      typeof value.model.content !== "string") {
    addError("INVALID_MODEL_CONTENT", "model.content", "Model content must be a string.");
  }
  if (!Array.isArray(value.artifacts)) {
    addError("INVALID_ARTIFACTS", "artifacts", "Artifacts must be an array.");
  }
  if (value.validation != null &&
      (typeof value.validation !== "object" ||
       typeof value.validation.passed !== "boolean")) {
    addError("INVALID_VALIDATION", "validation.passed", "Validation passed must be boolean.");
  }

  if (value.report?.kind === "function_study_v1") {
    const requiredObjects = [
      ["function", value.report.function],
      ["domain", value.report.domain],
      ["firstDerivative", value.report.firstDerivative],
      ["secondDerivative", value.report.secondDerivative]
    ];
    for (const [field, fieldValue] of requiredObjects) {
      if (!fieldValue || typeof fieldValue !== "object" || Array.isArray(fieldValue)) {
        addError(
          "INCOMPLETE_FUNCTION_STUDY",
          `report.${field}`,
          `Function-study report requires ${field}.`
        );
      }
    }
    if (typeof value.report.conclusion !== "string") {
      addError(
        "INCOMPLETE_FUNCTION_STUDY",
        "report.conclusion",
        "Function-study report requires a conclusion."
      );
    }
  }

  return { ok: errors.length === 0, errors, value };
}

export function buildLegacySageResult(input = {}) {
  const stdout = String(input.stdout ?? "");
  const stderr = String(input.stderr ?? "");
  const taskType = normalizeSageTaskType(input.taskType);
  const phase = normalizeSagePhase(input.phase);
  const killed = Boolean(input.killed);
  const exitCode = Number.isInteger(input.exitCode) ? input.exitCode : null;
  const status = killed ? "timeout" : exitCode === 0 ? "ok" : "error";
  const latex = normalizedLatex(input.latexOutput);
  const attempt = Math.max(1, Number.parseInt(input.attempt, 10) || 1);
  const durationMs = Math.max(0, Number(input.durationMs) || 0);

  return {
    contractVersion: SAGE_RESULT_CONTRACT_VERSION,
    tool: "sage",
    taskType,
    phase,
    status,
    attempt,
    display: {
      title: "SageMath",
      stage: PHASE_LABELS[phase],
      summary: status === "ok"
        ? `${PHASE_LABELS[phase]} completato.`
        : `${PHASE_LABELS[phase]} non completato.`,
      detailsAvailable: Boolean(stdout || stderr)
    },
    model: {
      content: legacyModelContent(stdout, latex),
      latex,
      facts: []
    },
    report: null,
    artifacts: [],
    validation: {
      passed: status === "ok",
      checks: [],
      warnings: status === "ok" ? [] : ["SageMath execution did not complete successfully."]
    },
    debug: {
      exitCode,
      signal: input.signal == null ? null : String(input.signal),
      killed,
      durationMs,
      stdoutBytes: Buffer.byteLength(stdout, "utf8"),
      stderrBytes: Buffer.byteLength(stderr, "utf8"),
      stdoutPreview: utf8Preview(stdout),
      stderrPreview: utf8Preview(stderr)
    }
  };
}

export function publicSageResult(value) {
  if (!value || typeof value !== "object") return null;
  const debug = value.debug && typeof value.debug === "object"
    ? {
        exitCode: value.debug.exitCode ?? null,
        signal: value.debug.signal ?? null,
        killed: Boolean(value.debug.killed),
        durationMs: Number(value.debug.durationMs) || 0,
        stdoutBytes: Number(value.debug.stdoutBytes) || 0,
        stderrBytes: Number(value.debug.stderrBytes) || 0
      }
    : null;

  return {
    contractVersion: value.contractVersion,
    tool: value.tool,
    taskType: value.taskType,
    phase: value.phase,
    status: value.status,
    attempt: value.attempt,
    display: value.display ? { ...value.display } : null,
    artifacts: Array.isArray(value.artifacts)
      ? value.artifacts.map((artifact) => ({ ...artifact }))
      : [],
    validation: value.validation ? { ...value.validation } : null,
    debug
  };
}
