import { useEffect, useMemo, useRef, useState } from "react";
import { Download, Plus, Play, Power, RefreshCw, Send, Square, Terminal } from "lucide-react";

function readAgentSessionKey() {
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
const AGENT_SESSION_KEY = readAgentSessionKey();
const AGENT_HEADERS = { "X-Agent-Session-Key": AGENT_SESSION_KEY };
import { commandLineFromConfig } from "../server/commandBuilder.mjs";
import { REQUEST_DEFAULTS } from "../server/defaultConfig.mjs";
import { buildChatPayload } from "../server/requestPayload.mjs";
import { exportConversationMarkdown, markdownFileName } from "./conversationExport.mjs";
import {
  clearStoredExportIncludeReasoning,
  readStoredExportDir,
  readStoredExportIncludeReasoning,
  writeStoredExportDir,
  writeStoredExportIncludeReasoning
} from "./exportPreferences.mjs";
import { MessageContent } from "./MessageContent.mjs";
import {
  createLiveStatsTracker,
  estimateTokenCount,
  finalizeLiveStats,
  streamStatsFromTiming,
  updateLiveStats
} from "./throughputStats.mjs";

const STARTUP_GROUPS = [
  ["Model", ["binary", "model", "mtp", "mtpDraft", "mtpMargin"]],
  ["Runtime", ["ctx", "tokens", "threads", "backend", "quality", "warmWeights"]],
  ["HTTP", ["host", "port", "trace"]],
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

const FIELD_LABELS = {
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
  trace: "Trace file",
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

const STARTUP_HELP = {
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
  trace: "Optional file to save detailed request traces; empty disables tracing.",
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

const STARTUP_PLACEHOLDERS = {
  binary: "./ds4-server",
  model: "ds4flash.gguf",
  mtp: "empty = MTP disabled",
  threads: "0 = auto",
  host: "127.0.0.1",
  trace: "empty = trace disabled",
  kvDiskDir: "empty = disk KV dir disabled",
  dirSteeringFile: "empty = steering disabled",
  dirSteeringFfn: "optional scale",
  dirSteeringAttn: "optional scale"
};

const REQUEST_HELP = {
  max_tokens: "Maximum number of tokens generated in the reply.",
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

const REQUEST_PLACEHOLDERS = {
  seed: "empty = random/default",
  stop: "optional, one stop sequence per line",
  reasoning_effort: "high"
};

const STRATEGY_OPTIONS = [
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
    key: "D",
    title: "Map-reduce with summaries",
    description: "Summarizes every chunk preserving facts, numbers, names, citations; then a reduce step answers using the summaries.",
    tradeoff: "Linear O(N). Great for Q&A and general analysis. Weak on subtle contradictions.",
    recommended: true,
    disabled: false
  }
];

const CHECKBOX_FIELDS = new Set([
  "quality",
  "warmWeights",
  "kvCacheRejectDifferentQuant",
  "disableExactDsmlToolReplay"
]);

const TEXT_FIELDS = new Set([
  "model",
  "mtp",
  "binary",
  "trace",
  "kvDiskDir",
  "dirSteeringFile"
]);

function fieldType(key) {
  if (CHECKBOX_FIELDS.has(key)) return "checkbox";
  if (key === "backend") return "select";
  if (TEXT_FIELDS.has(key)) return "text";
  return "number";
}

function startupHelp(key) {
  return STARTUP_HELP[key] || FIELD_LABELS[key] || key;
}

function requestHelp(key) {
  return REQUEST_HELP[key] || key;
}

async function jsonFetch(url, options) {
  const res = await fetch(url, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || data.message || `HTTP ${res.status}`);
  return data;
}

function appendAssistantDelta(content, reasoning) {
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

function replaceAssistantMessage(content, reasoning = "") {
  return (prev) =>
    prev.map((message, index) => (index === prev.length - 1 ? { ...message, content, reasoning } : message));
}

function appendAssistantNotice(notice) {
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
function appendTransientNotice(notice) {
  return (prev) => [
    ...prev,
    { role: "assistant", content: notice, agentNotice: true }
  ];
}

function parseSseData(block) {
  return block
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart().replace(/\r$/, ""))
    .join("\n");
}

function formatMetric(value, suffix = "") {
  if (value === null || value === undefined || value === "") return "N/A";
  return `${value}${suffix}`;
}

function initialExportSettings() {
  const includeReasoning = readStoredExportIncludeReasoning();
  return {
    includeReasoning: includeReasoning ?? false,
    saved: includeReasoning !== null
  };
}

const SESSION_STORAGE_KEY = "ds4.session";

function readStoredSession() {
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

function writeStoredSession({ fileName, messages }) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      SESSION_STORAGE_KEY,
      JSON.stringify({ fileName: fileName || null, messages: messages || [] })
    );
  } catch {}
}

function clearStoredSession() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(SESSION_STORAGE_KEY);
  } catch {}
}

function RocmFooter({ rocm, stats }) {
  const gpus = rocm?.gpus || [];
  return (
    <footer className={`rocm-footer ${rocm?.ok === false ? "warn" : ""}`}>
      <strong>ROCm SMI</strong>
      {rocm?.ok === false ? <span>{rocm.error || "unavailable"}</span> : null}
      {gpus.length
        ? gpus.map((gpu) => (
            <span className="rocm-card" key={gpu.id}>
              GPU{gpu.index}
              <b>{formatMetric(gpu.temperatureC, "°C")}</b>
              <b>{formatMetric(gpu.powerW, "W")}</b>
              <b>GPU {formatMetric(gpu.gpuUsePercent, "%")}</b>
              <b>VRAM {formatMetric(gpu.vramUsePercent, "%")}</b>
              <b>Fan {formatMetric(gpu.fanPercent, "%")}</b>
              {gpu.sclk ? <b>SCLK {gpu.sclk}</b> : null}
              {gpu.mclk ? <b>MCLK {gpu.mclk}</b> : null}
            </span>
          ))
        : rocm?.ok !== false
          ? <span>waiting...</span>
          : null}
      {stats ? (
        <span className="rocm-card">
          <strong>Throughput</strong>
          <b>prefill {stats.prefillTps != null ? `${stats.prefillTps.toFixed(2)} t/s` : "n/a"}</b>
          <b>gen {stats.genTps != null ? `${stats.genTps.toFixed(2)} t/s` : "n/a"}</b>
          <b>in {stats.promptTokens ?? 0}</b>
          <b>out {stats.completionTokens ?? 0}</b>
        </span>
      ) : null}
    </footer>
  );
}

function ExportDialog({ includeReasoning, onIncludeReasoningChange, onCancel, onConfirm }) {
  return (
    <div className="modal-backdrop">
      <form
        className="modal-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="export-dialog-title"
        onSubmit={(event) => {
          event.preventDefault();
          onConfirm();
        }}
      >
        <h2 id="export-dialog-title">Export Markdown</h2>
        <label className="checkbox-line">
          <input
            type="checkbox"
            checked={includeReasoning}
            onChange={(event) => onIncludeReasoningChange(event.target.checked)}
          />
          <span>Include reasoning</span>
        </label>
        <div className="modal-actions">
          <button type="button" className="secondary-action" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="primary-action">
            Export
          </button>
        </div>
      </form>
    </div>
  );
}

function ExportSettingsPanel({
  includeReasoning,
  saved,
  onIncludeReasoningChange,
  onForget,
  exportDir,
  exportDirDraft,
  exportDirStatus,
  onExportDirDraftChange,
  onSaveExportDir,
  onClearExportDir
}) {
  return (
    <div className="export-settings-panel">
      <label className="setting-row">
        <input
          type="checkbox"
          checked={includeReasoning}
          onChange={(event) => onIncludeReasoningChange(event.target.checked)}
        />
        <span>Reasoning in Markdown</span>
      </label>
      <div className={`status-pill ${saved ? "ok" : "warn"}`}>
        {saved
          ? `Saved choice: ${includeReasoning ? "with reasoning" : "without reasoning"}`
          : "Choice not saved"}
      </div>
      <button type="button" onClick={onForget} disabled={!saved}>
        Ask on next export
      </button>
      <label className="field full" data-tooltip="Server-side directory where the exported Markdown is saved. Leave empty to use the browser download.">
        <span>Default export folder</span>
        <input
          type="text"
          value={exportDirDraft}
          placeholder="e.g. /home/user/export or empty for browser download"
          onChange={(event) => onExportDirDraftChange(event.target.value)}
        />
      </label>
      <div className="button-row">
        <button type="button" onClick={onSaveExportDir} disabled={exportDirDraft === exportDir}>
          Save folder
        </button>
        <button type="button" onClick={onClearExportDir} disabled={!exportDir && !exportDirDraft}>
          Use browser download
        </button>
      </div>
      <div className={`status-pill ${exportDir ? "ok" : "warn"}`}>
        {exportDir ? `Export to disk: ${exportDir}` : "Export via browser download"}
      </div>
      {exportDirStatus ? <small>{exportDirStatus}</small> : null}
    </div>
  );
}

export default function App() {
  const [status, setStatus] = useState(null);
  const [config, setConfig] = useState(null);
  const [request, setRequest] = useState({ ...REQUEST_DEFAULTS });
  const initialSessionRef = useRef(readStoredSession());
  const [messages, setMessages] = useState(() => initialSessionRef.current.messages);
  const [currentSessionFileName, setCurrentSessionFileName] = useState(
    () => initialSessionRef.current.fileName
  );
  const [input, setInput] = useState("");
  const [tab, setTab] = useState("request");
  const [serverBusy, setServerBusy] = useState(false);
  const [generationBusy, setGenerationBusy] = useState(false);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [fileAccept, setFileAccept] = useState("");
  const [uploadedFiles, setUploadedFiles] = useState([]);
  const [rocm, setRocm] = useState(null);
  const [error, setError] = useState("");
  const [runtimeStats, setRuntimeStats] = useState(null);
  const [commandDraft, setCommandDraft] = useState(null);
  const [agentMode, setAgentMode] = useState(false);
  const [agentStatus, setAgentStatus] = useState(null);
  const [searchStrategy, setSearchStrategy] = useState("D");
  const [searchChunkTokens, setSearchChunkTokens] = useState(25000);
  const [attachedDoc, setAttachedDoc] = useState(null);
  const [chunkProgress, setChunkProgress] = useState(null);
  const [exportSettings, setExportSettings] = useState(initialExportSettings);
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [exportDialogIncludeReasoning, setExportDialogIncludeReasoning] = useState(
    exportSettings.includeReasoning
  );
  const [exportDir, setExportDir] = useState(() => readStoredExportDir());
  const [exportDirDraft, setExportDirDraft] = useState(() => readStoredExportDir());
  const [exportDirStatus, setExportDirStatus] = useState("");
  const [exportNotice, setExportNotice] = useState(null);
  const exportNoticeTimerRef = useRef(null);
  const [historyDraft, setHistoryDraft] = useState(null);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [historyStatus, setHistoryStatus] = useState("");
  const [historySessions, setHistorySessions] = useState([]);
  const [historyListBusy, setHistoryListBusy] = useState(false);
  const [historyAutoLoaded, setHistoryAutoLoaded] = useState(false);
  const commandHydrated = useRef(false);
  const profileHydrated = useRef(false);
  const [profiles, setProfiles] = useState([]);
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileNotice, setProfileNotice] = useState("");
  const abortRef = useRef(null);
  const composerRef = useRef(null);
  const fileInputRef = useRef(null);
  const messagesRef = useRef(null);
  const lastSavedHistorySignatureRef = useRef("");

  async function refreshStatus({ syncConfig = false } = {}) {
    const data = await jsonFetch("/api/server/status");
    setStatus(data);
    setConfig((prev) => (syncConfig || !prev ? data.config : prev));
    if (!commandHydrated.current) {
      commandHydrated.current = true;
      if (Array.isArray(data.overrideCommand) && data.overrideCommand.length) {
        setCommandDraft(data.overrideCommand.join(" "));
      }
    }
    if (!profileHydrated.current && data.profile?.requestDefaults) {
      profileHydrated.current = true;
      setRequest((prev) => ({ ...REQUEST_DEFAULTS, ...data.profile.requestDefaults, system: prev.system }));
    }
    setError("");
  }

  async function refreshProfiles() {
    const data = await jsonFetch("/api/profiles");
    setProfiles(data.profiles || []);
    return data;
  }

  async function selectProfile(name) {
    setProfileBusy(true);
    setProfileNotice("");
    try {
      const data = await jsonFetch("/api/profiles/select", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name })
      });
      if (data?.requestDefaults) {
        setRequest((prev) => ({ ...REQUEST_DEFAULTS, ...data.requestDefaults, system: prev.system }));
      }
      await refreshStatus({ syncConfig: true });
      await refreshProfiles();
      setProfileNotice(data?.backendRestartRequired
        ? "Profilo salvato. Riavvia il backend (ds4-server) per applicare i parametri server."
        : "Profilo salvato.");
    } catch (err) {
      setProfileNotice(`Errore: ${err.message}`);
    } finally {
      setProfileBusy(false);
    }
  }

  async function refreshRocmStatus() {
    const data = await jsonFetch("/api/rocm/status");
    setRocm(data);
  }

  useEffect(() => {
    setRequest((prev) => {
      if (prev.thinking !== undefined) return prev;
      return {
        ...REQUEST_DEFAULTS,
        ...prev,
        max_tokens: Number(prev.max_tokens) === 1024 ? REQUEST_DEFAULTS.max_tokens : prev.max_tokens,
        thinking: REQUEST_DEFAULTS.thinking
      };
    });
  }, []);

  useEffect(() => {
    refreshStatus({ syncConfig: true }).catch((err) => setError(err.message));
    refreshRocmStatus().catch(() => setRocm({ ok: false, error: "rocm-smi unavailable", gpus: [] }));
    refreshProfiles().catch(() => setProfiles([]));
    jsonFetch("/api/files/supported")
      .then((data) => setFileAccept(data.accept || ""))
      .catch(() => setFileAccept(""));
    jsonFetch("/api/agent/status", { headers: AGENT_HEADERS })
      .then((data) => {
        setAgentMode(Boolean(data.active));
        setAgentStatus(data);
      })
      .catch(() => {});
    const timer = setInterval(() => refreshStatus().catch((err) => setError(err.message)), 2000);
    const rocmTimer = setInterval(
      () => refreshRocmStatus().catch(() => setRocm({ ok: false, error: "rocm-smi unavailable", gpus: [] })),
      2000
    );
    return () => {
      clearInterval(timer);
      clearInterval(rocmTimer);
    };
  }, []);

  useEffect(() => {
    if (!config?.history) return;
    setHistoryDraft(config.history);
  }, [config?.history?.enabled, config?.history?.dir]);

  useEffect(() => {
    if (!config?.history?.dir) return;
    const tracked = currentSessionFileName;
    refreshHistorySessions({
      restoreFileName: config.history.enabled ? tracked : null
    }).catch((err) => {
      setHistoryStatus(`History load error: ${err.message}`);
    });
  }, [config?.history?.enabled, config?.history?.dir]);

  useEffect(() => {
    writeStoredSession({ fileName: currentSessionFileName, messages });
  }, [messages, currentSessionFileName]);

  useEffect(() => {
    const composer = composerRef.current;
    if (!composer) return;
    const minHeight = 86;
    const maxHeight = minHeight * 2;
    composer.style.height = `${minHeight}px`;
    const nextHeight = Math.min(Math.max(composer.scrollHeight, minHeight), maxHeight);
    composer.style.height = `${nextHeight}px`;
    composer.style.overflowY = composer.scrollHeight > maxHeight ? "auto" : "hidden";
  }, [input]);

  useEffect(() => {
    if (!generationBusy) return;
    const frame = requestAnimationFrame(() => {
      const messagesNode = messagesRef.current;
      if (messagesNode) messagesNode.scrollTop = messagesNode.scrollHeight;
    });
    return () => cancelAnimationFrame(frame);
  }, [generationBusy, messages]);

  useEffect(() => {
    if (generationBusy || !config?.history?.enabled || !messages.length) return;
    const lastMessage = messages[messages.length - 1];
    if (lastMessage?.role !== "assistant" || (!lastMessage.content && !lastMessage.reasoning)) return;

    const metadata = { agentMode };
    const signature = JSON.stringify({ dir: config.history.dir, messages, metadata });
    if (signature === lastSavedHistorySignatureRef.current) return;
    lastSavedHistorySignatureRef.current = signature;
    setHistoryStatus("Saving history...");
    jsonFetch("/api/history/conversation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages, fileName: currentSessionFileName || undefined, metadata })
    })
      .then((data) => {
        if (data.saved) {
          if (data.file?.fileName) setCurrentSessionFileName(data.file.fileName);
          setHistoryStatus(`Saved: ${data.file.fileName}`);
          refreshHistorySessions().catch(() => {});
        } else {
          setHistoryStatus("History disabled");
        }
      })
      .catch((err) => {
        lastSavedHistorySignatureRef.current = "";
        setHistoryStatus(`History error: ${err.message}`);
      });
  }, [generationBusy, messages, agentMode, config?.history?.enabled, config?.history?.dir, currentSessionFileName]);

  const commandText = useMemo(() => (config ? commandLineFromConfig(config) : "./ds4-server"), [config]);
  const runningCommandText = useMemo(() => status?.command?.join(" ") || "", [status]);
  const effectiveCommand = commandDraft ?? commandText;
  const commandIsCustom = commandDraft !== null && commandDraft.trim() !== commandText.trim();
  const hasPendingStartup = Boolean(runningCommandText && effectiveCommand.trim() && effectiveCommand.trim() !== runningCommandText.trim());
  const canSend = Boolean(status?.running && status?.healthy && !generationBusy);
  const historyConfig = config?.history || { enabled: false, dir: "" };

  function updateServerField(key, value) {
    setCommandDraft(null);
    setConfig((prev) => ({ ...prev, server: { ...prev.server, [key]: value } }));
  }

  function updateRequestField(key, value) {
    setRequest((prev) => ({ ...prev, [key]: value }));
  }

  function updateNumberServerField(key, rawValue) {
    updateServerField(key, rawValue === "" ? "" : Number(rawValue));
  }

  function updateHistoryDraft(key, value) {
    setHistoryDraft((prev) => ({ ...(prev || historyConfig), [key]: value }));
  }

  async function loadHistorySession(fileName, { automatic = false } = {}) {
    const data = await jsonFetch(`/api/history/conversations/${encodeURIComponent(fileName)}`);
    const loadedMessages = data.session.messages || [];
    const loadedMetadata = data.session.metadata || null;
    const wantAgent = Boolean(loadedMetadata?.agentMode);
    if (agentMode && !wantAgent) {
      await toggleAgentMode(false, { notice: false });
    } else if (!agentMode && wantAgent) {
      await toggleAgentMode(true, { notice: false });
    }
    setMessages(loadedMessages);
    setCurrentSessionFileName(data.session.fileName);
    setHistoryAutoLoaded(true);
    lastSavedHistorySignatureRef.current = JSON.stringify({
      dir: historyConfig.dir,
      messages: loadedMessages,
      metadata: { agentMode: wantAgent }
    });
    setHistoryStatus(`${automatic ? "Restored" : "Loaded"}: ${data.session.fileName}${wantAgent ? " (agent restored)" : ""}`);
  }

  async function refreshHistorySessions({ restoreFileName = null } = {}) {
    setHistoryListBusy(true);
    try {
      const data = await jsonFetch("/api/history/conversations");
      const sessions = data.sessions || [];
      setHistorySessions(sessions);
      if (
        restoreFileName &&
        !historyAutoLoaded &&
        !messages.length &&
        sessions.some((session) => session.fileName === restoreFileName)
      ) {
        await loadHistorySession(restoreFileName, { automatic: true });
      }
    } finally {
      setHistoryListBusy(false);
    }
  }

  async function deleteHistorySession(fileName) {
    if (!fileName) return;
    if (typeof window !== "undefined" && !window.confirm(`Delete history session ${fileName}?`)) return;
    setHistoryListBusy(true);
    try {
      await jsonFetch(`/api/history/conversations/${encodeURIComponent(fileName)}`, { method: "DELETE" });
      setHistorySessions((prev) => prev.filter((session) => session.fileName !== fileName));
      setHistoryStatus(`Deleted: ${fileName}`);
      if (currentSessionFileName === fileName) {
        setCurrentSessionFileName(null);
        setMessages([]);
        lastSavedHistorySignatureRef.current = "";
        clearStoredSession();
      }
    } catch (err) {
      setHistoryStatus(`Delete error: ${err.message}`);
    } finally {
      setHistoryListBusy(false);
    }
  }

  async function deleteAllHistorySessions() {
    if (typeof window !== "undefined" && !window.confirm("Delete ALL history sessions? This cannot be undone.")) return;
    setHistoryListBusy(true);
    try {
      const data = await jsonFetch("/api/history/conversations", { method: "DELETE" });
      setHistorySessions([]);
      setHistoryStatus(`Deleted ${data.deleted ?? 0} sessions`);
      setCurrentSessionFileName(null);
      setMessages([]);
      lastSavedHistorySignatureRef.current = "";
      clearStoredSession();
    } catch (err) {
      setHistoryStatus(`Delete error: ${err.message}`);
    } finally {
      setHistoryListBusy(false);
    }
  }

  function startNewSession() {
    if (generationBusy) return;
    if (agentMode) {
      fetch("/api/agent/stop", { method: "POST", headers: AGENT_HEADERS })
        .then((res) => res.json())
        .then((data) => setAgentStatus(data))
        .catch(() => {});
      setAgentMode(false);
      setAgentStatus(null);
    }
    setMessages([]);
    setCurrentSessionFileName(null);
    setAttachedDoc(null);
    setChunkProgress(null);
    setInput("");
    lastSavedHistorySignatureRef.current = "";
    setHistoryAutoLoaded(true);
    setHistoryStatus("New session");
    clearStoredSession();
  }

  async function saveHistorySettings() {
    const history = historyDraft || historyConfig;
    setHistoryBusy(true);
    setError("");
    try {
      const data = await jsonFetch("/api/history/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ history })
      });
      setConfig(data.config);
      setHistoryStatus("History settings saved");
      await refreshHistorySessions({
        restoreFileName: data.config.history.enabled ? currentSessionFileName : null
      });
    } catch (err) {
      setError(err.message);
      setHistoryStatus(`History settings error: ${err.message}`);
    } finally {
      setHistoryBusy(false);
    }
  }

  function showExportNotice(kind, message) {
    setExportNotice({ kind, message });
    if (exportNoticeTimerRef.current) clearTimeout(exportNoticeTimerRef.current);
    exportNoticeTimerRef.current = setTimeout(() => setExportNotice(null), 5000);
  }

  function browserDownloadMarkdown(includeReasoning) {
    const markdown = exportConversationMarkdown(messages, { includeReasoning });
    const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const fileName = markdownFileName();
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    showExportNotice("ok", `Downloaded: ${fileName}`);
  }

  function exportMarkdown(includeReasoning) {
    if (!exportDir) {
      browserDownloadMarkdown(includeReasoning);
      return;
    }
    const fileName = markdownFileName();
    setExportDirStatus(`Saving to ${exportDir}/${fileName}...`);
    showExportNotice("info", `Saving to ${exportDir}/${fileName}...`);
    jsonFetch("/api/export/conversation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages, includeReasoning, dir: exportDir, fileName })
    })
      .then((data) => {
        setExportDirStatus(`Saved: ${data.file.filePath}`);
        showExportNotice("ok", `Saved: ${data.file.filePath}`);
      })
      .catch((err) => {
        setExportDirStatus(`Error: ${err.message}. Falling back to browser download.`);
        showExportNotice("warn", `Save failed: ${err.message}. Falling back to browser download.`);
        browserDownloadMarkdown(includeReasoning);
      });
  }

  function saveExportDir() {
    const value = exportDirDraft.trim();
    writeStoredExportDir(value);
    setExportDir(value);
    setExportDirDraft(value);
    setExportDirStatus(value ? `Folder saved: ${value}` : "Export back to browser download");
  }

  function clearExportDir() {
    writeStoredExportDir("");
    setExportDir("");
    setExportDirDraft("");
    setExportDirStatus("Export back to browser download");
  }

  function saveExportPreference(includeReasoning) {
    writeStoredExportIncludeReasoning(includeReasoning);
    setExportSettings({ includeReasoning, saved: true });
  }

  function forgetExportPreference() {
    clearStoredExportIncludeReasoning();
    setExportSettings((prev) => ({ ...prev, saved: false }));
  }

  function savedExportPreference() {
    const includeReasoning = readStoredExportIncludeReasoning();
    if (includeReasoning === null) {
      setExportSettings((prev) => ({ ...prev, saved: false }));
      return null;
    }
    setExportSettings({ includeReasoning, saved: true });
    return includeReasoning;
  }

  function downloadConversation() {
    if (!messages.length) return;
    const includeReasoning = savedExportPreference();
    if (includeReasoning !== null) {
      exportMarkdown(includeReasoning);
      return;
    }
    setExportDialogIncludeReasoning(exportSettings.includeReasoning);
    setExportDialogOpen(true);
  }

  function confirmExportDialog() {
    saveExportPreference(exportDialogIncludeReasoning);
    setExportDialogOpen(false);
    exportMarkdown(exportDialogIncludeReasoning);
  }

  function appendFileToComposer(file) {
    if (searchStrategy === "D") {
      setAttachedDoc({
        name: file.name,
        markdown: file.markdown,
        approxTokens: Math.ceil((file.markdown || "").length / 4)
      });
      return;
    }
    const block = [
      `File da analizzare: ${file.name}`,
      `Upload: ${file.uploadPath}`,
      `Estratto: ${file.extractPath}`,
      "",
      file.markdown
    ].join("\n");
    setInput((prev) => `${prev}${prev.trim() ? "\n\n" : ""}${block}`);
  }

  async function uploadFile(file) {
    if (!file) return;
    const form = new FormData();
    form.append("file", file);
    setUploadBusy(true);
    setError("");
    try {
      const data = await jsonFetch("/api/files/upload", { method: "POST", body: form });
      setUploadedFiles((prev) => [data.file, ...prev].slice(0, 5));
      appendFileToComposer(data.file);
    } catch (err) {
      setError(err.message);
    } finally {
      setUploadBusy(false);
    }
  }

  function abortGeneration(notice = "Interrupted.") {
    if (!abortRef.current) return;
    fetch("/v1/cancel", { method: "POST" }).catch(() => {});
    abortRef.current.abort();
    abortRef.current = null;
    setMessages(appendTransientNotice(notice));
  }

  async function serverAction(action) {
    if ((action === "stop" || action === "restart") && abortRef.current) {
      abortGeneration("Interrupted by server action.");
    }
    setServerBusy(true);
    setError("");
    try {
      let body;
      if (action !== "stop") {
        if (commandIsCustom) {
          body = JSON.stringify({ command: commandDraft });
        } else if (action === "restart") {
          body = JSON.stringify(config);
        }
      }
      const headers = body ? { "Content-Type": "application/json" } : undefined;
      const data = await jsonFetch(`/api/server/${action}`, { method: "POST", headers, body });
      setStatus((prev) => ({ ...prev, ...data }));
      await refreshStatus({ syncConfig: action === "restart" && !commandIsCustom });
    } catch (err) {
      setError(err.message);
    } finally {
      setServerBusy(false);
    }
  }

  async function sendChunkedMessage(text) {
    setInput("");
    setError("");
    const userVisible = attachedDoc
      ? `${text}\n\n_(attachment: ${attachedDoc.name}, ~${attachedDoc.approxTokens} tokens)_`
      : text;
    const nextMessages = [
      ...messages,
      { role: "user", content: userVisible },
      { role: "assistant", content: "", reasoning: "" }
    ];
    setMessages(nextMessages);
    setHistoryAutoLoaded(true);

    const controller = new AbortController();
    abortRef.current = controller;
    setGenerationBusy(true);
    setChunkProgress({ phase: "split", current: 0, total: 0 });

    const tRequestStart = performance.now();
    let tFirstToken = null;
    let tLastToken = null;
    let streamUsage = null;
    let totalPromptTokens = 0;
    let totalCompletionTokens = 0;
    let totalChunks = 0;
    let liveStats = createLiveStatsTracker({
      requestStartMs: tRequestStart,
      promptTokens: estimateTokenCount(`${attachedDoc.markdown}\n\n${text}`)
    });

    try {
      const payload = {
        document: attachedDoc.markdown,
        question: text,
        system: request.system,
        chunkTokens: Number(searchChunkTokens) || 25000,
        request: {
          model: request.model,
          max_tokens: Number(request.max_tokens),
          temperature: Number(request.temperature),
          top_p: Number(request.top_p),
          top_k: Number(request.top_k),
          min_p: Number(request.min_p),
          thinking: Boolean(request.thinking),
          reasoning_effort: request.reasoning_effort,
          seed: String(request.seed).trim() === "" ? undefined : Number(request.seed)
        }
      };
      const res = await fetch("/api/files/chunked-analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
      if (!res.ok) throw new Error(await res.text());

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const blocks = buffer.split(/\r?\n\r?\n/);
        buffer = blocks.pop() || "";
        for (const block of blocks) {
          const lines = block.split(/\r?\n/);
          let event = "message";
          const dataLines = [];
          for (const line of lines) {
            if (line.startsWith("event:")) event = line.slice(6).trim();
            else if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
          }
          if (!dataLines.length) continue;
          let data;
          try {
            data = JSON.parse(dataLines.join("\n"));
          } catch {
            continue;
          }
          if (event === "phase") {
            if (data.phase === "split") {
              totalChunks = data.chunks;
              setChunkProgress({ phase: "split", current: 0, total: data.chunks });
            } else if (data.phase === "reduce") {
              setChunkProgress({ phase: "reduce", current: totalChunks, total: totalChunks });
              setMessages(appendAssistantNotice(`---\n\n### Final answer (reduce over ${totalChunks} sections)\n`));
            }
          } else if (event === "chunk_start") {
            setChunkProgress({ phase: "map", current: data.index + 1, total: data.total });
          } else if (event === "chunk_done") {
            const header = `### Section ${data.index + 1}/${totalChunks}${data.title ? " — " + data.title : ""}`;
            const body = (data.summary || "").trim() || "_(riassunto vuoto)_";
            setMessages(appendAssistantNotice(`${header}\n\n${body}`));
            if (data.usage) {
              totalPromptTokens += data.usage.prompt_tokens || 0;
              totalCompletionTokens += data.usage.completion_tokens || 0;
              liveStats = {
                ...liveStats,
                promptTokens: totalPromptTokens || liveStats.promptTokens,
                completionTokensBase: totalCompletionTokens
              };
            }
          } else if (event === "reduce_delta") {
            const content = data.content || "";
            const reasoning = data.reasoning || "";
            const tDelta = performance.now();
            if (tFirstToken === null) tFirstToken = tDelta;
            tLastToken = tDelta;
            if (content || reasoning) {
              const live = updateLiveStats(liveStats, {
                content,
                reasoning,
                nowMs: tDelta,
                promptTokens: totalPromptTokens || liveStats.promptTokens
              });
              liveStats = live.tracker;
              setRuntimeStats(live.stats);
            }
            setMessages(appendAssistantDelta(content, reasoning));
          } else if (event === "usage") {
            streamUsage = data;
          } else if (event === "error") {
            setMessages(appendTransientNotice(`Error: ${data.error}`));
          } else if (event === "done") {
            setChunkProgress(null);
          }
        }
      }
      if (streamUsage) {
        totalPromptTokens += streamUsage.prompt_tokens || 0;
        totalCompletionTokens += streamUsage.completion_tokens || 0;
      }
      if (tFirstToken !== null) {
        setRuntimeStats(streamStatsFromTiming({
          requestStartMs: tRequestStart,
          firstTokenMs: tFirstToken,
          lastTokenMs: tLastToken,
          promptTokens: totalPromptTokens,
          completionTokens: totalCompletionTokens,
          stream: true
        }));
      }
      setAttachedDoc(null);
    } catch (err) {
      if (err.name !== "AbortError") setMessages(appendTransientNotice(`Stream failed: ${err.message}`));
    } finally {
      setGenerationBusy(false);
      setChunkProgress(null);
      if (abortRef.current === controller) abortRef.current = null;
    }
  }

  async function toggleAgentMode(start, { notice = true } = {}) {
    try {
      const res = await fetch(start ? "/api/agent/start" : "/api/agent/stop", {
        method: "POST",
        headers: AGENT_HEADERS
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setAgentMode(data.active);
      setAgentStatus(data);
      if (notice) {
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: `Agent mode ${data.active ? "started" : "stopped"}.`,
            agentNotice: true
          }
        ]);
      }
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: `Failed to toggle agent: ${err.message}`, agentNotice: true }
      ]);
    }
  }

  async function sendAgentMessage(text) {
    setInput("");
    setError("");
    const nextMessages = [
      ...messages,
      { role: "user", content: text },
      { role: "assistant", content: "", reasoning: "" }
    ];
    setMessages(nextMessages);
    setHistoryAutoLoaded(true);

    const controller = new AbortController();
    abortRef.current = controller;
    setGenerationBusy(true);
    const tRequestStart = performance.now();
    let streamUsage = null;
    let liveStats = createLiveStatsTracker({
      requestStartMs: tRequestStart,
      promptTokens: estimateTokenCount(
        [...messages.map((message) => message.content || ""), text].join("\n\n")
      )
    });

    try {
      const payload = {
        message: text,
        messages: messages,
        request: { ...request }
      };

      const res = await fetch("/api/agent/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...AGENT_HEADERS },
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      if (!res.ok) throw new Error(await res.text());

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split(/\r?\n\r?\n/);
        buffer = parts.pop() || "";

        for (const part of parts) {
          const lines = part.split(/\r?\n/);
          let event = "message";
          const dataLines = [];
          for (const line of lines) {
            if (line.startsWith("event:")) event = line.slice(6).trim();
            else if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
          }
          if (!dataLines.length) continue;
          let data;
          try { data = JSON.parse(dataLines.join("\n")); } catch { continue; }

          if (event === "agent_status") {
            setAgentStatus((prev) => ({ ...prev, ...data }));
          } else if (event === "agent_text") {
            const content = data.content || "";
            if (content) {
              const live = updateLiveStats(liveStats, { content, nowMs: performance.now() });
              liveStats = live.tracker;
              setRuntimeStats(live.stats);
            }
            setMessages(appendAssistantDelta(content, ""));
          } else if (event === "agent_reasoning") {
            const reasoning = data.content || "";
            if (reasoning) {
              const live = updateLiveStats(liveStats, { reasoning, nowMs: performance.now() });
              liveStats = live.tracker;
              setRuntimeStats(live.stats);
            }
            setMessages(appendAssistantDelta("", reasoning));
          } else if (event === "agent_tool_call") {
            setMessages((prev) => {
              const last = prev[prev.length - 1];
              if (last.role !== "assistant") return prev;
              const toolCalls = last.tool_calls || [];
              const argsStr = typeof data.arguments === "object" ? JSON.stringify(data.arguments, null, 2) : data.arguments;
              return [
                ...prev.slice(0, -1),
                { ...last, tool_calls: [...toolCalls, { id: data.id, name: data.name, arguments: argsStr }] }
              ];
            });
          } else if (event === "agent_tool_progress") {
            setMessages((prev) => {
              const next = [...prev];
              for (let i = next.length - 1; i >= 0; i--) {
                if (next[i].role !== "assistant") continue;
                const calls = next[i].tool_calls || [];
                const idx = calls.findIndex((c) => c.id === data.id);
                if (idx < 0) break;
                const newCalls = [...calls];
                newCalls[idx] = {
                  ...newCalls[idx],
                  progress: (newCalls[idx].progress || "") + (data.chunk || "")
                };
                next[i] = { ...next[i], tool_calls: newCalls };
                break;
              }
              return next;
            });
          } else if (event === "agent_tool_result") {
            setMessages((prev) => [
              ...prev,
              { role: "tool", tool_call_id: data.id, name: data.name, content: data.content, isError: data.isError, guarded: data.guarded },
              { role: "assistant", content: "", reasoning: "" }
            ]);
          } else if (event === "agent_usage") {
            streamUsage = data;
            setRuntimeStats(finalizeLiveStats(liveStats, {
              promptTokens: data.prompt_tokens,
              completionTokens: data.completion_tokens,
              stream: true
            }));
          } else if (event === "agent_error") {
            setMessages(appendTransientNotice(`Agent Error: ${data.error}`));
          } else if (event === "agent_done") {
            // Done
          }
        }
      }
      if (streamUsage) {
        setRuntimeStats(finalizeLiveStats(liveStats, {
          promptTokens: streamUsage.prompt_tokens,
          completionTokens: streamUsage.completion_tokens,
          stream: true
        }));
      }
    } catch (err) {
      if (err.name !== "AbortError") setMessages(appendTransientNotice(`Agent Stream failed: ${err.message}`));
    } finally {
      setGenerationBusy(false);
      if (abortRef.current === controller) abortRef.current = null;
    }
  }

  async function sendMessage() {
    const text = input.trim();
    if (!text || !canSend) return;

    if (text.toLowerCase() === "/agent pi start") {
      setInput("");
      return toggleAgentMode(true);
    }
    if (text.toLowerCase() === "/agent pi stop") {
      setInput("");
      return toggleAgentMode(false);
    }

    if (agentMode) {
      return sendAgentMessage(text);
    }

    if (attachedDoc && searchStrategy === "D") {
      return sendChunkedMessage(text);
    }

    setInput("");
    setError("");
    const nextMessages = [
      ...messages,
      { role: "user", content: text },
      { role: "assistant", content: "", reasoning: "" }
    ];
    setMessages(nextMessages);
    setHistoryAutoLoaded(true);

    const controller = new AbortController();
    abortRef.current = controller;
    setGenerationBusy(true);

    try {
      const chatMessages = [];
      if (request.system.trim()) chatMessages.push({ role: "system", content: request.system });
      for (const message of nextMessages.filter((item) => item.role !== "assistant" || item.content)) {
        chatMessages.push({ role: message.role, content: message.content });
      }

      const payload = buildChatPayload(request, chatMessages);

      const tRequestStart = performance.now();
      let tFirstToken = null;
      let tLastToken = null;
      let streamUsage = null;
      let liveStats = createLiveStatsTracker({
        requestStartMs: tRequestStart,
        promptTokens: estimateTokenCount(chatMessages.map((message) => message.content).join("\n\n"))
      });

      const res = await fetch("/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
      if (!res.ok) throw new Error(await res.text());

      if (!request.stream) {
        const data = await res.json();
        const message = data.choices?.[0]?.message || {};
        setMessages(replaceAssistantMessage(message.content || "", message.reasoning_content || message.reasoning || ""));
        if (data.usage) {
          const tEnd = performance.now();
          const totalS = (tEnd - tRequestStart) / 1000;
          setRuntimeStats({
            promptTokens: data.usage.prompt_tokens,
            completionTokens: data.usage.completion_tokens,
            prefillTps: null,
            genTps: totalS > 0 ? data.usage.completion_tokens / totalS : null,
            stream: false
          });
        }
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split(/\r?\n\r?\n/);
        buffer = parts.pop() || "";

        for (const part of parts) {
          const raw = parseSseData(part);
          if (!raw || raw === "[DONE]") continue;
          let event;
          try {
            event = JSON.parse(raw);
          } catch {
            continue;
          }
          if (event.usage) streamUsage = event.usage;
          const delta = event.choices?.[0]?.delta || {};
          const content = delta.content || "";
          const reasoning = delta.reasoning_content || delta.reasoning || "";
          if (content || reasoning) {
            const tDelta = performance.now();
            if (tFirstToken === null) tFirstToken = tDelta;
            tLastToken = tDelta;
            const live = updateLiveStats(liveStats, { content, reasoning, nowMs: tDelta });
            liveStats = live.tracker;
            setRuntimeStats(live.stats);
            setMessages(appendAssistantDelta(content, reasoning));
          }
        }
      }
      if (streamUsage && tFirstToken !== null) {
        setRuntimeStats(streamStatsFromTiming({
          requestStartMs: tRequestStart,
          firstTokenMs: tFirstToken,
          lastTokenMs: tLastToken,
          promptTokens: streamUsage.prompt_tokens,
          completionTokens: streamUsage.completion_tokens,
          stream: true
        }));
      }
    } catch (err) {
      if (err.name !== "AbortError") setMessages(appendTransientNotice(`Stream failed: ${err.message}`));
    } finally {
      setGenerationBusy(false);
      if (abortRef.current === controller) abortRef.current = null;
    }
  }

  if (!config || !status) {
    return (
      <>
        <main className="app-shell">
          <section className="panel">Loading DS4 Studio...</section>
        </main>
        <RocmFooter rocm={rocm} stats={runtimeStats} />
      </>
    );
  }

  return (
    <>
      <main className="studio">
        <aside className="left-rail panel">
        <div className="brand-row">
          <Terminal size={20} />
          <h1>DS4 Studio</h1>
        </div>
        <div className={`status-pill ${status.running ? "ok" : "bad"}`}>{status.running ? "Running" : "Stopped"}</div>
        <div className={`status-pill ${status.healthy ? "ok" : "warn"}`}>
          {status.healthy ? "Healthy" : "Waiting for backend"}
        </div>
        {error ? <div className="status-pill bad">{error}</div> : null}
        <div className="button-row">
          <button type="button" onClick={() => serverAction("start")} disabled={serverBusy}>
            <Play size={16} />
            Start
          </button>
          <button type="button" onClick={() => serverAction("stop")} disabled={serverBusy}>
            <Power size={16} />
            Stop
          </button>
          <button type="button" onClick={() => serverAction("restart")} disabled={serverBusy}>
            <RefreshCw size={16} />
            Restart
          </button>
        </div>
        <label className="field full">
          <span>Command preview</span>
          <textarea
            value={effectiveCommand}
            rows={6}
            spellCheck={false}
            onChange={(event) => setCommandDraft(event.target.value)}
            title="Edit to start ds4-server with a custom command. Reset returns to the form."
          />
          {commandIsCustom ? (
            <button
              type="button"
              className="command-reset"
              onClick={() => setCommandDraft(null)}
              title="Discard override and use the Startup form"
            >
              Reset to form
            </button>
          ) : null}
        </label>
        {commandIsCustom ? <div className="status-pill warn">Custom command override</div> : null}
        {hasPendingStartup ? <div className="status-pill warn">Pending restart</div> : null}
        <section className="log-tail">
          <h2>Logs</h2>
          {(status.logs || []).slice(-12).map((line, index) => (
            <pre key={`${line.time}-${index}`}>{line.message}</pre>
          ))}
        </section>
        </aside>

        <section className="chat-panel panel">
        <div className="chat-header">
          <button
            type="button"
            className="new-session-btn"
            onClick={startNewSession}
            disabled={generationBusy || !messages.length}
            title="Start a new chat session (clears messages and attachments)"
          >
            <Plus size={16} />
            New session
          </button>
          {agentMode && (
            <div className="agent-badge" title={`Agent Mode Active - Iteration ${agentStatus?.iteration || 0}`}>
              <div className="agent-indicator"></div>
              <span>Agent Active</span>
              <button
                type="button"
                className="agent-stop-btn"
                onClick={() => toggleAgentMode(false)}
                title="Stop Agent Mode"
              >
                <Square size={12} />
              </button>
            </div>
          )}
        </div>
        <div className="messages" ref={messagesRef}>
          {messages.map((message, index) => (
            <article className={`message ${message.role}`} key={index}>
              <strong>{message.role}</strong>
              {message.reasoning ? (
                <details>
                  <summary>Reasoning</summary>
                  <MessageContent content={message.reasoning} />
                </details>
              ) : null}
              {message.tool_calls ? (
                <div className="tool-calls-container">
                  {message.tool_calls.map(tc => (
                    <div key={tc.id} className="tool-call-block">
                      <div className="tool-call-header">Tool Call: <code>{tc.name}</code></div>
                      <pre className="tool-call-args">{tc.arguments}</pre>
                      {tc.progress ? (
                        <pre className="tool-call-progress" aria-live="polite">{tc.progress}</pre>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : null}
              {message.role === "tool" ? (
                <div className={`tool-result-block ${message.isError ? "error" : ""} ${message.guarded ? "guarded" : ""}`}>
                  <div className="tool-result-header">
                    Tool Result: <code>{message.name}</code>
                    {message.guarded ? <span className="tool-result-guard">guarded</span> : null}
                  </div>
                  <pre className="tool-result-content">{message.content}</pre>
                </div>
              ) : (
                <MessageContent content={message.content} />
              )}
            </article>
          ))}
        </div>
        <div className="export-row">
          <button
            type="button"
            onClick={downloadConversation}
            disabled={!messages.length}
            title="Export the whole conversation as Obsidian-compatible Markdown"
          >
            <Download size={16} />
            Export MD
          </button>
          {exportNotice ? (
            <div className={`export-notice ${exportNotice.kind}`} role="status" aria-live="polite">
              {exportNotice.message}
              <button
                type="button"
                className="export-notice-close"
                onClick={() => setExportNotice(null)}
                aria-label="Dismiss notice"
                title="Dismiss"
              >×</button>
            </div>
          ) : null}
        </div>
        {attachedDoc ? (
          <div className="attachments">
            <span className="attachment-chip">
              {attachedDoc.name} · ~{attachedDoc.approxTokens.toLocaleString()} tokens · strategy {searchStrategy}
              <button
                type="button"
                className="attachment-remove"
                onClick={() => setAttachedDoc(null)}
                title="Remove attachment"
                disabled={generationBusy}
              >×</button>
            </span>
          </div>
        ) : null}
        {chunkProgress ? (
          <div className="attachments">
            <span className="attachment-chip">
              {chunkProgress.phase === "map"
                ? `Map ${chunkProgress.current}/${chunkProgress.total}`
                : chunkProgress.phase === "reduce"
                  ? `Reduce over ${chunkProgress.total} sections`
                  : `Split: ${chunkProgress.total} sections`}
            </span>
          </div>
        ) : null}
        {uploadedFiles.length && !attachedDoc ? (
          <div className="attachments">
            {uploadedFiles.map((file) => (
              <span key={file.extractPath}>{file.name}</span>
            ))}
          </div>
        ) : null}
        <div className="composer">
          <input
            ref={fileInputRef}
            className="file-input"
            type="file"
            accept={fileAccept}
            onChange={(event) => {
              uploadFile(event.target.files?.[0]);
              event.target.value = "";
            }}
          />
          <button
            className="icon-button"
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploadBusy || generationBusy}
            title="Add file"
            aria-label="Add file"
          >
            <Plus size={18} />
          </button>
          <textarea
            ref={composerRef}
            value={input}
            title="Message to send to the model. Paste text with right-click."
            placeholder="Write a message..."
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) sendMessage();
            }}
          />
          {generationBusy ? (
            <button
              className="send-button stop-button"
              type="button"
              onClick={() => abortGeneration("Interrupted.")}
              title="Stop generation"
              aria-label="Stop"
            >
              <Square size={16} />
              Stop
            </button>
          ) : (
            <button className="send-button" type="button" onClick={sendMessage} disabled={!canSend || uploadBusy}>
              <Send size={16} />
              Send
            </button>
          )}
        </div>
        </section>

        <aside className="right-rail panel">
        <div className="tabs">
          <button type="button" className={tab === "request" ? "active" : ""} onClick={() => setTab("request")}>
            Request
          </button>
          <button type="button" className={tab === "profile" ? "active" : ""} onClick={() => setTab("profile")}>
            Profile
          </button>
          <button type="button" className={tab === "startup" ? "active" : ""} onClick={() => setTab("startup")}>
            Startup
          </button>
          <button type="button" className={tab === "strategy" ? "active" : ""} onClick={() => setTab("strategy")}>
            Strategy
          </button>
          <button type="button" className={tab === "history" ? "active" : ""} onClick={() => setTab("history")}>
            History
          </button>
          <button type="button" className={tab === "export" ? "active" : ""} onClick={() => setTab("export")}>
            Export
          </button>
          <button type="button" className={tab === "logs" ? "active" : ""} onClick={() => setTab("logs")}>
            Logs
          </button>
        </div>
        {tab === "request" ? (
          <div className="form-grid">
            {Object.entries(request)
              .filter(([key]) => key !== "system" && key !== "model" && key !== "endpoint")
              .map(([key, value]) => (
                <label className="field" key={key} data-tooltip={requestHelp(key)}>
                  <span>{key}</span>
                  {typeof value === "boolean" ? (
                    <input type="checkbox" checked={value} aria-label={`${key}: ${requestHelp(key)}`} onChange={(event) => updateRequestField(key, event.target.checked)} />
                  ) : key === "stop" ? (
                    <textarea
                      value={value}
                      placeholder={REQUEST_PLACEHOLDERS[key] || ""}
                      onChange={(event) => updateRequestField(key, event.target.value)}
                      rows={3}
                    />
                  ) : (
                    <input
                      value={value}
                      placeholder={REQUEST_PLACEHOLDERS[key] || ""}
                      onChange={(event) => updateRequestField(key, event.target.value)}
                    />
                  )}
                </label>
              ))}
          </div>
        ) : null}
        {tab === "profile" ? (
          <div className="profile-panel">
            <p className="profile-help">
              I profili impostano sia i parametri server (ctx, KV cache, port, ...) che i default di richiesta
              (temperature, thinking, max_tokens, ...). Le modifiche ai parametri server richiedono il riavvio del
              backend ds4-server.
            </p>
            <div className="profile-list">
              {profiles.length === 0 ? (
                <div className="profile-empty">Nessun profilo trovato in /profiles/</div>
              ) : profiles.map((p) => {
                const isActive = status?.profile?.selected === p.name;
                return (
                  <label key={p.name} className={`profile-item${isActive ? " active" : ""}`}>
                    <input
                      type="radio"
                      name="profile"
                      checked={isActive}
                      disabled={profileBusy}
                      onChange={() => selectProfile(p.name)}
                    />
                    <div className="profile-meta">
                      <div className="profile-name">{p.label}</div>
                      <div className="profile-file">{p.name}.json</div>
                      {p.description ? <div className="profile-desc">{p.description}</div> : null}
                      {p.error ? <div className="profile-error">Errore: {p.error}</div> : null}
                    </div>
                  </label>
                );
              })}
            </div>
            {profileNotice ? <div className="profile-notice">{profileNotice}</div> : null}
          </div>
        ) : null}
        {tab === "startup" ? (
          <div className="startup-groups">
            {STARTUP_GROUPS.map(([title, keys]) => (
              <section key={title}>
                <h2>{title}</h2>
                <div className="form-grid">
                  {keys.map((key) => (
                    <label className="field" key={key} data-tooltip={startupHelp(key)}>
                      <span>{FIELD_LABELS[key]}</span>
                      {fieldType(key) === "checkbox" ? (
                        <input
                          type="checkbox"
                          checked={Boolean(config.server[key])}
                          aria-label={`${FIELD_LABELS[key]}: ${startupHelp(key)}`}
                          onChange={(event) => updateServerField(key, event.target.checked)}
                        />
                      ) : fieldType(key) === "select" ? (
                        <select
                          value={config.server[key]}
                          aria-label={`${FIELD_LABELS[key]}: ${startupHelp(key)}`}
                          onChange={(event) => updateServerField(key, event.target.value)}
                        >
                          <option value="auto">auto</option>
                          <option value="metal">metal</option>
                          <option value="cuda">cuda</option>
                          <option value="cpu">cpu</option>
                        </select>
                      ) : (
                        <input
                          type={fieldType(key)}
                          value={config.server[key]}
                          placeholder={STARTUP_PLACEHOLDERS[key] || ""}
                          onChange={(event) =>
                            fieldType(key) === "number"
                              ? updateNumberServerField(key, event.target.value)
                              : updateServerField(key, event.target.value)
                          }
                        />
                      )}
                    </label>
                  ))}
                </div>
              </section>
            ))}
          </div>
        ) : null}
        {tab === "strategy" ? (
          <div className="strategy-panel">
            <p className="strategy-intro">
              Analysis strategy when a file is attached to the message.
              Documenti lunghi superano il context: la strategia spezza il file e processa a pezzi.
            </p>
            <label className="field full" data-tooltip="Target tokens per chunk. Leave headroom below the context size.">
              <span>Chunk tokens</span>
              <input
                type="number"
                min={2000}
                step={1000}
                value={searchChunkTokens}
                onChange={(event) => setSearchChunkTokens(Number(event.target.value) || 25000)}
              />
            </label>
            {STRATEGY_OPTIONS.map((opt) => (
              <label
                key={opt.key}
                className={`strategy-option ${searchStrategy === opt.key ? "selected" : ""} ${opt.disabled ? "disabled" : ""}`}
              >
                <input
                  type="radio"
                  name="search-strategy"
                  value={opt.key}
                  checked={searchStrategy === opt.key}
                  disabled={opt.disabled}
                  onChange={() => setSearchStrategy(opt.key)}
                />
                <div className="strategy-body">
                  <strong>
                    {opt.key}. {opt.title}
                    {opt.disabled ? <span className="strategy-badge">in arrivo</span> : null}
                    {opt.recommended ? <span className="strategy-badge ok">consigliata</span> : null}
                  </strong>
                  <p>{opt.description}</p>
                  <p className="strategy-meta">{opt.tradeoff}</p>
                </div>
              </label>
            ))}
          </div>
        ) : null}
        {tab === "history" ? (
          <div className="history-panel">
            <label className="setting-row">
              <input
                type="checkbox"
                checked={Boolean((historyDraft || historyConfig).enabled)}
                onChange={(event) => updateHistoryDraft("enabled", event.target.checked)}
              />
              <span>Keep chat history</span>
            </label>
            <label className="field full" data-tooltip="Server-side directory where Markdown history files are saved.">
              <span>History folder</span>
              <input
                value={(historyDraft || historyConfig).dir || ""}
                placeholder="/home/tendermachine/workspace_ds4studio/history"
                onChange={(event) => updateHistoryDraft("dir", event.target.value)}
              />
            </label>
            <div className="button-row">
              <button type="button" onClick={saveHistorySettings} disabled={historyBusy}>
                Save history settings
              </button>
              <button type="button" onClick={() => refreshHistorySessions()} disabled={historyListBusy}>
                Refresh sessions
              </button>
              <button
                type="button"
                onClick={deleteAllHistorySessions}
                disabled={historyListBusy || !historySessions.length}
                title="Delete every session file in the history folder"
              >
                Delete all
              </button>
            </div>
            {historyStatus ? <div className="status-pill">{historyStatus}</div> : null}
            <div className="history-session-list">
              {historyListBusy ? <div className="status-pill">Loading sessions...</div> : null}
              {!historyListBusy && !historySessions.length ? (
                <div className="status-pill warn">No saved sessions</div>
              ) : null}
              {historySessions.map((session) => (
                <div
                  className="history-session-row"
                  key={session.fileName}
                >
                  <button
                    type="button"
                    className="history-session"
                    onClick={() => loadHistorySession(session.fileName)}
                    title={session.fileName}
                  >
                    <strong>{session.title}</strong>
                    <span>{session.fileName}</span>
                    <small>{session.messages} messages · {(session.size / 1024).toFixed(1)} KB</small>
                  </button>
                  <button
                    type="button"
                    className="history-session-delete"
                    onClick={() => deleteHistorySession(session.fileName)}
                    title={`Delete ${session.fileName}`}
                    disabled={historyListBusy}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          </div>
        ) : null}
        {tab === "export" ? (
          <ExportSettingsPanel
            includeReasoning={exportSettings.includeReasoning}
            saved={exportSettings.saved}
            onIncludeReasoningChange={saveExportPreference}
            onForget={forgetExportPreference}
            exportDir={exportDir}
            exportDirDraft={exportDirDraft}
            exportDirStatus={exportDirStatus}
            onExportDirDraftChange={setExportDirDraft}
            onSaveExportDir={saveExportDir}
            onClearExportDir={clearExportDir}
          />
        ) : null}
        {tab === "logs" ? (
          <div className="logs-large">
            {(status.logs || []).map((line, index) => (
              <pre key={`${line.time}-${index}`}>
                {line.time} {line.stream}: {line.message}
              </pre>
            ))}
          </div>
        ) : null}
        </aside>
      </main>
      {exportDialogOpen ? (
        <ExportDialog
          includeReasoning={exportDialogIncludeReasoning}
          onIncludeReasoningChange={setExportDialogIncludeReasoning}
          onCancel={() => setExportDialogOpen(false)}
          onConfirm={confirmExportDialog}
        />
      ) : null}
      <RocmFooter rocm={rocm} stats={runtimeStats} />
    </>
  );
}
