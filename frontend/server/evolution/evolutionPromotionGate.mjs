/**
 * DS4 Evolution — independently designed clean-room implementation.
 * Behavioral inputs: docs/evolution/behavioral-specification.md section 12.
 * External source code or prompts copied: none.
 * Existing DS4 mechanisms reused: deterministic gate pattern used by DS4 agentic benchmarks.
 */

const RISK_ORDER = Object.freeze({ LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 });
const HASH_ID = /^sha256:[a-f0-9]{64}$/;
const HEX_HASH = /^[a-f0-9]{64}$/;

function highestRisk(left, right) {
  return RISK_ORDER[left] >= RISK_ORDER[right] ? left : right;
}

export function classifyRisk(files = []) {
  let risk = "LOW";
  for (const rawFile of files) {
    const file = String(rawFile).replaceAll("\\", "/");
    if (/(^|\/)(security|sandbox|hidden-fixtures?|evolutionEvaluator|evolutionPromotionGate)(\/|\.|$)/i.test(file)) {
      risk = highestRisk(risk, "CRITICAL");
      continue;
    }
    if (/^(ds4\.(c|h)|ds4_(rocm|cuda|metal|agent_runtime|server_runtime)\.|Makefile$|rocm\/|metal\/)/.test(file)) {
      risk = highestRisk(risk, "HIGH");
      continue;
    }
    if (/(^|\/)(package\.json|package-lock\.json|index\.mjs|.*Api\.mjs)$/.test(file)) {
      risk = highestRisk(risk, "MEDIUM");
    }
  }
  return risk;
}

function compareMetric(metric, baselineValue, candidateValue) {
  if (metric.direction === "boolean") {
    return { pass: candidateValue === metric.target, improved: candidateValue === metric.target && baselineValue !== metric.target };
  }
  if (metric.direction === "exact") {
    return { pass: candidateValue === metric.target, improved: candidateValue === metric.target && baselineValue !== metric.target };
  }
  if (typeof baselineValue !== "number" || typeof candidateValue !== "number" ||
      !Number.isFinite(baselineValue) || !Number.isFinite(candidateValue)) {
    return { pass: false, improved: false, invalid: true };
  }
  if (metric.direction === "maximize") {
    return {
      pass: candidateValue >= baselineValue - metric.baselineTolerance,
      improved: candidateValue > baselineValue
    };
  }
  return {
    pass: candidateValue <= baselineValue + metric.baselineTolerance,
    improved: candidateValue < baselineValue
  };
}

function validRollbackArtifact(artifact) {
  return artifact && HASH_ID.test(String(artifact.artifactId)) &&
    HEX_HASH.test(String(artifact.candidateHash)) && HEX_HASH.test(String(artifact.parentHash));
}

export function decidePromotion(input) {
  const hardFailures = new Set();
  const regressions = [];
  const improvements = [];
  const candidateEvaluation = input.candidateEvaluation ?? {};
  const baselineEvaluation = input.baselineEvaluation ?? {};
  const taskContract = input.taskContract;
  const candidate = input.candidate ?? {};
  if (!taskContract || !Array.isArray(taskContract.metrics)) hardFailures.add("TASK_CONTRACT_MISSING");
  if (!input.decidedAt || Number.isNaN(Date.parse(input.decidedAt))) hardFailures.add("DECISION_TIME_MISSING");
  for (const failure of candidateEvaluation.hardFailures ?? []) hardFailures.add(String(failure));
  for (const evaluator of candidateEvaluation.evaluators ?? []) {
    if (evaluator.required && evaluator.status !== "passed") hardFailures.add(`REQUIRED_EVALUATOR_${evaluator.status.toUpperCase()}:${evaluator.id}`);
    if (evaluator.required && (!evaluator.reproducibility?.commandHash || !evaluator.reproducibility?.environmentHash)) {
      hardFailures.add(`REPRODUCIBILITY_METADATA_MISSING:${evaluator.id}`);
    }
    if (evaluator.required) {
      const baselineEvaluator = baselineEvaluation.evaluators?.find((entry) => entry.id === evaluator.id);
      if (!baselineEvaluator || baselineEvaluator.reproducibility?.commandHash !== evaluator.reproducibility?.commandHash ||
          baselineEvaluator.reproducibility?.environmentHash !== evaluator.reproducibility?.environmentHash) {
        hardFailures.add(`EVALUATOR_HASH_MISMATCH:${evaluator.id}`);
      }
    }
  }
  for (const metric of taskContract?.metrics ?? []) {
    const baselineValue = baselineEvaluation.aggregateMetrics?.[metric.name];
    const candidateValue = candidateEvaluation.aggregateMetrics?.[metric.name];
    if (metric.required && (baselineValue === undefined || candidateValue === undefined)) {
      hardFailures.add(`REQUIRED_METRIC_MISSING:${metric.name}`);
      continue;
    }
    if (candidateValue === undefined) continue;
    const comparison = compareMetric(metric, baselineValue, candidateValue);
    if (!comparison.pass) {
      regressions.push({ metric: metric.name, baseline: baselineValue, candidate: candidateValue });
      if (metric.required) hardFailures.add(`METRIC_REGRESSION:${metric.name}`);
    } else if (comparison.improved) {
      improvements.push({ metric: metric.name, baseline: baselineValue, candidate: candidateValue });
    }
  }
  if (input.baselineIntegrity !== true) hardFailures.add("BASELINE_INTEGRITY_FAILED");
  if (input.securityPolicy?.passed !== true) hardFailures.add("SECURITY_POLICY_FAILED");
  for (const violation of input.securityPolicy?.violations ?? []) hardFailures.add(`SECURITY:${violation}`);
  if (input.budgetState?.exceeded === true) hardFailures.add("BUDGET_EXCEEDED");
  if (!validRollbackArtifact(input.rollbackArtifact)) hardFailures.add("ROLLBACK_ARTIFACT_MISSING");
  if (candidate.evaluatorModified === true) hardFailures.add("EVALUATOR_TAMPER_ATTEMPT");
  if (candidate.hiddenInformationUsed === true) hardFailures.add("HIDDEN_INFORMATION_USED");
  if (candidate.networkEnabled === true && input.networkAuthorization !== true) hardFailures.add("UNAUTHORIZED_NETWORK_ACCESS");

  const pathRisk = classifyRisk(candidate.patchMetadata?.files ?? []);
  const impactRisk = Object.hasOwn(RISK_ORDER, candidate.impact?.risk) ? candidate.impact.risk : "LOW";
  const riskLevel = highestRisk(pathRisk, impactRisk);
  let decision = "REJECT";
  let requiresHuman = false;
  if (hardFailures.size === 0) {
    const forcedHuman = candidate.requiresManualReview === true || candidate.networkEnabled === true ||
      riskLevel === "HIGH" || riskLevel === "CRITICAL";
    const policy = taskContract.approvalPolicy;
    const riskAllowed = policy.allowedRiskLevels.includes(riskLevel);
    const neutral = improvements.length === 0;
    if (forcedHuman || policy.mode === "manual" || !riskAllowed || neutral) {
      decision = "MANUAL_REVIEW";
      requiresHuman = true;
    } else {
      decision = "PROMOTE";
    }
  }
  return Object.freeze({
    promotionVersion: "ds4_evolution_promotion_v1",
    revision: input.revision,
    decision,
    hardFailures: Object.freeze([...hardFailures].sort()),
    regressions: Object.freeze(regressions),
    improvements: Object.freeze(improvements),
    riskLevel,
    requiresHuman,
    rollbackArtifact: input.rollbackArtifact?.artifactId ?? null,
    decidedAt: input.decidedAt ?? null
  });
}
