// WP2: admission on the real server (server/index.mjs as a child process,
// scripted fake backend from the WP1 parity harness, loopback only).
//   - two legacy tabs, ordinary chat, structured routes and global controls
//     against one active run: busy 409 before any byte, nothing reaches the
//     backend;
//   - /v1/cancel authority: a foreign owner is refused, the lease owner
//     cancels, the lease is released after teardown;
//   - a runtime callback (/api/sage/exec without browser metadata) joins the
//     run instead of deadlocking;
//   - legacy idempotency key, reserved server-owned session keys;
//   - A/B/A with skills and compaction: A's model request after B is
//     byte-identical to the same A sequence on a server that never saw B.
//   - Agno model gateway: a cross-origin browser is refused before admission
//     (no lease, nothing forwarded); same-origin and the Agno service keep the
//     shared lease.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { normalizeVolatile, startFakeBackend, startServerChild } from "./agent/agentRunParityHarness.mjs";
import { ensureAgnoTokens } from "./agno/agnoToken.mjs";

const json = (body) => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

async function startSession(base, sessionKey) {
  const res = await fetch(`${base}/api/agent/start`, json({ sessionKey }));
  assert.equal(res.status, 200, await res.text());
}

// Opens a legacy chat and returns once `events` SSE events have arrived; the
// stream stays open.
async function openChat(base, sessionKey, message, { events = 2, headers = {} } = {}) {
  const res = await fetch(`${base}/api/agent/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify({ sessionKey, message })
  });
  assert.equal(res.status, 200);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let raw = "";
  while ((raw.match(/^event: /gm) || []).length < events) {
    const step = await reader.read();
    if (step.done) break;
    raw += decoder.decode(step.value, { stream: true });
  }
  return {
    cookie: (res.headers.get("set-cookie") || "").split(";")[0],
    raw: () => raw,
    async abort() {
      await reader.cancel().catch(() => {});
    },
    async rest() {
      for (;;) {
        let step;
        try { step = await reader.read(); } catch { break; }
        if (step.done) break;
        raw += decoder.decode(step.value, { stream: true });
      }
      return raw;
    }
  };
}

async function chat(base, sessionKey, message, headers = {}) {
  const res = await fetch(`${base}/api/agent/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify({ sessionKey, message })
  });
  return { status: res.status, cookie: (res.headers.get("set-cookie") || "").split(";")[0], text: await res.text() };
}

function curlPost(url, body) {
  return new Promise((resolve, reject) => {
    const req = httpRequest(url, { method: "POST", agent: false, headers: { "Content-Type": "application/json" } }, (res) => {
      let text = "";
      res.on("data", (chunk) => { text += chunk; });
      res.on("end", () => resolve({ status: res.statusCode, text }));
    });
    req.once("error", reject);
    req.end(JSON.stringify(body));
  });
}

async function until(predicate, ms = 5000) {
  const deadline = Date.now() + ms;
  while (!(await predicate())) {
    if (Date.now() > deadline) throw new Error("condition not reached");
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

async function withServer(backendSpec, fn, { env = {} } = {}) {
  const backend = await startFakeBackend(backendSpec);
  let srv = null;
  try {
    srv = await startServerChild(backend, { env: typeof env === "function" ? env(backend) : env });
    return await fn(srv.base, backend);
  } catch (error) {
    error.message += srv ? `\n--- server log ---\n${srv.logs.join("").slice(-3000)}` : "";
    throw error;
  } finally {
    srv?.stop();
    backend.releaseAll();
    await backend.close();
  }
}

const modelCalls = (backend) => backend.log.filter((e) => e.path === "POST /v1/chat/completions").length;

test("one active run excludes tabs, ordinary chat, structured routes and controls; cancel is lease-owner only", { timeout: 120000 }, async () => {
  await withServer({
    turns: [
      { content: "Tab A in corso.", stallAfterFirstChunk: true, finish: "stop" },
      { content: "Tab B dopo il rilascio.", finish: "stop" }
    ]
  }, async (base, backend) => {
    await startSession(base, "tab-a");
    await startSession(base, "tab-b");
    const tabA = await openChat(base, "tab-a", "Inizia A.");
    assert.match(tabA.cookie, /^ds4_owner=/);
    assert.equal(modelCalls(backend), 1);

    const tabB = await chat(base, "tab-b", "Concorrente B.");
    assert.equal(tabB.status, 409);
    assert.equal(JSON.parse(tabB.text).code, "INFERENCE_BUSY");

    const busy = [
      ["/v1/chat/completions", { method: "POST", body: { messages: [{ role: "user", content: "chat normale" }], stream: false } }],
      ["/api/files/chunked-analyze", { method: "POST", body: { document: "# Doc\n\ntesto", question: "?" } }],
      ["/api/agent/web-search", { method: "POST", body: { query: "ds4 admission" } }],
      ["/api/research/start", { method: "POST", body: { query: "ricerca" } }],
      ["/api/agno-model/v1/chat/completions", { method: "POST", body: { messages: [] } }],
      ["/api/profiles/select", { method: "POST", body: { id: "x" } }],
      ["/api/server/config", { method: "PUT", body: {} }],
      ["/api/server/restart", { method: "POST", body: {} }],
      ["/api/agent/start", { method: "POST", body: { sessionKey: "tab-c" } }],
      ["/api/agent/stop", { method: "POST", body: { sessionKey: "tab-a" } }],
      ["/api/wrapper/switch-mode", { method: "POST", body: { mode: "server" } }],
      ["/api/native-agent/command", { method: "POST", body: { command: "/save" } }],
      ["/api/agent/pony", { method: "POST", body: { mode: "lite" } }],
      ["/api/pageagent/enable", { method: "POST", body: { enabled: true } }]
    ];
    for (const [path, { method, body }] of busy) {
      const res = await fetch(`${base}${path}`, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const text = await res.text();
      assert.equal(res.status, 409, `${path}: ${text}`);
      assert.equal(JSON.parse(text).code, "INFERENCE_BUSY", path);
    }
    assert.equal(modelCalls(backend), 1, "no refused ingress reached the model");

    // a browser on another origin is refused before admission
    const crossSite = await fetch(`${base}/api/agent/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "http://evil.example" },
      body: JSON.stringify({ sessionKey: "tab-b", message: "x" })
    });
    assert.equal(crossSite.status, 403);

    // runtime callback (curl-like: no browser metadata; undici's fetch adds
    // Sec-Fetch-Mode) joins the run instead of 409; from a browser it competes
    const callback = await curlPost(`${base}/api/sage/exec`, {});
    assert.notEqual(callback.status, 409, callback.text);
    const browserCallback = await fetch(`${base}/api/sage/exec`, {
      method: "POST", headers: { "Content-Type": "application/json", Origin: base }, body: "{}"
    });
    assert.equal(browserCallback.status, 409);

    // /v1/cancel: a different owner (no cookie) is refused and the run goes on
    const foreign = await fetch(`${base}/v1/cancel`, { method: "POST" });
    assert.equal(foreign.status, 409);
    assert.equal((await foreign.json()).code, "LEASE_NOT_OWNED");
    assert.equal(backend.pathCounts["POST /v1/cancel"] ?? 0, 0, "foreign cancel never reached the backend");
    const stillBusy = await chat(base, "tab-b", "Ancora B.");
    assert.equal(stillBusy.status, 409);

    // the lease owner cancels: forwarded to the backend, run torn down
    const owned = await fetch(`${base}/v1/cancel`, { method: "POST", headers: { cookie: tabA.cookie } });
    assert.notEqual(owned.status, 409);
    assert.equal(backend.pathCounts["POST /v1/cancel"], 1);
    const restA = await tabA.rest();
    assert.doesNotMatch(restA, /event: agent_done\ndata: \{"finish_reason":"stop"/);

    await until(async () => (await chat(base, "tab-b", "B dopo.")).status === 200);
    assert.equal(modelCalls(backend), 2);
  });
});

test("Agno model gateway: cross-origin is 403 before admission with nothing forwarded; same-origin keeps the shared lease", { timeout: 120000 }, async () => {
  // The harness config disables Agno; this one enables only the gateway (no
  // service or Agent UI process is started).  DS4_UI_PORT still sets the port.
  const dir = mkdtempSync(join(tmpdir(), "wp2-agno-"));
  const config = (backend) => {
    const cfgPath = join(dir, "ds4-ui.config.json");
    writeFileSync(cfgPath, JSON.stringify({
      server: { host: "127.0.0.1", port: backend.port, binary: "/usr/bin/true", model: "fake.gguf" },
      wrapper: { enabled: false },
      agno: { enabled: true, autoStart: false, agentUi: { enabled: false, autoStart: false } },
      crawl: { host: "127.0.0.1", port: backend.port + 1 },
      toolBlobs: { compressEnabled: false, dir: join(dir, "tool-blobs") },
      callDebug: { dir: join(dir, "call-debug") },
      agent: { engine: "js" }
    }));
    return { DS4_UI_CONFIG: cfgPath };
  };
  try {
    await withServer({
      turns: [
        { content: "Agno same-origin.", stallAfterFirstChunk: true, finish: "stop" },
        { content: "Servizio Agno.", finish: "stop" }
      ]
    }, async (base, backend) => {
      // The server child resolves the gateway token from the same (inherited)
      // HOME; the value is used in memory only.
      const { modelGatewayToken } = await ensureAgnoTokens({ homeDir: homedir() });
      const url = `${base}/api/agno-model/v1/chat/completions`;
      const gateway = (headers, body = { messages: [{ role: "user", content: "ciao" }], stream: true }) => fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${modelGatewayToken}`, ...headers },
        body: JSON.stringify(body)
      });

      // cross-origin, even with a valid gateway token: 403 before admission
      for (const headers of [
        { Origin: "http://evil.example" },
        { Origin: "null" },
        { "Sec-Fetch-Site": "cross-site" }
      ]) {
        const res = await gateway(headers);
        assert.equal(res.status, 403, JSON.stringify(headers));
        assert.equal((await res.json()).code, "ORIGIN_REJECTED");
      }
      assert.equal(modelCalls(backend), 0, "no cross-origin call was forwarded");

      // same-origin: forwarded under the shared lease, held while streaming
      const same = await gateway({ Origin: base });
      assert.equal(same.status, 200);
      const reader = same.body.getReader();
      await reader.read();
      assert.equal(modelCalls(backend), 1);
      const busy = await fetch(`${base}/v1/chat/completions`, json({ messages: [{ role: "user", content: "x" }], stream: false }));
      assert.equal(busy.status, 409);
      assert.equal((await busy.json()).code, "INFERENCE_BUSY");
      // while busy a cross-origin call is still 403 (not 409): refused before admission
      const crossWhileBusy = await gateway({ Origin: "http://evil.example" });
      assert.equal(crossWhileBusy.status, 403);
      assert.equal(modelCalls(backend), 1);

      backend.releaseAll();
      for (;;) { if ((await reader.read()).done) break; }

      // the Agno service (no browser metadata) is admitted once the lease is free
      await until(async () => {
        const res = await new Promise((resolve, reject) => {
          const req = httpRequest(url, {
            method: "POST",
            agent: false,
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${modelGatewayToken}` }
          }, (r) => { let text = ""; r.on("data", (c) => { text += c; }); r.on("end", () => resolve({ status: r.statusCode, text })); });
          req.once("error", reject);
          req.end(JSON.stringify({ messages: [{ role: "user", content: "servizio" }], stream: false }));
        });
        if (res.status === 409) return false;
        assert.equal(res.status, 200, res.text);
        return true;
      });
      assert.equal(modelCalls(backend), 2);
    }, { env: config });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("legacy idempotency key replays without a second model call; changed payload is 409; reserved keys are refused", { timeout: 120000 }, async () => {
  await withServer({ turns: [{ content: "Unica risposta.", finish: "stop" }, { content: "Non deve servire.", finish: "stop" }] }, async (base, backend) => {
    await startSession(base, "idem");
    const first = await chat(base, "idem", "Una volta.", { "X-DS4-Run-Id": "legacy-run-1" });
    assert.equal(first.status, 200);
    const cookie = first.cookie;
    const retry = await chat(base, "idem", "Una volta.", { "X-DS4-Run-Id": "legacy-run-1", cookie });
    assert.equal(retry.status, 200);
    assert.equal(normalizeVolatile(retry.text), normalizeVolatile(first.text));
    assert.equal(modelCalls(backend), 1);
    const conflict = await chat(base, "idem", "Altro testo.", { "X-DS4-Run-Id": "legacy-run-1", cookie });
    assert.equal(conflict.status, 409);
    assert.equal(JSON.parse(conflict.text).code, "RUN_ID_CONFLICT");
    // another owner with the same run id is a different run (scoped by owner)
    const otherOwner = await chat(base, "idem", "Altro testo.", { "X-DS4-Run-Id": "legacy-run-1" });
    assert.equal(otherOwner.status, 200);
    assert.equal(modelCalls(backend), 2);
    const reserved = await chat(base, "ds4t_server-owned", "x");
    assert.equal(reserved.status, 403);
    assert.equal(JSON.parse(reserved.text).code, "SESSION_KEY_RESERVED");
    const badRunId = await chat(base, "idem", "x", { "X-DS4-Run-Id": "a b" });
    assert.equal(badRunId.status, 400);
  });
});

test("cancel during compaction: lease held until the non-cooperative summary call ends; no cross-session effect", { timeout: 120000 }, async () => {
  await withServer({
    turns: [
      { toolCalls: [{ id: "c1", name: "read", arguments: { path: "tests/fixtures/conformance/big-read.txt", start_line: 1 } }], finish: "tool_calls" },
      { content: "Letto.", finish: "stop" },
      { content: "Secondo turno.", finish: "stop" },
      // the summary call is not streamed: the fake backend holds it 3 s
      { content: "Summary: SUMMARY-ANNULLATO.", delayMs: 3000, finish: "stop" },
      { content: "Turno di B.", finish: "stop" },
      { content: "Dopo l'annullamento.", finish: "stop" }
    ]
  }, async (base, backend) => {
    await startSession(base, "cmp-a");
    await startSession(base, "cmp-b");
    assert.equal((await chat(base, "cmp-a", "Leggi il file grande.")).status, 200);
    assert.equal((await chat(base, "cmp-a", "Continua.")).status, 200);
    const callsBefore = modelCalls(backend);
    // /compact answers as a command once done: the client leaves and the
    // owner sends Stop (/v1/cancel) while the summary call is in flight
    const client = new AbortController();
    const firstResponse = await fetch(`${base}/api/agent/chat`, json({ sessionKey: "cmp-a", message: "/help" }));
    const cookie = (firstResponse.headers.get("set-cookie") || "").split(";")[0];
    await firstResponse.text();
    const compact = fetch(`${base}/api/agent/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({ sessionKey: "cmp-a", message: "/compact" }),
      signal: client.signal
    }).then((res) => res.text()).catch((error) => error.name);
    await until(async () => modelCalls(backend) === callsBefore + 1);
    const startedAt = Date.now();
    assert.equal((await chat(base, "cmp-b", "B durante la compattazione.")).status, 409);
    const stop = await fetch(`${base}/v1/cancel`, { method: "POST", headers: { cookie } });
    assert.notEqual(stop.status, 409, "the lease owner may cancel");
    client.abort();
    assert.equal(await compact, "AbortError");
    // the legacy compaction does not observe cancellation (baseline: its
    // summary call carries the request signal, never the run signal): the
    // lease is held until it has really finished, never released on abort
    assert.equal((await chat(base, "cmp-b", "B dopo l'abort, prima del teardown.")).status, 409);
    await until(async () => (await chat(base, "cmp-b", "B dopo.")).status === 200, 10000);
    assert.ok(Date.now() - startedAt >= 2500, "released only after the 3 s summary call ended");
    assert.equal((await chat(base, "cmp-a", "Ancora.")).status, 200);
    const calls = backend.log.filter((e) => e.path === "POST /v1/chat/completions");
    const aAfter = JSON.stringify(calls[calls.length - 1].body.messages);
    // a completed operation keeps its effect (plan §7: no undo claimed)
    assert.match(aAfter, /SUMMARY-ANNULLATO/);
    assert.match(aAfter, /Continua\./);
    assert.doesNotMatch(aAfter, /B durante|B dopo|Turno di B/);
  });
});

// A: skill evidence-first-analysis, a tool round, /compact; B: skill
// metacognition and a turn; back to A.  The control server runs the same A
// sequence without B.
const A_TURNS = [
  { toolCalls: [{ id: "a1", name: "read", arguments: { path: "tests/fixtures/conformance/big-read.txt", start_line: 1 } }], finish: "tool_calls" },
  { content: "Letto alfa.", finish: "stop" },
  { content: "Secondo alfa.", finish: "stop" },
  { content: "Summary: ALFA-SUMMARY del file letto.", finish: "stop" }
];
const A_FINAL = { content: "Dopo la compattazione alfa.", finish: "stop" };
const B_TURN = { content: "Risposta BETA-ONLY.", finish: "stop" };

async function abaSequence(base, withB) {
  await startSession(base, "sess-a");
  if (withB) await startSession(base, "sess-b");
  const out = [];
  out.push(await chat(base, "sess-a", "/skill evidence-first-analysis start"));
  out.push(await chat(base, "sess-a", "Alfa: leggi il file grande."));
  out.push(await chat(base, "sess-a", "Alfa continua."));
  out.push(await chat(base, "sess-a", "/compact"));
  if (withB) {
    out.push(await chat(base, "sess-b", "/skill metacognition start"));
    out.push(await chat(base, "sess-b", "Beta: domanda BETA-ONLY."));
  }
  out.push(await chat(base, "sess-a", "Alfa ancora."));
  for (const step of out) assert.equal(step.status, 200, step.text);
  return out;
}

test("A/B/A: prompts, skills and compaction of A are not contaminated by B", { timeout: 180000 }, async () => {
  const withB = await withServer({ turns: [...A_TURNS, B_TURN, A_FINAL] }, async (base, backend) => {
    const steps = await abaSequence(base, true);
    return { steps, log: JSON.parse(normalizeVolatile(JSON.stringify(backend.log))) };
  });
  const control = await withServer({ turns: [...A_TURNS, A_FINAL] }, async (base, backend) => {
    const steps = await abaSequence(base, false);
    return { steps, log: JSON.parse(normalizeVolatile(JSON.stringify(backend.log))) };
  });
  const calls = (log) => log.filter((e) => e.path === "POST /v1/chat/completions");
  const withCalls = calls(withB.log);
  const controlCalls = calls(control.log);
  assert.equal(withCalls.length, controlCalls.length + 1);
  const bRequest = withCalls[A_TURNS.length];
  const aFinalWithB = withCalls[withCalls.length - 1];
  const aFinalControl = controlCalls[controlCalls.length - 1];

  // A after B == A without B: same system prompt (skill), same compacted
  // history, same new message
  assert.deepEqual(aFinalWithB.body, aFinalControl.body);
  const aText = JSON.stringify(aFinalWithB.body.messages);
  assert.match(aText, /ALFA-SUMMARY/);
  assert.doesNotMatch(aText, /BETA-ONLY|metacognition/i);
  // B saw none of A
  const bText = JSON.stringify(bRequest.body.messages);
  assert.match(bText, /BETA-ONLY/);
  assert.doesNotMatch(bText, /Alfa|ALFA-SUMMARY|Letto alfa/);
  assert.notDeepEqual(bRequest.body.messages[0], aFinalWithB.body.messages[0], "different skills, different system prompt");
  // A's public answers are identical with and without B
  const aOnly = (steps) => steps.filter((_, i) => !(steps.length === 7 && (i === 4 || i === 5))).map((s) => normalizeVolatile(s.text));
  assert.deepEqual(aOnly(withB.steps), aOnly(control.steps));
});
