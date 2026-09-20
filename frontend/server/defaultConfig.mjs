import { RESEARCH_DEFAULTS } from "./research/researchConfig.mjs";
// Re-exported so every existing server importer keeps working. The definition
// lives in a leaf module because the browser bundle needs it without dragging
// this file's Node-only dependencies along.
export { REQUEST_DEFAULTS } from "./requestDefaults.mjs";
import { DEFAULT_CONTEXT_LIMITS } from "./contextConfig.mjs";
import { LEAN_ORCHESTRATION_DEFAULTS } from "./lean/leanOrchestrationConfig.mjs";
import { SAGE_ORCHESTRATION_DEFAULTS } from "./sageOrchestrationConfig.mjs";

export const DEFAULT_CONFIG = Object.freeze({
  selectedProfile: "",
  control: Object.freeze({
    host: "127.0.0.1",
    port: 5173
  }),
  history: Object.freeze({
    enabled: false,
    dir: "/home/tendermachine/workspace_ds4studio/history"
  }),
  server: Object.freeze({
    binary: "./ds4-server",
    model: "ds4flash.gguf",
    mtp: "",
    mtpDraft: 1,
    mtpMargin: 3,
    ctx: 32768,
    tokens: 8192,
    threads: 0,
    backend: "auto",
    quality: false,
    warmWeights: false,
    host: "127.0.0.1",
    port: 8000,
    maxQueuedJobs: 8,
    env: Object.freeze({
      // Native default (ds4_agent.c agent_default_skills_enabled): unset means
      // enabled. Spelled out here because the tuning GUI renders it as a
      // two-state toggle and had been carrying its own copy of this default.
      DS4_SKILL_AUTO: "1",
      DS4_METAL_PREFILL_CHUNK: "8192",
      DS4_CUDA_Q8_F16_CACHE_MB: "11264",
      DS4_CUDA_Q8_F16_CACHE_RESERVE_MB: "512",
      DS4_CUDA_WEIGHT_ARENA_CHUNK_MB: "1024",
      DS4_CUDA_COPY_MODEL_CHUNKED: "1",
      DS4_CUDA_DIRECT_MODEL: "",
      DS4_CUDA_NO_FD_CACHE: "",
      DS4_CUDA_MOE_PROFILE: "",
      DS4_METAL_GRAPH_PREFILL_PROFILE: "",
      DS4_CUDA_MOE_NO_EXPERT_TILES: "",
      DS4_CUDA_MOE_TILE4: "",
      DS4_CUDA_MOE_WRITE_GATE_UP: "",
      DS4_CUDA_MOE_NO_P2: "",
      DS4_CUDA_MOE_ATOMIC_DOWN: "",
      DS4_CUDA_MOE_NO_ATOMIC_DOWN: "",
      DS4_CUDA_MOE_GATE_ROW512: "",
      DS4_CUDA_MOE_GATE_ROW2048: "",
      DS4_CUDA_MOE_GATE_ROW256: "",
      DS4_CUDA_MOE_GATE_ROW128: "",
      DS4_CUDA_MOE_NO_GATE_ROW2048: "",
      DS4_CUDA_MOE_NO_GATE_ROW256: "",
      DS4_CUDA_MOE_NO_GATE_ROW128: "",
      DS4_CUDA_MOE_NO_DOWN_TILE16: "",
      DS4_CUDA_MOE_NO_DECODE_LUT_GATE: "",
      DS4_CUDA_MOE_DOWN_ROW512: "",
      DS4_CUDA_MOE_DOWN_ROW1024: "",
      DS4_CUDA_MOE_DOWN_ROW2048: "",
      DS4_CUDA_MOE_DOWN_ROW256: "",
      DS4_CUDA_MOE_NO_DOWN_ROW128: "",
      DS4_CUDA_MOE_NO_DOWN_ROW64: "",
      DS4_CUDA_MOE_NO_DIRECT_DOWN_SUM6: ""
    }),
    trace: "",
    dirSteeringFile: "",
    dirSteeringFfn: "",
    dirSteeringAttn: "",
    kvDiskDir: "",
    kvDiskSpaceMb: 4096,
    kvCacheMinTokens: 512,
    kvCacheColdMaxTokens: 30000,
    kvCacheContinuedIntervalTokens: 10000,
    kvCacheBoundaryTrimTokens: 32,
    kvCacheBoundaryAlignTokens: 2048,
    kvCacheRejectDifferentQuant: false,
    disableExactDsmlToolReplay: false,
    toolMemoryMaxIds: 100000
  }),
  wrapper: Object.freeze({
    enabled: false,
    binary: "./ds4-wrapper",
    startupMode: "server",
    freezeOnSwitch: true,
    freeInactiveSession: true,
    mutualExclusive: true,
    agentEnabledAtStartup: false,
    ramFreezeMaxMb: 4096,
    modeSwitchTimeoutMs: 120000
  }),
  research: RESEARCH_DEFAULTS,
  lean: Object.freeze({
    enabled: false,
    policyAuto: true,
    defaultProfile: "core",
    // Autonomous proof orchestration budget. The numbers mirror
    // config/lean-orchestration-policy.json, which is also what the C header is
    // generated from; leanOrchestrationConfig.resolveLeanOrchestrationConfig
    // reads that file, so this block is only the file layer of the override
    // chain (env > file > policy default).
    orchestration: Object.freeze({
      // Native defaults (ds4_agent.c): orchestration on, autonomous prompt off.
      enabled: true,
      prompt: false,
      maxAttempts: LEAN_ORCHESTRATION_DEFAULTS.maxAttempts,
      maxSameFailure: LEAN_ORCHESTRATION_DEFAULTS.maxSameFailure,
      maxPrematureFinalizations: LEAN_ORCHESTRATION_DEFAULTS.maxPrematureFinalizations,
      maxWallClockMs: LEAN_ORCHESTRATION_DEFAULTS.maxWallClockMs
    })
  }),
  sage: Object.freeze({
    policyAuto: true,
    // Autonomous Sage orchestration budget. The numbers mirror
    // config/sage-orchestration-policy.json, which is also what the C header is
    // generated from; sageOrchestrationConfig.resolveSageOrchestrationConfig
    // reads that file, so this block is only the file layer of the override
    // chain (env > file > policy default).
    orchestration: Object.freeze({
      // Native defaults (ds4_agent_runtime.c): orchestration on, prompt off.
      enabled: true,
      prompt: false,
      maxComputeAttempts: SAGE_ORCHESTRATION_DEFAULTS.maxComputeAttempts,
      maxRepairAttempts: SAGE_ORCHESTRATION_DEFAULTS.maxRepairAttempts,
      maxValidationAttempts: SAGE_ORCHESTRATION_DEFAULTS.maxValidationAttempts,
      maxPlotAttempts: SAGE_ORCHESTRATION_DEFAULTS.maxPlotAttempts,
      maxPrematureFinalizations: SAGE_ORCHESTRATION_DEFAULTS.maxPrematureFinalizations,
      maxSameFailure: SAGE_ORCHESTRATION_DEFAULTS.maxSameFailure,
      maxWallClockMs: SAGE_ORCHESTRATION_DEFAULTS.maxWallClockMs,
      maxTotalToolCalls: SAGE_ORCHESTRATION_DEFAULTS.maxTotalToolCalls
    })
  }),
  evolution: Object.freeze({
    enabled: false,
    maxLevel: "B",
    stateDir: "data/evolution-runs",
    workDir: "../ds4-studio-evolution-workspaces",
    model: "deepseek-v4-flash",
    modelBaseUrl: "http://127.0.0.1:8080",
    modelTimeoutMs: 120000,
    maxPacketBytes: 128000,
    maxArtifactReadBytes: 200000,
    maxFeedbackContextBytes: 64000,
    writeTokenEnv: "DS4_EVOLUTION_WRITE_TOKEN"
  }),
  toolBlobs: Object.freeze({
    dir: "data/tool-blobs",
    compressEnabled: false
  }),
  crawl: Object.freeze({
    host: "127.0.0.1",
    port: 9090
  }),
  callDebug: Object.freeze({
    enabled: true,
    dir: "data/call-debug",
    maxEntries: 200,
    maxBodyChars: 4000,
    maxFileBytes: 5000000,
    // Health/metrics polls fire every second and would evict real model/provider
    // calls from the ring; skip recording them.
    excludePaths: Object.freeze(["/api/wrapper/status", "/api/server/metrics"])
  }),
  pageAgent: Object.freeze({
    enabled: false,
    clientUiEnabled: true,
    serverBrowserEnabled: false,
    mcpEnabled: false,
    model: "deepseek-v4-flash",
    baseURL: "http://127.0.0.1:8080/v1",
    apiKey: "not-needed",
    language: "it-IT",
    maxSteps: 20,
    actionTimeoutMs: 120000,
    requireConfirmation: true,
    experimentalScriptExecutionTool: false,
    allowExternalDomains: false,
    allowedOrigins: Object.freeze([
      "http://127.0.0.1:5173",
      "http://localhost:5173"
    ]),
    auditDir: "data/pageagent-runs"
  }),
  // The nine ContextWiki knobs live once, in contextConfig.DEFAULT_CONTEXT_LIMITS;
  // this block is only the file layer of the chain (env > file > default).
  contextWiki: Object.freeze({ ...DEFAULT_CONTEXT_LIMITS }),
  agno: Object.freeze({
    enabled: false,
    autoStart: false,
    host: "127.0.0.1",
    port: 7777,
    serviceDir: "agno_service",
    python: "",
    model: "",
    dbFile: "data/agno/agno.db",
    startupTimeoutMs: 30_000,
    shutdownTimeoutMs: 5_000,
    serviceRequestTimeoutMs: 3_600_000,
    modelQueueWaitTimeoutMs: 3_600_000,
    maxInflightModelCalls: 1,
    maxQueuedModelCalls: 8,
    telemetry: false,
    tracing: false,
    scheduler: false,
    mcpEnabled: false,
    uiEnabled: true,
    agentUi: Object.freeze({
      enabled: true,
      autoStart: false,
      host: "127.0.0.1",
      port: 3000,
      runtimeDir: ".runtime/agno-agent-ui",
      openMode: "new-tab",
      telemetry: false
    }),
    tools: Object.freeze({
      enabled: false,
      profile: "safe",
      allowedTools: Object.freeze([]),
      deniedTools: Object.freeze([]),
      requestTimeoutMs: 120_000,
      maxInflight: 1,
      maxQueued: 8,
      maxHistoryMessages: 64,
      maxHistoryBytes: 65_536,
      maxRequestBytes: 262_144,
      maxResponseBytes: 262_144,
      auditEnabled: true,
      auditDir: "data/agno/tool-audit"
    })
  }),
  agent: Object.freeze({
    nativeChatTimeoutMs: 180_000,
    // Quantum Fix epistemic gate. Ships disabled and in shadow: the first
    // commits must observe and record, never change what a turn publishes.
    epistemic: Object.freeze({
      enabled: false,
      mode: "shadow", // off | shadow | block
      withholdOutput: true,
      maxClaimsPerTurn: 64,
      maxVerifierCallsPerTurn: 24,
      maxRepairRounds: 2,
      blockSeverity: 4,
      verifyCitations: true,
      verifyMath: true,
      verifyExecutionClaims: true,
      verifyChallenges: true,
      strictRepair: true,
      persistSessionClaims: true
    })
  })
});
