import { RESEARCH_DEFAULTS } from "./research/researchConfig.mjs";

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
  contextWiki: Object.freeze({
    enabled: false,
    previewOnly: true
  })
});

export const REQUEST_DEFAULTS = Object.freeze({
  endpoint: "/v1/chat/completions",
  model: "deepseek-v4-flash",
  system: "",
  // "auto" is resolved by the DS4-Studio proxy to:
  // min(context room - context_margin, max_tokens_safety_cap).
  max_tokens: "auto",
  max_tokens_safety_cap: 32768,
  context_margin: 1024,
  temperature: 0,
  top_p: 1,
  top_k: 0,
  min_p: 0,
  seed: 42,
  stream: true,
  thinking: false,
  reasoning_effort: "high",
  stop: ""
});
