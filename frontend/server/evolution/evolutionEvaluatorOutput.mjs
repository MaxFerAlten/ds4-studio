/**
 * DS4 Evolution — independently designed clean-room implementation.
 * Behavioral inputs: docs/evolution/piano-post-verdetto.001.md section 12.
 * External source code or prompts copied: none.
 * Existing DS4 mechanisms reused: RunStore blob read (evolutionFeedbackContext.mjs).
 */

export class EvolutionEvaluatorOutputError extends Error {
  constructor(code, message, details = {}) {
    super(`${code}: ${message}`);
    this.name = "EvolutionEvaluatorOutputError";
    this.code = code;
    this.details = details;
  }
}

const ALLOWED_KEYS = new Set(["status", "metrics", "violations", "artifacts", "reproducibility", "seed"]);
const ALLOWED_STATUSES = new Set(["passed", "failed", "error", "skipped"]);

export async function readEvaluatorOutput({ runStore, runId, execution, maxBytes = 256_000 } = {}) {
  if (!execution) throw new TypeError("execution is required");

  if (execution.status !== "success") {
    return {
      status: execution.status === "infrastructure_error" ? "error" : "failed",
      metrics: {},
      violations: execution.violations?.length ? [...execution.violations] : ["EVALUATOR_COMMAND_FAILED"],
      artifacts: [execution.stdoutArtifact, execution.stderrArtifact].filter(Boolean),
      reproducibility: execution.reproducibility ?? null
    };
  }

  let rawText;

  if (execution.stdoutArtifact) {
    if (!runStore) {
      if (execution.outputTruncated === true) {
        throw new EvolutionEvaluatorOutputError("EVALUATOR_OUTPUT_TRUNCATED_NO_ARTIFACT", "stdout preview is truncated and no runStore is available");
      }
      rawText = execution.stdoutPreview ?? "";
    } else {
      let blob;
      try {
        blob = await runStore.getBlob(runId, execution.stdoutArtifact);
      } catch (error) {
        throw new EvolutionEvaluatorOutputError("EVALUATOR_ARTIFACT_READ_FAILED", String(error.message));
      }
      if (Buffer.byteLength(blob) > maxBytes) {
        throw new EvolutionEvaluatorOutputError("EVALUATOR_OUTPUT_OVERSIZED", `output exceeds ${maxBytes} bytes`);
      }
      rawText = typeof blob === "string" ? blob : blob.toString("utf8");
    }
  } else {
    if (execution.outputTruncated === true) {
      throw new EvolutionEvaluatorOutputError("EVALUATOR_OUTPUT_TRUNCATED_NO_ARTIFACT", "stdout preview is truncated and no artifact is available");
    }
    rawText = execution.stdoutPreview ?? "";
  }

  let parsed;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new EvolutionEvaluatorOutputError("EVALUATOR_OUTPUT_INVALID_JSON", "evaluator output is not valid JSON");
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new EvolutionEvaluatorOutputError("EVALUATOR_OUTPUT_NOT_OBJECT", "evaluator output must be a plain object");
  }

  const keys = Object.keys(parsed);
  for (const key of keys) {
    if (!ALLOWED_KEYS.has(key)) {
      throw new EvolutionEvaluatorOutputError("EVALUATOR_OUTPUT_UNKNOWN_KEY", `unexpected key: ${key}`);
    }
  }

  if (parsed.status !== undefined && !ALLOWED_STATUSES.has(parsed.status)) {
    throw new EvolutionEvaluatorOutputError("EVALUATOR_OUTPUT_INVALID_STATUS", `unknown status: ${parsed.status}`);
  }

  if (parsed.metrics !== undefined && (typeof parsed.metrics !== "object" || Array.isArray(parsed.metrics))) {
    throw new EvolutionEvaluatorOutputError("EVALUATOR_OUTPUT_INVALID_METRICS", "metrics must be an object");
  }

  if (parsed.violations !== undefined && !Array.isArray(parsed.violations)) {
    throw new EvolutionEvaluatorOutputError("EVALUATOR_OUTPUT_INVALID_VIOLATIONS", "violations must be an array");
  }

  const artifactIds = (parsed.artifacts ?? []).map((entry) => {
    if (typeof entry === "string") return entry;
    if (entry && typeof entry === "object" && typeof entry.id === "string") return entry.id;
    throw new EvolutionEvaluatorOutputError("EVALUATOR_OUTPUT_INVALID_ARTIFACT", "artifacts must be strings or {id} objects");
  });

  return {
    status: parsed.status,
    metrics: parsed.metrics ?? {},
    violations: parsed.violations ?? [],
    artifacts: [execution.stdoutArtifact, execution.stderrArtifact, ...artifactIds].filter(Boolean),
    reproducibility: { ...execution.reproducibility, seed: parsed.seed ?? null }
  };
}
