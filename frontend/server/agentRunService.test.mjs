// WP1 (piano.esecutivo.integrazione.opendots.v2.md §5) — AgentRunService and
// its legacy SSE transport, without a server: the service has no HTTP, the
// transport owns every res/req call.

import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { createAgentAdmission } from "./agentAdmission.mjs";
import { AGENT_RUN_OUTCOME, agentTurnInput, createAgentRunService } from "./agent/runService.mjs";
import { createLegacyAgentChatHandler } from "./agent/legacyChatSse.mjs";

function fakeReq({ body = {}, headers = {} } = {}) {
  const req = new EventEmitter();
  req.body = body;
  req.get = (name) => headers[name] ?? headers[name.toLowerCase()];
  return req;
}

function fakeRes() {
  const res = new EventEmitter();
  res.chunks = [];
  res.headers = {};
  res.statusCode = 200;
  res.writableEnded = false;
  res.writeHead = (status, headers) => { res.statusCode = status; Object.assign(res.headers, headers); res.head = true; };
  res.status = (status) => { res.statusCode = status; return res; };
  res.setHeader = (k, v) => { res.headers[k] = v; };
  res.json = (value) => { res.jsonBody = value; res.writableEnded = true; return res; };
  res.write = (chunk) => { res.chunks.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8")); return true; };
  res.end = () => { res.writableEnded = true; res.emit("close"); };
  return res;
}

function handlerFor(service, extra = {}) {
  const wiring = [];
  const handler = createLegacyAgentChatHandler({
    service,
    sessionKeyOf: (req) => req.get("X-Agent-Session-Key") || req.body.sessionKey || "",
    writeCommandSse: (res, events) => {
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      for (const e of events) res.write(`event: ${e.event}\ndata: ${JSON.stringify(e.data)}\n\n`);
      res.end();
    },
    abortOnClientDisconnect: () => {
      const controller = new AbortController();
      const entry = { controller, cleaned: false };
      wiring.push(entry);
      return { signal: controller.signal, cleanup: () => { entry.cleaned = true; } };
    },
    keepaliveMs: 60000,
    ...extra
  });
  return { handler, wiring };
}

test("the service dispatches by engine and passes only the declared input", async () => {
  const seen = [];
  let engine = "js";
  const service = createAgentRunService({
    resolveEngine: () => engine,
    runJsTurn: async (input) => { seen.push(["js", input]); return { kind: AGENT_RUN_OUTCOME.STREAMED }; },
    runNativeTurn: async (input) => { seen.push(["native", input]); return { kind: AGENT_RUN_OUTCOME.NATIVE_STREAMED }; }
  });
  const signal = new AbortController().signal;
  await service.runAgentTurn({ body: { message: "a" }, sessionKey: 7, debug: "1", extra: true }, () => {}, signal);
  engine = "native";
  await service.runAgentTurn({ body: { message: "b" }, sessionKey: "k" }, () => {}, signal);
  assert.deepEqual(seen.map(([e]) => e), ["js", "native"]);
  assert.deepEqual(Object.keys(seen[0][1]).sort(), ["body", "debug", "requestSignal", "sessionKey"]);
  assert.equal(seen[0][1].sessionKey, "7");
  assert.equal(seen[0][1].debug, false, "debug is an explicit boolean opt-in");
  assert.ok(Object.isFrozen(seen[0][1]));
  assert.deepEqual(agentTurnInput({ debug: true }).debug, true);
});

test("an identified run awaits its checkpoint callback after DS4 returns", async () => {
  const order = [];
  const service = createAgentRunService({
    admission: createAgentAdmission(),
    resolveEngine: () => "js",
    runJsTurn: async (_input, emit) => { emit("agent_done", {}); order.push("turn"); return { kind: AGENT_RUN_OUTCOME.STREAMED }; },
    runNativeTurn: async () => { throw new Error("unreachable"); }
  });
  const result = await service.runAgentTurn({
    body: { message: "hello" }, sessionKey: "ds4t-test",
    admissionIdentity: { ownerId: "owner-1", threadId: "thread-1", runId: "run-1", requestHash: "hash-1" },
    checkpointSession: async (binding) => { order.push("checkpoint"); assert.equal(binding.sessionKey, "ds4t-test"); assert.equal(binding.threadId, "thread-1"); }
  }, () => new Promise((resolve) => setTimeout(() => { order.push("delivered"); resolve(); }, 1)), new AbortController().signal);
  assert.equal(result.kind, AGENT_RUN_OUTCOME.STREAMED);
  assert.deepEqual(order, ["turn", "delivered", "checkpoint"]);
});

test("the service rejects a missing emit or signal and missing dependencies", async () => {
  assert.throws(() => createAgentRunService({ resolveEngine: () => "js", runJsTurn: async () => {} }), /runNativeTurn/);
  const service = createAgentRunService({
    resolveEngine: () => "js",
    runJsTurn: async () => ({ kind: AGENT_RUN_OUTCOME.STREAMED }),
    runNativeTurn: async () => ({ kind: AGENT_RUN_OUTCOME.NATIVE_STREAMED })
  });
  await assert.rejects(service.runAgentTurn({}, null, new AbortController().signal), /emit/);
  await assert.rejects(service.runAgentTurn({}, () => {}, null), /signal/);
});

test("the service module knows no HTTP: no res/req, no Express, no AG-UI", async () => {
  const source = await readFile(new URL("./agent/runService.mjs", import.meta.url), "utf8");
  const code = source.replace(/\/\/.*$/gm, "");
  assert.doesNotMatch(code, /\bres\.|\breq\.|express|writeHead|@ag-ui|fetch\(/);
});

test("the legacy route is a transport over the one service, not a second loop", async () => {
  const source = await readFile(new URL("./index.mjs", import.meta.url), "utf8");
  const routes = source.match(/app\.post\("\/api\/agent\/chat"[^\n]*/g) || [];
  assert.equal(routes.length, 1);
  assert.match(routes[0], /createLegacyAgentChatHandler\(\{/);
  assert.equal((source.match(/createAgentRunService\(/g) || []).length, 1);
  // The loop body reads no request and writes no response.
  const start = source.indexOf("async function runNativeAgentTurn(");
  const end = source.indexOf("const agentRunService = createAgentRunService(");
  assert.ok(start > 0 && end > start);
  const turns = source.slice(start, end).replace(/\/\/.*$/gm, "");
  assert.doesNotMatch(turns, /\bres\.(write|end|json|status|writeHead|setHeader|on)\b/);
  assert.doesNotMatch(turns, /\breq\.(on|off|get|body|signal)\b/);
});

test("legacy transport: rejection before the stream is HTTP JSON, no SSE head", async () => {
  const service = createAgentRunService({
    resolveEngine: () => "js",
    runJsTurn: async () => ({ kind: AGENT_RUN_OUTCOME.REJECTED, status: 400, body: { error: "nope" } }),
    runNativeTurn: async () => { throw new Error("unreachable"); }
  });
  const { handler } = handlerFor(service);
  const res = fakeRes();
  await handler(fakeReq(), res);
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.jsonBody, { error: "nope" });
  assert.equal(res.head, undefined);
});

test("legacy transport: a command outcome is one complete SSE answer", async () => {
  const service = createAgentRunService({
    resolveEngine: () => "js",
    runJsTurn: async () => ({
      kind: AGENT_RUN_OUTCOME.COMMAND,
      events: [{ event: "agent_text", data: { content: "ok" } }, { event: "agent_done", data: { finish_reason: "command" } }]
    }),
    runNativeTurn: async () => { throw new Error("unreachable"); }
  });
  const { handler } = handlerFor(service);
  const res = fakeRes();
  await handler(fakeReq(), res);
  assert.equal(res.chunks.join(""), 'event: agent_text\ndata: {"content":"ok"}\n\nevent: agent_done\ndata: {"finish_reason":"command"}\n\n');
  assert.equal(res.writableEnded, true);
});

test("legacy transport: client abort reaches the turn only after run_started", async () => {
  const observed = [];
  const service = createAgentRunService({
    resolveEngine: () => "js",
    runJsTurn: async (_input, emit, signal) => {
      // before the stream opens the client is not observed (legacy timing)
      observed.push(["before", signal.aborted]);
      await new Promise((r) => setImmediate(r));
      observed.push(["still-before", signal.aborted]);
      emit("run_started", { engine: "js" });
      emit("agent_text", { content: "x" });
      await new Promise((r) => setImmediate(r));
      observed.push(["after", signal.aborted]);
      emit("agent_done", { finish_reason: "stop" });
      return { kind: AGENT_RUN_OUTCOME.STREAMED };
    },
    runNativeTurn: async () => { throw new Error("unreachable"); }
  });
  const { handler } = handlerFor(service);
  const req = fakeReq();
  const res = fakeRes();
  const origWriteHead = res.writeHead;
  res.writeHead = (...args) => { origWriteHead(...args); setImmediate(() => req.emit("aborted")); };
  queueMicrotask(() => req.emit("aborted")); // too early: nobody listens yet
  await handler(req, res);
  assert.deepEqual(observed, [["before", false], ["still-before", false], ["after", true]]);
  assert.equal(res.headers["Content-Type"], "text/event-stream");
  assert.equal(res.headers["X-Accel-Buffering"], "no");
  assert.equal(
    res.chunks.join(""),
    'event: agent_text\ndata: {"content":"x"}\n\nevent: agent_done\ndata: {"finish_reason":"stop"}\n\n'
  );
  assert.equal(res.writableEnded, true);
  assert.equal(req.listenerCount("aborted"), 0, "the abort listener is removed after the turn");
});

test("legacy transport: native passthrough keeps status, headers and raw bytes", async () => {
  const bytes = new TextEncoder().encode("event: agent_text\ndata: {\"content\":\"àè\"}\n\n");
  const service = createAgentRunService({
    resolveEngine: () => "native",
    runJsTurn: async () => { throw new Error("unreachable"); },
    runNativeTurn: async (_input, emit, signal) => {
      emit("native_forward");
      assert.equal(signal.aborted, false);
      const headers = new Headers({ "content-type": "text/event-stream", "x-up": "1" });
      emit("native_response", { status: 201, headers });
      emit("native_chunk", bytes.subarray(0, 5));
      emit("native_chunk", bytes.subarray(5));
      return { kind: AGENT_RUN_OUTCOME.NATIVE_STREAMED };
    }
  });
  const { handler, wiring } = handlerFor(service);
  const res = fakeRes();
  await handler(fakeReq(), res);
  assert.equal(res.statusCode, 201);
  assert.equal(res.headers["x-up"], "1");
  assert.equal(res.chunks.join(""), new TextDecoder().decode(bytes).slice(0, 5) + new TextDecoder().decode(bytes.subarray(5)));
  assert.equal(wiring.length, 1);
  assert.equal(wiring[0].cleaned, true);
  assert.equal(res.writableEnded, true);
});

test("legacy transport: the native disconnect signal aborts the turn with its reason", async () => {
  let seenReason = null;
  const service = createAgentRunService({
    resolveEngine: () => "native",
    runJsTurn: async () => { throw new Error("unreachable"); },
    runNativeTurn: async (_input, emit, signal) => {
      emit("native_forward");
      wiringRef[0].controller.abort(new Error("upstream request timed out"));
      seenReason = signal.reason;
      return { kind: AGENT_RUN_OUTCOME.REJECTED, status: 502, body: { error: "x" } };
    }
  });
  const { handler, wiring } = handlerFor(service);
  const wiringRef = wiring;
  const res = fakeRes();
  await handler(fakeReq(), res);
  assert.match(String(seenReason?.message), /upstream request timed out/);
  assert.equal(wiring[0].cleaned, true, "cleanup runs on every outcome");
});

test("legacy transport: events after the response ended are dropped", async () => {
  const service = createAgentRunService({
    resolveEngine: () => "js",
    runJsTurn: async (_input, emit) => {
      emit("run_started", {});
      emit("agent_text", { content: "a" });
      resRef.end();
      emit("agent_text", { content: "late" });
      return { kind: AGENT_RUN_OUTCOME.STREAMED };
    },
    runNativeTurn: async () => { throw new Error("unreachable"); }
  });
  const { handler } = handlerFor(service);
  const resRef = fakeRes();
  await handler(fakeReq(), resRef);
  assert.equal(resRef.chunks.join(""), 'event: agent_text\ndata: {"content":"a"}\n\n');
});
