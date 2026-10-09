// WP1 (piano.esecutivo.integrazione.opendots.v2.md §12-§13) — differential
// fixtures for POST /api/agent/chat.
//
// The real server (frontend/server/index.mjs) is spawned per scenario against
// a scripted node:http fake backend, like engineConformance.test.mjs.  What is
// recorded is the wire the legacy UI sees (HTTP status, SSE headers, the raw
// SSE body) and what the backend saw (model calls with their messages, native
// forwards, every other path counted).  A golden recorded on the code before
// the AgentRunService extraction is compared byte for byte with the current
// code; only clock values and random IDs are normalized (normalizeVolatile).
//
// CLI:  node agentRunParityHarness.mjs --record <out.json> [--only name,...]
// The child never reaches Vitronia or the live server: ports are ephemeral,
// config/sessions/blobs/call-debug live in a temp dir, the backend binary is
// /usr/bin/true and the crawl python /usr/bin/false.

import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import net from "node:net";
import { createHash } from "node:crypto";

const here = dirname(fileURLToPath(import.meta.url));
export const REPO = join(here, "..", "..", "..");
const FRONTEND = join(REPO, "frontend");
const CONFORMANCE = join(REPO, "tests", "fixtures", "conformance", "scenarios");
export const GOLDEN_PATH = join(REPO, "tests", "fixtures", "agent-run-parity", "legacy-golden.json");

// Paths polled on a timer (health checks): their count depends on the clock.
const POLLED_PATHS = new Set(["GET /v1/models", "GET /api/wrapper/status", "GET /health"]);

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
    probe.on("error", reject);
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── normalization: clock and random IDs only ────────────────────────────────

export function normalizeVolatile(text) {
  return String(text)
    // the copy the suite runs in (baseline and current trees live in
    // different temp dirs); file contents are compared as they are
    .split(REPO).join("<REPO>")
    .replace(/((?:\\?")(?:(?:threadId|runId|messageId|toolCallId|sessionId|sessionKey|requestId|traceId|spanId|proofId))(?:\\?"\s*:\s*\\?"))[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(\\?")/gi, "$1<UUID>$2")
    // Wall clock only appears in this DS4-generated datetime sentence and in
    // these structured timestamp fields. Keep arbitrary message text exact.
    .replace(/(session start: )[^.]*?(\. Use this)/g, "$1<DATETIME>$2")
    .replace(/((?:\\?")(?:(?:createdAt|updatedAt|startedAt|finishedAt|timestamp))(?:\\?"\s*:\s*\\?"))\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z(\\?")/g, "$1<ISO>$2")
    .replace(/((?:\\?")(?:(?:createdAt|updatedAt|startedAt|finishedAt|savedAt))(?:\\?"\s*:\s*))1[6-9]\d{11}/g, "$1<EPOCH_MS>")
    .replace(/(\d+ tok  )\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g, "$1<ISO>")
    // save identity: the sha covers createdAt, so it changes every run
    .replace(/((?:Saved|Switched to) session )[0-9a-f]{8}/g, "$1<SHA8>")
    .replace(/(^|\\n|")[0-9a-f]{8}(  \d+ tok  )/g, "$1<SHA8>$2")
    // also inside JSON nested in a string (the /list data block)
    .replace(/((?:sha|short)\\*"\s*:\s*\\*")[0-9a-f]{8,64}/g, "$1<SHA>")
    // AgentSessionStore keys are agent_<epoch-ms>_<counter>. Do not scrub
    // arbitrary 13-digit values from user/model/tool message content.
    .replace(/\b((?:ds4studio_)?agent_)(1[6-9]\d{11})_(\d+)\b/g, "$1<EPOCH_MS>_$3")
    // Lean proof ids: proof-<entropy>-<clock>-<nonce> (leanPaths.mjs)
    .replace(/((?:\\?")proofId(?:\\?"\s*:\s*\\?"))proof-[0-9a-f]+-1[6-9]\d{11}-\d+(\\?")/g, "$1proof-<RANDOM_ID>$2")
    .replace(/("(?:elapsedMs|durationMs|elapsed_ms|wallClockMs|elapsedWallClockMs|remainingWallClockMs)":)\d+/g, "$1<MS>");
}

// ── fake backend ────────────────────────────────────────────────────────────

function turnChunks(turn) {
  const delta = { role: "assistant" };
  if (turn.reasoning) delta.reasoning_content = turn.reasoning;
  if (turn.content) delta.content = turn.content;
  if (turn.toolCalls) {
    delta.tool_calls = turn.toolCalls.map((tc, index) => ({
      index,
      id: tc.id,
      function: { name: tc.name, arguments: JSON.stringify(tc.arguments) }
    }));
  }
  const last = {
    choices: [{ delta: {}, finish_reason: turn.finish || "stop" }],
    usage: { prompt_tokens: 100, completion_tokens: 5, total_tokens: 105, prompt_tokens_details: { cached_tokens: 42 } }
  };
  // split the content in two chunks so the stream has more than one delta
  if (turn.splitContent && typeof delta.content === "string" && delta.content.length > 1) {
    const cut = Math.floor(delta.content.length / 2);
    const first = { ...delta, content: delta.content.slice(0, cut) };
    delete first.tool_calls;
    const second = { content: delta.content.slice(cut) };
    if (delta.tool_calls) second.tool_calls = delta.tool_calls;
    return [{ choices: [{ delta: first, finish_reason: null }] }, { choices: [{ delta: second, finish_reason: null }] }, last];
  }
  return [{ choices: [{ delta, finish_reason: null }] }, last];
}

function turnCompletion(turn) {
  const message = { role: "assistant", content: turn.content || null };
  if (turn.toolCalls) {
    message.tool_calls = turn.toolCalls.map((tc) => ({
      id: tc.id, type: "function", function: { name: tc.name, arguments: JSON.stringify(tc.arguments) }
    }));
  }
  return {
    choices: [{ message, finish_reason: turn.finish || "stop" }],
    usage: { prompt_tokens: 100, completion_tokens: 5, total_tokens: 105 }
  };
}

// Long message bodies (system prompt, big tool results) are kept as an exact
// digest of their normalized text: equal digest <=> equal content.
function digestLong(content) {
  if (typeof content !== "string" || content.length <= 4096) return content;
  const text = normalizeVolatile(content);
  return { sha256: createHash("sha256").update(text).digest("hex"), length: text.length, head: text.slice(0, 160) };
}

function summarizeChatBody(body) {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  return {
    stream: Boolean(body.stream),
    tool_choice: body.tool_choice ?? null,
    max_tokens: body.max_tokens ?? null,
    tools: Array.isArray(body.tools) ? body.tools.map((t) => t?.function?.name ?? null) : null,
    messages: messages.map((m) => {
      const out = { role: m.role };
      if (m.content !== undefined) out.content = digestLong(m.content);
      if (m.tool_calls) out.tool_calls = m.tool_calls;
      if (m.tool_call_id) out.tool_call_id = m.tool_call_id;
      if (m.reasoning_content) out.reasoning_content = m.reasoning_content;
      return out;
    })
  };
}

export async function startFakeBackend(spec = {}) {
  const turns = spec.turns || [];
  let turnIdx = 0;
  let countScript = spec.tokenCounts?.length ? spec.tokenCounts : [100];
  let countIdx = 0;
  const nextTurn = () => turns[Math.min(turnIdx++, Math.max(turns.length - 1, 0))] || { content: "ok", finish: "stop" };
  const nextCount = () => countScript[Math.min(countIdx++, countScript.length - 1)];
  const log = []; // ordered, non-polled requests
  const pathCounts = {};
  const nativeTurns = spec.nativeTurns || [];
  let nativeIdx = 0;
  const releases = new Set();

  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", async () => {
      const url = req.url.split("?")[0];
      const key = `${req.method} ${url}`;
      if (!POLLED_PATHS.has(key)) pathCounts[key] = (pathCounts[key] || 0) + 1;
      let body = {};
      try { body = JSON.parse(raw || "{}"); } catch { /* keep empty */ }
      const json = (code, value) => {
        res.statusCode = code;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify(value));
      };
      if (key === "POST /v1/chat/completions") {
        log.push({ path: key, body: summarizeChatBody(body) });
        const turn = nextTurn();
        if (turn.destroy) { req.socket.destroy(); return; }
        if (turn.httpError) return json(turn.httpError.status, turn.httpError.body ?? { error: "fake failure" });
        if (turn.delayMs) await sleep(turn.delayMs);
        if (!body.stream) return json(200, turnCompletion(turn));
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        const chunks = turnChunks(turn);
        for (let i = 0; i < chunks.length; i++) {
          res.write(`data: ${JSON.stringify(chunks[i])}\n\n`);
          if (turn.stallAfterFirstChunk && i === 0) {
            // hold the round open until the client side goes away
            await new Promise((resolve) => {
              releases.add(resolve);
              res.on("close", resolve);
              setTimeout(resolve, 30000).unref?.();
            });
            if (res.destroyed || res.writableEnded) return;
          }
        }
        res.write("data: [DONE]\n\n");
        return res.end();
      }
      if (key === "POST /v1/token-count") return json(200, { prompt_tokens: nextCount() });
      if (key === "POST /tokenize" || key === "GET /props") return json(404, { error: "not found" });
      if (key === "POST /api/wrapper/switch-mode") {
        log.push({ path: key, body });
        return json(200, { ok: true, mode: body.mode, active_mode: body.mode });
      }
      if (key === "GET /api/wrapper/status") return json(200, { state: "ready", active_mode: "agent" });
      if (key === "POST /api/native-agent/prepare") {
        log.push({ path: key });
        return json(200, { ok: true, ready: true });
      }
      if (key === "POST /api/native-agent/command") {
        log.push({ path: key, body });
        return json(200, { ok: true, message: `native handled ${body.command}`, active: true });
      }
      if (key === "POST /api/native-agent/chat") {
        log.push({ path: key, body });
        const turn = nativeTurns[Math.min(nativeIdx++, Math.max(nativeTurns.length - 1, 0))] || {};
        if (turn.httpError) {
          res.statusCode = turn.httpError.status;
          return res.end(turn.httpError.text ?? "native failure");
        }
        res.writeHead(200, { "Content-Type": "text/event-stream", "X-Ds4-Native-Fixture": "1" });
        for (const frame of turn.frames || []) res.write(frame);
        return res.end();
      }
      return json(404, { error: "not found" });
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    server,
    port: server.address().port,
    log,
    pathCounts,
    setRequestIndex(i) {
      const byRequest = spec.tokenCountsByRequest;
      countScript = Array.isArray(byRequest?.[i]) ? byRequest[i] : (spec.tokenCounts?.length ? spec.tokenCounts : [100]);
      countIdx = 0;
    },
    releaseAll() { for (const r of releases) r(); releases.clear(); },
    close() { return new Promise((resolve) => server.close(() => resolve())); }
  };
}

// ── server child ────────────────────────────────────────────────────────────

export async function startServerChild(backend, { env = {}, native = false, agentConfig = {} } = {}) {
  const port = await freePort();
  const dir = mkdtempSync(join(tmpdir(), "wp1-parity-"));
  const cfgPath = join(dir, "ds4-ui.config.json");
  writeFileSync(cfgPath, JSON.stringify({
    control: { host: "127.0.0.1", port },
    server: { host: "127.0.0.1", port: backend.port, binary: "/usr/bin/true", model: "fake.gguf" },
    wrapper: { enabled: native },
    agno: { enabled: false },
    crawl: { host: "127.0.0.1", port: backend.port + 1 },
    toolBlobs: { compressEnabled: false, dir: join(dir, "tool-blobs") },
    callDebug: { dir: join(dir, "call-debug") },
    agent: { engine: native ? "native" : "js", ...agentConfig }
  }, null, 2));
  const child = spawn(process.execPath, ["server/index.mjs"], {
    cwd: FRONTEND,
    env: {
      ...process.env,
      DS4_UI_CONFIG: cfgPath,
      DS4_UI_HOST: "127.0.0.1",
      DS4_UI_PORT: String(port),
      DS4_SKILLS_DIR: join(REPO, "skills"),
      NODE_ENV: "test",
      DS4_CRAWL_PYTHON: "/usr/bin/false",
      DS4_AGENT_SESSIONS_DIR: join(dir, "sessions"),
      // Lean sandboxes stay in the temp dir, never in the tree's workspace/
      DS4_LEAN_RUNS_ROOT: join(dir, "lean-runs"),
      DS4_EPISTEMIC_MODE: "off",
      DS4_EVIDENCE_MODE: "off",
      DS4_AGENT_STATEFUL: "off",
      ...env
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  const logs = [];
  child.stdout.on("data", (d) => logs.push(String(d)));
  child.stderr.on("data", (d) => logs.push(String(d)));
  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 120000;
  for (;;) {
    if (Date.now() > deadline || child.exitCode !== null) {
      child.kill("SIGKILL");
      throw new Error(`server did not come up:\n${logs.join("").slice(-4000)}`);
    }
    try {
      const res = await fetch(`${base}/api/agent/status`, { signal: AbortSignal.timeout(2000) });
      if (res.ok) break;
    } catch { /* not listening yet */ }
    await sleep(300);
  }
  return {
    base,
    child,
    logs,
    stop() {
      try { child.kill("SIGKILL"); } catch { /* gone */ }
      try { rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
    }
  };
}

const KEPT_HEADERS = ["content-type", "cache-control", "connection", "x-accel-buffering", "x-ds4-native-fixture"];

// One POST /api/agent/chat as the legacy UI sends it.  abortAfterEvents: the
// client goes away after that many SSE events (the cancel fixture).
export async function postChat(base, sessionKey, message, { abortAfterEvents = 0, body: extraBody = {}, headers = {} } = {}) {
  const controller = new AbortController();
  const res = await fetch(`${base}/api/agent/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify({ sessionKey, message, ...extraBody }),
    signal: controller.signal
  });
  const kept = {};
  for (const name of KEPT_HEADERS) {
    const v = res.headers.get(name);
    if (v !== null) kept[name] = v;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let raw = "";
  let events = 0;
  let aborted = false;
  for (;;) {
    let step;
    try { step = await reader.read(); } catch { break; }
    if (step.done) break;
    raw += decoder.decode(step.value, { stream: true });
    if (abortAfterEvents) {
      events = (raw.match(/^event: /gm) || []).length;
      if (events >= abortAfterEvents) {
        aborted = true;
        controller.abort();
        break;
      }
    }
  }
  raw += decoder.decode();
  // keepalive comments depend on the clock; their presence is kept, not the count
  const keepalive = /^: keepalive$/m.test(raw);
  raw = raw.replace(/^: keepalive\n\n/gm, "");
  return { status: res.status, headers: kept, keepalive, aborted, body: normalizeVolatile(raw) };
}

async function startSession(base, sessionKey) {
  const r = await fetch(`${base}/api/agent/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionKey })
  });
  return { status: r.status, body: normalizeVolatile(await r.text()) };
}

// ── scenarios ───────────────────────────────────────────────────────────────

function conformance(file) {
  const fx = JSON.parse(readFileSync(join(CONFORMANCE, file), "utf8"));
  return {
    name: `conformance/${fx.name}`,
    backend: fx.backend || {},
    env: fx.env || {},
    agentConfig: fx.agentConfig || {},
    requests: fx.requests.map((m) => ({ message: m }))
  };
}

const NATIVE_FRAMES = [
  "event: agent_status\ndata: {\"iteration\":1,\"mode\":\"native\"}\n\n",
  "event: agent_text\ndata: {\"content\":\"Risposta nativa àè 数\"}\n\n",
  "event: agent_done\ndata: {\"iterations\":1,\"finish_reason\":\"stop\"}\n\n"
];

export const SCENARIOS = [
  {
    name: "success-text",
    backend: { turns: [{ reasoning: "Penso.", content: "Risposta finale: 4 — àè 数学 𝔽.", splitContent: true, finish: "stop" }] },
    requests: [{ message: "Quanto fa 2+2?" }, { message: "Grazie." }]
  },
  {
    name: "tool-result",
    backend: {
      turns: [
        { toolCalls: [{ id: "r1", name: "read", arguments: { path: "tests/fixtures/agent-run-parity/hello.txt" } }], finish: "tool_calls" },
        { content: "Il file contiene tre righe.", finish: "stop" }
      ]
    },
    requests: [{ message: "Leggi tests/fixtures/agent-run-parity/hello.txt" }]
  },
  {
    name: "tool-error",
    backend: {
      turns: [
        { toolCalls: [{ id: "e1", name: "read", arguments: { path: "tests/fixtures/agent-run-parity/missing.txt" } }], finish: "tool_calls" },
        { content: "Il file non esiste.", finish: "stop" }
      ]
    },
    requests: [{ message: "Leggi tests/fixtures/agent-run-parity/missing.txt" }]
  },
  {
    name: "backend-http-error",
    backend: { turns: [{ httpError: { status: 500, body: { error: "model exploded" } } }, { content: "Dopo l'errore.", finish: "stop" }] },
    requests: [{ message: "Prova." }, { message: "Riprova." }]
  },
  {
    name: "backend-fetch-failure",
    backend: { turns: [{ destroy: true }, { content: "Ripreso.", finish: "stop" }] },
    requests: [{ message: "Prova." }, { message: "Riprova." }]
  },
  {
    name: "slash-commands",
    backend: { turns: [{ content: "Annotato.", finish: "stop" }] },
    requests: [
      { message: "/pony status" },
      { message: "/pony lite" },
      { message: "/help" },
      { message: "/skill list" },
      { message: "/compact" },
      { message: "/save" },
      { message: "Ricorda Zephyr-42." },
      { message: "/save" },
      { message: "/list" },
      { message: "/new" },
      { message: "/switch 00000000" },
      { message: "/nonexistent-command" }
    ]
  },
  {
    name: "manual-compact",
    backend: {
      turns: [
        { toolCalls: [{ id: "b1", name: "read", arguments: { path: "tests/fixtures/conformance/big-read.txt", start_line: 1 } }], finish: "tool_calls" },
        { content: "Letto.", finish: "stop" },
        { content: "Secondo turno.", finish: "stop" },
        { content: "Summary: the big file was read and noted.", finish: "stop" },
        { content: "Dopo la compattazione.", finish: "stop" }
      ]
    },
    requests: [{ message: "Leggi il file grande." }, { message: "Continua." }, { message: "/compact" }, { message: "Ancora." }]
  },
  {
    name: "cancel-mid-stream",
    backend: {
      turns: [
        { content: "Parte annullata che non deve restare.", stallAfterFirstChunk: true, finish: "stop" },
        { content: "Turno dopo l'annullamento.", finish: "stop" }
      ]
    },
    // two events: agent_status and the first agent_text, so the model call is
    // certainly in flight (held open by the backend) when the client leaves
    requests: [{ message: "Inizia.", abortAfterEvents: 2 }, { message: "Di nuovo." }]
  },
  {
    name: "lean-proof-not-verified",
    env: { DS4_LEAN_ENABLED: "1", DS4_LEAN_RUNTIME_ROOT: "/nonexistent/lean-runtime" },
    backend: {
      turns: [
        {
          toolCalls: [{
            id: "l1",
            name: "lean_check",
            arguments: {
              code: "theorem t : 1 + 1 = 2 := rfl",
              task_mode: "proof",
              target_declaration: "t",
              target_statement: "theorem t : 1 + 1 = 2",
              profile: "core"
            }
          }],
          finish: "tool_calls"
        },
        { content: "Teorema dimostrato.", finish: "stop" },
        { content: "STATO: NOT_VERIFIED (LEAN_RUNTIME_UNAVAILABLE).", finish: "stop" }
      ]
    },
    requests: [{ message: "/lean start" }, { message: "Dimostra 1 + 1 = 2 in Lean." }]
  },
  {
    // the real Lean runtime of the checkout (lean-runtime/), when present
    name: "lean-proof-real-runtime",
    env: { DS4_LEAN_ENABLED: "1" },
    backend: {
      turns: [
        {
          toolCalls: [{
            id: "l1",
            name: "lean_check",
            arguments: {
              code: "theorem t : 1 + 1 = 2 := by rfl",
              task_mode: "proof",
              target_declaration: "t",
              target_statement: "theorem t : 1 + 1 = 2",
              profile: "core"
            }
          }],
          finish: "tool_calls"
        },
        { content: "STATO: VERIFIED\n\n```lean\ntheorem t : 1 + 1 = 2 := by rfl\n```", finish: "stop" },
        { content: "STATO: NOT_VERIFIED.", finish: "stop" },
        { content: "STATO: NOT_VERIFIED.", finish: "stop" }
      ]
    },
    requests: [{ message: "/lean start" }, { message: "Dimostra 1 + 1 = 2 in Lean." }]
  },
  {
    name: "sage-mixed-tool-block",
    backend: {
      turns: [
        {
          toolCalls: [
            { id: "s1", name: "sage", arguments: { code: "print(2+2)", phase: "compute", task_type: "evaluate" } },
            { id: "s2", name: "read", arguments: { path: "tests/fixtures/agent-run-parity/hello.txt" } }
          ],
          finish: "tool_calls"
        },
        { content: "Nessun calcolo eseguito.", finish: "stop" }
      ]
    },
    requests: [{ message: "Calcola 2+2 con Sage e leggi il file." }]
  },
  {
    name: "debug-header",
    backend: { turns: [{ content: "Con debug.", finish: "stop" }] },
    requests: [{ message: "Debug.", headers: { "X-Agent-Debug": "1" } }]
  },
  {
    name: "rejections",
    backend: { turns: [{ content: "mai", finish: "stop" }] },
    startSession: false,
    requests: [
      { message: "Senza sessione.", sessionKey: "never-started" },
      { message: "/pony lite", sessionKey: "never-started" },
      { message: "", startFirst: true },
      { message: null, body: { messages: [] } }
    ]
  },
  {
    name: "native-forwarding",
    native: true,
    backend: {
      nativeTurns: [
        { frames: NATIVE_FRAMES },
        { httpError: { status: 503, text: "wrapper busy" } }
      ]
    },
    requests: [
      { message: "Ciao nativo.", body: { request: { max_tokens: 64, temperature: 0.2 } } },
      { message: "/pony status" },
      { message: "/help" },
      { message: "Secondo turno nativo." },
      { message: "Senza sessione.", sessionKey: "never-started" },
      { message: "   " }
    ]
  },
  conformance("01-tool-call-and-final.json"),
  conformance("04-file-echo-blocked.json"),
  conformance("06-compaction.json"),
  conformance("06b-compaction-nothing-to-summarize.json"),
  conformance("08-evidence-hold-and-finalize.json"),
  conformance("09-skill-evidence-commands.json"),
  conformance("10-session-save-new-switch.json"),
  conformance("11-fabricated-result.json"),
  conformance("16-degenerate-reasoning-round.json"),
  conformance("17-lean-round-token-ceiling.json")
];

export async function runScenario(scenario) {
  const backend = await startFakeBackend(scenario.backend || {});
  let srv = null;
  try {
    srv = await startServerChild(backend, {
      env: scenario.env || {},
      native: Boolean(scenario.native),
      agentConfig: scenario.agentConfig || {}
    });
    const sessionKey = `wp1-${scenario.name.replace(/[^a-z0-9]+/gi, "-")}`;
    const steps = [];
    if (scenario.startSession !== false) steps.push({ start: await startSession(srv.base, sessionKey) });
    for (let i = 0; i < scenario.requests.length; i++) {
      const req = scenario.requests[i];
      backend.setRequestIndex(i);
      if (req.startFirst) steps.push({ start: await startSession(srv.base, sessionKey) });
      const result = await postChat(srv.base, req.sessionKey || sessionKey, req.message, {
        abortAfterEvents: req.abortAfterEvents || 0,
        body: req.body || {},
        headers: req.headers || {}
      });
      if (result.aborted) {
        // let the server observe the disconnect and finish the turn
        await sleep(400);
        backend.releaseAll();
        await sleep(400);
      }
      steps.push({ request: req.message, ...result });
    }
    return {
      name: scenario.name,
      steps,
      modelCalls: backend.log.filter((e) => e.path === "POST /v1/chat/completions").length,
      toolCallEvents: steps.reduce((n, s) => n + ((s.body || "").match(/^event: agent_tool_call$/gm) || []).length, 0),
      backendLog: JSON.parse(normalizeVolatile(JSON.stringify(backend.log))),
      backendPathCounts: Object.fromEntries(Object.entries(backend.pathCounts).sort())
    };
  } catch (error) {
    error.message += srv ? `\n--- server log ---\n${srv.logs.join("").slice(-3000)}` : "";
    throw error;
  } finally {
    srv?.stop();
    backend.releaseAll();
    await backend.close();
  }
}

export async function runAll(only = null) {
  const out = {};
  for (const scenario of SCENARIOS) {
    if (only && !only.includes(scenario.name)) continue;
    out[scenario.name] = await runScenario(scenario);
  }
  return out;
}

// Every difference between two recordings, as "path: expected !== actual".
export function diffRecordings(expected, actual, path = "") {
  if (typeof expected !== "object" || expected === null || typeof actual !== "object" || actual === null) {
    if (expected === actual) return [];
    const show = (v) => JSON.stringify(v)?.slice(0, 400);
    if (typeof expected === "string" && typeof actual === "string") {
      let i = 0;
      while (i < expected.length && expected[i] === actual[i]) i++;
      return [`${path}: differs at char ${i}: expected ${show(expected.slice(Math.max(0, i - 80), i + 200))} actual ${show(actual.slice(Math.max(0, i - 80), i + 200))}`];
    }
    return [`${path}: expected ${show(expected)} actual ${show(actual)}`];
  }
  const keys = new Set([...Object.keys(expected), ...Object.keys(actual)]);
  const out = [];
  for (const key of keys) out.push(...diffRecordings(expected[key], actual[key], `${path}/${key}`));
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args[0] === "--compare") {
    const [a, b] = [args[1], args[2]].map((p) => JSON.parse(readFileSync(p, "utf8")));
    const diffs = diffRecordings(a, b);
    console.log(diffs.length ? diffs.join("\n") : "IDENTICAL");
    process.exit(diffs.length ? 1 : 0);
  }
  const outIdx = args.indexOf("--record");
  const onlyIdx = args.indexOf("--only");
  const only = onlyIdx >= 0 ? args[onlyIdx + 1].split(",") : null;
  const result = await runAll(only);
  const text = JSON.stringify({ version: 1, scenarios: result }, null, 2) + "\n";
  if (outIdx >= 0) writeFileSync(args[outIdx + 1], text);
  else process.stdout.write(text);
  console.error(`recorded ${Object.keys(result).length} scenarios`);
  process.exit(0);
}
