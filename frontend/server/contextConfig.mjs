import { readPositiveIntEnv } from "./costLimits.mjs";

export const DEFAULT_CONTEXT_LIMITS = Object.freeze({
  enabled: false,
  previewOnly: true,
  softTokens: 1500,
  hardTokens: 3000,
  maxGrowthPct: 25,
  maxEvidence: 10,
  deltaRequired: true,
  telemetry: true,
  maxLedgerEvents: 5000
});

export function readBoolEnv(env, key, fallback) {
  const raw = env?.[key];
  if (raw === undefined || raw === null || raw === "") return fallback;
  if (["1", "true", "yes", "on"].includes(String(raw).toLowerCase())) return true;
  if (["0", "false", "no", "off"].includes(String(raw).toLowerCase())) return false;
  return fallback;
}

/** The file value when it is usable, the canonical default otherwise. */
function fileBool(fileConfig, key) {
  return typeof fileConfig[key] === "boolean" ? fileConfig[key] : DEFAULT_CONTEXT_LIMITS[key];
}

function filePositiveInt(fileConfig, key) {
  const value = fileConfig[key];
  return Number.isInteger(value) && value > 0 ? value : DEFAULT_CONTEXT_LIMITS[key];
}

/**
 * Resolve the nine ContextWiki limits.
 *
 *   env valida > ds4-ui.config.json contextWiki > DEFAULT_CONTEXT_LIMITS
 *
 * The file layer is passed in — this module never reads ds4-ui.config.json
 * itself. Calling it with one argument keeps the old env-or-default behaviour.
 *
 * @param {object} [env] - Environment object (default process.env)
 * @param {object} [fileConfig] - The `contextWiki` block from the config file.
 */
export function readContextConfig(env = process.env, fileConfig = {}) {
  const file =
    fileConfig && typeof fileConfig === "object" && !Array.isArray(fileConfig) ? fileConfig : {};
  const hard = readPositiveIntEnv(env, "DS4_CONTEXT_CAPSULE_HARD_TOKENS", filePositiveInt(file, "hardTokens"));
  const softRaw = readPositiveIntEnv(env, "DS4_CONTEXT_CAPSULE_SOFT_TOKENS", filePositiveInt(file, "softTokens"));
  const soft = Math.min(softRaw, hard);
  return {
    enabled: readBoolEnv(env, "DS4_CONTEXT_WIKI_ENABLED", fileBool(file, "enabled")),
    previewOnly: readBoolEnv(env, "DS4_CONTEXT_PREVIEW_ONLY", fileBool(file, "previewOnly")),
    softTokens: soft,
    hardTokens: hard,
    maxGrowthPct: readPositiveIntEnv(env, "DS4_CONTEXT_CAPSULE_MAX_GROWTH_PCT", filePositiveInt(file, "maxGrowthPct")),
    maxEvidence: readPositiveIntEnv(env, "DS4_CONTEXT_CAPSULE_MAX_EVIDENCE", filePositiveInt(file, "maxEvidence")),
    deltaRequired: readBoolEnv(env, "DS4_CONTEXT_DELTA_REQUIRED", fileBool(file, "deltaRequired")),
    telemetry: readBoolEnv(env, "DS4_CONTEXT_LOG_TELEMETRY", fileBool(file, "telemetry")),
    maxLedgerEvents: readPositiveIntEnv(env, "DS4_CONTEXT_MAX_LEDGER_EVENTS", filePositiveInt(file, "maxLedgerEvents"))
  };
}
