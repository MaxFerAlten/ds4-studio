// Lean autonomous-orchestration budget for ds4-studio.
//
// Precedence is the same the rest of the control plane uses:
//
//   env definita > config JSON (ds4-ui.config.json lean.orchestration) > default
//
// The defaults are not literals here: they come from
// config/lean-orchestration-policy.json, the same file
// scripts/generate-lean-orchestration-policy.mjs turns into the C header. That
// is what keeps the native and the JS orchestrator on one budget instead of two
// that drift.

import { readFileSync } from "fs";
import { resolveBooleanLayer as resolveBoolean } from "../envBoolean.mjs";

const POLICY_URL = new URL("../../../config/lean-orchestration-policy.json", import.meta.url);

/** Canonical defaults, read once from the shared policy file. */
export const LEAN_ORCHESTRATION_DEFAULTS = Object.freeze(
  (() => {
    const raw = JSON.parse(readFileSync(POLICY_URL, "utf8"));
    return {
      version: raw.version,
      maxAttempts: raw.maxAttempts,
      maxSameFailure: raw.maxSameFailure,
      maxPrematureFinalizations: raw.maxPrematureFinalizations,
      maxWallClockMs: raw.maxWallClockMs,
      strategyChangeAfter: raw.strategyChangeAfter,
    };
  })()
);

/** Clamp bounds. An out-of-range value is coerced, never silently accepted. */
const BOUNDS = Object.freeze({
  maxAttempts: [1, 10],
  maxSameFailure: [1, 3],
  maxPrematureFinalizations: [1, 10],
  maxWallClockMs: [30_000, 900_000],
  strategyChangeAfter: [1, 5],
});

const ENV_KEYS = Object.freeze({
  maxAttempts: "DS4_LEAN_MAX_PROOF_ATTEMPTS",
  maxSameFailure: "DS4_LEAN_MAX_SAME_FAILURE",
  maxPrematureFinalizations: "DS4_LEAN_MAX_PREMATURE_FINALIZATIONS",
  maxWallClockMs: "DS4_LEAN_PROOF_WALL_CLOCK_MS",
  strategyChangeAfter: "DS4_LEAN_STRATEGY_CHANGE_AFTER",
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
 * Resolve the effective orchestration budget.
 *
 * @param {object} [env] - Environment object (default process.env)
 * @param {object} [fileConfig] - The `lean.orchestration` block from
 *   ds4-ui.config.json, already merged by config.validateConfig.
 * @returns {{ enabled: boolean, version: number, maxAttempts: number,
 *   maxSameFailure: number, maxPrematureFinalizations: number,
 *   maxWallClockMs: number, strategyChangeAfter: number,
 *   sources: object, warnings: string[] }}
 */
export function resolveLeanOrchestrationConfig(env = process.env, fileConfig = {}) {
  const file =
    fileConfig && typeof fileConfig === "object" && !Array.isArray(fileConfig) ? fileConfig : {};
  const warnings = [];
  const sources = {};
  const resolved = {};

  for (const key of Object.keys(BOUNDS)) {
    const envKey = ENV_KEYS[key];
    const fromEnv = parseInteger(env[envKey]);
    let value;
    if (env[envKey] !== undefined && env[envKey] !== null && String(env[envKey]).trim() !== "") {
      if (fromEnv === null) {
        warnings.push(`${envKey}='${env[envKey]}' is not an integer; using the config file value`);
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
        value = LEAN_ORCHESTRATION_DEFAULTS[key];
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

  // §22 rollback switch: only the new continuation/finalization gate is turned
  // off. "no checked, no verified" stays true either way — the classifier keeps
  // running, it just stops forcing the loop to continue.
  const enabled = resolveBoolean({
    env,
    envKey: "DS4_LEAN_AUTONOMOUS_ORCHESTRATION",
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
    envKey: "DS4_LEAN_AUTONOMOUS_PROMPT",
    fileValue: file.prompt,
    defaultValue: false,
    sources,
    key: "prompt",
    warnings,
  });

  return {
    enabled,
    prompt,
    version: LEAN_ORCHESTRATION_DEFAULTS.version,
    ...resolved,
    sources,
    warnings,
  };
}
