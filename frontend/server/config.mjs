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
const DS4_ENV_KEY = /^DS4_[A-Z0-9_]+$/;
const INT_MAX = 2147483647;
const INT_MAX_BIGINT = BigInt(INT_MAX);
const SERVER_ENV_KEYS = new Set(Object.keys(DEFAULT_CONFIG.server.env || {}));
const CUDA_PRESENCE_FLAGS = new Set([
  "DS4_CUDA_COPY_MODEL_CHUNKED",
  "DS4_CUDA_DIRECT_MODEL",
  "DS4_CUDA_NO_FD_CACHE",
  "DS4_CUDA_MOE_PROFILE",
  "DS4_METAL_GRAPH_PREFILL_PROFILE",
  "DS4_CUDA_MOE_NO_EXPERT_TILES",
  "DS4_CUDA_MOE_TILE4",
  "DS4_CUDA_MOE_WRITE_GATE_UP",
  "DS4_CUDA_MOE_NO_P2",
  "DS4_CUDA_MOE_ATOMIC_DOWN",
  "DS4_CUDA_MOE_NO_ATOMIC_DOWN",
  "DS4_CUDA_MOE_GATE_ROW512",
  "DS4_CUDA_MOE_GATE_ROW2048",
  "DS4_CUDA_MOE_GATE_ROW256",
  "DS4_CUDA_MOE_GATE_ROW128",
  "DS4_CUDA_MOE_NO_GATE_ROW2048",
  "DS4_CUDA_MOE_NO_GATE_ROW256",
  "DS4_CUDA_MOE_NO_GATE_ROW128",
  "DS4_CUDA_MOE_NO_DOWN_TILE16",
  "DS4_CUDA_MOE_NO_DECODE_LUT_GATE",
  "DS4_CUDA_MOE_DOWN_ROW512",
  "DS4_CUDA_MOE_DOWN_ROW1024",
  "DS4_CUDA_MOE_DOWN_ROW2048",
  "DS4_CUDA_MOE_DOWN_ROW256",
  "DS4_CUDA_MOE_DOWN_ROW128",
  "DS4_CUDA_MOE_DOWN_ROW64",
  "DS4_CUDA_MOE_NO_DOWN_ROW2048",
  "DS4_CUDA_MOE_NO_DOWN_ROW256",
  "DS4_CUDA_MOE_NO_DOWN_ROW128",
  "DS4_CUDA_MOE_NO_DOWN_ROW64",
  "DS4_CUDA_MOE_NO_DIRECT_DOWN_SUM6"
]);

export function mergeConfig(input = {}) {
  const serverInput = input.server || {};
  const serverEnvInput =
    serverInput.env && typeof serverInput.env === "object" && !Array.isArray(serverInput.env)
      ? serverInput.env
      : {};
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
      ...serverInput,
      env: {
        ...DEFAULT_CONFIG.server.env,
        ...serverEnvInput
      }
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

function validateOptionalEnvMiB(env, key, label, min, max, { minMessage = false } = {}) {
  const value = env[key];
  if (value === "") return "";
  const n = parseDecimalInteger(value);
  if (n === null || n < min || n > max) {
    if (minMessage) return `${label} must be at least ${min} MiB and at most ${max} MiB`;
    return `${label} must be between ${min} and ${max} MiB`;
  }
  return "";
}

function validateCudaEnv(env) {
  for (const key of CUDA_PRESENCE_FLAGS) {
    if (env[key] !== "" && env[key] !== "1") {
      return `${key} must be empty or 1`;
    }
  }
  return (
    validateOptionalEnvTokens(env, "DS4_METAL_PREFILL_CHUNK", "prefill chunk", 1, 131072) ||
    validateOptionalEnvMiB(env, "DS4_CUDA_Q8_F16_CACHE_MB", "Q8/F16 cache", 0, 12288) ||
    validateOptionalEnvMiB(env, "DS4_CUDA_Q8_F16_CACHE_RESERVE_MB", "Q8/F16 reserve", 512, 65536, { minMessage: true }) ||
    validateOptionalEnvMiB(env, "DS4_CUDA_WEIGHT_ARENA_CHUNK_MB", "CUDA weight arena", 256, 8192)
  );
}

function validateOptionalEnvTokens(env, key, label, min, max) {
  const value = env[key];
  if (value === "") return "";
  const n = parseDecimalInteger(value);
  if (n === null || n < min || n > max) {
    return `${label} must be between ${min} and ${max} tokens`;
  }
  return "";
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
  for (const key of [
    "ctx",
    "tokens",
    "mtpDraft",
    "kvDiskSpaceMb",
    "kvCacheMinTokens",
    "toolMemoryMaxIds",
    "maxQueuedJobs"
  ]) {
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
  if (!config.server.env || typeof config.server.env !== "object" || Array.isArray(config.server.env)) {
    errors.server.env = "must be an object";
  } else {
    for (const [key, value] of Object.entries(config.server.env)) {
      if (!SERVER_ENV_KEYS.has(key) && !DS4_ENV_KEY.test(key)) {
        errors.server.env = `unsupported env key: ${key}`;
        break;
      }
      if (typeof value !== "string") {
        errors.server.env = "env values must be strings";
        break;
      }
    }
    if (!errors.server.env) {
      const cudaEnvError = validateCudaEnv(config.server.env);
      if (cudaEnvError) errors.server.env = cudaEnvError;
    }
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
