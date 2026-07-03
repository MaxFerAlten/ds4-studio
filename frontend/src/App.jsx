import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Play, Power, RefreshCw, Terminal } from "lucide-react";

import { commandLineFromConfig } from "../server/commandBuilder.mjs";
import { REQUEST_DEFAULTS } from "../server/defaultConfig.mjs";
import { buildChatPayload, isAutoMaxTokens } from "../server/requestPayload.mjs";
import { backendHealthLabel, backendStartupDetail, streamFailureNotice, formatNativeAgentNotice, parseAgentInput, withAgentPriming, historyHasPersistableAssistant, sessionHasAgentMetadata, sessionsExposeMetadata, clearStoredExportIncludeReasoning, readStoredExportDir, readStoredExportIncludeReasoning, writeStoredExportDir, writeStoredExportIncludeReasoning, createDeltaBatcher, documentIsVisible, clearCallDebug, fetchCallDebug } from "./utils.mjs";
import { exportConversationMarkdown, markdownFileName } from "./conversationExport.mjs";
import { ChatPanel } from "./chat/ChatPanel.jsx";
import { RequestPanel, ProfilePanel, StartupPanel, StrategyPanel, LogsPanel, MetricsPanel, CompressionPanel, CallDebugPanel, PageAgentPanel } from "./panels/RightRailPanels.jsx";
import { LeftRail } from "./panels/LeftRail.jsx";
import { HistoryPanel } from "./panels/HistoryPanel.jsx";
import { listResearchSessions } from "./research/researchApi.mjs";
import {
  AGENT_HEADERS, AGENT_COMMANDS, ENV_FIELDS,
  appendAssistantDelta, replaceAssistantMessage,
  appendAssistantNotice, appendTransientNotice, buildChatMessages, injectSearchResults, searchResultsBlock,
  parseSseData, formatMetric, initialExportSettings,
  readStoredSession, writeStoredSession, clearStoredSession
} from "./appLogic.mjs";
import {
  createLiveStatsTracker,
  estimateTokenCount,
  finalizeLiveStats,
  streamStatsFromTiming,
  updateLiveStats
} from "./throughputStats.mjs";

async function jsonFetch(url, options) {
  const res = await fetch(url, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || data.message || `HTTP ${res.status}`);
  return data;
}


function RocmFooter({ rocm, stats }) {
  const gpus = rocm?.gpus || [];
  const source = rocm?.source === "amd-smi" ? "AMD SMI" : "ROCm SMI";
  return (
    <footer className={`rocm-footer ${rocm?.ok === false ? "warn" : ""}`}>
      <strong>{source}</strong>
      {rocm?.ok === false ? <span>{rocm.error || "unavailable"}</span> : null}
      {gpus.length
        ? gpus.map((gpu) => (
            <span className="rocm-card" key={gpu.id}>
              GPU{gpu.index}
              {gpu.temperatureC != null ? <b>{formatMetric(gpu.temperatureC, "°C")}</b> : null}
              {gpu.powerW != null ? <b>{formatMetric(gpu.powerW, "W")}</b> : null}
              {gpu.gpuUsePercent != null ? <b>GPU {formatMetric(gpu.gpuUsePercent, "%")}</b> : null}
              {gpu.gttUsePercent != null
                ? <b>GTT {formatMetric(Math.round(gpu.gttUsePercent), "%")}</b>
                : gpu.vramUsePercent != null
                  ? <b>VRAM {formatMetric(gpu.vramUsePercent, "%")}</b>
                  : null}
              {gpu.fanPercent != null ? <b>Fan {formatMetric(gpu.fanPercent, "%")}</b> : null}
              {gpu.fclkMhz != null ? <b>FCLK {gpu.fclkMhz}MHz</b> : gpu.sclk ? <b>SCLK {gpu.sclk}</b> : null}
              {gpu.mclk ? <b>MCLK {gpu.mclk}</b> : null}
              {gpu.perfLevel ? <b>{gpu.perfLevel.replace(/^AMDSMI_DEV_PERF_LEVEL_/, "")}</b> : null}
            </span>
          ))
        : rocm?.ok !== false
          ? <span>waiting...</span>
          : null}
      {stats ? (
        <span className="rocm-card">
          <strong>Throughput</strong>
          <b title="Token realmente prefilleri divisi per il tempo al primo token">
            prefill effettivo {stats.prefillTps != null ? `${stats.prefillTps.toFixed(2)} t/s` : "n/a"}
          </b>
          <b title="Prompt totale, inclusi i token recuperati dalla cache, diviso per il tempo al primo token">
            prefill con cache {stats.prefillWithCacheTps != null ? `${stats.prefillWithCacheTps.toFixed(2)} t/s` : "n/a"}
          </b>
          <b>gen {stats.genTps != null ? `${stats.genTps.toFixed(2)} t/s` : "n/a"}</b>
          <b>in {stats.promptTokens ?? 0}</b>
          <b>out {stats.completionTokens ?? 0}</b>
        </span>
      ) : null}
    </footer>
  );
}

function ExportDialog({ includeReasoning, exportMode, onIncludeReasoningChange, onExportModeChange, onCancel, onConfirm }) {
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
        <label className="radio-line">
          <span className="radio-label">Mode:</span>
          <label className="radio-option">
            <input
              type="radio"
              name="exportMode"
              value="obsidian"
              checked={exportMode === "obsidian"}
              onChange={() => onExportModeChange("obsidian")}
            />
            <span>Obsidian (KaTeX-normalized)</span>
          </label>
          <label className="radio-option">
            <input
              type="radio"
              name="exportMode"
              value="raw"
              checked={exportMode === "raw"}
              onChange={() => onExportModeChange("raw")}
            />
            <span>Raw (debug/resume)</span>
          </label>
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
  const [historyTab, setHistoryTab] = useState("chat");
  const [serverBusy, setServerBusy] = useState(false);
  const [callDebugEntries, setCallDebugEntries] = useState([]);
  const [callDebugEnabled, setCallDebugEnabled] = useState(true);
  const [callDebugBusy, setCallDebugBusy] = useState(false);
  const [callDebugNotice, setCallDebugNotice] = useState("");
  const [callDebugOpen, setCallDebugOpen] = useState({});
  const [generationBusy, setGenerationBusy] = useState(false);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [fileAccept, setFileAccept] = useState("");
  const [uploadedFiles, setUploadedFiles] = useState([]);
  const [rocm, setRocm] = useState(null);
  const [error, setError] = useState("");
  const [runtimeStats, setRuntimeStats] = useState(null);
  const [serverMetrics, setServerMetrics] = useState(null);
  const [metricsError, setMetricsError] = useState("");
  const [commandDraft, setCommandDraft] = useState(null);
  const [agentMode, setAgentMode] = useState(false);
  const [researchMode, setResearchMode] = useState(false);
  const [selectedResearchSessionId, setSelectedResearchSessionId] = useState(null);
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(0);
  const [hideSuggestions, setHideSuggestions] = useState(false);
  const [agentStatus, setAgentStatus] = useState(null);
  const [compressionMetrics, setCompressionMetrics] = useState(null);
  const [headroomEnabled, setHeadroomEnabled] = useState(false);
  const [webSearchMode, setWebSearchMode] = useState(false);
  const [searchStrategy, setSearchStrategy] = useState("F");
  const [searchChunkTokens, setSearchChunkTokens] = useState(25000);
  const [attachedDoc, setAttachedDoc] = useState(null);
  const [chunkProgress, setChunkProgress] = useState(null);
  const [exportSettings, setExportSettings] = useState(initialExportSettings);
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [exportDialogIncludeReasoning, setExportDialogIncludeReasoning] = useState(
    exportSettings.includeReasoning
  );
  const [exportDialogMode, setExportDialogMode] = useState(
    exportSettings.mode || "obsidian"
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
  const [researchSessions, setResearchSessions] = useState([]);
  const [researchHistoryBusy, setResearchHistoryBusy] = useState(false);
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
  // Set to true when the user enters agent mode while there is already a chat
  // history (typically an attached document the user wants to validate with
  // /sage). The next `sendAgentMessage` consumes the flag and prepends the
  // serialised history to the outbound message so the native agent — which
  // only receives a single `message` string per turn — gets the context. See
  // ./agentPriming.mjs for the rationale.
  const agentPrimingPendingRef = useRef(false);

  const refreshResearchSessions = useCallback(async () => {
    setResearchHistoryBusy(true);
    try {
      const sessions = await listResearchSessions();
      setResearchSessions(sessions);
      return sessions;
    } finally {
      setResearchHistoryBusy(false);
    }
  }, []);

  const handleResearchHistoryChange = useCallback(() => {
    refreshResearchSessions().catch((err) => {
      setHistoryStatus(`Research history error: ${err.message}`);
    });
  }, [refreshResearchSessions]);

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
    return data;
  }

  async function refreshServerMetrics() {
    const data = await jsonFetch("/api/server/metrics");
    setServerMetrics(data);
    setMetricsError("");
    return data;
  }

  async function refreshProfiles() {
    const data = await jsonFetch("/api/profiles");
    setProfiles(data.profiles || []);
    return data;
  }

  const refreshCallDebug = useCallback(async () => {
    setCallDebugBusy(true);
    setCallDebugNotice("");
    try {
      const { enabled, entries } = await fetchCallDebug({ limit: 200 });
      setCallDebugEnabled(enabled);
      setCallDebugEntries(entries);
    } catch (err) {
      setCallDebugNotice(err.message);
    } finally {
      setCallDebugBusy(false);
    }
  }, []);

  async function handleClearCallDebug() {
    setCallDebugNotice("");
    try {
      await clearCallDebug();
      setCallDebugEntries([]);
      setCallDebugOpen({});
    } catch (err) {
      setCallDebugNotice(err.message);
    }
  }

  useEffect(() => {
    if (tab === "call-debug") refreshCallDebug();
  }, [tab, refreshCallDebug]);

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
    refreshStatus({ syncConfig: true })
      .then((data) => {
        if (data?.running && data?.healthy) {
          return refreshServerMetrics().catch((err) => {
            setServerMetrics(null);
            setMetricsError(err.message);
          });
        }
        return null;
      })
      .catch((err) => setError(err.message));
    refreshRocmStatus().catch(() => setRocm({ ok: false, error: "amd-smi unavailable", gpus: [] }));
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
    const timer = setInterval(() => {
      if (!documentIsVisible()) return;
      refreshStatus()
        .then((data) => {
          if (data?.running && data?.healthy) {
            return refreshServerMetrics().catch((err) => {
              setServerMetrics(null);
              setMetricsError(err.message);
            });
          }
          setServerMetrics(null);
          return null;
        })
        .catch((err) => setError(err.message));
      /* Fetch compression metrics periodically when agent is active. */
      jsonFetch("/api/agent/compression-metrics")
        .then((data) => setCompressionMetrics(data))
        .catch(() => {});
    }, 3000);
    const rocmTimer = setInterval(
      () => {
        if (!documentIsVisible()) return;
        refreshRocmStatus().catch(() => setRocm({ ok: false, error: "amd-smi unavailable", gpus: [] }));
      },
      5000
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
    if (!config?.research?.enabled) {
      setResearchSessions([]);
      return;
    }
    handleResearchHistoryChange();
  }, [config?.research?.enabled, handleResearchHistoryChange]);

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
    if (!historyHasPersistableAssistant(messages)) return;

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
  const startupDetail = backendStartupDetail(status);
  const historyConfig = config?.history || { enabled: false, dir: "" };
  const historyMetadataAvailable = useMemo(
    () => sessionsExposeMetadata(historySessions),
    [historySessions]
  );
  const chatHistorySessions = useMemo(
    () => historySessions.filter((session) => !sessionHasAgentMetadata(session)),
    [historySessions]
  );
  const agentHistorySessions = useMemo(
    () => historySessions.filter(sessionHasAgentMetadata),
    [historySessions]
  );
  const activeConversationHistorySessions = historyTab === "agent" ? agentHistorySessions : chatHistorySessions;
  const activeConversationHistoryLabel = historyTab === "agent" ? "Agent sessions" : "Chat sessions";

  function updateServerField(key, value) {
    setCommandDraft(null);
    if (ENV_FIELDS.has(key)) {
      setConfig((prev) => ({
        ...prev,
        server: {
          ...prev.server,
          env: {
            ...(prev.server.env || {}),
            [key]: value
          }
        }
      }));
      return;
    }
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

  function loadResearchSession(sessionId) {
    setSelectedResearchSessionId(sessionId);
    setResearchMode(true);
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
    handleInputChange("");
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

  function browserDownloadMarkdown(includeReasoning, mode) {
    const exporter = mode === "raw" ? exportConversationMarkdownRaw : exportConversationMarkdown;
    const markdown = exporter(messages, { includeReasoning });
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

  function exportMarkdown(includeReasoning, mode) {
    if (!exportDir) {
      browserDownloadMarkdown(includeReasoning, mode);
      return;
    }
    const fileName = markdownFileName();
    setExportDirStatus(`Saving to ${exportDir}/${fileName}...`);
    showExportNotice("info", `Saving to ${exportDir}/${fileName}...`);
    jsonFetch("/api/export/conversation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages, includeReasoning, mode, dir: exportDir, fileName })
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
      exportMarkdown(includeReasoning, exportSettings.mode);
      return;
    }
    setExportDialogIncludeReasoning(exportSettings.includeReasoning);
    setExportDialogOpen(true);
  }

  function confirmExportDialog() {
    saveExportPreference(exportDialogIncludeReasoning);
    setExportSettings((prev) => ({ ...prev, mode: exportDialogMode }));
    setExportDialogOpen(false);
    exportMarkdown(exportDialogIncludeReasoning, exportDialogMode);
  }

  function appendFileToComposer(file) {
    if (searchStrategy === "F") {
      // Full context: show the whole document in the chat immediately and keep it
      // as part of the session context. Multiple files accumulate into the same
      // trailing user turn so chat role alternation stays valid on the next send.
      const docBlock = `\uD83D\uDCCE **${file.name}**\n\n${file.markdown}`;
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last && last.role === "user" && last.attachment) {
          return [...prev.slice(0, -1), { ...last, content: `${last.content}\n\n---\n\n${docBlock}` }];
        }
        return [...prev, { role: "user", content: docBlock, attachment: true }];
      });
      setHistoryAutoLoaded(true);
      return;
    }
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
    handleInputChange("");
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
    let totalCachedTokens = 0;
    let totalPrefillTokens = 0;
    let hasPromptTokenDetails = false;
    let totalChunks = 0;
    let liveStats = createLiveStatsTracker({
      requestStartMs: tRequestStart,
      promptTokens: estimateTokenCount(`${attachedDoc.markdown}\n\n${text}`)
    });
    const deltaBatcher = createDeltaBatcher((content, reasoning) => {
      setMessages(appendAssistantDelta(content, reasoning));
    });

    try {
      const payload = {
        document: attachedDoc.markdown,
        question: text,
        system: request.system,
        chunkTokens: Number(searchChunkTokens) || 25000,
        request: {
          model: request.model,
          max_tokens: isAutoMaxTokens(request.max_tokens) ? "auto" : Number(request.max_tokens),
          max_tokens_safety_cap: Number(request.max_tokens_safety_cap),
          context_margin: Number(request.context_margin),
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
              deltaBatcher.flush();
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
              const details = data.usage.prompt_tokens_details;
              if (details) {
                hasPromptTokenDetails = true;
                totalCachedTokens += details.cached_tokens || 0;
                totalPrefillTokens += details.cache_write_tokens || 0;
              }
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
            deltaBatcher.push(content, reasoning);
          } else if (event === "usage") {
            streamUsage = data;
          } else if (event === "error") {
            deltaBatcher.flush();
            setMessages(appendTransientNotice(`Error: ${data.error}`));
          } else if (event === "done") {
            deltaBatcher.flush();
            setChunkProgress(null);
          }
        }
      }
      deltaBatcher.flush();
      if (streamUsage) {
        totalPromptTokens += streamUsage.prompt_tokens || 0;
        totalCompletionTokens += streamUsage.completion_tokens || 0;
        const details = streamUsage.prompt_tokens_details;
        if (details) {
          hasPromptTokenDetails = true;
          totalCachedTokens += details.cached_tokens || 0;
          totalPrefillTokens += details.cache_write_tokens || 0;
        }
      }
      if (tFirstToken !== null) {
        setRuntimeStats(streamStatsFromTiming({
          requestStartMs: tRequestStart,
          firstTokenMs: tFirstToken,
          lastTokenMs: tLastToken,
          promptTokens: totalPromptTokens,
          promptTokensDetails: hasPromptTokenDetails ? {
            cached_tokens: totalCachedTokens,
            cache_write_tokens: totalPrefillTokens
          } : undefined,
          completionTokens: totalCompletionTokens,
          stream: true
        }));
      }
      setAttachedDoc(null);
    } catch (err) {
      if (err.name !== "AbortError") {
        deltaBatcher.flush();
        setMessages(appendTransientNotice(`Stream failed: ${err.message}`));
      }
    } finally {
      deltaBatcher.cancel();
      setGenerationBusy(false);
      setChunkProgress(null);
      if (abortRef.current === controller) abortRef.current = null;
    }
  }

  async function toggleAgentMode(start, { notice = true } = {}) {
    // Snapshot BEFORE the fetch: when the user flips into agent mode, any
    // already-visible chat turns (including a pending document attached with
    // the "+" button) must be replayed into the very first agent turn,
    // otherwise the native runtime starts with an empty context. We arm a ref
    // here and let `sendAgentMessage` consume it on the next send.
    const hasReplayableHistory = start && messages.some(
      (msg) => msg && !msg.agentNotice && (msg.role === "user" || msg.role === "assistant")
    );
    try {
      const res = await fetch(start ? "/api/agent/start" : "/api/agent/stop", {
        method: "POST",
        headers: AGENT_HEADERS
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setAgentMode(data.active);
      if (data.active && hasReplayableHistory) {
        agentPrimingPendingRef.current = true;
      } else if (!data.active) {
        // Leaving agent mode clears any pending priming intent: if the user
        // ever re-enters with fresh history, we'll re-arm it then.
        agentPrimingPendingRef.current = false;
      }
      setActiveSuggestionIndex(0);
      setHideSuggestions(false);
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

  async function callNativeAgentCommand(command) {
    try {
      const res = await fetch("/api/native-agent/command", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...AGENT_HEADERS },
        body: JSON.stringify({ command })
      });
      const text = await res.text();
      let payload;
      try {
        payload = JSON.parse(text);
      } catch {
        payload = { ok: false, message: text || `HTTP ${res.status}` };
      }
      if (payload.active === false) {
        setAgentMode(false);
        setAgentStatus((prev) => ({ ...prev, active: false }));
      }
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: formatNativeAgentNotice(command, payload, res.status),
          agentNotice: true,
          // /crawl results carry real content the user wants kept in exports.
          exportable: payload.command === "crawl" && payload.ok === true
        }
      ]);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `Failed ${command}: ${err.message}`,
          agentNotice: true
        }
      ]);
    }
  }

  async function callAgentStatus() {
    try {
      const res = await fetch("/api/wrapper/status", { headers: AGENT_HEADERS });
      const text = await res.text();
      let payload;
      try {
        payload = JSON.parse(text);
      } catch {
        payload = text;
      }
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: formatNativeAgentNotice(
            "/agent status",
            { message: "Wrapper status.", data: payload },
            res.status
          ),
          agentNotice: true
        }
      ]);
    } catch (err) {
      setMessages(appendTransientNotice(`Failed /agent status: ${err.message}`));
    }
  }

  async function callPonyControl(agentInput) {
    if (agentInput.action === "inactive") {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Pony mode applies only in Agent Mode. Run /agent start first.", agentNotice: true }
      ]);
      return;
    }
    if (agentInput.action === "invalid") {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: `Invalid /pony mode: ${agentInput.mode}. Use start, stop, status, lite, full, or ultra.`, agentNotice: true }
      ]);
      return;
    }
    try {
      const options = agentInput.action === "status"
        ? { method: "GET", headers: AGENT_HEADERS }
        : {
            method: "POST",
            headers: { "Content-Type": "application/json", ...AGENT_HEADERS },
            body: JSON.stringify({ mode: agentInput.mode })
          };
      const res = await fetch("/api/agent/pony", options);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setAgentStatus((prev) => ({ ...prev, ...data }));
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: data.message || `Pony mode: ${data.ponyMode || "off"}.`, agentNotice: true }
      ]);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: `Failed /pony: ${err.message}`, agentNotice: true }
      ]);
    }
  }

  async function callHeadroomControl(agentInput) {
    try {
      if (agentInput.action === "status") {
        const res = await fetch("/api/agent/headroom", { headers: AGENT_HEADERS });
        const data = await res.json().catch(() => ({ ok: false, enabled: false }));
        setHeadroomEnabled(data.enabled);
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: `Headroom compression ${data.enabled ? "enabled" : "disabled"}.`, agentNotice: true }
        ]);
        return;
      }
      const enabled = agentInput.action === "set" && Boolean(agentInput.enabled);
      const res = await fetch("/api/agent/headroom", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...AGENT_HEADERS },
        body: JSON.stringify({ enabled })
      });
      const data = await res.json().catch(() => ({ ok: false }));
      if (data.ok) {
        setHeadroomEnabled(enabled);
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: data.message || `Headroom compression ${enabled ? "enabled" : "disabled"}.`, agentNotice: true }
        ]);
      } else {
        throw new Error(data.error || "Failed to toggle headroom");
      }
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: `Failed /headroom: ${err.message}`, agentNotice: true }
      ]);
    }
  }

  async function callSageControl(action) {
    try {
      const res = await fetch("/api/sage/" + action, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...AGENT_HEADERS }
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: data.message || `SageMath ${action}ed.`,
          agentNotice: true
        }
      ]);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `Failed /sage ${action}: ${err.message}`,
          agentNotice: true
        }
      ]);
    }
  }

  async function callGitnexusControl(agentInput) {
    if (agentInput.action === "inactive") {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "GitNexus mode applies only in Agent Mode. Run /agent start first.", agentNotice: true }
      ]);
      return;
    }
    try {
      const options = agentInput.action === "status"
        ? { method: "GET", headers: AGENT_HEADERS }
        : {
            method: "POST",
            headers: { "Content-Type": "application/json", ...AGENT_HEADERS },
            body: JSON.stringify({ enabled: agentInput.enabled })
          };
      const res = await fetch("/api/agent/gitnexus", options);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setAgentStatus((prev) => ({ ...prev, ...data, gitnexusEnabled: data.enabled }));
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: data.message || `GitNexus mode: ${data.enabled ? "ON" : "OFF"}.`, agentNotice: true }
      ]);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: `Failed /gitnexus: ${err.message}`, agentNotice: true }
      ]);
    }
  }

  // Web search mode is client-only state: the search endpoint (/api/agent/web-search)
  // is stateless and takes the query directly, so no server round-trip is needed.
  function callWebSearchModeControl(agentInput) {
    if (agentInput.action === "status") {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: `Web search mode is ${webSearchMode ? "enabled" : "disabled"}.`, agentNotice: true }
      ]);
      return;
    }
    const enabled = Boolean(agentInput.enabled);
    setWebSearchMode(enabled);
    setMessages((prev) => [
      ...prev,
      { role: "assistant", content: `Web search mode ${enabled ? "enabled" : "disabled"}.`, agentNotice: true }
    ]);
  }

  async function callWebSearch(query) {
    try {
      const res = await fetch("/api/agent/web-search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: data.result || "web_search completed.",
          agentNotice: true
        }
      ]);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `web_search failed: ${err.message}`,
          agentNotice: true
        }
      ]);
    }
  }

  async function sendAgentMessage(text, searchResult = null) {
    handleInputChange("");
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
    let totalPromptTokens = 0;
    let totalCompletionTokens = 0;
    let totalCachedTokens = 0;
    let totalPrefillTokens = 0;
    let hasPromptTokenDetails = false;
    let liveStats = createLiveStatsTracker({
      requestStartMs: tRequestStart,
      promptTokens: estimateTokenCount(
        [...messages.map((message) => message.content || ""), text].join("\n\n")
      )
    });
    // Detect if accumulated content contains shell transcript lines that
    // must bypass KaTeX normalization during Markdown export.
    function looksLikeShellTranscriptContent(text) {
      if (!text) return false;
      // Native-agent tool icon prefix
      if (/^\s*🛠️\s*\$/m.test(text)) return true;
      // Shell redirect to /dev/null
      if (/\s2>\s*[\/]dev[\/]null(\s|$)/m.test(text)) return true;
      // Pipe followed by shell command
      if (/\s\|\s*(grep|head|tail|awk|sed|cat|wc|sort|uniq|find)\b/m.test(text)) return true;
      return false;
    }
    const deltaBatcher = createDeltaBatcher((content, reasoning) => {
      const isRawShell = looksLikeShellTranscriptContent(content);
      setMessages((prev) => {
        if (isRawShell) {
          // Mark the last assistant message with rawToolTranscript flag
          return prev.map((message, index) =>
            index === prev.length - 1
              ? { ...message, content: message.content + content, reasoning: message.reasoning + reasoning, rawToolTranscript: true }
              : message
          );
        }
        return appendAssistantDelta(content, reasoning)(prev);
      });
    });

    // The native agent runtime accepts only a single `message` string and
    // ignores `messages` (see frontend/server/index.mjs `/api/agent/chat` and
    // ds4_wrapper_http.c). If the user entered agent mode with prior chat
    // turns (e.g. an attached document), `agentPrimingPendingRef` is armed —
    // fold the visible history into the outbound message exactly once so the
    // agent receives the context it needs (e.g. the document `/sage` should
    // validate). The locally rendered turns stay untouched.
    let outboundMessage = text;
    if (agentPrimingPendingRef.current) {
      outboundMessage = withAgentPriming(messages, text);
      agentPrimingPendingRef.current = false;
    }
    // Web search mode: fold the live results into the outbound message so the agent
    // model sees them. The native runtime only reads `message`; the locally rendered
    // user turn stays clean (results are transient, like agent priming above).
    if (searchResult) {
      outboundMessage = `${outboundMessage}${searchResultsBlock(searchResult)}`;
    }

    try {
      const payload = {
        message: outboundMessage,
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
            deltaBatcher.push(content, "");
          } else if (event === "agent_reasoning") {
            const reasoning = data.content || "";
            if (reasoning) {
              const live = updateLiveStats(liveStats, { reasoning, nowMs: performance.now() });
              liveStats = live.tracker;
              setRuntimeStats(live.stats);
            }
            deltaBatcher.push("", reasoning);
          } else if (event === "agent_tool_call") {
            deltaBatcher.flush();
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
            deltaBatcher.flush();
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
            deltaBatcher.flush();
            setMessages((prev) => [
              ...prev,
              { role: "tool", tool_call_id: data.id, name: data.name, content: data.content, isError: data.isError, guarded: data.guarded },
              { role: "assistant", content: "", reasoning: "" }
            ]);
          } else if (event === "agent_usage") {
            totalPromptTokens += data.prompt_tokens || 0;
            totalCompletionTokens += data.completion_tokens || 0;
            const details = data.prompt_tokens_details;
            if (details) {
              hasPromptTokenDetails = true;
              totalCachedTokens += details.cached_tokens || 0;
              totalPrefillTokens += details.cache_write_tokens || 0;
            }
            streamUsage = {
              ...data,
              prompt_tokens: totalPromptTokens,
              completion_tokens: totalCompletionTokens,
              prompt_tokens_details: hasPromptTokenDetails ? {
                cached_tokens: totalCachedTokens,
                cache_write_tokens: totalPrefillTokens
              } : undefined
            };
            setRuntimeStats(finalizeLiveStats(liveStats, {
              promptTokens: streamUsage.prompt_tokens,
              promptTokensDetails: streamUsage.prompt_tokens_details,
              completionTokens: streamUsage.completion_tokens,
              prefillSeconds: streamUsage.timing?.prefill_sec,
              generationSeconds: streamUsage.timing?.decode_sec,
              stream: true
            }));
          } else if (event === "agent_error") {
            deltaBatcher.flush();
            setMessages(appendTransientNotice(`Agent Error: ${data.error}`));
          } else if (event === "agent_done") {
            deltaBatcher.flush();
          }
        }
      }
      deltaBatcher.flush();
      if (streamUsage) {
        setRuntimeStats(finalizeLiveStats(liveStats, {
          promptTokens: streamUsage.prompt_tokens,
          promptTokensDetails: streamUsage.prompt_tokens_details,
          completionTokens: streamUsage.completion_tokens,
          prefillSeconds: streamUsage.timing?.prefill_sec,
          generationSeconds: streamUsage.timing?.decode_sec,
          stream: true
        }));
      }
    } catch (err) {
      if (err.name !== "AbortError") {
        deltaBatcher.flush();
        setMessages(appendTransientNotice(streamFailureNotice(err).replace(/^Stream/, "Agent stream")));
      }
    } finally {
      deltaBatcher.cancel();
      setGenerationBusy(false);
      if (abortRef.current === controller) abortRef.current = null;
    }
  }

  const handleInputChange = (val) => {
    setInput(val);
    setActiveSuggestionIndex(0);
    if (!val.startsWith("/")) {
      setHideSuggestions(false);
    }
  };

  const handleSelectSuggestion = (cmd) => {
    const hasArgs = ["/switch", "/del", "/strip", "/history", "/power"].includes(cmd.name);
    const newVal = cmd.name + (hasArgs ? " " : "");
    setInput(newVal);
    setActiveSuggestionIndex(0);
    setHideSuggestions(false);
    // Keep focus in the textarea
    setTimeout(() => {
      composerRef.current?.focus();
    }, 10);
  };

  // Runs the web-search backend for `query`, returning the compact results string
  // (or null on failure/empty). Shared by the chat and agent send paths.
  async function runWebSearch(query) {
    try {
      const res = await fetch("/api/agent/web-search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query })
      });
      const data = await res.json();
      if (res.ok) return data.result || null;
    } catch {
      /* network/parse failure → treat as no results so the caller can proceed */
    }
    return null;
  }

  async function sendMessage() {
    const text = input.trim();
    const lastMessage = messages[messages.length - 1];
    const pendingDoc = Boolean(lastMessage && lastMessage.role === "user" && lastMessage.attachment);
    if ((!text && !pendingDoc) || !canSend) return;

    const agentInput = parseAgentInput(text, agentMode);
    if (agentInput) {
      handleInputChange("");
      if (agentInput.type === "control") {
        if (agentInput.action === "start") return toggleAgentMode(true);
        if (agentInput.action === "stop") return toggleAgentMode(false);
        return callAgentStatus();
      }
      if (agentInput.type === "pony") {
        return callPonyControl(agentInput);
      }
      if (agentInput.type === "headroom") {
        return callHeadroomControl(agentInput);
      }
      if (agentInput.type === "webSearch") {
        return callWebSearch(agentInput.query);
      }
      if (agentInput.type === "webSearchMode") {
        return callWebSearchModeControl(agentInput);
      }
      if (agentInput.type === "sageControl") {
        return callSageControl(agentInput.action);
      }
      if (agentInput.type === "gitnexus") {
        return callGitnexusControl(agentInput);
      }
      return callNativeAgentCommand(agentInput.command);
    }

    // Run a web search when webSearchMode is enabled. The result is injected
    // into the user message so the model sees fresh context.
    let searchResult = null;
    if (webSearchMode) {
      searchResult = await runWebSearch(text);
    }

    if (agentMode) {
      return sendAgentMessage(text, searchResult);
    }

    if (attachedDoc && searchStrategy === "D") {
      return sendChunkedMessage(text);
    }

    handleInputChange("");
    setError("");
    // Strategy "F" (full context): a document loaded with the "+" button is already
    // shown in the chat as a trailing user turn flagged `attachment`. Merge the typed
    // question into that same turn so the conversation keeps valid user/assistant
    // alternation while the full document stays visible and part of the context.
    const nextMessages = pendingDoc
      ? [
          ...messages.slice(0, -1),
          {
            role: "user",
            content: text ? `${lastMessage.content}\n\n---\n\n${text}` : lastMessage.content
          },
          { role: "assistant", content: "", reasoning: "" }
        ]
      : [
          ...messages,
          { role: "user", content: text },
          { role: "assistant", content: "", reasoning: "" }
        ];
    setMessages(nextMessages);
    setHistoryAutoLoaded(true);

    const controller = new AbortController();
    abortRef.current = controller;
    setGenerationBusy(true);
    const deltaBatcher = createDeltaBatcher((content, reasoning) => {
      setMessages(appendAssistantDelta(content, reasoning));
    });

    try {
      const chatMessages = buildChatMessages(
        injectSearchResults(nextMessages, searchResult),
        { system: request.system }
      );

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
            deltaBatcher.push(content, reasoning);
          }
        }
      }
      deltaBatcher.flush();
      if (streamUsage && tFirstToken !== null) {
        setRuntimeStats(streamStatsFromTiming({
          requestStartMs: tRequestStart,
          firstTokenMs: tFirstToken,
          lastTokenMs: tLastToken,
          promptTokens: streamUsage.prompt_tokens,
          promptTokensDetails: streamUsage.prompt_tokens_details,
          completionTokens: streamUsage.completion_tokens,
          stream: true
        }));
      }
    } catch (err) {
      if (err.name !== "AbortError") {
        deltaBatcher.flush();
        setMessages(appendTransientNotice(streamFailureNotice(err)));
      }
    } finally {
      deltaBatcher.cancel();
      setGenerationBusy(false);
      if (abortRef.current === controller) abortRef.current = null;
    }
  }

  const filteredSuggestions = agentMode && input.startsWith("/") && !hideSuggestions
    ? AGENT_COMMANDS.filter(cmd => cmd.name.toLowerCase().startsWith(input.toLowerCase()))
    : [];
  const isSuggestionsOpen = filteredSuggestions.length > 0;
  const activeIndex = Math.max(0, Math.min(activeSuggestionIndex, filteredSuggestions.length - 1));

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
      <main className="studio" data-agent-id="app-main">
        <LeftRail status={status} error={error} startupDetail={startupDetail}
          serverBusy={serverBusy} serverAction={serverAction}
          effectiveCommand={effectiveCommand} commandDraft={commandDraft}
          setCommandDraft={setCommandDraft} commandIsCustom={commandIsCustom}
          hasPendingStartup={hasPendingStartup} />

        <ChatPanel
          messages={messages}
          input={input}
          generationBusy={generationBusy}
          uploadBusy={uploadBusy}
          fileAccept={fileAccept}
          uploadedFiles={uploadedFiles}
          attachedDoc={attachedDoc}
          setAttachedDoc={setAttachedDoc}
          chunkProgress={chunkProgress}
          searchStrategy={searchStrategy}
          agentMode={agentMode}
          agentStatus={agentStatus}
          headroomEnabled={headroomEnabled}
          composerRef={composerRef}
          fileInputRef={fileInputRef}
          messagesRef={messagesRef}
          exportNotice={exportNotice}
          setExportNotice={setExportNotice}
          config={config}
          researchMode={researchMode}
          setResearchMode={setResearchMode}
          selectedResearchSessionId={selectedResearchSessionId}
          setSelectedResearchSessionId={setSelectedResearchSessionId}
          canSend={canSend}
          filteredSuggestions={filteredSuggestions}
          setActiveSuggestionIndex={setActiveSuggestionIndex}
          setHideSuggestions={setHideSuggestions}
          isSuggestionsOpen={isSuggestionsOpen}
          activeIndex={activeIndex}
          sendMessage={sendMessage}
          toggleAgentMode={toggleAgentMode}
          startNewSession={startNewSession}
          downloadConversation={downloadConversation}
          uploadFile={uploadFile}
          abortGeneration={abortGeneration}
          handleInputChange={handleInputChange}
          handleSelectSuggestion={handleSelectSuggestion}
          handleResearchHistoryChange={handleResearchHistoryChange}
        />

        <aside className="right-rail panel" data-agent-id="right-rail-panels">
        <div className="tabs">
          <button type="button" className={tab === "request" ? "active" : ""} onClick={() => setTab("request")} data-agent-id="right-rail-request-tab">
            Request
          </button>
          <button type="button" className={tab === "profile" ? "active" : ""} onClick={() => setTab("profile")} data-agent-id="right-rail-profile-tab">
            Profile
          </button>
          <button type="button" className={tab === "startup" ? "active" : ""} onClick={() => setTab("startup")} data-agent-id="right-rail-startup-tab">
            Startup
          </button>
          <button type="button" className={tab === "strategy" ? "active" : ""} onClick={() => setTab("strategy")} data-agent-id="right-rail-strategy-tab">
            Strategy
          </button>
          <button type="button" className={tab === "history" ? "active" : ""} onClick={() => setTab("history")} data-agent-id="right-rail-history-tab">
            History
          </button>
          <button type="button" className={tab === "export" ? "active" : ""} onClick={() => setTab("export")} data-agent-id="right-rail-export-tab">
            Export
          </button>
          <button type="button" className={tab === "logs" ? "active" : ""} onClick={() => setTab("logs")} data-agent-id="right-rail-logs-tab">
            Logs
          </button>
          <button type="button" className={tab === "metrics" ? "active" : ""} onClick={() => setTab("metrics")} data-agent-id="right-rail-metrics-tab">
            Metrics
          </button>
          <button type="button" className={tab === "call-debug" ? "active" : ""} onClick={() => setTab("call-debug")} data-agent-id="right-rail-call-debug-tab">
            Call Debug
          </button>
          <button type="button" className={tab === "compression" ? "active" : ""} onClick={() => setTab("compression")} data-agent-id="right-rail-compression-tab">
            Compression
          </button>
          <button type="button" className={tab === "pageagent" ? "active" : ""} onClick={() => setTab("pageagent")} data-agent-id="right-rail-pageagent-tab">
            PageAgent
          </button>
        </div>
        {tab === "request" ? (
          <RequestPanel request={request} updateRequestField={updateRequestField} />
        ) : null}
        {tab === "profile" ? (
          <ProfilePanel profiles={profiles} status={status} profileBusy={profileBusy} selectProfile={selectProfile} profileNotice={profileNotice} />
        ) : null}
        {tab === "startup" ? (
          <StartupPanel config={config} updateServerField={updateServerField} updateNumberServerField={updateNumberServerField} />
        ) : null}
        {tab === "strategy" ? (
          <StrategyPanel searchChunkTokens={searchChunkTokens} setSearchChunkTokens={setSearchChunkTokens} searchStrategy={searchStrategy} setSearchStrategy={setSearchStrategy} />
        ) : null}
        {tab === "history" ? (<HistoryPanel historyTab={historyTab} setHistoryTab={setHistoryTab}
            researchSessions={researchSessions} selectedResearchSessionId={selectedResearchSessionId}
            setSelectedResearchSessionId={setSelectedResearchSessionId}
            loadResearchSession={loadResearchSession}
            handleResearchHistoryChange={handleResearchHistoryChange}
            researchHistoryBusy={researchHistoryBusy}
            config={config} historyDraft={historyDraft} historyConfig={historyConfig}
            updateHistoryDraft={updateHistoryDraft}
            saveHistorySettings={saveHistorySettings}
            refreshHistorySessions={refreshHistorySessions}
            deleteAllHistorySessions={deleteAllHistorySessions}
            historyStatus={historyStatus} historyListBusy={historyListBusy}
            historyBusy={historyBusy}
            activeConversationHistorySessions={activeConversationHistorySessions}
            historySessions={historySessions}
            historyMetadataAvailable={historyMetadataAvailable}
            chatHistorySessions={chatHistorySessions}
            agentHistorySessions={agentHistorySessions}
            activeConversationHistoryLabel={activeConversationHistoryLabel}
            deleteHistorySession={deleteHistorySession}
            loadHistorySession={loadHistorySession}
            currentSessionFileName={currentSessionFileName}
            setMessages={setMessages}
            setCurrentSessionFileName={setCurrentSessionFileName}
            historyAutoLoaded={historyAutoLoaded}
            setHistoryAutoLoaded={setHistoryAutoLoaded}
            lastSavedHistorySignatureRef={lastSavedHistorySignatureRef}
            clearStoredSession={clearStoredSession}
            sessionStorage={sessionStorage}
            setError={setError} />
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
          <LogsPanel status={status} />
        ) : null}
        {tab === "metrics" ? (
          <MetricsPanel serverMetrics={serverMetrics} metricsError={metricsError} />
        ) : null}
        {tab === "call-debug" ? (
          <CallDebugPanel refreshCallDebug={refreshCallDebug} callDebugBusy={callDebugBusy} handleClearCallDebug={handleClearCallDebug} callDebugEntries={callDebugEntries} callDebugEnabled={callDebugEnabled} callDebugNotice={callDebugNotice} callDebugOpen={callDebugOpen} setCallDebugOpen={setCallDebugOpen} />
        ) : null}
        {tab === "compression" ? (
          <CompressionPanel metrics={compressionMetrics} />
        ) : null}
        {tab === "pageagent" ? (
          <PageAgentPanel config={config} />
        ) : null}
        </aside>
      </main>
      {exportDialogOpen ? (
        <ExportDialog
          includeReasoning={exportDialogIncludeReasoning}
          exportMode={exportDialogMode}
          onIncludeReasoningChange={setExportDialogIncludeReasoning}
          onExportModeChange={setExportDialogMode}
          onCancel={() => setExportDialogOpen(false)}
          onConfirm={confirmExportDialog}
        />
      ) : null}
      <RocmFooter rocm={rocm} stats={runtimeStats} />
    </>
  );
}
