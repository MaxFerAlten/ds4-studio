import { taskContractInstruction } from "./taskContract.mjs";
const TOOL_VERIFIER = Object.freeze({ sage: "sage", lean_check: "lean", lean_prepare: "lean", lean_inspect: "lean" });
const TOOL_NAMES = Object.freeze({
  sage: Object.freeze(["sage"]),
  lean: Object.freeze(["lean_prepare", "lean_inspect", "lean_check"])
});
const TOOL_TO_VERIFIER = Object.freeze({ sage: "sage", lean_check: "lean" });

const VERIFIER_ORDER = Object.freeze(["sage", "lean"]);

/** For the answer itself: the final prompt, and a tool evaluation answered without a verification plan. */
export const CONVENTION_CHECK_INSTRUCTION = "When the question offers alternatives, answer under the standard convention of the field and state it. An alternative equal to the reference with its terms listed in reverse order, or with its index shifted, is correct under exactly that rearrangement of the convention, whether a tool or your own check on the smallest instance finds it. For each alternative you reject, state the reading under which it would be correct (or that none exists), checked on the smallest instance where the alternatives take different values, and whether a symbol or word of the question itself excludes that reading. Name as the convention the answer depends on exactly a reading the question does not exclude that would select a different alternative; if none remains, say the notation fixes the answer.";

/**
 * Server-owned state for an LLM-classified mathematical verification request.
 * Tool trackers still own verifier semantics; this object only serializes the
 * two workflows and records dispatch/result receipts.
 */
export class AuthoritativeVerificationPlan {
  constructor({ requiredTools = ["sage", "lean_check"], sageAvailable = true, leanAvailable = true, maxMissingCallNudges = 2, taskContract = null } = {}) {
    this.taskContract = taskContract;
    const selected = new Set(Array.isArray(requiredTools) ? requiredTools : []);
    this.required = VERIFIER_ORDER.filter((name) => selected.has(name === "sage" ? "sage" : "lean_check"));
    if (!this.required.length) throw new TypeError("VERIFICATION_PLAN_REQUIRES_A_TOOL");
    this.verifiers = {
      sage: !selected.has("sage")
        ? { status: "not_requested", code: null }
        : { status: sageAvailable ? "pending" : "not_verified", code: sageAvailable ? null : "SAGE_TOOL_UNAVAILABLE" },
      lean: !selected.has("lean_check")
        ? { status: "not_requested", code: null }
        : { status: leanAvailable ? "pending" : "not_verified", code: leanAvailable ? null : "LEAN_TOOL_UNAVAILABLE" }
    };
    this.maxMissingCallNudges = Math.max(0, Number(maxMissingCallNudges) || 0);
    this.missingCallNudges = { sage: 0, lean: 0 };
    this.receipts = [];
    this.leanGoal = { prepared: false };
    this.activeVerifier = this.#nextPending();
  }

  #nextPending() {
    return this.required.find((name) => this.verifiers[name]?.status === "pending") ?? null;
  }

  #advanceIfComplete(name) {
    if (this.activeVerifier === name && this.verifiers[name].status !== "pending" &&
        this.verifiers[name].status !== "running") {
      this.activeVerifier = this.#nextPending();
    }
  }

  get complete() {
    return this.required.every((name) =>
      this.verifiers[name].status === "verified" || this.verifiers[name].status === "not_verified");
  }

  get allowedTools() {
    if (this.activeVerifier === "lean") {
      return this.leanGoal.prepared ? ["lean_check", "lean_inspect"] : ["lean_prepare", "lean_inspect"];
    }
    return this.activeVerifier ? [...TOOL_NAMES[this.activeVerifier]] : [];
  }

  get contextTools() {
    return this.activeVerifier ? [...TOOL_NAMES[this.activeVerifier]] : [];
  }

  recordLeanPreparation(spec) {
    if (this.activeVerifier !== "lean" || this.leanGoal.prepared || !spec?.sealed || !spec?.targetStatementSha256) return false;
    this.leanGoal = { prepared: true, targetDeclaration: spec.targetDeclaration,
      targetStatement: spec.targetStatementText, profile: spec.requiredProfile,
      targetStatementSha256: spec.targetStatementSha256 };
    return true;
  }

  get catalogTools() {
    return this.required.flatMap((name) => TOOL_NAMES[name]);
  }

  snapshot() {
    return {
      required: [...this.required],
      activeVerifier: this.activeVerifier,
      complete: this.complete,
      leanGoal: { ...this.leanGoal },
      verifiers: {
        sage: { ...this.verifiers.sage },
        lean: { ...this.verifiers.lean }
      },
      receipts: this.receipts.map((receipt) => ({ ...receipt }))
    };
  }

  allowsToolBatch(toolCalls = []) {
    if (this.complete) return { allowed: false, code: "VERIFICATION_PLAN_COMPLETE" };
    const active = new Set(this.allowedTools);
    const wrong = toolCalls.filter((call) => !active.has(call?.name));
    if (wrong.length) {
      return {
        allowed: false,
        code: this.activeVerifier === "lean" && toolCalls.length === 1 && wrong[0]?.name === "lean_check"
          ? "LEAN_GOAL_NOT_PREPARED"
          : this.activeVerifier === "lean" && toolCalls.length === 1 && wrong[0]?.name === "lean_prepare" && this.leanGoal.prepared
          ? "LEAN_GOAL_ALREADY_PREPARED" : "VERIFICATION_TOOL_OUT_OF_ORDER",
        activeVerifier: this.activeVerifier,
        blockedTools: wrong.map((call) => call?.name).filter(Boolean)
      };
    }
    if (toolCalls.some((call) => call?.name === "sage") && toolCalls.length !== 1) {
      return {
        allowed: false,
        code: "SAGE_MIXED_TOOL_BLOCK_FORBIDDEN",
        activeVerifier: this.activeVerifier,
        blockedTools: toolCalls.map((call) => call?.name).filter(Boolean)
      };
    }
    if (toolCalls.length !== 1) {
      return {
        allowed: false,
        code: "VERIFICATION_PARALLEL_TOOL_CALLS_FORBIDDEN",
        activeVerifier: this.activeVerifier,
        blockedTools: toolCalls.map((call) => call?.name).filter(Boolean)
      };
    }
    return { allowed: true, activeVerifier: this.activeVerifier };
  }

  recordDispatch({ callId, toolName }) {
    const verifier = TOOL_VERIFIER[toolName];
    if (!verifier || verifier !== this.activeVerifier || this.complete || !this.allowedTools.includes(toolName)) return false;
    if (this.verifiers[verifier].status === "pending") this.verifiers[verifier].status = "running";
    this.receipts.push({ callId: String(callId), verifier, toolName, state: "dispatched" });
    return true;
  }

  recordResult({ callId, isError = false, guarded = false, code = null } = {}) {
    const receipt = [...this.receipts].reverse().find((item) => item.callId === String(callId));
    if (!receipt) return false;
    receipt.state = guarded ? "blocked" : isError ? "error" : "result_received";
    if (code) receipt.code = String(code);
    return true;
  }

  recordBlocked({ callId, toolName, code }) {
    this.receipts.push({
      callId: String(callId),
      verifier: TOOL_VERIFIER[toolName] || null,
      toolName,
      state: "blocked",
      code: String(code || "TOOL_BLOCKED")
    });
  }

  sageRepeatedFailureLimitReached(maxSameFailure = 2) {
    const failedCalls = new Set(this.receipts
      .filter((receipt) => receipt.verifier === "sage" && receipt.state === "error")
      .map((receipt) => receipt.callId));
    // Permit one changed-strategy retry after the tracker asks for it. If that
    // retry still fails, hand control to Lean instead of spending Sage's much
    // larger standalone wall-clock budget inside a dual-verifier turn.
    return failedCalls.size >= Math.max(2, Number(maxSameFailure) || 2) + 1;
  }

  finishVerifier(name, status, code = null) {
    if (!this.required.includes(name) || !["verified", "not_verified"].includes(status)) return false;
    const current = this.verifiers[name];
    if (current.status === "verified") return true;
    current.status = status;
    current.code = code ? String(code) : null;
    this.#advanceIfComplete(name);
    return true;
  }

  finalizationDecision() {
    return this.#missingCallDecision();
  }

  blockedCallDecision() {
    return this.#missingCallDecision();
  }

  #missingCallDecision() {
    if (this.complete) return { action: "allow" };
    const verifier = this.activeVerifier;
    if (!verifier) return { action: "allow" };
    this.missingCallNudges[verifier]++;
    if (this.missingCallNudges[verifier] <= this.maxMissingCallNudges) {
      return { action: "continue", verifier, code: "VERIFICATION_CALL_REQUIRED" };
    }
    this.finishVerifier(verifier, "not_verified", `${verifier.toUpperCase()}_CALL_NOT_COMPLETED`);
    return {
      action: "continue",
      verifier,
      code: `${verifier.toUpperCase()}_CALL_NOT_COMPLETED`,
      advanced: true,
      complete: this.complete,
      activeVerifier: this.activeVerifier
    };
  }

  promptForActiveVerifier() {
    if (this.complete) return this.finalPrompt();
    const verifier = this.activeVerifier;
    const reminder = this.missingCallNudges[verifier] > 0
      ? " VERIFICATION_CALL_REQUIRED: the active verifier still needs an actual server-side tool call/result; blocked calls are not executions."
      : "";
    const scope = ` Independently challenge the previous answer against the original problem. Preserve the hypotheses, quantifiers, indexing and ordering. Do not define the desired answer as the expected value and then compare it with itself. An aggregate identity or finite examples do not by themselves verify an indexed claim or a general theorem. Before formalizing, evaluate the answer and each competing alternative on the smallest instance where they take different values and report those values; if that instance contradicts the answer, correct the answer first. Compute the reference under the standard convention of the field and say which convention that is; for an indexed object, print each alternative's values at every index and whether that list equals the reference, the reference reversed, or the reference shifted by one index.`;
    if (verifier === "sage") {
      return `VERIFICATION_PLAN: The user requested SageMath${this.required.includes("lean") ? " and Lean 4" : ""}. Run SageMath now using only the sage tool, one call at a time. Complete its required phases; do not produce the final answer yet.${this.required.includes("lean") ? " The server will then enable Lean 4." : ""}${scope}${reminder}`;
    }
    if (verifier === "lean") {
      const next = this.leanGoal.prepared
        ? `The goal has passed typechecking and semantic review and is locked: ${this.leanGoal.targetStatement}. Call lean_check task_mode=proof to prove this exact target; change only imports, helper lemmas or the proof body.`
        : "Before writing a proof, call lean_prepare with the original claim, narrow imports and a complete theorem header with all variables explicitly typed. It validates syntax, types and correspondence to the original question before locking the target. Do not send proof code or placeholders at this stage.";
      return `VERIFICATION_PLAN: SageMath is complete or unavailable. Now verify the original mathematical claim with Lean 4. ${next} Use lean_inspect to discover uncertain symbol signatures before guessing a lemma. It is optional discovery and never proves the claim. Call one Lean tool at a time; never call SageMath during this phase. Never submit sorry/admit or a proof skeleton to lean_check. A terminal runtime failure must be reported as NOT_VERIFIED without retrying. Do not produce the final answer until the Lean result is terminal.` + scope + reminder;
    }
    return "";
  }

  finalPrompt() {
    const sage = this.verifiers.sage;
    const lean = this.verifiers.lean;
    // Named as run in this turn: once the tool results are compacted away, the
    // model otherwise reads its own verifier as a result from earlier turns.
    const ran = (verifier) => this.receipts.some((receipt) => receipt.verifier === verifier && receipt.state === "result_received");
    const render = (name, result, verifier) =>
      `${name}: ${result.status.toUpperCase()}${result.code ? ` (${result.code})` : ""}${ran(verifier) ? " — executed in this turn" : ""}`;
    return [
      "VERIFICATION_PLAN_COMPLETE: All model-selected verifier workflows have reached a terminal state.",
      ...(this.required.includes("sage") ? [render("SageMath", sage, "sage")] : []),
      ...(this.required.includes("lean") ? [render("Lean 4", lean, "lean")] : []),
      ...(this.required.includes("lean") && lean.status === "verified" && this.leanGoal.prepared
        ? [`Lean verified exactly this statement: ${this.leanGoal.targetStatement}. Say what it establishes and whether it singles out the answer against the alternatives; do not call the answer itself formally verified unless it does.`]
        : []),
      "The server appends the status of each verifier under your answer: do not write status lines or a verification summary of your own. Use these results only in the mathematical analysis, and never present NOT_VERIFIED as success.",
      "Never attribute a result to a tool that is not listed above as run in this turn.",
      CONVENTION_CHECK_INSTRUCTION,
      ...(taskContractInstruction(this.taskContract) ? [taskContractInstruction(this.taskContract)] : []),
      "Write the final answer directly in the language of the user's question, starting with the answer: do not narrate your plan or restate these instructions."
    ].join("\n");
  }

  /**
   * The status block appended under the final answer. Written by the server
   * from the plan and its receipts, so the model cannot misreport a verifier.
   */
  verificationReport(extraLines = []) {
    const labels = { verified: "VERIFICATO", not_verified: "NON VERIFICATO" };
    const ran = (verifier) => this.receipts.some((receipt) => receipt.verifier === verifier && receipt.state === "result_received");
    const line = (name, verifier) => {
      const result = this.verifiers[verifier];
      return `- ${name}: ${labels[result.status] || "NON CONCLUSO"}${result.code ? ` (${result.code})` : ""}` +
        (ran(verifier) ? " — eseguito in questo turno" : "");
    };
    const lean = this.verifiers.lean;
    return [
      "\n\n---\n\n**Verifica (DS4 Studio)**\n",
      ...(this.required.includes("sage") ? [line("SageMath", "sage")] : []),
      ...(this.required.includes("lean") ? [line("Lean 4", "lean")] : []),
      ...(this.required.includes("lean") && lean.status === "verified" && this.leanGoal.prepared
        ? [`- Enunciato dimostrato da Lean: \`${this.leanGoal.targetStatement}\``]
        : []),
      ...extraLines
    ].join("\n");
  }

  evidenceText() {
    return JSON.stringify(this.snapshot());
  }
}

export function createAuthoritativeVerificationPlan(options = {}) {
  const tools = options.requiredTools ?? [];
  if (!options.verificationRequested || !Array.isArray(tools) || tools.length === 0) return null;
  return new AuthoritativeVerificationPlan({ ...options, requiredTools: tools });
}
