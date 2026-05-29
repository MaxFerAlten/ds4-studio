import express from "express";
import multer from "multer";
import { createServer as createViteServer } from "vite";
import { parseCommandLine } from "./commandBuilder.mjs";
import { buildDs4Args, loadConfig, saveConfig, validateConfig } from "./config.mjs";
import { DEFAULT_CONFIG, REQUEST_DEFAULTS } from "./defaultConfig.mjs";
import {
  deleteAllConversationHistory,
  deleteConversationHistory,
  listConversationHistory,
  loadConversationHistory,
  saveConversationHistory
} from "./chatHistory.mjs";
import { exportConversationMarkdown } from "../src/conversationExport.mjs";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { buildChatPayload } from "./requestPayload.mjs";
import {
  DEFAULT_PROFILE_NAME,
  listProfiles,
  loadProfileByName,
  loadProfileOrDefault,
  mapProfileToRequestDefaults,
  mapProfileToServerConfig
} from "./profileLoader.mjs";
import {
  ACCEPT_ATTRIBUTE,
  approxTokenCount,
  ensureWorkspace,
  ingestUploadedFile,
  isSupportedFileName,
  splitMarkdownChunks
} from "./fileIngestion.mjs";
import { Ds4ProcessManager } from "./processManager.mjs";
import { readRequestBody, requestHeadersForProxy } from "./proxy.mjs";
import { readRocmStatus } from "./rocmSmi.mjs";
import { AgentSessionStore, AGENT_SYSTEM_PROMPT, AGENT_TOOLS } from "./agentSession.mjs";
import { checkBashFileReadFallback, executeTool } from "./agentTools.mjs";

const PROXY_TIMEOUT_MS = 60 * 60 * 1000;
const HTTP_DRAIN_GRACE_MS = 2000;
const SHUTDOWN_TIMEOUT_MS = 10000;
const UPLOAD_LIMIT_BYTES = 50 * 1024 * 1024;
const FRONTEND_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PROJECT_ROOT = path.resolve(FRONTEND_ROOT, "..");

let config = await loadConfig();
if (process.env.DS4_UI_HOST) config.control.host = process.env.DS4_UI_HOST;
if (process.env.DS4_UI_PORT) config.control.port = process.env.DS4_UI_PORT;

let activeProfile = null;
let activeRequestDefaults = { ...REQUEST_DEFAULTS };

async function ensureBackendDirs() {
  const tracePath = config.server.trace;
  if (tracePath && typeof tracePath === "string") {
    const abs = path.isAbsolute(tracePath) ? tracePath : path.join(PROJECT_ROOT, tracePath);
    try {
      await fs.mkdir(path.dirname(abs), { recursive: true });
    } catch (err) {
      console.warn(`profile: failed to create trace dir for ${tracePath}: ${err.message}`);
    }
  }
  const kvDir = config.server.kvDiskDir;
  if (kvDir && typeof kvDir === "string") {
    try {
      await fs.mkdir(kvDir, { recursive: true });
    } catch (err) {
      console.warn(`profile: failed to create kv-disk-dir ${kvDir}: ${err.message}`);
    }
  }
}

async function applyProfileByName(name) {
  const entry = await loadProfileOrDefault(name);
  if (!entry) {
    activeProfile = null;
    activeRequestDefaults = { ...REQUEST_DEFAULTS };
    return null;
  }
  const serverPatch = mapProfileToServerConfig(entry.profile);
  config = { ...config, server: { ...config.server, ...serverPatch } };
  activeRequestDefaults = { ...REQUEST_DEFAULTS, ...mapProfileToRequestDefaults(entry.profile) };
  activeProfile = entry;
  await ensureBackendDirs();
  return entry;
}

const bootProfileName = config.selectedProfile || DEFAULT_PROFILE_NAME;
await applyProfileByName(bootProfileName);

const initialValidation = validateConfig(config);
if (!initialValidation.ok) {
  throw new Error(`invalid config: ${JSON.stringify(initialValidation.errors)}`);
}

function backendBase() {
  return `http://${config.server.host}:${config.server.port}`;
}

async function healthCheck() {
  const res = await fetch(`${backendBase()}/v1/models`, { signal: AbortSignal.timeout(1000) });
  return res.ok;
}

function mergeRequestConfig(body = {}) {
  return {
    ...config,
    ...body,
    server: { ...config.server, ...(body.server || {}) },
    control: { ...config.control, ...(body.control || {}) },
    history: { ...config.history, ...(body.history || {}) }
  };
}

function asyncHandler(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

function abortOnClientDisconnect(req, res) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error("upstream request timed out")), PROXY_TIMEOUT_MS);
  const abort = () => controller.abort();
  const abortIfOpen = () => {
    if (!res.writableEnded) abort();
  };
  req.on("aborted", abort);
  res.on("close", abortIfOpen);
  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timeout);
      req.off("aborted", abort);
      res.off("close", abortIfOpen);
    }
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

const manager = new Ds4ProcessManager({
  buildCommand: () => buildDs4Args(config),
  healthCheck,
  cwd: PROJECT_ROOT
});

const app = express();
const fileWorkspace = await ensureWorkspace();
const upload = multer({
  dest: fileWorkspace.uploadDir,
  limits: { fileSize: UPLOAD_LIMIT_BYTES },
  fileFilter: (_req, file, cb) => {
    if (isSupportedFileName(file.originalname)) cb(null, true);
    else cb(Object.assign(new Error(`unsupported file type: ${file.originalname}`), { status: 415 }));
  }
});

app.use("/v1", async (req, res) => {
  const target = `${backendBase()}${req.originalUrl}`;
  const { signal, cleanup } = abortOnClientDisconnect(req, res);
  try {
    const hasRequestBody = !["GET", "HEAD"].includes(req.method);
    const body = hasRequestBody ? await readRequestBody(req) : undefined;
    const options = {
      method: req.method,
      headers: requestHeadersForProxy(req, body),
      signal
    };
    if (hasRequestBody) options.body = body;
    const upstream = await fetch(target, options);
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
    cleanup();
  }
});

app.use(express.json({ limit: "32mb" }));

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

async function callBackendCompletion({ messages, request, stream, signal }) {
  const payload = buildChatPayload({ ...request, stream }, messages);
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

app.post("/api/files/chunked-analyze", asyncHandler(async (req, res) => {
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
    writeSse(res, "phase", {
      phase: "split",
      chunks: chunks.length,
      tokensPerChunk: chunks.map((c) => c.approxTokens)
    });

    if (chunks.length === 0) {
      writeSse(res, "error", { error: "no chunks produced" });
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
}));

app.get("/api/rocm/status", asyncHandler(async (_req, res) => {
  res.json(await readRocmStatus());
}));

app.get("/api/profiles", asyncHandler(async (_req, res) => {
  const profiles = await listProfiles();
  res.json({
    profiles: profiles.map(({ name, label, description, error }) => ({ name, label, description, error })),
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
  const entry = await loadProfileByName(name);
  if (!entry || entry.error) {
    return res.status(404).json({ error: `profile not found: ${name}` });
  }
  await applyProfileByName(name);
  const next = { ...config, selectedProfile: name };
  const validation = validateConfig(next);
  if (!validation.ok) return res.status(400).json(validation);
  config = await saveConfig(next);
  res.json({
    selected: activeProfile?.name || null,
    requestDefaults: activeRequestDefaults,
    serverConfig: config.server,
    backendRestartRequired: true
  });
}));

app.get("/api/server/status", asyncHandler(async (_req, res) => {
  await manager.refreshHealth();
  res.json({
    config,
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

app.get("/api/server/config", (_req, res) => {
  res.json({ config, defaults: DEFAULT_CONFIG });
});

app.put("/api/server/config", asyncHandler(async (req, res) => {
  const next = mergeRequestConfig(req.body);
  const validation = validateConfig(next);
  if (!validation.ok) return res.status(400).json(validation);
  config = await saveConfig(next);
  res.json({ config });
}));

app.put("/api/history/settings", asyncHandler(async (req, res) => {
  const next = mergeRequestConfig({ history: req.body?.history || req.body || {} });
  const validation = validateConfig(next);
  if (!validation.ok) return res.status(400).json(validation);
  config = await saveConfig(next);
  res.json({ history: config.history, config });
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
  if (!messages.length) return res.status(400).json({ error: "messages are required" });

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
  const markdown = exportConversationMarkdown(messages, { includeReasoning });

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
const AGENT_MAX_ITERATIONS = 25;
const AGENT_STATEFUL_PATH = process.env.DS4_AGENT_STATEFUL_PATH || "/v1/ds4/stateful/chat/completions";
const AGENT_STATEFUL_MODE = (process.env.DS4_AGENT_STATEFUL || "auto").toLowerCase();
const AGENT_PROBE_TTL_MS = 60 * 1000;
const AGENT_READ_GUARD_MODE = (process.env.DS4_AGENT_READ_GUARD_MODE || "exact").toLowerCase() === "strict"
  ? "strict"
  : "exact";

let _agentProbeResult = null;
let _agentProbeAt = 0;
let _agentProbeInflight = null;

async function probeStatefulBackend() {
  if (AGENT_STATEFUL_MODE === "1" || AGENT_STATEFUL_MODE === "on") return true;
  if (AGENT_STATEFUL_MODE === "0" || AGENT_STATEFUL_MODE === "off") return false;
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

app.post("/api/agent/start", asyncHandler(async (req, res) => {
  res.json(agentSessions.start(agentSessionKey(req)));
}));

app.post("/api/agent/stop", asyncHandler(async (req, res) => {
  res.json(agentSessions.stop(agentSessionKey(req)));
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

/**
 * Agent chat endpoint with auto-loop tool execution.
 * Streams SSE events: agent_status, agent_text, agent_reasoning,
 * agent_tool_call, agent_tool_result, agent_usage, agent_done, agent_error.
 */
app.post("/api/agent/chat", asyncHandler(async (req, res) => {
  const sessionKey = agentSessionKey(req);
  const agentSession = agentSessions.get(sessionKey);
  if (!agentSession || !agentSession.active) {
    return res.status(400).json({ error: "Agent mode is not active. Use /agent pi start first." });
  }

  const userMessage = req.body?.message;
  const conversationMessages = Array.isArray(req.body?.messages) ? req.body.messages : [];
  const reqParams = req.body?.request || {};

  if (!userMessage && !conversationMessages.length) {
    return res.status(400).json({ error: "message or messages array required" });
  }

  let fullMessages = agentSession.messages();
  if (!fullMessages.length) {
    fullMessages = [
      { role: "system", content: AGENT_SYSTEM_PROMPT },
      ...normalizeAgentMessages(conversationMessages)
    ];
  }
  if (userMessage) fullMessages.push({ role: "user", content: String(userMessage) });

  // SSE response setup
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no"
  });

  const controller = new AbortController();
  const abort = () => controller.abort();
  req.on("aborted", abort);
  res.on("close", () => { if (!res.writableEnded) controller.abort(); });

  function writeAgentSse(event, data) {
    if (res.writableEnded) return;
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  try {
    let iteration = 0;

    while (iteration < AGENT_MAX_ITERATIONS) {
      if (controller.signal.aborted) break;
      iteration++;

      const basePayload = buildChatPayload({ ...reqParams, stream: true }, fullMessages);
      basePayload.tools = AGENT_TOOLS;
      basePayload.stream = true;
      basePayload.stream_options = { include_usage: true };

      // Choose payload mode. Probe the backend (cached) at the start of each
      // iteration so the stateful path is used automatically when supported,
      // and we fall back transparently when it is not.
      const allowDelta = await probeStatefulBackend();
      let modeChoice = agentSession.choosePayload(basePayload, {
        allowDelta,
        userTurnPolicy: allowDelta ? "delta" : "reset"
      });
      let backendRes;
      let retriedReset = false;

      while (true) {
        writeAgentSse("agent_status", {
          iteration,
          mode: modeChoice.mode,
          reason: modeChoice.reason,
          statefulSupported: allowDelta
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
            reason: "409 from backend; retrying as reset"
          });
          modeChoice = agentSession.choosePayload(basePayload, {
            allowDelta,
            userTurnPolicy: "reset",
            forceReset: true
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

      for (;;) {
        if (controller.signal.aborted) break;
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

          if (event.usage) {
            const totals = agentSession.recordUsage(event.usage);
            writeAgentSse("agent_usage", { ...event.usage, totals });
          }

          const choice = event.choices?.[0];
          if (!choice) continue;
          if (choice.finish_reason) finishReason = choice.finish_reason;
          const delta = choice.delta || {};

          // Text content
          if (delta.content) {
            assistantContent += delta.content;
            writeAgentSse("agent_text", { content: delta.content });
          }

          // Reasoning
          const reasoning = delta.reasoning_content || delta.reasoning || "";
          if (reasoning) {
            assistantReasoning += reasoning;
            writeAgentSse("agent_reasoning", { content: reasoning });
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

      // Finalize tool calls
      toolCalls = Array.from(currentToolCalls.values()).map((tc) => {
        let parsedArgs = {};
        try { parsedArgs = JSON.parse(tc.arguments || "{}"); } catch {}
        return { id: tc.id, name: tc.name, arguments: parsedArgs };
      });

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

      // Commit the conversation state. After a forced reset the pending
      // metadata still describes the actual payload sent on the wire.
      agentSession.commit(modeChoice.pending, assistantMessage);
      fullMessages = agentSession.messages();

      // If no tool calls, we're done
      if (!toolCalls.length || finishReason !== "tool_calls") {
        writeAgentSse("agent_done", {
          iterations: iteration,
          finish_reason: finishReason || "stop",
          totals: agentSession.usageTotals
        });
        break;
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
        writeAgentSse("agent_tool_call", {
          id: tc.id,
          name: tc.name,
          arguments: tc.arguments
        });

        // Read-guard: short-circuit duplicate/covered reads with a synthetic
        // tool result so the model receives clear guidance instead of the
        // same content twice.
        if (tc.name === "read") {
          const decision = agentSession.readGuard.checkRead(tc.arguments, AGENT_READ_GUARD_MODE);
          if (decision?.block) {
            return { id: tc.id, name: tc.name, content: decision.reason, isError: true, guarded: true };
          }
        }

        // Bash guard: refuse bash commands that bypass the read tool to
        // dump file contents (cat/head/tail/sed/awk, find -exec, xargs).
        if (tc.name === "bash") {
          const decision = checkBashFileReadFallback(
            tc.arguments,
            agentSession.readGuard.hasBlockedReadsThisTurn()
          );
          if (decision?.block) {
            return { id: tc.id, name: tc.name, content: decision.reason, isError: true, guarded: true };
          }
        }

        const opts = {
          signal: controller.signal,
          onProgress: tc.name === "bash"
            ? (chunk) => writeAgentSse("agent_tool_progress", { id: tc.id, name: tc.name, chunk })
            : undefined
        };
        const result = await executeTool(tc.name, tc.arguments, opts);

        if (tc.name === "read" && !result.isError) {
          agentSession.readGuard.rememberRead(tc.arguments, result.raw);
        } else if ((tc.name === "write" || tc.name === "edit") && !result.isError) {
          agentSession.readGuard.invalidatePath(tc.arguments?.path);
        }

        return { id: tc.id, name: tc.name, content: result.content, isError: result.isError };
      };

      for (const group of groups) {
        if (controller.signal.aborted) break;
        const results = group.length === 1
          ? [await runToolCall(group[0])]
          : await Promise.all(group.map(runToolCall));

        for (const r of results) {
          writeAgentSse("agent_tool_result", {
            id: r.id,
            name: r.name,
            content: r.content,
            isError: r.isError,
            guarded: Boolean(r.guarded)
          });
          fullMessages.push({
            role: "tool",
            tool_call_id: r.id,
            content: r.content
          });
        }
      }
    }

    if (iteration >= AGENT_MAX_ITERATIONS) {
      writeAgentSse("agent_error", { error: `Agent reached maximum iterations (${AGENT_MAX_ITERATIONS})` });
    }

    res.end();
  } catch (err) {
    if (!res.writableEnded) {
      writeAgentSse("agent_error", { error: err.message || String(err) });
      res.end();
    }
  } finally {
    req.off("aborted", abort);
  }
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

const server = app.listen(config.control.port, config.control.host, async () => {
  try {
    await manager.start();
  } catch (err) {
    console.error("ds4-ui: failed to start ds4 server:", err);
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
    await manager.stop();
    await vite.close();
    forceCloseHttp = setTimeout(() => {
      if (typeof server.closeAllConnections === "function") server.closeAllConnections();
    }, HTTP_DRAIN_GRACE_MS);
    const closeError = await closeServer;
    if (closeError) throw closeError;
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
