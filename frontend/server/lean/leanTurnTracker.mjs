// Per-turn Lean proof state for the /api/agent/chat path.
//
// Same contract the native orchestrator enforces: a plain-text answer is only
// publishable once the runtime said status=checked, or once a terminal
// non-verification reason exists. A retryable failure is not an ending — the
// model must repair and call lean_check again inside the same user turn.

import { createHash } from "crypto";

import { createLeanProofId } from "./leanPaths.mjs";
import { LEAN_ORCHESTRATION_DEFAULTS } from "./leanOrchestrationConfig.mjs";
import { classifyLeanResult } from "./leanRepairPolicy.mjs";
import { assertLeanTaskSpecUnchanged } from "./leanTaskSpec.mjs";

/** States that end the proof task, one way or another. */
const TERMINAL_STATES = Object.freeze([
  "verified",
  "infrastructure_block",
  "contract_block",
  "budget_exhausted",
  "cancelled",
]);

/** States that mean "another lean_check is owed". */
const CONTINUE_STATES = Object.freeze(["checking", "repair_required", "strategy_change_required"]);

export function sha256Hex(value) {
  return createHash("sha256").update(String(value ?? "")).digest("hex");
}

// F3.3 — "minimal check first, pedagogical enrichment second". A first
// candidate padded with prose, LaTeX and worked examples is not a smaller
// question asked first; it is the whole essay handed to the elaborator, and
// every failure it produces is ambiguous about which part failed.
// The ratio is the signal doc6 actually observed, not the line count on its
// own: a long proof is fine, a long *explanation* submitted as a proof is not.
// ponytail: tune these two if real candidates trip it — they are deliberately
// generous, so tripping means genuinely mostly-prose.
const MINIMAL_CANDIDATE_MIN_LINES = 25;
const MINIMAL_CANDIDATE_MAX_COMMENT_RATIO = 0.5;

/**
 * Split a Lean source into code and comment lines. Block comments (`/- … -/`)
 * and line comments (`--`) both count as commentary.
 *
 * @param {string} text
 * @returns {{ total: number, comment: number, code: number, ratio: number }}
 */
export function leanCommentProfile(text) {
  const lines = String(text ?? "").split("\n");
  let comment = 0;
  let code = 0;
  let inBlock = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (line === "") continue;
    if (inBlock) {
      comment += 1;
      if (line.includes("-/")) inBlock = false;
      continue;
    }
    if (line.startsWith("/-")) {
      comment += 1;
      if (!line.includes("-/")) inBlock = true;
      continue;
    }
    if (line.startsWith("--")) {
      comment += 1;
      continue;
    }
    code += 1;
  }
  const total = comment + code;
  return { total, comment, code, ratio: total === 0 ? 0 : comment / total };
}

/** Whitespace-insensitive form, so reflowing a fence is not a mismatch. */
function normalizeSource(text) {
  return String(text ?? "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\s+$/, ""))
    .join("\n")
    .trim();
}

/**
 * Does the published answer show the source that was actually verified?
 *
 * A verified claim next to a different candidate is the same lie as a verified
 * claim with no run behind it, so the two are checked apart: the run proves the
 * source elaborated, this proves the answer is about that source.
 *
 * @param {object} input
 * @param {string} input.answerText - The assistant's final message
 * @param {string|null} input.verifiedSource - The exact source that returned checked
 * @param {boolean} [input.requireSource=true] - Require the checked source in a fence
 * @returns {boolean}
 */
export function leanAnswerMatchesVerifiedSource({
  answerText,
  verifiedSource,
  requireSource = true,
} = {}) {
  return leanPublishedSourceAudit({ answerText, verifiedSource, requireSource }).matches;
}

/**
 * The same comparison, with the digests the audit trail has to carry (§17/§50).
 *
 * Comparison is on the normalized source rather than the raw bytes because a
 * fence legitimately differs in trailing whitespace; the digests are of that
 * same normalized form, so a published/retained mismatch is always visible as
 * two different hashes rather than as a bare false.
 *
 * @returns {{ matches: boolean, retainedSourceSha256: string|null,
 *   publishedSourceSha256: string|null, fenceCount: number }}
 */
export function leanPublishedSourceAudit({
  answerText,
  verifiedSource,
  requireSource = true,
} = {}) {
  const retained = verifiedSource ? normalizeSource(verifiedSource) : null;
  const retainedSourceSha256 = retained === null ? null : sha256Hex(retained);
  const fences = [...String(answerText ?? "").matchAll(/```(?:lean4?)?\s*\n([\s\S]*?)```/gi)].map(
    (m) => normalizeSource(m[1])
  );

  if (retained === null) {
    return { matches: false, retainedSourceSha256, publishedSourceSha256: null, fenceCount: fences.length };
  }
  if (fences.length === 0) {
    return { matches: !requireSource, retainedSourceSha256, publishedSourceSha256: null, fenceCount: 0 };
  }

  const published = fences.find((fence) => fence === retained) ?? fences[fences.length - 1];
  return {
    matches: fences.some((fence) => fence === retained),
    retainedSourceSha256,
    publishedSourceSha256: sha256Hex(published),
    fenceCount: fences.length,
  };
}

export class LeanTurnTracker {
  /**
   * @param {object} [config] - Resolved orchestration budget
   *   (leanOrchestrationConfig.resolveLeanOrchestrationConfig output).
   * @param {function} [now] - Clock, injectable for tests.
   */
  constructor(config = LEAN_ORCHESTRATION_DEFAULTS, now = Date.now) {
    this.config = {
      maxAttempts: config?.maxAttempts ?? LEAN_ORCHESTRATION_DEFAULTS.maxAttempts,
      maxSameFailure: config?.maxSameFailure ?? LEAN_ORCHESTRATION_DEFAULTS.maxSameFailure,
      maxPrematureFinalizations:
        config?.maxPrematureFinalizations ?? LEAN_ORCHESTRATION_DEFAULTS.maxPrematureFinalizations,
      maxWallClockMs: config?.maxWallClockMs ?? LEAN_ORCHESTRATION_DEFAULTS.maxWallClockMs,
      strategyChangeAfter:
        config?.strategyChangeAfter ?? LEAN_ORCHESTRATION_DEFAULTS.strategyChangeAfter,
      enabled: config?.enabled !== false,
    };
    this.now = now;
    this.pendingSource = null;
    this.reset();
  }

  reset() {
    this.pendingSource = null;
    this.proofId = null;
    this.state = "idle";
    this.attempts = 0;
    this.startedAt = null;
    this.lastFailureClass = null;
    this.lastFingerprint = null;
    this.sameFailureCount = 0;
    this.sameClassCount = 0;
    this.strategyGeneration = 0;
    this.prematureFinalizations = 0;
    this.lastSourceSha256 = null;
    this.lastSource = null;
    this.unchangedSourceRejections = 0;
    this.checkedSourceSha256 = null;
    this.checkedSource = null;
    this.checkedRunId = null;
    // Proof-task identity (WP05): statement-based, not name-based. The Node
    // executor computes the canonical statement hash; the tracker locks it on
    // the first useful result and never overwrites it afterwards.
    // §11 — when a sealed spec exists the target statement comes from it, not
    // from whatever the first candidate happened to declare.
    this.taskSpec = null;
    this.targetDeclaration = null;
    this.targetStatementSha256 = null;
    this.targetIdentityAlgorithm = null;
    this.checkedTargetStatementSha256 = null;
    this.targetIdentityMatched = false;
    this.profile = null;
    this.checkedProfile = null;
    // F3.2 — normalized hashes of workspace bytes this turn merely *read*.
    // A candidate the model found on disk is its own earlier output far more
    // often than it is prior knowledge, and it must not inherit the authority
    // of pinned Mathlib, lean_inspect output or a checked artifact.
    this.untrustedSources = new Set();
    this.terminalReason = null;
    this.nextAction = "";
    this.strategyChangeRequired = false;
    return this.snapshot();
  }

  /**
   * Start (or reuse) the proof task this turn is working on.
   *
   * A proof task owns a locked target declaration and a locked profile from
   * its first begin. A second begin naming a different target or profile is a
   * refusal, never a silent continuation: the loop must either resume the same
   * proof task or start a genuinely new turn.
   */
  begin({ proofId, targetDeclaration, profile, taskSpec } = {}) {
    if (this.proofId) {
      if (
        targetDeclaration !== undefined &&
        targetDeclaration !== null &&
        targetDeclaration !== this.targetDeclaration
      ) {
        return {
          allowed: false,
          code: "LEAN_TARGET_DECLARATION_MISMATCH",
          reason: `This proof task is locked on target "${this.targetDeclaration}". Start a new proof task to prove "${targetDeclaration}".`,
          ...this.snapshot(),
        };
      }
      if (profile !== undefined && profile !== null && profile !== this.profile) {
        return {
          allowed: false,
          code: "LEAN_PROFILE_CHANGED_WITHIN_PROOF",
          reason: `This proof task is locked on profile "${this.profile}". Restarting under "${profile}" would compare proofs across different elaboration contexts.`,
          ...this.snapshot(),
        };
      }
      // §60 — a sealed spec may not be swapped mid-task either.
      if (this.taskSpec) {
        const drift = assertLeanTaskSpecUnchanged(this.taskSpec, {
          targetDeclaration,
          requiredProfile: profile,
        });
        if (!drift.ok) {
          return { allowed: false, code: drift.error.code, reason: drift.error.message, ...this.snapshot() };
        }
      }
      return { allowed: true, ...this.snapshot() };
    }
    // Fail closed: a proof tracker without an explicit target declaration has
    // nothing to lock, and an unnamed probe must not become the task identity.
    if (!targetDeclaration) {
      return {
        allowed: false,
        code: "LEAN_TARGET_DECLARATION_REQUIRED",
        reason: "A proof task must declare the theorem/lemma it is trying to prove.",
        ...this.snapshot(),
      };
    }
    this.reset();
    this.proofId = proofId || createLeanProofId();
    this.targetDeclaration = String(targetDeclaration);
    this.profile = profile || null;
    // §11.2 — seal the target statement before any candidate runs. Without a
    // spec the tracker falls back to locking on the first result, which cannot
    // tell an honest first candidate from one that redefined the task.
    if (taskSpec?.sealed) {
      this.taskSpec = taskSpec;
      this.targetStatementSha256 = taskSpec.targetStatementSha256;
      this.targetIdentityAlgorithm = taskSpec.targetIdentityAlgorithm;
      if (!this.profile) this.profile = taskSpec.requiredProfile;
    }
    this.startedAt = this.now();
    this.state = "checking";
    return { allowed: true, ...this.snapshot() };
  }

  /** True while the proof is used but not finished. */
  get used() {
    return this.proofId !== null;
  }

  /**
   * Gate one lean_check attempt before it is spawned.
   *
   * @param {{ sourceSha256?: string, code?: string, allowUnchangedSource?: boolean,
   *   targetDeclaration?: string, profile?: string }} input
   * @returns {{ allowed: boolean, code?: string, reason?: string, ...snapshot }}
   */
  beforeAttempt({
    sourceSha256,
    code,
    allowUnchangedSource = false,
    targetDeclaration,
    profile,
  } = {}) {
    if (!this.proofId) {
      const began = this.begin({ targetDeclaration, profile });
      if (!began.allowed) return began;
    } else {
      // Identity gates run before any attempt is spent: a retry that renames
      // the target or swaps the profile is not a repair of this proof task.
      const identityRefusal = this.#taskIdentityRefusal(targetDeclaration, profile);
      if (identityRefusal) return identityRefusal;
    }
    const sha = sourceSha256 || (code === undefined ? null : sha256Hex(code));
    if (code !== undefined) this.pendingSource = code;

    if (TERMINAL_STATES.includes(this.state)) {
      return {
        allowed: false,
        code: "LEAN_PROOF_ALREADY_TERMINAL",
        reason: `The proof task is already terminal (${this.state}).`,
        ...this.snapshot(),
      };
    }

    if (this.attempts >= this.config.maxAttempts) {
      this.#terminate("budget_exhausted", "BUDGET_EXHAUSTED");
      return {
        allowed: false,
        code: "LEAN_ATTEMPT_BUDGET_EXHAUSTED",
        reason: `The ${this.config.maxAttempts}-attempt budget for this proof is spent.`,
        ...this.snapshot(),
      };
    }

    if (this.#wallClockExpired()) {
      this.#terminate("budget_exhausted", "WALL_CLOCK_EXHAUSTED");
      return {
        allowed: false,
        code: "LEAN_WALL_CLOCK_EXHAUSTED",
        reason: `The proof exceeded its ${this.config.maxWallClockMs}ms wall-clock budget.`,
        ...this.snapshot(),
      };
    }

    // Resending byte-identical source after a failure burns an attempt to learn
    // something already known. The exception is an explicitly authorized retry
    // of a transient infrastructure fault, where the source was never the
    // problem (§8.6).
    if (
      sha &&
      this.lastSourceSha256 === sha &&
      this.attempts > 0 &&
      this.state !== "verified" &&
      !allowUnchangedSource
    ) {
      // A refusal costs no attempt, so on its own it would let a stubborn model
      // resend the same bytes forever. Bound it with the same budget that bounds
      // premature finalizations, and end the turn as NOT_VERIFIED rather than
      // letting the outer iteration cap produce a generic error.
      this.unchangedSourceRejections += 1;
      if (this.unchangedSourceRejections > this.config.maxPrematureFinalizations) {
        this.#terminate("budget_exhausted", "SOURCE_UNCHANGED_BUDGET_EXHAUSTED");
        return {
          allowed: false,
          code: "LEAN_SOURCE_UNCHANGED_BUDGET_EXHAUSTED",
          reason:
            "The same unmodified source was submitted too many times. The proof task ends NOT_VERIFIED.",
          ...this.snapshot(),
        };
      }
      return {
        allowed: false,
        code: "LEAN_SOURCE_UNCHANGED_AFTER_FAILURE",
        reason:
          "The source is byte-identical to the attempt that just failed. Repair it before calling lean_check again.",
        ...this.snapshot(),
      };
    }

    this.attempts += 1;
    this.unchangedSourceRejections = 0;
    if (this.startedAt === null) this.startedAt = this.now();
    this.lastSourceSha256 = sha;
    this.lastSource = this.pendingSource ?? null;
    this.state = "checking";
    return { allowed: true, ...this.snapshot() };
  }

  /**
   * Fold a finished lean_result_v1 into the turn state.
   *
   * The classification is recomputed here from the result itself rather than
   * trusted from the wire, so a result that never went through
   * finalizeLeanResult still lands in the right state.
   *
   * @param {object} result - lean_result_v1
   * @returns {object} snapshot
   */
  recordResult(result) {
    if (!this.proofId) this.begin({});
    const decision = classifyLeanResult(result, {
      previousFingerprint: this.lastFingerprint,
      sameFailureCount: this.sameFailureCount,
      // Distinct candidates that keep failing the same way escalate too, not
      // only byte-identical failures — see CLASS_CHANGE_SUFFIX in the policy.
      previousFailureClass: this.lastFailureClass,
      sameClassCount: this.sameClassCount,
      strategyChangeAfter: this.config.strategyChangeAfter,
    });

    this.nextAction = decision.nextAction;
    this.strategyChangeRequired = decision.strategyChangeRequired;

    // Target identity lock (WP05). The executor's statement hash is runtime
    // evidence, so it is trusted here; a model-supplied hash is not. Lock on
    // the first useful result — including a candidate_preflight rejection with
    // attemptConsumed=false, which still carries a valid extraction — and
    // never overwrite an existing lock.
    const returnedHash =
      typeof result?.targetStatementSha256 === "string" &&
      /^[0-9a-f]{64}$/.test(result.targetStatementSha256)
        ? result.targetStatementSha256
        : null;

    if (returnedHash !== null) {
      if (this.targetStatementSha256 === null) {
        this.targetStatementSha256 = returnedHash;
        if (!this.targetIdentityAlgorithm && result?.targetIdentityAlgorithm) {
          this.targetIdentityAlgorithm = result.targetIdentityAlgorithm;
        }
        this.targetIdentityMatched = true;
      } else if (returnedHash !== this.targetStatementSha256) {
        // Statement substitution under the same declaration name: the checked
        // bytes prove a different theorem. Never verify, never relock. With a
        // sealed spec this also catches the first candidate, which used to be
        // able to define the target by being the target.
        this.state = "repair_required";
        this.lastFailureClass = "target_identity";
        this.nextAction = this.taskSpec
          ? `The checked source does not state the sealed target. Restore the declared statement of '${this.taskSpec.targetDeclaration}' exactly; change only the proof body, imports, or helper lemmas, then call lean_check again.`
          : "Restore the locked target declaration and theorem statement exactly; change only the proof body, imports, or helper lemmas, then call lean_check again.";
        return this.snapshot();
      }
    }

    if (decision.verified) {
      this.state = "verified";
      this.lastFailureClass = null;
      this.terminalReason = null;
      // The checked hash/profile are only recorded when the result agrees with
      // the locked identity: a verified-looking result about a different
      // statement or profile stays untrusted for publication purposes.
      if (
        returnedHash !== null &&
        returnedHash === this.targetStatementSha256 &&
        result?.targetIdentityMatched === true
      ) {
        this.checkedTargetStatementSha256 = returnedHash;
      }
      if (!this.profile || !result?.profile || result.profile === this.profile) {
        this.checkedProfile = result?.profile ?? null;
      }
      this.checkedSourceSha256 = result?.sourceArtifact?.sha256 || this.lastSourceSha256 || null;
      this.checkedSource = this.lastSource;
      this.checkedRunId = result?.runId || null;
      this.sameFailureCount = 0;
      this.sameClassCount = 0;
      return this.snapshot();
    }

    // WP02: Rollback unconsumed attempts. A pre-spawn rejection (placeholder
    // preflight, contract error, etc.) must not count toward the proof budget.
    const attemptConsumed =
      typeof result?.attemptConsumed === "boolean" ? result.attemptConsumed : true;
    if (!attemptConsumed) {
      this.attempts = Math.max(0, this.attempts - 1);
      this.lastSourceSha256 = null;
      this.lastSource = null;
    }

    // WP03: candidate_preflight is repairable, not terminal. Do not count it
    // as a same-failure (it's not a Lean diagnostic failure) and do not force
    // a strategy change.
    if (decision.failureClass === "candidate_preflight") {
      this.state = "repair_required";
      this.lastFailureClass = decision.failureClass;
      return this.snapshot();
    }

    this.lastFailureClass = decision.failureClass;
    this.sameFailureCount = decision.sameFailureCount;
    this.sameClassCount = decision.sameClassCount;
    this.lastFingerprint = decision.diagnosticFingerprint;

    if (decision.failureClass === "user_cancelled") {
      this.#terminate("cancelled", decision.terminalReason || "USER_CANCELLED");
      return this.snapshot();
    }
    if (decision.terminal) {
      // Map failure class to the correct terminal state.
      const termState =
        decision.failureClass === "contract" ? "contract_block" : "infrastructure_block";
      this.#terminate(
        termState,
        decision.terminalReason || "NON_RETRYABLE_ERROR"
      );
      return this.snapshot();
    }

    if (this.attempts >= this.config.maxAttempts || this.#wallClockExpired()) {
      this.#terminate("budget_exhausted", "BUDGET_EXHAUSTED");
      return this.snapshot();
    }

    if (decision.strategyChangeRequired) {
      this.state = "strategy_change_required";
      this.strategyGeneration += 1;
    } else {
      this.state = "repair_required";
    }
    return this.snapshot();
  }

  /**
   * The model tried to answer while a repairable failure was outstanding.
   *
   * The first ones are not fatal: the model gets guidance and another round.
   * Past the budget the turn ends as NOT_VERIFIED rather than looping forever.
   *
   * @returns {{ retryAllowed: boolean, guidance: string, ...snapshot }}
   */
  recordPrematureFinalization() {
    this.prematureFinalizations += 1;
    const remaining = this.config.maxPrematureFinalizations - this.prematureFinalizations;

    if (remaining < 0) {
      this.#terminate("budget_exhausted", "PREMATURE_FINALIZATION_BUDGET_EXHAUSTED");
      return { retryAllowed: false, guidance: "", ...this.snapshot() };
    }

    let guidance =
      "LEAN_FINALIZATION_BLOCKED: the last lean_check did not return status=checked. " +
      `Repair the proof and call lean_check again (attempt ${this.attempts + 1}/${this.config.maxAttempts}). ` +
      this.nextAction;
    if (this.prematureFinalizations >= 2) {
      guidance +=
        " Do not restate the previous candidate and do not ask the user to continue: " +
        "emit the corrected Lean source in a lean_check call now.";
    }
    if (this.prematureFinalizations >= 3) {
      this.state = "strategy_change_required";
      this.strategyGeneration += 1;
      guidance +=
        " The current proof strategy has failed repeatedly — switch to a different tactic family.";
    }
    return { retryAllowed: true, guidance, ...this.snapshot() };
  }

  /** True when a final answer may be committed. */
  canFinalize() {
    if (!this.used) return true;
    if (!this.config.enabled) return true; // §22 rollback: gate off, contract kept
    return TERMINAL_STATES.includes(this.state);
  }

  /** True when the loop owes another lean_check before answering. */
  mustContinue() {
    if (!this.used || !this.config.enabled) return false;
    return CONTINUE_STATES.includes(this.state);
  }

  /** Mark the proof terminal without a further attempt (cancellation, abort). */
  markCancelled(reason = "USER_CANCELLED") {
    this.#terminate("cancelled", reason);
    return this.snapshot();
  }

  snapshot() {
    return {
      proofId: this.proofId,
      state: this.state,
      attempt: this.attempts,
      attempts: this.attempts,
      maxAttempts: this.config.maxAttempts,
      attemptsRemaining: Math.max(0, this.config.maxAttempts - this.attempts),
      failureClass: this.lastFailureClass,
      diagnosticFingerprint: this.lastFingerprint,
      sameFailureCount: this.sameFailureCount,
      sameClassCount: this.sameClassCount,
      strategyGeneration: this.strategyGeneration,
      strategyChangeRequired: this.strategyChangeRequired,
      prematureFinalizations: this.prematureFinalizations,
      verified:
        this.state === "verified" &&
        this.targetStatementSha256 !== null &&
        this.checkedTargetStatementSha256 === this.targetStatementSha256 &&
        (this.checkedProfile === null || this.profile === null || this.checkedProfile === this.profile),
      terminal: TERMINAL_STATES.includes(this.state),
      terminalReason: this.terminalReason,
      nextAction: this.nextAction,
      checkedSourceSha256: this.checkedSourceSha256,
      checkedRunId: this.checkedRunId,
      taskSpecSealed: this.taskSpec !== null,
      taskId: this.taskSpec?.taskId ?? null,
      requiredProfile: this.taskSpec?.requiredProfile ?? null,
      targetDeclaration: this.targetDeclaration,
      targetStatementSha256: this.targetStatementSha256,
      targetIdentityAlgorithm: this.targetIdentityAlgorithm,
      checkedTargetStatementSha256: this.checkedTargetStatementSha256,
      targetIdentityMatched:
        this.state === "verified" &&
        this.targetStatementSha256 !== null &&
        this.checkedTargetStatementSha256 === this.targetStatementSha256,
      profile: this.profile,
      checkedProfile: this.checkedProfile,
      elapsedMs: this.elapsedWallClockMs(),
      // The budget is runtime data, not something the model may reconstruct.
      // The observed transcript shows it adding per-call timeouts (30 + 90 <
      // 360) and concluding it still had time: per-call timeout is not
      // wall-clock budget.
      elapsedWallClockMs: this.elapsedWallClockMs(),
      maxWallClockMs: this.config.maxWallClockMs,
      remainingWallClockMs: this.remainingWallClockMs(),
    };
  }

  elapsedWallClockMs() {
    return this.startedAt === null ? 0 : Math.max(0, this.now() - this.startedAt);
  }

  /** Never negative: a budget that has run out is 0, not a negative number a
   * consumer might render as "time left". */
  remainingWallClockMs() {
    return Math.max(0, this.config.maxWallClockMs - this.elapsedWallClockMs());
  }

  #terminate(state, reason) {
    this.state = state;
    this.terminalReason = reason;
    this.strategyChangeRequired = false;
  }

  /** Structured refusal when a retry drifts off the locked task identity. */
  #taskIdentityRefusal(targetDeclaration, profile) {
    if (
      targetDeclaration !== undefined &&
      targetDeclaration !== null &&
      targetDeclaration !== this.targetDeclaration
    ) {
      return {
        allowed: false,
        code: "LEAN_TARGET_DECLARATION_MISMATCH",
        reason: `This proof task is locked on target "${this.targetDeclaration}". Restore it; start a new proof task to prove "${targetDeclaration}".`,
        ...this.snapshot(),
      };
    }
    if (profile !== undefined && profile !== null && profile !== this.profile) {
      return {
        allowed: false,
        code: "LEAN_PROFILE_CHANGED_WITHIN_PROOF",
        reason: `This proof task is locked on profile "${this.profile}". A proof checked under a different elaboration context is not evidence for this task.`,
        ...this.snapshot(),
      };
    }
    return null;
  }

  #wallClockExpired() {
    return this.startedAt !== null && this.now() - this.startedAt >= this.config.maxWallClockMs;
  }
}
