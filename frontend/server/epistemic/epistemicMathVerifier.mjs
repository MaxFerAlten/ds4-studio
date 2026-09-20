/**
 * DS4 Quantum Fix — mathematical verification.
 *
 * QF-10 §32. The plan is explicit that this is not a second CAS: DS4 already
 * has an authoritative Sage path, and a verifier that re-derives arithmetic in
 * JavaScript would be one more thing asserting results without running them.
 * The job here is four steps — build a validation request, invoke the existing
 * Sage path, consume the structured result, produce a verification result.
 *
 * The contract §32 states:
 *   a non-trivial number is COMPUTED only if a tool execution exists;
 *   a derivation is DERIVED only if validation evidence exists.
 * Without Sage the answer is UNKNOWN and the claim stays a HYPOTHESIS. It is
 * never a result the model produced instead — that substitution is EPI-003,
 * where sqrt(124000000) = 11 reads as arithmetic because it is shaped like it.
 *
 * §20.1: none of this is wired into fast_math_guard.
 */

import { FAILURE_SEVERITY, SEVERITY } from "./epistemicContracts.mjs";
import { evidenceFromToolResult } from "./epistemicEvidence.mjs";
import { SUBCHECK_STATUS } from "./epistemicSubcheckAggregator.mjs";

export const MATH_VERDICT = Object.freeze({
  /** Sage ran and the equality holds. */
  VERIFIED: "VERIFIED",
  /** Sage ran and the equality does not hold. */
  REFUTED: "REFUTED",
  /** Nothing ran, or nothing legible came back. Not a verdict on the claim. */
  UNKNOWN: "UNKNOWN"
});

/** The marker the generated snippet prints, so the outcome is read, not parsed out of prose. */
export const MATH_CHECK_MARKER = "DS4_MATH_CHECK";

const MAX_SIDE_CHARS = 200;

/**
 * Characters a mathematical expression needs, and nothing else.
 *
 * The expression reaches a Sage process. It arrives from model output, which
 * arrives from a conversation, so it is untrusted input to a code execution
 * path — quotes, semicolons, newlines, backslashes and comments are absent
 * from this class on purpose. A newline is all it takes to start a statement,
 * so the whitespace allowed here is a space or a tab and nothing else.
 */
const SAFE_EXPRESSION = /^[0-9A-Za-z_+\-*/^().,!% \t[\]<>]+$/;

/** Identifiers with no place in an equality and every place in an exploit. */
const FORBIDDEN_IDENTIFIERS =
  /\b(import|exec|eval|open|os|sys|subprocess|system|popen|compile|globals|locals|getattr|setattr|delattr|input|file|exit|quit|reset|load|attach|save|preparse|sage_eval)\b|__/i;

/** Whether an expression may be placed into generated Sage code. */
export function isSafeExpression(text) {
  const expression = String(text ?? "").trim();
  return (
    expression.length > 0 &&
    expression.length <= MAX_SIDE_CHARS &&
    SAFE_EXPRESSION.test(expression) &&
    !FORBIDDEN_IDENTIFIERS.test(expression)
  );
}

/**
 * The two sides of an asserted equality, or null.
 *
 * Deliberately only handles `a = b`. A comparison, a range or a prose claim is
 * not something this verifier can turn into a Sage check, and returning null
 * is what makes the caller ask for a different verifier rather than get a
 * confident answer to a question that was never posed.
 */
export function parseEquality(text) {
  const content = String(text ?? "").replace(/\s+/g, " ").trim();
  // Skip ==, <=, >=, != so a comparison is not silently read as an assertion.
  const at = content.search(/(?<![=<>!])=(?!=)/);
  if (at < 0) return null;
  const lhs = content.slice(0, at).trim();
  const rhs = content.slice(at + 1).trim().replace(/[.;]+$/, "");
  return lhs && rhs ? { lhs, rhs } : null;
}

/**
 * Build the Sage validation request for one equality.
 *
 * task_type=validation and phase=validate are the existing Sage workflow's own
 * validation entry point (§32); output_mode=structured because the verdict is
 * read off the structured result, not off the transcript.
 */
export function buildValidationRequest({ lhs, rhs, timeoutSec = 60 } = {}) {
  if (!isSafeExpression(lhs) || !isSafeExpression(rhs)) return null;
  const code = [
    `_ds4_lhs = (${String(lhs).trim()})`,
    `_ds4_rhs = (${String(rhs).trim()})`,
    `_ds4_diff = simplify(_ds4_lhs - _ds4_rhs)`,
    `_ds4_ok = bool(_ds4_diff == 0)`,
    `print("${MATH_CHECK_MARKER}:", "PASS" if _ds4_ok else "FAIL")`,
    `print("DS4_MATH_LHS:", _ds4_lhs)`,
    `print("DS4_MATH_RHS:", _ds4_rhs)`,
    `print("DS4_MATH_DIFF:", _ds4_diff)`,
    `print("DS4_MATH_NUM:", N(_ds4_diff, digits=30))`
  ].join("\n");
  return { code, task_type: "validation", phase: "validate", output_mode: "structured", timeout_sec: timeoutSec };
}

function resultText(response) {
  const sage = response?.sageResult;
  return String(sage?.model?.content ?? response?.content ?? sage?.display?.summary ?? "");
}

/**
 * Read what the Sage run actually reports.
 *
 * `ran` needs the structured execution block to say so. A response without one
 * is a response we cannot read, and treating that as a successful run is the
 * exact shape QF-03 removed from the evidence path.
 */
export function readSageOutcome(response) {
  const sage = response?.sageResult ?? null;
  const execution = sage?.execution ?? null;
  const text = resultText(response);
  const marker = text.match(new RegExp(`${MATH_CHECK_MARKER}:\\s*(PASS|FAIL)`));
  return {
    ran:
      response?.isError !== true &&
      execution?.ok === true &&
      execution?.timedOut !== true &&
      sage?.status === "ok",
    status: sage?.status ?? null,
    state: sage?.state ?? null,
    exitCode: execution?.exitCode ?? null,
    timedOut: execution?.timedOut === true,
    runId: sage?.runId ?? response?.runId ?? null,
    outcome: marker ? marker[1] : null,
    text
  };
}

function verificationResult({ verdict, reason, kind, outcome = null, evidence = null, request = null }) {
  const failureCodes =
    verdict === MATH_VERDICT.REFUTED ? [kind === "symbolic" ? "F06" : "F05"] : [];
  // REM-014: real subchecks from the Sage run, never invented granularity. A
  // single equality is one atomic check, so a conclusive verdict yields exactly
  // one mandatory subcheck reflecting it; an inconclusive run carries no
  // subchecks (null) because claiming "all checks verified" then would be false.
  const subchecks =
    verdict === MATH_VERDICT.VERIFIED || verdict === MATH_VERDICT.REFUTED
      ? [
          {
            id: kind === "symbolic" ? "symbolic_identity_verification" : "arithmetic_computation_verification",
            mandatory: true,
            status:
              verdict === MATH_VERDICT.VERIFIED ? SUBCHECK_STATUS.PASSED : SUBCHECK_STATUS.FAILED
          }
        ]
      : null;
  return {
    verdict,
    failureCodes,
    severity: failureCodes.length ? FAILURE_SEVERITY[failureCodes[0]] : SEVERITY.NONE,
    // §32's contract in one field. Execution is what buys COMPUTED; validation
    // evidence is what buys DERIVED; absent either, the claim is a hypothesis
    // no matter how arithmetic it looks.
    maxEpistemicType:
      verdict === MATH_VERDICT.VERIFIED ? (kind === "symbolic" ? "DERIVED" : "COMPUTED") : "HYPOTHESIS",
    reason,
    kind,
    outcome,
    evidence,
    request,
    subchecks
  };
}

/**
 * Verify one asserted equality through the existing Sage path.
 *
 * @param {object} options
 * @param {object|string} [options.claim] - the claim, or its text; parsed for `a = b` when lhs/rhs are absent.
 * @param {string} [options.lhs]
 * @param {string} [options.rhs]
 * @param {"numeric"|"symbolic"} [options.kind]
 * @param {Function} [options.executeSage] - the Sage executor, e.g. a bound toolSage. Absent means Sage is unavailable.
 * @param {number} [options.timeoutSec]
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<{verdict: string, failureCodes: string[], severity: number, maxEpistemicType: string, reason: string, kind: string, outcome: object|null, evidence: object|null, request: object|null}>}
 */
export async function verifyMathClaim({
  claim,
  lhs,
  rhs,
  kind = "numeric",
  executeSage = null,
  timeoutSec = 60,
  signal
} = {}) {
  const claimText = String(typeof claim === "string" ? claim : (claim?.text ?? "")).trim();
  const sides = lhs && rhs ? { lhs, rhs } : parseEquality(claimText);
  const fail = (reason, extra = {}) =>
    verificationResult({ verdict: MATH_VERDICT.UNKNOWN, reason, kind, ...extra });

  if (!sides) return fail("no asserted equality to check");

  const request = buildValidationRequest({ lhs: sides.lhs, rhs: sides.rhs, timeoutSec });
  if (!request) {
    // Refusing to build the request is the point: the expression would be
    // executed, and an unreadable one is not worth the execution path.
    return fail("the expression is not a plain mathematical equality and was not sent to Sage");
  }

  if (typeof executeSage !== "function") {
    // §32's fallback. Not "the model checked it": nothing checked it.
    return fail("Sage is not available; the arithmetic is unverified", { request });
  }

  let response;
  try {
    response = await executeSage(request, { signal });
  } catch (err) {
    return fail(`Sage execution failed: ${String(err?.message ?? err)}`, { request });
  }

  const outcome = readSageOutcome(response);
  const evidence = evidenceFromToolResult({
    toolName: "sage",
    callId: outcome.runId ?? "",
    arguments: request,
    rawResult: response
  });

  if (!outcome.ran) {
    return fail(
      outcome.timedOut
        ? "Sage timed out; the arithmetic is unverified"
        : "Sage returned no structured execution status; the arithmetic is unverified",
      { outcome, evidence, request }
    );
  }
  if (!outcome.outcome) {
    return fail("Sage ran but reported no check result", { outcome, evidence, request });
  }

  return verificationResult({
    verdict: outcome.outcome === "PASS" ? MATH_VERDICT.VERIFIED : MATH_VERDICT.REFUTED,
    reason:
      outcome.outcome === "PASS"
        ? "Sage evaluated the difference to zero"
        : "Sage evaluated the difference to a non-zero value",
    kind,
    outcome,
    evidence,
    request
  });
}
