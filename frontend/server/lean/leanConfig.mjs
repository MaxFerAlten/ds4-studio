// Lean 4 configuration loader for ds4-studio
// Reads environment variables with explicit parsing — no Number(x) || default shortcuts.

import { homedir } from "os";

import {
  LEAN_DEFAULT_TIMEOUT_SEC,
  LEAN_MAX_DIAGNOSTICS,
  LEAN_MAX_SOURCE_BYTES,
  LEAN_MAX_STDERR_BYTES,
  LEAN_MAX_STDOUT_BYTES,
  LEAN_MAX_TIMEOUT_SEC
} from "./leanConstants.mjs";
import { resolveLeanOrchestrationConfig } from "./leanOrchestrationConfig.mjs";

/**
 * Parse a boolean value from env (0/1/true/false).
 * Returns null on invalid input.
 */
function parseBoolean(value) {
  if (value === undefined || value === null) return null;
  const s = String(value).trim().toLowerCase();
  if (s === "1" || s === "true") return true;
  if (s === "0" || s === "false") return false;
  return null;
}

/**
 * Parse an integer from env with min/max validation.
 * Returns null on invalid or out-of-range.
 */
function parsePositiveInt(value, minVal, maxVal, fieldName) {
  if (value === undefined || value === null) return null;
  const n = Number(value);
  if (!Number.isInteger(n)) return null;
  if (n < minVal || n > maxVal) return null;
  return n;
}

/**
 * Load Lean configuration from environment variables.
 *
 * @param {object} env - Environment object (default process.env)
 * @param {object} options - Override options for testing
 * @returns {object} config
 */
export function loadLeanConfig(env = process.env, options = {}) {
  const enabledRaw = options.enabled !== undefined ? options.enabled : parseBoolean(env.DS4_LEAN_ENABLED);
  const policyAutoRaw = options.policyAuto !== undefined ? options.policyAuto : parseBoolean(env.DS4_LEAN_POLICY_AUTO);
  const sandboxRequiredRaw = options.sandboxRequired !== undefined ? options.sandboxRequired : parseBoolean(env.DS4_LEAN_SANDBOX_REQUIRED);

  const bwrapBin = options.bwrapBin || env.DS4_LEAN_BWRAP_BIN || "/usr/bin/bwrap";
  const prlimitBin = options.prlimitBin || env.DS4_LEAN_PRLIMIT_BIN || "/usr/bin/prlimit";
  const runtimeRoot = options.runtimeRoot || env.DS4_LEAN_RUNTIME_ROOT || "";
  const runsRoot = options.runsRoot || env.DS4_LEAN_RUNS_ROOT || "";
  const elanRoot = options.elanRoot || env.DS4_LEAN_ELAN_ROOT || env.ELAN_HOME || `${homedir()}/.elan`;

  const defaultProfile = options.defaultProfile || env.DS4_LEAN_DEFAULT_PROFILE || "core";
  if (defaultProfile !== "core" && defaultProfile !== "mathlib") {
    throw new Error(`Invalid LEAN_DEFAULT_PROFILE: ${defaultProfile}. Must be 'core' or 'mathlib'.`);
  }

  const timeoutSec = parsePositiveInt(
    options.timeoutSec || env.DS4_LEAN_TIMEOUT_SEC,
    1, LEAN_MAX_TIMEOUT_SEC, "DS4_LEAN_TIMEOUT_SEC"
  ) || LEAN_DEFAULT_TIMEOUT_SEC;

  const maxTimeoutSec = parsePositiveInt(
    options.maxTimeoutSec || env.DS4_LEAN_MAX_TIMEOUT_SEC,
    timeoutSec, 300, "DS4_LEAN_MAX_TIMEOUT_SEC"
  ) || LEAN_MAX_TIMEOUT_SEC;

  const memoryBytes = parsePositiveInt(
    options.memoryBytes || env.DS4_LEAN_MEMORY_BYTES,
    1048576, 8589934592, "DS4_LEAN_MEMORY_BYTES"
  ) ?? 4294967296;

  // RLIMIT_AS backstop. Must stay well above memoryBytes: Lean reserves virtual
  // address space proportional to the core count, so sizing this to the heap
  // makes Lean abort with "failed to create thread". Tune per machine.
  const addressSpaceBytes = parsePositiveInt(
    options.addressSpaceBytes || env.DS4_LEAN_ADDRESS_SPACE_BYTES,
    memoryBytes, 549755813888, "DS4_LEAN_ADDRESS_SPACE_BYTES"
  ) ?? 17179869184;

  const leanThreads = parsePositiveInt(
    options.leanThreads || env.DS4_LEAN_THREADS,
    1, 64, "DS4_LEAN_THREADS"
  ) ?? 4;

  const cpuSeconds = parsePositiveInt(
    options.cpuSeconds || env.DS4_LEAN_CPU_SECONDS,
    1, 120, "DS4_LEAN_CPU_SECONDS"
  ) || 30;

  const maxProcesses = parsePositiveInt(
    options.maxProcesses || env.DS4_LEAN_MAX_PROCESSES,
    1, 1024, "DS4_LEAN_MAX_PROCESSES"
  ) || 64;

  const maxOpenFiles = parsePositiveInt(
    options.maxOpenFiles || env.DS4_LEAN_MAX_OPEN_FILES,
    1, 4096, "DS4_LEAN_MAX_OPEN_FILES"
  ) || 128;

  const retentionHours = parsePositiveInt(
    options.retentionHours ?? env.DS4_LEAN_RETENTION_HOURS,
    0, 168, "DS4_LEAN_RETENTION_HOURS"
  ) ?? 24;

  // R9: differentiated retention for infrastructure failures (spawn failed,
  // sandbox denied, result contract invalid). These hold diagnostic evidence
  // for an operator, so they outlive ordinary results.
  const infraRetentionHours = parsePositiveInt(
    options.infraRetentionHours ?? env.DS4_LEAN_INFRA_RETENTION_HOURS,
    0, 8760, "DS4_LEAN_INFRA_RETENTION_HOURS"
  ) ?? 168;

  // R9: fsync the persisted request/source before spawning the sandbox. Costs a
  // disk flush per run; off by default, on for audit-grade deployments.
  const fsyncArtifactsRaw = options.fsyncArtifacts !== undefined
    ? options.fsyncArtifacts
    : parseBoolean(env.DS4_LEAN_FSYNC_ARTIFACTS);

  // R8: budget for one sandboxed smoke build (the full mathlib smoke is slow
  // even with a warm cache). This only bounds the once-per-process deep check;
  // steady-state preflight stays cheap.
  const preflightSmokeTimeoutSec = parsePositiveInt(
    options.smokeTimeoutSec ?? env.DS4_LEAN_PREFLIGHT_SMOKE_TIMEOUT_SEC,
    5, 3600, "DS4_LEAN_PREFLIGHT_SMOKE_TIMEOUT_SEC"
  ) ?? 600;

  // R6: run registry bounds. Prudent defaults: at most two concurrent checks
  // globally, one in-flight run per session, no server-side queueing.
  const maxGlobalRuns = parsePositiveInt(
    options.maxGlobalRuns ?? env.DS4_LEAN_MAX_GLOBAL_RUNS,
    1, 8, "DS4_LEAN_MAX_GLOBAL_RUNS"
  ) ?? 2;

  const maxRunsPerSession = parsePositiveInt(
    options.maxRunsPerSession ?? env.DS4_LEAN_MAX_RUNS_PER_SESSION,
    1, 4, "DS4_LEAN_MAX_RUNS_PER_SESSION"
  ) ?? 1;

  const maxQueuedPerSession = parsePositiveInt(
    options.maxQueuedPerSession ?? env.DS4_LEAN_MAX_QUEUED_PER_SESSION,
    0, 4, "DS4_LEAN_MAX_QUEUED_PER_SESSION"
  ) ?? 1;

  const registryCapacity = parsePositiveInt(
    options.registryCapacity ?? env.DS4_LEAN_REGISTRY_CAPACITY,
    8, 1024, "DS4_LEAN_REGISTRY_CAPACITY"
  ) ?? 64;

  const registryTtlMs = parsePositiveInt(
    options.registryTtlMs ?? env.DS4_LEAN_REGISTRY_TTL_MS,
    5000, 86400000, "DS4_LEAN_REGISTRY_TTL_MS"
  ) ?? 3600000;

  // Rollout of the promptRevision/contractRevision split. A client built before
  // the split sends only policyRevision; during the migration that still feeds
  // promptRevision, and the contract gate stays advisory. Flip both at the end
  // of the rollout: contractRevision required, legacy alias refused.
  const requireContractRevisionRaw = options.requireContractRevision !== undefined
    ? options.requireContractRevision
    : parseBoolean(env.DS4_LEAN_REQUIRE_CONTRACT_REVISION);
  const allowLegacyPolicyRevisionRaw = options.allowLegacyPolicyRevision !== undefined
    ? options.allowLegacyPolicyRevision
    : parseBoolean(env.DS4_LEAN_ALLOW_LEGACY_POLICY_REVISION);

  return {
    enabled: enabledRaw === true,
    sandboxRequired: sandboxRequiredRaw !== false, // default true
    policyAuto: policyAutoRaw !== false,            // default true
    bwrapBin,
    prlimitBin,
    runtimeRoot,
    runsRoot,
    elanRoot,
    defaultProfile,
    defaultTimeoutSec: timeoutSec,
    maxTimeoutSec,
    // Always concrete: consumers must be able to trust config as the single
    // source of truth instead of re-deriving the constants behind its back.
    maxSourceBytes: options.maxSourceBytes ?? LEAN_MAX_SOURCE_BYTES,
    maxStdoutBytes: options.maxStdoutBytes ?? LEAN_MAX_STDOUT_BYTES,
    maxStderrBytes: options.maxStderrBytes ?? LEAN_MAX_STDERR_BYTES,
    maxDiagnostics: options.maxDiagnostics ?? LEAN_MAX_DIAGNOSTICS,
    memoryBytes,
    addressSpaceBytes,
    leanThreads,
    cpuSeconds,
    maxProcesses,
    maxOpenFiles,
    retentionHours,
    infraRetentionHours,
    fsyncArtifacts: fsyncArtifactsRaw === true,
    maxGlobalRuns,
    maxRunsPerSession,
    maxQueuedPerSession,
    registryCapacity,
    registryTtlMs,
    requireContractRevision: requireContractRevisionRaw === true,
    allowLegacyPolicyRevision: allowLegacyPolicyRevisionRaw !== false, // default true
    smokeTimeoutMs: preflightSmokeTimeoutSec * 1000,
    // Always present: validateLeanRequest and createLeanResultBase read the
    // attempt budget off the config, and a missing block would silently send
    // them back to a hardcoded default.
    orchestration: options.orchestration ?? resolveLeanOrchestrationConfig(env, {}),
  };
}

/**
 * Resolve the Lean configuration with explicit precedence:
 *
 *   env definita > config JSON > default
 *
 * This is what lets an operator both ship defaults in ds4-ui.config.json and
 * override them per-launch from the shell without srun.sh shadowing the file
 * layer with an unconditional export of DS4_LEAN_ENABLED=0.
 *
 * @param {object} env - Environment object (default process.env)
 * @param {object} [options]
 * @param {object} [options.fileConfig] - The merged top-level `lean` block from
 *   ds4-ui.config.json (already validated by config.validateConfig).
 * @param {string} [options.runtimeRoot] - Derived runtime root (used when the
 *   env var is absent; the source is still reported as env when it is set).
 * @param {string} [options.runsRoot] - Derived runs root (same semantics).
 * @returns {{ config: object, requested: object, sources: object, warnings: string[] }}
 *   - config: the fully resolved Lean config for the executor/preflight.
 *   - requested: the pre-coercion values that were asked for, per key.
 *   - sources: per-key provenance ("env" | "file" | "default" |
 *     "derived-project-root").
 *   - warnings: human-readable notes for invalid env values that had to fall
 *     back (never a silent fallback — the caller must log them).
 */
export function resolveLeanConfig(env = process.env, options = {}) {
  const fileConfig =
    options.fileConfig && typeof options.fileConfig === "object" && !Array.isArray(options.fileConfig)
      ? options.fileConfig
      : {};
  const warnings = [];

  function parseEnvBoolean(key) {
    const raw = env[key];
    if (raw === undefined || raw === null) return { present: false, invalid: false, value: null };
    const parsed = parseBoolean(raw);
    if (parsed === null) return { present: true, invalid: true, value: null };
    return { present: true, invalid: false, value: parsed };
  }

  function resolveBoolean(envKey, fileValue, fallback) {
    const fromEnv = parseEnvBoolean(envKey);
    if (fromEnv.present) {
      if (fromEnv.invalid) {
        warnings.push(
          `${envKey}='${env[envKey]}' is not a valid boolean; using the config file value`
        );
        return {
          value: typeof fileValue === "boolean" ? fileValue : fallback,
          source: typeof fileValue === "boolean" ? "file" : "default",
        };
      }
      return { value: fromEnv.value, source: "env" };
    }
    if (typeof fileValue === "boolean") return { value: fileValue, source: "file" };
    return { value: fallback, source: "default" };
  }

  const enabled = resolveBoolean("DS4_LEAN_ENABLED", fileConfig.enabled, false);
  const policyAuto = resolveBoolean("DS4_LEAN_POLICY_AUTO", fileConfig.policyAuto, true);
  const sandboxRequired = resolveBoolean("DS4_LEAN_SANDBOX_REQUIRED", undefined, true);

  let defaultProfile = "core";
  let defaultProfileSource = "default";
  if (typeof fileConfig.defaultProfile === "string" && fileConfig.defaultProfile) {
    defaultProfile = fileConfig.defaultProfile;
    defaultProfileSource = "file";
  }
  const envProfile = env.DS4_LEAN_DEFAULT_PROFILE;
  if (envProfile !== undefined && envProfile !== null && String(envProfile).trim() !== "") {
    defaultProfile = String(envProfile).trim();
    defaultProfileSource = "env";
  }

  // loadLeanConfig re-reads the raw env for numeric/limit keys and throws on an
  // invalid DS4_LEAN_DEFAULT_PROFILE, which is the explicit startup error the
  // plan requires for invalid env input (no silent fallback). The explicit
  // root options below already fold in the env value so env wins over the
  // project-root derivation (matching the reported source).
  const runtimeRoot = env.DS4_LEAN_RUNTIME_ROOT || options.runtimeRoot || "";
  const runsRoot = env.DS4_LEAN_RUNS_ROOT || options.runsRoot || "";
  const orchestration = resolveLeanOrchestrationConfig(env, fileConfig.orchestration);
  warnings.push(...orchestration.warnings);
  const config = loadLeanConfig(env, {
    enabled: enabled.value,
    policyAuto: policyAuto.value,
    sandboxRequired: sandboxRequired.value,
    defaultProfile,
    runtimeRoot,
    runsRoot,
    orchestration,
  });

  const sources = {
    enabled: enabled.source,
    policyAuto: policyAuto.source,
    sandboxRequired: sandboxRequired.source,
    defaultProfile: defaultProfileSource,
    runtimeRoot: env.DS4_LEAN_RUNTIME_ROOT ? "env" : options.runtimeRoot ? "derived-project-root" : "default",
    runsRoot: env.DS4_LEAN_RUNS_ROOT ? "env" : options.runsRoot ? "derived-project-root" : "default",
  };

  return {
    config,
    requested: {
      enabled: enabled.value,
      policyAuto: policyAuto.value,
      sandboxRequired: sandboxRequired.value,
      defaultProfile,
    },
    sources,
    warnings,
  };
}
