// Top-level Sage configuration resolver.
//
// Lean already had one (lean/leanConfig.mjs); Sage only had the orchestration
// budget, so sage.policyAuto had no resolver at all and lived as a server.env
// string. Same precedence as everywhere else in the control plane:
//
//   env definita > config JSON (ds4-ui.config.json sage) > default
//
// The budget is not re-resolved here: resolveSageOrchestrationConfig stays the
// single owner of those numbers.

import { resolveBooleanLayer } from "./envBoolean.mjs";
import { resolveSageOrchestrationConfig } from "./sageOrchestrationConfig.mjs";

/** Deprecated spelling of DS4_SAGE_POLICY_AUTO, kept for srun.sh compatibility. */
export const SAGE_POLICY_AUTO_ALIASES = Object.freeze(["DS4_SAGE_SKILL_AUTO"]);

/**
 * @param {object} [env] - Environment object (default process.env)
 * @param {object} [fileConfig] - The `sage` block from ds4-ui.config.json.
 * @returns {{ config: object, sources: { policyAuto: string }, warnings: string[] }}
 */
export function resolveSageConfig(env = process.env, fileConfig = {}) {
  const file =
    fileConfig && typeof fileConfig === "object" && !Array.isArray(fileConfig) ? fileConfig : {};
  const warnings = [];
  const sources = {};

  const policyAuto = resolveBooleanLayer({
    env,
    envKey: "DS4_SAGE_POLICY_AUTO",
    aliases: SAGE_POLICY_AUTO_ALIASES,
    fileValue: file.policyAuto,
    defaultValue: true,
    sources,
    key: "policyAuto",
    warnings,
  });

  const orchestration = resolveSageOrchestrationConfig(env, file.orchestration);
  warnings.push(...orchestration.warnings);

  return {
    config: {
      ...file,
      policyAuto,
      orchestration,
    },
    sources,
    warnings,
  };
}
