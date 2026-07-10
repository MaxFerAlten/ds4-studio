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

export function readContextConfig(env = process.env) {
  const hard = readPositiveIntEnv(env, "DS4_CONTEXT_CAPSULE_HARD_TOKENS", DEFAULT_CONTEXT_LIMITS.hardTokens);
  const softRaw = readPositiveIntEnv(env, "DS4_CONTEXT_CAPSULE_SOFT_TOKENS", DEFAULT_CONTEXT_LIMITS.softTokens);
  const soft = Math.min(softRaw, hard);
  return {
    enabled: readBoolEnv(env, "DS4_CONTEXT_WIKI_ENABLED", DEFAULT_CONTEXT_LIMITS.enabled),
    previewOnly: readBoolEnv(env, "DS4_CONTEXT_PREVIEW_ONLY", DEFAULT_CONTEXT_LIMITS.previewOnly),
    softTokens: soft,
    hardTokens: hard,
    maxGrowthPct: readPositiveIntEnv(env, "DS4_CONTEXT_CAPSULE_MAX_GROWTH_PCT", DEFAULT_CONTEXT_LIMITS.maxGrowthPct),
    maxEvidence: readPositiveIntEnv(env, "DS4_CONTEXT_CAPSULE_MAX_EVIDENCE", DEFAULT_CONTEXT_LIMITS.maxEvidence),
    deltaRequired: readBoolEnv(env, "DS4_CONTEXT_DELTA_REQUIRED", DEFAULT_CONTEXT_LIMITS.deltaRequired),
    telemetry: readBoolEnv(env, "DS4_CONTEXT_LOG_TELEMETRY", DEFAULT_CONTEXT_LIMITS.telemetry),
    maxLedgerEvents: readPositiveIntEnv(env, "DS4_CONTEXT_MAX_LEDGER_EVENTS", DEFAULT_CONTEXT_LIMITS.maxLedgerEvents)
  };
}
