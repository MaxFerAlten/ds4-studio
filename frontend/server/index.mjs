import express from "express";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import multer from "multer";
import { createServer as createViteServer } from "vite";
import { parseCommandLine, buildDs4WrapperArgs } from "./commandBuilder.mjs";
import { buildDs4Args, loadConfig, mergeRequestOverConfig, redactConfigSecrets, saveConfig, validateConfig } from "./config.mjs";
import { DEFAULT_CONFIG, REQUEST_DEFAULTS } from "./defaultConfig.mjs";
import { normalizeUsageTiming } from "../shared/usageTiming.mjs";
import { buildServerLaunchConfig, prepareServerLaunchPaths } from "./serverLaunchConfig.mjs";
import {
  deleteAllConversationHistory,
  deleteConversationHistory,
  listConversationHistory,
  loadConversationHistory,
  saveConversationHistory
} from "./chatHistory.mjs";
import { exportConversationMarkdown, exportConversationMarkdownRaw } from "../src/conversationExport.mjs";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import crypto from "node:crypto";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import {
  autoMaxTokenSettings,
  buildChatPayload,
  payloadModel,
  requestThinkingEnabled,
  isAutoMaxTokens,
  parseNonNegativeInt,
  parsePositiveInt,
  resolveAutoMaxTokens
} from "./requestPayload.mjs";
import {
  DEFAULT_PROFILE_NAME,
  buildProfileCandidate,
  listProfiles,
  loadProfileByName,
  loadProfileOrDefault
} from "./profileLoader.mjs";
import {
  ACCEPT_ATTRIBUTE,
  ensureWorkspace,
  ingestUploadedFile,
  isSupportedFileName,
  splitMarkdownChunks
} from "./fileIngestion.mjs";
import {
  agentBudgetStatus,
  analyzeChunkLimitExceeded,
  analyzeChunkPlan,
  formatAgentBudgetError,
  maxAgentTotalTokens,
  maxAnalyzeChunks
} from "./costLimits.mjs";
import { Ds4ProcessManager } from "./processManager.mjs";
import { readRequestBody, requestHeadersForProxy } from "./proxy.mjs";
import {
  busyRetryOptionsForRequest,
  fetchWithBusyRetry,
  isGenerationRequest
} from "./backendRetry.mjs";
import { readAmdSmiStatusCached } from "./amdSmi.mjs";
import { AgentSessionStore, AGENT_SYSTEM_PROMPT, AGENT_TOOLS } from "./agentSession.mjs";
import { advertisedAgentTools, EVIDENCE_GUARD_TOOL, appendOptionalTools } from "./agentToolCatalog.mjs";
import { engineStartupWarning, resolveAgentEngine, ensureServerModeForJsEngine } from "./agentEngine.mjs";
import { REP_MIN_CYCLES, createRepetitionDetector } from "./agentRepetitionDetector.mjs";
import { buildAgentSystemText, createSessionSkillState } from "./agentSystemText.mjs";
import { stageSkill } from "./skillRegistry.mjs";
import { allowedToolsForDot, dotContextText, toolsForDot } from "./agent/dotRunScope.mjs";
import { loadAgentLoopPolicy } from "./agentLoopPolicy.mjs";
import { normalizeSagePhase } from "./sageResultContract.mjs";
import { SageTurnTracker } from "./sageTurnTracker.mjs";
import { SageRunRegistry } from "./sageRunRegistry.mjs";
import { createSageMetrics, sageTransitionEvent } from "./sageMetrics.mjs";
import {
  LeanTurnTracker,
  sha256Hex
} from "./lean/leanTurnTracker.mjs";
import {
  authoritativeSageFinalFromResult,
  canonicalSageCommitPending,
  guardSageFinalization,
  sageArtifactKinds,
  sageToolBlockDecision
} from "./sageAgentLoopPolicy.mjs";
import {
  authoritativeToolBlockGuidance,
  evaluateAuthoritativeToolCalls
} from "./authoritativeToolGate.mjs";
import { appendPonyPolicy, buildPonyPolicy, normalizePonyMode, ponyCommandMessage } from "./agentPonyPolicy.mjs";
import {
  checkBashFileReadFallback,
  checkBashLeanGuard,
  executeTool,
  findLatestSageImageArtifact,
  resolveSageArtifactById,
  sageRunDir,
  sageSessionDir,
  sanitizeSageRunId,
  sanitizeSessionId
} from "./agentTools.mjs";
import { readContextConfig } from "./contextConfig.mjs";
import { prepareContextInjection, contextStatusPayload } from "./agentContextIntegration.mjs";
import { recordToolContext } from "./agentContextToolHooks.mjs";
import { CONTEXT_SEARCH_TOOL } from "./contextSearchTool.mjs";
import { readCapsuleMeta } from "./contextCapsuleMeta.mjs";
import { readContextTelemetry } from "./contextTelemetry.mjs";
import { readContextEvents, appendContextEvent } from "./contextLedger.mjs";
import { parseTask } from "./pageAgentTask.mjs";
import { enqueuePageAgentTool, resolvePageAgentTool, getPendingTools, markClientConnected, resetClientConnection, isServerEnabled, setServerEnabled } from "./pageAgentBridge.mjs";
import { planTools } from "./toolPlanner.mjs";
import { createTaskState } from "./agentTaskState.mjs";
import { buildSearchService } from "./research/researchSearchService.mjs";
import { evidenceFromCrawlManifest } from "./evidenceStore.mjs";
import { crawlPreflight } from "./crawlPreflight.mjs";
import { buildSynthesisBrief } from "./synthesisEngine.mjs";
import { getAgentCapabilities, capabilitiesPromptSection } from "./agentCapabilities.mjs";
import { resolveLeanConfig } from "./lean/leanConfig.mjs";
import { resolveSageConfig } from "./sageConfig.mjs";
import { buildDs4SemanticEnv, buildDs4EpistemicEnv } from "./semanticConfig.mjs";
import { runLeanPreflight } from "./lean/leanPreflight.mjs";
import { pruneExpiredLeanRuns } from "./lean/leanPaths.mjs";
import { createLeanMetrics } from "./lean/leanMetrics.mjs";
import { createLeanRouter } from "./lean/leanRoutes.mjs";
import { executeLeanCheck } from "./lean/leanExecutor.mjs";
import { executeLeanInspect } from "./lean/leanInspect.mjs";
import { LeanRunRegistry } from "./lean/leanRunRegistry.mjs";
import { getLeanPolicyState as loadLeanPolicyState } from "./lean/leanPolicyBundle.mjs";
import {
  createLeanRuntimeStateCache,
  isLeanToolAdvertised,
  leanToolCapability
} from "./lean/leanRuntimeState.mjs";
import { autonomyPromptSection } from "./agentAutonomy.mjs";
import {
  agentCoreRulesSection,
  agentContextMemorySection,
  agentEpistemicRulesSection,
  agentRuntimeIdentitySection
} from "./agentRuntimeRules.mjs";
import { createHeadroomHandlers } from "./headroomControl.mjs";
import {
  buildGitnexusPolicy,
  checkPostGitnexusAnalyzeAction,
  recordGitnexusAnalyzeResult
} from "./agentGitnexusPolicy.mjs";
import { ToolBlobStore } from "./toolBlobStore.mjs";
import { compressToolOutput } from "./toolOutputCompressor.mjs";
import { createCompressionMetrics, createCompressionMetricsHandler } from "./compressionMetrics.mjs";
import { compressAgentToolResult as compressAgentToolResultIfEnabled } from "./agentToolOutputCompression.mjs";
import { guardAssistantDelta, hasStructuredSynthesis, readStructuredCheckpoint } from "./agentLoopGuard.mjs";
import { checkVerifiedClaim } from "./claimGuard.mjs";
import { envBooleanWithAliases } from "./envBoolean.mjs";
import {
  evaluateLeanFinalCandidate,
  leanVerificationEvidence
} from "./authoritativeFinalizationGate.mjs";
import { createLeanTaskSpec } from "./lean/leanTaskSpec.mjs";
import { AuthoritativeOutputBuffer } from "./authoritativeOutputBuffer.mjs";
import { createEpistemicTurn, evaluateEpistemicTurn, withholdsOutput } from "./epistemic/epistemicTurn.mjs";
import { EpistemicSourceContext } from "./epistemic/epistemicSourceContext.mjs";
import { EpistemicSessionLedger } from "./epistemic/epistemicSessionLedger.mjs";
import { observeEpistemicShadow } from "./epistemic/epistemicShadow.mjs";
import { applyChallenges, extractChallenges } from "./epistemic/epistemicChallengeExtractor.mjs";
import { REPAIR_NEXT, evaluateRepairTransition } from "./epistemic/epistemicRepairPolicy.mjs";
import { createEpistemicTelemetry } from "./epistemic/epistemicTelemetry.mjs";
import {
  canonicalLegacyCommand,
  isAgentSlashCommand,
  nativeCommandEvents,
  prepareNativeAgentRuntime,
  proxyNativeAgentCommand
} from "./nativeAgentCommands.mjs";
import { handleAgentSlashCommand, parseAgentSlashCommand } from "./agentSlashCommands.mjs";
import {
  maybeAppendSystemPromptReminder,
  pushGuidanceMessage,
  estimateTextTokens,
  estimateMessagesTokens
} from "./agentSystemReminder.mjs";
import {
  FABRICATION_TOOL_ERROR_TEXT,
  DEFENSIVE_LOOP_ERROR_TEXT,
  LOOP_GUARD_STATUS_TEXT,
  isFabricatedResult,
  noteFabricatedResult,
  evaluateDefensiveLoop,
  datetimeContextMessage
} from "./agentLoopGuards.mjs";
import { shouldCompact, compactConversation } from "./agentCompaction.mjs";
import { backendSingleSlot, countPromptTokens, contextWindow } from "./backendContext.mjs";
import {
  sessionsDir as resolveSessionsDir,
  saveSession,
  listSessions,
  loadSession,
  restoreSessionSkills
} from "./agentSessionPersistence.mjs";
import { loadAgentText } from "./agentText.mjs";
import {
  EVIDENCE_FINALIZATION_TERMINAL_STATUS,
  EVIDENCE_MAX_REPAIR_ROUNDS,
  EVIDENCE_SKILL_NAME,
  MODE as EVIDENCE_MODE_ENUM,
  createEvidenceState,
  createEvidenceTurn,
  evidenceCheckFinal,
  evidenceCoreContract,
  evidenceDeserialize,
  evidenceDigest,
  evidenceGuardTool,
  evidenceNoteToolCall,
  evidenceRepairGuidance,
  evidenceSerialize,
  modeResolve
} from "./evidenceGuard.mjs";
import { ResearchRuntime } from "./research/researchRuntime.mjs";
import { createResearchCancelHandler } from "./research/researchCancelRoute.mjs";
import { ResearchStateStore } from "./research/researchStateStore.mjs";
import { ResearchModelClient } from "./research/researchModelClient.mjs";
import { StructuredModelClient } from "./structuredModelClient.mjs";
import { EvolutionAuth } from "./evolution/evolutionAuth.mjs";
import { createEvolutionRouter } from "./evolution/evolutionApi.mjs";
import { EvolutionCandidateBuilder } from "./evolution/evolutionCandidateBuilder.mjs";
import { EvolutionCritic } from "./evolution/evolutionCritic.mjs";
import { EvolutionEvaluatorRegistry } from "./evolution/evolutionEvaluator.mjs";
import { EvolutionExecutor } from "./evolution/evolutionExecutor.mjs";
import { EvolutionFeedbackContextBuilder } from "./evolution/evolutionFeedbackContext.mjs";
import { EvolutionLoopController } from "./evolution/evolutionLoopController.mjs";
import { EvolutionModelClient } from "./evolution/evolutionModelClient.mjs";
import { EvolutionOrchestrator } from "./evolution/evolutionOrchestrator.mjs";
import { EvolutionPromotionService } from "./evolution/evolutionPromotion.mjs";
import { EvolutionProposer } from "./evolution/evolutionProposer.mjs";
import { EvolutionRunStore } from "./evolution/evolutionRunStore.mjs";
import { EvolutionRuntime } from "./evolution/evolutionRuntime.mjs";
import { createEvolutionSmokeEvaluator } from "./evolution/evolutionSmoke.mjs";
import { EvolutionSourceContext } from "./evolution/evolutionSourceContext.mjs";
import { EvolutionViews } from "./evolution/evolutionViews.mjs";
import { EvolutionWorkspaceManager } from "./evolution/evolutionWorkspace.mjs";
import { exportSession } from "./research/researchExport.mjs";
import { CallDebugRecorder } from "./callDebug.mjs";
import {
  SageCallLog,
  activateSagePolicy,
  applySagePolicyToMessages,
  deactivateSagePolicy,
  sageBinaryExists,
  sagePolicyIsActive,
  sageResponds,
  sageState,
  syncSageStateFromNativeCommand
} from "./sageState.mjs";
import {
  abortOnClientDisconnect,
  armBackendCancelOnDisconnect
} from "./clientDisconnect.mjs";
import { AGENT_RUN_OUTCOME, createAgentRunService } from "./agent/runService.mjs";
import { AgentAdmissionError, createAgentAdmission, opaqueId } from "./agentAdmission.mjs";
import { createLegacyAgentChatHandler } from "./agent/legacyChatSse.mjs";
import { createAgentIdentity, hashRequest } from "./agentIdentity.mjs";
import { createAdmissionGuards } from "./agent/admissionGuards.mjs";
import { SERVER_SESSION_PREFIX, createThreadStore } from "./agent/threadStore.mjs";
import { openLocalThreadStorage } from "./agent/localThreadStorage.mjs";
import { createRunIngress, createRunRoutes } from "./agent/runIngress.mjs";
import { aguiFeatureFlags } from "./agui/featureFlags.mjs";
import { loadAguiSdk } from "./agui/sdk.mjs";
import { createAguiRecorder } from "./agui/recorder.mjs";
import { createAguiGateway, mountAguiRoutes } from "./agui/route.mjs";
import { ensureAgnoTokens } from "./agno/agnoToken.mjs";
import { AgnoModelGate } from "./agno/agnoModelGate.mjs";
import { AgnoExecutionGuard } from "./agno/agnoExecutionGuard.mjs";
import { createAgnoModelGateway } from "./agno/agnoModelGateway.mjs";
import { createAgnoRouter } from "./agno/agnoRoutes.mjs";
import { createAgnoProcessManager, createDisabledAgnoProcessManager } from "./agno/agnoProcessManager.mjs";
import { AgnoClient } from "./agno/agnoClient.mjs";
import {
  createAgentUiProcessManager,
  createDisabledAgentUiProcessManager
} from "./agno/agnoUiProcessManager.mjs";
import {
  resolveAgentUiRuntimeDir
} from "./agno/agnoUiConfig.mjs";
import { AgnoToolAuthenticator } from "./agno/agnoToolAuth.mjs";
import { AgnoToolGate } from "./agno/agnoToolGate.mjs";
import { AgnoToolPolicy } from "./agno/agnoToolPolicy.mjs";
import { AgnoToolSessionRegistry } from "./agno/agnoToolSession.mjs";
import { AgnoToolExecutionService } from "./agno/agnoToolExecutionService.mjs";
import { AgnoToolAudit } from "./agno/agnoToolAudit.mjs";
import { createAgnoToolRoutes } from "./agno/agnoToolRoutes.mjs";

const AGNO_AGENT_UI_COMMIT =
  "6dad9593fca6756e1813e4f4b3b2620be6377691";

const HTTP_DRAIN_GRACE_MS = 2000;
const SHUTDOWN_TIMEOUT_MS = 10000;
const UPLOAD_LIMIT_BYTES = 50 * 1024 * 1024;
const FRONTEND_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PROJECT_ROOT = path.resolve(FRONTEND_ROOT, "..");
const CRAWL_OWNER_ID = `ds4-ui:${process.pid}`;
const AGNO_OWNER_ID = CRAWL_OWNER_ID;

// Load optional frontend/.env before any env reads so research provider API keys
// (TAVILY_API_KEY, SERPAPI_KEY, …) can live in a file instead of the shell.
// Already-exported vars win; a missing .env is fine.
const ENV_FILE = path.join(FRONTEND_ROOT, ".env");
if (typeof process.loadEnvFile === "function") {
  try {
    process.loadEnvFile(ENV_FILE);
    console.log(`Loaded environment from ${ENV_FILE}`);
  } catch (err) {
    if (err?.code !== "ENOENT") console.warn(`Could not load ${ENV_FILE}: ${err.message}`);
  }
}

let config = await loadConfig();
if (process.env.DS4_UI_HOST) config.control.host = process.env.DS4_UI_HOST;
if (process.env.DS4_UI_PORT) config.control.port = process.env.DS4_UI_PORT;

// Lean 4 precedence is env defined > config JSON > default. The JSON layer is
// the top-level `lean` block of ds4-ui.config.json (validated in config.mjs);
// machine-specific sandbox paths stay env-driven or derived from the project
// root and never come from the JSON schema. srun.sh deliberately does NOT
// export DS4_LEAN_ENABLED when unset, so the file layer can win.
const leanResolution = resolveLeanConfig(process.env, {
  fileConfig: config.lean,
  runtimeRoot: process.env.DS4_LEAN_RUNTIME_ROOT || path.join(PROJECT_ROOT, "lean-runtime"),
  runsRoot: process.env.DS4_LEAN_RUNS_ROOT || path.join(PROJECT_ROOT, "frontend", "workspace", "lean-runs")
});
for (const warning of leanResolution.warnings) {
  console.warn(`[lean] ${warning}`);
}
const sageResolution = resolveSageConfig(process.env, config.sage);
for (const warning of sageResolution.warnings) {
  console.warn(`[sage] ${warning}`);
}

// `config` stays the persistable JSON; `runtimeConfig` is what the boot
// actually resolved. Keeping them apart is what stops saveConfig() from
// writing runtime-only fields (requested, sources, runtimeRoot) into the file.
const runtimeConfig = Object.freeze({
  lean: {
    ...leanResolution.config,
    requested: leanResolution.requested,
    sources: leanResolution.sources
  },
  sage: sageResolution.config,
  contextWiki: readContextConfig(process.env, config.contextWiki),
  // QF-14 §36 reads runtimeConfig.agent.epistemic. mergeConfig already
  // guarantees the block exists and is well-formed (QF-01).
  agent: config.agent
});

// The typed fields, translated once into the environment variables the Node
// modules and the C backend still read. This is a translation of an already
// resolved value, not a second source of defaults.
const semanticEnv = Object.freeze({
  ...buildDs4SemanticEnv(runtimeConfig),
  ...buildDs4EpistemicEnv(runtimeConfig)
});
Object.assign(process.env, semanticEnv);

console.log(
  "[epistemic] runtime:",
  JSON.stringify({
    enabled: runtimeConfig.agent.epistemic.enabled,
    mode: runtimeConfig.agent.epistemic.mode,
    withholdOutput: runtimeConfig.agent.epistemic.withholdOutput,
    nativeEnv: process.env.DS4_EPISTEMIC_MODE ?? null
  })
);

const effectiveEpistemicMode = runtimeConfig.agent.epistemic.enabled
  ? runtimeConfig.agent.epistemic.mode
  : "off";
const epistemicTelemetry = createEpistemicTelemetry();
const epistemicModeParity = effectiveEpistemicMode === process.env.DS4_EPISTEMIC_MODE;
console.log(
  `EPISTEMIC_MODE js=${effectiveEpistemicMode} native_env=${
    process.env.DS4_EPISTEMIC_MODE ?? "unset"
  } parity=${epistemicModeParity ? 1 : 0}`
);
if (!epistemicModeParity) {
  epistemicTelemetry.record({
    mode: effectiveEpistemicMode,
    decision: { code: "EPISTEMIC_RUNTIME_MODE_MISMATCH", allowed: true },
    jsNativeModeMismatch: true
  });
}

// Boot report of the resolved Lean state (R3: configurazione vs stato effettivo).
console.log(`Lean requested: enabled=${runtimeConfig.lean.requested.enabled} source=${runtimeConfig.lean.sources.enabled}`);
console.log(`Lean policy auto: ${runtimeConfig.lean.policyAuto}`);
console.log(`Lean runtime root: ${runtimeConfig.lean.runtimeRoot || "(unset)"}`);
console.log(`Lean runs root: ${runtimeConfig.lean.runsRoot || "(unset)"}`);
console.log(`Lean sandbox: ${runtimeConfig.lean.sandboxRequired ? "mandatory" : "NOT REQUIRED (unsafe)"}`);

// R5: single normalized view of "is Lean actually usable" (sandbox + userns +
// profiles + policy revision). Every consumer — capabilities, advertised
// tools, the lean_check tool call — reads the same cached state.
const leanRuntimeState = createLeanRuntimeStateCache(runtimeConfig.lean, {
  getPreflight: () => runLeanPreflight(runtimeConfig.lean),
  getLeanPolicyState
});

// Built after the config load so the JSON budget actually reaches it. The
// module-level singleton is constructed at import time, before .env and
// ds4-ui.config.json exist, so it never saw the file layer.
const sageRunRegistry = new SageRunRegistry({
  config: runtimeConfig.sage.orchestration
});

// Expose the frontend port to child processes (ds4-wrapper agent needs it
// to call back into the Node server for delegated sage execution).
process.env.FRONTEND_PORT = String(config.control.port);

// ContextWiki no longer travels through process.env: readContextConfig resolves
// all nine limits once (env > file > default) into runtimeConfig.contextWiki,
// and the consumers read that object.

let activeProfile = null;
let serverLaunchConfig = null;
let activeRequestDefaults = { ...REQUEST_DEFAULTS, ...(config.requestDefaults || {}) };

function effectiveRequestDefaults(base = REQUEST_DEFAULTS) {
  return { ...base, ...(config.requestDefaults || {}) };
}

async function refreshServerLaunchConfig() {
  const validation = validateConfig(config);
  if (!validation.ok) {
    throw new Error(`invalid config: ${JSON.stringify(validation.errors)}`);
  }
  const next = buildServerLaunchConfig(config, PROJECT_ROOT);
  await prepareServerLaunchPaths(next, PROJECT_ROOT);
  serverLaunchConfig = next;
  return serverLaunchConfig;
}

async function ensureBackendDirs() {
  return refreshServerLaunchConfig();
}

async function applyProfileByName(name, { applyServerConfig = true } = {}) {
  const entry = await loadProfileOrDefault(name);
  if (!entry) {
    activeProfile = null;
    activeRequestDefaults = effectiveRequestDefaults();
    return null;
  }
  const candidate = buildProfileCandidate(entry, config, REQUEST_DEFAULTS, entry.name, {
    applyServerConfig
  });
  config = candidate.config;
  activeRequestDefaults = effectiveRequestDefaults(candidate.requestDefaults);
  activeProfile = entry;
  return entry;
}

function endpointLauncher(endpoint) {
  if (typeof endpoint?.launcher === "string" && endpoint.launcher.trim()) {
    return endpoint.launcher.trim();
  }
  const identity = `${endpoint?.name || ""} ${endpoint?.baseUrl || ""}`.toLowerCase();
  if (identity.includes("vitronia")) return "./scripts/vitronia_attach_stub.sh";
  if (identity.includes("halogen")) return "./scripts/halogen_attach_stub.sh";
  return "";
}

function configuredEndpoint(name) {
  return (Array.isArray(config.server?.endpoints) ? config.server.endpoints : [])
    .find((endpoint) => endpoint?.name === name && endpointLauncher(endpoint)) || null;
}

function endpointProfileName(endpoint) {
  return `endpoint:${endpoint.name}`;
}

function endpointRequestDefaults(endpoint) {
  return {
    ...effectiveRequestDefaults(endpoint.requestDefaults || {}),
    model: endpoint.model || ""
  };
}

function activateConfiguredEndpoint(endpoint) {
  activeProfile = {
    name: endpointProfileName(endpoint),
    label: endpoint.name,
    description: `OpenAI-compatible endpoint (${endpoint.model || "model not specified"})`
  };
  activeRequestDefaults = endpointRequestDefaults(endpoint);
}

// On boot the saved config.json is the single source of truth for launch
// settings. Load the selected profile only for its request defaults / active
// selection; do NOT let it overwrite the user's tuned server config (ctx, etc).
// Switching a profile via /api/profiles/select still applies + persists it.
const bootProfileName = config.selectedProfile || DEFAULT_PROFILE_NAME;
const bootEndpoint = config.server?.attach?.mode === "endpoint"
  ? configuredEndpoint(config.server.attach.name)
  : null;
if (bootEndpoint) {
  config.agent = { ...config.agent, engine: "js" };
  config.wrapper = { ...config.wrapper, enabled: false };
  activateConfiguredEndpoint(bootEndpoint);
}
else await applyProfileByName(bootProfileName, { applyServerConfig: false });

const initialValidation = validateConfig(config);
if (!initialValidation.ok) {
  throw new Error(`invalid config: ${JSON.stringify(initialValidation.errors)}`);
}
await refreshServerLaunchConfig();

function backendBase() {
  const attachedBase = config.server?.attach?.mode === "endpoint"
    ? String(config.server.attach.baseUrl || "").replace(/\/+$/, "").replace(/\/v1$/i, "")
    : "";
  if (attachedBase) return attachedBase;
  return `http://${config.server.host}:${config.server.port}`;
}

function createEpistemicStructuredClient(request = {}) {
  const baseUrl = backendBase();
  // Same id the agent's own payload carries this turn: requestDefaults.model
  // can be a stale endpoint id after an endpoint -> local switch (WP16).
  const model = payloadModel(request);
  if (!baseUrl || !model) return null;
  return new StructuredModelClient({
    baseUrl,
    model,
    modelConfig: {
      think: false
    },
    errorPrefix: "epistemic model"
  });
}

// Call Debug recorder — wraps globalThis.fetch once so every outbound call to the
// ds4-server model and the Deep Research providers is logged for the Call Debug
// tab. Must be set up before any outbound fetch runs.
const callDebugDir = path.isAbsolute(config.callDebug.dir)
  ? config.callDebug.dir
  : path.join(PROJECT_ROOT, config.callDebug.dir);
const callDebugRecorder = new CallDebugRecorder({
  dir: callDebugDir,
  maxEntries: config.callDebug.maxEntries,
  maxBodyChars: config.callDebug.maxBodyChars,
  maxFileBytes: config.callDebug.maxFileBytes,
  excludePaths: config.callDebug.excludePaths
});
if (config.callDebug.enabled) callDebugRecorder.install({ modelBase: backendBase() });

// SageMath call debug log — dedicated ring for every Sage invocation
const sageCallLogDir = path.isAbsolute(config.callDebug.dir)
  ? path.join(config.callDebug.dir, "..", "sage")
  : path.join(PROJECT_ROOT, config.callDebug.dir, "..", "sage");
const sageCallLog = new SageCallLog({ dir: sageCallLogDir, maxEntries: 100 });

// Tool blob store for compressed tool output retrieval.
const toolBlobsDir = path.isAbsolute(config.toolBlobs.dir)
  ? config.toolBlobs.dir
  : path.join(PROJECT_ROOT, config.toolBlobs.dir);
const toolBlobStore = new ToolBlobStore(toolBlobsDir);

async function healthCheck() {
  // The wrapper gates server endpoints by mode (/v1/models -> 409 in agent mode),
  // so health must be probed via the mode-agnostic /api/wrapper/status, otherwise
  // the UI falsely reports "Loading GPU model" whenever the agent mode is active.
  if (wrapperEnabled()) {
    try {
      const res = await fetch(`${backendBase()}/api/wrapper/status`, { signal: AbortSignal.timeout(1000) });
      if (!res.ok) return false;
      const status = await res.json();
      return status.state === "ready" || status.state === "busy" || status.state === "switching";
    } catch {
      return false;
    }
  }
  const res = await fetch(`${backendBase()}/v1/models`, { signal: AbortSignal.timeout(1000) });
  return res.ok;
}
function wrapperEnabled() {
  return Boolean(config.wrapper?.enabled);
}

// Which agent loop serves Agent Mode.  "native" keeps the C agent inside
// ds4-wrapper; "js" runs the Node loop against any OpenAI-compatible
// backend, ds4-wrapper in server mode included (convergenza.loop.md D1/D2).
function agentEngine() {
  return resolveAgentEngine({
    wrapperEnabled: wrapperEnabled(),
    engine: config.agent?.engine
  });
}

// WP17: the C agent is deprecated; say so once, where the operator looks.
{
  const warning = engineStartupWarning(agentEngine());
  if (warning) console.warn(`[agent] ${warning}`);
}

// WP4 of convergenza.loop.md: the skill state lives per session, and it is
// staged the way agent_worker_stage_legacy_skills stages it (soul, ethic and
// structure mandatory while DS4_SKILL_AUTO is not "0"; sage and lean are the
// Node loop's own policy modules, so their skill text is not framed twice).
// The C refuses the session when a mandatory default cannot be read; here the
// turn still runs, with the reason logged once, so an endpoint session started
// without a skills/ directory does not go dark.
const agentSkillStates = new Map();
let agentSkillStateWarned = false;

function agentSkillStateFor(sessionKey) {
  if (agentSkillStates.has(sessionKey)) return agentSkillStates.get(sessionKey);
  let state = null;
  try {
    state = createSessionSkillState({});
  } catch (error) {
    if (!agentSkillStateWarned) {
      agentSkillStateWarned = true;
      console.warn(`[agent] skill state unavailable, continuing without skills: ${error.message}`);
    }
    state = null;
  }
  agentSkillStates.set(sessionKey, state);
  return state;
}

function mergeRequestConfig(body = {}) {
  return mergeRequestOverConfig(config, body);
}

function publicConfig() {
  return redactConfigSecrets(config);
}

function asyncHandler(handler) {
  return (req, res, next) => {
    return Promise.resolve(handler(req, res, next)).catch(next);
  };
}

async function writeProxyChunk(res, chunk) {
  if (res.write(chunk)) return;
  await new Promise((resolve, reject) => {
    const cleanup = () => {
      res.off("drain", onDrain);
      res.off("close", onClose);
      res.off("error", onError);
    };
    const onDrain = () => {
      cleanup();
      resolve();
    };
    const onClose = () => {
      cleanup();
      reject(new Error("client disconnected"));
    };
    const onError = (err) => {
      cleanup();
      reject(err);
    };
    res.on("drain", onDrain);
    res.on("close", onClose);
    res.on("error", onError);
  });
}

function stripAutoMaxTokenFields(payload = {}) {
  const out = { ...payload };
  delete out.max_tokens_safety_cap;
  delete out.context_margin;
  return out;
}

async function resolveAutoMaxTokensPayload(payload, signal) {
  if (!payload || !isAutoMaxTokens(payload.max_tokens)) return stripAutoMaxTokenFields(payload);

  const settings = autoMaxTokenSettings(payload);
  const countPayload = stripAutoMaxTokenFields(payload);
  delete countPayload.max_tokens;

  let count = null;
  try {
    const countRes = await fetchWithBusyRetry(fetch, `${backendBase()}/v1/token-count`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(countPayload),
      signal
    });
    if (!countRes.ok) {
      try { await countRes.body?.cancel(); } catch {}
      throw new Error(`backend HTTP ${countRes.status}`);
    }
    count = await countRes.json();
  } catch (err) {
    // Graceful degradation: a failed auto-sizing probe (wrapper busy past the
    // retry budget, transient network error, …) must not kill the whole chat.
    // Fall back to the safety cap — resolveAutoMaxTokens(null, …) returns it —
    // and let the chat endpoint enforce the real context-length limit. An
    // explicit client abort is still propagated.
    if (signal?.aborted) throw err;
    count = null;
  }

  return {
    ...countPayload,
    max_tokens: resolveAutoMaxTokens(count, settings)
  };
}

async function maybeResolveProxyAutoMaxTokens(req, body, signal) {
  if (req.method !== "POST" || req.originalUrl.split("?")[0] !== "/v1/chat/completions") return body;
  if (!String(req.headers["content-type"] || "").toLowerCase().includes("application/json")) return body;
  let payload;
  try {
    payload = JSON.parse(body.toString("utf8"));
  } catch {
    return body;
  }
  if (!isAutoMaxTokens(payload?.max_tokens)) return body;
  const resolved = await resolveAutoMaxTokensPayload(payload, signal);
  return Buffer.from(JSON.stringify(resolved));
}

const manager = new Ds4ProcessManager({
  buildCommand: () => {
    if (!serverLaunchConfig) throw new Error("server launch config not initialized");
    return wrapperEnabled()
      ? buildDs4WrapperArgs(serverLaunchConfig)
      : buildDs4Args(serverLaunchConfig);
  },
  // semanticEnv last: a legacy key that survived in server.env must never win
  // over the resolved typed value.
  buildEnv: () => ({ ...config.server.env, ...semanticEnv }),
  healthCheck,
  cwd: PROJECT_ROOT
});

const agnoTokens = await ensureAgnoTokens({ homeDir: os.homedir() });
const agnoModelGate = new AgnoModelGate({
  maxInflight: config.agno.maxInflightModelCalls,
  maxQueued: config.agno.maxQueuedModelCalls,
  waitTimeoutMs: config.agno.modelQueueWaitTimeoutMs
});
const resolvedAgnoServiceDir = path.resolve(PROJECT_ROOT, config.agno.serviceDir || "agno_service");
const resolvedAgnoDbFile = path.resolve(PROJECT_ROOT, config.agno.dbFile || "data/agno/agno.db");
const resolvedAgnoModel = config.agno.model || config.server.model;
const agnoProcessManager = config.agno.enabled
  ? createAgnoProcessManager({
      projectRoot: PROJECT_ROOT,
      config,
      tokens: agnoTokens,
      resolvedModel: resolvedAgnoModel,
      resolvedServiceDir: resolvedAgnoServiceDir,
      resolvedDbFile: resolvedAgnoDbFile,
      ownerId: AGNO_OWNER_ID
    })
  : createDisabledAgnoProcessManager();
const agnoClient = new AgnoClient({
  baseUrl: `http://${config.agno.host}:${config.agno.port}`,
  serviceToken: agnoTokens.serviceToken,
  ownerId: AGNO_OWNER_ID
});

const resolvedAgentUiRuntimeDir =
  resolveAgentUiRuntimeDir({
    projectRoot: PROJECT_ROOT,
    config
  });
const agentUiProcessManager =
  config.agno.enabled && config.agno.agentUi.enabled
    ? createAgentUiProcessManager({
        config,
        runtimeDir: resolvedAgentUiRuntimeDir,
        expectedCommit: AGNO_AGENT_UI_COMMIT
      })
    : createDisabledAgentUiProcessManager({ config });

const agnoExecutionGuard = new AgnoExecutionGuard({
  controlBaseUrl: `http://${config.control.host}:${config.control.port}`,
  wrapperEnabled,
  modeSwitchTimeoutMs: config.wrapper?.modeSwitchTimeoutMs || 120000
});

const agnoModelGatewayRouter = createAgnoModelGateway({
  config,
  backendBase: backendBase(),
  modelGate: agnoModelGate,
  modelGatewayToken: agnoTokens.modelGatewayToken,
  executionGuard: agnoExecutionGuard
});
// Tool-bridge components (Agno-originated /api/internal/agno-tools/* calls).
// agnoToolAuthenticator needs agnoTokens.toolBridgeToken (line 425); policy
// and gate have no such dependency but live alongside it for readability.
// agnoToolSessions/agnoToolService are created further down, once their own
// dependencies (fileWorkspace, agentResearchService) are ready.
const agnoToolAuthenticator = new AgnoToolAuthenticator(agnoTokens.toolBridgeToken);
const agnoToolPolicy = new AgnoToolPolicy({
  enabled: config.agno.enabled && config.agno.tools.enabled,
  profile: config.agno.tools.profile,
  allowedTools: config.agno.tools.allowedTools,
  deniedTools: config.agno.tools.deniedTools
});
const agnoToolGate = new AgnoToolGate({
  maxInflight: config.agno.tools.maxInflight,
  maxQueued: config.agno.tools.maxQueued,
  waitTimeoutMs: config.agno.tools.requestTimeoutMs
});

const agnoRouter = createAgnoRouter({
  config,
  processManager: agnoProcessManager,
  agentUiProcessManager,
  modelGate: agnoModelGate,
  modelGatewayToken: agnoTokens.modelGatewayToken,
  agnoClient,
  executionGuard: agnoExecutionGuard,
  toolPolicy: agnoToolPolicy,
  toolGate: agnoToolGate,
  asyncHandler
});

const app = express();
// WP2: the single arbiter of the runtime resource and the server-side owner
// identity.  Every ingress inventoried in docs/integration-opendots/WP2.md
// acquires this lease (or is refused busy); work inside a run inherits it.
const agentAdmission = createAgentAdmission();
const fileWorkspace = await ensureWorkspace();
const agnoToolSessions = new AgnoToolSessionRegistry({
  workspaceRoot: fileWorkspace.root,
  maxHistoryMessages: config.agno.tools.maxHistoryMessages,
  maxHistoryBytes: config.agno.tools.maxHistoryBytes
});
const agnoToolSessionSweepTimer = setInterval(
  () => agnoToolSessions.sweep(),
  60_000
);
agnoToolSessionSweepTimer.unref?.();
const upload = multer({
  dest: fileWorkspace.uploadDir,
  limits: { fileSize: UPLOAD_LIMIT_BYTES },
  fileFilter: (_req, file, cb) => {
    if (isSupportedFileName(file.originalname)) cb(null, true);
    else cb(Object.assign(new Error(`unsupported file type: ${file.originalname}`), { status: 415 }));
  }
});

// WP2: reads pass through; /v1/cancel reaches the backend only from the
// owner of the active lease (and cancels that run cooperatively); every other
// mutating call (chat/completions, ...) runs under the shared lease.
app.use("/v1", async (req, res) => {
  if (req.method === "GET" || req.method === "HEAD") return proxyV1(req, res);
  try {
    agentIdentity.requireOrigin(req);
    const ownerId = agentIdentity.ownerOf(req, res);
    if (req.method === "POST" && req.path === "/cancel") {
      agentAdmission.cancelActiveFor(ownerId);
      return await proxyV1(req, res);
    }
    await agentAdmission.exclusive("v1-proxy", (ctx) => proxyV1(req, res, ctx.signal), { ownerId });
  } catch (error) {
    if (!(error instanceof AgentAdmissionError)) throw error;
    if (!res.headersSent) res.status(error.status).json({ error: error.message, code: error.code });
  }
});

async function proxyV1(req, res, leaseSignal = null) {
  const target = `${backendBase()}${req.originalUrl}`;
  const disconnect = abortOnClientDisconnect(req, res);
  const cleanup = disconnect.cleanup;
  const signal = leaseSignal ? AbortSignal.any([disconnect.signal, leaseSignal]) : disconnect.signal;
  let disarmBackendCancel = () => {};
  try {
    const hasRequestBody = !["GET", "HEAD"].includes(req.method);
    const rawBody = hasRequestBody ? await readRequestBody(req) : undefined;
    const body = hasRequestBody ? await maybeResolveProxyAutoMaxTokens(req, rawBody, signal) : undefined;
    const options = {
      method: req.method,
      headers: requestHeadersForProxy(req, body),
      signal
    };
    if (hasRequestBody) options.body = body;
    // The wrapper answers a transient 409 "busy" while another request is
    // streaming; retry with backoff so a quick race does not surface to the
    // user. The 409 is returned before any stream starts, so this is safe.
    const upstream = await fetchWithBusyRetry(
      fetch,
      target,
      options,
      busyRetryOptionsForRequest(req.method, req.originalUrl)
    );
    if (upstream.ok && isGenerationRequest(req.method, req.originalUrl)) {
      disarmBackendCancel = armBackendCancelOnDisconnect(signal, () =>
        fetch(`${backendBase()}/v1/cancel`, {
          method: "POST",
          signal: AbortSignal.timeout(5000)
        })
      );
    }
    res.status(upstream.status);
    upstream.headers.forEach((value, key) => res.setHeader(key, value));
    if (!upstream.body) return res.end();
    for await (const chunk of upstream.body) {
      await writeProxyChunk(res, chunk);
    }
    res.end();
  } catch (err) {
    if (!res.headersSent) res.status(502).json({ error: err.message });
    else res.destroy(err);
  } finally {
    disarmBackendCancel();
    cleanup();
  }
}

// Resolves when the response is closed (finished or connection gone).
function untilResponseClosed(res, start) {
  return new Promise((resolve) => {
    res.once("close", resolve);
    start();
  });
}

// WP2: each Agno model call takes the shared lease (busy 409 to Agno while a
// DS4 run or another call holds it).  A cross-origin browser is refused (403)
// before admission: it never takes the lease nor reaches the gateway.  The
// Agno service sends no browser metadata and passes.
app.use("/api/agno-model", (req, res) => {
  if (req.method !== "POST") return agnoModelGatewayRouter.handle(req, res);
  try {
    agentIdentity.requireOrigin(req);
  } catch (error) {
    if (error instanceof AgentAdmissionError) return admissionGuards.refuse(res, error);
    throw error;
  }
  agentAdmission.exclusive("agno-model", () => untilResponseClosed(res, () => agnoModelGatewayRouter.handle(req, res)), {
    ownerId: "agno-gateway"
  }).catch((error) => {
    if (error instanceof AgentAdmissionError && !res.headersSent) res.status(error.status).json({ error: error.message, code: error.code });
  });
});
app.use((req, res, next) => {
  if (req.path.startsWith("/api/agno") && !req.path.startsWith("/api/agno-model")) {
    // WP2: Agno start/stop switch the wrapper mode and stop agent sessions:
    // global controls, refused busy and serialized on the lease.
    if (req.method === "POST" && /\/api\/agno\/(start|stop)$/.test(req.path)) {
      return admissionGuards.control("agno-control")(req, res, () => agnoControl(req, res));
    }
    return agnoRouter.handle(req, res);
  }
  next();
});

function agnoControl(req, res) {
  {
    // Mutual exclusion: when Agno is explicitly started, stop agent mode.
    // (Body unchanged from the pre-WP2 middleware.)
    // Agno and the native agent compete for the wrapper's mode.
    if (req.method === "POST" && req.url.endsWith("/api/agno/start")) {
      (async () => {
        try {
          const agentStatus = agentSessions.status(agentSessionKey(req));
          if (agentStatus.active) {
            agentSessions.stop(agentSessionKey(req));
            if (wrapperEnabled()) {
              await fetch(`${backendBase()}/api/wrapper/switch-mode`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ mode: "server" }),
                signal: AbortSignal.timeout(config.wrapper?.modeSwitchTimeoutMs || 120000)
              });
            }
          }
        } catch {
          // Best-effort: agent stop failure must not block agno start.
        }
        agnoRouter.handle(req, res);
      })();
      return;
    }
    return agnoRouter.handle(req, res);
  }
}

app.use(express.json({ limit: "32mb" }));

// Register the WP2 controls before business routes so they run before route
// validation or side effects. The guard is resolved per request because its
// stable owner identity is initialized later in this module.
const AGENT_ADMISSION_CONTROL_ROUTES = new Set([
  "POST /api/profiles/select",
  "PUT /api/server/config",
  "POST /api/server/start",
  "POST /api/server/stop",
  "POST /api/server/restart",
  "POST /api/agent/start",
  "POST /api/agent/stop",
  "POST /api/agent/headroom",
  "POST /api/agent/gitnexus",
  "POST /api/agent/pony",
  "POST /api/sage/start",
  "POST /api/sage/stop",
  "POST /api/pageagent/enable",
  "POST /api/wrapper/switch-mode",
  "POST /api/native-agent/command"
]);
app.use((req, res, next) => {
  const label = `${req.method.toUpperCase()} ${req.path}`;
  if (!AGENT_ADMISSION_CONTROL_ROUTES.has(label)) return next();
  return admissionGuards.control(label)(req, res, next);
});

app.get("/api/files/supported", (_req, res) => {
  res.json({ accept: ACCEPT_ATTRIBUTE });
});

app.post("/api/files/upload", upload.single("file"), asyncHandler(async (req, res) => {
  const file = await ingestUploadedFile(req.file);
  res.json({ file });
}));

const MAP_SYSTEM_PROMPT =
  "You are an analyst. Summarize the provided document section preserving precisely: " +
  "facts, numbers, dates, proper names, definitions, regulatory references and important verbatim quotes. " +
  "Do not invent. If the section is hardly relevant to the user question, note it briefly. " +
  "Output: structured Markdown list.";

const REDUCE_SYSTEM_PROMPT =
  "You are an analyst. Answer the user question using only the provided section summaries " +
  "of the document. Cite the source section when stating a fact (e.g. 'sec. 3'). " +
  "If the summaries do not contain the answer, say so openly.";

function buildMapMessages({ chunk, question, totalChunks }) {
  const header = `Section ${chunk.index + 1}/${totalChunks}` +
    (chunk.title ? ` — "${chunk.title}"` : "");
  const user = [
    header,
    "",
    chunk.body,
    "",
    `User question (to orient focus, DO NOT answer here): ${question || "(none)"}`,
    "",
    "Produce a structured summary of this section."
  ].join("\n");
  return [
    { role: "system", content: MAP_SYSTEM_PROMPT },
    { role: "user", content: user }
  ];
}

function buildReduceMessages({ summaries, question, system }) {
  const joined = summaries
    .map((s) => {
      const head = `### Section ${s.index + 1}` + (s.title ? ` — ${s.title}` : "");
      return `${head}\n\n${s.summary}`;
    })
    .join("\n\n");
  const baseSystem = system && system.trim() ? `${system}\n\n${REDUCE_SYSTEM_PROMPT}` : REDUCE_SYSTEM_PROMPT;
  const user = [
    "Section summaries:",
    "",
    joined,
    "",
    `Question: ${question}`
  ].join("\n");
  return [
    { role: "system", content: baseSystem },
    { role: "user", content: user }
  ];
}

function writeSse(res, event, data) {
  if (res.writableEnded) return;
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

const compressionMetrics = createCompressionMetrics();

async function compressAgentToolResult(toolName, result) {
  return compressAgentToolResultIfEnabled({
    enabled: config?.toolBlobs?.compressEnabled,
    toolName,
    result,
    blobStore: toolBlobStore,
    metrics: compressionMetrics
  });
}

async function compressToolResultsInMessages(messages, toolBlobStore) {
  if (!config?.toolBlobs?.compressEnabled) return messages;
  const out = [];
  for (const msg of messages) {
    if (msg.role !== "tool" || !msg.content || Buffer.byteLength(msg.content, "utf8") < 4096) {
      out.push(msg);
      continue;
    }
    const compressed = await compressToolOutput(
      msg.name || "tool",
      msg.content,
      Buffer.byteLength(msg.content, "utf8"),
      toolBlobStore
    );
    if (!compressed || !compressed.changed || !compressed.text) {
      out.push(msg);
      continue;
    }
    compressionMetrics.recordCompression(compressed);
    out.push({ ...msg, content: compressed.text });
  }
  return out;
}

function maybeAddRetrieveBlobTool(payload) {
  if (!config?.toolBlobs?.compressEnabled) return payload;
  const hasIt = payload.tools?.find(t => t.function?.name === "retrieve_context_blob");
  if (hasIt) return payload;
  return {
    ...payload,
    tools: [
      ...(payload.tools || []),
      {
        type: "function",
        function: {
          name: "retrieve_context_blob",
          description: "Retrieve an exact byte range from a previously compressed tool output blob (server-side blob store).",
          parameters: {
            type: "object",
            properties: {
              id: { type: "string" },
              offset: { type: "integer", minimum: 0 },
              length: { type: "integer", minimum: 1, maximum: 200000 }
            },
            required: ["id"]
          }
        }
      }
    ]
  };
}

/**
 * Tools advertised to the model. Wrapped so the call sites that must produce
 * an identical tools hash cannot drift apart. Lean flags are resolved once per
 * request (see {@link leanToolFlags}) and passed explicitly to every call.
 */
// POST JSON with no header/body timeout (undici's fetch gives up after
// 300 s without response headers).  Only for calls whose length is bounded
// by the backend itself, like the compaction summary.
function postJsonNoTimeout(url, payload, signal) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const data = Buffer.from(JSON.stringify(payload));
    const request = (target.protocol === "https:" ? httpsRequest : httpRequest)(target, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": data.length },
      signal
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve({ status: response.statusCode, body: Buffer.concat(chunks).toString("utf8") }));
      response.on("error", reject);
    });
    request.on("error", reject);
    request.end(data);
  });
}

// WP10: DS4_EVIDENCE_MODE is validated at boot — an invalid value fails the
// frontend with a clear message, never a silent fallback (piano §13.3).
const EVIDENCE_MODE_BOOT = modeResolve(process.env.DS4_EVIDENCE_MODE || null, true);
if (!EVIDENCE_MODE_BOOT.ok) {
  throw new Error(`${EVIDENCE_MODE_BOOT.error} (DS4_EVIDENCE_MODE accepts off, shadow or block)`);
}

function modelFacingTools({ includeSage, leanEnabled, leanCoreOnly, evidenceEnabled = false }) {
  const tools = advertisedAgentTools({ sageEnabled: includeSage, leanEnabled, leanCoreOnly });
  // The C loop announces evidence_guard only while the skill is loaded (shadow
  // ds4_agent.c:7903-7909); same rule here.
  return evidenceEnabled ? appendOptionalTools(tools, [EVIDENCE_GUARD_TOOL]) : tools;
}

/**
 * Lean advertising flags, resolved once per request. Lean is advertised only
 * when the runtime is actually ready (requested && sandbox && userns && core),
 * and its schema shrinks to core-only when mathlib is not prepared — the model
 * is told what it can call, and unready profiles fail deterministically.
 */
// skillState: the session's skills.  With the Lean policy loaded (/lean start)
// lean_check is offered even when the runtime is not ready, as in C: the call
// then returns LEAN_RUNTIME_UNAVAILABLE and the policy turns that into a
// NOT_VERIFIED report.  Without the tool the policy still said "use
// lean_check" and the model wandered through page/bash tools until the
// iteration cap (WP17 follow-up).
async function leanToolFlags(skillState = null) {
  const state = await leanRuntimeState.get();
  return {
    leanEnabled: isLeanToolAdvertised(state) || Boolean(skillState?.promptSkills?.().lean),
    leanCoreOnly: leanToolCapability(state) === "core-only"
  };
}

async function callBackendCompletion({ messages, request, stream, signal }) {
  const compressed = await compressToolResultsInMessages(messages, toolBlobStore);
  let payload = await resolveAutoMaxTokensPayload(
    buildChatPayload({ ...request, stream }, compressed),
    signal
  );
  /* In Chat Mode, add standard tools (excluding sage) so the model can use web_search, web_read, search, etc. */
  if (!payload.tools) {
    payload.tools = modelFacingTools({ includeSage: false, ...(await leanToolFlags()) });
    /* Inform the model about available tools via a system message with examples */
    const toolNames = payload.tools.map(t => t.function.name).join(", ");
    const toolMsg = "[AVAILABLE TOOLS] You have access to: " + toolNames + 
      ". You MUST use these tools when they can help.\n" +
      "Example: User: \"Cerca su internet le ultime notizie su AI\" -> You should use web_search.\n" +
      "Example: User: \"Cerca nel codice tutti i file con export\" -> You should use search.\n" +
      "Example: User: \"Leggi il file index.js\" -> You should use read.\n" +
      "Never say you cannot access the internet. You have web_search and web_read tools.";
    payload.messages = [{ role: "system", content: toolMsg }, ...payload.messages];
    /* Set tool_choice to "auto" — model can choose to use tools or not */
    payload.tool_choice = "auto";
  }

  payload = maybeAddRetrieveBlobTool(payload);

  let res;
  try {
    res = await fetch(`${backendBase()}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal
    });
  } catch (err) {
    const cause = err && err.cause ? `: ${err.cause.code || err.cause.message || err.cause}` : "";
    throw new Error(`backend fetch ${backendBase()}/v1/chat/completions failed${cause}`);
  }
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`backend HTTP ${res.status}: ${txt.slice(0, 400)}`);
  }
  return res;
}

async function readJsonCompletion(res) {
  const data = await res.json();
  const msg = data.choices?.[0]?.message || {};
  return {
    content: msg.content || "",
    reasoning: msg.reasoning_content || msg.reasoning || "",
    usage: data.usage || null
  };
}

async function collectStreamedCompletion(res) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  let reasoning = "";
  let usage = null;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split(/\r?\n\r?\n/);
    buffer = parts.pop() || "";
    for (const part of parts) {
      const raw = parseSseBlock(part);
      if (!raw || raw === "[DONE]") continue;
      let ev;
      try {
        ev = JSON.parse(raw);
      } catch {
        continue;
      }
      if (ev.usage) usage = ev.usage;
      const delta = ev.choices?.[0]?.delta || {};
      content += delta.content || "";
      reasoning += delta.reasoning_content || delta.reasoning || "";
    }
  }
  return { content, reasoning, usage };
}

function parseSseBlock(block) {
  return block
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart().replace(/\r$/, ""))
    .join("\n");
}

function normalizeAgentToolCall(toolCall = {}) {
  if (toolCall.function?.name) {
    return {
      id: toolCall.id || `call_${Math.random().toString(36).slice(2)}`,
      type: "function",
      function: {
        name: toolCall.function.name,
        arguments: typeof toolCall.function.arguments === "string"
          ? toolCall.function.arguments
          : JSON.stringify(toolCall.function.arguments || {})
      }
    };
  }
  return {
    id: toolCall.id || `call_${Math.random().toString(36).slice(2)}`,
    type: "function",
    function: {
      name: toolCall.name || "unknown",
      arguments: typeof toolCall.arguments === "string"
        ? toolCall.arguments
        : JSON.stringify(toolCall.arguments || {})
    }
  };
}

function normalizeAgentMessage(message) {
  if (!message || typeof message !== "object" || message.agentNotice) return null;
  // Messages loaded from a Markdown archive are historical records, not
  // operational tool transcript. They must not reach the model's prompt.
  if (message.fromArchive) return null;
  const role = message.role;
  if (!["system", "user", "assistant", "tool", "function"].includes(role)) return null;

  if (role === "assistant") {
    const out = {
      role,
      content: typeof message.content === "string" && message.content ? message.content : null
    };
    if (message.reasoning_content) out.reasoning_content = message.reasoning_content;
    else if (message.reasoning) out.reasoning_content = message.reasoning;
    if (Array.isArray(message.tool_calls) && message.tool_calls.length) {
      out.tool_calls = message.tool_calls.map(normalizeAgentToolCall);
    }
    return out;
  }

  if (role === "tool" || role === "function") {
    const out = { role, content: String(message.content || "") };
    if (message.tool_call_id) out.tool_call_id = message.tool_call_id;
    if (message.name) out.name = message.name;
    return out;
  }

  return { role, content: String(message.content || "") };
}

function normalizeAgentMessages(messages) {
  return (Array.isArray(messages) ? messages : [])
    .map(normalizeAgentMessage)
    .filter(Boolean);
}

function registerChunkedAnalyzeRoute() {
  app.post("/api/files/chunked-analyze", asyncHandler(admissionGuards.route("chunked-analyze", async (req, res) => {
  const {
    document = "",
    question = "",
    system = "",
    chunkTokens = 25000,
    request: reqParams = {}
  } = req.body || {};

  if (!document || !document.trim()) {
    return res.status(400).json({ error: "document is empty" });
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no"
  });

  const controller = new AbortController();
  const abort = () => controller.abort();
  req.on("aborted", abort);
  res.on("close", () => {
    if (!res.writableEnded) controller.abort();
  });

  try {
    const chunks = splitMarkdownChunks(document, Number(chunkTokens) || 25000);
    const chunkLimit = maxAnalyzeChunks(process.env);
    writeSse(res, "phase", {
      phase: "split",
      chunks: chunks.length,
      tokensPerChunk: chunks.map((c) => c.approxTokens)
    });
    writeSse(res, "phase", analyzeChunkPlan(chunks, chunkLimit));

    if (chunks.length === 0) {
      writeSse(res, "error", { error: "no chunks produced" });
      return res.end();
    }
    if (analyzeChunkLimitExceeded(chunks, chunkLimit)) {
      writeSse(res, "error", {
        error: `too many chunks: ${chunks.length}`,
        chunks: chunks.length,
        maxChunks: chunkLimit
      });
      return res.end();
    }

    const summaries = [];
    for (let i = 0; i < chunks.length; i++) {
      if (controller.signal.aborted) {
        writeSse(res, "error", { error: "client cancelled" });
        return res.end();
      }
      const chunk = chunks[i];
      writeSse(res, "chunk_start", {
        index: i,
        title: chunk.title,
        approxTokens: chunk.approxTokens,
        total: chunks.length
      });
      const messages = buildMapMessages({ chunk, question, totalChunks: chunks.length });
      const upstream = await callBackendCompletion({
        messages,
        request: reqParams,
        stream: true,
        signal: controller.signal
      });
      const result = await collectStreamedCompletion(upstream);
      summaries.push({ index: i, title: chunk.title, summary: result.content });
      writeSse(res, "chunk_done", {
        index: i,
        title: chunk.title,
        summary: result.content,
        usage: result.usage
      });
    }

    writeSse(res, "phase", { phase: "reduce" });
    const reduceMessages = buildReduceMessages({ summaries, question, system });
    const reduceRes = await callBackendCompletion({
      messages: reduceMessages,
      request: { ...reqParams, max_tokens: reqParams.max_tokens || 2048 },
      stream: true,
      signal: controller.signal
    });
    const reader = reduceRes.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split(/\r?\n\r?\n/);
      buffer = parts.pop() || "";
      for (const part of parts) {
        const raw = parseSseBlock(part);
        if (!raw || raw === "[DONE]") continue;
        let event;
        try {
          event = JSON.parse(raw);
        } catch {
          continue;
        }
        const delta = event.choices?.[0]?.delta || {};
        const content = delta.content || "";
        const reasoning = delta.reasoning_content || delta.reasoning || "";
        if (content || reasoning) writeSse(res, "reduce_delta", { content, reasoning });
        if (event.usage) writeSse(res, "usage", event.usage);
      }
    }
    writeSse(res, "done", { chunks: chunks.length });
    res.end();
  } catch (err) {
    if (!res.writableEnded) {
      writeSse(res, "error", { error: err.message || String(err) });
      res.end();
    }
  } finally {
    req.off("aborted", abort);
  }
  })));
}

app.get("/api/rocm/status", asyncHandler(async (_req, res) => {
  res.json(await readAmdSmiStatusCached());
}));

function crawlBase() {
  return `http://${config.crawl.host}:${config.crawl.port}`;
}

// Node owns the crawl-service auth token: resolve it once (read the existing
// file or generate + persist), then hand it to the spawned service via env
// (DS4_CRAWL_TOKEN). Nothing reads the token file at request time, so there is
// no cold-start race where a crawl request beats the service writing the token.
let crawlTokenPromise = null;
function ensureCrawlToken() {
  if (crawlTokenPromise) return crawlTokenPromise;
  crawlTokenPromise = (async () => {
    const tokenPath = path.join(os.homedir(), ".config", "ds4-studio", "crawl", "token");
    try {
      const existing = (await fs.readFile(tokenPath, "utf-8")).trim();
      if (existing.length >= 43) return existing;
    } catch { }
    const token = crypto.randomBytes(32).toString("base64url"); // 43 chars, matches secrets.token_urlsafe(32)
    await fs.mkdir(path.dirname(tokenPath), { recursive: true, mode: 0o700 });
    await fs.writeFile(tokenPath, token + "\n", { mode: 0o600 });
    return token;
  })();
  return crawlTokenPromise;
}

function readCrawlToken() {
  return ensureCrawlToken();
}

// Built once. Null unless research.search is enabled, so disabled deployments
// pay no SourceCache/provider construction cost; the research_discover tool
// falls back to web_search when this is null or not enabled().
let agentResearchService = null;
try {
  if (config.research?.search?.enabled) {
    agentResearchService = buildSearchService(config.research.search, { fetchImpl: fetch, logger: console });
  }
} catch (err) {
  console.warn("ds4-ui: research service init failed:", err.message);
}

function currentEpistemicCitationProviders() {
  return {
    arxivProvider: agentResearchService?.providers?.arxiv ?? null,
    openAlexProvider: agentResearchService?.providers?.openalex ?? null
  };
}

// Tool-bridge execution service + router: created here (not alongside
// agnoToolAuthenticator/Policy/Gate above) because it needs agentResearchService,
// which isn't set until just above. §2.4 fail-closed: a disabled audit does
// not skip auditing silently inside the service — it gets a no-op stub so
// AgnoToolExecutionService.safeAudit() always has a real `.write()` to call.
const agnoToolAuditDir = path.isAbsolute(config.agno.tools.auditDir)
  ? config.agno.tools.auditDir
  : path.join(PROJECT_ROOT, config.agno.tools.auditDir);
const agnoToolAudit = config.agno.tools.auditEnabled
  ? new AgnoToolAudit({ auditDir: agnoToolAuditDir })
  : { write: async () => {} };

const agnoToolService = new AgnoToolExecutionService({
  policy: agnoToolPolicy,
  gate: agnoToolGate,
  sessionRegistry: agnoToolSessions,
  executionGuard: agnoExecutionGuard,
  workspaceRoot: fileWorkspace.root,
  toolBlobStore,
  sageCallLog,
  researchService: agentResearchService,
  crawlBaseUrl: crawlBase(),
  crawlToken: await readCrawlToken(),
  audit: agnoToolAudit,
  maxResponseBytes: config.agno.tools.maxResponseBytes
});

const agnoToolRouter = createAgnoToolRoutes({
  authenticator: agnoToolAuthenticator,
  policy: agnoToolPolicy,
  gate: agnoToolGate,
  sessionRegistry: agnoToolSessions,
  service: agnoToolService,
  maxRequestBytes: config.agno.tools.maxRequestBytes,
  asyncHandler
});

// createAgnoToolRoutes()'s router.handle() always writes a response (404s on
// no match, never calls back out to next()) — unlike agnoRouter's mount
// above, this MUST be gated on the path prefix or it would break every route
// registered after it up to the Vite fallback (index.mjs's Vite middleware
// mount, further below).
app.use((req, res, next) => {
  if (req.path.startsWith("/api/internal/agno-tools")) {
    return agnoToolRouter.handle(req, res);
  }
  next();
});

const agentCapabilities = getAgentCapabilities(config, {
  leanAdvertised: isLeanToolAdvertised(await leanRuntimeState.get())
});
const AGENT_SYSTEM_PROMPT_WITH_CAPS = [
  AGENT_SYSTEM_PROMPT,
  capabilitiesPromptSection(agentCapabilities),
  autonomyPromptSection(),
  agentCoreRulesSection(),
  agentEpistemicRulesSection()
].filter(Boolean).join("\n\n");

app.get("/api/crawl/preflight", asyncHandler(async (_req, res) => {
  res.json(await crawlPreflight({
    fetchImpl: fetch,
    crawlBaseUrl: crawlBase(),
    token: await readCrawlToken(),
    expectedOwner: CRAWL_OWNER_ID,
    wrapperBaseUrl: backendBase(),
    wrapperEnabled: wrapperEnabled()
  }));
}));

app.all("/api/crawl/*", asyncHandler(async (req, res) => {
  const target = `${crawlBase()}${req.originalUrl.replace(/^\/api\/crawl/, "")}`;
  const { signal, cleanup } = abortOnClientDisconnect(req, res);
  try {
    const token = await readCrawlToken();
    const body = ["GET", "HEAD"].includes(req.method) ? undefined : JSON.stringify(req.body);
    const upstream = await fetch(target, {
      method: req.method,
      headers: {
        "Content-Type": "application/json",
        Authorization: token ? `Bearer ${token}` : "",
        ...(body ? { "Content-Length": String(Buffer.byteLength(body)) } : {})
      },
      body,
      signal
    });
    if (req.headers.accept?.includes("text/event-stream") && upstream.headers.get("content-type")?.includes("text/event-stream")) {
      res.writeHead(upstream.status, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive"
      });
      for await (const chunk of upstream.body) {
        res.write(chunk);
      }
      res.end();
    } else {
      const data = await upstream.json();
      res.status(upstream.status).json(data);
    }
  } catch (err) {
    if (!res.headersSent) res.status(502).json({ error: err.message });
    else res.destroy(err);
  } finally {
    cleanup();
  }
}));

app.get("/api/profiles", asyncHandler(async (_req, res) => {
  const profiles = await listProfiles();
  const endpoints = (Array.isArray(config.server?.endpoints) ? config.server.endpoints : [])
    .filter((endpoint) => endpoint?.name && endpoint?.baseUrl && endpointLauncher(endpoint))
    .map((endpoint) => ({
      name: endpointProfileName(endpoint),
      label: endpoint.name,
      description: `Endpoint · loop JS · ${endpoint.model || endpoint.baseUrl}`,
      kind: "endpoint"
    }));
  res.json({
    profiles: [
      ...profiles.map(({ name, label, description, error }) => ({
        name,
        label,
        description: ["Local DS4 · wrapper C", description].filter(Boolean).join(" · "),
        error,
        kind: "local"
      })),
      ...endpoints
    ],
    selected: activeProfile?.name || null,
    defaultName: DEFAULT_PROFILE_NAME,
    requestDefaults: activeRequestDefaults
  });
}));

app.get("/api/profiles/current", (_req, res) => {
  res.json({
    selected: activeProfile?.name || null,
    label: activeProfile?.label || null,
    description: activeProfile?.description || "",
    requestDefaults: activeRequestDefaults,
    serverConfig: config.server
  });
});

app.post("/api/profiles/select", asyncHandler(async (req, res) => {
  const name = typeof req.body?.name === "string" ? req.body.name : "";
  if (!name) return res.status(400).json({ error: "name is required" });
  if (name.startsWith("endpoint:")) {
    const endpoint = configuredEndpoint(name.slice("endpoint:".length));
    if (!endpoint) return res.status(404).json({ error: `endpoint not found: ${name}` });
    let endpointUrl;
    try {
      endpointUrl = new URL(endpoint.baseUrl);
    } catch {
      return res.status(400).json({ error: `invalid endpoint URL: ${endpoint.baseUrl}` });
    }
    if (endpointUrl.protocol !== "http:" && endpointUrl.protocol !== "https:") {
      return res.status(400).json({ error: "endpoint URL must use http or https" });
    }
    if (endpointUrl.username || endpointUrl.password) {
      return res.status(400).json({ error: "endpoint credentials must not be embedded in the URL" });
    }
    const next = {
      ...config,
      selectedProfile: name,
      agent: { ...config.agent, engine: "js" },
      wrapper: { ...config.wrapper, enabled: false },
      server: {
        ...config.server,
        binary: endpointLauncher(endpoint),
        host: endpointUrl.hostname,
        port: Number(endpointUrl.port || (endpointUrl.protocol === "https:" ? 443 : 80)),
        attach: {
          ...config.server.attach,
          mode: "endpoint",
          name: endpoint.name,
          baseUrl: endpoint.baseUrl,
          model: endpoint.model || ""
        }
      }
    };
    const validation = validateConfig(next);
    if (!validation.ok) return res.status(400).json(validation);
    const launchCandidate = buildServerLaunchConfig(next, PROJECT_ROOT);
    await prepareServerLaunchPaths(launchCandidate, PROJECT_ROOT);
    config = await saveConfig(next);
    serverLaunchConfig = launchCandidate;
    activateConfiguredEndpoint(endpoint);
    return res.json({
      selected: activeProfile.name,
      requestDefaults: activeRequestDefaults,
      serverConfig: config.server,
      agentEngine: "js",
      backendRestartRequired: true
    });
  }
  const entry = await loadProfileByName(name);
  if (!entry || entry.error) {
    return res.status(404).json({ error: `profile not found: ${name}` });
  }
  const candidate = buildProfileCandidate(entry, config, REQUEST_DEFAULTS, name);
  candidate.config.wrapper = { ...candidate.config.wrapper, enabled: true };
  candidate.config.agent = { ...candidate.config.agent, engine: "native" };
  candidate.config.server.attach = {
    ...candidate.config.server.attach,
    mode: "local"
  };
  const validation = validateConfig(candidate.config);
  if (!validation.ok) return res.status(400).json(validation);
  const launchCandidate = buildServerLaunchConfig(candidate.config, PROJECT_ROOT);
  await prepareServerLaunchPaths(launchCandidate, PROJECT_ROOT);
  config = await saveConfig(candidate.config);
  serverLaunchConfig = launchCandidate;
  activeRequestDefaults = effectiveRequestDefaults(candidate.requestDefaults);
  activeProfile = entry;
  res.json({
    selected: activeProfile?.name || null,
    requestDefaults: activeRequestDefaults,
    serverConfig: config.server,
    agentEngine: "native",
    backendRestartRequired: true
  });
}));

app.get("/api/server/status", asyncHandler(async (_req, res) => {
  await manager.refreshHealth();
  res.json({
    config: publicConfig(),
    defaults: DEFAULT_CONFIG,
    backendBase: backendBase(),
    overrideCommand: manager.overrideCommand,
    profile: {
      selected: activeProfile?.name || null,
      label: activeProfile?.label || null,
      description: activeProfile?.description || "",
      requestDefaults: activeRequestDefaults
    },
    ...manager.status()
  });
}));

app.get("/api/server/metrics", asyncHandler(async (_req, res) => {
  // /api/server/metrics is ds4-server's own endpoint. An OpenAI-compatible
  // endpoint answers 404 in its own error shape, which says nothing about why:
  // name the reason instead of forwarding the confusion.
  if (config.server?.attach?.mode === "endpoint") {
    res.status(501).json({
      error: "Server metrics are a ds4-server feature and are not available " +
        `while attached to an endpoint (${config.server.attach.baseUrl || "unknown"}).`
    });
    return;
  }
  const upstream = await fetch(`${backendBase()}/api/server/metrics`, { signal: AbortSignal.timeout(1000) });
  const text = await upstream.text();
  res.status(upstream.status);
  res.type(upstream.headers.get("content-type") || "application/json");
  res.send(text);
}));

app.get("/api/server/config", (_req, res) => {
  res.json({ config: publicConfig(), defaults: DEFAULT_CONFIG });
});

app.get("/api/call-debug", (req, res) => {
  const limit = Number.parseInt(req.query.limit, 10);
  const n = Number.isInteger(limit) ? limit : undefined;
  const modelEntries = callDebugRecorder.list({ limit: n });
  const sageEntries = sageCallLog.list({ limit: n }).map((e) => ({
    id: e.id,
    ts: e.ts,
    category: "sage",
    method: "SAGE",
    status: e.exitCode != null ? e.exitCode : e.status === "success" ? 0 : -1,
    ok: e.status === "success",
    durationMs: e.durationMs,
    url: e.code || "",
    host: "localhost",
    error: e.error || null,
    reqBody: e.code || null,
    respBody: e.latexOutput || null,
    sageRaw: e
  }));
  // Merge and sort by timestamp descending
  const merged = [...modelEntries, ...sageEntries].sort(
    (a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime()
  );
  res.json({
    enabled: config.callDebug.enabled,
    entries: n ? merged.slice(0, n) : merged
  });
});

app.delete("/api/call-debug", (_req, res) => {
  callDebugRecorder.clear();
  sageCallLog.clear();
  res.json({ cleared: true });
});

app.put("/api/server/config", asyncHandler(async (req, res) => {
  const next = mergeRequestConfig(req.body);
  const validation = validateConfig(next);
  if (!validation.ok) return res.status(400).json(validation);
  config = await saveConfig(next);
  await refreshServerLaunchConfig();
  res.json({ config: publicConfig() });
}));

app.put("/api/history/settings", asyncHandler(async (req, res) => {
  const next = mergeRequestConfig({ history: req.body?.history || req.body || {} });
  const validation = validateConfig(next);
  if (!validation.ok) return res.status(400).json(validation);
  config = await saveConfig(next);
  res.json({ history: config.history, config: publicConfig() });
}));

app.post("/api/history/conversation", asyncHandler(async (req, res) => {
  if (!config.history.enabled) return res.json({ saved: false });
  const messages = Array.isArray(req.body?.messages) ? req.body.messages : [];
  if (!messages.length) return res.status(400).json({ error: "messages are required" });
  const fileName = typeof req.body?.fileName === "string" && req.body.fileName.trim() ? req.body.fileName.trim() : undefined;
  const metadata = req.body?.metadata && typeof req.body.metadata === "object" ? req.body.metadata : null;
  const file = await saveConversationHistory(messages, { dir: config.history.dir, fileName, metadata });
  res.json({ saved: true, file });
}));

app.get("/api/history/conversations", asyncHandler(async (_req, res) => {
  const sessions = await listConversationHistory(config.history.dir);
  res.json({ sessions });
}));

app.get("/api/history/conversations/:fileName", asyncHandler(async (req, res) => {
  const session = await loadConversationHistory(config.history.dir, req.params.fileName);
  res.json({ session });
}));

app.delete("/api/history/conversations/:fileName", asyncHandler(async (req, res) => {
  const result = await deleteConversationHistory(config.history.dir, req.params.fileName);
  res.json({ deleted: true, file: result });
}));

app.delete("/api/history/conversations", asyncHandler(async (_req, res) => {
  const result = await deleteAllConversationHistory(config.history.dir);
  res.json(result);
}));

app.post("/api/export/conversation", asyncHandler(async (req, res) => {
  const messages = Array.isArray(req.body?.messages) ? req.body.messages : [];
  const exportMode = String(req.body?.mode || "obsidian").trim();
  const professionalMarkdown = typeof req.body?.markdown === "string"
    ? req.body.markdown.trim()
    : "";
  if (exportMode === "professional") {
    if (!professionalMarkdown) {
      return res.status(400).json({ error: "markdown is required for professional export" });
    }
  } else if (!messages.length) {
    return res.status(400).json({ error: "messages are required" });
  }

  const rawDir = typeof req.body?.dir === "string" ? req.body.dir.trim() : "";
  if (!rawDir) return res.status(400).json({ error: "dir is required" });
  const expandedDir = rawDir.startsWith("~")
    ? path.join(os.homedir(), rawDir.slice(rawDir.startsWith("~/") ? 2 : 1))
    : rawDir;
  const resolvedDir = path.resolve(expandedDir);

  const fileNameRaw = typeof req.body?.fileName === "string" ? req.body.fileName.trim() : "";
  if (!fileNameRaw) return res.status(400).json({ error: "fileName is required" });
  if (fileNameRaw !== path.basename(fileNameRaw) || !fileNameRaw.endsWith(".md")) {
    return res.status(400).json({ error: "invalid fileName" });
  }

  const includeReasoning = Boolean(req.body?.includeReasoning);
  const exporter = exportMode === "raw" ? exportConversationMarkdownRaw : exportConversationMarkdown;
  const markdown = exportMode === "professional"
    ? `${professionalMarkdown}\n`
    : exporter(messages, { includeReasoning });

  await fs.mkdir(resolvedDir, { recursive: true });
  const filePath = path.join(resolvedDir, fileNameRaw);
  await fs.writeFile(filePath, markdown, "utf8");
  res.json({ saved: true, file: { fileName: fileNameRaw, filePath } });
}));

function applyCommandOverride(body) {
  if (!body || typeof body !== "object") return false;
  if (typeof body.command !== "string") return false;
  const trimmed = body.command.trim();
  if (!trimmed) {
    manager.setOverrideCommand(null);
    return true;
  }
  const argv = parseCommandLine(trimmed);
  manager.setOverrideCommand(argv);
  return true;
}

app.post("/api/server/start", asyncHandler(async (req, res) => {
  try {
    if (applyCommandOverride(req.body)) {
      // override applied (or cleared)
    } else if (req.body && Object.keys(req.body).length) {
      const next = mergeRequestConfig(req.body);
      const validation = validateConfig(next);
      if (!validation.ok) return res.status(400).json(validation);
      config = await saveConfig(next);
      manager.setOverrideCommand(null);
    }
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  res.json(await manager.start());
}));

app.post("/api/server/stop", asyncHandler(async (_req, res) => {
  res.json(await manager.stop());
}));

app.post("/api/server/restart", asyncHandler(async (req, res) => {
  try {
    if (applyCommandOverride(req.body)) {
      // override applied (or cleared)
    } else if (req.body && Object.keys(req.body).length) {
      const next = mergeRequestConfig(req.body);
      const validation = validateConfig(next);
      if (!validation.ok) return res.status(400).json(validation);
      config = await saveConfig(next);
      manager.setOverrideCommand(null);
    }
    await refreshServerLaunchConfig();
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  res.json(await manager.restart());
}));

app.get("/api/server/logs", (_req, res) => {
  res.json({ logs: manager.status().logs });
});

app.get("/api/server/logs/stream", (req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive"
  });
  const onLog = (entry) => res.write(`data: ${JSON.stringify(entry)}\n\n`);
  manager.on("log", onLog);
  req.on("close", () => manager.off("log", onLog));
});
// ---------------------------------------------------------------------------
// Agent Mode Endpoints
// ---------------------------------------------------------------------------

const agentSessions = new AgentSessionStore();
const aguiFlags = aguiFeatureFlags();
const localThreadDatabasePath = process.env.DS4_LOCAL_THREADS_DB;
if (aguiFlags.localThreads && !localThreadDatabasePath) {
  throw new Error("DS4_LOCAL_THREADS_ENABLED requires DS4_LOCAL_THREADS_DB to name the local SQLite database");
}
const localThreadStorage = aguiFlags.localThreads ? await openLocalThreadStorage({
  databasePath: path.resolve(PROJECT_ROOT, localThreadDatabasePath),
  startSession: (sessionKey) => agentSessions.start(sessionKey),
  restoreSession: (sessionKey, binding) => agentSessions.restoreCheckpoint(sessionKey, binding.checkpoint),
  stopSession: (sessionKey) => agentSessions.stop(sessionKey)
}) : null;
const agentIdentity = createAgentIdentity({ secret: localThreadStorage?.store.getOrCreateOwnerSecret() });
const admissionGuards = createAdmissionGuards({ admission: agentAdmission, identity: agentIdentity });
registerChunkedAnalyzeRoute();
// Both limits come from config/agent-loop-policy.json (generated descriptor),
// the same source the C loop reads through generated/agent_loop_policy.h, so
// the two engines cannot drift apart (convergenza.loop.md D3).
const AGENT_LOOP_POLICY = loadAgentLoopPolicy();
const AGENT_MAX_ITERATIONS = AGENT_LOOP_POLICY.maxAgentIterations;
const AGENT_SSE_KEEPALIVE_MS = Number(process.env.DS4_AGENT_SSE_KEEPALIVE_MS) || 15000;
const AGENT_LEAN_ROUND_MAX_TOKENS = Number(process.env.DS4_AGENT_LEAN_ROUND_MAX_TOKENS) || 8192;
// A reply made only of [OBSERVATION]..[VERDICT] is a checkpoint the
// compressed-output contract asked for, not an answer: GO with a target means
// the model meant to keep going. Nudge it on instead of ending the turn there,
// at most this many times in a row (the iteration cap still bounds the turn).
const AGENT_MAX_CHECKPOINT_NUDGES = AGENT_LOOP_POLICY.maxCheckpointNudges;
// WP7 of convergenza.loop.md: reminder thresholds live in the shared policy
// (config/agent-loop-policy.json), never as literals here.
const AGENT_REMINDER_THRESHOLDS = Object.freeze({
  systemPromptReminderTokens: AGENT_LOOP_POLICY.systemPromptReminderTokens,
  reminderToolBurstTokens: AGENT_LOOP_POLICY.reminderToolBurstTokens
});
// WP9 of convergenza.loop.md: JS-only session files (the C KV store is never
// read; config.mjs has no cache_dir yet, so the plan's fallback applies).
const AGENT_SESSIONS_DIR = resolveSessionsDir(runtimeConfig, process.env);
const AGENT_CHECKPOINT_CONTINUE_PROMPT = (target) =>
  "[DS4 Studio] Checkpoint received. Continue now: call the tool needed for TARGET_SELECTED " +
  `(${String(target).slice(0, 300)}). Do not repeat the checkpoint.`;
// A reply cut at max_tokens is not an answer (see the truncation branch).
const AGENT_MAX_TRUNCATION_NUDGES = 2;
const AGENT_TRUNCATION_PROMPT = (maxTokens) =>
  `[DS4 Studio] Your previous reply was cut off at the output token limit (max_tokens=${maxTokens ?? "?"}) ` +
  "before it finished; any tool call in it was incomplete and was NOT executed. Continue the task in smaller " +
  "pieces: write a large file as a first part with write, then append the rest with further edit calls, " +
  "and keep reasoning short.";
const AGENT_CHECKPOINT_FINAL_PROMPT =
  "[DS4 Studio] Checkpoint received. Now write the final answer for the user, in the user's language, " +
  "as a normal prose report (markdown headings/lists are fine) with everything found so far and file:line " +
  "references. Do not use the [OBSERVATION]/[COMPRESSED]/[TARGET_SELECTED]/[VERDICT] markers.";
// One extra, tool-less round once the cap is reached: instead of dropping
// everything the agent found, it reports where the analysis stands and, if it
// is not done, asks the user whether to go deeper. A "yes" in chat starts a
// new turn with a fresh budget and the whole context intact.
const AGENT_ITERATION_LIMIT_PROMPT =
  `[DS4 Studio] Tool-call limit reached (${AGENT_MAX_ITERATIONS} iterations): no more tools are available in this turn. ` +
  "Answer now, in the user's language, without calling any tool:\n" +
  "1. State of the analysis: what you checked and what you found so far, with file/line references where you have them.\n" +
  "2. If the task is complete, give the final answer.\n" +
  "3. If it is not complete, say what remains to be examined and end by asking the user explicitly " +
  "whether they want you to continue the analysis in more depth.";
const AGENT_STATEFUL_PATH = process.env.DS4_AGENT_STATEFUL_PATH || "/v1/ds4/stateful/chat/completions";
const AGENT_STATEFUL_MODE = (process.env.DS4_AGENT_STATEFUL || "auto").toLowerCase();
const AGENT_PROBE_TTL_MS = 60 * 1000;
const AGENT_READ_GUARD_MODE = (process.env.DS4_AGENT_READ_GUARD_MODE || "exact").toLowerCase() === "strict"
  ? "strict"
  : "exact";
const headroomHandlers = createHeadroomHandlers({
  getConfig: () => config,
  saveConfig: async (next) => {
    config = await saveConfig(next);
    return config;
  }
});

let _agentProbeResult = null;
let _agentProbeAt = 0;
let _agentProbeInflight = null;

async function probeStatefulBackend() {
  if (AGENT_STATEFUL_MODE === "1" || AGENT_STATEFUL_MODE === "on") return true;
  if (AGENT_STATEFUL_MODE === "0" || AGENT_STATEFUL_MODE === "off") return false;
  // With the wrapper enabled the agent runs through /api/native-agent/chat and
  // never touches the stateful path; probing it only spams the wrapper with
  // 404s, so report "unsupported" without a network round-trip.
  if (agentEngine() === "native") return false;
  // WP13 (§16.3): with the wrapper active the engine can only be js, and the
  // wrapper in server mode has no stateful endpoint at all (plan §1.2): the
  // JS loop resends the full prompt every round.  Report "unsupported"
  // without a probe so nothing generates a 404 per call.
  if (wrapperEnabled()) return false;
  const now = Date.now();
  if (_agentProbeResult !== null && now - _agentProbeAt < AGENT_PROBE_TTL_MS) return _agentProbeResult;
  if (_agentProbeInflight) return _agentProbeInflight;
  _agentProbeInflight = (async () => {
    try {
      const probeBody = {
        session_id: `__ds4studio_probe_${now}`,
        mode: "reset",
        parent_revision: 0,
        model: "probe",
        max_tokens: 1,
        messages: [{ role: "user", content: "probe" }]
      };
      const r = await fetch(`${backendBase()}${AGENT_STATEFUL_PATH}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(probeBody),
        signal: AbortSignal.timeout(1500)
      });
      // The stateful endpoint exists if the response is not 404/405.  4xx
      // (validation errors) and 5xx (model load failures) still indicate the
      // route is wired up; only Not Found / Method Not Allowed disprove it.
      _agentProbeResult = r.status !== 404 && r.status !== 405;
      try { await r.body?.cancel(); } catch {}
    } catch {
      _agentProbeResult = false;
    } finally {
      _agentProbeAt = Date.now();
      _agentProbeInflight = null;
    }
    return _agentProbeResult;
  })();
  return _agentProbeInflight;
}

function agentSessionKey(req) {
  const headerKey = typeof req.get === "function" ? req.get("X-Agent-Session-Key") : null;
  const bodyKey = req.body && typeof req.body === "object" ? req.body.sessionKey : null;
  return (headerKey || bodyKey || "").toString();
}

function writeAgentCommandSse(res, events) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no"
  });
  for (const item of events) {
    res.write(`event: ${item.event}\ndata: ${JSON.stringify(item.data)}\n\n`);
  }
  res.end();
}

function ponyCommandFromText(text) {
  const match = String(text || "").trim().match(/^\/pony(?:\s+(\S+))?\s*$/i);
  if (!match) return null;
  const arg = (match[1] || "status").toLowerCase();
  if (arg === "status") return { action: "status" };
  const mode = normalizePonyMode(arg);
  return mode ? { action: "set", mode } : { action: "invalid", mode: arg };
}

function ponyCommandPayload(req, command) {
  return ponyCommandPayloadForSession(agentSessionKey(req), command);
}

// WP1: same answer keyed by the session, for AgentRunService (no request).
function ponyCommandPayloadForSession(sessionKey, command) {
  const status = agentSessions.status(sessionKey);
  if (command.action === "status") {
    return {
      status: 200,
      payload: {
        ok: true,
        ...status,
        message: `Pony mode: ${status.ponyMode || "off"}. Applies only to Agent Mode.`
      }
    };
  }
  if (command.action === "invalid") {
    return {
      status: 400,
      payload: {
        ok: false,
        ...status,
        error: `Invalid /pony mode: ${command.mode}. Use start, stop, status, lite, full, or ultra.`
      }
    };
  }
  const session = agentSessions.get(sessionKey);
  if (!session || !session.active) {
    return {
      status: 400,
      payload: {
        ok: false,
        active: false,
        ponyMode: "off",
        error: "Pony mode applies only in Agent Mode. Use /agent start first."
      }
    };
  }
  const nextStatus = session.setPonyMode(command.mode);
  return {
    status: 200,
    payload: {
      ok: true,
      ...nextStatus,
      message: ponyCommandMessage(command.mode)
    }
  };
}

function ponyCommandEventsForSession(sessionKey, command) {
  const result = ponyCommandPayloadForSession(sessionKey, command);
  const payload = result.payload;
  if (result.status >= 400) {
    return [
      { event: "agent_error", data: { error: payload.error || payload.message || "Pony command failed." } },
      { event: "agent_done", data: { finish_reason: "error", active: Boolean(payload.active) } }
    ];
  }
  return [
    { event: "agent_status", data: payload },
    { event: "agent_text", data: { content: payload.message } },
    { event: "agent_done", data: { finish_reason: "command", active: Boolean(payload.active) } }
  ];
}

app.post("/api/agent/start", asyncHandler(async (req, res) => {
  // Mutual exclusion: stop Agno before entering agent mode. Agno and
  // the native agent compete for the wrapper's mode — they must never
  // run concurrently.
  if (config.agno.enabled) {
    try {
      const agnoStatus = agnoProcessManager.status();
      if (agnoStatus.running) {
        await agnoProcessManager.stop();
      }
    } catch {
      // Best-effort: agno stop failure must not block agent start.
    }
  }

  if (agentEngine() === "native") {
    const switchTimeoutMs = config.wrapper?.modeSwitchTimeoutMs || 120000;
    const up = await fetch(`${backendBase()}/api/wrapper/switch-mode`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "agent" }),
      signal: AbortSignal.timeout(switchTimeoutMs)
    });
    const body = await up.json();
    if (!up.ok) return res.status(up.status).json(body);

    // The native runtime used to initialize lazily on the first chat turn.
    // At very large contexts that made the first prompt appear frozen for
    // minutes.  Warm it here and expose Agent Mode only after it is ready.
    const prepared = await prepareNativeAgentRuntime(
      fetch,
      backendBase(),
      AbortSignal.timeout(Math.max(switchTimeoutMs, 300000))
    );
    if (!prepared.ok) {
      return res.status(prepared.status || 500).json(prepared.payload);
    }

    const status = agentSessions.start(agentSessionKey(req));
    return res.json({
      ...status,
      native: true,
      wrapper: body,
      runtime: prepared.payload
    });
  }
  // WP13: engine js with the wrapper active.  The JS loop speaks the
  // OpenAI-compatible server endpoints, so the wrapper must leave agent
  // mode before the session starts; the helper only ever asks for
  // "server" and never prepares the native runtime (plan §16.1).
  if (wrapperEnabled()) {
    const ready = await ensureServerModeForJsEngine({
      fetchImpl: fetch,
      base: backendBase(),
      switchTimeoutMs: config.wrapper?.modeSwitchTimeoutMs || 120000
    });
    if (!ready.ok) {
      return res
        .status(ready.status || 502)
        .json(ready.payload ?? { error: ready.error || "wrapper is not reachable" });
    }
  }
  const status = agentSessions.start(agentSessionKey(req));
  res.json({ ...status, native: false });
}));

app.post("/api/agent/stop", asyncHandler(async (req, res) => {
  if (agentEngine() === "native") {
    const up = await fetch(`${backendBase()}/api/wrapper/switch-mode`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "server" }),
      signal: AbortSignal.timeout(config.wrapper?.modeSwitchTimeoutMs || 120000)
    });
    const body = await up.json();
    if (!up.ok) return res.status(up.status).json(body);
    const status = agentSessions.stop(agentSessionKey(req));
    return res.json({ ...status, native: true, wrapper: body });
  }
  const status = agentSessions.stop(agentSessionKey(req));
  res.json({ ...status, native: false });
}));

app.get("/api/agent/status", async (req, res) => {
  const status = agentSessions.status(agentSessionKey(req));
  let statefulSupported;
  try { statefulSupported = await probeStatefulBackend(); } catch { statefulSupported = false; }
  res.json({
    ...status,
    statefulSupported,
    statefulMode: AGENT_STATEFUL_MODE,
    readGuardMode: AGENT_READ_GUARD_MODE
  });
});

// ContextWiki (§15): read-only diagnostics. Never exposes the raw sessionKey,
// full capsule text, raw evidence, or blob content — only sanitized summaries.
app.get("/api/agent/context/status", async (req, res) => {
  const sessionKey = agentSessionKey(req);
  const cfg = runtimeConfig.contextWiki;
  const meta = await readCapsuleMeta(sessionKey).catch(() => null);
  const telemetry = await readContextTelemetry(sessionKey, { limit: 20 }).catch(() => []);
  const events = await readContextEvents(sessionKey, { limit: 20 }).catch(() => []);
  res.json(contextStatusPayload({ config: cfg, meta, telemetry, events }));
});

app.get("/api/agent/pony", asyncHandler(async (req, res) => {
  const status = agentSessions.status(agentSessionKey(req));
  res.json({
    ok: true,
    active: status.active,
    ponyMode: status.ponyMode || "off",
    message: `Pony mode: ${status.ponyMode || "off"}. Applies only to Agent Mode.`
  });
}));

app.get("/api/agent/headroom", asyncHandler(headroomHandlers.status));

app.post("/api/agent/headroom", asyncHandler(headroomHandlers.set));

/** Look up the active agent session for the given request. */
function lookupAgentSession(req) {
  return agentSessions.get(agentSessionKey(req));
}

app.get("/api/agent/gitnexus", asyncHandler(async (req, res) => {
  const session = lookupAgentSession(req);
  if (!session) return res.json({ ok: false, enabled: false, message: "No active agent session." });
  res.json({ ok: true, enabled: session.gitnexusEnabled || false, message: `GitNexus mode: ${session.gitnexusEnabled ? "ON" : "OFF"}.` });
}));

app.post("/api/agent/gitnexus", asyncHandler(async (req, res) => {
  const session = lookupAgentSession(req);
  if (!session) return res.json({ ok: false, error: "No active agent session." });
  const enabled = Boolean(req.body?.enabled);
  session.gitnexusEnabled = enabled;
  if (session.active) session.reset(`gitnexus mode set to ${enabled ? "ON" : "OFF"}; session reset`);
  res.json({ ok: true, enabled, message: `GitNexus mode ${enabled ? "enabled" : "disabled"}.` });
}));

async function rewriteSearchQuery(rawQuery) {
  const today = new Date().toLocaleDateString("it-IT", {
    weekday: "long", day: "numeric", month: "long", year: "numeric"
  });
  const system =
    "Sei un ottimizzatore di query per la ricerca web (Google e Google News).\n" +
    "Ragiona su cosa cerca davvero l'utente, poi scrivi la singola query migliore da passare al motore di ricerca.\n" +
    `Oggi è ${today}: rendi concreti i riferimenti temporali (oggi, ultime, in giornata...); per le notizie recenti puoi usare gli operatori di Google News come when:1d.\n` +
    "Rispondi SOLO con la query finale, su una riga, senza virgolette né spiegazioni.";
  const payload = {
    model: activeRequestDefaults.model,
    messages: [
      { role: "system", content: system },
      { role: "user", content: rawQuery }
    ],
    stream: false,
    temperature: 0.2,
    max_tokens: 256
  };
  const res = await fetch(`${backendBase()}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!res.ok) throw new Error(`rewrite HTTP ${res.status}`);
  const { content, reasoning } = await readJsonCompletion(res);
  const optimized = (content || "").trim().split("\n").map((l) => l.trim()).filter(Boolean).pop() || "";
  return { query: optimized.replace(/^["'`]|["'`]$/g, "").trim() || rawQuery, reasoning };
}

app.post("/api/agent/web-search", asyncHandler(admissionGuards.route("web-search", async (req, res) => {
  const { validateSearchQuery } = await import("./searchQueryGuard.mjs");
  const validation = validateSearchQuery(req.body?.query);

  if (!validation.ok) {
    return res.status(400).json({
      ok: false,
      error: "invalid search query",
      reason: validation.reason,
      query: validation.query
    });
  }

  try {
    const { webSearch } = await import("./webSearchTool.mjs");
    const result = await webSearch(validation.query);

    res.json({
      ok: true,
      result,
      query: validation.query
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
})));

app.get("/api/agent/compression-metrics", asyncHandler(createCompressionMetricsHandler({
  getEngine: agentEngine,
  getBackendBase: backendBase,
  isEnabled: () => config?.toolBlobs?.compressEnabled,
  metrics: compressionMetrics,
  fetchImpl: fetch
})));

app.post("/api/agent/pony", asyncHandler(async (req, res) => {
  const session = agentSessions.get(agentSessionKey(req));
  if (!session || !session.active) {
    return res.status(400).json({
      ok: false,
      active: false,
      ponyMode: "off",
      error: "Pony mode applies only in Agent Mode. Use /agent start first."
    });
  }
  const normalized = normalizePonyMode(req.body?.mode || req.body?.action || "status");
  if (!normalized) {
    return res.status(400).json({
      ok: false,
      active: true,
      ponyMode: session.ponyMode,
      error: "Invalid pony mode. Use one of: start, stop, off, lite, full, ultra, status."
    });
  }
  const status = session.setPonyMode(normalized);
  res.json({
    ok: true,
    ...status,
    message: ponyCommandMessage(normalized)
  });
}));

// ---------------------------------------------------------------------------
// SageMath control endpoints
// ---------------------------------------------------------------------------

const SAGE_NATIVE_POLICY_TIMEOUT_MS = 5 * 60 * 1000;

async function nativeSagePolicyCommand(action) {
  if (!wrapperEnabled()) return null;
  return proxyNativeAgentCommand(
    fetch,
    backendBase(),
    `/sage-pol ${action}`,
    AbortSignal.timeout(Math.max(
      config.wrapper?.modeSwitchTimeoutMs || 120000,
      SAGE_NATIVE_POLICY_TIMEOUT_MS
    ))
  );
}

function nativeSagePolicyLoaded(result) {
  return result?.ok === true && result?.payload?.data?.loaded === true;
}

function nativePolicyAlreadyInactive(result) {
  return result?.status === 400 && /not active/i.test(String(result?.payload?.message || ""));
}

app.post("/api/sage/start", asyncHandler(async (req, res) => {
  // Check if sage binary exists
  if (!sageBinaryExists()) {
    sageState.enabled = false;
    return res.status(404).json({
      active: false,
      error: "SageMath non è installato su questa macchina. Installa SageMath per usare questo comando."
    });
  }

  // Check if sage responds
  const health = await sageResponds();
  if (!health.ok) {
    sageState.enabled = false;
    return res.status(503).json({
      active: false,
      error: `SageMath è installato ma non risponde: ${health.error || "errore sconosciuto"}. Verifica che sage sia avviabile con 'sage -c "print(pi)"'.`
    });
  }

  try {
    activateSagePolicy();
  } catch (err) {
    sageState.enabled = false;
    return res.status(500).json({
      active: false,
      policyActive: false,
      error: `Impossibile caricare skills/sage/SKILL.md: ${err.message}`
    });
  }

  // A timed-out HTTP client does not cancel the synchronous native reset.
  // Check status first so retrying /sage start reuses a policy that completed
  // in the background instead of triggering another expensive context rebuild.
  const nativeStatus = await nativeSagePolicyCommand("status");
  const nativePolicyReused = nativeSagePolicyLoaded(nativeStatus);
  const nativePolicy = nativePolicyReused
    ? nativeStatus
    : await nativeSagePolicyCommand("start");
  if (nativePolicy && !nativePolicy.ok) {
    deactivateSagePolicy();
    return res.status(nativePolicy.status || 500).json({
      active: false,
      policyActive: false,
      error: nativePolicy.payload?.message || nativePolicy.payload?.error ||
        "Impossibile caricare la skill Sage nel contesto nativo."
    });
  }

  sageState.version = health.version;
  sageState.lastCheck = new Date().toISOString();
  res.json({
    active: true,
    enabled: true,
    policyActive: true,
    nativePolicyActive: nativePolicy ? true : null,
    nativePolicyReused,
    policyPath: sageState.policyPath,
    policyRevision: sageState.policyRevision,
    message: nativePolicyReused
      ? `SageMath attivo; skill Sage nativa già caricata (${health.version || "versione sconosciuta"}).`
      : `SageMath e skill Sage attivati (${health.version || "versione sconosciuta"}).`
  });
}));

app.post("/api/sage/stop", asyncHandler(async (req, res) => {
  const nativePolicy = await nativeSagePolicyCommand("stop");
  if (nativePolicy && !nativePolicy.ok && !nativePolicyAlreadyInactive(nativePolicy)) {
    return res.status(nativePolicy.status || 500).json({
      active: true,
      policyActive: true,
      error: nativePolicy.payload?.message || nativePolicy.payload?.error ||
        "Impossibile rimuovere la skill Sage dal contesto nativo."
    });
  }
  deactivateSagePolicy();
  res.json({
    active: false,
    enabled: false,
    policyActive: false,
    nativePolicyActive: nativePolicy ? false : null,
    message: "SageMath e skill Sage disattivati."
  });
}));

app.get("/api/sage/status", asyncHandler(async (req, res) => {
  const nativePolicy = await nativeSagePolicyCommand("status");
  const nativePolicyActive = nativePolicy?.ok
    ? Boolean(nativePolicy.payload?.data?.loaded)
    : null;
  // Recover local state after a frontend restart or after the original HTTP
  // request timed out while the native command continued to completion.
  let localPolicyError = null;
  if (nativePolicyActive === true && !sagePolicyIsActive()) {
    try {
      activateSagePolicy();
    } catch (err) {
      localPolicyError = err.message || String(err);
    }
  }
  const localPolicyActive = sagePolicyIsActive();
  const policyActive = nativePolicyActive ?? localPolicyActive;
  res.json({
    enabled: sageState.enabled,
    active: sageState.enabled,
    policyActive,
    localPolicyActive,
    nativePolicyActive,
    policyError: localPolicyError || (nativePolicy && !nativePolicy.ok
      ? nativePolicy.payload?.message || nativePolicy.payload?.error || `HTTP ${nativePolicy.status}`
      : null),
    version: sageState.version,
    lastCheck: sageState.lastCheck,
    policyPath: sageState.policyPath,
    policyRevision: sageState.policyRevision,
    binaryExists: sageBinaryExists(),
    orchestration: sageMetrics.snapshot(),
    message: `SageMath ${sageState.enabled ? "attivo" : "inattivo"}; skill Sage ${policyActive ? "attiva" : "inattiva"}.`
  });
}));

/**
 * Execute SageMath and return the result.
 * Used by the C agent (ds4-wrapper) to delegate sage execution via HTTP.
 * Body: { code, timeout_sec?, sessionId?, runId?, task_type?, phase?, output_mode?, attempt? }
 */
// WP2: the native agent calls this back while its run holds the lease; a
// local runtime callback joins that run, anything else competes for it.
app.post("/api/sage/exec", asyncHandler(admissionGuards.childRoute("sage-exec", async (req, res) => {
  res.setHeader("X-DS4-Sage-Contract", "sage_result_v2");
  const {
    code,
    timeout_sec,
    sessionId,
    runId: requestedRunId,
    run_id,
    task_type,
    phase,
    output_mode,
    attempt,
    policyRevision: requestedPolicyRevision
  } = req.body || {};
  if (!code || typeof code !== "string" || !code.trim()) {
    return res.status(400).json({ error: "code is required" });
  }
  const runId = sanitizeSageRunId(requestedRunId || run_id || crypto.randomUUID());
  if (requestedPolicyRevision &&
      requestedPolicyRevision !== sageState.policyRevision) {
    return res.status(409).json({
      content: "SAGE_POLICY_REVISION_MISMATCH",
      isError: true,
      displayContent: "Sage policy revision mismatch.",
      contractVersion: "sage_result_v2",
      publishable: false,
      authoritative: false,
      validationPassed: false,
      reportReady: false,
      finalMarkdown: "",
      runId,
      state: "failed"
    });
  }

  // The run keeps one tracker for its whole life, whoever calls: the native
  // path and the agent loop must not each keep their own idea of the state.
  const registered = sageRunRegistry.getOrCreate({
    sessionId: sessionId || null,
    runId,
    taskType: task_type
  });
  if (!registered.ok) {
    return res.status(429).json({
      content: registered.code,
      isError: true,
      displayContent: "Too many active Sage runs.",
      contractVersion: "sage_result_v2",
      publishable: false,
      authoritative: false,
      validationPassed: false,
      reportReady: false,
      finalMarkdown: "",
      runId,
      state: "budget_exhausted"
    });
  }
  const { entry } = registered;
  const tracker = entry.tracker;
  const codeSha256 = sha256Hex(code);
  const snapshotBefore = tracker.snapshot();
  const decisionBefore = tracker.beforeCall({
    phase,
    candidateRevision: Number(req.body?.candidateRevision) || undefined,
    codeSha256
  });
  if (!decisionBefore.allowed) {
    emitSageTransition(snapshotBefore, tracker.snapshot(), decisionBefore.code);
    sageMetrics.recordOrchestration(
      decisionBefore.code === "SAGE_CANDIDATE_UNCHANGED"
        ? "sage_candidate_unchanged_rejected_total"
        : "sage_phase_rejected_total"
    );
    const decision = tracker.nextDecision();
    return res.status(409).json({
      content: decisionBefore.code,
      isError: true,
      displayContent: decisionBefore.nextAction ?? decision.nextAction,
      contractVersion: "sage_result_v2",
      publishable: false,
      authoritative: false,
      validationPassed: false,
      reportReady: false,
      finalMarkdown: "",
      runId,
      state: decision.state,
      orchestration: decision
    });
  }

  const args = {
    code,
    timeout_sec: Number(timeout_sec) || 60,
    task_type,
    phase,
    output_mode
  };
  const opts = {
    sageCallLog,
    toolBlobStore,
    sessionKey: sessionId || undefined,
    sageAttempt: Number(attempt) || 1,
    runId,
    phase,
    candidateRevision: tracker.snapshot().candidateRevision,
    attemptsRemaining: tracker.attemptsRemaining(),
    policyRevision: requestedPolicyRevision || sageState.policyRevision,
    sageWorkdir: sageRunDir(fileWorkspace.root, runId)
  };

  const result = await executeTool("sage", args, opts);
  const snapshotBeforeResult = tracker.snapshot();
  tracker.recordResult({ phase, result });
  emitSageTransition(snapshotBeforeResult, tracker.snapshot(), `PHASE_${phase ?? "auto"}`.toUpperCase());
  const decision = tracker.nextDecision();
  sageRunRegistry.update(entry, {
    candidate: phase === "compute" || phase === "repair" ? { codeSha256 } : undefined,
    validation: phase === "validate" ? result?.sageResult?.validation ?? null : undefined,
    finalResult: decision.publishable ? result : undefined
  });
  res.json({ ...result, orchestration: decision, state: decision.state });
})));

const SAGE_ARTIFACT_CONTENT_TYPES = Object.freeze({
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
  ".csv": "text/csv; charset=utf-8",
  ".json": "application/json; charset=utf-8"
});

app.get("/api/sage/artifacts/by-name/:fileName", asyncHandler(async (req, res) => {
  const fileName = String(req.params.fileName || "");
  if (!fileName || path.basename(fileName) !== fileName ||
      path.win32.basename(fileName) !== fileName) {
    return res.status(400).json({ error: "invalid artifact name" });
  }

  const contentType = SAGE_ARTIFACT_CONTENT_TYPES[path.extname(fileName).toLowerCase()];
  if (!contentType?.startsWith("image/")) {
    return res.status(400).json({ error: "unsupported image artifact type" });
  }

  const artifact = await findLatestSageImageArtifact(fileWorkspace.root, fileName);
  if (!artifact?.physicalPath) {
    return res.status(404).json({ error: "artifact not found" });
  }

  res.setHeader("Content-Type", contentType);
  res.setHeader("Cache-Control", "private, max-age=60");
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (path.extname(fileName).toLowerCase() === ".svg") {
    res.setHeader("Content-Security-Policy", "sandbox");
  }
  return res.sendFile(artifact.physicalPath);
}));

app.get("/api/sage/artifacts/:sessionId/:fileName", asyncHandler(async (req, res) => {
  const artifactId = String(req.params.fileName || "");
  if (/^sha256:[a-f0-9]{64}$/.test(artifactId)) {
    const artifact = await resolveSageArtifactById(
      fileWorkspace.root,
      String(req.params.sessionId || ""),
      artifactId
    );
    if (!artifact?.physicalPath) {
      return res.status(404).json({ error: "artifact not found" });
    }
    res.setHeader("Content-Type", artifact.mediaType);
    res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
    res.setHeader("X-Content-Type-Options", "nosniff");
    if (artifact.mediaType === "image/svg+xml") {
      res.setHeader("Content-Security-Policy", "sandbox");
    }
    return res.sendFile(artifact.physicalPath);
  }

  const sessionId = sanitizeSessionId(req.params.sessionId);
  const fileName = String(req.params.fileName || "");
  if (!fileName || path.basename(fileName) !== fileName ||
      path.win32.basename(fileName) !== fileName) {
    return res.status(400).json({ error: "invalid artifact name" });
  }

  const contentType = SAGE_ARTIFACT_CONTENT_TYPES[path.extname(fileName).toLowerCase()];
  if (!contentType) {
    return res.status(400).json({ error: "unsupported artifact type" });
  }

  const artifactDir = sageSessionDir(fileWorkspace.root, sessionId);
  let realDir;
  let realFile;
  let stats;
  try {
    realDir = await fs.realpath(artifactDir);
    realFile = await fs.realpath(path.join(realDir, fileName));
    const relative = path.relative(realDir, realFile);
    if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      return res.status(400).json({ error: "invalid artifact path" });
    }
    stats = await fs.stat(realFile);
  } catch {
    return res.status(404).json({ error: "artifact not found" });
  }

  if (!stats.isFile()) {
    return res.status(404).json({ error: "artifact not found" });
  }

  res.setHeader("Content-Type", contentType);
  res.setHeader("Cache-Control", "private, max-age=3600");
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (path.extname(fileName).toLowerCase() === ".svg") {
    res.setHeader("Content-Security-Policy", "sandbox");
  }
  return res.sendFile(realFile);
}));

/**
 * Execute PageAgent tools (page_snapshot, page_action) via HTTP.
 * Used by the C agent (ds4-wrapper) to delegate page agent execution.
 * Body: { name: "page_snapshot"|"page_action", arguments: {...}, sessionId? }
 */
app.post("/api/pageagent/tool", asyncHandler(async (req, res) => {
  const { name, arguments: args, sessionId } = req.body || {};
  if (!name || typeof name !== "string") {
    return res.status(400).json({ content: "Tool error: name is required", isError: true });
  }
  if (!args || typeof args !== "object") {
    return res.status(400).json({ content: "Tool error: arguments is required", isError: true });
  }

  const validTools = ["page_snapshot", "page_action", "page_task"];
  if (!validTools.includes(name)) {
    return res.status(400).json({ content: `Tool error: unknown page tool: ${name}`, isError: true });
  }

  const opts = { sessionId: sessionId || undefined };

  const result = await executeTool(name, args, opts);
  res.json(result);
}));

/**
 * Parse a natural-language PageAgent task into structured action/target/value.
 * Returns JSON without executing the action — the client executes it in the real browser.
 */
app.post("/api/pageagent/parse", asyncHandler(async (req, res) => {
  const { task } = req.body || {};
  if (!task || typeof task !== "string") {
    return res.status(400).json({ error: "task is required" });
  }
  const parsed = parseTask(task);
  if (!parsed) {
    return res.status(400).json({ error: "Could not parse task" });
  }
  res.json(parsed);
}));

/**
 * Client proxy for pageagent tools: the client polls for pending tool calls,
 * executes them on the real browser DOM, and posts the result back.
 */
app.get("/api/pageagent/pending", asyncHandler(async (req, res) => {
  markClientConnected();
  res.json({ tools: getPendingTools() });
}));

app.post("/api/pageagent/resolve", asyncHandler(async (req, res) => {
  const { id, result } = req.body || {};
  if (!id) return res.status(400).json({ error: "id is required" });
  const ok = resolvePageAgentTool(id, result || { content: "No result", isError: false });
  res.json({ ok });
}));

app.post("/api/pageagent/disconnect", asyncHandler(async (req, res) => {
  resetClientConnection();
  res.json({ ok: true });
}));

app.post("/api/pageagent/enable", asyncHandler(async (req, res) => {
  const { enabled } = req.body || {};
  setServerEnabled(Boolean(enabled));
  res.json({ ok: true, pageAgentEnabled: isServerEnabled() });
}));

// ---------------------------------------------------------------------------

/**
 * Agent chat endpoint with auto-loop tool execution.
 * Streams SSE events: agent_status, agent_text, agent_reasoning,
 * agent_tool_call, agent_tool_result, agent_usage, agent_done, agent_error.
 */
// Runs the epistemic evaluation under a deadline. The inner controller is
// chained to the caller's signal so a client disconnect still cuts it short,
// and resolves to null on timeout: the caller treats that as "no decision".
const EPISTEMIC_TIMEOUT_MS_DEFAULT = 45000;

// Cancel a shadow evaluation still running from an earlier round and wait for
// its backend call to close, so the slot is free for the agent's next request.
// One per process, not per session: every session shares the same backend, and
// a shadow left by another tab blocks this one just the same.
let pendingEpistemicShadow = null;
function trackEpistemicShadow(abort, evaluation) {
  pendingEpistemicShadow = { abort, settled: evaluation.then(() => {}, () => {}) };
}
async function yieldEpistemicShadow() {
  const pending = pendingEpistemicShadow;
  if (!pending) return;
  pendingEpistemicShadow = null;
  pending.abort?.abort();
  await pending.settled;
}

async function evaluateEpistemicTurnBounded({
  turn,
  options,
  signal,
  timeoutMs = EPISTEMIC_TIMEOUT_MS_DEFAULT,
  onTimeout
}) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return evaluateEpistemicTurn(turn, { ...options, signal });
  }

  const inner = new AbortController();
  const abortInner = () => inner.abort();
  signal?.addEventListener("abort", abortInner, { once: true });

  let timer = null;
  let timedOut = false;
  try {
    const decision = await Promise.race([
      evaluateEpistemicTurn(turn, { ...options, signal: inner.signal }),
      new Promise((resolve) => {
        timer = setTimeout(() => {
          timedOut = true;
          inner.abort();
          resolve(null);
        }, timeoutMs);
      })
    ]);
    if (timedOut) onTimeout?.(timeoutMs);
    return timedOut ? null : decision;
  } catch (err) {
    // An abort we caused is the timeout, not a failure to report upwards.
    if (timedOut) {
      onTimeout?.(timeoutMs);
      return null;
    }
    throw err;
  } finally {
    if (timer) clearTimeout(timer);
    signal?.removeEventListener("abort", abortInner);
  }
}

// WP1 of piano.esecutivo.integrazione.opendots.v2.md (§5): POST
// /api/agent/chat is a transport over AgentRunService (agent/runService.mjs,
// agent/legacyChatSse.mjs).  The two turn functions below are the former
// route body with the HTTP parts lifted out: input fields instead of req,
// emit() instead of res.write, an outcome instead of res.status/json and
// writeAgentCommandSse.  Loop, gates, buffers and sessions are unchanged.
//
// Native engine: forwarding to the wrapper's C agent.  The upstream SSE
// bytes pass through untouched ("native_chunk").
async function runNativeAgentTurn({ body, sessionKey, requestSignal }, emit, signal) {
  const { message } = body;
  if (typeof message !== "string" || !message.trim()) {
    return { kind: AGENT_RUN_OUTCOME.REJECTED, status: 400, body: { error: "message is required and must be a non-empty string" } };
  }

  const ponyCommand = ponyCommandFromText(message);
  if (ponyCommand) {
    return { kind: AGENT_RUN_OUTCOME.COMMAND, events: ponyCommandEventsForSession(sessionKey, ponyCommand) };
  }

  if (isAgentSlashCommand(message)) {
    const result = await proxyNativeAgentCommand(
      fetch,
      backendBase(),
      message.trim(),
      requestSignal
    );
    syncSageStateFromNativeCommand(message.trim(), result.payload);
    if (result.payload.active === false) {
      agentSessions.stop(sessionKey);
    }
    return { kind: AGENT_RUN_OUTCOME.COMMAND, events: nativeCommandEvents(result.payload, result.ok), ok: result.ok };
  }

  // Require an active agent session before forwarding to native-agent
  const nativeSessionKey = sessionKey;
  const nativeAgentSession = agentSessions.get(nativeSessionKey);
  if (!nativeAgentSession || !nativeAgentSession.active) {
    return { kind: AGENT_RUN_OUTCOME.REJECTED, status: 400, body: { error: "Agent mode is not active. Use /agent start first." } };
  }

  const ponyPolicy = buildPonyPolicy(nativeAgentSession.ponyMode);
  const gitnexusPolicy = buildGitnexusPolicy(nativeAgentSession.gitnexusEnabled);
  const combinedPolicy = [ponyPolicy, gitnexusPolicy].filter(Boolean).join("\n\n");
  const outboundMessage = combinedPolicy
    ? `${combinedPolicy}\n\nUser request:\n${message}`
    : message;

  // Forward request params (max_tokens, temperature, etc.) to the native agent
  const outboundBody = {
    message: outboundMessage,
    request: body?.request || {}
  };

  // The transport arms its client-disconnect wiring here (the legacy route
  // uses abortOnClientDisconnect); `signal` carries it from now on.
  emit("native_forward");
  const nativeSignal = signal;

  const up = await fetch(`${backendBase()}/api/native-agent/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(outboundBody),
    signal: nativeSignal
  });

  if (!up.ok) {
    const errorBody = await up.text();
    return { kind: AGENT_RUN_OUTCOME.REJECTED, status: up.status, body: { error: `Wrapper error: ${errorBody}` } };
  }

  // D-017 — Concurrent timeout for the native agent stream.
  // The previous guard checked Date.now() only inside the for-await loop,
  // so a silent upstream (zero bytes after the first chunk) could hang the
  // proxy indefinitely.  A concurrent AbortController + setTimeout wakes
  // the loop even when zero new bytes arrive.
  const nativeStartedAt = Date.now();
  const nativeMaxMs = config.agent?.nativeChatTimeoutMs;
  const nativeMaxMsFinal = (nativeMaxMs === undefined || nativeMaxMs === null || nativeMaxMs === 0)
      ? Infinity : nativeMaxMs;

  let nativeTimedOut = false;
  const nativeTimeoutController = new AbortController();
  let nativeTimeoutHandle = null;
  if (Number.isFinite(nativeMaxMsFinal)) {
    nativeTimeoutHandle = setTimeout(() => {
      nativeTimedOut = true;
      nativeTimeoutController.abort(new Error("Native agent stream timeout"));
    }, nativeMaxMsFinal);
    nativeTimeoutHandle.unref?.();
  }

  // Combine client disconnect + native timeout into one signal for the
  // upstream fetch body.  If either fires, the for-await loop throws.
  const combinedController = new AbortController();
  const combinedSignal = combinedController.signal;
  const onClientAbort = () => { if (!combinedSignal.aborted) combinedController.abort(); };
  const onNativeTimeout = () => { if (!combinedSignal.aborted) combinedController.abort(); };
  nativeSignal.addEventListener("abort", onClientAbort, { once: true });
  nativeTimeoutController.signal.addEventListener("abort", onNativeTimeout, { once: true });

  emit("native_response", { status: up.status, headers: up.headers });
  try {
    if (up.body) {
      // Use the combined signal so the stream unblocks on client disconnect
      // OR native timeout, whichever comes first.
      for await (const chunk of up.body) {
        emit("native_chunk", chunk);
      }
    }
  } catch (err) {
    if (nativeTimedOut) {
      emit("agent_error", { error: "Native agent stream timeout" });
    }
    // Client disconnect / upstream close / res.write failure — all non-fatal
    // for a proxied SSE stream.  Silently close what we can.
  } finally {
    clearTimeout(nativeTimeoutHandle);
    nativeSignal.removeEventListener("abort", onClientAbort);
    nativeTimeoutController.signal.removeEventListener("abort", onNativeTimeout);
  }
  return { kind: AGENT_RUN_OUTCOME.NATIVE_STREAMED };
}

// JS engine: the DS4 JS loop (wrapper disabled or in server mode).
async function runJsAgentTurn({ body, sessionKey, debug, requestSignal }, emit, signal) {
  // Existing JS agent loop logic (wrapper disabled)
  const agentSession = agentSessions.get(sessionKey);
  if (!agentSession || !agentSession.active) {
    return { kind: AGENT_RUN_OUTCOME.REJECTED, status: 400, body: { error: "Agent mode is not active. Use /agent start first." } };
  }

  const userMessage = body?.message;
  const conversationMessages = Array.isArray(body?.messages) ? body.messages : [];
  const reqParams = body?.request || {};
  const dot = body?.dot ?? null;

  const ponyCommand = ponyCommandFromText(userMessage);
  if (ponyCommand) {
    if (dot) {
      return { kind: AGENT_RUN_OUTCOME.REJECTED, status: 409, body: { error: "Dot-scoped threads use their frozen skill and tool policy", code: "DOT_POLICY_FROZEN" } };
    }
    return { kind: AGENT_RUN_OUTCOME.COMMAND, events: ponyCommandEventsForSession(sessionKey, ponyCommand) };
  }

  const contextConfig = runtimeConfig.contextWiki;
  const agentModelId = buildChatPayload(reqParams, []).model;

  // WP8 of convergenza.loop.md: /compact forces compaction with the C's
  // "user request" reason.  It lives in the route (not in the pure slash
  // handler) because only the route can call the model.
  // WP10: the skill/evidence state resolves here because runCompaction
  // re-anchors the ledger like the C (shadow ds4_agent.c:19495-19501) and the
  // /compact intercept calls it before the prompt is built. Pure reads, order
  // is behavior-neutral (same move WP8 did for contextConfig/agentModelId).
  const skillState = agentSkillStateFor(sessionKey);
  const runAllowedTools = allowedToolsForDot(
    agentSession.toolScope ? Array.from(agentSession.toolScope) : null,
    dot
  );
  const runSkillState = dot ? { promptSkills: () => ({}) } : skillState;
  const dotTools = (tools) => toolsForDot(tools, dot);
  const skillsForDot = () => {
    if (!dot) return skillState ? skillState.promptSkills() : null;
    const current = skillState ? skillState.promptSkills() : {};
    const dynamic = dot.skills.map((name) => {
      if (!skillState) throw Object.assign(new Error(`Dot skill unavailable: ${name}`), { code: "DOT_SKILL_UNAVAILABLE" });
      const entry = stageSkill(skillState.skillsDir, name);
      const content = entry.content.toString("utf8");
      return `[BEGIN DS4 ACTIVE SKILL name=${entry.name} revision=${entry.revision}]\n${content}${content.endsWith("\n") ? "" : "\n"}[END DS4 ACTIVE SKILL name=${entry.name}]`;
    }).join("\n\n");
    return { ...current, dynamic: dynamic || null, evidenceLoaded: false, sage: null, lean: null };
  };
  let runSkills;
  try { runSkills = skillsForDot(); }
  catch (error) {
    if (!dot) throw error;
    return { kind: AGENT_RUN_OUTCOME.REJECTED, status: 409, body: { error: `Dot skill is unavailable: ${error.message}`, code: "DOT_SKILL_UNAVAILABLE" } };
  }
  // Evidence-First is active only while the skill is loaded (C
  // agent_worker_evidence_mode, shadow ds4_agent.c:7710-7717: off whatever
  // DS4_EVIDENCE_MODE says without the skill; an invalid value already failed
  // at boot). The ledger itself lives on agentSession and survives turns.
  const evidenceActive = !dot && Boolean(skillState?.promptSkills?.().evidenceLoaded);
  const evidenceMode = evidenceActive ? EVIDENCE_MODE_BOOT.mode : EVIDENCE_MODE_ENUM.OFF;
  // Turn-scoped state resets each user turn (C ds4_agent_evidence_turn_reset);
  // the ledger itself is session-scoped and survives.
  agentSession.evidenceTurn = createEvidenceTurn();
  const runCompaction = async (messages, reason, pre = {}) => {
    await yieldEpistemicShadow();
    const base = backendBase();
    const ctxInfo = pre.ctxInfo ?? await contextWindow({
      fetchImpl: fetch, base, config, localWrapper: wrapperEnabled()
    });
    const usedInfo = pre.usedInfo ?? await countPromptTokens({ messages }, {
      fetchImpl: fetch, base, signal: requestSignal
    });
    const next = await compactConversation({
      messages,
      reason,
      ctx: ctxInfo.tokens,
      policy: AGENT_LOOP_POLICY,
      // C 19495-19501: the contract and the ledger digest ride right after the
      // summary (the WP8 module places evidence between summary and tail).
      evidence: evidenceActive
        ? { text: evidenceCoreContract() + evidenceDigest(agentSession.evidenceState) }
        : null,
      // selectTail estimates one message at a time.
      estimate: (message) => estimateMessagesTokens([message]),
      // Every summary request must fit the backend: the transcript rebuilt
      // from the UI history after a restart reached 478879 tokens on a
      // 262144 context.  Room for the thinking reserve and the tool schemas
      // (sent below), and 25% slack because the estimate is chars/3.5.
      maxInputTokens: Math.floor(0.75 * (
        ctxInfo.tokens
        - (requestThinkingEnabled(reqParams) ? 8192 : 0)
        - estimateMessagesTokens([{ role: "system", content: JSON.stringify(
          dotTools(modelFacingTools({ includeSage: !dot && sagePolicyIsActive(), ...(await leanToolFlags(runSkillState)) }))
        ) }])
      )),
      callModel: async (summaryMessages, options) => {
        // Same request shape as the agent round (sampling, think flag, tool
        // schemas): the rendered prefix then matches the backend's cached
        // slot and only the compact prompt is prefilled.  Without the tools
        // the template changes the system block and a ~240k transcript was
        // prefilled from zero.  tool_choice "none" keeps it a plain answer.
        // (withContextTool is declared later in the route; same expression.)
        const baseTools = dotTools(modelFacingTools({ includeSage: !dot && sagePolicyIsActive(), ...(await leanToolFlags(runSkillState)) }));
        const payload = buildChatPayload({ ...reqParams, stream: false }, summaryMessages);
        payload.tools = dotTools(contextConfig.enabled ? [...baseTools, CONTEXT_SEARCH_TOOL] : baseTools);
        payload.tool_choice = "none";
        // The summary budget is for the answer; with thinking on (kept, since
        // reasoning_effort is part of the cached system block) the reasoning
        // would otherwise eat it and leave an empty summary.
        payload.max_tokens = options.max_tokens + (requestThinkingEnabled(reqParams) ? 8192 : 0);
        // node:http, not fetch: a cold prefill of the whole transcript runs
        // past undici's 300 s headersTimeout and the call died "fetch failed".
        const { status, body } = await postJsonNoTimeout(
          `${base}/v1/chat/completions`, payload, requestSignal
        );
        if (status < 200 || status >= 300) {
          throw new Error(`summary model HTTP ${status}: ${String(body).slice(0, 300)}`);
        }
        const parsed = JSON.parse(body);
        return parsed?.choices?.[0]?.message?.content ?? "";
      }
    });
    if (evidenceActive) {
      // C agent_worker_append_evidence_reanchor (shadow 7762-7774) counts
      // every contract re-injection, compaction included.
      agentSession.evidenceState.metrics.reinjectionsTotal++;
    }
    return { next, used: usedInfo.tokens, ctx: ctxInfo.tokens };
  };

  if (/^\/compact(\s|$)/.test(String(userMessage ?? "").trim())) {
    const transcript = agentSession.messages();
    if (!transcript.length) {
      return { kind: AGENT_RUN_OUTCOME.COMMAND, ok: true, events: nativeCommandEvents({ ok: true, message: "Nothing to compact yet.", active: true }, true) };
    }
    let compactEvents;
    try {
      const { next, used, ctx } = await runCompaction(transcript, "user request");
      agentSession.replaceMessages(next, "compaction: user request");
      compactEvents = { ok: true, events: nativeCommandEvents({
        ok: true,
        message: `Compaction complete: ${transcript.length} messages -> ${next.length} (used ~${used}/${ctx}).`,
        active: true
      }, true) };
    } catch (error) {
      if (/nothing to summarize/.test(error.message)) {
        return { kind: AGENT_RUN_OUTCOME.COMMAND, ok: true, events: nativeCommandEvents({ ok: true, message: "Nothing to compact yet.", active: true }, true) };
      }
      compactEvents = { ok: false, events: nativeCommandEvents({
        ok: false,
        message: `COMPACTION_FAILED: ${error.message}`,
        active: true
      }, false) };
    }
    return { kind: AGENT_RUN_OUTCOME.COMMAND, ...compactEvents };
  }

  // WP9 of convergenza.loop.md: /save, /list, /switch and /new on the JS
  // session store (JS-only format; the C KV files are never touched).  Like
  // /compact they are intercepted by the route because they need the session
  // and the disk; the pure slash handler keeps answering NOT_IMPLEMENTED_YET
  // for direct callers.
  const sessionCmd = /^\/(save|list|switch|new)(?:\s+(\S+))?$/.exec(
    String(userMessage ?? "").trim()
  );
  if (sessionCmd) {
    const [, command, arg] = sessionCmd;
    try {
      let payload;
      if (command === "save") {
        const transcript = agentSession.messages();
        if (!transcript.length) {
          const err = new Error("the session is empty");
          err.code = "NOTHING_TO_SAVE";
          throw err;
        }
        if (!agentSession.saveIdentity) {
          const firstUser = transcript.find((m) => m.role === "user");
          const title = String(firstUser?.content ?? "session").replace(/\s+/g, " ").trim().slice(0, 100) || "session";
          agentSession.saveIdentity = { title, createdAt: Date.now() };
        }
        const skillState = agentSkillStateFor(sessionKey);
        const skillRevisions = {};
        const skillsDoc = { registry: { version: 1, aggregateRevision: "", skills: [] }, defaults: false, sage: false, lean: false };
        if (skillState) {
          if (skillState.registry) {
            skillsDoc.registry = skillState.registry.toJSON();
            for (const s of skillState.registry.list()) skillRevisions[s.name] = s.revision;
          }
          for (const [name, entry] of skillState.entries) skillRevisions[name] = entry.revision;
          skillsDoc.defaults = ["soul", "ethic", "structure"].some((n) => skillState.entries.has(n));
          skillsDoc.sage = skillState.entries.has("sage");
          skillsDoc.lean = skillState.entries.has("lean");
        }
        const saved = saveSession({
          dir: AGENT_SESSIONS_DIR,
          title: agentSession.saveIdentity.title,
          createdAt: agentSession.saveIdentity.createdAt,
          messages: transcript,
          skills: skillsDoc,
          skillRevisions,
          // WP10: the ledger travels in the C's own text format
          // (DS4_EVIDENCE_STATE_V1). A ledger never enabled saves as null —
          // no empty record to restore.
          evidence: agentSession.evidenceState.enabled
            ? evidenceSerialize(agentSession.evidenceState)
            : null
        });
        payload = { ok: true, message: `Saved session ${saved.sha.slice(0, 8)} (${saved.tokens} tokens).`, active: true };
      } else if (command === "list") {
        const sessions = listSessions({ dir: AGENT_SESSIONS_DIR });
        const lines = sessions.map((s) => `${s.short}  ${s.tokens} tok  ${new Date(s.savedAt).toISOString()}  ${s.title}`);
        payload = {
          ok: true,
          message: sessions.length ? `Saved sessions.\n\n${lines.join("\n")}` : "No saved sessions.",
          data: { sessions },
          active: true
        };
      } else if (command === "switch") {
        if (!arg) {
          const err = new Error("usage: /switch <sha-prefix>");
          err.code = "SESSION_NOT_FOUND";
          throw err;
        }
        const doc = loadSession({ dir: AGENT_SESSIONS_DIR, prefix: arg });
        // Fresh skill state first (defaults re-staged like a new session),
        // then the manifest rule on top; a refusal leaves the current
        // session untouched because replaceMessages runs last.
        agentSkillStates.delete(sessionKey);
        const skillState = agentSkillStateFor(sessionKey);
        const restore = restoreSessionSkills({ skillState, doc, skillsDir: skillState?.skillsDir });
        agentSession.replaceMessages(doc.messages, `switch ${doc.sha.slice(0, 8)}`);
        agentSession.saveIdentity = { title: doc.title || "session", createdAt: doc.createdAt };
        // WP12 (C ds4_agent.c:9981): a restored transcript already carries the
        // once-per-session datetime context, so re-injection is voided here —
        // /new keeps it enabled because reset() rebuilds the guard state.
        agentSession.loopGuardState.datetimeInjected = true;
        // WP10: the ledger travels with the session. C fails closed on
        // restore — the finalize token is never restored and the runtime says
        // so (shadow ds4_agent.c:23648-23656; evidenceDeserialize clears the
        // flags by construction).
        let evidenceNote = "";
        agentSession.evidenceState = createEvidenceState();
        agentSession.evidenceTurn = createEvidenceTurn();
        if (doc.evidence) {
          const back = createEvidenceState();
          const restoredLedger = evidenceDeserialize(String(doc.evidence), back);
          evidenceNote = restoredLedger.ok
            ? "\n\nRuntime evidence ledger restored from the saved session. Any earlier finalize is void: call evidence_guard finalize again before the final verdict."
            : "\n\nRuntime evidence ledger was not restored as authoritative state. Re-register active findings before final verdict.";
          if (restoredLedger.ok) agentSession.evidenceState = back;
        }
        const warn = restore.warnings.length ? `\n\nWarnings:\n${restore.warnings.join("\n")}` : "";
        payload = { ok: true, message: `Switched to session ${doc.sha.slice(0, 8)}.${warn}${evidenceNote}`, active: true };
      } else {
        // /new: empty session, default skills re-staged lazily next turn,
        // evidence reset (WP10 clears the ledger here too).
        agentSession.reset("new session");
        delete agentSession.saveIdentity;
        agentSkillStates.delete(sessionKey); // WP4/WP5 note: release the cached state
        payload = { ok: true, message: "New session started.", active: true };
      }
      return { kind: AGENT_RUN_OUTCOME.COMMAND, ok: payload.ok !== false, events: nativeCommandEvents(payload, payload.ok !== false) };
    } catch (error) {
      return { kind: AGENT_RUN_OUTCOME.COMMAND, ok: false, events: nativeCommandEvents({
        ok: false,
        message: `${error?.code ? `${error.code}: ` : ""}${error?.message || "session command failed"}`,
        active: true
      }, false) };
    }
  }

  // WP5 of convergenza.loop.md: in the JS loop the /... commands are answered
  // by Node with the C runtime's contract (agentSlashCommands.mjs) and never
  // reach the model.  Events reuse nativeCommandEvents so the UI sees the
  // same SSE shape as the native agent.
  if (isAgentSlashCommand(userMessage)) {
    if (dot) {
      return { kind: AGENT_RUN_OUTCOME.REJECTED, status: 409, body: { error: "Dot-scoped threads use their frozen skill and tool policy", code: "DOT_POLICY_FROZEN" } };
    }
    const commandResult = handleAgentSlashCommand({
      message: userMessage,
      session: agentSession,
      skillState: agentSkillStateFor(sessionKey),
      env: process.env
    });
    syncSageStateFromNativeCommand(String(userMessage).trim(), commandResult.payload);
    return { kind: AGENT_RUN_OUTCOME.COMMAND, ok: commandResult.ok, events: nativeCommandEvents(commandResult.payload, commandResult.ok) };
  }

  if (!userMessage && !conversationMessages.length) {
    return { kind: AGENT_RUN_OUTCOME.REJECTED, status: 400, body: { error: "message or messages array required" } };
  }

  // ContextWiki (§8/§9/§13): read config once per turn. When disabled (default),
  // the context memory rules are omitted so the base system prompt is unchanged.
  // (WP8: these two moved above the slash intercept, where runCompaction
  // needs the model id; both are pure reads, order is behavior-neutral.)
  let fullMessages = agentSession.messages();
  const buildAgentSystemMessage = () => {
    const caps = isServerEnabled()
      ? { ...agentCapabilities, pageAgent: true }
      : agentCapabilities;
    const prompt = buildAgentSystemText({
      jsSections: [
        AGENT_SYSTEM_PROMPT,
        capabilitiesPromptSection(caps),
        autonomyPromptSection(),
        agentCoreRulesSection(),
        agentEpistemicRulesSection(),
        agentRuntimeIdentitySection(agentModelId),
        contextConfig.enabled ? agentContextMemorySection() : null
      ],
      // WP4 of convergenza.loop.md: the skill blocks ride after the Node
      // sections, in the order agent_worker_build_system_text_ex uses.  With no
      // skill staged the text is byte-identical to the pre-WP4 prompt.
      skills: runSkills
    });
    const scopedPrompt = dotContextText(dot);
    return { role: "system", content: appendPonyPolicy(scopedPrompt ? `${prompt}\n\n${scopedPrompt}` : prompt, agentSession.ponyMode) };
  };
  if (agentSession.promptDirty) {
    // A durable checkpoint preserves the conversation transcript, not stale
    // skill/system instructions from the previous process version.
    fullMessages = [buildAgentSystemMessage(), ...fullMessages.filter((message) => message?.role !== "system")];
    agentSession.promptDirty = false;
  }
  if (!fullMessages.length) {
    fullMessages = [buildAgentSystemMessage(), ...normalizeAgentMessages(conversationMessages)];
  } else if (skillState?.syspromptDirty) {
    // WP5: /skill ... start|stop changed the skill set (rt->sysprompt_dirty
    // in the C loop): rebuild the first message before the next model call.
    if (fullMessages[0]?.role === "system") fullMessages[0] = buildAgentSystemMessage();
    else fullMessages = [buildAgentSystemMessage(), ...fullMessages];
    skillState.syspromptDirty = false;
  }
  if (dot) {
    const systemMessage = buildAgentSystemMessage();
    if (fullMessages[0]?.role === "system") fullMessages[0] = systemMessage;
    else fullMessages = [systemMessage, ...fullMessages.filter((message) => message?.role !== "system")];
  }
  if (userMessage) fullMessages.push({ role: "user", content: String(userMessage) });
  fullMessages = applySagePolicyToMessages(fullMessages);
  // WP12: date/time context once per session, first message after the system
  // prompt (C agent_worker_maybe_append_datetime_context, shadow
  // ds4_agent.c:3352-3370).  Deviation: the C role "system" rides instead as
  // role "user" with the "[DS4 Studio]" prefix (WP7 policy).  The injection
  // joins the request diff, so the commit persists it like any guidance
  // message; the flag keeps it once per session, as in C.
  if (agentSession.loopGuardState && !agentSession.loopGuardState.datetimeInjected) {
    agentSession.loopGuardState.datetimeInjected = true;
    fullMessages.splice(1, 0, {
      role: "user",
      content: `[DS4 Studio] ${datetimeContextMessage()}`
    });
  }

  // ContextWiki (§8/§9): build a delta-safe context capsule and, when enabled,
  // inject it as an append-only user message. Default is preview-only (telemetry
  // + ledger only), leaving the transcript and payload identical to baseline.
  // Advertise context_search only when ContextWiki is enabled (request-time, so
  // it honors config/env resolved at startup). Same expression is used for the
  // real payload below so the tools hash — and the delta path — stay consistent.
  const withContextTool = (base) => dotTools(contextConfig.enabled ? [...base, CONTEXT_SEARCH_TOOL] : base);
  // Resolve the Lean advertising flags once per request so the context-tools
  // hash and the real payload hash below cannot drift apart.
  const leanFlags = await leanToolFlags(runSkillState);
  const contextTools = withContextTool(
    dotTools(modelFacingTools({ includeSage: !dot && sagePolicyIsActive(), evidenceEnabled: evidenceActive, ...leanFlags }))
  );
  const contextInjection = await prepareContextInjection({
    sessionKey,
    session: agentSession,
    fullMessages,
    tools: contextTools,
    userMessage,
    config: contextConfig
  }).catch(() => null);
  if (contextInjection?.capsuleMessage) fullMessages.push(contextInjection.capsuleMessage);

  const turnEvidence = [];
  // QF-03 §25.6 — structured provenance alongside the legacy text blob, which
  // stays until the claim guard stops reading it. Collected in parallel, not
  // instead.
  const epistemicTurn = createEpistemicTurn({
    sessionKey,
    // §36 writes agentSession.revision; this class keeps it on state, and an
    // undefined revision would make every turn's audit record indistinguishable.
    revision: agentSession.state?.revision ?? 0,
    config: runtimeConfig.agent.epistemic,
    userText: String(userMessage ?? "")
  });
  const epistemicClient = epistemicTurn.enabled ? createEpistemicStructuredClient(reqParams) : null;
  const epistemicSourceContext = new EpistemicSourceContext();
  const epistemicCitationProviders = currentEpistemicCitationProviders();
  const epistemicSageExecutor = async (request, { signal } = {}) =>
    executeTool("sage", request, {
      signal,
      sessionKey,
      policyRevision: sageState.policyRevision,
      sageCallLog,
      toolBlobStore,
      sageWorkdir: sageSessionDir(fileWorkspace.root, sessionKey)
    });
  const persistEpistemicClaims = runtimeConfig.agent.epistemic.persistSessionClaims === true;
  const epistemicShadowMode = epistemicTurn.enabled && runtimeConfig.agent.epistemic.mode === "shadow";
  // On a single-slot backend (ds4-wrapper, llama-server -np 1) the advisory
  // shadow segmenter takes the only slot after every final answer: it evicts
  // the agent's cached prompt and holds the backend for up to 45 s.  Skip it
  // there; block mode still evaluates inline, before the next round.
  const epistemicShadowSkipped = epistemicShadowMode && await backendSingleSlot({
    fetchImpl: fetch, base: backendBase(), localWrapper: wrapperEnabled(), signal: requestSignal
  });
  const priorEpistemicClaims = persistEpistemicClaims
    ? agentSession.epistemic.acceptedClaims()
    : [];
  const epistemicSessionTurn = persistEpistemicClaims
    ? agentSession.epistemic.beginTurn()
    : null;
  const epistemicEvaluationLedger = epistemicShadowMode && persistEpistemicClaims
    ? EpistemicSessionLedger.fromJSON(agentSession.epistemic.toJSON())
    : agentSession.epistemic;
  for (const prior of priorEpistemicClaims) {
    try {
      epistemicTurn.ledger.importSnapshotClaim(prior);
    } catch {
      // Invalid legacy session snapshots are not forced into the live ledger.
    }
  }
  const epistemicChallengeExtraction = await extractChallenges({
    userText: epistemicTurn.userText,
    priorClaims: priorEpistemicClaims,
    client: epistemicClient
  });
  applyChallenges(epistemicTurn.ledger, epistemicChallengeExtraction);
  epistemicTurn.noteChallenges(epistemicChallengeExtraction.challenges);
  const policyState = { gitnexusAnalyzeSeen: false };

  const agentTokenBudget = maxAgentTotalTokens(process.env);
  const initialBudgetStatus = agentBudgetStatus(fullMessages, agentSession.usageTotals, agentTokenBudget);
  if (initialBudgetStatus.exceeded) {
    return {
      kind: AGENT_RUN_OUTCOME.REJECTED,
      status: 400,
      body: {
        error: formatAgentBudgetError(initialBudgetStatus),
        ...initialBudgetStatus
      }
    };
  }

  // The turn is accepted: the transport opens its stream here (legacy: SSE
  // head, keepalive comment, client-abort wiring; agent/legacyChatSse.mjs).
  emit("run_started", { engine: "js" });

  // `controller` is the turn's own abort: the transport's signal (client
  // gone, Stop) feeds it, and the loop guards abort it themselves.
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal.aborted) abort();
  else signal.addEventListener("abort", abort, { once: true });

  function writeAgentSse(event, data) {
    emit(event, data);
  }

  // Opt-in per request (/debug start in the composer sets the header), so a
  // normal run pays nothing and no server-wide flag can be left switched on.
  const agentDebug = debug;
  const epistemicTimeoutMs = Number(
    runtimeConfig.agent?.epistemic?.timeoutMs ?? EPISTEMIC_TIMEOUT_MS_DEFAULT
  );
  function writeAgentDebug(stage, data) {
    if (!agentDebug) return;
    writeAgentSse("agent_debug", { stage, ...data });
  }

const compactSageChat = process.env.DS4_SAGE_COMPACT_CHAT !== "0" &&
    process.env.DS4_SAGE_STRUCTURED_RESULT !== "0";
const authoritativeSageChat = compactSageChat &&
    envBooleanWithAliases({
      env: process.env,
      key: "DS4_SAGE_AUTONOMOUS_ORCHESTRATION",
      defaultValue: true,
    });
  // §15.1: one tracker per run, owned by the registry. The native path
  // (POST /api/sage/exec) and this loop must not each keep their own idea of
  // the same run's state — that divergence is what the whole plan removes.
  // The placeholder below only exists until the first sage call registers the
  // run; nothing reads it before then, because every reader gates on runId.
  let sageEntry = null;
  let sageTracker = new SageTurnTracker(runtimeConfig.sage.orchestration);
  let sageFinalStatusEmitted = false;
  let authoritativeSageFinal = null;
  let sageAuthoritativePublished = false;
  let forceResetNextIteration = false;

  // Lean proof orchestration for this turn. Same contract as the native path:
  // a repairable failure is not an ending, and only status=checked releases a
  // verified claim.
  const leanTracker = new LeanTurnTracker(runtimeConfig.lean.orchestration);
  // §11/§58 — the sealed reading of what this turn is trying to prove. It is
  // built before the first candidate runs and never rebuilt.
  let leanTaskSpec = null;
  let leanFinalStatusEmitted = false;

  const writeLeanStatus = (data) => {
    const snapshot = leanTracker.snapshot();
    if (!snapshot.proofId) return;
    writeAgentSse("agent_lean_status", {
      proofId: snapshot.proofId,
      state: snapshot.state,
      attempt: snapshot.attempt,
      maxAttempts: snapshot.maxAttempts,
      failureClass: snapshot.failureClass,
      strategyChangeRequired: snapshot.strategyChangeRequired,
      verified: snapshot.verified,
      terminalReason: snapshot.terminalReason,
      ...data
    });
  };

  const finalizeLeanStatus = (summary) => {
    if (leanFinalStatusEmitted || !leanTracker.snapshot().proofId) return;
    leanFinalStatusEmitted = true;
    writeLeanStatus({ status: leanTracker.snapshot().verified ? "verified" : "not_verified", summary });
  };

  const sagePhaseState = (phase) => ({
    prepare: "preparing",
    compute: "computing",
    validate: "validating",
    plot: "plotting",
    repair: "repairing"
  })[normalizeSagePhase(phase)];

  const writeSageStatus = (data) => {
    const snapshot = sageTracker.snapshot();
    if (!compactSageChat || !snapshot.runId) return;
    // §17.1: the card shows the orchestration decision itself. Sourcing it here
    // rather than at each call site is what keeps every event consistent with
    // the tracker instead of with whatever the local branch happened to know.
    writeAgentSse("agent_sage_status", {
      runId: snapshot.runId,
      taskType: snapshot.taskType,
      candidateRevision: snapshot.candidateRevision,
      validatedRevision: snapshot.validatedRevision,
      computeCount: snapshot.computeCount,
      repairCount: snapshot.repairCount,
      validationCount: snapshot.validationCount,
      plotCount: snapshot.plotCount,
      requiredNextPhase: snapshot.requiredNextPhase,
      failureClass: snapshot.failureClass,
      strategyChangeRequired: snapshot.strategyChangeRequired,
      missingArtifactKinds: sageTracker.nextDecision().missingArtifactKinds,
      ...data
    });
  };

  const finalizeSageStatus = (status, summary, code) => {
    if (sageFinalStatusEmitted || !sageTracker.snapshot().runId) return;
    sageFinalStatusEmitted = true;
    const snapshot = sageTracker.snapshot();
    writeSageStatus({
      state: status === "completed" ? "completed" : "failed",
      status,
      summary,
      code,
      attempt: snapshot.attempt,
      executeCount: snapshot.executeCount,
      repairCount: snapshot.repairCount,
      validationCount: snapshot.validationCount,
      plotCount: snapshot.plotCount,
      artifactCount: snapshot.artifactCount
    });
  };

  try {
    // Deterministic tool planner: when the user explicitly asks to crawl/open
    // links, run the crawls ourselves and feed the results into the transcript
    // instead of leaving it to the model (which used to tell the user to run
    // /crawl). No-op when no crawl intent is detected. Capped to avoid runaway.
    const MAX_PLANNED_CRAWLS = 10; // ponytail: cap; raise if real tasks need more
    const MAX_FOLLOWUP_CRAWLS = 5; // §16.3: crawl only a few of a hub's links
    const plannedCrawls = planTools({
      userText: userMessage,
      taskState: createTaskState(fullMessages),
      capabilities: agentCapabilities
    }).filter((a) => a.tool === "crawl" && a.args?.url).slice(0, MAX_PLANNED_CRAWLS);
    if (plannedCrawls.length) {
      const crawlBaseUrl = crawlBase();
      const crawlToken = await readCrawlToken();
      let round = 0;
      // Run a batch of crawls as one synthetic tool turn; return their manifests.
      const crawlRound = async (urls) => {
        round += 1;
        const calls = urls.map((url, i) => ({ id: `plan_crawl_${Date.now()}_r${round}_${i}`, url }));
        fullMessages.push({
          role: "assistant",
          content: null,
          tool_calls: calls.map((c) => ({
            id: c.id,
            type: "function",
            function: { name: "crawl", arguments: JSON.stringify({ url: c.url }) }
          }))
        });
        const manifests = [];
        for (const c of calls) {
          if (controller.signal.aborted) break;
          writeAgentSse("agent_tool_call", { id: c.id, name: "crawl", arguments: { url: c.url } });
          const rawResult = await executeTool("crawl", { url: c.url }, { signal: controller.signal, crawlBaseUrl, crawlToken });
          const result = rawResult?.isError
            ? rawResult
            : await compressAgentToolResult("crawl", rawResult);
          if (result.compressed) {
            agentSession.loopGuard.recordCompressedObservation();
            writeAgentDebug("compressed", {
              tool: "crawl",
              blobId: result.compression?.blobId,
              originalBytes: result.compression?.originalBytes,
              compressedBytes: result.compression?.compressedBytes
            });
          }
          writeAgentSse("agent_tool_result", { id: c.id, name: "crawl", content: result.content, isError: result.isError, guarded: false });
          fullMessages.push({ role: "tool", tool_call_id: c.id, content: result.content });
          agentSession.reminder.toolTokensSince += estimateTextTokens(result.content);
          if (result.raw?.manifest) manifests.push(result.raw.manifest);
        }
        return manifests;
      };

      const crawled = new Set(plannedCrawls.map((a) => a.args.url));
      let evidence = (await crawlRound([...crawled])).flatMap(evidenceFromCrawlManifest);

      // Fase 13: a crawled page may be a link hub (calendar/listing). Follow up
      // on a few of its links once, then synthesize — do not recurse.
      const followUps = [...new Set(evidence.filter((e) => e.sourceType === "LINK_HUB").flatMap((e) => e.nextLinks))]
        .filter((u) => !crawled.has(u))
        .slice(0, MAX_FOLLOWUP_CRAWLS);
      if (followUps.length && !controller.signal.aborted) {
        evidence = evidence.concat((await crawlRound(followUps)).flatMap(evidenceFromCrawlManifest));
      }

      // Mandatory synthesis: crawled content is internal evidence, not the answer.
      if (evidence.length) {
        pushGuidanceMessage(fullMessages, buildSynthesisBrief(evidence, { question: userMessage }));
      }
    }

    // Loop guard counts persist across iterations within this turn (detect the
    // agent repeating the same intent/action/result); reset once per turn.
    agentSession.loopGuard.beginTurn();

    let iteration = 0;
    let iterationLimitHit = false;
    let checkpointNudges = 0;
    let checkpointFinalAsked = false;
    let truncationNudges = 0;

    while (true) {
      if (controller.signal.aborted) break;
      await yieldEpistemicShadow();
      if (iteration > AGENT_MAX_ITERATIONS) {
        // Even the tool-less wrap-up round answered with tool calls.
        iterationLimitHit = true;
        break;
      }
      // WP8 of convergenza.loop.md §11.2: compaction is decided BEFORE the
      // budget check, so a long conversation summarizes itself instead of
      // dying on the budget.  Counts come from WP6 (token-count/tokenize/
      // estimate cascade and the backend's own context size).
      if (fullMessages.length > 1) {
        const compactionCtx = await contextWindow({
          fetchImpl: fetch, base: backendBase(), config, localWrapper: wrapperEnabled()
        });
        // Same tools the request below declares: their schemas are prompt
        // tokens, and without them the count stayed under the 400 limit.
        const compactionUsed = await countPromptTokens({
          messages: fullMessages,
          tools: withContextTool(dotTools(modelFacingTools({ includeSage: !dot && sagePolicyIsActive(), evidenceEnabled: evidenceActive, ...leanFlags })))
        }, {
          fetchImpl: fetch, base: backendBase(), signal: requestSignal
        });
        if (shouldCompact({
          usedTokens: compactionUsed.tokens,
          ctx: compactionCtx.tokens,
          policy: AGENT_LOOP_POLICY,
          reserveTokens: 0
        })) {
          writeAgentSse("agent_status", { mode: "compacting" });
          try {
            const { next } = await runCompaction(
              fullMessages,
              "context pressure before continuing the current task",
              { ctxInfo: compactionCtx, usedInfo: compactionUsed }
            );
            fullMessages = next;
            agentSession.replaceMessages(next, "context compaction");
            forceResetNextIteration = true;
          } catch (error) {
            // Same as C's "compact skipped: nothing to compact" (ds4_agent.c):
            // a history that is all tail is not an error, the round goes on.
            if (/nothing to summarize/.test(error.message)) {
              writeAgentSse("agent_status", { mode: "compact_skipped", reason: "nothing to compact" });
            } else {
              // The conversation stays intact: only replaceMessages committed.
              writeAgentSse("agent_error", { error: `COMPACTION_FAILED: ${error.message}` });
              break;
            }
          }
        }
      }
      const budgetStatus = agentBudgetStatus(fullMessages, agentSession.usageTotals, agentTokenBudget);
      if (budgetStatus.exceeded) {
        writeAgentSse("agent_error", {
          error: formatAgentBudgetError(budgetStatus),
          ...budgetStatus
        });
        break;
      }
      // WP7 of convergenza.loop.md: same trigger as
      // agent_worker_maybe_append_system_prompt_reminder (tool burst or token
      // distance).  The reminder rides as a user message with the
      // "[DS4 Studio]" prefix — a mid-conversation "system" breaks Qwen chat
      // templates — and its text is the JS loop's own sections, not the C
      // DSML one (plan §10 point 4).
      const reminderOutcome = maybeAppendSystemPromptReminder({
        messages: fullMessages,
        reminder: agentSession.reminder,
        thresholds: AGENT_REMINDER_THRESHOLDS,
        reminderText: [
          agentCoreRulesSection(),
          agentEpistemicRulesSection(),
          // Same trigger as the C's evidence re-anchor: only the short
          // contract, never the full skill.
          skillState?.promptSkills?.().evidenceLoaded
            ? loadAgentText("evidence-core-contract")
            : null
        ].filter(Boolean).join("\n\n")
      });
      if (reminderOutcome.appended && evidenceActive) {
        // C agent_worker_append_evidence_reanchor (shadow ds4_agent.c:7762-7774
        // and 3469-3472): the contract re-injection is counted.
        agentSession.evidenceState.metrics.reinjectionsTotal++;
        agentSession.evidenceTurn.coreContractInjectedThisTurn = true;
      }
      iteration++;
      const wrapUpRound = iteration > AGENT_MAX_ITERATIONS;
      if (wrapUpRound) {
        writeAgentSse("agent_warning", {
          type: "AGENT_ITERATION_LIMIT",
          warning: `Limite di ${AGENT_MAX_ITERATIONS} iterazioni raggiunto: richiesto lo stato dell'analisi.`
        });
        // "user", not "system": Qwen3.x chat templates raise on a system
        // message anywhere but first, and llama-server answers HTTP 500.
        fullMessages.push({ role: "user", content: AGENT_ITERATION_LIMIT_PROMPT });
        // Same as the epistemic repair: a message added outside the session
        // must reach a stateful backend as a full reset, not a delta.
        forceResetNextIteration = true;
      }

      const requestWithThinkMode = agentSession.thinkMode === undefined
        ? reqParams
        : {
            ...reqParams,
            thinking: agentSession.thinkMode !== "0",
            reasoning_effort: agentSession.thinkMode === "0"
              ? undefined
              : agentSession.thinkMode
          };
      let basePayload = buildChatPayload({ ...requestWithThinkMode, stream: true }, fullMessages);
      // Filter out sage tool if SageMath is not enabled
      basePayload.tools = withContextTool(
        dotTools(modelFacingTools({ includeSage: !dot && sagePolicyIsActive(), evidenceEnabled: evidenceActive, ...leanFlags }))
      );
      // Tools stay declared so the prompt prefix (and the backend's prompt
      // cache) is unchanged; "none" stops the server from parsing tool calls.
      if (wrapUpRound) basePayload.tool_choice = "none";
      basePayload.stream = true;
      basePayload.stream_options = { include_usage: true };
      basePayload = await resolveAutoMaxTokensPayload(basePayload, controller.signal);
      // A Lean round is a proof attempt plus one lean_check, not an essay: at
      // the 32k auto ceiling a model "proving in its head" streamed for many
      // minutes before calling the tool.  Cap it; a cut round gets the
      // existing AGENT_OUTPUT_TRUNCATED nudge to continue in smaller pieces.
      if (skillState?.promptSkills?.().lean &&
          Number(basePayload.max_tokens) > AGENT_LEAN_ROUND_MAX_TOKENS) {
        basePayload.max_tokens = AGENT_LEAN_ROUND_MAX_TOKENS;
      }

      // Choose payload mode. Probe the backend (cached) at the start of each
      // iteration so the stateful path is used automatically when supported,
      // and we fall back transparently when it is not.
      const allowDelta = await probeStatefulBackend();
      const forceReset = forceResetNextIteration;
      forceResetNextIteration = false;
      let modeChoice = agentSession.choosePayload(basePayload, {
        allowDelta,
        userTurnPolicy: allowDelta ? "delta" : "reset",
        forceReset
      });
      let backendRes;
      let retriedReset = false;

      while (true) {
        writeAgentSse("agent_status", {
          iteration,
          mode: modeChoice.mode,
          reason: modeChoice.reason,
          statefulSupported: allowDelta,
          ponyMode: agentSession.ponyMode
        });
        const url = `${backendBase()}${allowDelta ? AGENT_STATEFUL_PATH : "/v1/chat/completions"}`;
        try {
          backendRes = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(modeChoice.payload),
            signal: controller.signal
          });
        } catch (err) {
          writeAgentSse("agent_error", { error: `Backend fetch failed: ${err.message}` });
          backendRes = null;
          break;
        }

        // HTTP 409 on a delta means the server lost continuation state.
        // Retry once as a forced reset on the same session id.
        if (
          backendRes.status === 409 &&
          modeChoice.mode === "delta" &&
          !retriedReset
        ) {
          retriedReset = true;
          writeAgentSse("agent_status", {
            iteration,
            mode: "reset",
            reason: "409 from backend; retrying as reset",
            ponyMode: agentSession.ponyMode
          });
          modeChoice = agentSession.choosePayload(basePayload, {
            allowDelta,
            userTurnPolicy: "reset",
            forceReset: true,
            resetReason: "delta rejected by server; retrying full reset"
          });
          continue;
        }
        break;
      }

      if (!backendRes) break;
      if (!backendRes.ok) {
        const txt = await backendRes.text().catch(() => "");
        writeAgentSse("agent_error", { error: `Backend HTTP ${backendRes.status}: ${txt.slice(0, 500)}` });
        break;
      }

      // Stream and collect the response
      const reader = backendRes.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let assistantContent = "";
      let assistantReasoning = "";
      let toolCalls = [];
      let currentToolCalls = new Map();
      let finishReason = null;
      let streamGuardBlocked = false;
      // Nothing may be streamed while an authoritative backend still owes a
      // verdict: not one byte of a "teorema dimostrato" prefix may reach the
      // client before the finalization gate has had a chance to discard it.
      // QF-15 §37 — block mode owes a verdict too, so its candidate prose is
      // withheld on the same terms as Sage's and Lean's. withholdOutput is what
      // lets an operator run block mode without the buffering, so it is read
      // rather than assumed.
      // C evidence_defer (studio__ds4_agent.c.patch WP6): in block mode a final
      // answer is a candidate until finalize is valid, withheld like epistemic.
      const epistemicWithholdsOutput = withholdsOutput(runtimeConfig.agent.epistemic) ||
        evidenceMode === EVIDENCE_MODE_ENUM.BLOCK;
      const deferPotentialAuthoritativeOutput =
        epistemicWithholdsOutput ||
        (authoritativeSageChat &&
          (sagePolicyIsActive() || Boolean(sageTracker.snapshot().runId))) ||
        leanTracker.used;
      const deferredAssistantText = new AuthoritativeOutputBuffer();
      const deferredAssistantReasoning = new AuthoritativeOutputBuffer();
      // C agent_repetition_detector: reasoning and prose of ONE round that
      // collapse into a repeating cycle stop the round instead of running to
      // max_tokens (a Lean turn on Vitronia streamed 14k reasoning tokens).
      const repetition = createRepetitionDetector();
      let degenerateRound = false;

      for (;;) {
        if (controller.signal.aborted || degenerateRound) break;
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split(/\r?\n\r?\n/);
        buffer = parts.pop() || "";

        for (const part of parts) {
          const raw = part
            .split(/\r?\n/)
            .filter((l) => l.startsWith("data:"))
            .map((l) => l.slice(5).trimStart().replace(/\r$/, ""))
            .join("\n");
          if (!raw || raw === "[DONE]") continue;
          let event;
          try { event = JSON.parse(raw); } catch { continue; }

          // llama.cpp-shaped backends put timing in a sibling `timings` block,
          // which stops here unless it is folded into usage: the browser only
          // reads `usage.timing`, so gen t/s would read n/a for the agent.
          const usage = normalizeUsageTiming(event);
          if (usage) {
            const totals = agentSession.recordUsage(usage);
            writeAgentSse("agent_usage", { ...usage, totals });
            const budgetStatus = agentBudgetStatus(fullMessages, totals, agentTokenBudget);
            if (budgetStatus.exceeded) {
              throw new Error(formatAgentBudgetError(budgetStatus));
            }
          }

          const choice = event.choices?.[0];
          if (!choice) continue;
          if (choice.finish_reason) finishReason = choice.finish_reason;
          const delta = choice.delta || {};

          // Text content
          if (delta.content) {
            // The wrap-up round is the status report the iteration cap asked
            // for: a listing of what was checked is its content, not an echo.
            // It is published unvalidated (see the wrapUpRound branch below).
            const guarded = wrapUpRound
              ? { content: assistantContent + delta.content, accepted: true, decision: null }
              : guardAssistantDelta(assistantContent, delta.content, agentSession.loopGuard);
            if (guarded.decision?.warn) {
              writeAgentSse("agent_warning", {
                type: guarded.decision.type,
                warning: `${guarded.decision.reason}\n${guarded.decision.guidance}`
              });
            }
            if (!guarded.accepted) {
              streamGuardBlocked = true;
              writeAgentSse("agent_error", {
                error: `[${guarded.decision.type}] ${guarded.decision.reason}\n${guarded.decision.guidance}`
              });
              writeAgentSse("agent_done", {
                iterations: iteration,
                finish_reason: "loop_guard",
                totals: agentSession.usageTotals
              });
              controller.abort();
              break;
            }
            const acceptedDelta = guarded.content.slice(assistantContent.length);
            assistantContent = guarded.content;
            if (acceptedDelta) {
              if (deferPotentialAuthoritativeOutput) deferredAssistantText.append(acceptedDelta);
              else writeAgentSse("agent_text", { content: acceptedDelta });
            }
          }

          // Reasoning
          const reasoning = delta.reasoning_content || delta.reasoning || "";
          if (repetition.feed(reasoning) >= REP_MIN_CYCLES ||
              repetition.feed(delta.content || "") >= REP_MIN_CYCLES) {
            degenerateRound = true;
            break;
          }
          if (reasoning) {
            assistantReasoning += reasoning;
            if (deferPotentialAuthoritativeOutput) deferredAssistantReasoning.append(reasoning);
            else writeAgentSse("agent_reasoning", { content: reasoning });
          }

          // Tool calls
          if (Array.isArray(delta.tool_calls)) {
            for (const tc of delta.tool_calls) {
              const idx = typeof tc.index === "number" ? tc.index : currentToolCalls.size;
              let existing = currentToolCalls.get(idx);
              if (!existing) {
                existing = { id: tc.id || `call_${idx}`, name: "", arguments: "" };
                currentToolCalls.set(idx, existing);
              }
              if (tc.id) existing.id = tc.id;
              if (tc.function?.name) existing.name = tc.function.name;
              if (tc.function?.arguments) existing.arguments += tc.function.arguments;
            }
          }
        }
      }

      if (streamGuardBlocked) break;

      if (degenerateRound) {
        // The cut round is discarded (as C does): nothing of it is committed.
        try { await reader.cancel(); } catch { /* already closed */ }
        deferredAssistantText.discard();
        deferredAssistantReasoning.discard();
        const failure = agentSession.loopGuard.recordProtocolFailure({
          code: "DEGENERATE_GENERATION",
          phase: "generation"
        });
        if (failure.terminal) {
          writeAgentSse("agent_error", {
            error: `[DEGENERATE_GENERATION] ${failure.guidance}`
          });
          writeAgentSse("agent_done", {
            iterations: iteration,
            finish_reason: "loop_guard",
            totals: agentSession.usageTotals
          });
          break;
        }
        writeAgentSse("agent_warning", {
          type: "DEGENERATE_GENERATION",
          warning: "Loop guard: ripetizione degenerativa — round interrotto, il modello riprova."
        });
        pushGuidanceMessage(fullMessages, failure.guidance);
        forceResetNextIteration = true;
        continue;
      }

      // Finalize tool calls
      toolCalls = Array.from(currentToolCalls.values()).map((tc) => {
        let parsedArgs = {};
        try { parsedArgs = JSON.parse(tc.arguments || "{}"); } catch {}
        return { id: tc.id, name: tc.name, arguments: parsedArgs };
      });
      const responseBelongsToSage = authoritativeSageChat &&
        (toolCalls.some((tc) => tc.name === "sage") || Boolean(sageTracker.snapshot().runId));
      // A Lean turn that is still repairable withholds its prose too: the gate
      // below discards it, so streaming it first would publish exactly the
      // premature claim the gate exists to stop.
      const responseWithheldForLean = leanTracker.used;
      // §37 — with tool calls pending this prose is a candidate, not a
      // publication, and in block mode a candidate is never streamed before the
      // gate has ruled on it.
      if (!responseBelongsToSage && !responseWithheldForLean && !epistemicWithholdsOutput) {
        deferredAssistantText.flush((content) => writeAgentSse("agent_text", { content }));
        deferredAssistantReasoning.flush((content) => writeAgentSse("agent_reasoning", { content }));
      }

      // Build assistant message for session tracking
      const assistantMessage = {
        role: "assistant",
        content: assistantContent || null
      };
      if (assistantReasoning) assistantMessage.reasoning_content = assistantReasoning;
      if (toolCalls.length > 0) {
        assistantMessage.tool_calls = toolCalls.map((tc) => ({
          id: tc.id,
          type: "function",
          function: { name: tc.name, arguments: JSON.stringify(tc.arguments) }
        }));
      }

      const isFinalResponse = !toolCalls.length || finishReason !== "tool_calls";
      writeAgentDebug("turn", {
        finishReason,
        isFinalResponse,
        toolCalls: toolCalls.map((tc) => tc.name),
        contentLength: assistantContent.length,
        observationFlowPending: agentSession.loopGuard.requiresStructuredObservation()
      });
      // The wrap-up round has no retry left: any guard's `continue` below trips
      // the iteration cap and drops the status report with a bare error.  Publish
      // it as-is, flagged as unvalidated.  Sage and Lean keep their own paths.
      if (wrapUpRound && isFinalResponse && !responseBelongsToSage && !responseWithheldForLean) {
        agentSession.commit(modeChoice.pending, assistantMessage);
        fullMessages = agentSession.messages();
        deferredAssistantText.flush((content) => writeAgentSse("agent_text", { content }));
        deferredAssistantReasoning.flush((content) => writeAgentSse("agent_reasoning", { content }));
        writeAgentSse("agent_warning", {
          type: "AGENT_ITERATION_LIMIT_REPORT",
          warning: "Stato dell'analisi al limite di iterazioni: risposta pubblicata senza i controlli finali."
        });
        writeAgentSse("agent_done", {
          iterations: iteration,
          finish_reason: "iteration_limit",
          totals: agentSession.usageTotals
        });
        break;
      }
      if (isFinalResponse) {
        const snapshotBeforeGuard = sageTracker.snapshot();
        const finalization = guardSageFinalization(sageTracker);
        if (finalization.blocked) {
          sageMetrics.recordOrchestration("sage_premature_finalizations_blocked_total");
          emitSageTransition(
            snapshotBeforeGuard,
            sageTracker.snapshot(),
            "PREMATURE_FINALIZATION_BLOCKED"
          );
          if (finalization.retryAllowed) {
            pushGuidanceMessage(fullMessages, finalization.guidance);
            forceResetNextIteration = true;
            writeSageStatus({
              state: sageTracker.snapshot().state,
              status: "blocked",
              code: "SAGE_FINALIZATION_BLOCKED",
              summary: "Finalizzazione prematura bloccata; manca una fase SageMath obbligatoria."
            });
            continue;
          }

          finalizeSageStatus(
            "failed",
            "Il risultato Sage non ha superato il gate di pubblicazione.",
            "SAGE_FINALIZATION_BLOCKED"
          );
          writeAgentSse("agent_error", { error: "SAGE_FINALIZATION_BLOCKED" });
          writeAgentSse("agent_done", {
            iterations: iteration,
            finish_reason: "sage_blocked",
            totals: agentSession.usageTotals
          });
          break;
        }

        // Lean finalization gate. Runs before agentSession.commit: a response
        // written while a repairable Lean failure is outstanding must never
        // become continuation state, or the next iteration inherits the claim.
        if (leanTracker.mustContinue()) {
          const block = leanTracker.recordPrematureFinalization();
          leanMetrics.recordOrchestration?.("proof_premature_finalizations_blocked_total");
          if (block.retryAllowed) {
            pushGuidanceMessage(fullMessages, block.guidance);
            forceResetNextIteration = true;
            writeLeanStatus({
              status: "blocked",
              code: "LEAN_FINALIZATION_BLOCKED",
              summary: "Finalizzazione prematura bloccata; la prova non è ancora verificata."
            });
            continue;
          }
          // The premature-finalization budget is spent. The turn may end now,
          // but only as NOT_VERIFIED — never as a proof.
          pushGuidanceMessage(
            fullMessages,
            "LEAN_TERMINAL_NOT_VERIFIED\n" +
              `reason=${leanTracker.snapshot().terminalReason || "PREMATURE_FINALIZATION_BUDGET_EXHAUSTED"}\n` +
              "Do not claim the theorem was verified. Answer with STATO: NOT_VERIFIED and the reason code."
          );
          forceResetNextIteration = true;
          finalizeLeanStatus("Budget di finalizzazione esaurito; nessuna prova verificata.");
          continue;
        }
      }

      // Validate the completed response before committing it to continuation state.
      const authoritativeClaimMode =
        leanTracker.used || sageTracker.used() ? "block" : "warn";
      const claimDecision = checkVerifiedClaim(
        assistantContent,
        turnEvidence.join("\n"),
        { mode: authoritativeClaimMode }
      );
      if (claimDecision?.warn) {
        writeAgentSse("agent_warning", {
          type: claimDecision.type,
          warning: `${claimDecision.reason}\n${claimDecision.guidance}`
        });
      }
      if (claimDecision?.block && !isFinalResponse) {
        deferredAssistantText.discard();
        deferredAssistantReasoning.discard();
        pushGuidanceMessage(fullMessages, `${claimDecision.reason}\n${claimDecision.guidance}`);
        forceResetNextIteration = true;
        writeAgentSse("agent_warning", {
          type: claimDecision.type,
          warning: `${claimDecision.reason}\n${claimDecision.guidance}`
        });
        continue;
      }
      const intentDecision = agentSession.loopGuard.checkAssistantText(assistantContent, {
        isFinalResponse
      });
      if (intentDecision?.warn) {
        writeAgentSse("agent_warning", {
          type: intentDecision.type,
          warning: `${intentDecision.reason}\n${intentDecision.guidance}`
        });
      }
      // A final answer that is empty, or a checkpoint missing markers, after a
      // compressed observation: ask for the answer instead of ending the turn
      // on an error (the work was done; only its write-up is missing).
      // Bounded, and charged to the same budget as the checkpoint nudges.
      if (intentDecision?.block &&
          intentDecision.type === "STOP_MISSING_OBSERVATION_FLOW" &&
          !wrapUpRound && checkpointNudges < AGENT_MAX_CHECKPOINT_NUDGES) {
        checkpointNudges++;
        writeAgentSse("agent_warning", {
          type: intentDecision.type,
          warning: "Risposta finale vuota o checkpoint incompleto: richiesto il report finale."
        });
        fullMessages.push({ role: "user", content: AGENT_CHECKPOINT_FINAL_PROMPT });
        forceResetNextIteration = true;
        continue;
      }
      if (intentDecision?.block) {
        writeAgentDebug("guard_block", {
          guard: intentDecision.type,
          isFinalResponse,
          finishReason,
          toolCalls: toolCalls.length,
          contentLength: assistantContent.length,
          contentHead: assistantContent.slice(0, 300),
          markers: {
            observation: assistantContent.indexOf("[OBSERVATION]"),
            compressed: assistantContent.indexOf("[COMPRESSED]"),
            target: assistantContent.indexOf("[TARGET_SELECTED]"),
            verdict: assistantContent.indexOf("[VERDICT]")
          }
        });
        writeAgentSse("agent_error", {
          error: `[${intentDecision.type}] ${intentDecision.reason}\n${intentDecision.guidance}`
        });
        finalizeSageStatus("failed", "Composizione finale non completata.", intentDecision.type);
        writeAgentSse("agent_done", { iterations: iteration, finish_reason: "loop_guard", totals: agentSession.usageTotals });
        break;
      }

      // WP12: fabricated tool results (C agent_is_fabricated_result, shadow
      // ds4_agent.c:20212-20235, wired at :24083-24111): a bare result marker
      // in a plain-text final answer is a simulation.  Inject the C tool
      // error, count it in the defensive run (C :24094) and continue: the
      // iteration budget bounds the retry, exactly like C's goto continue.
      if (isFinalResponse && assistantContent && isFabricatedResult(assistantContent)) {
        noteFabricatedResult(agentSession.loopGuardState);
        deferredAssistantText.discard();
        deferredAssistantReasoning.discard();
        writeAgentDebug("loop_guard", { guard: "fabricated_result", iteration });
        pushGuidanceMessage(fullMessages, FABRICATION_TOOL_ERROR_TEXT);
        forceResetNextIteration = true;
        continue;
      }

      // Only a complete ordered synthesis releases the read-batch budget.
      if (hasStructuredSynthesis(assistantContent)) {
        agentSession.readGuard.markSummaryProduced();
      }

      const leanSnapshotBeforeCommit = leanTracker.snapshot();
      const authoritativeDecision = isFinalResponse
        ? evaluateLeanFinalCandidate({
            assistantContent,
            leanSnapshot: leanSnapshotBeforeCommit,
            verifiedSource: leanTracker.checkedSource,
            claimDecision
          })
        : null;
      if (authoritativeDecision && !authoritativeDecision.allowed) {
        deferredAssistantText.discard();
        deferredAssistantReasoning.discard();
        pushGuidanceMessage(fullMessages, authoritativeDecision.guidance);
        forceResetNextIteration = true;
        writeAgentSse("agent_warning", {
          type: authoritativeDecision.code,
          warning: authoritativeDecision.guidance
        });
        continue;
      }

      // QF-14 §36.3 — the Quantum Fix gate runs after Sage and Lean and before
      // the commit, which is the order §36.3 states as an invariant. Inert
      // unless agent.epistemic.enabled; in shadow it reports and lets the turn
      // through, in block it discards the candidate answer and asks again.
        // The evaluation runs up to maxVerifierCallsPerTurn model calls and its
        // only abort signal is the client's. A verifier that stalls therefore
        // stalled the whole turn: the answer was already streamed, but
        // agent_done never followed, so the UI sat on a red Stop button
        // forever. Bound it. Shadow mode is advisory by definition, so a
        // timeout degrades to "no decision" rather than losing the turn -- but
        // it says so, because silently unverified is worse than slow.
        // Shadow runs after publication and outlives the round; a single-slot
        // backend (ds4-wrapper) answers 409 to the agent's next round while the
        // segmenter holds it.  Shadow is advisory, the agent's round is not:
        // yieldEpistemicShadow() cancels it before the next model call.
        const shadowAbort = epistemicShadowMode && isFinalResponse ? new AbortController() : null;
        const epistemicEvaluation = isFinalResponse && !epistemicShadowSkipped
          ? evaluateEpistemicTurnBounded({
              turn: epistemicTurn,
              options: {
                assistantContent,
                assistantReasoning,
                client: epistemicClient,
                executeSage: runtimeConfig.agent.epistemic.verifyMath
                  ? epistemicSageExecutor
                  : null,
                citationProviders: epistemicCitationProviders,
                sourceContext: epistemicSourceContext,
                sessionLedger: epistemicEvaluationLedger
              },
              signal: (shadowAbort || controller).signal,
              timeoutMs: epistemicTimeoutMs,
              onTimeout: (ms) => {
                writeAgentDebug("epistemic_timeout", { timeoutMs: ms });
                if (epistemicShadowMode) {
                  console.warn("EPISTEMIC_TIMEOUT", JSON.stringify({ timeoutMs: ms, sessionKey }));
                } else {
                  writeAgentSse("agent_warning", {
                    type: "EPISTEMIC_TIMEOUT",
                    warning:
                      `Epistemic verification exceeded ${ms}ms and was abandoned. ` +
                      `The answer is unverified.`
                  });
                }
              }
            })
          : null;
        const epistemicDecision = epistemicEvaluation
          ? (epistemicShadowMode ? null : await epistemicEvaluation)
          : null;
        const stageEpistemicClaims = (decision) => {
          if (!persistEpistemicClaims || !decision) return;
          // REM-005: stage the bounded history so challenge/rejection events
          // survive the turn boundary into the session event map.
          agentSession.epistemic.stageClaims(epistemicTurn.ledger.allClaims(), {
            history: epistemicTurn.ledger.historySnapshot()
          });
        };
        const recordEpistemicDecision = (decision) => {
          if (!decision) return;
          const epistemicAuditEvent = epistemicTelemetry.record({
            mode: runtimeConfig.agent.epistemic.mode,
            decision,
            claims: epistemicTurn.ledger.allClaims(),
            extraction: decision.extraction,
            promotions: decision.promotions,
            sessionRepromotionBlocks: decision.verifierSummary?.sessionBlocks ?? 0
          });
          console.info("EPISTEMIC_AUDIT", JSON.stringify(epistemicAuditEvent));
          if (decision.shadowTrace) {
            console.info("EPISTEMIC_SHADOW", JSON.stringify(decision.shadowTrace));
          }
        };
        if (epistemicShadowMode && epistemicEvaluation) {
          trackEpistemicShadow(shadowAbort, epistemicEvaluation);
          const committedRevision = epistemicTurn.revision + 1;
          observeEpistemicShadow(epistemicEvaluation, {
            onDecision: (decision) => {
              if (!decision) return;
              const sameTurn =
                agentSession.state?.revision === committedRevision &&
                agentSession.epistemic.turn === epistemicSessionTurn;
              if (sameTurn) {
                stageEpistemicClaims(decision);
                if (persistEpistemicClaims) {
                  agentSession.epistemic.commitClaims(epistemicTurn.ledger.allClaims());
                }
              }
              recordEpistemicDecision(decision);
            },
            onError: (error) => {
              console.warn("EPISTEMIC_SHADOW_ERROR", String(error?.message ?? error));
            }
          });
        }
        stageEpistemicClaims(epistemicDecision);
        recordEpistemicDecision(epistemicDecision);
        if (
          epistemicDecision &&
          epistemicDecision.code !== "EPISTEMIC_NOT_ACTIVE" &&
          epistemicDecision.code !== "EPISTEMIC_CLEAN"
        ) {
        writeAgentSse("agent_warning", {
          type: epistemicDecision.code,
          warning: epistemicDecision.guidance || epistemicDecision.code,
          // shadow ships the turn and records what block mode would have done.
          wouldBlock: epistemicDecision.wouldBlock === true,
          blockedClaimIds: epistemicDecision.blockedClaimIds ?? []
        });
      }
      // WP10: Evidence-First gate (C agent_worker_evidence_check_final, shadow
      // ds4_agent.c:7779-7804): only a final answer owes a verdict — prose in
      // front of a tool call is narration; shadow records and lets through.
      const evidenceGate = evidenceActive && isFinalResponse
        ? evidenceCheckFinal(agentSession.evidenceState, evidenceMode, true, assistantContent)
        : { allowed: true, result: null };

      if (epistemicDecision && !epistemicDecision.allowed) {
        deferredAssistantText.discard();
        deferredAssistantReasoning.discard();
        if (persistEpistemicClaims) {
          agentSession.epistemic.discardCandidate(epistemicDecision.code);
        }
        // REM-007/008: the repair policy owns the loop decision. The transition
        // is a pure state machine shared with the behavioral tests; the turn
        // only carries the policy state across rounds (single source of truth)
        // and beginRepair() records the transport round, never a decision.
        const repairTransition = evaluateRepairTransition({
          claims: epistemicTurn.ledger.allClaims(),
          previous: epistemicTurn.repairState.policy ?? null,
          config: {
            maxRepairRounds: runtimeConfig.agent.epistemic.maxRepairRounds,
            blockSeverity: runtimeConfig.agent.epistemic.blockSeverity
          }
        });
        epistemicTurn.repairState = {
          ...epistemicTurn.repairState,
          policy: repairTransition.decision
        };
        if (repairTransition.next === REPAIR_NEXT.EXHAUSTED) {
          writeAgentSse("agent_warning", {
            type: "EPISTEMIC_REPAIR_EXHAUSTED",
            warning: repairTransition.decision.guidance
          });
          writeAgentSse("agent_done", { finish_reason: "epistemic_blocked" });
          break;
        }
        if (repairTransition.next !== REPAIR_NEXT.REPAIR) {
          // NOT_REQUIRED/RESOLVED while the current gate is blocked is
          // incoherent. Fail safe: report and terminate rather than loop.
          console.info("EPISTEMIC_REPAIR_INCOHERENT", JSON.stringify(repairTransition.decision));
          writeAgentSse("agent_warning", {
            type: "EPISTEMIC_REPAIR_EXHAUSTED",
            warning: "The candidate answer could not be verified and no coherent repair is owed."
          });
          writeAgentSse("agent_done", { finish_reason: "epistemic_blocked" });
          break;
        }
        const repairGuidance = runtimeConfig.agent.epistemic.strictRepair
          ? repairTransition.decision.guidance
          : epistemicDecision.guidance;
        // WP10 (C 24122-24160): one repair round carries both sets of
        // violations, epistemic first, charged to both budgets; an exhausted
        // Evidence budget terminates the turn with no candidate bytes.
        if (!evidenceGate.allowed) {
          if (agentSession.evidenceTurn.repairRounds >= EVIDENCE_MAX_REPAIR_ROUNDS) {
            console.info("EVIDENCE_FINALIZE_TERMINAL", evidenceGate.result?.reasonCode ?? "?");
            writeAgentSse("agent_error", {
              code: "EVIDENCE_FINALIZATION_TERMINAL",
              error: EVIDENCE_FINALIZATION_TERMINAL_STATUS
            });
            writeAgentSse("agent_done", { finish_reason: "evidence_blocked" });
            break;
          }
          agentSession.evidenceTurn.repairRounds++;
        }
        epistemicTurn.beginRepair();
        pushGuidanceMessage(fullMessages, !evidenceGate.allowed
          ? `${repairGuidance}\n${evidenceRepairGuidance(evidenceGate.result)}`
          : repairGuidance);
        forceResetNextIteration = true;
        continue;
      }

      // WP10: blocked by Evidence alone (epistemic allowed it): repair or
      // terminate, publish nothing (C 23966-23975 and 24127-24178).
      if (!evidenceGate.allowed) {
        deferredAssistantText.discard();
        deferredAssistantReasoning.discard();
        if (agentSession.evidenceTurn.repairRounds < EVIDENCE_MAX_REPAIR_ROUNDS) {
          agentSession.evidenceTurn.repairRounds++;
          pushGuidanceMessage(fullMessages, evidenceRepairGuidance(evidenceGate.result));
          forceResetNextIteration = true;
          continue;
        }
        console.info("EVIDENCE_FINALIZE_TERMINAL", evidenceGate.result?.reasonCode ?? "?");
        writeAgentSse("agent_error", {
          code: "EVIDENCE_FINALIZATION_TERMINAL",
          error: EVIDENCE_FINALIZATION_TERMINAL_STATUS
        });
        writeAgentSse("agent_done", { finish_reason: "evidence_blocked" });
        break;
      }

      // WP12: defensive-loop guard (C :24181-24208).  Only a plain-text
      // answer that reached this point — every gate allowed it — feeds the
      // counter, exactly like C's placement after the repair block.  A stop
      // publishes no candidate bytes: the withheld buffer is dropped, the C
      // loop-guard status is published and the loop error persists in the
      // transcript via replaceMessages (C appends the tool message there).
      if (isFinalResponse && assistantContent) {
        const defensiveLoop = evaluateDefensiveLoop(agentSession.loopGuardState, assistantContent);
        if (defensiveLoop.stop) {
          deferredAssistantText.discard();
          deferredAssistantReasoning.discard();
          writeAgentSse("agent_status", {
            iteration,
            mode: "loop_guard",
            reason: LOOP_GUARD_STATUS_TEXT
          });
          pushGuidanceMessage(fullMessages, DEFENSIVE_LOOP_ERROR_TEXT);
          agentSession.replaceMessages(fullMessages, "loop guard defensive stop");
          writeAgentSse("agent_done", { iterations: iteration, finish_reason: "loop_guard", totals: agentSession.usageTotals });
          break;
        }
      }

      // Commit only after every authoritative finalization decision accepted it.
      if (persistEpistemicClaims && epistemicDecision) {
        agentSession.epistemic.commitClaims(epistemicTurn.ledger.allClaims());
      }
      agentSession.commit(modeChoice.pending, assistantMessage);

      // §37 — the withheld prose is released here, after every gate ruled and
      // never before. Sage and Lean turns flush on their own paths below.
      if (epistemicWithholdsOutput && !responseBelongsToSage && !responseWithheldForLean) {
        deferredAssistantText.flush((content) => writeAgentSse("agent_text", { content }));
        deferredAssistantReasoning.flush((content) => writeAgentSse("agent_reasoning", { content }));
      }
      fullMessages = agentSession.messages();

      const checkpoint = isFinalResponse && !wrapUpRound && !responseBelongsToSage &&
        !leanSnapshotBeforeCommit.proofId
        ? readStructuredCheckpoint(assistantContent)
        : undefined;
      if (checkpoint && checkpointNudges < AGENT_MAX_CHECKPOINT_NUDGES &&
          (checkpoint.next === "continue" || !checkpointFinalAsked)) {
        checkpointNudges++;
        if (checkpoint.next === "finish") checkpointFinalAsked = true;
        writeAgentSse("agent_status", {
          iteration,
          mode: "checkpoint",
          reason: checkpoint.next === "continue"
            ? `checkpoint ${checkpoint.verdict}: continuing on ${String(checkpoint.target).slice(0, 120)}`
            : "checkpoint: asking for the final report"
        });
        fullMessages.push({
          role: "user",
          content: checkpoint.next === "continue"
            ? AGENT_CHECKPOINT_CONTINUE_PROMPT(checkpoint.target)
            : AGENT_CHECKPOINT_FINAL_PROMPT
        });
        forceResetNextIteration = true;
        continue;
      }
      if (!isFinalResponse) checkpointNudges = 0;

      // Cut at max_tokens: whatever was being produced -- usually a large
      // write/edit call -- is incomplete, and treating the fragment as the
      // final answer ended the turn silently mid-task.  Tell the model where
      // it stopped and to work in smaller pieces, a bounded number of times.
      if (isFinalResponse && !wrapUpRound && finishReason === "length" &&
          truncationNudges < AGENT_MAX_TRUNCATION_NUDGES) {
        truncationNudges++;
        writeAgentSse("agent_warning", {
          type: "AGENT_OUTPUT_TRUNCATED",
          warning: `Risposta troncata al limite di token (max_tokens=${basePayload.max_tokens ?? "?"}); il modello riprova a pezzi.`
        });
        fullMessages.push({ role: "user", content: AGENT_TRUNCATION_PROMPT(basePayload.max_tokens) });
        forceResetNextIteration = true;
        continue;
      }

      // If no tool calls, we're done
      if (isFinalResponse) {
        const leanSnapshot = leanSnapshotBeforeCommit;
        const leanSourceMatches = leanSnapshot.verified
          ? authoritativeDecision?.code === "LEAN_VERIFIED"
          : true;
        if (leanSnapshot.proofId) {
          deferredAssistantText.flush((content) => writeAgentSse("agent_text", { content }));
          deferredAssistantReasoning.flush((content) => writeAgentSse("agent_reasoning", { content }));
          finalizeLeanStatus(
            leanSnapshot.verified && leanSourceMatches
              ? "Prova verificata: status=checked."
              : leanSnapshot.verified
                ? "Sorgente pubblicato diverso da quello verificato."
                : `Prova non verificata (${leanSnapshot.terminalReason || leanSnapshot.state}).`
          );
        }
        writeAgentSse("agent_done", {
          iterations: iteration,
          // A Lean turn names its own outcome so the UI never has to infer the
          // badge from the prose.
          finish_reason: leanSnapshot.proofId
            ? (authoritativeDecision?.finishReason || "lean_not_verified")
            : (finishReason || "stop"),
          ...(leanSnapshot.proofId
            ? {
                leanVerified: leanSnapshot.verified && leanSourceMatches,
                leanVerification: leanVerificationEvidence(leanSnapshot, authoritativeDecision),
                leanTerminalReason: leanSnapshot.terminalReason,
                leanCheckedSourceSha256: leanSnapshot.checkedSourceSha256,
                leanFinalSourceMatchesVerified: leanSourceMatches
              }
            : {}),
          totals: agentSession.usageTotals
        });
        break;
      }

      // May this TOOL run?  Separate question from "may this PROSE be
      // published?", which authoritativeFinalizationGate already answered
      // above.  Once a domain verdict is terminal nothing runs for it, whatever
      // tool the model reached for.
      const toolGate = evaluateAuthoritativeToolCalls({
        leanSnapshot: leanSnapshotBeforeCommit,
        sageSnapshot: sageTracker.snapshot(),
        toolCalls
      });
      if (!toolGate.allowed) {
        const guidance = authoritativeToolBlockGuidance(toolGate);
        writeAgentSse("agent_warning", { type: toolGate.code, warning: guidance });
        for (const tc of toolCalls) {
          writeAgentSse("agent_tool_call", {
            id: tc.id,
            name: tc.name,
            arguments: tc.arguments
          });
          writeAgentSse("agent_tool_result", {
            id: tc.id,
            name: tc.name,
            content: toolGate.code,
            isError: true,
            guarded: true
          });
          fullMessages.push({
            role: "tool",
            tool_call_id: tc.id,
            content: `${toolGate.code}\n${guidance}`
          });
          agentSession.reminder.toolTokensSince += estimateTextTokens(`${toolGate.code}\n${guidance}`);
        }
        continue;
      }

      const sageBlock = sageToolBlockDecision(toolCalls);
      if (!sageBlock.allowed) {
        writeAgentSse("agent_warning", {
          type: sageBlock.code,
          warning: sageBlock.message
        });
        for (const tc of toolCalls) {
          const hiddenByDefault = tc.name === "sage";
          writeAgentSse("agent_tool_call", {
            id: tc.id,
            name: tc.name,
            arguments: tc.arguments,
            hiddenByDefault
          });
          writeAgentSse("agent_tool_result", {
            id: tc.id,
            name: tc.name,
            content: sageBlock.code,
            isError: true,
            guarded: true,
            hiddenByDefault
          });
          fullMessages.push({
            role: "tool",
            tool_call_id: tc.id,
            content: sageBlock.code
          });
          agentSession.reminder.toolTokensSince += estimateTextTokens(sageBlock.code);
        }
        continue;
      }

      // Execute tool calls.  Group consecutive read-only tools (read, list,
      // search) so they can run in parallel; bash/write/edit stay serial to
      // avoid races against the workspace.
      const SAFE_PARALLEL = new Set(["read", "list", "search"]);
      const groups = [];
      {
        let batch = [];
        for (const tc of toolCalls) {
          if (SAFE_PARALLEL.has(tc.name)) {
            batch.push(tc);
          } else {
            if (batch.length) { groups.push(batch); batch = []; }
            groups.push([tc]);
          }
        }
        if (batch.length) groups.push(batch);
      }

      agentSession.readGuard.beginTurn();

      const runToolCall = async (tc) => {
        const isSage = tc.name === "sage";
        const compactSage = isSage && authoritativeSageChat &&
          String(tc.arguments?.output_mode || "auto").toLowerCase() !== "legacy";
        const sagePhase = normalizeSagePhase(tc.arguments?.phase);
        let sageSnapshot = null;
        const sageCodeSha256 = typeof tc.arguments?.code === "string"
          ? sha256Hex(tc.arguments.code)
          : null;

        if (compactSage) {
          if (!sageEntry) {
            const registered = sageRunRegistry.getOrCreate({
              sessionId: sessionKey,
              runId: crypto.randomUUID(),
              taskType: tc.arguments?.task_type
            });
            if (!registered.ok) {
              return {
                id: tc.id,
                name: tc.name,
                content: registered.code,
                displayContent: "Troppe esecuzioni SageMath attive.",
                isError: true,
                guarded: true,
                hiddenByDefault: true,
                phase: sagePhase,
                validated: false
              };
            }
            // The registry already called begin() for this run.
            sageEntry = registered.entry;
            sageTracker = sageEntry.tracker;
          }
          const snapshotBeforeCall = sageTracker.snapshot();
          const callState = sageTracker.beforeCall({
            phase: sagePhase,
            candidateRevision: Number(tc.arguments?.candidate_revision) || undefined,
            codeSha256: sageCodeSha256 ?? undefined
          });
          sageSnapshot = sageTracker.snapshot();
          if (!callState.allowed) {
            emitSageTransition(snapshotBeforeCall, sageSnapshot, callState.code);
            sageMetrics.recordOrchestration(
              callState.code === "SAGE_CANDIDATE_UNCHANGED"
                ? "sage_candidate_unchanged_rejected_total"
                : "sage_phase_rejected_total"
            );
          }
          writeSageStatus({
            callId: tc.id,
            phase: sagePhase,
            state: sagePhaseState(sagePhase),
            status: callState.allowed ? "running" : "error",
            attempt: sageSnapshot.attempt,
            executeCount: sageSnapshot.executeCount,
            repairCount: sageSnapshot.repairCount,
            validationCount: sageSnapshot.validationCount,
            plotCount: sageSnapshot.plotCount,
            summary: callState.allowed
              ? "Esecuzione SageMath in corso."
              : "Budget della fase SageMath esaurito."
          });
          writeAgentSse("agent_tool_call", {
            id: tc.id,
            name: tc.name,
            arguments: tc.arguments,
            hiddenByDefault: true
          });
          if (!callState.allowed) {
            // §15.3: a refused call is answered with the phase the runtime
            // demands, not with a dead end. A wrong phase or an unchanged
            // candidate is repairable and must say so; only a terminal run gets
            // the NOT_PUBLISHABLE notice.
            const guidance = sageTracker.isTerminal()
              ? sageTracker.terminalNotice()
              : sageTracker.continuationInstruction();
            return {
              id: tc.id,
              name: tc.name,
              content: `${callState.code}\n${guidance}`,
              displayContent: sageTracker.isTerminal()
                ? "Flusso SageMath terminato senza risultato pubblicabile."
                : "Fase SageMath rifiutata; il runtime indica quella corretta.",
              isError: true,
              guarded: true,
              hiddenByDefault: true,
              runId: sageSnapshot.runId,
              taskType: sageSnapshot.taskType,
              phase: sagePhase,
              requiredNextPhase: callState.requiredNextPhase ?? sageSnapshot.requiredNextPhase,
              validated: false
            };
          }
        } else {
          writeAgentSse("agent_tool_call", {
            id: tc.id,
            name: tc.name,
            arguments: tc.arguments
          });
        }

        // WP10: a finalize vouches for the evidence as it stood; any tool
        // other than evidence_guard action=status voids it (C
        // agent_worker_evidence_note_tool, shadow ds4_agent.c:18775-18786).
        if (evidenceActive) {
          evidenceNoteToolCall(
            agentSession.evidenceState,
            agentSession.evidenceTurn,
            tc.name === "evidence_guard" && tc.arguments?.action === "status"
          );
        }
        if (tc.name === "evidence_guard") {
          // The ledger is the only thing this tool touches (C dispatch at
          // shadow ds4_agent.c:18793, before every other tool).
          const content = evidenceGuardTool(
            agentSession.evidenceState,
            agentSession.evidenceTurn,
            { ...(tc.arguments ?? {}) },
            {
              skillLoaded: evidenceActive,
              mode: evidenceMode,
              policyRevision: skillState?.entries?.get?.(EVIDENCE_SKILL_NAME)?.revision ?? ""
            }
          );
          return { id: tc.id, name: tc.name, content, isError: false };
        }

        const policyDecision = checkPostGitnexusAnalyzeAction({
          tool: tc.name,
          target: tc.arguments?.path || "",
          args: tc.arguments
        }, policyState);
        if (policyDecision?.block) {
          return {
            id: tc.id,
            name: tc.name,
            content: `[${policyDecision.type}]\n${policyDecision.reason}\n${policyDecision.guidance}`,
            isError: true,
            guarded: true
          };
        }

        // Read-guard: short-circuit duplicate/covered reads with a synthetic
        // tool result so the model receives clear guidance instead of the
        // same content twice.
        if (tc.name === "read") {
          const decision = agentSession.readGuard.checkRead(tc.arguments, AGENT_READ_GUARD_MODE);
          if (decision?.block) {
            // Progress-guidance blocks (read-batch budget spent) are not errors:
            // they ask the model to synthesize. Surface as a normal tool result
            // so the native loop guard does not count it as an empty result.
            if (decision.progressGuidance) {
              return { id: tc.id, name: tc.name, content: `[${decision.type}]\n${decision.guidance}`, isError: false, guarded: true };
            }
            return { id: tc.id, name: tc.name, content: decision.reason, isError: true, guarded: true };
          }
        }

        // Bash guard: refuse bash commands that bypass the read tool to
        // dump file contents (cat/head/tail/sed/awk, find -exec, xargs).
        if (tc.name === "bash") {
          const leanBlock = checkBashLeanGuard(tc.arguments);
          if (leanBlock?.block) {
            return { id: tc.id, name: tc.name, content: leanBlock.reason, isError: true, guarded: true };
          }
          const decision = checkBashFileReadFallback(
            tc.arguments,
            agentSession.readGuard.hasBlockedReadsThisTurn()
          );
          if (decision?.block) {
            return { id: tc.id, name: tc.name, content: decision.reason, isError: true, guarded: true };
          }
        }

        // Loop guard: block repeated identical actions (same tool+target+args).
        if (!compactSage) {
          const decision = agentSession.loopGuard.checkAction({
            tool: tc.name,
            target: tc.arguments?.path || tc.arguments?.query || tc.arguments?.command || tc.arguments?.url || "",
            args: tc.arguments
          });
          if (decision?.block) {
            return { id: tc.id, name: tc.name, content: `${decision.reason}\n${decision.guidance}`, isError: true, guarded: true };
          }
        }

        // Lean attempt gate: budget, wall clock and unchanged-source refusal all
        // happen before the sandbox is spawned. A refused attempt returns a
        // contract-shaped result so the model reads a decision, not an excuse.
        let leanSourceSha256 = null;
        const leanTaskMode = (args) =>
          args?.task_mode === "proof" ? "proof" : "utility";
        const isLeanProofCall =
          tc.name === "lean_check" && leanTaskMode(tc.arguments) === "proof";

        if (isLeanProofCall) {
          const targetDeclaration = tc.arguments?.target_declaration;
          const profile = tc.arguments?.profile || "core";
          // §11.2 — the target may not be derived from the first lean_check.
          // Sealing here, before the tracker starts and before Lean is spawned,
          // is what stops `theorem cauchy_mvt : True := by trivial` from
          // locking itself as the task and then matching itself.
          if (!leanTaskSpec) {
            const sealed = createLeanTaskSpec({
              targetDeclaration,
              targetStatement: tc.arguments?.target_statement,
              requiredProfile: profile,
              expectedDeclarations: tc.arguments?.expected_declarations,
              taskMode: "proof"
            });
            if (!sealed.ok) {
              writeLeanStatus({ callId: tc.id, status: "blocked" });
              return {
                id: tc.id,
                name: tc.name,
                content:
                  `LEAN_ORCHESTRATION\ncode=${sealed.error.code}\n` +
                  `attemptConsumed=false\n${sealed.error.message}`,
                isError: true,
                guarded: true
              };
            }
            leanTaskSpec = sealed.value;
          }
          leanTracker.begin({ targetDeclaration, profile, taskSpec: leanTaskSpec });
          leanSourceSha256 = sha256Hex(tc.arguments?.code ?? "");
          const decision = leanTracker.beforeAttempt({
            sourceSha256: leanSourceSha256,
            code: tc.arguments?.code ?? "",
            targetDeclaration,
            profile,
          });
          writeLeanStatus({ callId: tc.id, status: decision.allowed ? "running" : "blocked" });
          if (!decision.allowed) {
            if (decision.code === "LEAN_SOURCE_UNCHANGED_AFTER_FAILURE") {
              leanMetrics.recordOrchestration?.("proof_same_source_rejected_total");
            }
            return {
              id: tc.id,
              name: tc.name,
              content:
                `LEAN_ORCHESTRATION\nstate=${decision.state}\n` +
                `attempt=${decision.attempt}/${decision.maxAttempts}\n` +
                `code=${decision.code}\nFINALIZATION_ALLOWED=${leanTracker.canFinalize()}\n` +
                decision.reason,
              isError: true,
              guarded: true
            };
          }
        } else if (tc.name === "lean_check") {
          // Utility mode: no tracker ownership, no proof lifecycle.
          // The check runs immediately without budget or strategy tracking.
          leanSourceSha256 = sha256Hex(tc.arguments?.code ?? "");
        }

        // R5: the lean_check tool call carries the policy revision that is
        // actually available, so the contract's optional policyRevision is set
        // explicitly in the JS path instead of being implicit.
        const leanCheckPolicyRevision = (await leanRuntimeState.get()).policy.availableRevision;
        const opts = {
          signal: controller.signal,
          crawlBaseUrl: tc.name === "crawl" ? crawlBase() : undefined,
          crawlToken: tc.name === "crawl" ? await readCrawlToken() : undefined,
          researchService: tc.name === "research_discover" ? agentResearchService : undefined,
          history: tc.name === "chat_history_search" ? fullMessages : undefined,
          onProgress: tc.name === "bash"
            ? (chunk) => writeAgentSse("agent_tool_progress", { id: tc.id, name: tc.name, chunk })
            : undefined,
          sageCallLog: tc.name === "sage" ? sageCallLog : undefined,
          toolBlobStore: tc.name === "sage" || tc.name === "retrieve_context_blob"
            ? toolBlobStore
            : undefined,
          // Keep sage-generated files (.sage.py, plots, …) out of the project
          // tree: run sage in a per-session dir under the workspace that holds
          // history/sessions.
          sageWorkdir: compactSage
            ? sageRunDir(fileWorkspace.root, sageSnapshot.runId)
            : tc.name === "sage"
              ? sageSessionDir(fileWorkspace.root, sessionKey)
              : undefined,
          sageAttempt: compactSage ? sageSnapshot.attempt : undefined,
          runId: compactSage ? sageSnapshot.runId : undefined,
          phase: compactSage ? sagePhase : undefined,
          policyRevision: tc.name === "sage" ? sageState.policyRevision : undefined,
          leanPolicyRevision: tc.name === "lean_check" ? leanCheckPolicyRevision : undefined,
          leanExecutor: tc.name === "lean_check" ? runLeanCheckForAgent : undefined,
          leanAttempt: isLeanProofCall ? leanTracker.snapshot().attempt : undefined,
          leanProofId: isLeanProofCall ? leanTracker.snapshot().proofId : undefined,
          leanExpectedTargetStatementSha256:
            isLeanProofCall ? leanTracker.snapshot().targetStatementSha256 : undefined,
          // The classifier needs the previous failure to tell "failed again the
          // same way" from "failed differently". For utility calls there is no
          // tracker state and no escalation context.
          leanOrchestrationContext:
            isLeanProofCall
              ? {
                  previousFingerprint: leanTracker.lastFingerprint,
                  sameFailureCount: leanTracker.sameFailureCount,
                  strategyChangeAfter: leanTracker.config.strategyChangeAfter,
                  // Read from the tracker, never summed from timeouts.
                  elapsedWallClockMs: leanTracker.elapsedWallClockMs(),
                  maxWallClockMs: leanTracker.config.maxWallClockMs,
                  remainingWallClockMs: leanTracker.remainingWallClockMs()
                }
              : undefined,
          sessionKey,
          // Per-turn tool scope: when set, only listed tools may dispatch.
          allowedTools: runAllowedTools ?? undefined,
          // §8 — once a Lean task is running, the repository is read-only: the
          // proof candidate belongs in lean_check(code=...), not in a scratch
          // file. The regression left four my_*.lean fixtures behind, one of
          // them carrying `sorry`.
          leanRepositoryMutationBlocked: leanTracker.used,
          // WP11: `more` continues the last truncated read (C more_path state).
          moreState: agentSession.more,
        };
        const rawResult = await executeTool(tc.name, tc.arguments, opts);
        if (tc.name === "retrieve_context_blob") {
          compressionMetrics.recordRetrieve(!rawResult?.isError);
        }
        recordGitnexusAnalyzeResult(
          { tool: tc.name, args: tc.arguments },
          rawResult,
          policyState
        );

        if (isLeanProofCall) {
          // The decision is recomputed from the result itself, so a bridge that
          // ever skipped finalizeLeanResult still lands in the right state.
          const snapshot = leanTracker.recordResult(rawResult?.raw ?? rawResult);
          writeLeanStatus({
            callId: tc.id,
            status: snapshot.verified ? "verified" : snapshot.terminal ? "terminal" : "repair_required",
            summary: snapshot.verified
              ? "Prova verificata: status=checked."
              : snapshot.nextAction || "Correzione autonoma in corso."
          });
        } else if (tc.name === "lean_check") {
          // Utility check: no tracker ownership and no proof lifecycle. A
          // checked utility result is diagnostic evidence only — it must not
          // create a proofId, mutate the budget, or arm the authoritative
          // finalization gate.
        }
        // Recorded for every call, including the failures the text blob below
        // skips. A tool that ran and failed is evidence — it is what separates
        // "the tests failed" from "the tests were never run", and the legacy
        // array cannot express either.
        // Through the turn, not straight onto its evidence: the turn's wrapper
        // is what records the lean_check assumption/scope audit (§30/§35/§48).
        // Recording on epistemicEvidence bypassed it and left leanAudits empty
        // for every production turn.
        epistemicTurn.addToolResult({
          callId: tc.id,
          toolName: tc.name,
          arguments: tc.arguments || {},
          rawResult
        });
        if (!rawResult?.isError) {
          const evidenceArgs = compactSage
            ? { task_type: sageSnapshot.taskType, phase: sagePhase }
            : tc.arguments || {};
          const evidenceContent = compactSage
            ? rawResult?.sageResult?.display?.summary || rawResult?.displayContent || "SageMath completed."
            : rawResult?.content || "";
          turnEvidence.push([
            `tool: ${tc.name}`,
            `arguments: ${JSON.stringify(evidenceArgs)}`,
            String(evidenceContent).slice(0, 4000)
          ].join("\n"));
        }

        // Loop guard: stop if repeated steps yield no new observation.
        const progress = compactSage ? null : agentSession.loopGuard.recordProgress("tool-result", {
            tool: tc.name,
            target: tc.arguments?.path || tc.arguments?.query || tc.arguments?.command || tc.arguments?.url || "",
            content: String(rawResult.content || "")
          });
        if (progress?.block) {
          // ContextWiki (§2): record the loop-guard trip in the ledger (gated).
          if (contextConfig.enabled || contextConfig.previewOnly) {
            appendContextEvent(sessionKey, {
              type: "loop_guard",
              source: tc.name,
              target: tc.arguments?.path || tc.arguments?.query || tc.arguments?.command || tc.arguments?.url || null,
              summary: String(progress.reason || "loop guard blocked"),
              meta: { guarded: true }
            }, { maxEvents: contextConfig.maxLedgerEvents }).catch(() => {});
          }
          return { id: tc.id, name: tc.name, content: `${progress.reason}\n${progress.guidance}`, isError: true, guarded: true };
        }

        if (tc.name === "read" && !rawResult.isError) {
          agentSession.readGuard.rememberRead(tc.arguments, rawResult.raw, rawResult.content);
        } else if ((tc.name === "write" || tc.name === "edit") && !rawResult.isError) {
          agentSession.readGuard.invalidatePath(tc.arguments?.path);
        }

        let result = rawResult;
        const guardResult = rawResult?.guarded ||
          /^\[(READ_BATCH_SUMMARY_REQUIRED|DOC_READ_SUMMARY_REQUIRED|RAW_DOC_CONTEXT_SUMMARY_REQUIRED)\]/.test(
            String(rawResult?.content || "")
          );
        if (!rawResult?.isError && !guardResult && !rawResult?.sageResult) {
          result = await compressAgentToolResult(tc.name, rawResult);
          if (result.compressed) {
            agentSession.loopGuard.recordCompressedObservation();
            writeAgentDebug("compressed", {
              tool: tc.name,
              blobId: result.compression?.blobId,
              originalBytes: result.compression?.originalBytes,
              compressedBytes: result.compression?.compressedBytes
            });
          }
        }

        // ContextWiki (§10): capture synthetic evidence + a ledger event from the
        // compressed result. Best-effort, never blocks or breaks the tool flow.
        recordToolContext({
          sessionKey,
          tool: tc.name,
          args: tc.arguments,
          rawResult,
          compressed: result,
          config: contextConfig,
          workspace: fileWorkspace.root
        }).catch(() => {});

        if (compactSage) {
          const artifactKinds = sageArtifactKinds(rawResult);
          // Canonical form: the tracker classifies the runtime's own evidence,
          // exactly as POST /api/sage/exec does. A flat summary would lose the
          // execution/validation detail the failure classifier needs.
          const snapshotBeforeResult = sageTracker.snapshot();
          sageSnapshot = sageTracker.recordResult({
            phase: sagePhase,
            result: rawResult,
            artifactKinds,
            artifactCount: rawResult?.artifacts?.length || 0
          });
          emitSageTransition(snapshotBeforeResult, sageSnapshot, `PHASE_${sagePhase}`.toUpperCase());
          sageRunRegistry.update(sageEntry, {
            candidate: (sagePhase === "compute" || sagePhase === "repair") && sageCodeSha256
              ? { codeSha256: sageCodeSha256 }
              : undefined,
            validation: sagePhase === "validate"
              ? rawResult?.sageResult?.validation ?? null
              : undefined,
            finalResult: sageTracker.canFinalize() ? rawResult : undefined
          });
          const finalCandidate = authoritativeSageFinalFromResult(rawResult);
          if (finalCandidate && sageTracker.canFinalize()) {
            authoritativeSageFinal = finalCandidate;
          }
          writeSageStatus({
            callId: tc.id,
            phase: sagePhase,
            state: sageSnapshot.state,
            status: result.isError ? "error" : "done",
            attempt: sageSnapshot.attempt,
            executeCount: sageSnapshot.executeCount,
            repairCount: sageSnapshot.repairCount,
            validationCount: sageSnapshot.validationCount,
            plotCount: sageSnapshot.plotCount,
            artifactCount: sageSnapshot.artifactCount,
            validationPassed: rawResult?.validationPassed === true,
            debugAvailable: Boolean(rawResult?.debug),
            summary: rawResult?.displayContent ||
              (result.isError ? "Esecuzione SageMath non completata." : "Esecuzione SageMath completata.")
          });
          for (const artifact of rawResult?.artifacts || []) {
            writeAgentSse("agent_sage_artifact", {
              runId: sageSnapshot.runId,
              callId: tc.id,
              taskType: sageSnapshot.taskType,
              phase: sagePhase,
              artifact
            });
          }
          const validated = sagePhase === "validate" &&
            rawResult?.authoritative === true &&
            rawResult?.validationPassed === true && !result.isError;
          if (authoritativeSageFinal) {
            writeSageStatus({
              callId: tc.id,
              phase: sagePhase,
              state: "composing",
              status: "running",
              attempt: sageSnapshot.attempt,
              summary: "Preparazione della risposta finale."
            });
          }

          return {
            id: tc.id,
            name: tc.name,
            // §15.3: every non-final Sage result carries the phase the runtime
            // demands next, so the model does not have to guess it — and a
            // terminal run carries the NOT_PUBLISHABLE notice instead.
            content: authoritativeSageFinal
              ? "SAGE_AUTHORITATIVE_RESULT_READY"
              : [
                  String(result.content ?? ""),
                  sageTracker.isTerminal()
                    ? sageTracker.terminalNotice()
                    : sageTracker.continuationInstruction()
                ].filter(Boolean).join("\n\n"),
            displayContent: rawResult?.displayContent || "SageMath completato.",
            isError: result.isError,
            sageResult: rawResult?.sageResult,
            artifacts: rawResult?.artifacts || [],
            hiddenByDefault: true,
            runId: sageSnapshot.runId,
            taskType: sageSnapshot.taskType,
            phase: sagePhase,
            validated
          };
        }

        return { id: tc.id, name: tc.name, content: result.content, isError: result.isError };
      };

      for (const group of groups) {
        if (controller.signal.aborted) break;
        const results = group.length === 1
          ? [await runToolCall(group[0])]
          : await Promise.all(group.map(runToolCall));

        for (const r of results) {
          if (r.name === "sage" && r.hiddenByDefault) {
            writeAgentSse("agent_tool_result", {
              id: r.id,
              name: r.name,
              content: r.displayContent,
              isError: r.isError,
              guarded: Boolean(r.guarded),
              hiddenByDefault: true,
              sage: {
                contractVersion: r.sageResult?.contractVersion,
                runId: r.runId,
                taskType: r.taskType,
                phase: r.phase,
                status: r.sageResult?.status,
                validationPassed: r.sageResult?.validation?.passed === true
              }
            });
          } else {
            writeAgentSse("agent_tool_result", {
              id: r.id,
              name: r.name,
              content: r.content,
              isError: r.isError,
              guarded: Boolean(r.guarded)
            });
          }
          fullMessages.push({
            role: "tool",
            tool_call_id: r.id,
            content: r.content
          });
          agentSession.reminder.toolTokensSince += estimateTextTokens(r.content);
        }

        if (authoritativeSageFinal && sageTracker.canFinalize()) {
          const content = authoritativeSageFinal.content;
          writeAgentSse("agent_text", {
            content,
            authoritative: true,
            runId: authoritativeSageFinal.runId
          });
          const finalMessage = {
            role: "assistant",
            content,
            sageAuthoritative: true,
            sageRunId: authoritativeSageFinal.runId
          };
          agentSession.commit(canonicalSageCommitPending(modeChoice.pending), finalMessage);
          fullMessages = agentSession.messages();
          finalizeSageStatus("completed", "Report SageMath validato.");
          writeAgentSse("agent_done", {
            iterations: iteration,
            finish_reason: "sage_authoritative",
            totals: agentSession.usageTotals
          });
          sageAuthoritativePublished = true;
          break;
        }
      }
      if (sageAuthoritativePublished) break;
    }

    if (iterationLimitHit && !sageAuthoritativePublished) {
      finalizeSageStatus(
        "failed",
        "SageMath arrestato al limite massimo di iterazioni.",
        "SAGE_MAX_ITERATIONS"
      );
      writeAgentSse("agent_error", { error: `Agent reached maximum iterations (${AGENT_MAX_ITERATIONS})` });
    }
  } catch (err) {
    // The stream is still open here (the transport ends it after the
    // outcome), so the error is always reported, as the route did.
    finalizeSageStatus("failed", "Flusso SageMath interrotto da un errore.", "SAGE_AGENT_ERROR");
    writeAgentSse("agent_error", { error: err.message || String(err) });
  } finally {
    signal.removeEventListener("abort", abort);
    // A run left mid-flight (abort, error, iteration cap) stays non-terminal in
    // the registry, and the registry only evicts terminal entries: without this
    // the 64 slots fill with runs nobody will ever finish.
    if (sageEntry && !sageTracker.isTerminal()) sageTracker.markCancelled("SAGE_TURN_ENDED");
  }
  return { kind: AGENT_RUN_OUTCOME.STREAMED };
}

// WP1: the one AgentRunService of this server; the legacy route below and
// the future AG-UI gateway both run turns through it.
//
// WP2: after a cancelled or timed-out turn the lease is released only once
// the runtime is shown idle.  With the wrapper that is /api/wrapper/status
// (busy:false, not switching); a plain OpenAI-compatible backend has no idle
// probe and stops on disconnect of the aborted fetch, which has returned.
const RUNTIME_STOP_CONFIRM_MS = 5000;

async function wrapperIdle() {
  try {
    const response = await fetch(`${backendBase()}/api/wrapper/status`, { signal: AbortSignal.timeout(1000) });
    if (!response.ok) return false;
    const status = await response.json();
    return status.busy !== true && status.state !== "busy" && status.state !== "switching";
  } catch {
    return false;
  }
}

async function confirmAgentRuntimeStopped() {
  if (!wrapperEnabled()) return true;
  const deadline = Date.now() + RUNTIME_STOP_CONFIRM_MS;
  for (;;) {
    if (await wrapperIdle()) return true;
    if (Date.now() >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

// A run left in recovery keeps the lease; it is released as soon as the
// wrapper reports idle again.
const recoveryProbe = setInterval(async () => {
  const run = agentAdmission.snapshot();
  if (run?.state !== "interrupted_recovery") return;
  if (await wrapperIdle()) agentAdmission.resolveRecovery(agentAdmission.activeIdentity());
}, 2000);
recoveryProbe.unref?.();

const agentRunService = createAgentRunService({
  resolveEngine: agentEngine,
  runJsTurn: runJsAgentTurn,
  runNativeTurn: runNativeAgentTurn,
  admission: agentAdmission,
  confirmRuntimeStopped: confirmAgentRuntimeStopped
});

// Legacy route identity, built server-side: owner from the signed cookie,
// opaque thread derived from the legacy session key (the legacy contract
// keeps client-chosen keys, but never in the server-owned namespace), and an
// optional X-DS4-Run-Id idempotency key.  Without it each POST is a new run,
// as before WP2.
function legacyAgentAdmissionIdentity(req, res) {
  agentIdentity.requireOrigin(req);
  const ownerId = agentIdentity.ownerOf(req, res);
  const sessionKey = agentSessionKey(req);
  if (sessionKey.startsWith(SERVER_SESSION_PREFIX)) {
    throw new AgentAdmissionError("SESSION_KEY_RESERVED", "session keys with this prefix are server-owned", 403);
  }
  const clientRunId = req.get("X-DS4-Run-Id");
  const runId = clientRunId ? opaqueId(clientRunId, "X-DS4-Run-Id") : crypto.randomUUID();
  return {
    ownerId,
    threadId: agentIdentity.derive("legacy", sessionKey),
    runId,
    requestHash: hashRequest({ sessionKey, debug: req.get("X-Agent-Debug") === "1", body: req.body ?? null }),
    retainEvents: Boolean(clientRunId)
  };
}

app.post("/api/agent/chat", asyncHandler(createLegacyAgentChatHandler({
  service: agentRunService,
  sessionKeyOf: agentSessionKey,
  writeCommandSse: writeAgentCommandSse,
  abortOnClientDisconnect,
  keepaliveMs: AGENT_SSE_KEEPALIVE_MS,
  admissionIdentityOf: legacyAgentAdmissionIdentity
})));

// WP2: server-owned threads and the identified-run contract the AG-UI
// gateway (WP3) mounts.  Only the owner-scoped run endpoints are exposed now.
const agentThreadStore = localThreadStorage?.store ?? createThreadStore({
  startSession: (ds4SessionKey) => agentSessions.start(ds4SessionKey)
});
const agentRunIngress = createRunIngress({
  admission: agentAdmission,
  store: agentThreadStore,
  service: agentRunService,
  freezeProfile: () => ({ engine: agentEngine(), model: activeRequestDefaults.model ?? null }),
  resolveEngine: agentEngine,
  checkpointSession: localThreadStorage ? ({ ownerId, threadId, sessionKey, frozen }) => {
    if (localThreadStorage.store.sessionKeyOf(ownerId, threadId) !== sessionKey) {
      throw new AgentAdmissionError("THREAD_SESSION_BINDING_MISMATCH", "thread runtime binding does not match its server session", 409);
    }
    const checkpoint = agentSessions.checkpoint(sessionKey);
    if (!checkpoint) return;
    localThreadStorage.store.saveCheckpoint(ownerId, threadId, {
      engine: frozen.engine,
      profile: { model: frozen.model ?? null },
      checkpoint
    });
  } : null
});
const agentRunRoutes = createRunRoutes({ ingress: agentRunIngress, identity: agentIdentity });
app.get("/api/runs/:runId", agentRunRoutes.status);
app.post("/api/runs/:runId/cancel", agentRunRoutes.cancel);

// WP3: optional AG-UI transport over the same identified ingress and loop.
// It stays disabled by default; an unavailable SDK never affects legacy chat.
let aguiSdk = null;
let aguiSdkError = null;
if (aguiFlags.aguiEnabled) {
  try { aguiSdk = await loadAguiSdk(); }
  catch (error) {
    aguiSdkError = error;
    console.warn(`ds4-ui: AG-UI POC unavailable: ${error.message}`);
  }
}
mountAguiRoutes(app, createAguiGateway({
  flags: aguiFlags,
  sdk: aguiSdk,
  sdkError: aguiSdkError,
  ingress: agentRunIngress,
  store: agentThreadStore,
  identity: agentIdentity,
  recorder: createAguiRecorder(),
  engine: agentEngine
}));

// --- Wrapper / native-agent passthrough (only meaningful when wrapper backend is on) ---
app.get("/api/wrapper/status", asyncHandler(async (_req, res) => {
  if (!wrapperEnabled()) return res.status(400).json({ error: "wrapper is not enabled" });
  const up = await fetch(`${backendBase()}/api/wrapper/status`, { signal: AbortSignal.timeout(5000) });
  res.status(up.status).json(await up.json());
}));

app.post("/api/wrapper/switch-mode", asyncHandler(async (req, res) => {
  if (!wrapperEnabled()) return res.status(400).json({ error: "wrapper is not enabled" });
  const up = await fetch(`${backendBase()}/api/wrapper/switch-mode`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req.body || {}),
    signal: AbortSignal.timeout(config.wrapper?.modeSwitchTimeoutMs || 120000)
  });
  res.status(up.status).json(await up.json());
}));

app.post("/api/native-agent/command", asyncHandler(async (req, res) => {
  const command = typeof req.body?.command === "string" ? req.body.command.trim() : "";
  if (!command) return res.status(400).json({ error: "command is required" });
  const ponyCommand = ponyCommandFromText(command);
  if (ponyCommand) {
    const result = ponyCommandPayload(req, ponyCommand);
    return res.status(result.status).json(result.payload);
  }
  const crawlOptions = {};
  if (/^\/crawl(?:\s|$)/i.test(command)) {
    crawlOptions.crawlToken = await readCrawlToken();
    crawlOptions.crawlBaseUrl = crawlBase();
  }
  // WP5 fallback (gap.js.md GAP-001): without the wrapper there is no C
  // agent, but the JS loop speaks the same slash contract
  // (agentSlashCommands.mjs).  Serve the commands its parser recognizes
  // locally; anything else falls through to the wrapper guard below.
  if (!wrapperEnabled() && isAgentSlashCommand(command) && parseAgentSlashCommand(command)) {
    const sessionKey = agentSessionKey(req);
    const commandResult = handleAgentSlashCommand({
      message: command,
      session: agentSessions.get(sessionKey),
      skillState: agentSkillStateFor(sessionKey),
      env: process.env
    });
    syncSageStateFromNativeCommand(command, commandResult.payload);
    if (commandResult.payload.active === false) {
      agentSessions.stop(sessionKey);
    }
    return res
      .status(commandResult.status || (commandResult.ok ? 200 : 400))
      .json(commandResult.payload);
  }
  if (!wrapperEnabled() && !crawlOptions.crawlBaseUrl) {
    return res.status(400).json({ error: "wrapper is not enabled" });
  }
  const result = await proxyNativeAgentCommand(
    fetch,
    backendBase(),
    command,
    AbortSignal.timeout(5 * 60 * 1000),
    crawlOptions
  );
  syncSageStateFromNativeCommand(command, result.payload);
  if (result.payload.active === false) {
    agentSessions.stop(agentSessionKey(req));
  }
  res.status(result.status).json(result.payload);
}));

// Legacy native-agent routes delegate to the common command dispatcher.
app.all("/api/native-agent/:cmd", asyncHandler(async (req, res) => {
  if (!wrapperEnabled()) return res.status(400).json({ error: "wrapper is not enabled" });
  const cmd = String(req.params.cmd || "").toLowerCase();
  const command = canonicalLegacyCommand(cmd, req.body);
  if (!command) {
    return res.status(404).json({ error: `unknown or invalid native-agent command: ${cmd}` });
  }
  const result = await proxyNativeAgentCommand(
    fetch,
    backendBase(),
    command,
    AbortSignal.timeout(5 * 60 * 1000)
  );
  if (!result.ok) return res.status(result.status).json(result.payload);
  if (cmd === "list") return res.status(result.status).json(result.payload.data || []);
  if (cmd === "save") {
    return res.status(result.status).json({ ok: true, ...(result.payload.data || {}) });
  }
  res.status(result.status).json({ ok: true });
}));

// ---------------------------------------------------------------------------
// DS4 Evolution Endpoints
// ---------------------------------------------------------------------------

const evolutionStateDir = path.isAbsolute(config.evolution.stateDir)
  ? config.evolution.stateDir
  : path.join(PROJECT_ROOT, config.evolution.stateDir);
const evolutionWorkDir = path.isAbsolute(config.evolution.workDir)
  ? config.evolution.workDir
  : path.join(PROJECT_ROOT, config.evolution.workDir);
const evolutionRunStore = new EvolutionRunStore({ rootDir: evolutionStateDir });
const evolutionWorkspace = new EvolutionWorkspaceManager({ repositoryRoot: PROJECT_ROOT, workRoot: evolutionWorkDir });
const evolutionExecutor = new EvolutionExecutor({ runStore: evolutionRunStore });
const evolutionEvaluators = new EvolutionEvaluatorRegistry({ executor: evolutionExecutor });
const evolutionPromotion = new EvolutionPromotionService({ repositoryRoot: PROJECT_ROOT, runStore: evolutionRunStore });
const evolutionStructuredClient = new StructuredModelClient({
  baseUrl: config.evolution.modelBaseUrl,
  model: config.evolution.model,
  timeoutMs: config.evolution.modelTimeoutMs,
  errorPrefix: "evolution model"
});
// WP2: evolution model calls (default base: the local runtime) take the
// shared lease one call at a time; busy surfaces as a model-call failure.
const evolutionModelClient = new EvolutionModelClient({
  client: new Proxy(evolutionStructuredClient, {
    get(target, property) {
      const value = Reflect.get(target, property, target);
      if (property !== "completeRole" || typeof value !== "function") return typeof value === "function" ? value.bind(target) : value;
      return async (...args) => (await agentAdmission.exclusive("evolution-model", () => value.apply(target, args), {
        ownerId: "evolution"
      })).value;
    }
  })
});
const evolutionPostApplySmoke = createEvolutionSmokeEvaluator({ repositoryRoot: PROJECT_ROOT });
const evolutionProposer = new EvolutionProposer({
  modelClient: evolutionModelClient,
  sourceContext: new EvolutionSourceContext({ repositoryRoot: PROJECT_ROOT })
});
const evolutionOrchestrator = new EvolutionOrchestrator({
  runStore: evolutionRunStore,
  workspaceManager: evolutionWorkspace,
  candidateBuilder: new EvolutionCandidateBuilder(),
  executor: evolutionExecutor,
  evaluatorRegistry: evolutionEvaluators,
  promotionService: evolutionPromotion,
  critic: new EvolutionCritic({ modelClient: evolutionModelClient }),
  smokeEvaluator: async () => {
    const validation = validateConfig(config);
    return validation.ok ? evolutionPostApplySmoke() : { passed: false, reasonCode: "CONFIG_INVALID" };
  }
});
const evolutionFeedbackContext = new EvolutionFeedbackContextBuilder({
  runStore: evolutionRunStore,
  maxBytes: config.evolution.maxFeedbackContextBytes
});
const evolutionRuntime = new EvolutionRuntime({
  orchestrator: evolutionOrchestrator,
  loopController: new EvolutionLoopController({
    orchestrator: evolutionOrchestrator,
    proposer: evolutionProposer,
    feedbackContextBuilder: evolutionFeedbackContext
  })
});
app.use("/api/evolution", createEvolutionRouter({
  runtime: evolutionRuntime,
  runStore: evolutionRunStore,
  auth: new EvolutionAuth({ tokenEnv: config.evolution.writeTokenEnv }),
  views: new EvolutionViews({ runStore: evolutionRunStore, maxArtifactBytes: config.evolution.maxArtifactReadBytes }),
  repositoryRoot: PROJECT_ROOT,
  enabled: config.evolution.enabled,
  maxLevel: config.evolution.maxLevel
}));

// ---------------------------------------------------------------------------
// Lean 4 Endpoints
// ---------------------------------------------------------------------------

const leanRunRegistry = new LeanRunRegistry({
  maxGlobalRuns: runtimeConfig.lean.maxGlobalRuns,
  maxRunsPerSession: runtimeConfig.lean.maxRunsPerSession,
  maxQueuedPerSession: runtimeConfig.lean.maxQueuedPerSession,
  capacity: runtimeConfig.lean.registryCapacity,
  ttlMs: runtimeConfig.lean.registryTtlMs,
});
const leanMetrics = createLeanMetrics();
const sageMetrics = createSageMetrics();

/**
 * Record one Sage orchestration transition (§18). Never throws: telemetry must
 * not be able to turn a completed run into a failure. The event carries state
 * names and reason codes only — never source, stdout or a host path.
 */
function emitSageTransition(before, after, reasonCode) {
  try {
    const event = sageTransitionEvent(before, after, reasonCode);
    if (!event) return;
    sageMetrics.record(event);
    console.info("sage_orchestration", JSON.stringify(event));
  } catch {
    // ignore
  }
}

/**
 * One line per Lean run. The event carries sizes, counts and hashes — never
 * the source, stderr bodies, host paths or environment.
 */
const leanLogger = {
  info: (label, event) => console.log(`[lean] ${label} ${JSON.stringify(event)}`),
  warn: (...args) => console.warn("[lean]", ...args),
  error: (...args) => console.error("[lean]", ...args)
};

/**
 * Revision of the Lean policy, composed the way the native agent composes it.
 *
 * The local version of this hashed skills/lean/SKILL.md alone, which is only the
 * whole policy in base mode: with DS4_LEAN_AUTONOMOUS_PROMPT=1 the native side
 * also appends the orchestration fragment, so the two sides reported different
 * revisions for the same files. leanPolicyBundle.mjs is the one implementation.
 *
 * Declared, not assigned to a const: leanRuntimeState is built near the top of
 * this file and takes this as a dependency, so it has to be hoisted.
 */
function getLeanPolicyState() {
  return loadLeanPolicyState({ projectRoot: PROJECT_ROOT });
}

app.use("/api/lean", createLeanRouter({
  express,
  config: runtimeConfig.lean,
  executeLeanCheck,
  getPreflight: () => runLeanPreflight(runtimeConfig.lean),
  getLeanPolicyState,
  runRegistry: leanRunRegistry,
  metrics: leanMetrics,
  logger: leanLogger
}));

// Lean run artifacts are kept for DS4_LEAN_RETENTION_HOURS so a result can be
// inspected after the fact, then pruned. Off the request path on purpose:
// pruning walks the runs root, and a check must never wait on it.
if (runtimeConfig.lean.enabled && runtimeConfig.lean.retentionHours > 0) {
  const pruneLeanRuns = () =>
    pruneExpiredLeanRuns(runtimeConfig.lean).catch((err) =>
      console.warn(`[lean] pruning failed: ${err.message}`)
    );
  pruneLeanRuns();
  setInterval(pruneLeanRuns, 60 * 60 * 1000).unref();
}

// The in-memory run registry (cached results + in-flight accounting) also gets
// a periodic prune so completed results expire even when no new /exec request
// ever comes in to trigger the opportunistic prune in reserve().
if (runtimeConfig.lean.enabled) {
  setInterval(() => leanRunRegistry.prune(), 60 * 1000).unref();
}

/**
 * Bridge the lean_check agent tool onto the same executor the HTTP route uses,
 * so there is exactly one place that knows about the sandbox and the runtime.
 */
async function runLeanCheckForAgent(request, options = {}) {
  return executeLeanCheck(request, {
    config: runtimeConfig.lean,
    preflight: await runLeanPreflight(runtimeConfig.lean),
    abortSignal: options.signal ?? null,
    metrics: leanMetrics,
    logger: leanLogger,
    orchestrationContext: options.leanOrchestrationContext ?? {}
  });
}

async function runLeanInspectForAgent(body, options = {}) {
  return executeLeanInspect(body, {
    config: runtimeConfig.lean,
    preflight: await runLeanPreflight(runtimeConfig.lean),
    abortSignal: options.signal ?? null,
    logger: leanLogger,
    metrics: leanMetrics,
  });
}

// ---------------------------------------------------------------------------
// Deep Research Endpoints
// ---------------------------------------------------------------------------

function researchConfig() {
  return config.research;
}

// stateDir resolves once at boot; changing it requires a frontend-server restart
const researchStateRootDir = path.isAbsolute(config.research.stateDir)
  ? config.research.stateDir
  : path.join(PROJECT_ROOT, config.research.stateDir);

const researchRuntime = new ResearchRuntime({
  store: new ResearchStateStore({ rootDir: researchStateRootDir }),
  getConfig: researchConfig,
  clientFactory: () =>
    new ResearchModelClient({
      baseUrl: backendBase(),
      model: activeRequestDefaults.model,
      modelConfig: researchConfig().model
    })
});

function requireResearchEnabled(res) {
  if (researchConfig().enabled) return true;
  res.status(403).json({ error: "research mode is disabled (set research.enabled=true)" });
  return false;
}

async function ensureServerModeForResearch(res) {
  if (!wrapperEnabled()) return true;
  const up = await fetch(`${backendBase()}/api/wrapper/switch-mode`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode: "server" }),
    signal: AbortSignal.timeout(config.wrapper?.modeSwitchTimeoutMs || 120000)
  });
  if (!up.ok) {
    const body = await up.json().catch(() => ({}));
    res.status(502).json({ error: `wrapper switch to server mode failed: ${body.error || up.status}` });
    return false;
  }
  return true;
}

// Create a draft session (so documents can be uploaded before launch).
app.post("/api/research/session", asyncHandler(async (req, res) => {
  if (!requireResearchEnabled(res)) return;
  const { sessionId } = await researchRuntime.createSession(req.body?.query, { engine: req.body?.engine });
  res.json({ sessionId });
}));

app.get("/api/research/sessions", asyncHandler(async (_req, res) => {
  if (!requireResearchEnabled(res)) return;
  res.json({ sessions: await researchRuntime.store.listSessions() });
}));

// Upload a document into a draft session's RAG corpus.
app.post("/api/research/:sessionId/documents", upload.single("file"), asyncHandler(async (req, res) => {
  if (!requireResearchEnabled(res)) return;
  const ingested = await ingestUploadedFile(req.file);
  const entry = await researchRuntime.addDocument(req.params.sessionId, {
    name: ingested.name,
    markdown: ingested.markdown
  });
  const documents = await researchRuntime.store.loadDocuments(req.params.sessionId);
  res.json({ document: entry, documents });
}));

// WP2: a research job switches the wrapper mode and calls the model in the
// background; it holds the shared lease until the job settles (it releases it
// while waiting for plan feedback, which relaunches under a new lease).
const researchJobDone = (sessionId) => researchRuntime.jobs.get(sessionId)?.promise;

app.post("/api/research/start", asyncHandler(admissionGuards.route("research", async (req, res) => {
  if (!requireResearchEnabled(res)) return;
  if (!(await ensureServerModeForResearch(res))) return;
  // Launch an existing draft session if a sessionId is given, else create+launch.
  const { sessionId } = req.body?.sessionId
    ? await researchRuntime.launch(req.body.sessionId)
    : await researchRuntime.start(req.body?.query, { engine: req.body?.engine });
  res.json({ sessionId });
  return { background: researchJobDone(sessionId) };
})));

app.get("/api/research/export/:sessionId", asyncHandler(async (req, res) => {
  if (!requireResearchEnabled(res)) return;
  if (!researchConfig().exportEnabled) {
    return res.status(403).json({ error: "research export is disabled" });
  }
  const state = await researchRuntime.getState(req.params.sessionId);
  const { contentType, ext, body } = await exportSession(state, String(req.query.format || "md"));
  res.setHeader("Content-Type", contentType);
  res.setHeader("Content-Disposition", `attachment; filename="research-${req.params.sessionId}.${ext}"`);
  res.send(body);
}));

app.get("/api/research/state/:sessionId", asyncHandler(async (req, res) => {
  if (!requireResearchEnabled(res)) return;
  res.json({ state: await researchRuntime.getState(req.params.sessionId) });
}));

app.get("/api/research/stream/:sessionId", asyncHandler(async (req, res) => {
  if (!requireResearchEnabled(res)) return;
  const sessionId = req.params.sessionId;
  await researchRuntime.getState(sessionId); // 404 for unknown sessions
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no"
  });
  const lastSeqRaw = Number(req.query.lastSeq || 0);
  const lastSeq = Number.isFinite(lastSeqRaw) ? lastSeqRaw : 0;
  const send = (event) => writeSse(res, "research_event", event);
  const unsubscribe = researchRuntime.subscribe(sessionId, send);
  req.on("close", unsubscribe);
  await researchRuntime.flush(sessionId);
  for (const event of await researchRuntime.store.readEvents(sessionId)) {
    if (event.seq > lastSeq) send(event);
  }
}));

app.post("/api/research/feedback", asyncHandler(admissionGuards.route("research", async (req, res) => {
  if (!requireResearchEnabled(res)) return;
  const state = await researchRuntime.feedback(req.body?.sessionId, {
    action: req.body?.action,
    plan: req.body?.plan
  });
  res.json({ status: state.status });
  return { background: researchJobDone(req.body?.sessionId) };
})));

app.post("/api/research/prism/reauth", asyncHandler(async (req, res) => {
  if (!requireResearchEnabled(res)) return;
  const prismConfig = researchConfig().prism || {};
  const { PrintingPressPrismResearchClient } = await import("./research/prismResearchClient.mjs");
  const client = new PrintingPressPrismResearchClient({
    cliPath: (typeof prismConfig.cliPath === "string" && prismConfig.cliPath.trim()
      ? prismConfig.cliPath
      : process.env.PRISM_CLI_PATH) || "prism-pp-cli",
    cookiesEnv: prismConfig.cookiesEnv
  });
  try {
    await client.refreshAuth();
    res.json({ ok: true, message: "prism auth refreshed" });
  } catch (err) {
    res.status(502).json({ error: `prism auth refresh failed: ${err.message}` });
  }
}));

app.post("/api/research/cancel", asyncHandler(createResearchCancelHandler({
  identity: agentIdentity,
  refuse: admissionGuards.refuse,
  requireEnabled: requireResearchEnabled,
  runtime: researchRuntime,
  admission: agentAdmission
})));

/**
 * Tool blob retrieval endpoint.
 * Used by the C agent's retrieve_context_blob tool to fetch exact original bytes
 * from a previously compressed tool output.  Also usable by the JS runtime.
 * Path: /api/tool-blob/:id?offset=0&length=20000
 */
app.get("/api/tool-blob/:id", asyncHandler(async (req, res) => {
  const id = req.params.id;
  const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
  const length = Math.min(200_000, Math.max(1, parseInt(req.query.length, 10) || 20_000));

  if (!ToolBlobStore.isValidId(id)) {
    return res.status(400).json({ error: "invalid blob id" });
  }

  const text = await toolBlobStore.get(id, offset, length);
  if (text === null) {
    return res.status(404).json({ error: "blob not found" });
  }

  res.type("text/plain").send(text);
}));

app.use((err, _req, res, next) => {
  if (res.headersSent) return next(err);
  const status = err.status || err.statusCode || 500;
  res.status(status).json({ error: err.message || "Internal Server Error" });
});

const vite = await createViteServer({
  server: { middlewareMode: true, ws: false },
  appType: "spa",
  root: FRONTEND_ROOT
});
app.use(vite.middlewares);

let crawlProcess = null;

async function startCrawlService() {
  const crawlServiceDir = path.join(PROJECT_ROOT, "crawl_service");
  const defaultPython = path.join(crawlServiceDir, ".venv/bin/python3");
  const pythonBin = process.env.DS4_CRAWL_PYTHON || defaultPython;
  const crawlHost = config.crawl.host;
  const crawlPort = config.crawl.port;
  const token = await ensureCrawlToken();
  const args = ["-m", "ds4_crawl.cli", "serve", "--host", crawlHost, "--port", String(crawlPort)];
  crawlProcess = spawn(pythonBin, args, {
    cwd: crawlServiceDir,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, PYTHONPATH: "src", DS4_CRAWL_TOKEN: token, DS4_CRAWL_OWNER: CRAWL_OWNER_ID }
  });
  crawlProcess.stdout.on("data", (chunk) => process.stdout.write(`[crawl] ${chunk}`));
  crawlProcess.stderr.on("data", (chunk) => process.stderr.write(`[crawl] ${chunk}`));
  crawlProcess.on("exit", (code) => {
    console.log(`ds4-ui: crawl service exited (code=${code})`);
    crawlProcess = null;
  });
  // Without this listener a failed spawn (no venv, no python) raises an
  // unhandled 'error' event, which takes the whole UI server down seconds
  // after boot — an optional side service must never do that.
  crawlProcess.on("error", (err) => {
    console.warn(`ds4-ui: crawl service could not start: ${err.message}`);
    crawlProcess = null;
  });
  for (let i = 0; i < 30; i++) {
    try {
      const resp = await fetch(`http://${crawlHost}:${crawlPort}/health`);
      if (resp.ok) {
        const health = await resp.json().catch(() => ({}));
        if (health?.owner === CRAWL_OWNER_ID) {
          console.log(`ds4-ui: crawl service ready on ${crawlHost}:${crawlPort}`);
          return;
        }
      }
    } catch { }
    await new Promise((r) => setTimeout(r, 500));
  }
  console.warn("ds4-ui: crawl service did not become ready with this UI owner");
}

async function stopCrawlService() {
  if (!crawlProcess) return;
  crawlProcess.kill("SIGTERM");
  await new Promise((r) => setTimeout(r, 1000));
  if (crawlProcess) { crawlProcess.kill("SIGKILL"); crawlProcess = null; }
}

const server = app.listen(config.control.port, config.control.host, async () => {
  try {
    await manager.start();
  } catch (err) {
    console.error("ds4-ui: failed to start ds4 server:", err);
  }
  startCrawlService().catch((err) => console.warn("ds4-ui: crawl service start failed:", err.message));
  if (config.agno.enabled && config.agno.autoStart) {
    agnoProcessManager.start().catch((err) => console.warn("ds4-ui: agno service start failed:", err.message));
    if (config.agno.agentUi.enabled && config.agno.agentUi.autoStart) {
      agentUiProcessManager.start().catch((err) => console.warn("ds4-ui: agno agent UI start failed:", err.message));
    }
  }
  console.log(`ds4-ui: http://${config.control.host}:${config.control.port}`);
});

server.on("error", (err) => {
  console.error("ds4-ui: control server error:", err);
});

let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  const timeout = setTimeout(() => process.exit(1), SHUTDOWN_TIMEOUT_MS);
  const closeServer = new Promise((resolve) => {
    server.close((err) => resolve(err));
  });
  let forceCloseHttp;
  try {
    clearInterval(agnoToolSessionSweepTimer);
    agnoToolGate.cancelAll("DS4 shutdown");
    agnoToolSessions.closeAll();
    await stopCrawlService();
    await agentUiProcessManager.stop();
    await agnoProcessManager.stop();
    await manager.stop();
    await vite.close();
    forceCloseHttp = setTimeout(() => {
      if (typeof server.closeAllConnections === "function") server.closeAllConnections();
    }, HTTP_DRAIN_GRACE_MS);
    const closeError = await closeServer;
    if (closeError) throw closeError;
    localThreadStorage?.close();
    clearTimeout(forceCloseHttp);
    clearTimeout(timeout);
    process.exit(0);
  } catch (err) {
    console.error("ds4-ui: shutdown failed:", err);
    if (forceCloseHttp) clearTimeout(forceCloseHttp);
    clearTimeout(timeout);
    process.exit(1);
  }
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
