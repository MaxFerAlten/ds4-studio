/**
 * Authoritative tool gate.
 *
 * A domain tracker (Lean, Sage) owns the verdict for its task.  Once it is
 * terminal the turn may still speak, but it may not act: no lean_check, no
 * crawl, no web search, no file or shell tool for that task.
 *
 * This is deliberately separate from authoritativeFinalizationGate, which
 * answers a different question:
 *
 *   authoritativeFinalizationGate -> may this PROSE be published?
 *   authoritativeToolGate         -> may this TOOL be executed?
 *
 * It is also deliberately tool-agnostic.  The transcript this gate exists for
 * shows a model that, told lean_check was over, reached for crawl instead: a
 * per-tool block only moves the model down its list of tools.
 */

const ALLOWED = Object.freeze({
  allowed: true,
  terminal: false,
  code: "AUTHORITATIVE_NOT_ACTIVE",
  finishReason: null,
  action: "execute",
  blockedTools: [],
});

function namesOf(toolCalls) {
  return (Array.isArray(toolCalls) ? toolCalls : [])
    .map((call) => call?.name)
    .filter((name) => typeof name === "string" && name.length > 0);
}

/**
 * @returns {{allowed: boolean, terminal: boolean, code: string,
 *            finishReason: string|null, action: string, blockedTools: string[]}}
 */
export function evaluateAuthoritativeToolCalls({
  leanSnapshot,
  sageSnapshot,
  verificationPlan,
  toolCalls,
} = {}) {
  const calls = namesOf(toolCalls);
  if (calls.length === 0) return ALLOWED;

  // Explicit dual-verifier requests have their own ordered plan. Its gate
  // admits only the active verifier, allowing the second backend to run after
  // the first reaches a terminal result without weakening single-tool turns.
  if (verificationPlan) {
    const decision = verificationPlan.allowsToolBatch(toolCalls);
    if (!decision.allowed) {
      return {
        allowed: false,
        terminal: false,
        code: decision.code,
        finishReason: null,
        action: "retry_ordered_verifier",
        blockedTools: decision.blockedTools || calls,
        activeVerifier: decision.activeVerifier || verificationPlan.activeVerifier
      };
    }
    return ALLOWED;
  }

  const lean = leanSnapshot || {};
  const sage = sageSnapshot || {};
  const leanUsed = Boolean(lean.proofId);
  const sageUsed = Boolean(sage.runId);

  // Two authoritative domains in one turn: neither can be trusted to own the
  // verdict, so nothing runs rather than picking one.
  if (leanUsed && sageUsed) {
    return {
      allowed: false,
      terminal: true,
      code: "AUTHORITATIVE_MODE_CONFLICT",
      finishReason: "authoritative_conflict",
      action: "publish_terminal",
      blockedTools: calls,
    };
  }

  if (leanUsed && lean.terminal) {
    return {
      allowed: false,
      terminal: true,
      code: "LEAN_FINALIZATION_ONLY",
      finishReason: lean.verified ? "lean_verified" : "lean_not_verified",
      action: "publish_terminal",
      blockedTools: calls,
    };
  }

  if (sageUsed && sage.terminal) {
    return {
      allowed: false,
      terminal: true,
      code: "SAGE_FINALIZATION_ONLY",
      finishReason: sage.publishable ? "sage_ready" : "sage_not_publishable",
      action: "publish_terminal",
      blockedTools: calls,
    };
  }

  return ALLOWED;
}

/** What the model is told when its tool call was discarded. */
export function authoritativeToolBlockGuidance(decision = {}) {
  switch (decision.code) {
    case "LEAN_FINALIZATION_ONLY":
      return (
        "LEAN_FINALIZATION_ONLY: the Lean task for this turn is terminal. " +
        "No lean_check, no crawl, no web search, no file or shell tool may run " +
        "for it. Publish the terminal result only."
      );
    case "SAGE_FINALIZATION_ONLY":
      return (
        "SAGE_FINALIZATION_ONLY: the Sage run for this turn is terminal. " +
        "No further tool may run for it. Publish the terminal result only."
      );
    case "AUTHORITATIVE_MODE_CONFLICT":
      return (
        "AUTHORITATIVE_MODE_CONFLICT: two authoritative backends were used in " +
        "one turn, so neither owns the verdict. The turn is stopped."
      );
    case "VERIFICATION_TOOL_OUT_OF_ORDER":
      return `VERIFICATION_TOOL_OUT_OF_ORDER: the active verifier is ${decision.activeVerifier || "none"}. Do not call another verifier or unrelated tool in this batch; call only the active verifier shown in the verification plan.`;
    case "LEAN_GOAL_NOT_PREPARED":
      return "LEAN_GOAL_NOT_PREPARED: use lean_prepare to validate the theorem header against the original question before submitting a proof. lean_inspect is available for symbol signatures.";
    case "LEAN_GOAL_ALREADY_PREPARED":
      return "LEAN_GOAL_ALREADY_PREPARED: the approved target is locked. Use lean_check for its proof or lean_inspect for signatures; do not replace the target.";
    case "VERIFICATION_PLAN_COMPLETE":
      return "VERIFICATION_PLAN_COMPLETE: all requested verifiers have terminal results. Do not call more tools; report each verifier's recorded status.";
    case "SAGE_MIXED_TOOL_BLOCK_FORBIDDEN":
      return "SAGE_MIXED_TOOL_BLOCK_FORBIDDEN: Sage must be called alone. Retry only the sage tool, then continue with the next verifier after Sage completes.";
    default:
      return "";
  }
}
