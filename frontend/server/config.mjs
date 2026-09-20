import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_CONFIG, REQUEST_DEFAULTS } from "./defaultConfig.mjs";
import { mergeResearchConfig, validateResearchConfig } from "./research/researchConfig.mjs";
import { AGENT_TOOL_NAMES } from "./agentToolCatalog.mjs";
import { LEGACY_SEMANTIC_ENV_KEYS, normalizeLegacySemanticEnv } from "./semanticConfig.mjs";

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
  // Old files still carry the six Lean/Sage switches as server.env strings.
  // Migrating here means load, save and the API request merge all see the same
  // typed shape.
  input = normalizeLegacySemanticEnv(input);
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
    evolution: {
      ...DEFAULT_CONFIG.evolution,
      ...(input.evolution && typeof input.evolution === "object" && !Array.isArray(input.evolution)
        ? input.evolution
        : {})
    },
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
    },
    lean: (() => {
      const inputLean =
        input.lean && typeof input.lean === "object" && !Array.isArray(input.lean)
          ? input.lean
          : {};
      const inputOrchestration =
        inputLean.orchestration && typeof inputLean.orchestration === "object" &&
        !Array.isArray(inputLean.orchestration)
          ? inputLean.orchestration
          : {};
      return {
        ...DEFAULT_CONFIG.lean,
        ...inputLean,
        // Merged per-key: a file that overrides only maxAttempts must not drop
        // the rest of the budget onto undefined.
        orchestration: { ...DEFAULT_CONFIG.lean.orchestration, ...inputOrchestration }
      };
    })(),
    sage: (() => {
      const inputSage =
        input.sage && typeof input.sage === "object" && !Array.isArray(input.sage)
          ? input.sage
          : {};
      const inputOrchestration =
        inputSage.orchestration && typeof inputSage.orchestration === "object" &&
        !Array.isArray(inputSage.orchestration)
          ? inputSage.orchestration
          : {};
      return {
        ...DEFAULT_CONFIG.sage,
        ...inputSage,
        // Merged per-key, like lean: overriding one phase budget must not drop
        // the others onto undefined.
        orchestration: { ...DEFAULT_CONFIG.sage.orchestration, ...inputOrchestration }
      };
    })(),
    agno: (() => {
      const inputAgno =
        input.agno && typeof input.agno === "object" && !Array.isArray(input.agno)
          ? input.agno
          : {};
      const inputAgentUi =
        inputAgno.agentUi &&
        typeof inputAgno.agentUi === "object" &&
        !Array.isArray(inputAgno.agentUi)
          ? inputAgno.agentUi
          : {};
      const inputAgnoTools =
        inputAgno.tools &&
        typeof inputAgno.tools === "object" &&
        !Array.isArray(inputAgno.tools)
          ? inputAgno.tools
          : {};
      return {
        ...DEFAULT_CONFIG.agno,
        ...inputAgno,
        agentUi: {
          ...DEFAULT_CONFIG.agno.agentUi,
          ...inputAgentUi
        },
        tools: {
          ...DEFAULT_CONFIG.agno.tools,
          ...inputAgnoTools
        }
      };
    })(),
    // Without this block the whole `agent` key was dropped on every merge, so
    // DEFAULT_CONFIG.agent.nativeChatTimeoutMs never reached the server and the
    // native-stream watchdog in index.mjs armed with Infinity, i.e. never.
    // epistemic merges per-key like lean.orchestration below it: a partial
    // update that flips `mode` must not wipe its sibling limits.
    agent: (() => {
      const inputAgent = isPlainObject(input.agent) ? input.agent : {};
      const inputEpistemic = isPlainObject(inputAgent.epistemic) ? inputAgent.epistemic : {};
      return {
        ...DEFAULT_CONFIG.agent,
        ...inputAgent,
        epistemic: {
          ...DEFAULT_CONFIG.agent.epistemic,
          ...inputEpistemic
        }
      };
    })()
  };
}

/**
 * Merge an API request body over the config currently in memory.
 *
 * Every nested block a partial update can touch is merged per-key, otherwise a
 * UI panel that posts one field wipes its siblings. mergeConfig() has the last
 * word so an API save normalizes exactly like load and save do.
 *
 * @param {object} current - the config in memory.
 * @param {object} [body] - the request body.
 */
export function mergeRequestOverConfig(current, body = {}) {
  const base = isPlainObject(current) ? current : {};
  const patch = isPlainObject(body) ? body : {};
  const block = (key) => ({ ...base[key], ...(isPlainObject(patch[key]) ? patch[key] : {}) });
  return mergeConfig({
    ...base,
    ...patch,
    server: {
      ...base.server,
      ...(isPlainObject(patch.server) ? patch.server : {}),
      env: { ...base.server?.env, ...(isPlainObject(patch.server?.env) ? patch.server.env : {}) }
    },
    control: block("control"),
    history: block("history"),
    wrapper: block("wrapper"),
    contextWiki: block("contextWiki"),
    lean: {
      ...block("lean"),
      orchestration: {
        ...base.lean?.orchestration,
        ...(isPlainObject(patch.lean?.orchestration) ? patch.lean.orchestration : {})
      }
    },
    sage: {
      ...block("sage"),
      orchestration: {
        ...base.sage?.orchestration,
        ...(isPlainObject(patch.sage?.orchestration) ? patch.sage.orchestration : {})
      }
    },
    agent: {
      ...block("agent"),
      epistemic: {
        ...base.agent?.epistemic,
        ...(isPlainObject(patch.agent?.epistemic) ? patch.agent.epistemic : {})
      }
    }
  });
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

function validateEvolutionConfig(evolution = {}) {
  const errors = {};
  if (typeof evolution.enabled !== "boolean") errors.enabled = "must be boolean";
  if (!new Set(["B", "C", "D", "E"]).has(evolution.maxLevel)) errors.maxLevel = "must be one of B, C, D, E";
  if (evolution.maxLevel === "E" && process.env.DS4_EVOLUTION_LEVEL_E !== "1") {
    errors.maxLevel = "Level E requires DS4_EVOLUTION_LEVEL_E=1";
  }
  for (const key of ["stateDir", "workDir"]) {
    if (typeof evolution[key] !== "string" || !evolution[key].trim() || evolution[key].includes("\0")) errors[key] = "must be a non-empty path without NUL";
  }
  if (typeof evolution.model !== "string" || !evolution.model.trim()) errors.model = "is required";
  if (typeof evolution.modelBaseUrl !== "string" || !/^https?:\/\//.test(evolution.modelBaseUrl)) errors.modelBaseUrl = "must be an HTTP(S) URL";
  if (!Number.isSafeInteger(evolution.modelTimeoutMs) || evolution.modelTimeoutMs < 1000 || evolution.modelTimeoutMs > 600000) {
    errors.modelTimeoutMs = "must be between 1000 and 600000";
  }
  for (const key of ["maxPacketBytes", "maxArtifactReadBytes"]) {
    if (!Number.isSafeInteger(evolution[key]) || evolution[key] < 1024 || evolution[key] > 10_000_000) errors[key] = "must be between 1024 and 10000000";
  }
  if (!Number.isSafeInteger(evolution.maxFeedbackContextBytes) ||
      evolution.maxFeedbackContextBytes < 8192 || evolution.maxFeedbackContextBytes > 1_000_000) {
    errors.maxFeedbackContextBytes = "must be between 8192 and 1000000";
  }
  if (typeof evolution.writeTokenEnv !== "string" || !/^[A-Z_][A-Z0-9_]{1,127}$/.test(evolution.writeTokenEnv)) {
    errors.writeTokenEnv = "must be an environment variable name";
  }
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
  const errors = { control: {}, history: {}, server: {}, wrapper: {}, requestDefaults: {}, research: {}, evolution: {}, callDebug: {}, pageAgent: {}, agno: {}, lean: {}, sage: {}, contextWiki: {}, agent: {} };
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
      // A valid legacy switch is migrated away by normalizeLegacySemanticEnv;
      // whatever is still here is a value it could not parse.
      if (LEGACY_SEMANTIC_ENV_KEYS.has(key)) {
        errors.server.env = `${key} must be configured through the typed Lean/Sage fields`;
        break;
      }
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
  errors.evolution = validateEvolutionConfig(config.evolution || {});
  errors.callDebug = validateCallDebug(config.callDebug || {});
  errors.toolBlobs = validateToolBlobs(config.toolBlobs || {});
  // Agno validation
  const ag = config.agno || {};
  if (typeof ag.enabled !== "boolean") errors.agno.enabled = "must be boolean";
  if (typeof ag.autoStart !== "boolean") errors.agno.autoStart = "must be boolean";
  if (!LOOPBACK_CONTROL_HOSTS.has(ag.host)) errors.agno.host = "must be loopback-only";
  if (!validatePort(ag.port)) errors.agno.port = "must be between 1 and 65535";
  if (ag.port === config.control.port) errors.agno.port = "must differ from control.port";
  if (ag.port === config.server.port) errors.agno.port = "must differ from server.port";
  if (ag.port === config.crawl.port) errors.agno.port = "must differ from crawl.port";
  if (!Number.isInteger(ag.maxInflightModelCalls) || ag.maxInflightModelCalls !== 1) errors.agno.maxInflightModelCalls = "must be exactly 1";
  if (!Number.isInteger(ag.maxQueuedModelCalls) || ag.maxQueuedModelCalls < 1 || ag.maxQueuedModelCalls > 64) errors.agno.maxQueuedModelCalls = "must be an integer between 1 and 64";
  if (!Number.isInteger(ag.startupTimeoutMs) || ag.startupTimeoutMs < 1000 || ag.startupTimeoutMs > 120000) errors.agno.startupTimeoutMs = "must be between 1000 and 120000";
  if (!Number.isInteger(ag.shutdownTimeoutMs) || ag.shutdownTimeoutMs < 500 || ag.shutdownTimeoutMs > 30000) errors.agno.shutdownTimeoutMs = "must be between 500 and 30000";
  if (!Number.isInteger(ag.serviceRequestTimeoutMs) || ag.serviceRequestTimeoutMs < 1000 || ag.serviceRequestTimeoutMs > 7200000) errors.agno.serviceRequestTimeoutMs = "must be between 1000 and 7200000";
  if (!Number.isInteger(ag.modelQueueWaitTimeoutMs) || ag.modelQueueWaitTimeoutMs < 1000 || ag.modelQueueWaitTimeoutMs > 7200000) errors.agno.modelQueueWaitTimeoutMs = "must be between 1000 and 7200000";
  if (ag.telemetry !== false) errors.agno.telemetry = "must be false";
  if (ag.tracing !== false) errors.agno.tracing = "must be false";
  if (ag.scheduler !== false) errors.agno.scheduler = "must be false";
  if (ag.mcpEnabled !== false) errors.agno.mcpEnabled = "must be false";
  if (typeof ag.uiEnabled !== "boolean") errors.agno.uiEnabled = "must be boolean";
  // Agent UI validation
  const agUi = ag.agentUi || {};
  if (typeof agUi.enabled !== "boolean") errors.agno.agentUiEnabled = "agentUi.enabled must be boolean";
  if (typeof agUi.autoStart !== "boolean") errors.agno.agentUiAutoStart = "agentUi.autoStart must be boolean";
  if (!LOOPBACK_CONTROL_HOSTS.has(agUi.host)) errors.agno.agentUiHost = "agentUi.host must be loopback-only";
  if (!validatePort(agUi.port)) errors.agno.agentUiPort = "agentUi.port must be between 1 and 65535";
  const reservedPorts = new Map([
    ["control.port", config.control.port],
    ["server.port", config.server.port],
    ["crawl.port", config.crawl.port],
    ["agno.port", ag.port]
  ]);
  for (const [label, port] of reservedPorts) {
    if (agUi.port === port) {
      errors.agno.agentUiPort = `agentUi.port must differ from ${label}`;
    }
  }
  if (typeof agUi.runtimeDir !== "string" || !agUi.runtimeDir.trim()) {
    errors.agno.agentUiRuntimeDir = "agentUi.runtimeDir must be a non-empty string";
  }
  if (agUi.openMode !== "new-tab") {
    errors.agno.agentUiOpenMode = 'agentUi.openMode must be exactly "new-tab"';
  }
  if (agUi.telemetry !== false) {
    errors.agno.agentUiTelemetry = "agentUi.telemetry must be false";
  }
  // Agno tools validation
  const agTools = ag.tools || {};
  if (typeof agTools.enabled !== "boolean") errors.agno.toolsEnabled = "tools.enabled must be boolean";
  if (!["safe", "full"].includes(agTools.profile)) errors.agno.toolsProfile = "tools.profile must be safe or full";
  if (typeof agTools.auditEnabled !== "boolean") errors.agno.toolsAuditEnabled = "tools.auditEnabled must be boolean";
  for (const [key, errKey] of [
    ["allowedTools", "toolsAllowedTools"],
    ["deniedTools", "toolsDeniedTools"]
  ]) {
    if (!Array.isArray(agTools[key])) {
      errors.agno[errKey] = `tools.${key} must be an array`;
      continue;
    }
    const unknown = agTools[key].filter((name) => !AGENT_TOOL_NAMES.includes(name));
    if (unknown.length) errors.agno[errKey] = `unknown tools: ${unknown.join(", ")}`;
  }
  if (
    Array.isArray(agTools.allowedTools) &&
    Array.isArray(agTools.deniedTools) &&
    agTools.allowedTools.some((name) => agTools.deniedTools.includes(name))
  ) {
    errors.agno.toolsOverlap = "allowedTools and deniedTools must not overlap";
  }
  for (const [key, errKey] of [
    ["requestTimeoutMs", "toolsRequestTimeoutMs"],
    ["maxInflight", "toolsMaxInflight"],
    ["maxQueued", "toolsMaxQueued"],
    ["maxHistoryMessages", "toolsMaxHistoryMessages"],
    ["maxHistoryBytes", "toolsMaxHistoryBytes"],
    ["maxRequestBytes", "toolsMaxRequestBytes"],
    ["maxResponseBytes", "toolsMaxResponseBytes"]
  ]) {
    if (!isPositiveInt(agTools[key])) errors.agno[errKey] = `tools.${key} must be a positive integer`;
  }
  // Extra constraints on top of the positive-integer checks above (only applied
  // once the base value is already a valid positive integer, so the message
  // doesn't get overwritten for values that aren't even integers).
  if (isPositiveInt(agTools.maxInflight) && parseDecimalInteger(agTools.maxInflight) !== 1) {
    errors.agno.toolsMaxInflight = "tools.maxInflight must be exactly 1 in this release";
  }
  if (isPositiveInt(agTools.maxQueued) && parseDecimalInteger(agTools.maxQueued) > 32) {
    errors.agno.toolsMaxQueued = "tools.maxQueued must be <= 32";
  }
  if (isPositiveInt(agTools.maxRequestBytes) && parseDecimalInteger(agTools.maxRequestBytes) > 1048576) {
    errors.agno.toolsMaxRequestBytes = "tools.maxRequestBytes must be <= 1048576";
  }
  if (isPositiveInt(agTools.maxResponseBytes) && parseDecimalInteger(agTools.maxResponseBytes) > 1048576) {
    errors.agno.toolsMaxResponseBytes = "tools.maxResponseBytes must be <= 1048576";
  }
  if (typeof agTools.auditDir !== "string" || !agTools.auditDir.trim()) {
    errors.agno.toolsAuditDir = "tools.auditDir is required";
  } else if (path.isAbsolute(agTools.auditDir)) {
    errors.agno.toolsAuditDir = "tools.auditDir must be relative";
  } else if (agTools.auditDir.split(/[\\/]+/).includes("..")) {
    errors.agno.toolsAuditDir = "tools.auditDir must not contain ..";
  }
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
  // Lean validation. This is the file layer of the env > config JSON > default
  // precedence the control plane applies in index.mjs; machine-specific paths
  // (runtimeRoot, runsRoot) deliberately stay out of the JSON schema.
  const lean = config.lean || {};
  if (typeof lean.enabled !== "boolean") errors.lean.enabled = "must be boolean";
  if (typeof lean.policyAuto !== "boolean") errors.lean.policyAuto = "must be boolean";
  if (lean.defaultProfile !== "core" && lean.defaultProfile !== "mathlib") {
    errors.lean.defaultProfile = "must be 'core' or 'mathlib'";
  }
  // Orchestration budget: shape only. The range clamp lives in
  // resolveLeanOrchestrationConfig, which is also the env layer.
  const leanOrchestration = lean.orchestration || {};
  if (typeof leanOrchestration !== "object" || Array.isArray(leanOrchestration)) {
    errors.lean.orchestration = "must be an object";
  } else {
    for (const key of ["maxAttempts", "maxSameFailure", "maxPrematureFinalizations", "maxWallClockMs"]) {
      const value = leanOrchestration[key];
      if (value !== undefined && !Number.isInteger(value)) {
        errors.lean.orchestration = `${key} must be an integer`;
      }
    }
    for (const key of ["enabled", "prompt"]) {
      const value = leanOrchestration[key];
      if (value !== undefined && typeof value !== "boolean") {
        errors.lean.orchestration = `${key} must be boolean`;
      }
    }
  }
  // Sage orchestration budget: shape only, like lean. The ranges and the
  // "phase budgets must fit the call ceiling" rule live in
  // resolveSageOrchestrationConfig, which is also the env layer.
  const sage = config.sage || {};
  if (sage.policyAuto !== undefined && typeof sage.policyAuto !== "boolean") {
    errors.sage.policyAuto = "must be boolean";
  }
  const sageOrchestration = sage.orchestration || {};
  if (typeof sageOrchestration !== "object" || Array.isArray(sageOrchestration)) {
    errors.sage.orchestration = "must be an object";
  } else {
    for (const key of [
      "maxComputeAttempts",
      "maxRepairAttempts",
      "maxValidationAttempts",
      "maxPlotAttempts",
      "maxPrematureFinalizations",
      "maxSameFailure",
      "maxWallClockMs",
      "maxTotalToolCalls"
    ]) {
      const value = sageOrchestration[key];
      if (value !== undefined && !Number.isInteger(value)) {
        errors.sage.orchestration = `${key} must be an integer`;
      }
    }
    for (const key of ["enabled", "prompt"]) {
      const value = sageOrchestration[key];
      if (value !== undefined && typeof value !== "boolean") {
        errors.sage.orchestration = `${key} must be boolean`;
      }
    }
  }
  // ContextWiki: the nine knobs are typed JSON now, so the JSON layer has to
  // reject what readContextConfig would otherwise have to guess about. Only
  // positivity and soft <= hard, i.e. exactly what the runtime already applies.
  const contextWiki = config.contextWiki || {};
  if (typeof contextWiki !== "object" || Array.isArray(contextWiki)) {
    errors.contextWiki.contextWiki = "must be an object";
  } else {
    for (const key of ["enabled", "previewOnly", "deltaRequired", "telemetry"]) {
      const value = contextWiki[key];
      if (value !== undefined && typeof value !== "boolean") {
        errors.contextWiki[key] = "must be boolean";
      }
    }
    for (const key of ["softTokens", "hardTokens", "maxGrowthPct", "maxEvidence", "maxLedgerEvents"]) {
      const value = contextWiki[key];
      if (value !== undefined && !isPositiveInt(value)) {
        errors.contextWiki[key] = "must be a positive integer";
      }
    }
    if (
      isPositiveInt(contextWiki.softTokens) &&
      isPositiveInt(contextWiki.hardTokens) &&
      Number(contextWiki.softTokens) > Number(contextWiki.hardTokens)
    ) {
      errors.contextWiki.softTokens = "must not exceed hardTokens";
    }
  }
  {
    // index.mjs reads config.agent?.nativeChatTimeoutMs and treats 0 (and a
    // missing value) as "no deadline", so 0 stays legal and only a value that
    // would arm a nonsense timer is rejected. NaN or a negative number would
    // reach setTimeout and fire immediately, killing every native stream.
    //
    // The upper bound is 7200000, not the 600000 the Quantum Fix plan §23.4
    // suggests: a live Cauchy proof turn was still generating after 900s, so a
    // 10-minute ceiling would make a legitimate long proof unconfigurable.
    const nativeChatTimeoutMs = config.agent?.nativeChatTimeoutMs;
    if (
      nativeChatTimeoutMs !== 0 &&
      (!Number.isInteger(nativeChatTimeoutMs) ||
        nativeChatTimeoutMs < 1000 ||
        nativeChatTimeoutMs > 7_200_000)
    ) {
      errors.agent.nativeChatTimeoutMs = "must be 0 (disabled) or between 1000 and 7200000";
    }

    const ep = config.agent?.epistemic;
    if (!isPlainObject(ep)) {
      errors.agent.epistemic = "must be an object";
    } else {
      for (const key of [
        "enabled",
        "withholdOutput",
        "verifyCitations",
        "verifyMath",
        "verifyExecutionClaims",
        "verifyChallenges",
        "strictRepair",
        "persistSessionClaims"
      ]) {
        if (typeof ep[key] !== "boolean") errors.agent[`epistemic.${key}`] = "must be boolean";
      }
      if (!["off", "shadow", "block"].includes(ep.mode)) {
        errors.agent["epistemic.mode"] = "must be 'off', 'shadow' or 'block'";
      }
      const range = (key, min, max) => {
        const value = ep[key];
        if (!Number.isInteger(value) || value < min || value > max) {
          errors.agent[`epistemic.${key}`] = `must be an integer between ${min} and ${max}`;
        }
      };
      range("maxClaimsPerTurn", 1, 256);
      range("maxVerifierCallsPerTurn", 0, 128);
      range("maxRepairRounds", 0, 8);
      // blockSeverity is the threshold at or above which the gate blocks, so 0
      // means "block everything" and 5 means "block nothing below the top
      // class". Both ends are meaningful; neither is a disabled sentinel.
      range("blockSeverity", 0, 5);
    }
  }
  const ok =
    Object.keys(errors.control).length === 0 &&
    Object.keys(errors.history).length === 0 &&
    Object.keys(errors.server).length === 0 &&
    Object.keys(errors.wrapper).length === 0 &&
    Object.keys(errors.requestDefaults).length === 0 &&
    Object.keys(errors.research).length === 0 &&
    Object.keys(errors.evolution).length === 0 &&
    Object.keys(errors.callDebug).length === 0 &&
    Object.keys(errors.toolBlobs).length === 0 &&
    Object.keys(errors.pageAgent).length === 0 &&
    Object.keys(errors.agno).length === 0 &&
    Object.keys(errors.lean).length === 0 &&
    Object.keys(errors.sage).length === 0 &&
    Object.keys(errors.contextWiki).length === 0 &&
    Object.keys(errors.agent).length === 0;
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
