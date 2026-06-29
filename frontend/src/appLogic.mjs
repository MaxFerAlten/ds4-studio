// Pure logic and constants extracted verbatim from App.jsx for testability.
// These definitions are byte-identical to the originals (only `export` added)
// to guarantee ISO-functionality. App.jsx imports these instead of defining
// them inline.

import { readStoredExportIncludeReasoning } from "./utils.mjs";

export function readAgentSessionKey() {
  try {
    let k = sessionStorage.getItem("ds4_agent_session_key");
    if (!k) {
      k = `tab_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
      sessionStorage.setItem("ds4_agent_session_key", k);
    }
    return k;
  } catch {
    return "default";
  }
}
export const AGENT_SESSION_KEY = readAgentSessionKey();
export const AGENT_HEADERS = { "X-Agent-Session-Key": AGENT_SESSION_KEY };

export const STARTUP_GROUPS = [
  ["Model", ["binary", "model", "mtp", "mtpDraft", "mtpMargin"]],
  ["Runtime", ["ctx", "tokens", "threads", "backend", "quality", "warmWeights"]],
  ["HTTP", ["host", "port", "maxQueuedJobs", "trace"]],
  [
    "GPU Env",
    [
      "DS4_METAL_PREFILL_CHUNK",
      "DS4_CUDA_Q8_F16_CACHE_MB",
      "DS4_CUDA_Q8_F16_CACHE_RESERVE_MB",
      "DS4_CUDA_WEIGHT_ARENA_CHUNK_MB",
      "DS4_CUDA_COPY_MODEL_CHUNKED",
      "DS4_CUDA_DIRECT_MODEL",
      "DS4_CUDA_NO_FD_CACHE"
    ]
  ],
  [
    "KV Cache",
    [
      "kvDiskDir",
      "kvDiskSpaceMb",
      "kvCacheMinTokens",
      "kvCacheColdMaxTokens",
      "kvCacheContinuedIntervalTokens",
      "kvCacheBoundaryTrimTokens",
      "kvCacheBoundaryAlignTokens",
      "kvCacheRejectDifferentQuant"
    ]
  ],
  ["Tool Replay", ["disableExactDsmlToolReplay", "toolMemoryMaxIds"]],
  ["Steering", ["dirSteeringFile", "dirSteeringFfn", "dirSteeringAttn"]]
];

export const FIELD_LABELS = {
  binary: "Binary",
  model: "Model",
  mtp: "MTP model",
  mtpDraft: "MTP draft",
  mtpMargin: "MTP margin",
  ctx: "Context",
  tokens: "Default tokens",
  threads: "Threads",
  backend: "Backend",
  quality: "Quality",
  warmWeights: "Warm weights",
  host: "Host",
  port: "Port",
  maxQueuedJobs: "Max queue",
  trace: "Trace file",
  DS4_METAL_PREFILL_CHUNK: "Prefill chunk tokens",
  DS4_CUDA_Q8_F16_CACHE_MB: "Q8/F16 cache MB",
  DS4_CUDA_Q8_F16_CACHE_RESERVE_MB: "Q8/F16 reserve MB",
  DS4_CUDA_WEIGHT_ARENA_CHUNK_MB: "Weight arena MB",
  DS4_CUDA_COPY_MODEL_CHUNKED: "Chunked model copy",
  DS4_CUDA_DIRECT_MODEL: "Direct model",
  DS4_CUDA_NO_FD_CACHE: "No FD cache",
  kvDiskDir: "KV disk dir",
  kvDiskSpaceMb: "KV disk MB",
  kvCacheMinTokens: "KV min tokens",
  kvCacheColdMaxTokens: "KV cold max",
  kvCacheContinuedIntervalTokens: "KV interval",
  kvCacheBoundaryTrimTokens: "KV trim",
  kvCacheBoundaryAlignTokens: "KV align",
  kvCacheRejectDifferentQuant: "Reject quant mismatch",
  disableExactDsmlToolReplay: "Disable exact DSML replay",
  toolMemoryMaxIds: "Tool memory IDs",
  dirSteeringFile: "Direction file",
  dirSteeringFfn: "Steer FFN",
  dirSteeringAttn: "Steer attention"
};

export const STARTUP_HELP = {
  binary: "Executable to launch for the DS4 backend.",
  model: "Main GGUF file to load.",
  mtp: "Optional MTP GGUF for speculative decoding; empty means disabled.",
  mtpDraft: "Number of draft tokens for MTP / speculative decoding.",
  mtpMargin: "MTP confidence margin; higher values accept fewer drafts.",
  ctx: "Maximum context size in tokens.",
  tokens: "Default maximum tokens generated per request.",
  threads: "CPU threads; 0 lets the backend choose automatically.",
  backend: "Compute backend to use: auto, metal, cuda or cpu.",
  quality: "Enable quality-oriented checks/modes when supported.",
  warmWeights: "Preload/warm the weights at startup to reduce later latency.",
  host: "HTTP host ds4-server listens on; usually 127.0.0.1.",
  port: "HTTP port of the ds4-server backend.",
  maxQueuedJobs: "Maximum requests waiting for the single worker before HTTP 503.",
  trace: "Optional file to save detailed request traces; empty disables tracing.",
  DS4_METAL_PREFILL_CHUNK: "GPU prefill chunk in tokens; 8192 is the measured optimum on Strix Halo (ROCm caps chunks at 8192).",
  DS4_CUDA_Q8_F16_CACHE_MB: "Optional ROCm/HIP Q8 to F16 cache size in MB.",
  DS4_CUDA_Q8_F16_CACHE_RESERVE_MB: "Optional reserved MB kept outside the Q8 to F16 cache.",
  DS4_CUDA_WEIGHT_ARENA_CHUNK_MB: "Optional ROCm/HIP weight arena chunk size in MB.",
  DS4_CUDA_COPY_MODEL_CHUNKED: "Copy the full model image into GPU memory at startup.",
  DS4_CUDA_DIRECT_MODEL: "Optional DS4_CUDA_DIRECT_MODEL override; empty leaves default.",
  DS4_CUDA_NO_FD_CACHE: "Optional DS4_CUDA_NO_FD_CACHE override; empty leaves default.",
  kvDiskDir: "Optional directory for on-disk KV cache; empty disables disk persistence.",
  kvDiskSpaceMb: "Maximum MB reserved for the on-disk KV cache.",
  kvCacheMinTokens: "Minimum token threshold before considering cache reuse worthwhile.",
  kvCacheColdMaxTokens: "Maximum cold-cache tokens; 0 disables this limit.",
  kvCacheContinuedIntervalTokens: "Token interval between KV cache continuation checkpoints.",
  kvCacheBoundaryTrimTokens: "Tokens trimmed near cache boundaries for re-alignment.",
  kvCacheBoundaryAlignTokens: "Cache boundary alignment in tokens.",
  kvCacheRejectDifferentQuant: "Reject caches created with a different quantization.",
  disableExactDsmlToolReplay: "Disable exact DSML tool call replay.",
  toolMemoryMaxIds: "Maximum number of tool IDs kept for replay / canonicalization.",
  dirSteeringFile: "Optional vector file for directional steering; empty disables steering.",
  dirSteeringFfn: "Optional steering scale on FFN layers.",
  dirSteeringAttn: "Optional steering scale on attention layers."
};

export const STARTUP_PLACEHOLDERS = {
  binary: "./ds4-server",
  model: "ds4flash.gguf",
  mtp: "empty = MTP disabled",
  threads: "0 = auto",
  host: "127.0.0.1",
  trace: "empty = trace disabled",
  DS4_CUDA_Q8_F16_CACHE_MB: "empty = backend default",
  DS4_CUDA_Q8_F16_CACHE_RESERVE_MB: "empty = backend default",
  DS4_CUDA_WEIGHT_ARENA_CHUNK_MB: "empty = backend default",
  DS4_CUDA_COPY_MODEL_CHUNKED: "empty = backend default",
  DS4_CUDA_DIRECT_MODEL: "empty = backend default",
  DS4_CUDA_NO_FD_CACHE: "empty = backend default",
  kvDiskDir: "empty = disk KV dir disabled",
  dirSteeringFile: "empty = steering disabled",
  dirSteeringFfn: "optional scale",
  dirSteeringAttn: "optional scale"
};

export const REQUEST_HELP = {
  max_tokens: "Maximum generated tokens. Use 'auto' to fill available context up to the safety cap.",
  max_tokens_safety_cap: "Upper bound used when max_tokens is auto; prevents runaway generations.",
  context_margin: "Context tokens reserved when max_tokens is auto, to avoid filling the KV window exactly.",
  temperature: "Sampling creativity; higher values make output less deterministic.",
  top_p: "Nucleus sampling: restricts choice to tokens within the given cumulative probability.",
  top_k: "Restricts sampling to the top K tokens; 0 means no top-k limit.",
  min_p: "Minimum relative probability threshold to filter implausible tokens.",
  seed: "Optional seed for reproducible sampling; empty means random/default.",
  stream: "Send tokens as they are generated.",
  thinking: "Enable thinking/reasoning. When off, hidden reasoning does not consume the reply budget.",
  reasoning_effort: "Thinking intensity when enabled: low, medium, high, xhigh or max.",
  stop: "Optional stop sequences, one per line; empty means no extra stop."
};

export const REQUEST_PLACEHOLDERS = {
  max_tokens: "auto or a number",
  max_tokens_safety_cap: "32768",
  context_margin: "1024",
  seed: "empty = random/default",
  stop: "optional, one stop sequence per line",
  reasoning_effort: "high"
};

export const STRATEGY_OPTIONS = [
  {
    key: "A",
    title: "Exhaustive pairwise",
    description: "Compare every chunk pair to find contradictions or relationships. Maximum accuracy.",
    tradeoff: "Cost O(N^2): 13 chunks = 78 calls. Prohibitive on long documents.",
    disabled: true
  },
  {
    key: "B",
    title: "Claim extraction + check",
    description: "Extracts atomic claims (subject, predicate, value, citation) per chunk, then compares claims on the same subject. Targets contradictions.",
    tradeoff: "O(N) map + O(C^2) check on claims. Practical but loses unstructurable nuance.",
    disabled: true
  },
  {
    key: "C",
    title: "Cluster by topic + local pairwise",
    description: "Groups chunks by topic via embeddings, then runs pairwise comparison inside each cluster.",
    tradeoff: "Requires an extra embedding model. Finds local contradictions, misses cross-topic ones.",
    disabled: true
  },
  {
    key: "F",
    title: "Full document in context",
    description: "Inserisce l'intero documento nel messaggio: contenuto completo visibile in chat e mantenuto nel contesto della sessione, senza chunking.",
    tradeoff: "Nessuna perdita di informazione. Richiede che il documento stia nella context window del modello.",
    recommended: true,
    disabled: false
  },
  {
    key: "D",
    title: "Map-reduce with summaries",
    description: "Summarizes every chunk preserving facts, numbers, names, citations; then a reduce step answers using the summaries.",
    tradeoff: "Linear O(N). Great for Q&A and general analysis. Weak on subtle contradictions.",
    disabled: false
  }
];

export const AGENT_COMMANDS = [
  { name: "/help", desc: "Show list of available commands" },
  { name: "/save", desc: "Save the current agent session" },
  { name: "/compact", desc: "Compact the current session context" },
  { name: "/list", desc: "List all saved agent sessions" },
  { name: "/switch", desc: "Load a saved session (e.g. /switch <SHA>)" },
  { name: "/del", desc: "Delete a saved session (e.g. /del <SHA>)" },
  { name: "/strip", desc: "Strip KV payload from session (e.g. /strip <SHA>)" },
  { name: "/history", desc: "Show recent user turns (e.g. /history [N])" },
  { name: "/power", desc: "Set GPU duty cycle % (e.g. /power <1..100>)" },
  { name: "/new", desc: "Start a fresh agent session" },
  { name: "/quit", desc: "Save and return to server mode" },
  { name: "/exit", desc: "Save and return to server mode" },
  { name: "/agent stop", desc: "Exit agent mode and return to server mode" },
  { name: "/agent status", desc: "Show agent worker status" },
  { name: "/pony status", desc: "Show Pony/lean agent mode" },
  { name: "/pony start", desc: "Enable Pony full mode for Agent Mode" },
  { name: "/pony stop", desc: "Disable Pony mode" },
  { name: "/pony lite", desc: "Use light lean-agent guidance" },
  { name: "/pony full", desc: "Use full lean-agent guidance" },
  { name: "/pony ultra", desc: "Use aggressive YAGNI guidance" },
];

export const CHECKBOX_FIELDS = new Set([
  "quality",
  "warmWeights",
  "kvCacheRejectDifferentQuant",
  "disableExactDsmlToolReplay"
]);

export const TEXT_FIELDS = new Set([
  "model",
  "mtp",
  "binary",
  "trace",
  "kvDiskDir",
  "dirSteeringFile",
  "DS4_METAL_PREFILL_CHUNK",
  "DS4_CUDA_Q8_F16_CACHE_MB",
  "DS4_CUDA_Q8_F16_CACHE_RESERVE_MB",
  "DS4_CUDA_WEIGHT_ARENA_CHUNK_MB",
  "DS4_CUDA_COPY_MODEL_CHUNKED",
  "DS4_CUDA_DIRECT_MODEL",
  "DS4_CUDA_NO_FD_CACHE"
]);

export const ENV_FIELDS = new Set([
  "DS4_METAL_PREFILL_CHUNK",
  "DS4_CUDA_Q8_F16_CACHE_MB",
  "DS4_CUDA_Q8_F16_CACHE_RESERVE_MB",
  "DS4_CUDA_WEIGHT_ARENA_CHUNK_MB",
  "DS4_CUDA_COPY_MODEL_CHUNKED",
  "DS4_CUDA_DIRECT_MODEL",
  "DS4_CUDA_NO_FD_CACHE"
]);

export function fieldType(key) {
  if (CHECKBOX_FIELDS.has(key)) return "checkbox";
  if (key === "backend") return "select";
  if (TEXT_FIELDS.has(key)) return "text";
  return "number";
}

export function startupHelp(key) {
  return STARTUP_HELP[key] || FIELD_LABELS[key] || key;
}

export function serverFieldValue(server, key) {
  if (ENV_FIELDS.has(key)) return server.env?.[key] ?? "";
  return server[key];
}

export function requestHelp(key) {
  return REQUEST_HELP[key] || key;
}

export function appendAssistantDelta(content, reasoning) {
  return (prev) =>
    prev.map((message, index) =>
      index === prev.length - 1
        ? {
            ...message,
            content: message.content + content,
            reasoning: message.reasoning + reasoning
          }
        : message
    );
}

export function replaceAssistantMessage(content, reasoning = "") {
  return (prev) =>
    prev.map((message, index) => (index === prev.length - 1 ? { ...message, content, reasoning } : message));
}

export function appendAssistantNotice(notice) {
  return (prev) =>
    prev.map((message, index) => {
      if (index !== prev.length - 1) return message;
      const separator = message.content ? "\n\n" : "";
      return { ...message, content: `${message.content}${separator}${notice}` };
    });
}

// UI-only status/error message: pushes a new assistant message flagged with
// agentNotice so it is rendered in the chat but excluded from history export
// and from the prompt sent to the model on subsequent turns.
export function appendTransientNotice(notice) {
  return (prev) => [
    ...prev,
    { role: "assistant", content: notice, agentNotice: true }
  ];
}

// Grounding directive + results, appended to whatever turn carries the user's
// message to the model: the user turn in chat mode (injectSearchResults) or the
// outbound `message` string in agent mode (sendAgentMessage). Without an explicit
// directive, models treat the dump as ambient text and fabricate (invented
// headlines/dates), so the directive is mandatory wherever results are fed in.
export function searchResultsBlock(searchResult = "") {
  return (
    `\n\n---\n` +
    `Live web search results are below. Answer using ONLY these results: ` +
    `cite the titles and URLs, and do not invent news, facts, or dates. ` +
    `If the results are only links or site descriptions, list them and tell ` +
    `the user to open the URLs for the full articles.\n\n${searchResult}`
  );
}

// Web search results are pushed to the chat as agentNotice (display-only), which
// buildChatMessages drops from the prompt. Inject them into the latest user turn
// so the model actually sees them — otherwise it answers blind and hallucinates.
// `messages` ends with the user turn followed by the empty assistant placeholder.
export function injectSearchResults(messages = [], searchResult = "") {
  if (!searchResult) return messages;
  const userIdx = messages.length - 2;
  if (userIdx < 0 || messages[userIdx]?.role !== "user") return messages;
  return messages.map((m, i) =>
    i === userIdx
      ? { ...m, content: `${m.content}${searchResultsBlock(searchResult)}` }
      : m
  );
}

// Build the messages array sent to /v1/chat/completions from the visible chat.
// Drops the empty trailing assistant placeholder AND any transient UI notices
// (agentNotice) such as a "Stream failed: …" banner, so an error message is
// never echoed back into the prompt — and re-nested — on the next turn.
export function buildChatMessages(messages = [], { system = "" } = {}) {
  const out = [];
  if (typeof system === "string" && system.trim()) {
    out.push({ role: "system", content: system });
  }
  for (const message of messages) {
    if (!message || message.agentNotice) continue;
    if (message.role === "assistant" && !message.content) continue;
    // Messages loaded from a Markdown archive are historical records, not
    // operational tool transcript. They must not be re-injected into the
    // active prompt context to prevent corrupted commands from reaching the model.
    if (message.fromArchive) continue;
    out.push({ role: message.role, content: message.content });
  }
  return out;
}

export function parseSseData(block) {
  return block
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart().replace(/\r$/, ""))
    .join("\n");
}

export function formatMetric(value, suffix = "") {
  if (value === null || value === undefined || value === "") return "N/A";
  return `${value}${suffix}`;
}

export function initialExportSettings() {
  const includeReasoning = readStoredExportIncludeReasoning();
  return {
    includeReasoning: includeReasoning ?? false,
    saved: includeReasoning !== null,
    mode: "obsidian"
  };
}

export const SESSION_STORAGE_KEY = "ds4.session";

export function readStoredSession() {
  if (typeof window === "undefined") return { fileName: null, messages: [] };
  try {
    const raw = window.localStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return { fileName: null, messages: [] };
    const parsed = JSON.parse(raw);
    return {
      fileName: typeof parsed?.fileName === "string" ? parsed.fileName : null,
      messages: Array.isArray(parsed?.messages) ? parsed.messages : []
    };
  } catch {
    return { fileName: null, messages: [] };
  }
}

export function writeStoredSession({ fileName, messages }) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      SESSION_STORAGE_KEY,
      JSON.stringify({ fileName: fileName || null, messages: messages || [] })
    );
  } catch {}
}

export function clearStoredSession() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(SESSION_STORAGE_KEY);
  } catch {}
}
