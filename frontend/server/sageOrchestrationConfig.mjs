// Sage autonomous-orchestration budget for ds4-studio.
//
// Precedence is the one the rest of the control plane uses:
//
//   env definita > config JSON (ds4-ui.config.json sage.orchestration) > default
//
// The defaults are not literals here: they come from
// config/sage-orchestration-policy.json, the same file
// scripts/generate-sage-orchestration-policy.mjs turns into the C header. That
// file is the only place a Sage budget number is allowed to live.

import { readFileSync } from "fs";
import {
  resolveBooleanLayer as resolveBoolean,
  SAGE_AUTONOMOUS_ORCHESTRATION_ALIASES,
} from "./envBoolean.mjs";

const POLICY_URL = new URL("../../config/sage-orchestration-policy.json", import.meta.url);

/** Canonical defaults, read once from the shared policy file. */
export const SAGE_ORCHESTRATION_DEFAULTS = Object.freeze(
  (() => {
    const raw = JSON.parse(readFileSync(POLICY_URL, "utf8"));
    return {
      version: raw.version,
      maxComputeAttempts: raw.maxComputeAttempts,
      maxRepairAttempts: raw.maxRepairAttempts,
      maxValidationAttempts: raw.maxValidationAttempts,
      maxPlotAttempts: raw.maxPlotAttempts,
      maxPrematureFinalizations: raw.maxPrematureFinalizations,
      maxSameFailure: raw.maxSameFailure,
      maxWallClockMs: raw.maxWallClockMs,
      maxTotalToolCalls: raw.maxTotalToolCalls,
      hardMaxTotalCalls: raw.hardMaxTotalCalls,
      hardMaxWallClockMs: raw.hardMaxWallClockMs,
    };
  })()
);

/**
 * Task types that cannot be published without their plot package.
 * Shared with the tracker, the publication gate and (in its own vocabulary)
 * quality_gate.requires_plots on the Python side.
 */
export const SAGE_PLOT_REQUIRED_TASK_TYPES = Object.freeze(["function_study", "plot"]);

/** Artifact kinds a function study must deliver before it can be published. */
export const SAGE_FUNCTION_STUDY_ARTIFACT_KINDS = Object.freeze([
  "function_plot",
  "first_derivative_plot",
  "second_derivative_plot",
]);

/** Clamp bounds. An out-of-range value is coerced, never silently accepted. */
const BOUNDS = Object.freeze({
  maxComputeAttempts: [1, 3],
  maxRepairAttempts: [1, 8],
  maxValidationAttempts: [1, 10],
  maxPlotAttempts: [1, 5],
  maxPrematureFinalizations: [1, 10],
  maxSameFailure: [1, 3],
  maxWallClockMs: [30_000, 1_800_000],
  maxTotalToolCalls: [2, 24],
});

const ENV_KEYS = Object.freeze({
  maxComputeAttempts: "DS4_SAGE_MAX_COMPUTE_ATTEMPTS",
  maxRepairAttempts: "DS4_SAGE_MAX_REPAIR_ATTEMPTS",
  maxValidationAttempts: "DS4_SAGE_MAX_VALIDATION_ATTEMPTS",
  maxPlotAttempts: "DS4_SAGE_MAX_PLOT_ATTEMPTS",
  maxPrematureFinalizations: "DS4_SAGE_MAX_PREMATURE_FINALIZATIONS",
  maxSameFailure: "DS4_SAGE_MAX_SAME_FAILURE",
  maxWallClockMs: "DS4_SAGE_WALL_CLOCK_MS",
  maxTotalToolCalls: "DS4_SAGE_MAX_TOTAL_TOOL_CALLS",
});

function clamp(value, [min, max]) {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function parseInteger(value) {
  if (value === undefined || value === null || String(value).trim() === "") return null;
  const n = Number(value);
  return Number.isInteger(n) ? n : null;
}

/**
 * Structural check on a resolved (or hand-written) orchestration block.
 * Returns the list of problems; an empty list means the value is usable.
 */
export function validateSageOrchestrationConfig(value) {
  const errors = [];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return ["sage.orchestration must be an object"];
  }
  for (const [key, bounds] of Object.entries(BOUNDS)) {
    const parsed = parseInteger(value[key]);
    if (parsed === null) {
      errors.push(`sage.orchestration.${key} must be an integer`);
      continue;
    }
    if (parsed < bounds[0] || parsed > bounds[1]) {
      errors.push(
        `sage.orchestration.${key}=${parsed} is out of range [${bounds[0]}, ${bounds[1]}]`
      );
    }
  }
  // A single compute plus every repair must stay inside the call ceiling,
  // otherwise the budget promises attempts the ceiling will refuse.
  const compute = parseInteger(value.maxComputeAttempts);
  const repair = parseInteger(value.maxRepairAttempts);
  const validate = parseInteger(value.maxValidationAttempts);
  const plot = parseInteger(value.maxPlotAttempts);
  const total = parseInteger(value.maxTotalToolCalls);
  if (compute !== null && repair !== null && validate !== null && plot !== null && total !== null) {
    const needed = compute + repair + validate + plot;
    if (needed > total) {
      errors.push(
        `sage.orchestration.maxTotalToolCalls=${total} is below the sum of the phase ` +
          `budgets (${needed}); the ceiling would cut the workflow short`
      );
    }
  }
  return errors;
}

/**
 * Resolve the effective Sage orchestration budget.
 *
 * @param {object} [env] - Environment object (default process.env)
 * @param {object} [fileConfig] - The `sage.orchestration` block from
 *   ds4-ui.config.json, already merged by config.validateConfig.
 */
export function resolveSageOrchestrationConfig(env = process.env, fileConfig = {}) {
  const file =
    fileConfig && typeof fileConfig === "object" && !Array.isArray(fileConfig) ? fileConfig : {};
  const warnings = [];
  const sources = {};
  const resolved = {};

  for (const key of Object.keys(BOUNDS)) {
    const envKey = ENV_KEYS[key];
    const raw = env[envKey];
    let value;
    if (raw !== undefined && raw !== null && String(raw).trim() !== "") {
      const fromEnv = parseInteger(raw);
      if (fromEnv === null) {
        warnings.push(`${envKey}='${raw}' is not an integer; using the config file value`);
      } else {
        value = fromEnv;
        sources[key] = "env";
      }
    }
    if (value === undefined) {
      const fromFile = parseInteger(file[key]);
      if (fromFile !== null) {
        value = fromFile;
        sources[key] = "file";
      } else {
        value = SAGE_ORCHESTRATION_DEFAULTS[key];
        sources[key] = "default";
      }
    }
    const clamped = clamp(value, BOUNDS[key]);
    if (clamped !== value) {
      warnings.push(
        `${key}=${value} is out of range [${BOUNDS[key][0]}, ${BOUNDS[key][1]}]; clamped to ${clamped}`
      );
    }
    resolved[key] = clamped;
  }

  // The phase budgets must fit inside the call ceiling. Raising the ceiling is
  // the safe correction: lowering a phase budget would silently shorten the
  // workflow the user asked for.
  const needed =
    resolved.maxComputeAttempts +
    resolved.maxRepairAttempts +
    resolved.maxValidationAttempts +
    resolved.maxPlotAttempts;
  if (needed > resolved.maxTotalToolCalls) {
    const raised = Math.min(needed, BOUNDS.maxTotalToolCalls[1]);
    warnings.push(
      `maxTotalToolCalls=${resolved.maxTotalToolCalls} is below the sum of the phase budgets ` +
        `(${needed}); raised to ${raised}`
    );
    resolved.maxTotalToolCalls = raised;
  }

  // §26 rollback switch. It restores the previous publication gate behaviour —
  // it never restores publication of an unvalidated candidate.
  const enabled = resolveBoolean({
    env,
    envKey: "DS4_SAGE_AUTONOMOUS_ORCHESTRATION",
    aliases: SAGE_AUTONOMOUS_ORCHESTRATION_ALIASES,
    fileValue: file.enabled,
    defaultValue: true,
    sources,
    key: "enabled",
    warnings,
  });
  // Selects the base or the autonomous prompt bundle. Off by default, like the
  // native runtime.
  const prompt = resolveBoolean({
    env,
    envKey: "DS4_SAGE_AUTONOMOUS_PROMPT",
    fileValue: file.prompt,
    defaultValue: false,
    sources,
    key: "prompt",
    warnings,
  });

  return {
    enabled,
    prompt,
    version: SAGE_ORCHESTRATION_DEFAULTS.version,
    ...resolved,
    hardMaxTotalCalls: SAGE_ORCHESTRATION_DEFAULTS.hardMaxTotalCalls,
    hardMaxWallClockMs: SAGE_ORCHESTRATION_DEFAULTS.hardMaxWallClockMs,
    plotRequiredTaskTypes: [...SAGE_PLOT_REQUIRED_TASK_TYPES],
    functionStudyArtifactKinds: [...SAGE_FUNCTION_STUDY_ARTIFACT_KINDS],
    sources,
    warnings,
  };
}

/** True when the task type cannot be published without its plot package. */
export function sageTaskRequiresPlots(taskType) {
  return SAGE_PLOT_REQUIRED_TASK_TYPES.includes(String(taskType ?? "").trim().toLowerCase());
}
