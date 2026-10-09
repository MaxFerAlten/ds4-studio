// WP15 of convergenza.loop.md — conformance suite with fake backends.
//
// The real JS loop (frontend/server/index.mjs) is spawned as a child process
// against a scripted node:http fake backend, once per backend variant:
//   "ds4":   POST /v1/token-count answers, GET /props does not, deltas carry
//            reasoning_content, usage carries prompt_tokens_details.cached_tokens.
//   "llama": POST /v1/token-count is a 404, /tokenize and /props answer, and
//            any request with a "system" message after the first is a 500
//            (like the Qwen template), proving the loop never pushes one.
// Scenarios live in tests/fixtures/conformance/scenarios/*.json and run with
// IDENTICAL assertions on both variants — that is what demonstrates the
// convergence the plan asks for (§18).
//
// The child never touches Vitronia or the production Node server: the config
// is a temp file and DS4_UI_HOST/DS4_UI_PORT are pinned (index.mjs:296-297
// lets them win over the config file), the backend binary is /usr/bin/true
// and the crawl python is /usr/bin/false. Every child is killed in after().

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import net from "node:net";

const here = dirname(fileURLToPath(import.meta.url));
const REPO = join(here, "..", "..");
const FRONTEND = join(REPO, "frontend");
const SCENARIOS_DIR = join(REPO, "tests", "fixtures", "conformance", "scenarios");
const VARIANTS = ["ds4", "llama"];

// The children run the real server; anything it records must land in their
// temp dir, never in the repo's data/ (WP16: conformance calls showed up in
// the production Call Debug log).
const PROD_CALL_DEBUG = join(REPO, "data", "call-debug", "calls.ndjson");
// A live server may be appending to that log meanwhile, so the check is on
// what was appended: nothing may name one of this run's fake backends.
const sizeOf = (path) => { try { return statSync(path).size; } catch { return 0; } };
const prodCallDebugStart = sizeOf(PROD_CALL_DEBUG);
const fakeBackendPorts = new Set();

const children = new Set();
after(() => {
  for (const child of children) {
    try { child.kill("SIGKILL"); } catch { /* already gone */ }
  }
});

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

function expandTurn(turn) {
  if (!turn.repeat) return turn;
  if (turn.repeat.lineTemplate) {
    // numbered lines: identical repeated phrases would trip the echo guard
    const times = Number(turn.repeat.times) || 1;
    let text = "";
    for (let i = 1; i <= times; i++) {
      text += turn.repeat.lineTemplate.replace("{n}", String(i)) + "\n";
    }
    // a markdown heading keeps the long-output guard satisfied (it wants a
    // state marker or markdown structure in long replies)
    return {
      ...turn,
      content: (turn.repeat.prefix || "") + text,
      finish: turn.finish || "stop"
    };
  }
  return {
    ...turn,
    content: String(turn.repeat.text).repeat(Number(turn.repeat.times) || 1),
    finish: turn.finish || "stop"
  };
}

function makeTurnChunks(turn, variant) {
  const delta = { role: "assistant" };
  // reasoningBothVariants: llama.cpp also streams reasoning_content for
  // thinking models (Qwen on Vitronia); scenario 16 needs it on both.
  if (turn.reasoning && (variant === "ds4" || turn.reasoningBothVariants)) {
    delta.reasoning_content = turn.reasoning;
  }
  if (turn.content) delta.content = turn.content;
  if (turn.toolCalls) {
    delta.tool_calls = turn.toolCalls.map((tc, index) => ({
      index,
      id: tc.id,
      function: { name: tc.name, arguments: JSON.stringify(tc.arguments) }
    }));
  }
  const last = { choices: [{ delta: {}, finish_reason: turn.finish || "stop" }] };
  if (variant === "ds4") {
    last.usage = {
      prompt_tokens: 100,
      completion_tokens: 5,
      total_tokens: 105,
      prompt_tokens_details: { cached_tokens: 42 }
    };
  }
  return [{ choices: [{ delta, finish_reason: null }] }, last];
}

function turnToCompletion(turn, variant) {
  const message = { role: "assistant", content: turn.content || null };
  if (turn.toolCalls) {
    message.tool_calls = turn.toolCalls.map((tc) => ({
      id: tc.id,
      type: "function",
      function: { name: tc.name, arguments: JSON.stringify(tc.arguments) }
    }));
  }
  const body = { choices: [{ message, finish_reason: turn.finish || "stop" }] };
  if (variant === "ds4") {
    body.usage = {
      prompt_tokens: 100,
      completion_tokens: 5,
      total_tokens: 105,
      prompt_tokens_details: { cached_tokens: 42 }
    };
  }
  return body;
}

async function startBackend(variant, spec) {
  const turns = (spec.turns || []).map(expandTurn);
  let turnIdx = 0;
  let countScript = spec.tokenCounts && spec.tokenCounts.length ? spec.tokenCounts : [100];
  let countIdx = 0;
  const nextTurn = () => turns[Math.min(turnIdx++, Math.max(turns.length - 1, 0))] ||
    { content: "ok", finish: "stop" };
  const nextCount = () => countScript[Math.min(countIdx++, countScript.length - 1)];
  // every /v1/chat/completions body, in order, for expectRequest assertions
  // (scenario 07: the reminder mutates the transcript, it emits no SSE event)
  const bodies = [];
  // singleSlot: like ds4-wrapper, one chat at a time, 409 "busy" otherwise.
  // A side call (non-stream, not a scripted agent round: the epistemic claim
  // segmenter) holds the slot for slowSideCallsMs or until its client leaves,
  // the way the fixed wrapper frees a slot on disconnect.
  let inFlight = 0;
  let sideCalls = 0;
  const isSideCall = (body) => !body.stream && Array.isArray(body.messages) &&
    String(body.messages[0]?.content || "").includes("claim segmentation");

  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", async () => {
      const url = req.url.split("?")[0];
      const json = (code, value) => {
        res.statusCode = code;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify(value));
      };
      if (req.method === "POST" && url === "/v1/chat/completions") {
        let body = {};
        try { body = JSON.parse(raw || "{}"); } catch { /* keep empty */ }
        if (spec.singleSlot && inFlight > 0) {
          return json(409, { ok: false, error: "conflict", message: "wrapper is busy" });
        }
        if (isSideCall(body)) {
          sideCalls++;
          inFlight++;
          let freed = false;
          const free = () => { if (!freed) { freed = true; inFlight--; } };
          res.on("close", free);
          const timer = setTimeout(() => {
            free();
            json(200, turnToCompletion({ content: '{"claims":[]}', finish: "stop" }, variant));
          }, spec.slowSideCallsMs || 0);
          res.on("close", () => clearTimeout(timer));
          return;
        }
        bodies.push(body);
        if (variant === "llama") {
          const messages = Array.isArray(body.messages) ? body.messages : [];
          if (messages.some((m, i) => i > 0 && m && m.role === "system")) {
            // like the Qwen template: a system turn after the first is fatal
            return json(500, { error: "system role not allowed after the first message" });
          }
        }
        const turn = nextTurn();
        // delayMs: a turn the backend sits on before the first byte (a slow
        // prefill, or a round the loop withholds), scenario 14
        if (turn.delayMs) await new Promise((r) => setTimeout(r, turn.delayMs));
        if (body.stream) {
          res.writeHead(200, { "Content-Type": "text/event-stream" });
          for (const chunk of makeTurnChunks(turn, variant)) {
            res.write(`data: ${JSON.stringify(chunk)}\n\n`);
          }
          res.write("data: [DONE]\n\n");
          return res.end();
        }
        return json(200, turnToCompletion(turn, variant));
      }
      if (req.method === "POST" && url === "/v1/token-count") {
        if (variant !== "ds4") return json(404, { error: "not found" });
        return json(200, { prompt_tokens: nextCount() });
      }
      if (req.method === "POST" && url === "/tokenize") {
        if (variant !== "llama") return json(404, { error: "not found" });
        return json(200, { tokens: new Array(nextCount()).fill(1) });
      }
      if (req.method === "GET" && url === "/props") {
        if (variant !== "llama") return json(404, { error: "not found" });
        return json(200, {
          default_generation_settings: { n_ctx: spec.propsNctx || 32768 },
          // totalSlots: llama-server's -np, scenario 18
          ...(spec.totalSlots ? { total_slots: spec.totalSlots } : {})
        });
      }
      return json(404, { error: "not found" });
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  fakeBackendPorts.add(server.address().port);
  return {
    server,
    port: server.address().port,
    bodies,
    get sideCalls() { return sideCalls; },
    // per-request token-count scripts: the number of internal
    // countPromptTokens calls inside one chat request is a loop detail, so
    // scenarios script counts per user request, not per backend call
    setRequestIndex(i) {
      const byRequest = spec.tokenCountsByRequest;
      countScript = (Array.isArray(byRequest) && Array.isArray(byRequest[i]))
        ? byRequest[i]
        : (spec.tokenCounts && spec.tokenCounts.length ? spec.tokenCounts : [100]);
      countIdx = 0;
    }
  };
}

async function startServerChild(backend, env = {}, agentConfig = {}) {
  const port = await freePort();
  const dir = mkdtempSync(join(tmpdir(), "wp15-conf-"));
  const cfgPath = join(dir, "ds4-ui.config.json");
  writeFileSync(cfgPath, JSON.stringify({
    control: { host: "127.0.0.1", port },
    server: { host: "127.0.0.1", port: backend.port, binary: "/usr/bin/true", model: "fake.gguf" },
    wrapper: { enabled: false },
    agno: { enabled: false },
    crawl: { host: "127.0.0.1", port: backend.port + 1 },
    // determinism: the tool-output compressor (>= 4096 bytes) would shrink
    // big read results below the compaction tail budget, making scenario 06
    // depend on compression instead of on the compaction thresholds
    toolBlobs: { compressEnabled: false, dir: join(dir, "tool-blobs") },
    callDebug: { dir: join(dir, "call-debug") },
    // agentConfig: per-fixture agent settings that have no env switch
    // (scenario 13: agent.epistemic.enabled is config-only)
    agent: { engine: "js", ...agentConfig }
  }, null, 2));
  const child = spawn(process.execPath, ["server/index.mjs"], {
    cwd: FRONTEND,
    env: {
      ...process.env,
      DS4_UI_CONFIG: cfgPath,
      // the shell may export these and index.mjs:296-297 lets them win
      DS4_UI_HOST: "127.0.0.1",
      DS4_UI_PORT: String(port),
      // production runs from the repo root, where the default "skills" resolves;
      // this child runs from frontend/, so without it skill state is null
      DS4_SKILLS_DIR: join(REPO, "skills"),
      NODE_ENV: "test",
      DS4_CRAWL_PYTHON: "/usr/bin/false",
      DS4_AGENT_SESSIONS_DIR: join(dir, "sessions"),
      DS4_EPISTEMIC_MODE: "off",
      DS4_EVIDENCE_MODE: "off",
      ...env
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  children.add(child);
  child.on("exit", () => children.delete(child));
  const logs = [];
  child.stdout.on("data", (d) => logs.push(String(d)));
  child.stderr.on("data", (d) => logs.push(String(d)));
  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 120000;
  for (;;) {
    if (Date.now() > deadline) {
      child.kill("SIGKILL");
      throw new Error(`server did not come up:\n${logs.join("").slice(-4000)}`);
    }
    try {
      const res = await fetch(`${base}/api/agent/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionKey: "wp15-probe" })
      });
      if (res.ok) break;
    } catch { /* not listening yet */ }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return { base, child, logs };
}

async function runChat(base, sessionKey, message) {
  const res = await fetch(`${base}/api/agent/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionKey, message }),
    signal: AbortSignal.timeout(120000)
  });
  if (!res.ok) throw new Error(`chat HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const events = [];
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let currentEvent = "message";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).replace(/\r$/, "");
      buf = buf.slice(nl + 1);
      if (line.startsWith(":")) events.push({ event: "comment", data: { text: line.slice(1).trim() } });
      else if (line.startsWith("event:")) currentEvent = line.slice(6).trim();
      else if (line.startsWith("data:")) {
        const payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        try { events.push({ event: currentEvent, data: JSON.parse(payload) }); } catch { /* ignore */ }
      } else if (line === "") currentEvent = "message";
    }
  }
  return events;
}

function matchEvent(events, entry) {
  return events.some((e) => {
    if (entry.event && e.event !== entry.event) return false;
    for (const [key, value] of Object.entries(entry.data || {})) {
      if (e.data?.[key] !== value) return false;
    }
    for (const [key, needle] of Object.entries(entry.dataContains || {})) {
      if (!String(e.data?.[key] ?? "").includes(needle)) return false;
    }
    return true;
  });
}

function eventSummary(events) {
  return events.map((e) => `${e.event} ${JSON.stringify(e.data).slice(0, 120)}`).join("\n  ");
}

const fixtureFiles = readdirSync(SCENARIOS_DIR).filter((f) => f.endsWith(".json")).sort();
assert.ok(fixtureFiles.length >= 3, `expected at least 3 scenario fixtures, got ${fixtureFiles.length}`);

for (const file of fixtureFiles) {
  const fixture = JSON.parse(readFileSync(join(SCENARIOS_DIR, file), "utf8"));
  test(fixture.name || file, async (t) => {
    // variants: a fixture whose rule only one backend family can express
    for (const variant of fixture.variants || VARIANTS) {
      await t.test(variant, async () => {
        const backend = await startBackend(variant, fixture.backend || {});
        let child = null;
        try {
          const srv = await startServerChild(backend, fixture.env || {}, fixture.agentConfig || {});
          child = srv.child;
          const sessionKey = `wp15-${variant}-${file}`;
          // the readiness probe started its own session: activate this one
          const startRes = await fetch(`${srv.base}/api/agent/start`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sessionKey })
          });
          assert.equal(startRes.status, 200);
          let events = [];
          const requests = fixture.requests || [];
          for (let i = 0; i < requests.length; i++) {
            backend.setRequestIndex(i);
            // sessionPerRequest: each request in its own session (two UI tabs
            // or two drivers sharing one single-slot backend, scenario 13b)
            let key = sessionKey;
            if (fixture.sessionPerRequest && i > 0) {
              key = `${sessionKey}-${i}`;
              const r = await fetch(`${srv.base}/api/agent/start`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ sessionKey: key })
              });
              assert.equal(r.status, 200);
            }
            events = events.concat(await runChat(srv.base, key, requests[i]));
          }
          for (const entry of fixture.expect || []) {
            assert.ok(
              matchEvent(events, entry),
              `[${variant}] expected event ${JSON.stringify(entry)}\n  got:\n  ${eventSummary(events)}`
            );
          }
          for (const entry of fixture.expectAbsent || []) {
            assert.ok(
              !matchEvent(events, entry),
              `[${variant}] absent event ${JSON.stringify(entry)} was present:\n  ${eventSummary(events)}`
            );
          }
          // sideCallsAtMost: claim-segmentation calls the backend may receive
          if (fixture.sideCallsAtMost !== undefined) {
            assert.ok(
              backend.sideCalls <= fixture.sideCallsAtMost,
              `[${variant}] ${backend.sideCalls} side calls > ${fixture.sideCallsAtMost}`
            );
          }
          // expectRequest: assertions on the Nth /v1/chat/completions body
          // (0-based). messagesContain must appear in some message, optionally
          // restricted to one role — scenario 07 needs "user" because the core
          // rules also ride in the system prompt.
          for (const entry of fixture.expectRequest || []) {
            const body = backend.bodies[entry.index];
            assert.ok(
              body && Array.isArray(body.messages),
              `[${variant}] no chat-completions body #${entry.index} (got ${backend.bodies.length})`
            );
            // maxTokensAtMost: the round's token ceiling (scenario 17)
            if (entry.maxTokensAtMost !== undefined) {
              assert.ok(
                Number.isFinite(body.max_tokens) && body.max_tokens <= entry.maxTokensAtMost,
                `[${variant}] request #${entry.index} max_tokens=${body.max_tokens} > ${entry.maxTokensAtMost}`
              );
              if (entry.toolsContain === undefined && entry.messagesContain === undefined) continue;
            }
            // toolsContain: a tool name the request must declare (scenario 15)
            if (entry.toolsContain) {
              const names = (body.tools || []).map((t) => t?.function?.name);
              assert.ok(
                names.includes(entry.toolsContain),
                `[${variant}] request #${entry.index} does not declare ${entry.toolsContain}; tools: ${names.join(",")}`
              );
              if (entry.messagesContain === undefined) continue;
            }
            const messages = entry.role
              ? body.messages.filter((m) => m && m.role === entry.role)
              : body.messages;
            const textOf = (m) => typeof m.content === "string"
              ? m.content
              : JSON.stringify(m.content ?? "");
            assert.ok(
              messages.some((m) => textOf(m).includes(entry.messagesContain)),
              `[${variant}] request #${entry.index}${entry.role ? ` (${entry.role})` : ""} has no message containing ` +
              JSON.stringify(String(entry.messagesContain).slice(0, 80)) +
              `; roles seen: ${body.messages.map((m) => m.role).join(",")}`
            );
          }
        } finally {
          if (child) child.kill("SIGKILL");
          backend.server.close();
        }
      });
    }
  });
}

test("the conformance children leave the production call-debug log untouched", () => {
  assert.ok(fakeBackendPorts.size > 0);
  let appended = "";
  try { appended = readFileSync(PROD_CALL_DEBUG).subarray(prodCallDebugStart).toString("utf8"); } catch { /* no log */ }
  for (const port of fakeBackendPorts) {
    assert.ok(!appended.includes(`127.0.0.1:${port}`), `fake backend :${port} recorded in ${PROD_CALL_DEBUG}`);
  }
});
