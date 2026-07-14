import { normalizeSagePhase, normalizeSageTaskType } from "./sageResultContract.mjs";

const SAGE_PHASE_BUDGETS = Object.freeze({ compute: 1, repair: 2, validate: 1, plot: 2 });
const REQUIRED_FUNCTION_STUDY_ARTIFACTS = Object.freeze([
  "function_plot",
  "first_derivative_plot",
  "second_derivative_plot"
]);

export class SageTurnTracker {
  constructor() {
    this.reset();
  }

  reset() {
    this.runId = null;
    this.taskType = "auto";
    this.requiresPlots = false;
    this.state = "idle";
    this.executeCount = 0;
    this.repairCount = 0;
    this.validationCount = 0;
    this.plotCount = 0;
    this.artifactKinds = new Set();
    this.validationPassed = null;
    this.authoritative = false;
    this.publishable = false;
    this.reportReady = false;
    this.finalMarkdownReady = false;
    this.blockedFinalizations = 0;
    this.lastPhase = null;
    this.failureCode = null;
    return this.snapshot();
  }

  begin({ runId, taskType, requiresPlots } = {}) {
    this.reset();
    this.runId = runId == null ? null : String(runId);
    this.taskType = normalizeSageTaskType(taskType);
    this.requiresPlots = requiresPlots == null
      ? this.taskType === "function_study"
      : Boolean(requiresPlots);
    this.state = "prepared";
    return this.snapshot();
  }

  canRun({ phase } = {}) {
    if (this.state === "failed" || this.state === "ready") return false;
    const normalized = normalizeSagePhase(phase);
    if (normalized === "compute") {
      return ["idle", "prepared"].includes(this.state) &&
        this.executeCount < SAGE_PHASE_BUDGETS.compute;
    }
    if (normalized === "repair") {
      return ["computed", "repairing"].includes(this.state) &&
        this.repairCount < SAGE_PHASE_BUDGETS.repair;
    }
    if (normalized === "validate") {
      return this.state === "computed" &&
        this.validationCount < SAGE_PHASE_BUDGETS.validate;
    }
    if (normalized === "plot") {
      return ["validated", "plotted"].includes(this.state) &&
        this.plotCount < SAGE_PHASE_BUDGETS.plot;
    }
    return false;
  }

  recordCall({ phase } = {}) {
    const normalized = normalizeSagePhase(phase);
    if (!this.canRun({ phase: normalized })) {
      return { allowed: false, code: "SAGE_PHASE_TRANSITION_INVALID", ...this.snapshot() };
    }
    this.lastPhase = normalized;
    if (normalized === "compute") this.executeCount += 1;
    if (normalized === "repair") {
      this.repairCount += 1;
      this.state = "repairing";
    }
    if (normalized === "validate") this.validationCount += 1;
    if (normalized === "plot") this.plotCount += 1;
    return { allowed: true, ...this.snapshot() };
  }

  recordResult({
    phase,
    isError = false,
    authoritative = false,
    validationPassed,
    publishable = false,
    reportReady = false,
    finalMarkdownReady = false,
    artifactKinds = [],
    artifactCount = 0
  } = {}) {
    const normalized = normalizeSagePhase(phase);
    this.lastPhase = normalized;
    for (const kind of Array.isArray(artifactKinds) ? artifactKinds : []) {
      if (kind) this.artifactKinds.add(String(kind));
    }
    if (!this.artifactKinds.size && Number(artifactCount) > 0) {
      for (let index = 0; index < Number(artifactCount); index += 1) {
        this.artifactKinds.add(`legacy_artifact_${index + 1}`);
      }
    }

    if (isError) {
      if (normalized === "compute") this.state = "computed";
      else if (normalized === "repair" && this.repairCount < SAGE_PHASE_BUDGETS.repair) {
        this.state = "computed";
      } else {
        this.fail("SAGE_EXECUTION_FAILED");
      }
      return this.snapshot();
    }

    if (normalized === "compute" || normalized === "repair") {
      this.state = "computed";
      return this.snapshot();
    }

    if (normalized === "validate") {
      this.authoritative = authoritative === true;
      this.validationPassed = validationPassed === true;
      this.publishable = publishable === true;
      this.reportReady = reportReady === true;
      this.finalMarkdownReady = finalMarkdownReady === true;
      if (!this.authoritative || !this.validationPassed || !this.publishable ||
          !this.reportReady || !this.finalMarkdownReady) {
        this.fail("SAGE_RESULT_NOT_PUBLISHABLE");
        return this.snapshot();
      }
      this.state = this.requiresPlots && !this.#requiredPlotsReady()
        ? "validated"
        : "ready";
      return this.snapshot();
    }

    if (normalized === "plot") {
      const plotsReady = this.#requiredPlotsReady();
      if (plotsReady && this.authoritative && this.validationPassed && this.publishable &&
          this.reportReady && this.finalMarkdownReady) {
        this.state = "ready";
      } else if (this.plotCount >= SAGE_PHASE_BUDGETS.plot) {
        this.fail("SAGE_ARTIFACT_MISSING");
      } else {
        this.state = "plotted";
      }
    }
    return this.snapshot();
  }

  canFinalize() {
    return this.state === "ready" && this.authoritative && this.validationPassed === true &&
      this.publishable && this.reportReady && this.finalMarkdownReady &&
      this.#requiredPlotsReady();
  }

  recordPrematureFinalization() {
    this.blockedFinalizations += 1;
    if (this.blockedFinalizations === 1 && this.state !== "failed") {
      return {
        retryAllowed: true,
        guidance: "SAGE_FINALIZATION_BLOCKED: complete the allowed next Sage phase.",
        ...this.snapshot()
      };
    }
    this.fail("SAGE_FINALIZATION_BLOCKED");
    return { retryAllowed: false, guidance: "", ...this.snapshot() };
  }

  fail(code) {
    this.state = "failed";
    this.failureCode = String(code || "SAGE_FINALIZATION_BLOCKED");
    this.publishable = false;
    return this.snapshot();
  }

  #requiredPlotsReady() {
    return !this.requiresPlots || REQUIRED_FUNCTION_STUDY_ARTIFACTS.every(
      (kind) => this.artifactKinds.has(kind)
    );
  }

  snapshot() {
    const completed = this.canFinalize();
    return {
      runId: this.runId,
      taskType: this.taskType,
      requiresPlots: this.requiresPlots,
      state: this.state,
      executeCount: this.executeCount,
      repairCount: this.repairCount,
      validationCount: this.validationCount,
      plotCount: this.plotCount,
      artifactCount: this.artifactKinds.size,
      artifactKinds: [...this.artifactKinds].sort(),
      validationPassed: this.validationPassed,
      authoritative: this.authoritative,
      publishable: this.publishable,
      reportReady: this.reportReady,
      finalMarkdownReady: this.finalMarkdownReady,
      blockedFinalizations: this.blockedFinalizations,
      lastPhase: this.lastPhase,
      attempt: Math.max(1, this.executeCount + this.repairCount),
      completed,
      failed: this.state === "failed",
      failureCode: this.failureCode
    };
  }
}
