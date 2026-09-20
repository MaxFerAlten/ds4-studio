// Canonical Sage turn state machine (fase S1/S3 del piano).
//
// This is the ONLY authority on the Sage workflow. The native path mirrors what
// this tracker decides; it does not keep a second budget. Two rules shape
// everything below:
//
//   - a candidate that fails validation is repaired and validated AGAIN, so the
//     budget must allow one validation per candidate revision (diagnosi §1.6);
//   - a failed mathematical validation is a repairable failure, not the end of
//     the task (diagnosi §1.7).
//
// Nothing here reads model prose. The phase that comes next is computed from
// the runtime's own evidence by classifySageResult.

import { createHash } from "crypto";

import {
  resolveSageOrchestrationConfig,
  sageTaskRequiresPlots,
  SAGE_FUNCTION_STUDY_ARTIFACT_KINDS,
} from "./sageOrchestrationConfig.mjs";
import { classifySageResult } from "./sageRepairPolicy.mjs";
import { normalizeSagePhase, normalizeSageTaskType } from "./sageResultContract.mjs";

/** States that end the turn. Everything else owes another phase. */
export const SAGE_TERMINAL_STATES = Object.freeze([
  "ready",
  "infrastructure_block",
  "budget_exhausted",
  "cancelled",
  "failed_non_retryable",
]);

export function sha256Hex(value) {
  return createHash("sha256").update(String(value ?? ""), "utf8").digest("hex");
}

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean).map(String))].sort();
}

export class SageTurnTracker {
  /**
   * @param {object} [config] - resolved sage orchestration config. Defaults to
   *   the canonical policy so a caller that does not care cannot invent a budget.
   */
  constructor(config = resolveSageOrchestrationConfig()) {
    this.config = config && typeof config === "object" ? config : resolveSageOrchestrationConfig();
    this.reset();
  }

  reset() {
    this.runId = null;
    this.taskType = "auto";
    this.requiresPlots = false;
    this.state = "idle";

    this.computeCount = 0;
    this.repairCount = 0;
    this.validationCount = 0;
    this.plotCount = 0;
    this.totalCallCount = 0;

    this.candidateRevision = 0;
    this.validatedRevision = null;
    this.lastFailureClass = null;
    this.lastFingerprint = null;
    this.sameFailureCount = 0;
    this.strategyGeneration = 0;
    this.strategyChangeRequired = false;
    this.requiredNextPhase = "compute";
    this.nextAction = "Call sage with phase=compute to produce the first candidate.";

    this.authoritative = false;
    this.validationPassed = null;
    this.publishable = false;
    this.reportReady = false;
    this.finalMarkdownReady = false;
    this.artifactKinds = new Set();

    this.startedAt = null;
    this.prematureFinalizations = 0;
    this.terminalNoticeDelivered = false;
    this.unchangedCandidateRejections = 0;
    this.lastCodeSha256 = null;
    this.terminalReason = null;
    this.failureCode = null;
    this.lastPhase = null;
    return this.snapshot();
  }

  begin({ runId, taskType, requiresPlots } = {}) {
    this.reset();
    this.runId = runId == null ? null : String(runId);
    this.taskType = normalizeSageTaskType(taskType);
    this.requiresPlots = requiresPlots == null
      ? sageTaskRequiresPlots(this.taskType)
      : Boolean(requiresPlots);
    this.state = "prepared";
    this.startedAt = Date.now();
    return this.snapshot();
  }

  // -- budget -------------------------------------------------------------

  #budgetFor(phase) {
    if (phase === "compute") return [this.computeCount, this.config.maxComputeAttempts];
    if (phase === "repair") return [this.repairCount, this.config.maxRepairAttempts];
    if (phase === "validate") return [this.validationCount, this.config.maxValidationAttempts];
    if (phase === "plot") return [this.plotCount, this.config.maxPlotAttempts];
    return [0, 0];
  }

  attemptsRemaining() {
    return {
      compute: Math.max(0, this.config.maxComputeAttempts - this.computeCount),
      repair: Math.max(0, this.config.maxRepairAttempts - this.repairCount),
      validate: Math.max(0, this.config.maxValidationAttempts - this.validationCount),
      plot: Math.max(0, this.config.maxPlotAttempts - this.plotCount),
      total: Math.max(0, this.config.maxTotalToolCalls - this.totalCallCount),
    };
  }

  #wallClockExpired() {
    return this.startedAt !== null && Date.now() - this.startedAt >= this.config.maxWallClockMs;
  }

  #terminate(state, reason) {
    this.state = state;
    this.terminalReason = reason;
    this.failureCode = state === "ready" ? null : reason;
    if (state !== "ready") this.publishable = false;
    return this.snapshot();
  }

  /** Which phase the runtime demands next, or null when the turn is over. */
  #phaseFor(state) {
    if (state === "prepared" || state === "idle") return "compute";
    if (state === "computed" || state === "validation_required" || state === "validating") {
      return "validate";
    }
    if (state === "repair_required") return "repair";
    if (state === "plot_required" || state === "plotting") return "plot";
    if (state === "ready") return "publish";
    return null;
  }

  // -- calls --------------------------------------------------------------

  /**
   * Authorise the next tool call.
   *
   * @param {object} call
   * @param {string} call.phase
   * @param {number} [call.candidateRevision] - revision the model is acting on
   * @param {string} [call.codeSha256] - hash of the candidate source
   */
  beforeCall({ phase, candidateRevision, codeSha256 } = {}) {
    const normalized = normalizeSagePhase(phase);
    if (this.isTerminal()) {
      return {
        allowed: false,
        code: "SAGE_TURN_TERMINAL",
        reason: this.terminalReason,
        ...this.snapshot(),
      };
    }
    if (this.totalCallCount >= this.config.maxTotalToolCalls) {
      this.#terminate("budget_exhausted", "SAGE_TOTAL_CALL_BUDGET_EXHAUSTED");
      return { allowed: false, code: "SAGE_TOTAL_CALL_BUDGET_EXHAUSTED", ...this.snapshot() };
    }
    if (this.#wallClockExpired()) {
      this.#terminate("budget_exhausted", "SAGE_WALL_CLOCK_EXHAUSTED");
      return { allowed: false, code: "SAGE_WALL_CLOCK_EXHAUSTED", ...this.snapshot() };
    }

    const required = this.#phaseFor(this.state);
    if (required && normalized !== required) {
      // The phase is deterministic (§15.3): a different one is refused with the
      // instruction, not silently accepted.
      return {
        allowed: false,
        code: "SAGE_PHASE_TRANSITION_INVALID",
        requiredNextPhase: required,
        ...this.snapshot(),
      };
    }

    const [used, max] = this.#budgetFor(normalized);
    if (used >= max) {
      this.#terminate("budget_exhausted", `SAGE_${normalized.toUpperCase()}_BUDGET_EXHAUSTED`);
      return {
        allowed: false,
        code: `SAGE_${normalized.toUpperCase()}_BUDGET_EXHAUSTED`,
        ...this.snapshot(),
      };
    }

    // A repair that resubmits the identical source cannot fail differently.
    // Refusing it costs no attempt, so the refusal itself must be bounded or a
    // stubborn model would spin here forever.
    if (codeSha256 && normalized === "repair" && codeSha256 === this.lastCodeSha256) {
      this.unchangedCandidateRejections += 1;
      if (this.unchangedCandidateRejections > this.config.maxPrematureFinalizations) {
        this.#terminate("budget_exhausted", "SAGE_CANDIDATE_UNCHANGED_BUDGET_EXHAUSTED");
        return {
          allowed: false,
          code: "SAGE_CANDIDATE_UNCHANGED_BUDGET_EXHAUSTED",
          ...this.snapshot(),
        };
      }
      return {
        allowed: false,
        code: "SAGE_CANDIDATE_UNCHANGED",
        requiredNextPhase: "repair",
        nextAction:
          "The candidate is byte-identical to the one that just failed. Change the mathematics or the code before calling sage again.",
        ...this.snapshot(),
      };
    }

    if (candidateRevision != null && normalized === "validate" &&
        Number(candidateRevision) !== this.candidateRevision) {
      return {
        allowed: false,
        code: "SAGE_CANDIDATE_REVISION_MISMATCH",
        requiredNextPhase: "validate",
        nextAction: `Validate candidate revision ${this.candidateRevision}, not ${candidateRevision}.`,
        ...this.snapshot(),
      };
    }

    this.lastPhase = normalized;
    this.totalCallCount += 1;
    if (normalized === "compute") this.computeCount += 1;
    if (normalized === "repair") {
      this.repairCount += 1;
      if (codeSha256) this.lastCodeSha256 = String(codeSha256);
    }
    if (normalized === "compute" && codeSha256) this.lastCodeSha256 = String(codeSha256);
    if (normalized === "validate") {
      this.validationCount += 1;
      this.state = "validating";
    }
    if (normalized === "plot") {
      this.plotCount += 1;
      this.state = "plotting";
    }
    return { allowed: true, phase: normalized, ...this.snapshot() };
  }

  /** Legacy alias kept for the existing call sites. */
  recordCall(call = {}) {
    return this.beforeCall(call);
  }

  /** Non-mutating counterpart of beforeCall: would this phase be authorised? */
  canRun({ phase } = {}) {
    if (this.isTerminal()) return false;
    if (this.totalCallCount >= this.config.maxTotalToolCalls) return false;
    if (this.#wallClockExpired()) return false;
    const normalized = normalizeSagePhase(phase);
    const required = this.#phaseFor(this.state);
    if (required && normalized !== required) return false;
    const [used, max] = this.#budgetFor(normalized);
    return used < max;
  }

  // -- results ------------------------------------------------------------

  #absorbArtifacts({ artifactKinds = [], artifactCount = 0, result } = {}) {
    const fromResult = Array.isArray(result?.artifacts)
      ? result.artifacts.map((artifact) => artifact?.kind)
      : Array.isArray(result?.sageResult?.artifacts)
        ? result.sageResult.artifacts.map((artifact) => artifact?.kind)
        : [];
    for (const kind of [...(Array.isArray(artifactKinds) ? artifactKinds : []), ...fromResult]) {
      if (kind) this.artifactKinds.add(String(kind));
    }
    if (!this.artifactKinds.size && Number(artifactCount) > 0) {
      for (let index = 0; index < Number(artifactCount); index += 1) {
        this.artifactKinds.add(`legacy_artifact_${index + 1}`);
      }
    }
  }

  #requiredPlotsReady() {
    return !this.requiresPlots || SAGE_FUNCTION_STUDY_ARTIFACT_KINDS.every(
      (kind) => this.artifactKinds.has(kind)
    );
  }

  /**
   * Record the outcome of a call.
   *
   * Accepts either the canonical shape `{ phase, result }` — where `result` is
   * the tool result the publication gate produced — or the flat summary the
   * older call sites pass. Both end up in classifySageResult.
   */
  recordResult(input = {}) {
    const {
      phase,
      result = null,
      isError = false,
      authoritative = false,
      validationPassed,
      publishable = false,
      reportReady = false,
      finalMarkdownReady = false,
      artifactKinds = [],
      artifactCount = 0,
    } = input;
    const normalized = normalizeSagePhase(phase ?? this.lastPhase);
    this.lastPhase = normalized;
    this.#absorbArtifacts({ artifactKinds, artifactCount, result });

    const evidence = result ?? {
      isError,
      publishable,
      artifacts: [...this.artifactKinds].map((kind) => ({ kind })),
      sageResult: {
        taskType: this.taskType,
        phase: normalized,
        execution: { ok: !isError, exitCode: isError ? 1 : 0, timedOut: false },
        validation: {
          authoritative,
          passed: validationPassed === true,
          checks: [],
          errors: input.reasonCodes ?? (isError ? ["SAGE_EXECUTION_FAILED"] : []),
        },
        publication: {
          publishable,
          markdown: finalMarkdownReady ? "ready" : "",
          reasonCodes: input.reasonCodes ?? [],
        },
      },
    };

    if (normalized === "validate" || result) {
      this.authoritative = result
        ? result.authoritative === true || result.sageResult?.validation?.authoritative === true
        : authoritative === true;
      this.publishable = result
        ? result.publishable === true || result.sageResult?.publication?.publishable === true
        : publishable === true;
      this.reportReady = result ? result.reportReady === true : reportReady === true;
      this.finalMarkdownReady = result
        ? typeof result.finalMarkdown === "string" && result.finalMarkdown.trim().length > 0
        : finalMarkdownReady === true;
      if (normalized === "validate") {
        this.validationPassed = result
          ? result.validationPassed === true || result.sageResult?.validation?.passed === true
          : validationPassed === true;
      }
    }

    const decision = classifySageResult(evidence, {
      phase: normalized,
      taskType: this.taskType,
      candidateRevision: this.candidateRevision,
      previousFingerprint: this.lastFingerprint,
      sameFailureCount: this.sameFailureCount,
      config: this.config,
      requiresPlots: this.requiresPlots,
    });

    this.lastFailureClass = decision.failureClass;
    if (decision.diagnosticFingerprint) {
      if (decision.diagnosticFingerprint === this.lastFingerprint) {
        this.sameFailureCount = decision.sameFailureCount;
      } else {
        this.sameFailureCount = 1;
      }
      this.lastFingerprint = decision.diagnosticFingerprint;
    }
    this.strategyChangeRequired = decision.strategyChangeRequired === true;
    if (this.strategyChangeRequired) this.strategyGeneration += 1;
    this.nextAction = decision.nextAction;

    if (decision.infrastructure) {
      return this.#terminate("infrastructure_block", decision.terminalReason ?? "SAGE_INFRASTRUCTURE_BLOCK");
    }
    if (decision.failureClass === "cancelled") {
      return this.#terminate("cancelled", "SAGE_CANCELLED");
    }

    if (normalized === "compute" || normalized === "repair") {
      // A candidate exists either way: an execution error is still a revision
      // the model has to repair, and revision numbering must not depend on luck.
      this.candidateRevision += 1;
      this.state = decision.retryable && decision.nextPhase === "repair" && evidence.isError === true
        ? this.#afterRepairableFailure()
        : "validation_required";
      this.requiredNextPhase = this.#phaseFor(this.state);
      return this.snapshot();
    }

    if (normalized === "validate") {
      if (decision.publishable) {
        // §7.2: publishable implies authoritative, passed validation and a
        // non-empty final markdown. A result that claims publication without
        // them is a broken contract, not a proof — and it must never reach the
        // user as mathematics.
        if (!this.authoritative || this.validationPassed !== true || !this.finalMarkdownReady) {
          return this.#terminate("failed_non_retryable", "SAGE_PUBLISHABLE_INVARIANT_VIOLATION");
        }
        this.validatedRevision = this.candidateRevision;
        if (this.#requiredPlotsReady() && this.finalMarkdownReady) {
          return this.#terminate("ready", "SAGE_PUBLISHABLE");
        }
        this.state = "plot_required";
        this.requiredNextPhase = "plot";
        return this.snapshot();
      }
      if (decision.nextPhase === "plot") {
        // The mathematics held; only the artifact package is short.
        this.validatedRevision = this.candidateRevision;
        this.state = this.plotCount < this.config.maxPlotAttempts
          ? "plot_required"
          : "budget_exhausted";
        if (this.state === "budget_exhausted") {
          return this.#terminate("budget_exhausted", "SAGE_PLOT_BUDGET_EXHAUSTED");
        }
        this.requiredNextPhase = "plot";
        return this.snapshot();
      }
      this.state = this.#afterRepairableFailure();
      this.requiredNextPhase = this.#phaseFor(this.state);
      return this.snapshot();
    }

    if (normalized === "plot") {
      if (this.#requiredPlotsReady() && this.publishable && this.finalMarkdownReady) {
        return this.#terminate("ready", "SAGE_PUBLISHABLE");
      }
      if (this.#requiredPlotsReady() && this.validatedRevision === this.candidateRevision) {
        // Artifacts complete but the report still needs its publication pass.
        this.state = "validation_required";
        this.validatedRevision = null;
        this.requiredNextPhase = "validate";
        return this.snapshot();
      }
      if (this.plotCount >= this.config.maxPlotAttempts) {
        return this.#terminate("budget_exhausted", "SAGE_ARTIFACT_MISSING");
      }
      this.state = "plot_required";
      this.requiredNextPhase = "plot";
      return this.snapshot();
    }

    return this.snapshot();
  }

  /** repair_required while the repair budget holds, budget_exhausted after. */
  #afterRepairableFailure() {
    if (this.repairCount < this.config.maxRepairAttempts &&
        this.validationCount < this.config.maxValidationAttempts) {
      return "repair_required";
    }
    this.terminalReason = this.repairCount >= this.config.maxRepairAttempts
      ? "SAGE_REPAIR_BUDGET_EXHAUSTED"
      : "SAGE_VALIDATION_BUDGET_EXHAUSTED";
    this.failureCode = this.terminalReason;
    this.publishable = false;
    return "budget_exhausted";
  }

  // -- decisions ----------------------------------------------------------

  isTerminal() {
    return SAGE_TERMINAL_STATES.includes(this.state);
  }

  /** True while the turn owes another Sage phase. */
  mustContinue() {
    // §26 rollback: DS4_SAGE_AUTONOMOUS_ORCHESTRATION=0 stops the runtime from
    // driving the next phase on its own. It does NOT relax the publication
    // gate — canFinalize still demands an authoritative, validated, fully
    // plotted result, so a rollback can never release unvalidated mathematics.
    if (this.config.enabled === false) return false;
    if (!this.used()) return false;
    if (this.isTerminal()) return false;
    return true;
  }

  used() {
    return this.totalCallCount > 0 || this.state !== "idle";
  }

  /** Only a ready, fully validated, fully plotted run may publish mathematics. */
  canFinalize() {
    return this.state === "ready" && this.authoritative && this.validationPassed === true &&
      this.publishable && this.reportReady && this.finalMarkdownReady &&
      this.validatedRevision === this.candidateRevision && this.#requiredPlotsReady();
  }

  nextDecision() {
    const requiredNextPhase = this.#phaseFor(this.state);
    return {
      state: this.state,
      terminal: this.isTerminal(),
      mustContinue: this.mustContinue(),
      publishable: this.canFinalize(),
      requiredNextPhase,
      candidateRevision: this.candidateRevision,
      validatedRevision: this.validatedRevision,
      failureClass: this.lastFailureClass,
      strategyChangeRequired: this.strategyChangeRequired,
      diagnosticFingerprint: this.lastFingerprint,
      terminalReason: this.terminalReason,
      nextAction: this.nextAction,
      attemptsRemaining: this.attemptsRemaining(),
      missingArtifactKinds: this.requiresPlots
        ? SAGE_FUNCTION_STUDY_ARTIFACT_KINDS.filter((kind) => !this.artifactKinds.has(kind))
        : [],
    };
  }

  /**
   * Canonical continuation instruction injected in place of the discarded prose.
   * No new user turn is requested (§28.12).
   */
  continuationInstruction() {
    const decision = this.nextDecision();
    return [
      "SAGE_ORCHESTRATION",
      `state=${decision.state}`,
      `candidateRevision=${decision.candidateRevision}`,
      `nextPhase=${decision.requiredNextPhase ?? "terminal"}`,
      `retryable=${!decision.terminal}`,
      decision.failureClass ? `failureClass=${decision.failureClass}` : null,
      decision.strategyChangeRequired ? "strategyChangeRequired=true" : null,
      decision.missingArtifactKinds.length
        ? `missingArtifacts=${decision.missingArtifactKinds.join(",")}`
        : null,
      `nextAction=${decision.nextAction}`,
      "FINALIZATION_ALLOWED=false",
    ].filter(Boolean).join("\n");
  }

  /** Terminal notice: says what to publish when no mathematics may be published. */
  terminalNotice() {
    const decision = this.nextDecision();
    return [
      "SAGE_TERMINAL_NOT_PUBLISHABLE",
      `state=${decision.state}`,
      `reason=${decision.terminalReason ?? "SAGE_NOT_PUBLISHABLE"}`,
      `candidateRevision=${decision.candidateRevision}`,
      "Publish NOT_PUBLISHABLE quoting this reason. Do not present the candidate mathematics as a result.",
    ].join("\n");
  }

  /**
   * The model produced prose while a phase was still owed.
   * §14.3: do not fail at the second episode — discard, re-inject, continue.
   */
  recordPrematureFinalization() {
    this.prematureFinalizations += 1;
    if (this.isTerminal()) {
      // Terminal without a publishable result: the answer is still rewritten
      // once, so what reaches the user is NOT_PUBLISHABLE and not the candidate
      // mathematics the model had already drafted. After that notice the model
      // is allowed to speak — blocking forever would just hang the turn.
      const firstNotice = !this.terminalNoticeDelivered;
      this.terminalNoticeDelivered = true;
      return { retryAllowed: firstNotice, guidance: this.terminalNotice(), ...this.snapshot() };
    }
    if (this.prematureFinalizations <= this.config.maxPrematureFinalizations) {
      return {
        retryAllowed: true,
        guidance: this.continuationInstruction(),
        ...this.snapshot(),
      };
    }
    this.#terminate("budget_exhausted", "SAGE_PREMATURE_FINALIZATION_BUDGET_EXHAUSTED");
    return { retryAllowed: false, guidance: this.terminalNotice(), ...this.snapshot() };
  }

  markCancelled(reason = "SAGE_CANCELLED") {
    if (this.isTerminal()) return this.snapshot();
    return this.#terminate("cancelled", reason);
  }

  fail(code) {
    return this.#terminate("failed_non_retryable", String(code || "SAGE_FINALIZATION_BLOCKED"));
  }

  snapshot() {
    const completed = this.canFinalize();
    return {
      runId: this.runId,
      taskType: this.taskType,
      requiresPlots: this.requiresPlots,
      state: this.state,
      // executeCount is the legacy name for computeCount; both are published so
      // the UI and the native mirror can migrate without a flag day.
      computeCount: this.computeCount,
      executeCount: this.computeCount,
      repairCount: this.repairCount,
      validationCount: this.validationCount,
      plotCount: this.plotCount,
      totalCallCount: this.totalCallCount,
      candidateRevision: this.candidateRevision,
      validatedRevision: this.validatedRevision,
      artifactCount: this.artifactKinds.size,
      artifactKinds: uniqueSorted([...this.artifactKinds]),
      validationPassed: this.validationPassed,
      authoritative: this.authoritative,
      publishable: this.publishable,
      reportReady: this.reportReady,
      finalMarkdownReady: this.finalMarkdownReady,
      blockedFinalizations: this.prematureFinalizations,
      prematureFinalizations: this.prematureFinalizations,
      lastPhase: this.lastPhase,
      failureClass: this.lastFailureClass,
      strategyChangeRequired: this.strategyChangeRequired,
      diagnosticFingerprint: this.lastFingerprint,
      attempt: Math.max(1, this.computeCount + this.repairCount),
      completed,
      terminal: this.isTerminal(),
      failed: this.isTerminal() && this.state !== "ready",
      terminalReason: this.terminalReason,
      failureCode: this.failureCode,
      requiredNextPhase: this.#phaseFor(this.state),
      attemptsRemaining: this.attemptsRemaining(),
    };
  }
}
