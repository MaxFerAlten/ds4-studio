// Deterministic classification of a Sage tool result into an orchestration
// decision (fase S2 del piano).
//
// The loop needs four answers, and none of them may come from model prose:
// is this terminal, is another attempt worth anything, which phase comes next,
// and what exactly must change. Everything below is computed from the runtime's
// own evidence — execution status, validator check codes, artifact kinds.
//
// A failed mathematical validation is NOT terminal: it is the normal way a first
// candidate ends, and it must produce a repair, not a stop (diagnosi §1.7).

import { createHash } from "crypto";

import {
  SAGE_FUNCTION_STUDY_ARTIFACT_KINDS,
  sageTaskRequiresPlots,
} from "./sageOrchestrationConfig.mjs";

/** Failure classes a new candidate revision can plausibly fix. */
export const SAGE_RETRYABLE_CLASSES = Object.freeze([
  "math_validation_failed",
  "katex_validation_failed",
  "artifact_missing",
  "plot_generation_failed",
  "execution_error",
  "timeout",
  "syntax_error",
  "domain_error",
  "numeric_isolation_error",
]);

/** Terminal classes: another identical attempt cannot change the outcome. */
export const SAGE_TERMINAL_CLASSES = Object.freeze([
  "success_publishable",
  "policy_mismatch",
  "runtime_unavailable",
  "bridge_invalid_payload",
  "bridge_invalid_json",
  "cancelled",
]);

/** Terminal classes that are an infrastructure block rather than a result. */
export const SAGE_INFRASTRUCTURE_CLASSES = Object.freeze([
  "policy_mismatch",
  "runtime_unavailable",
  "bridge_invalid_payload",
  "bridge_invalid_json",
]);

/**
 * Which phase the runtime demands next. The model does not get to choose it:
 * §15.3 requires a deterministic requiredNextPhase whenever one exists.
 */
const NEXT_PHASE = Object.freeze({
  success_publishable: "publish",
  pending_validation: "validate",
  math_validation_failed: "repair",
  katex_validation_failed: "repair",
  artifact_missing: "plot",
  plot_generation_failed: "plot",
  execution_error: "repair",
  timeout: "repair",
  syntax_error: "repair",
  domain_error: "repair",
  numeric_isolation_error: "repair",
  policy_mismatch: "terminal",
  runtime_unavailable: "terminal",
  bridge_invalid_payload: "terminal",
  bridge_invalid_json: "terminal",
  cancelled: "terminal",
});

/** One imperative sentence per class. The model acts on it, it does not read it. */
const GUIDANCE = Object.freeze({
  success_publishable:
    "The publication gate accepted the candidate. Publish the final markdown it returned, unchanged.",
  pending_validation:
    "The candidate executed. Call sage with phase=validate so the runtime validator can judge it; do not present it as a result yet.",
  math_validation_failed:
    "Correct the mathematics the runtime validator rejected — use the failed check codes as the list of things to fix — and send the corrected candidate as a repair.",
  katex_validation_failed:
    "Fix the LaTeX/KaTeX the validator rejected without touching the mathematical content, then send the corrected candidate as a repair.",
  artifact_missing:
    "The report is valid but its plot package is incomplete. Call sage again with phase=plot to produce the missing artifact kinds; do not recompute the study.",
  plot_generation_failed:
    "The plot code failed. Repair the plotting call only — ranges, poles, output path — and call sage again with phase=plot.",
  execution_error:
    "SageMath refused to execute the candidate. Read the reported error, fix the code, and send it as a repair.",
  timeout:
    "The execution exceeded its budget. Simplify the candidate — narrow ranges, drop unnecessary symbolic work — and send the lighter version as a repair.",
  syntax_error:
    "The candidate does not parse. Fix the syntax only, leave the mathematical intent untouched, and send it as a repair.",
  domain_error:
    "The computation hit a domain violation (division by zero, log of a non-positive value, evaluation at an excluded point). Restrict the domain explicitly in the candidate and send it as a repair.",
  numeric_isolation_error:
    "Root isolation or numerical evaluation failed. Provide explicit intervals or exact expressions instead of relying on automatic isolation, then send the candidate as a repair.",
  policy_mismatch:
    "The Sage policy the run started with is no longer the one on disk. Do not publish a mathematical result; report the block.",
  runtime_unavailable:
    "The Sage runtime or its validator is unavailable. Do not publish a mathematical result; report NOT_PUBLISHABLE with the runtime error code.",
  bridge_invalid_payload:
    "The bridge returned a payload that is not a valid Sage response. Do not publish a mathematical result; report the block.",
  bridge_invalid_json:
    "The bridge returned output that is not valid JSON. Do not publish a mathematical result; report the block.",
  cancelled: "The run was cancelled. Do not publish a mathematical result.",
});

const STRATEGY_CHANGE_SUFFIX =
  " The previous candidate failed in exactly the same way: change mathematical strategy instead of resubmitting an equivalent candidate.";

/** Bridge/gate error codes that name a broken runtime rather than bad maths. */
const BRIDGE_CODE_CLASSES = Object.freeze({
  SAGE_POLICY_UNAVAILABLE: "policy_mismatch",
  SAGE_POLICY_REVISION_MISMATCH: "policy_mismatch",
  SAGE_ORCHESTRATOR_UNAVAILABLE: "runtime_unavailable",
  SAGE_VALIDATOR_UNAVAILABLE: "runtime_unavailable",
  VALIDATOR_UNAVAILABLE: "runtime_unavailable",
  SAGE_BRIDGE_INVALID_PAYLOAD: "bridge_invalid_payload",
  SAGE_BRIDGE_INVALID_JSON: "bridge_invalid_json",
  SAGE_VALIDATOR_INVALID_JSON: "bridge_invalid_json",
  SAGE_TIMEOUT: "timeout",
  SAGE_EXECUTION_FAILED: "execution_error",
  SAGE_CANCELLED: "cancelled",
});

/**
 * Stderr patterns, in priority order. These only separate one execution failure
 * from another: everything structured (exit code, timeout, check codes) is read
 * before reaching them.
 */
const STDERR_PATTERNS = Object.freeze([
  ["syntax_error", /SyntaxError|IndentationError|invalid syntax|unexpected EOF while parsing|unexpected indent/i],
  ["domain_error", /ZeroDivisionError|division by zero|math domain error|PoleError|not in the domain|log\(0\)|infinite value/i],
  ["numeric_isolation_error", /failed to isolate|no ?real ?roots? found|isolation failed|did not converge|convergence failure|NotImplementedError.*(root|solve)|unable to (find|compute) (all )?roots/i],
]);

/** Validator check codes that identify what kind of validation failed. */
const KATEX_CHECK = /^KATEX_|LATEX/i;
const ARTIFACT_CHECK = /ARTIFACT|PLOT_POINTS_MATCH_CLASSIFICATIONS|SAGE_ARTIFACT_MISSING/i;
const PLOT_CHECK = /^PLOT_VALIDATION$|PLOT_GENERATION/i;

/**
 * Strip everything that changes between two runs of the same broken candidate:
 * run directories, run ids, wall-clock durations, memory addresses.
 */
export function normalizeSageMessage(message) {
  if (typeof message !== "string") return "";
  return message
    .replace(/\/(?:tmp|var\/folders|run)\/[^\s:)"']*/g, "<path>")
    .replace(/(?:[A-Za-z]:)?(?:\/[\w.@%+-]+)*\/(?:runtime|sage-runs|artifacts)\/[^\s:)"']*/g, "<path>")
    .replace(/sage-[a-f0-9]{6,}-\d+-\d+/g, "<runid>")
    .replace(/0x[0-9a-fA-F]+/g, "<addr>")
    .replace(/\bline \d+/gi, "line <n>")
    .replace(/\b\d+(?:\.\d+)?\s?(?:ms|s|sec|seconds|bytes|KiB|MiB|GiB)\b/gi, "<qty>")
    .replace(/\s+/g, " ")
    .trim();
}

function sageResultOf(result) {
  if (!result || typeof result !== "object") return {};
  return result.sageResult && typeof result.sageResult === "object" ? result.sageResult : result;
}

function failedCheckCodes(sage) {
  const checks = Array.isArray(sage?.validation?.checks) ? sage.validation.checks : [];
  return checks.filter((check) => check?.passed !== true).map((check) => String(check?.code ?? ""));
}

function reasonCodes(result, sage) {
  const codes = [
    ...(Array.isArray(sage?.validation?.errors) ? sage.validation.errors : []),
    ...(Array.isArray(sage?.publication?.reasonCodes) ? sage.publication.reasonCodes : []),
    ...(Array.isArray(result?.reasonCodes) ? result.reasonCodes : []),
  ];
  const bridgeError = result?.debug?.bridgeError ?? sage?.debug?.bridgeError;
  if (bridgeError) codes.push(String(bridgeError));
  return codes.map((code) => String(code)).filter(Boolean);
}

function missingArtifactKinds(result, sage, taskType) {
  if (!sageTaskRequiresPlots(taskType)) return [];
  const artifacts = Array.isArray(result?.artifacts)
    ? result.artifacts
    : Array.isArray(sage?.artifacts)
      ? sage.artifacts
      : [];
  const kinds = new Set(
    artifacts.map((artifact) => String(artifact?.kind ?? "")).filter(Boolean)
  );
  return SAGE_FUNCTION_STUDY_ARTIFACT_KINDS.filter((kind) => !kinds.has(kind));
}

function stderrSignature(result, sage) {
  const parts = [
    result?.debug?.stderr,
    sage?.debug?.stderr,
    sage?.debug?.stderrPreview,
    result?.stderr,
    typeof result?.content === "string" && result?.isError === true ? result.content : "",
  ];
  return normalizeSageMessage(parts.filter(Boolean).join("\n")).slice(0, 2000);
}

function classFromCodes(codes) {
  for (const code of codes) {
    const mapped = BRIDGE_CODE_CLASSES[code];
    if (mapped) return mapped;
  }
  return null;
}

/**
 * Fingerprint the failure, not the run (§6.5).
 *
 * candidateRevision is deliberately NOT part of the hash even though §6.5 lists
 * it: the fingerprint exists to detect "the same failure twice", and every
 * repeat necessarily lands on a new revision. Including it would make two
 * identical failures always look different and the strategy-change rule dead.
 */
export function sageDiagnosticFingerprint({
  failureClass,
  reasonCodes: codes = [],
  failedChecks = [],
  missingArtifacts = [],
  stderr = "",
}) {
  if (failureClass === "success_publishable" || failureClass === "pending_validation") return null;
  const canonical = {
    failureClass,
    reasonCodes: [...new Set(codes)].sort(),
    failedChecks: [...new Set(failedChecks)].sort(),
    missingArtifacts: [...missingArtifacts].sort(),
    stderr: normalizeSageMessage(stderr),
  };
  return `sha256:${createHash("sha256").update(JSON.stringify(canonical)).digest("hex")}`;
}

function classifyValidationFailure(failedChecks, codes, missingArtifacts) {
  if (missingArtifacts.length > 0) return "artifact_missing";
  const all = [...failedChecks, ...codes];
  if (all.some((code) => ARTIFACT_CHECK.test(code))) return "artifact_missing";
  if (all.some((code) => PLOT_CHECK.test(code))) return "plot_generation_failed";
  if (all.some((code) => KATEX_CHECK.test(code))) return "katex_validation_failed";
  return "math_validation_failed";
}

/**
 * Classify one Sage tool result.
 *
 * @param {object} result - the tool result (top level or the sageResult block)
 * @param {object} [context]
 * @param {string} [context.phase] - phase that produced this result
 * @param {string} [context.taskType]
 * @param {number} [context.candidateRevision]
 * @param {string|null} [context.previousFingerprint]
 * @param {number} [context.sameFailureCount] - identical failures so far
 * @param {object} [context.config] - resolved sage orchestration config
 * @param {boolean} [context.cancelled]
 * @returns {{terminal: boolean, retryable: boolean, failureClass: string,
 *   nextPhase: string, nextAction: string, strategyChangeRequired: boolean,
 *   diagnosticFingerprint: string|null, terminalReason: string|null,
 *   sameFailureCount: number, publishable: boolean, infrastructure: boolean}}
 */
export function classifySageResult(result, context = {}) {
  const sage = sageResultOf(result);
  const taskType = context.taskType ?? sage?.taskType ?? "auto";
  const phase = context.phase ?? sage?.phase ?? "compute";
  const codes = reasonCodes(result, sage);
  const failedChecks = failedCheckCodes(sage);
  const missingArtifacts = missingArtifactKinds(result, sage, taskType);
  const stderr = stderrSignature(result, sage);
  const execution = sage?.execution ?? result?.execution ?? {};
  const publishable = result?.publishable === true || sage?.publication?.publishable === true;

  let failureClass;
  let terminalReason = null;

  if (context.cancelled === true || sage?.status === "cancelled") {
    failureClass = "cancelled";
    terminalReason = "SAGE_CANCELLED";
  } else if (publishable) {
    failureClass = "success_publishable";
    terminalReason = "SAGE_PUBLISHABLE";
  } else if (
    phase !== "validate" &&
    result?.isError !== true &&
    execution.ok !== false &&
    execution.timedOut !== true &&
    codes.length === 0
  ) {
    // A compute/repair/plot call that simply ran is not a failure: it owes a
    // validation. Classifying it as a validation failure would poison the
    // fingerprint history and make "the same failure twice" unreadable.
    failureClass = "pending_validation";
  } else {
    const fromCodes = classFromCodes(codes);
    if (fromCodes) {
      failureClass = fromCodes;
    } else if (execution.timedOut === true || sage?.status === "timeout") {
      failureClass = "timeout";
    } else if (execution.ok === false || result?.isError === true) {
      const matched = STDERR_PATTERNS.find(([, pattern]) => pattern.test(stderr));
      // A failure recorded during validate is a validation failure even when the
      // executor flagged it: the candidate ran, the maths did not hold.
      failureClass = matched
        ? matched[0]
        : phase === "validate" && (failedChecks.length > 0 || codes.length > 0)
          ? classifyValidationFailure(failedChecks, codes, missingArtifacts)
          : execution.ok === false
            ? "execution_error"
            : classifyValidationFailure(failedChecks, codes, missingArtifacts);
    } else {
      failureClass = classifyValidationFailure(failedChecks, codes, missingArtifacts);
    }
    if (SAGE_INFRASTRUCTURE_CLASSES.includes(failureClass)) {
      terminalReason = codes.find((code) => BRIDGE_CODE_CLASSES[code]) ?? failureClass.toUpperCase();
    }
  }

  const terminal = SAGE_TERMINAL_CLASSES.includes(failureClass);
  const retryable = !terminal && SAGE_RETRYABLE_CLASSES.includes(failureClass);
  const diagnosticFingerprint = sageDiagnosticFingerprint({
    failureClass,
    reasonCodes: codes,
    failedChecks,
    missingArtifacts,
    stderr,
  });

  const maxSameFailure = Number(context.config?.maxSameFailure) || 2;
  const repeated =
    diagnosticFingerprint !== null &&
    context.previousFingerprint === diagnosticFingerprint;
  const sameFailureCount = repeated ? Number(context.sameFailureCount ?? 1) + 1 : 1;
  const strategyChangeRequired = retryable && sameFailureCount >= maxSameFailure;

  const guidance = GUIDANCE[failureClass] ?? GUIDANCE.execution_error;
  const nextAction = strategyChangeRequired ? `${guidance}${STRATEGY_CHANGE_SUFFIX}` : guidance;

  return {
    terminal,
    retryable,
    publishable: failureClass === "success_publishable",
    infrastructure: SAGE_INFRASTRUCTURE_CLASSES.includes(failureClass),
    failureClass,
    nextPhase: NEXT_PHASE[failureClass] ?? "repair",
    nextAction,
    strategyChangeRequired,
    diagnosticFingerprint,
    sameFailureCount,
    terminalReason,
    missingArtifactKinds: missingArtifacts,
  };
}
