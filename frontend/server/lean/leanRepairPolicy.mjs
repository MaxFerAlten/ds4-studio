// Deterministic classification of a lean_result_v1 into an orchestration
// decision.
//
// The point is to stop asking a small model to read 200 lines of diagnostics
// and infer whether it may stop. classifyLeanResult answers three questions the
// loop actually needs — is this terminal, is it verified, is it worth another
// attempt — plus one imperative sentence saying what to do next.
//
// Every field here is computed from the runtime's own evidence. Nothing the
// model writes is trusted as input (§3.2).

import { createHash } from "crypto";

/** Failure classes that a repair attempt can plausibly fix. */
export const LEAN_RETRYABLE_CLASSES = Object.freeze([
  "candidate_preflight",
  "target_identity",
  "syntax",
  "unknown_identifier",
  "rewrite_miss",
  "unsolved_goals",
  "type_mismatch",
  "timeout_repairable",
  "proof_failure",
]);

/** Terminal classes: another identical attempt cannot change the outcome. */
export const LEAN_TERMINAL_CLASSES = Object.freeze([
  "infrastructure",
  "contract",
  "user_cancelled",
]);

/**
 * Per-class repair guidance (§6.5). One imperative sentence: the model is
 * expected to act on it, not to interpret it.
 */
const GUIDANCE = Object.freeze({
  candidate_preflight:
    "Remove every reported placeholder from the current Lean source without changing the theorem statement, then call lean_check again.",
  target_identity:
    "Restore the locked target declaration and theorem statement exactly; change only the proof body, imports, or helper lemmas, then call lean_check again.",
  syntax:
    "Fix the parser errors only. Do not change the theorem statement, and call lean_check again.",
  unknown_identifier:
    "Verify the namespace, import and spelling of the reported name. Prefer one targeted import over a broad one, then call lean_check again.",
  rewrite_miss:
    "Inspect the reported goal. Replace the fragile rw/add_comm/add_assoc chain with calc, change, conv, nth_rewrite, simp only, ring or omega as appropriate, then call lean_check again.",
  unsolved_goals:
    "Address the exact residual goal that was reported. Do not restate the whole proof; extend it, then call lean_check again.",
  type_mismatch:
    "Reconcile the expected and the actual type reported by Lean — fix the argument, the coercion or the lemma instance — then call lean_check again.",
  timeout_repairable:
    "Narrow the imports first, then reduce automation (simp/decide/omega), then change proof strategy. Call lean_check again with the lighter candidate.",
  proof_failure:
    "Read the reported errors and repair the proof term, then call lean_check again.",
  infrastructure:
    "Do not modify the theorem code. Publish NOT_VERIFIED quoting the exact runtime error code.",
  contract:
    "The request itself was refused. Fix the lean_check arguments; the proof text is not the problem.",
  user_cancelled: "The run was cancelled. Publish NOT_VERIFIED; do not claim a proof.",
});

const STRATEGY_CHANGE_SUFFIX =
  " The previous attempt produced this exact failure already: change proof strategy instead of retrying the same tactic.";

// Distinct candidates that keep failing the same *way* are the loop doc6 caught
// live: invented theorem names cycling, each one a different unknown_identifier
// message, so the fingerprint never repeated and the escalation never fired.
// Editing the candidate is not progress if the failure class does not move.
const CLASS_CHANGE_SUFFIX =
  " Every recent attempt failed the same way (%CLASS%) with a different candidate: editing the proof is not working. Change approach — discover the real names and lemmas with lean_inspect before writing another candidate.";

/** Error codes that name a broken runtime rather than a broken proof. */
const INFRASTRUCTURE_CODE = /^(LEAN_SANDBOX|LEAN_RUNTIME|LEAN_TOOLCHAIN|LEAN_SPAWN|LEAN_PREFLIGHT|LEAN_INTERNAL|LEAN_RESULT_CONTRACT|LEAN_DISABLED)/;

/**
 * Patterns keyed by failure class, in the priority order of §6.3. First match
 * over the joined error diagnostics wins.
 *
 * Structured evidence (status, exitCode, timedOut, cancelled, errorCode) is
 * consulted before any of this; these regexes only separate one proof failure
 * from another, which is the one thing Lean reports as prose (§24.9).
 */
const CLASS_PATTERNS = Object.freeze([
  // `expected …` only counts as a parser error when it *starts* the message.
  // Mid-message it belongs to a tactic ("invalid alternative name 'succ',
  // expected 'zero' or 'succ'"), which is a proof failure, not a syntax one.
  ["syntax", /unexpected token|unexpected identifier|unterminated comment|unexpected end of input|(?:^|\n)\s*expected [`'\w]|invalid ['`]?\w+['`]? command/i],
  ["unknown_identifier", /unknown (identifier|constant|declaration|namespace|tactic|attribute|module prefix)|could not synthesize/i],
  // Lean 4.32 words this as "Tactic `rewrite` failed: Did not find an
  // occurrence of the pattern"; older releases used "rewrite tactic failed" and
  // "did not find instance of the pattern". Both are accepted so a toolchain
  // bump does not silently reclassify every failed rewrite as a generic one.
  ["rewrite_miss", /motive is not type correct|did not find an? (occurrence|instance) of the pattern|tactic\s+[`'"]?rewrite[`'"]?\s+failed|rewrite tactic failed|simp made no progress|pattern.*not found/i],
  ["unsolved_goals", /unsolved goals|error: unsolved|no goals to be proved|linarith failed|omega could not/i],
  ["type_mismatch", /type mismatch|application type mismatch|argument.*has type|function expected/i],
]);

/**
 * Strip everything that changes between two runs of the same broken proof:
 * run directories, run ids, wall-clock durations, byte counts, pointers.
 * What remains is the part of the message that identifies the failure.
 *
 * @param {string} message
 * @returns {string}
 */
export function normalizeMessage(message) {
  if (typeof message !== "string") return "";
  return message
    .replace(/\/(?:tmp|var\/folders|run)\/[^\s:)"']*/g, "<path>")
    .replace(/(?:[A-Za-z]:)?(?:\/[\w.@%+-]+)*\/(?:runs|lean-runs)\/[^\s:)"']*/g, "<path>")
    .replace(/lean-[a-f0-9]{12}-\d+-\d+/g, "<runid>")
    .replace(/proof-[a-f0-9]{12}-\d+-\d+/g, "<proofid>")
    .replace(/0x[0-9a-fA-F]+/g, "<addr>")
    .replace(/\b\d+(?:\.\d+)?\s?(?:ms|s|sec|seconds|bytes|KiB|MiB|GiB)\b/gi, "<qty>")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Fingerprint the failure, not the run (§6.4). Two attempts that fail the same
 * way must produce the same hash so the tracker can force a strategy change.
 *
 * @param {object} result - lean_result_v1
 * @returns {string|null} "sha256:<hex>" or null for a verified result
 */
export function leanDiagnosticFingerprint(result) {
  if (!result || result.status === "checked") return null;
  const diagnostics = Array.isArray(result.diagnostics) ? result.diagnostics : [];
  const canonical = {
    status: result.status,
    errorCode: result.errorCode || null,
    codes: diagnostics.map((d) => d.code || null),
    messages: diagnostics.map((d) => normalizeMessage(d.message)),
    exitCode: result.exitCode ?? null,
    timedOut: Boolean(result.timedOut),
  };
  return `sha256:${createHash("sha256").update(JSON.stringify(canonical)).digest("hex")}`;
}

/** Join the error-severity diagnostics into one haystack for the patterns. */
function errorText(result) {
  const diagnostics = Array.isArray(result.diagnostics) ? result.diagnostics : [];
  const errors = diagnostics.filter((d) => d.severity === "error");
  const source = errors.length > 0 ? errors : diagnostics;
  return [
    ...source.map((d) => String(d.message || "")),
    String(result.summary || ""),
    String(result.stderr || ""),
  ].join("\n");
}

/** Verified means Lean said so and every invariant agrees (§2.2). */
function isVerified(result) {
  if (result.taskMode !== "proof") return false;
  return (
    result.status === "checked" &&
    result.exitCode === 0 &&
    result.timedOut !== true &&
    result.cancelled !== true &&
    result.isError !== true &&
    Boolean(result.targetDeclaration) &&
    /^[0-9a-f]{64}$/.test(result.targetStatementSha256 || "") &&
    result.targetIdentityMatched === true &&
    /^[0-9a-f]{64}$/.test(result.sourceSha256 || "")
  );
}

/**
 * Error codes that mean the proof task's identity drifted: the declaration kept
 * its name but the statement changed, the statement cannot be extracted, or the
 * target vanished. These are repairable — the model must restore the locked
 * statement — so they map to `target_identity`, not to `contract`.
 */
const TARGET_IDENTITY_CODE = new Set([
  "LEAN_TARGET_DECLARATION_NOT_FOUND",
  "LEAN_TARGET_DECLARATION_AMBIGUOUS",
  "LEAN_TARGET_PROOF_FORM_UNSUPPORTED",
  "LEAN_TARGET_STATEMENT_MISMATCH",
]);

function classifyFailure(result) {
  // 2. cancelled — the user stopped it; nothing to repair.
  if (result.status === "cancelled" || result.cancelled === true) {
    return { failureClass: "user_cancelled", terminalReason: "USER_CANCELLED" };
  }

  // 3. preflight_failed / 5. internal_error — the runtime, not the proof.
  if (result.status === "preflight_failed") {
    return {
      failureClass: "infrastructure",
      terminalReason: result.errorCode || "LEAN_PREFLIGHT_FAILED",
    };
  }
  if (result.status === "internal_error") {
    return {
      failureClass: "infrastructure",
      terminalReason: result.errorCode || "LEAN_INTERNAL_ERROR",
    };
  }

  // 4. rejected — split policy/sandbox/runtime (infrastructure) from a request
  //    the caller got wrong (contract). The recovery differs.
  if (result.status === "rejected") {
    const code = String(result.errorCode || "LEAN_REJECTED");

    // Candidate preflight (placeholder detected before spawn) and corrupted
    // source (mangled UTF-8 before spawn) are both retryable: the model must
    // regenerate the candidate and retry, not finalize.
    if (code === "LEAN_CANDIDATE_PREFLIGHT_BLOCKED" || code === "LEAN_CODE_INVALID_UTF8") {
      return { failureClass: "candidate_preflight", terminalReason: null };
    }

    if (TARGET_IDENTITY_CODE.has(code)) {
      return { failureClass: "target_identity", terminalReason: null };
    }

    if (INFRASTRUCTURE_CODE.test(code)) {
      return { failureClass: "infrastructure", terminalReason: code };
    }
    return { failureClass: "contract", terminalReason: code };
  }

  // A transport/runtime error code can also arrive on a `failed` result.
  if (result.errorCode && INFRASTRUCTURE_CODE.test(String(result.errorCode))) {
    return { failureClass: "infrastructure", terminalReason: String(result.errorCode) };
  }

  // 6. timeout — repairable: narrow imports, cut automation, change strategy.
  if (result.status === "timeout" || result.timedOut === true) {
    return { failureClass: "timeout_repairable", terminalReason: null };
  }

  // 7..11. proof failures, separated by the reported diagnostics.
  const haystack = errorText(result);
  for (const [failureClass, pattern] of CLASS_PATTERNS) {
    if (pattern.test(haystack)) return { failureClass, terminalReason: null };
  }

  // 12. anything else that failed.
  return { failureClass: "proof_failure", terminalReason: null };
}

/**
 * Classify a finished Lean result into the orchestration decision the loop
 * consumes.
 *
 * @param {object} result - lean_result_v1 (already finalized)
 * @param {object} [context]
 * @param {string|null} [context.previousFingerprint] - Fingerprint of the
 *   previous failed attempt in the same proof task.
 * @param {number} [context.sameFailureCount] - How many times the previous
 *   fingerprint had already repeated before this result.
 * @param {number} [context.strategyChangeAfter] - Identical failures tolerated
 *   before a strategy change is demanded (default 2).
 * @param {string|null} [context.previousFailureClass] - Failure class of the
 *   previous failed attempt in the same proof task.
 * @param {number} [context.sameClassCount] - How many times the previous
 *   failure class had already repeated before this result.
 * @param {number} [context.attempt]
 * @param {number} [context.maxAttempts]
 * @returns {{ terminal: boolean, verified: boolean, retryable: boolean,
 *   failureClass: string|null, nextAction: string,
 *   strategyChangeRequired: boolean, diagnosticFingerprint: string|null,
 *   sameFailureCount: number, sameClassCount: number,
 *   terminalReason: string|null }}
 */
export function classifyLeanResult(result, context = {}) {
  if (!result || typeof result !== "object") {
    return {
      terminal: true,
      verified: false,
      retryable: false,
      failureClass: "infrastructure",
      nextAction: "publish_not_verified_infrastructure_block",
      strategyChangeRequired: false,
      diagnosticFingerprint: null,
      sameFailureCount: 0,
      sameClassCount: 0,
      terminalReason: "LEAN_RESULT_MISSING",
    };
  }

  // 0. A utility check that elaborated cleanly is terminal for that single
  //    utility request, but it is never a verified proof: utility results do
  //    not enter the authoritative proof path at all.
  if (
    result.taskMode === "utility" &&
    result.status === "checked" &&
    result.exitCode === 0 &&
    result.timedOut !== true &&
    result.cancelled !== true &&
    result.isError !== true
  ) {
    return {
      terminal: true,
      verified: false,
      retryable: false,
      failureClass: null,
      nextAction: "report_checked_utility_result",
      strategyChangeRequired: false,
      diagnosticFingerprint: null,
      sameFailureCount: 0,
      sameClassCount: 0,
      terminalReason: null,
      utilityChecked: true,
    };
  }

  // 1. checked + invariants → verified. This is the only path to a proof claim.
  if (isVerified(result)) {
    return {
      terminal: true,
      verified: true,
      retryable: false,
      failureClass: null,
      nextAction: "publish_verified_result",
      strategyChangeRequired: false,
      diagnosticFingerprint: null,
      sameFailureCount: 0,
      sameClassCount: 0,
      terminalReason: null,
    };
  }

  // A `checked` status that fails an invariant is not a proof, it is a broken
  // result. Never let it through as verified.
  if (result.status === "checked") {
    return {
      terminal: true,
      verified: false,
      retryable: false,
      failureClass: "infrastructure",
      nextAction: "publish_not_verified_infrastructure_block",
      strategyChangeRequired: false,
      diagnosticFingerprint: leanDiagnosticFingerprint(result),
      sameFailureCount: 0,
      sameClassCount: 0,
      terminalReason: "LEAN_CHECKED_INVARIANT_VIOLATION",
    };
  }

  const { failureClass, terminalReason } = classifyFailure(result);
  const terminal = LEAN_TERMINAL_CLASSES.includes(failureClass);
  const fingerprint = leanDiagnosticFingerprint(result);

  const strategyChangeAfter = Number.isInteger(context.strategyChangeAfter)
    ? context.strategyChangeAfter
    : 2;
  const repeated =
    !terminal && fingerprint !== null && fingerprint === (context.previousFingerprint ?? null);
  const sameFailureCount = repeated ? Number(context.sameFailureCount || 1) + 1 : 1;

  // A candidate_preflight block is a placeholder the model can simply delete;
  // it is not evidence that the proof approach is wrong, so it never counts
  // toward a forced strategy change (same carve-out the trackers apply).
  const classCounts = !terminal && failureClass !== "candidate_preflight";
  const classRepeated = classCounts && failureClass === (context.previousFailureClass ?? null);
  const sameClassCount = classRepeated ? Number(context.sameClassCount || 1) + 1 : 1;

  // One rung above the fingerprint rule: an identical failure is pathological
  // immediately, whereas the same class with genuinely different candidates
  // takes one more round before it stops being ordinary repair. Derived rather
  // than configured so there is no second budget to keep in sync with the C
  // header. ponytail: bump this to its own policy key only if tuning diverges.
  const classChangeAfter = strategyChangeAfter + 1;
  const fingerprintEscalates = repeated && sameFailureCount >= strategyChangeAfter;
  const classEscalates = classRepeated && sameClassCount >= classChangeAfter;
  const strategyChangeRequired = fingerprintEscalates || classEscalates;

  let nextAction;
  if (failureClass === "infrastructure") {
    nextAction = "publish_not_verified_infrastructure_block";
  } else if (failureClass === "user_cancelled") {
    nextAction = "publish_not_verified_cancelled";
  } else if (failureClass === "contract") {
    nextAction = GUIDANCE.contract;
  } else {
    let suffix = "";
    if (fingerprintEscalates) suffix = STRATEGY_CHANGE_SUFFIX;
    else if (classEscalates) suffix = CLASS_CHANGE_SUFFIX.replace("%CLASS%", failureClass);
    nextAction = GUIDANCE[failureClass] + suffix;
  }

  return {
    terminal,
    verified: false,
    retryable: !terminal,
    failureClass,
    nextAction,
    strategyChangeRequired,
    diagnosticFingerprint: fingerprint,
    sameFailureCount,
    sameClassCount,
    terminalReason,
  };
}

/** Human-readable guidance for a class, for prompts and UI copy. */
export function leanRepairGuidance(failureClass) {
  return GUIDANCE[failureClass] || GUIDANCE.proof_failure;
}
