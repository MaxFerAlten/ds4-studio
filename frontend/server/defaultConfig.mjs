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
    ctx: 132768,
    tokens: 393216,
    threads: 0,
    backend: "auto",
    quality: false,
    warmWeights: false,
    host: "127.0.0.1",
    port: 8000,
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
