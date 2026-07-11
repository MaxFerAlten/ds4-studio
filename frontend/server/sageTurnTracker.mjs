import { normalizeSagePhase, normalizeSageTaskType } from "./sageResultContract.mjs";

const SAGE_PHASE_BUDGETS = Object.freeze({
  compute: 1,
  repair: 2,
  validate: 1,
  plot: 2
});

export class SageTurnTracker {
  constructor() {
    this.reset();
  }

  reset() {
    this.runId = null;
    this.taskType = "auto";
    this.executeCount = 0;
    this.repairCount = 0;
    this.validationCount = 0;
    this.plotCount = 0;
    this.artifactCount = 0;
    this.validationPassed = null;
    this.lastPhase = null;
    this.completed = false;
    this.failed = false;
    return this.snapshot();
  }

  begin({ runId, taskType } = {}) {
    this.reset();
    this.runId = runId == null ? null : String(runId);
    this.taskType = normalizeSageTaskType(taskType);
    return this.snapshot();
  }

  canRun({ phase } = {}) {
    if (this.failed) return false;
    const normalized = normalizeSagePhase(phase);
    if (normalized === "prepare") return true;
    if (normalized === "compute") return this.executeCount < SAGE_PHASE_BUDGETS.compute;
    if (normalized === "repair") return this.repairCount < SAGE_PHASE_BUDGETS.repair;
    if (normalized === "validate") return this.validationCount < SAGE_PHASE_BUDGETS.validate;
    if (normalized === "plot") return this.plotCount < SAGE_PHASE_BUDGETS.plot;
    return false;
  }

  recordCall({ phase } = {}) {
    const normalized = normalizeSagePhase(phase);
    if (!this.canRun({ phase: normalized })) {
      return { allowed: false, ...this.snapshot() };
    }

    this.lastPhase = normalized;
    if (normalized === "compute") this.executeCount += 1;
    if (normalized === "repair") this.repairCount += 1;
    if (normalized === "validate") this.validationCount += 1;
    if (normalized === "plot") this.plotCount += 1;
    return { allowed: true, ...this.snapshot() };
  }

  recordResult({ phase, isError = false, validationPassed, artifactCount = 0 } = {}) {
    const normalized = normalizeSagePhase(phase);
    this.lastPhase = normalized;
    this.artifactCount += Math.max(0, Number.parseInt(artifactCount, 10) || 0);

    if (isError) {
      this.completed = false;
      if ((normalized === "repair" && !this.canRun({ phase: "repair" })) ||
          normalized === "validate" ||
          (normalized === "plot" && !this.canRun({ phase: "plot" }))) {
        this.failed = true;
      }
      return this.snapshot();
    }

    if (typeof validationPassed === "boolean") {
      this.validationPassed = validationPassed;
      this.completed = validationPassed;
      if (!validationPassed && normalized === "validate") this.failed = true;
    }

    return this.snapshot();
  }

  snapshot() {
    return {
      runId: this.runId,
      taskType: this.taskType,
      executeCount: this.executeCount,
      repairCount: this.repairCount,
      validationCount: this.validationCount,
      plotCount: this.plotCount,
      artifactCount: this.artifactCount,
      validationPassed: this.validationPassed,
      lastPhase: this.lastPhase,
      attempt: Math.max(1, this.executeCount + this.repairCount),
      completed: this.completed,
      failed: this.failed
    };
  }
}
