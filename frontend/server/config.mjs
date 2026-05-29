import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_CONFIG } from "./defaultConfig.mjs";

export { buildDs4Args } from "./commandBuilder.mjs";

const FRONTEND_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const CONFIG_PATH = path.resolve(
  process.env.DS4_UI_CONFIG || path.join(FRONTEND_ROOT, "ds4-ui.config.json")
);

const BACKENDS = new Set(["auto", "metal", "cuda", "cpu"]);
const LOOPBACK_CONTROL_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);
const DECIMAL_INTEGER = /^[0-9]+$/;
const DECIMAL_FLOAT = /^[+-]?(?:(?:[0-9]+(?:\.[0-9]*)?)|(?:\.[0-9]+))(?:[eE][+-]?[0-9]+)?$/;
const INT_MAX = 2147483647;
const INT_MAX_BIGINT = BigInt(INT_MAX);

export function mergeConfig(input = {}) {
  return {
    selectedProfile: typeof input.selectedProfile === "string"
      ? input.selectedProfile
      : DEFAULT_CONFIG.selectedProfile,
    control: {
      ...DEFAULT_CONFIG.control,
      ...(input.control || {})
    },
    history: {
      ...DEFAULT_CONFIG.history,
      ...(input.history || {})
    },
    server: {
      ...DEFAULT_CONFIG.server,
      ...(input.server || {})
    }
  };
}

function isPositiveInt(value) {
  const n = parseDecimalInteger(value);
  return n !== null && n > 0;
}

function isNonNegativeInt(value) {
  return parseDecimalInteger(value) !== null;
}

function parseDecimalInteger(value) {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= INT_MAX) return value;
  if (typeof value === "string" && DECIMAL_INTEGER.test(value) && BigInt(value) <= INT_MAX_BIGINT) {
    return Number(value);
  }
  return null;
}

function validatePort(value) {
  const n = parseDecimalInteger(value);
  return n !== null && n >= 1 && n <= 65535;
}

function parseDecimalFloat(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && DECIMAL_FLOAT.test(value)) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function validateFloatRange(value, min, max, { optional = false } = {}) {
  if (optional && value === "") return true;
  const n = parseDecimalFloat(value);
  return n !== null && n >= min && n <= max;
}

export function validateConfig(config) {
  const errors = { control: {}, history: {}, server: {} };
  if (!validatePort(config.control.port)) errors.control.port = "must be between 1 and 65535";
  if (!validatePort(config.server.port)) errors.server.port = "must be between 1 and 65535";
  if (!config.control.host) errors.control.host = "is required";
  else if (!LOOPBACK_CONTROL_HOSTS.has(config.control.host)) errors.control.host = "must be loopback-only";
  if (!config.server.host) errors.server.host = "is required";
  if (!config.server.binary) errors.server.binary = "is required";
  if (!config.server.model) errors.server.model = "is required";
  if (config.history.enabled && !String(config.history.dir || "").trim()) {
    errors.history.dir = "is required when history is enabled";
  }
  for (const key of ["ctx", "tokens", "mtpDraft", "kvDiskSpaceMb", "kvCacheMinTokens", "toolMemoryMaxIds"]) {
    if (!isPositiveInt(config.server[key])) errors.server[key] = "must be a positive integer";
  }
  for (const key of [
    "threads",
    "kvCacheColdMaxTokens",
    "kvCacheContinuedIntervalTokens",
    "kvCacheBoundaryTrimTokens",
    "kvCacheBoundaryAlignTokens"
  ]) {
    if (!isNonNegativeInt(config.server[key])) errors.server[key] = "must be a non-negative integer";
  }
  if (
    !validateFloatRange(config.server.mtpMargin, 0, 1000)
  ) {
    errors.server.mtpMargin = "must be between 0 and 1000";
  }
  if (!validateFloatRange(config.server.dirSteeringFfn, -100, 100, { optional: true })) {
    errors.server.dirSteeringFfn = "must be between -100 and 100";
  }
  if (!validateFloatRange(config.server.dirSteeringAttn, -100, 100, { optional: true })) {
    errors.server.dirSteeringAttn = "must be between -100 and 100";
  }
  const kvCacheMinTokens = parseDecimalInteger(config.server.kvCacheMinTokens);
  const kvCacheColdMaxTokens = parseDecimalInteger(config.server.kvCacheColdMaxTokens);
  if (
    kvCacheMinTokens !== null &&
    kvCacheColdMaxTokens !== null &&
    kvCacheColdMaxTokens > 0 &&
    kvCacheColdMaxTokens < kvCacheMinTokens
  ) {
    errors.server.kvCacheColdMaxTokens = "must be 0 or >= kv cache min tokens";
  }
  if (!BACKENDS.has(config.server.backend)) {
    errors.server.backend = "must be one of auto, metal, cuda, cpu";
  }
  const ok =
    Object.keys(errors.control).length === 0 &&
    Object.keys(errors.history).length === 0 &&
    Object.keys(errors.server).length === 0;
  return { ok, errors };
}

export async function loadConfig(configPath = CONFIG_PATH) {
  try {
    const raw = await fs.readFile(configPath, "utf8");
    return mergeConfig(JSON.parse(raw));
  } catch (err) {
    if (err.code === "ENOENT") return mergeConfig();
    throw err;
  }
}

export async function saveConfig(config, configPath = CONFIG_PATH) {
  const merged = mergeConfig(config);
  const validation = validateConfig(merged);
  if (!validation.ok) {
    const err = new Error("invalid config");
    err.validation = validation;
    throw err;
  }
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await fs.writeFile(configPath, `${JSON.stringify(merged, null, 2)}\n`);
  return merged;
}
