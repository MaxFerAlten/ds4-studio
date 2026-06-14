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
  callDebug: Object.freeze({
    enabled: true,
    dir: "data/call-debug",
    maxEntries: 200,
    maxBodyChars: 4000,
    maxFileBytes: 5000000,
    // Health/metrics polls fire every second and would evict real model/provider
    // calls from the ring; skip recording them.
    excludePaths: Object.freeze(["/api/wrapper/status", "/api/server/metrics"])
  })
});

export const REQUEST_DEFAULTS = Object.freeze({
  endpoint: "/v1/chat/completions",
  model: "deepseek-v4-flash",
  system: "",
  max_tokens: 4096,
  temperature: 0,
  top_p: 1,
  top_k: 0,
  min_p: 0,
  seed: 42,
  stream: true,
  thinking: true,
  reasoning_effort: "high",
  stop: ""
});
