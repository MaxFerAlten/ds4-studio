export const SAGE_RESULT_CONTRACT_VERSION = "sage_result_v2";
export const SAGE_LEGACY_RESULT_CONTRACT_VERSION = "sage_result_v1";

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
const SAGE_STATES = new Set([
  "idle",
  "prepared",
  "computed",
  "repairing",
  "validated",
  "plotted",
  "ready",
  "failed"
]);
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

  const isAuthoritativeContract = value.contractVersion === SAGE_RESULT_CONTRACT_VERSION;
  const isLegacyContract = value.contractVersion === SAGE_LEGACY_RESULT_CONTRACT_VERSION;
  if (!isAuthoritativeContract && !isLegacyContract) {
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
  if (!value.validation || typeof value.validation !== "object" ||
      typeof value.validation.passed !== "boolean") {
    addError("INVALID_VALIDATION", "validation.passed", "Validation passed must be boolean.");
  }

  if (isAuthoritativeContract) {
    if (typeof value.runId !== "string" || !value.runId.trim()) {
      addError("INVALID_RUN_ID", "runId", "An authoritative Sage result requires a run ID.");
    }
    if (!SAGE_STATES.has(value.state)) {
      addError("INVALID_STATE", "state", "Sage result state is invalid.");
    }
    if (!value.execution || typeof value.execution !== "object" ||
        typeof value.execution.ok !== "boolean" ||
        typeof value.execution.timedOut !== "boolean" ||
        !(value.execution.exitCode == null || Number.isInteger(value.execution.exitCode))) {
      addError("INVALID_EXECUTION", "execution", "Execution status is incomplete.");
    }

    const validation = value.validation;
    const checks = Array.isArray(validation?.checks) ? validation.checks : null;
    if (typeof validation?.authoritative !== "boolean") {
      addError(
        "INVALID_VALIDATION_AUTHORITY",
        "validation.authoritative",
        "Validation authority must be boolean."
      );
    }
    if (!checks) {
      addError("INVALID_VALIDATION_CHECKS", "validation.checks", "Validation checks must be an array.");
    } else if (checks.some((check) => !check || typeof check !== "object" ||
        typeof check.passed !== "boolean")) {
      addError("INVALID_VALIDATION_CHECK", "validation.checks", "Every validation check needs a result.");
    }
    if (!Array.isArray(validation?.errors)) {
      addError("INVALID_VALIDATION_ERRORS", "validation.errors", "Validation errors must be an array.");
    }
    if (validation?.passed === true) {
      if (validation.authoritative !== true) {
        addError(
          "NON_AUTHORITATIVE_PASS",
          "validation.authoritative",
          "A validation pass must be runtime-authoritative."
        );
      }
      if (!checks?.length) {
        addError(
          "VALIDATION_CHECKS_EMPTY",
          "validation.checks",
          "A validation pass requires at least one check."
        );
      } else if (checks.some((check) => check?.passed !== true)) {
        addError(
          "VALIDATION_CHECK_FAILED",
          "validation.checks",
          "A validation pass cannot contain a failed check."
        );
      }
    }

    const publication = value.publication;
    if (!publication || typeof publication !== "object" ||
        typeof publication.publishable !== "boolean" ||
        typeof publication.markdown !== "string" ||
        !Array.isArray(publication.reasonCodes)) {
      addError("INVALID_PUBLICATION", "publication", "Publication status is incomplete.");
    } else if (publication.publishable) {
      const authoritativePass = value.execution?.ok === true &&
        validation?.authoritative === true &&
        validation?.passed === true &&
        Boolean(checks?.length) &&
        checks.every((check) => check?.passed === true);
      if (!authoritativePass) {
        addError(
          "INVALID_PUBLICATION_AUTHORITY",
          "publication.publishable",
          "Publication requires an authoritative validation pass."
        );
      }
      if (!publication.markdown.trim()) {
        addError(
          "FINAL_MARKDOWN_MISSING",
          "publication.markdown",
          "Publishable results require final Markdown."
        );
      }
    }
  }

  if (isLegacyContract) {
    if (value.validation?.authoritative === true || value.validation?.passed === true) {
      addError(
        "LEGACY_RESULT_NOT_AUTHORITATIVE",
        "validation",
        "Legacy execution cannot be authoritative."
      );
    }
    if (value.publication?.publishable === true) {
      addError(
        "LEGACY_RESULT_NOT_PUBLISHABLE",
        "publication.publishable",
        "Legacy execution cannot be published authoritatively."
      );
    }
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
    contractVersion: SAGE_LEGACY_RESULT_CONTRACT_VERSION,
    tool: "sage",
    runId: input.runId == null ? null : String(input.runId),
    taskType,
    phase,
    state: status === "ok" ? "computed" : "failed",
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
    execution: {
      ok: status === "ok",
      exitCode,
      timedOut: killed
    },
    validation: {
      authoritative: false,
      passed: false,
      checks: [],
      errors: status === "ok"
        ? ["LEGACY_EXECUTION_NOT_MATHEMATICALLY_VALIDATED"]
        : ["SAGE_EXECUTION_FAILED"],
      warnings: []
    },
    publication: {
      publishable: false,
      markdown: "",
      reasonCodes: [
        status === "ok" ? "LEGACY_RESULT_NOT_AUTHORITATIVE" : "EXECUTION_FAILED"
      ]
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
    runId: value.runId ?? null,
    taskType: value.taskType,
    phase: value.phase,
    state: value.state ?? null,
    status: value.status,
    attempt: value.attempt,
    display: value.display ? { ...value.display } : null,
    artifacts: Array.isArray(value.artifacts)
      ? value.artifacts.map((artifact) => ({ ...artifact }))
      : [],
    validation: value.validation
      ? {
          ...value.validation,
          checks: Array.isArray(value.validation.checks)
            ? value.validation.checks.map((check) => ({ ...check }))
            : [],
          errors: Array.isArray(value.validation.errors) ? [...value.validation.errors] : [],
          warnings: Array.isArray(value.validation.warnings) ? [...value.validation.warnings] : []
        }
      : null,
    publication: value.publication
      ? {
          ...value.publication,
          reasonCodes: Array.isArray(value.publication.reasonCodes)
            ? [...value.publication.reasonCodes]
            : []
        }
      : null,
    debug
  };
}
