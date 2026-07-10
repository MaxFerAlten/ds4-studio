import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_CONFIG, REQUEST_DEFAULTS } from "./defaultConfig.mjs";
import { mergeResearchConfig, validateResearchConfig } from "./research/researchConfig.mjs";

export { buildDs4Args } from "./commandBuilder.mjs";

const FRONTEND_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PROJECT_ROOT = path.resolve(FRONTEND_ROOT, "..");

export const CONFIG_PATH = path.resolve(
  process.env.DS4_UI_CONFIG || path.join(FRONTEND_ROOT, "ds4-ui.config.json")
);
export const DEEP_RESEARCH_CONFIG_PATH = path.resolve(
  process.env.DS4_DEEP_RESEARCH_CONFIG || path.join(PROJECT_ROOT, "config-deepresearch.json")
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

function isPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function deepMergeObjects(...objects) {
  const out = {};
  for (const obj of objects) {
    if (!isPlainObject(obj)) continue;
    for (const [key, value] of Object.entries(obj)) {
      out[key] =
        isPlainObject(value) && isPlainObject(out[key])
          ? deepMergeObjects(out[key], value)
          : value;
    }
  }
  return out;
}

function normalizeDeepResearchConfig(input) {
  if (!isPlainObject(input)) return {};
  return isPlainObject(input.research) ? input.research : input;
}

async function readJsonIfExists(configPath) {
  try {
    const raw = await fs.readFile(configPath, "utf8");
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === "ENOENT") return null;
    throw err;
  }
}

export function mergeConfig(input = {}) {
  const serverInput = input.server || {};
  const serverEnvInput =
    serverInput.env && typeof serverInput.env === "object" && !Array.isArray(serverInput.env)
      ? serverInput.env
      : {};
  const wrapperInput = input.wrapper || {};
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
    },
    wrapper: {
      ...DEFAULT_CONFIG.wrapper,
      ...wrapperInput
    },
    requestDefaults: {
      ...REQUEST_DEFAULTS,
      ...(isPlainObject(input.requestDefaults) ? input.requestDefaults : {})
    },
    research: mergeResearchConfig(input.research),
    callDebug: {
      ...DEFAULT_CONFIG.callDebug,
      ...(input.callDebug && typeof input.callDebug === "object" && !Array.isArray(input.callDebug)
        ? input.callDebug
        : {})
    },
    toolBlobs: {
      ...DEFAULT_CONFIG.toolBlobs,
      ...(input.toolBlobs && typeof input.toolBlobs === "object" && !Array.isArray(input.toolBlobs)
        ? input.toolBlobs
        : {})
    },
    crawl: {
      ...DEFAULT_CONFIG.crawl,
      ...(input.crawl && typeof input.crawl === "object" && !Array.isArray(input.crawl)
        ? input.crawl
        : {})
    },
    pageAgent: {
      ...DEFAULT_CONFIG.pageAgent,
      ...(input.pageAgent && typeof input.pageAgent === "object" && !Array.isArray(input.pageAgent)
        ? input.pageAgent
        : {})
    },
    contextWiki: {
      ...DEFAULT_CONFIG.contextWiki,
      ...(input.contextWiki && typeof input.contextWiki === "object" && !Array.isArray(input.contextWiki)
        ? input.contextWiki
        : {})
    }
  };
}

function validateCallDebug(callDebug = {}) {
  const errors = {};
  if (typeof callDebug.enabled !== "boolean") errors.enabled = "must be boolean";
  if (typeof callDebug.dir !== "string" || !callDebug.dir.trim()) errors.dir = "is required";
  for (const [key, min, max] of [
    ["maxEntries", 1, 100000],
    ["maxBodyChars", 0, 1000000],
    ["maxFileBytes", 1000, 1000000000]
  ]) {
    const value = callDebug[key];
    if (!Number.isInteger(value) || value < min || value > max) {
      errors[key] = `must be an integer between ${min} and ${max}`;
    }
  }
  if (
    !Array.isArray(callDebug.excludePaths) ||
    callDebug.excludePaths.some((p) => typeof p !== "string")
  ) {
    errors.excludePaths = "must be an array of strings";
  }
  return errors;
}

function validateToolBlobs(toolBlobs = {}) {
  const errors = {};
  if (typeof toolBlobs.dir !== "string" || !toolBlobs.dir.trim()) errors.dir = "is required";
  return errors;
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
    const value = env[key] ?? "";
    if (value !== "" && value !== "1") {
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
  const errors = { control: {}, history: {}, server: {}, wrapper: {}, requestDefaults: {}, research: {}, callDebug: {}, pageAgent: {} };
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
  // Wrapper validation
  if (typeof config.wrapper.enabled !== "boolean") errors.wrapper.enabled = "must be boolean";
  if (!config.wrapper.binary || typeof config.wrapper.binary !== "string" || !config.wrapper.binary.trim()) errors.wrapper.binary = "is required";
  const validStartupModes = new Set(["server", "agent"]);
  if (!validStartupModes.has(config.wrapper.startupMode)) errors.wrapper.startupMode = "must be 'server' or 'agent'";
  if (typeof config.wrapper.freezeOnSwitch !== "boolean") errors.wrapper.freezeOnSwitch = "must be boolean";
  if (typeof config.wrapper.freeInactiveSession !== "boolean") errors.wrapper.freeInactiveSession = "must be boolean";
  if (typeof config.wrapper.mutualExclusive !== "boolean") errors.wrapper.mutualExclusive = "must be boolean";
  if (typeof config.wrapper.agentEnabledAtStartup !== "boolean") errors.wrapper.agentEnabledAtStartup = "must be boolean";
  if (!isNonNegativeInt(config.wrapper.ramFreezeMaxMb)) errors.wrapper.ramFreezeMaxMb = "must be a non-negative integer";
  if (!isPositiveInt(config.wrapper.modeSwitchTimeoutMs)) errors.wrapper.modeSwitchTimeoutMs = "must be a positive integer";
  const requestDefaults = config.requestDefaults || {};
  const maxTokens = requestDefaults.max_tokens;
  const maxTokensIsAuto = typeof maxTokens === "string" && maxTokens.trim().toLowerCase() === "auto";
  if (!maxTokensIsAuto && !isPositiveInt(maxTokens)) {
    errors.requestDefaults.max_tokens = "must be 'auto' or a positive integer";
  }
  if (!isPositiveInt(requestDefaults.max_tokens_safety_cap)) {
    errors.requestDefaults.max_tokens_safety_cap = "must be a positive integer";
  }
  if (!isNonNegativeInt(requestDefaults.context_margin)) {
    errors.requestDefaults.context_margin = "must be a non-negative integer";
  }
  errors.research = validateResearchConfig(config.research || {});
  errors.callDebug = validateCallDebug(config.callDebug || {});
  errors.toolBlobs = validateToolBlobs(config.toolBlobs || {});
  // PageAgent validation
  const pa = config.pageAgent || {};
  if (typeof pa.enabled !== "boolean") errors.pageAgent.enabled = "must be boolean";
  if (typeof pa.clientUiEnabled !== "boolean") errors.pageAgent.clientUiEnabled = "must be boolean";
  if (typeof pa.serverBrowserEnabled !== "boolean") errors.pageAgent.serverBrowserEnabled = "must be boolean";
  if (typeof pa.mcpEnabled !== "boolean") errors.pageAgent.mcpEnabled = "must be boolean";
  if (typeof pa.model !== "string" || !pa.model.trim()) errors.pageAgent.model = "is required";
  if (typeof pa.baseURL !== "string" || !pa.baseURL.trim()) errors.pageAgent.baseURL = "is required";
  if (typeof pa.apiKey !== "string") errors.pageAgent.apiKey = "must be a string";
  if (typeof pa.language !== "string" || !pa.language.trim()) errors.pageAgent.language = "is required";
  if (!isPositiveInt(pa.maxSteps) || pa.maxSteps > 40) errors.pageAgent.maxSteps = "must be an integer between 1 and 40";
  if (!isPositiveInt(pa.actionTimeoutMs) || pa.actionTimeoutMs < 1000 || pa.actionTimeoutMs > 600000) errors.pageAgent.actionTimeoutMs = "must be between 1000 and 600000";
  if (typeof pa.requireConfirmation !== "boolean") errors.pageAgent.requireConfirmation = "must be boolean";
  if (typeof pa.experimentalScriptExecutionTool !== "boolean") errors.pageAgent.experimentalScriptExecutionTool = "must be boolean";
  if (typeof pa.allowExternalDomains !== "boolean") errors.pageAgent.allowExternalDomains = "must be boolean";
  if (!Array.isArray(pa.allowedOrigins) || pa.allowedOrigins.some(o => typeof o !== "string")) errors.pageAgent.allowedOrigins = "must be an array of strings";
  if (typeof pa.auditDir !== "string" || !pa.auditDir.trim()) errors.pageAgent.auditDir = "is required";
  const ok =
    Object.keys(errors.control).length === 0 &&
    Object.keys(errors.history).length === 0 &&
    Object.keys(errors.server).length === 0 &&
    Object.keys(errors.wrapper).length === 0 &&
    Object.keys(errors.requestDefaults).length === 0 &&
    Object.keys(errors.research).length === 0 &&
    Object.keys(errors.callDebug).length === 0 &&
    Object.keys(errors.toolBlobs).length === 0 &&
    Object.keys(errors.pageAgent).length === 0;
  return { ok, errors };
}

export function redactConfigSecrets(config = {}) {
  const copy = JSON.parse(JSON.stringify(config || {}));
  if (typeof copy.research?.gemini?.apiKey === "string" && copy.research.gemini.apiKey) {
    copy.research.gemini.apiKey = "";
  }
  const providers = copy.research?.search?.providers;
  if (providers && typeof providers === "object" && !Array.isArray(providers)) {
    for (const provider of Object.values(providers)) {
      if (typeof provider?.apiKey === "string" && provider.apiKey) provider.apiKey = "";
    }
  }
  return copy;
}

export async function loadDeepResearchConfig(configPath = DEEP_RESEARCH_CONFIG_PATH) {
  const raw = await readJsonIfExists(configPath);
  return normalizeDeepResearchConfig(raw || {});
}

export async function loadConfig(configPath = CONFIG_PATH, deepResearchConfigPath = DEEP_RESEARCH_CONFIG_PATH) {
  const input = (await readJsonIfExists(configPath)) || {};
  const deepResearch = deepResearchConfigPath
    ? await loadDeepResearchConfig(deepResearchConfigPath)
    : {};
  const uiResearch = isPlainObject(input.research) ? input.research : {};
  return mergeConfig({
    ...input,
    research: deepMergeObjects(deepResearch, uiResearch)
  });
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
