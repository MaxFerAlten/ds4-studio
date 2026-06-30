// Unified utility module — merged from backendStatus, callDebug, deltaBatcher,
// historyPersistence, exportPreferences, polling, agentCommands, agentPriming.
// Keeps all exports identical to the original individual files.

// ---------------------------------------------------------------------------
// backendStatus.mjs
// ---------------------------------------------------------------------------

function statusLogEntries(status) {
  return (status?.logs || [])
    .map((entry) => ({
      time: typeof entry === "string" ? null : entry?.time || null,
      message: typeof entry === "string" ? entry : entry?.message || ""
    }))
    .filter((entry) => entry.message);
}

function statusMessages(status) {
  return statusLogEntries(status).map((entry) => entry.message);
}

function elapsedSeconds(fromTime, now) {
  if (!fromTime) return null;
  const start = new Date(fromTime).getTime();
  const end = now instanceof Date ? now.getTime() : new Date(now).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  return Math.round((end - start) / 1000);
}

export function backendHealthLabel(status) {
  if (status?.healthy) return "Healthy";
  const messages = statusMessages(status);
  if (messages.some((message) => message.includes("CUDA chunk-copying"))) {
    return "Loading GPU model";
  }
  return "Waiting for backend";
}

export function backendStartupDetail(status, now = new Date()) {
  if (!status?.running || status?.healthy) return "";
  const entries = statusLogEntries(status);
  const copyIndex = entries.findLastIndex((entry) => entry.message.includes("CUDA chunk-copying"));
  if (copyIndex === -1) return "";

  const copyEntry = entries[copyIndex];
  const size = copyEntry.message.match(/CUDA chunk-copying\s+([0-9.]+\s+GiB)\s+model image/);
  const initEntry = entries
    .slice(0, copyIndex + 1)
    .findLast((entry) => entry.message.includes("CUDA backend initialized"));
  const seconds = elapsedSeconds(initEntry?.time || copyEntry.time, now);
  const parts = [`Copying ${size?.[1] || "model"} to GPU`];
  if (seconds !== null) parts.push(`${seconds}s elapsed`);
  return parts.join(" · ");
}

export function streamFailureNotice(error) {
  const message = error?.message || String(error || "");
  if (message.includes("terminated") || message.includes("Backend connection closed")) {
    return "Stream failed: backend connection ended. Wait for Healthy, then retry.";
  }
  return `Stream failed: ${message}`;
}

// ---------------------------------------------------------------------------
// callDebug.mjs
// ---------------------------------------------------------------------------

export async function fetchCallDebug({ limit = 200, fetchImpl = fetch } = {}) {
  const res = await fetchImpl(`/api/call-debug?limit=${encodeURIComponent(limit)}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `request failed: ${res.status}`);
  return {
    enabled: Boolean(data.enabled),
    entries: Array.isArray(data.entries) ? data.entries : []
  };
}

export async function clearCallDebug({ fetchImpl = fetch } = {}) {
  const res = await fetchImpl("/api/call-debug", { method: "DELETE" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `request failed: ${res.status}`);
  return true;
}

// ---------------------------------------------------------------------------
// deltaBatcher.mjs
// ---------------------------------------------------------------------------

export function createDeltaBatcher(
  flush,
  {
    delayMs = 40,
    setTimeoutFn = globalThis.setTimeout,
    clearTimeoutFn = globalThis.clearTimeout
  } = {}
) {
  let content = "";
  let reasoning = "";
  let timer = null;

  function hasPending() {
    return Boolean(content || reasoning);
  }

  function clearTimer() {
    if (!timer) return;
    clearTimeoutFn(timer);
    timer = null;
  }

  function flushNow() {
    clearTimer();
    if (!hasPending()) return false;
    const nextContent = content;
    const nextReasoning = reasoning;
    content = "";
    reasoning = "";
    flush(nextContent, nextReasoning);
    return true;
  }

  function schedule() {
    if (timer) return;
    timer = setTimeoutFn(() => {
      timer = null;
      flushNow();
    }, delayMs);
  }

  return {
    push(nextContent = "", nextReasoning = "") {
      if (!nextContent && !nextReasoning) return false;
      content += nextContent;
      reasoning += nextReasoning;
      schedule();
      return true;
    },
    flush: flushNow,
    cancel() {
      clearTimer();
      content = "";
      reasoning = "";
    },
    hasPending
  };
}

// ---------------------------------------------------------------------------
// historyPersistence.mjs
// ---------------------------------------------------------------------------

export function historyHasPersistableAssistant(messages) {
  return (messages || []).some((message) => {
    if (!message || message.agentNotice || message.role !== "assistant") return false;
    if (typeof message.content === "string" && message.content.length > 0) return true;
    if (typeof message.reasoning === "string" && message.reasoning.length > 0) return true;
    if (typeof message.reasoning_content === "string" && message.reasoning_content.length > 0) return true;
    return Array.isArray(message.tool_calls) && message.tool_calls.length > 0;
  });
}

export function sessionHasAgentMetadata(session) {
  return Boolean(session?.metadata?.agentMode);
}

export function sessionsExposeMetadata(sessions) {
  return (sessions || []).some((session) =>
    Object.prototype.hasOwnProperty.call(session || {}, "metadata")
  );
}

// ---------------------------------------------------------------------------
// exportPreferences.mjs
// ---------------------------------------------------------------------------

export const EXPORT_INCLUDE_REASONING_KEY = "ds4.export.includeReasoning";
export const EXPORT_DIR_KEY = "ds4.export.dir";

function safeStorage(storage) {
  if (storage) return storage;
  try {
    return globalThis.localStorage || null;
  } catch {
    return null;
  }
}

export function readStoredExportIncludeReasoning(storage) {
  const store = safeStorage(storage);
  if (!store) return null;
  const value = store.getItem(EXPORT_INCLUDE_REASONING_KEY);
  if (value === "true") return true;
  if (value === "false") return false;
  return null;
}

export function writeStoredExportIncludeReasoning(includeReasoning, storage) {
  const store = safeStorage(storage);
  if (!store) return;
  store.setItem(EXPORT_INCLUDE_REASONING_KEY, includeReasoning ? "true" : "false");
}

export function clearStoredExportIncludeReasoning(storage) {
  const store = safeStorage(storage);
  if (!store) return;
  store.removeItem(EXPORT_INCLUDE_REASONING_KEY);
}

export function readStoredExportDir(storage) {
  const store = safeStorage(storage);
  if (!store) return "";
  return store.getItem(EXPORT_DIR_KEY) || "";
}

export function writeStoredExportDir(dir, storage) {
  const store = safeStorage(storage);
  if (!store) return;
  const value = String(dir || "").trim();
  if (!value) {
    store.removeItem(EXPORT_DIR_KEY);
    return;
  }
  store.setItem(EXPORT_DIR_KEY, value);
}

// ---------------------------------------------------------------------------
// polling.mjs
// ---------------------------------------------------------------------------

export function documentIsVisible(doc = globalThis.document) {
  return !doc || doc.hidden !== true;
}

// ---------------------------------------------------------------------------
// agentCommands.mjs
// ---------------------------------------------------------------------------

export function parseAgentInput(text, agentMode) {
  if (typeof text !== "string") return null;
  const trimmed = text.trim();
  if (!trimmed) return null;

  const control = trimmed.match(/^\/agent\s+(start|stop|status)\s*$/i);
  if (control) {
    return { type: "control", action: control[1].toLowerCase() };
  }

  const pony = trimmed.match(/^\/pony(?:\s+(\S+))?\s*$/i);
  if (pony) {
    if (!agentMode) return { type: "pony", action: "inactive" };
    const arg = (pony[1] || "status").toLowerCase();
    if (arg === "status") return { type: "pony", action: "status" };
    if (arg === "start") return { type: "pony", action: "set", mode: "full" };
    if (arg === "stop") return { type: "pony", action: "set", mode: "off" };
    if (["off", "lite", "full", "ultra"].includes(arg)) return { type: "pony", action: "set", mode: arg };
    return { type: "pony", action: "invalid", mode: arg };
  }

  const headroom = trimmed.match(/^\/headroom\s+(start|stop|status)\s*$/i);
  if (headroom) {
    const action = headroom[1].toLowerCase();
    if (action === "status") return { type: "headroom", action: "status" };
    if (action === "start") return { type: "headroom", action: "set", enabled: true };
    if (action === "stop") return { type: "headroom", action: "set", enabled: false };
  }

  const webSearchCmd = trimmed.match(/^\/web_search\s+(.+)$/i);
  if (webSearchCmd) {
    return { type: "webSearch", query: webSearchCmd[1].trim() };
  }

  /* Web Search Mode — persistent search on every message */
  const webSearchMode = trimmed.match(/^\/web-search\s+(start|stop|status)\s*$/i);
  if (webSearchMode) {
    const action = webSearchMode[1].toLowerCase();
    if (action === "status") return { type: "webSearchMode", action: "status" };
    if (action === "start") return { type: "webSearchMode", action: "set", enabled: true };
    if (action === "stop") return { type: "webSearchMode", action: "set", enabled: false };
  }

  // SageMath control commands — work only when agent mode is active
  const sageControl = trimmed.match(/^\/sage\s+(start|stop|status)\s*$/i);
  if (sageControl) {
    return { type: "sageControl", action: sageControl[1].toLowerCase() };
  }

  const gitnexus = trimmed.match(/^\/gitnexus\s+(start|stop|status)\s*$/i);
  if (gitnexus) {
    if (!agentMode) return { type: "gitnexus", action: "inactive" };
    const action = gitnexus[1].toLowerCase();
    if (action === "status") return { type: "gitnexus", action: "status" };
    if (action === "start") return { type: "gitnexus", action: "set", enabled: true };
    if (action === "stop")  return { type: "gitnexus", action: "set", enabled: false };
  }

  const alias = trimmed.match(/^\/agent\s+(\S+)(?:\s+([\s\S]*))?$/i);
  if (alias) {
    const name = alias[1].toLowerCase();
    const args = alias[2]?.trim();
    return {
      type: "native",
      command: `/${name}${args ? ` ${args}` : ""}`
    };
  }

  const crawl = trimmed.match(/^\/crawl(?:\s+([\s\S]*))?$/i);
  if (crawl) {
    return { type: "native", command: trimmed };
  }

  if (/^\/agent$/i.test(trimmed)) return null;
  if (agentMode && /^\/\S/.test(trimmed)) {
    return { type: "native", command: trimmed };
  }
  return null;
}

export function formatNativeAgentNotice(command, payload = {}, status) {
  const label = String(command || "command");
  let content = String(
    payload.message || payload.error || "Native agent command failed."
  );
  if (payload.data !== undefined && payload.data !== null) {
    content += `\n\n\`\`\`json\n${JSON.stringify(payload.data, null, 2)}\n\`\`\``;
  }
  return `**${label}** (HTTP ${status})\n\n${content}`;
}

// ---------------------------------------------------------------------------
// agentPriming.mjs
// ---------------------------------------------------------------------------

/**
 * Render the prior chat history as a textual preamble suitable for prepending
 * to the first agent-mode user message. Returns an empty string when there is
 * no priorable history.
 */
export function buildAgentPrimingPreamble(messages) {
  if (!Array.isArray(messages) || messages.length === 0) return "";

  const turns = [];
  for (const msg of messages) {
    if (!msg || typeof msg !== "object") continue;
    if (msg.agentNotice) continue;

    const role = msg.role;
    if (role !== "user" && role !== "assistant") continue;

    const content = typeof msg.content === "string" ? msg.content : "";
    const reasoning = typeof msg.reasoning === "string" ? msg.reasoning : "";

    if (role === "assistant" && !content.trim() && !reasoning.trim()) continue;
    if (role === "user" && !content.trim()) continue;

    const label = role === "user" ? "User" : "Assistant";
    turns.push(`## ${label}\n\n${content.trim()}`);
  }

  if (turns.length === 0) return "";

  return [
    "The following block contains the chat history that preceded this agent",
    "session. Treat it as background context — including any attached documents",
    "shown inside it — and use it when answering the new user request that",
    "follows the closing tag.",
    "",
    "<chat_history>",
    turns.join("\n\n---\n\n"),
    "</chat_history>",
    ""
  ].join("\n");
}

/**
 * Wrap a fresh user request with the priming preamble built from `messages`.
 * When the preamble is empty the request text is returned unchanged.
 */
export function withAgentPriming(messages, requestText) {
  const preamble = buildAgentPrimingPreamble(messages);
  if (!preamble) return requestText;
  return `${preamble}\nNew user request:\n${requestText}`;
}
