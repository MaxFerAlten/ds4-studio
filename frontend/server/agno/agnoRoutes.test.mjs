import assert from "node:assert";
import { describe, it } from "node:test";
import { createAgnoRouter } from "./agnoRoutes.mjs";
import { AgnoExecutionGuardError } from "./agnoExecutionGuard.mjs";
import { AGENT_TOOL_NAMES } from "../agentToolCatalog.mjs";

function mockRes() {
  let _statusCode = 200, _headersSent = false, _jsonData = null;
  return {
    status: function(code) { _statusCode = code; return this; },
    json: function(data) { _headersSent = true; _jsonData = data; },
    setHeader: function() {},
    end: function() { _headersSent = true; },
    flushHeaders: function() {},
    write: function() {},
    get headersSent() { return _headersSent; },
    get statusCode() { return _statusCode; },
    set statusCode(v) { _statusCode = v; },
    get _json() { return _jsonData; },
  };
}

function mockReqWithBody(method, url, payload) {
  return {
    method,
    url,
    headers: {},
    async *[Symbol.asyncIterator]() {
      yield Buffer.from(JSON.stringify(payload));
    },
  };
}

/** Fake AgnoExecutionGuard: control allow/deny and readWrapperStatus for /status reporting. */
function fakeGuard({ nativeAgentActive = false, ensureError = null } = {}) {
  let ensureCalls = 0;
  return {
    get ensureCalls() { return ensureCalls; },
    ensureModelCallAllowed: async () => {
      ensureCalls++;
      if (ensureError) throw ensureError;
      return { nativeAgentActive: false, mode: "server" };
    },
    readWrapperStatus: async () => ({ nativeAgentActive, mode: nativeAgentActive ? "agent" : "server" }),
  };
}

/** Fake Agent UI process manager: tracks call order via a shared `calls` array. */
function fakeAgentUiProcessManager({ calls = [], statusResult, startResult, startError } = {}) {
  const defaultStatus = {
    running: false, healthy: false, pid: null,
    host: "127.0.0.1", port: 3000, url: "http://127.0.0.1:3000",
    upstreamCommit: "6dad9593fca6756e1813e4f4b3b2620be6377691", lastExit: null,
  };
  return {
    status: () => statusResult ?? defaultStatus,
    async start() {
      calls.push("agentui.start");
      if (startError) throw startError;
      return startResult ?? { ...defaultStatus, running: true, healthy: true, pid: 999 };
    },
    async stop() {
      calls.push("agentui.stop");
      return { ...defaultStatus, running: false, healthy: false };
    },
  };
}

describe("createAgnoRouter", () => {
  const config = {
    agno: {
      enabled: true, uiEnabled: true, host: "127.0.0.1", port: 7777, model: "deepseek-v4-flash",
      agentUi: { enabled: true, host: "127.0.0.1", port: 3000 },
      tools: { enabled: true, profile: "safe" },
    },
    server: { host: "127.0.0.1", port: 8000 },
    control: { host: "127.0.0.1", port: 5173 },
  };
  const processManager = {
    status: () => ({ running: true, healthy: true, pid: 12345, lastError: null }),
    start: async () => ({ running: true, healthy: true }),
    stop: async () => ({ running: false, healthy: false }),
    restart: async () => ({ running: true, healthy: true }),
    healthCheck: async () => true,
  };
  const modelGate = { status: () => ({ inflight: 0, queued: 0 }) };
  const agentUiProcessManager = fakeAgentUiProcessManager();
  // Fakes for the tool-bridge status parity fields spliced into /status
  // (§17.5) — real AgnoToolPolicy/AgnoToolGate instances are wired in
  // index.mjs; these tests only need the shape used by the handler.
  const toolPolicy = { allowedToolNames: () => ["read", "search"] };
  const toolGate = { status: () => ({ inflight: 0, queued: 0, maxInflight: 1, maxQueued: 8 }) };

  it("GET /status returns enabled state", async () => {
    const router = createAgnoRouter({
      config, processManager, modelGate, agentUiProcessManager, modelGatewayToken: "token", toolPolicy, toolGate,
      agnoClient: {}, executionGuard: fakeGuard(), asyncHandler: (fn) => fn,
    });
    const r = mockRes();
    await router.handle({ method: "GET", url: "http://internal/api/agno/status" }, r);
    assert(r._json.enabled === true);
  });

  it("GET /status returns disabled state when agno not enabled", async () => {
    const router = createAgnoRouter({
      config: { ...config, agno: { ...config.agno, enabled: false } },
      processManager, modelGate, agentUiProcessManager, modelGatewayToken: "token", toolPolicy, toolGate,
      agnoClient: {}, executionGuard: fakeGuard(), asyncHandler: (fn) => fn,
    });
    const r = mockRes();
    await router.handle({ method: "GET", url: "http://internal/api/agno/status" }, r);
    assert(r._json.enabled === false);
  });

  it("GET /status reports native agent active", async () => {
    const router = createAgnoRouter({
      config, processManager, modelGate, agentUiProcessManager, modelGatewayToken: "token", toolPolicy, toolGate,
      agnoClient: {}, executionGuard: fakeGuard({ nativeAgentActive: true }), asyncHandler: (fn) => fn,
    });
    const r = mockRes();
    await router.handle({ method: "GET", url: "http://internal/api/agno/status" }, r);
    assert(r._json.model.nativeAgentActive === true);
  });

  it("GET /status fails open (nativeAgentActive: false) when guard status read throws", async () => {
    const guard = fakeGuard();
    guard.readWrapperStatus = async () => { throw new Error("unreachable"); };
    const router = createAgnoRouter({
      config, processManager, modelGate, agentUiProcessManager, modelGatewayToken: "token", toolPolicy, toolGate,
      agnoClient: {}, executionGuard: guard, asyncHandler: (fn) => fn,
    });
    const r = mockRes();
    await router.handle({ method: "GET", url: "http://internal/api/agno/status" }, r);
    assert(r._json.model.nativeAgentActive === false);
  });

  it("POST /start starts the process manager", async () => {
    let started = false;
    const pm = {
      ...processManager,
      start: async () => { started = true; return { running: true, healthy: true }; },
    };
    const router = createAgnoRouter({
      config, processManager: pm, modelGate, agentUiProcessManager, modelGatewayToken: "token", toolPolicy, toolGate,
      agnoClient: {}, executionGuard: fakeGuard(), asyncHandler: (fn) => fn,
    });
    const r = mockRes();
    await router.handle({ method: "POST", url: "http://internal/api/agno/start" }, r);
    assert(started === true);
  });

  it("POST /stop stops the process manager", async () => {
    let stopped = false;
    const pm = {
      ...processManager,
      stop: async () => { stopped = true; return { running: false, healthy: false }; },
    };
    const router = createAgnoRouter({
      config, processManager: pm, modelGate, agentUiProcessManager, modelGatewayToken: "token", toolPolicy, toolGate,
      agnoClient: {}, executionGuard: fakeGuard(), asyncHandler: (fn) => fn,
    });
    const r = mockRes();
    await router.handle({ method: "POST", url: "http://internal/api/agno/stop" }, r);
    assert(stopped === true);
  });

  it("GET /catalog returns agent list", async () => {
    const agnoClient = {
      catalog: async () => ({
        agents: [
          {
            id: "ds4-assistant",
            kind: "agent",
            name: "DS4 Assistant",
            enabled: true,
          },
        ],
        teams: [],
        workflows: [],
        capabilities: {
          tools: true,
          toolProfile: "safe",
          toolCount: 2,
          media: false,
          ocr: false,
        },
      }),
    };
    const router = createAgnoRouter({
      config, processManager, modelGate, agentUiProcessManager, modelGatewayToken: "token", toolPolicy, toolGate,
      agnoClient, executionGuard: fakeGuard(), asyncHandler: (fn) => fn,
    });
    const r = mockRes();
    await router.handle({ method: "GET", url: "http://internal/api/agno/catalog" }, r);
    assert(r._json.agents.length > 0);
  });

  it("POST /runs creates a run using the injected agno client", async () => {
    let createRunPayload = null;
    const agnoClient = {
      createRun: async (payload) => { createRunPayload = payload; return { runId: "abc" }; },
    };
    const router = createAgnoRouter({
      config, processManager, modelGate, agentUiProcessManager, modelGatewayToken: "token", toolPolicy, toolGate,
      agnoClient, executionGuard: fakeGuard(), asyncHandler: (fn) => fn,
    });
    const r = mockRes();
    const req = mockReqWithBody("POST", "http://internal/api/agno/runs", { message: "hi" });
    await router.handle(req, r);
    assert(r._json.runId === "abc");
    assert(createRunPayload.message === "hi");
  });

  it("POST /runs returns 409 if execution guard rejects with NATIVE_AGENT_ACTIVE", async () => {
    const agnoClient = { createRun: async () => ({ runId: "should-not-be-called" }) };
    const guard = fakeGuard({ ensureError: new AgnoExecutionGuardError("NATIVE_AGENT_ACTIVE", "The native DS4 agent is active", 409) });
    const router = createAgnoRouter({
      config, processManager, modelGate, agentUiProcessManager, modelGatewayToken: "token", toolPolicy, toolGate,
      agnoClient, executionGuard: guard, asyncHandler: (fn) => fn,
    });
    const r = mockRes();
    const req = mockReqWithBody("POST", "http://internal/api/agno/runs", { message: "hi" });
    await router.handle(req, r);
    assert(r.statusCode === 409);
    assert(r._json.error === "NATIVE_AGENT_ACTIVE");
  });

  it("POST /runs returns 503 if execution guard cannot confirm server mode", async () => {
    const agnoClient = { createRun: async () => ({ runId: "should-not-be-called" }) };
    const guard = fakeGuard({ ensureError: new AgnoExecutionGuardError("SERVER_MODE_NOT_CONFIRMED", "Wrapper did not confirm server mode", 503) });
    const router = createAgnoRouter({
      config, processManager, modelGate, agentUiProcessManager, modelGatewayToken: "token", toolPolicy, toolGate,
      agnoClient, executionGuard: guard, asyncHandler: (fn) => fn,
    });
    const r = mockRes();
    const req = mockReqWithBody("POST", "http://internal/api/agno/runs", { message: "hi" });
    await router.handle(req, r);
    assert(r.statusCode === 503);
    assert(r._json.error === "SERVER_MODE_NOT_CONFIRMED");
  });

  it("POST /runs does not call agnoClient.createRun when the guard rejects", async () => {
    let createRunCalled = false;
    const agnoClient = { createRun: async () => { createRunCalled = true; return { runId: "x" }; } };
    const guard = fakeGuard({ ensureError: new AgnoExecutionGuardError("NATIVE_AGENT_ACTIVE", "The native DS4 agent is active", 409) });
    const router = createAgnoRouter({
      config, processManager, modelGate, agentUiProcessManager, modelGatewayToken: "token", toolPolicy, toolGate,
      agnoClient, executionGuard: guard, asyncHandler: (fn) => fn,
    });
    const r = mockRes();
    const req = mockReqWithBody("POST", "http://internal/api/agno/runs", { message: "hi" });
    await router.handle(req, r);
    assert.equal(createRunCalled, false);
  });

  it("GET /runs lists runs using the injected agno client", async () => {
    const agnoClient = {
      listRuns: async () => ({ runs: [{ runId: "abc" }] }),
    };
    const router = createAgnoRouter({
      config, processManager, modelGate, agentUiProcessManager, modelGatewayToken: "token", toolPolicy, toolGate,
      agnoClient, executionGuard: fakeGuard(), asyncHandler: (fn) => fn,
    });
    const r = mockRes();
    await router.handle({ method: "GET", url: "http://internal/api/agno/runs" }, r);
    assert(r._json.runs.length === 1);
  });

  it("handle() returns 502 instead of throwing when a route handler rejects", async () => {
    const agnoClient = {
      listRuns: async () => { throw new Error("connect ECONNREFUSED 127.0.0.1:7777"); },
    };
    const router = createAgnoRouter({
      config, processManager, modelGate, agentUiProcessManager, modelGatewayToken: "token", toolPolicy, toolGate,
      agnoClient, executionGuard: fakeGuard(), asyncHandler: (fn) => fn,
    });
    const r = mockRes();
    await router.handle({ method: "GET", url: "http://internal/api/agno/runs" }, r);
    assert.strictEqual(r.statusCode, 502);
    assert.match(r._json.error, /ECONNREFUSED/);
  });

  it("GET /runs/:id resolves the run id param", async () => {
    let requestedId = null;
    const agnoClient = {
      getRun: async (id) => { requestedId = id; return { runId: id, status: "completed" }; },
    };
    const router = createAgnoRouter({
      config, processManager, modelGate, agentUiProcessManager, modelGatewayToken: "token", toolPolicy, toolGate,
      agnoClient, executionGuard: fakeGuard(), asyncHandler: (fn) => fn,
    });
    const r = mockRes();
    await router.handle({ method: "GET", url: "http://internal/api/agno/runs/abc123" }, r);
    assert(requestedId === "abc123");
    assert(r._json.runId === "abc123");
  });

  it("POST /runs/:id/cancel resolves the run id param", async () => {
    let cancelledId = null;
    const agnoClient = {
      cancelRun: async (id) => { cancelledId = id; return { runId: id, status: "cancelled" }; },
    };
    const router = createAgnoRouter({
      config, processManager, modelGate, agentUiProcessManager, modelGatewayToken: "token", toolPolicy, toolGate,
      agnoClient, executionGuard: fakeGuard(), asyncHandler: (fn) => fn,
    });
    const r = mockRes();
    await router.handle({ method: "POST", url: "http://internal/api/agno/runs/abc123/cancel" }, r);
    assert(cancelledId === "abc123");
    assert(r._json.status === "cancelled");
  });

  it("GET /status include agentUi", async () => {
    const router = createAgnoRouter({
      config, processManager, modelGate, agentUiProcessManager, modelGatewayToken: "token", toolPolicy, toolGate,
      agnoClient: {}, executionGuard: fakeGuard(), asyncHandler: (fn) => fn,
    });
    const r = mockRes();
    await router.handle({ method: "GET", url: "http://internal/api/agno/status" }, r);
    assert.deepStrictEqual(r._json.agentUi, {
      enabled: true,
      running: false,
      healthy: false,
      pid: null,
      host: "127.0.0.1",
      port: 3000,
      url: "http://127.0.0.1:3000",
      upstreamCommit: "6dad9593fca6756e1813e4f4b3b2620be6377691",
      lastExit: null,
    });
  });

  it("GET /status includes tools parity (§17.5), no full schemas", async () => {
    const router = createAgnoRouter({
      config, processManager, modelGate, agentUiProcessManager, modelGatewayToken: "token", toolPolicy, toolGate,
      agnoClient: {}, executionGuard: fakeGuard(), asyncHandler: (fn) => fn,
    });
    const r = mockRes();
    await router.handle({ method: "GET", url: "http://internal/api/agno/status" }, r);
    assert.deepStrictEqual(r._json.tools, {
      enabled: true,
      profile: "safe",
      catalogCount: 2,
      expectedFullCount: AGENT_TOOL_NAMES.length,
      expectedProfileCount: 11,
      registeredCount: null,
      registeredProfile: null,
      parity: false,
      textOnly: true,
      ocr: false,
      gate: { inflight: 0, queued: 0, maxInflight: 1, maxQueued: 8 },
    });
    const flat = JSON.stringify(r._json.tools);
    assert(!flat.includes("parameters"), `status leaked full tool schemas: ${flat}`);
  });

  it("GET /status tools.parity is true when catalog covers the full tool set", async () => {
    const fullPolicy = { allowedToolNames: () => [...AGENT_TOOL_NAMES] };
    const router = createAgnoRouter({
      config: {
        ...config,
        agno: {
          ...config.agno,
          tools: { ...config.agno.tools, profile: "full" },
        },
      },
      processManager, modelGate, agentUiProcessManager, modelGatewayToken: "token",
      toolPolicy: fullPolicy, toolGate,
      agnoClient: {}, executionGuard: fakeGuard(), asyncHandler: (fn) => fn,
    });
    const r = mockRes();
    await router.handle({ method: "GET", url: "http://internal/api/agno/status" }, r);
    assert.strictEqual(r._json.tools.parity, true);
    assert.strictEqual(
      r._json.tools.catalogCount,
      r._json.tools.expectedProfileCount,
    );
  });

  it("POST /agent-ui/ensure returns 503 if Agno is disabled", async () => {
    const router = createAgnoRouter({
      config: { ...config, agno: { ...config.agno, enabled: false } },
      processManager, modelGate, agentUiProcessManager, modelGatewayToken: "token", toolPolicy, toolGate,
      agnoClient: {}, executionGuard: fakeGuard(), asyncHandler: (fn) => fn,
    });
    const r = mockRes();
    await router.handle({ method: "POST", url: "http://internal/api/agno/agent-ui/ensure" }, r);
    assert.strictEqual(r.statusCode, 503);
    assert.strictEqual(r._json.error, "AGNO_DISABLED");
  });

  it("POST /agent-ui/ensure returns 503 if Agent UI is disabled", async () => {
    const router = createAgnoRouter({
      config: { ...config, agno: { ...config.agno, agentUi: { ...config.agno.agentUi, enabled: false } } },
      processManager, modelGate, agentUiProcessManager, modelGatewayToken: "token", toolPolicy, toolGate,
      agnoClient: {}, executionGuard: fakeGuard(), asyncHandler: (fn) => fn,
    });
    const r = mockRes();
    await router.handle({ method: "POST", url: "http://internal/api/agno/agent-ui/ensure" }, r);
    assert.strictEqual(r.statusCode, 503);
    assert.strictEqual(r._json.error, "AGNO_UI_DISABLED");
  });

  it("POST /agent-ui/ensure starts AgentOS before Agent UI, in order", async () => {
    const calls = [];
    const pm = { ...processManager, start: async () => { calls.push("agentos.start"); return { running: true, healthy: true }; } };
    const uiPm = fakeAgentUiProcessManager({ calls });
    const router = createAgnoRouter({
      config, processManager: pm, modelGate, agentUiProcessManager: uiPm, modelGatewayToken: "token", toolPolicy, toolGate,
      agnoClient: {}, executionGuard: fakeGuard(), asyncHandler: (fn) => fn,
    });
    const r = mockRes();
    await router.handle({ method: "POST", url: "http://internal/api/agno/agent-ui/ensure" }, r);
    assert.deepStrictEqual(calls, ["agentos.start", "agentui.start"]);
  });

  it("POST /agent-ui/ensure does not start Agent UI if AgentOS is not healthy", async () => {
    const calls = [];
    const pm = { ...processManager, start: async () => ({ running: false, healthy: false }) };
    const uiPm = fakeAgentUiProcessManager({ calls });
    const router = createAgnoRouter({
      config, processManager: pm, modelGate, agentUiProcessManager: uiPm, modelGatewayToken: "token", toolPolicy, toolGate,
      agnoClient: {}, executionGuard: fakeGuard(), asyncHandler: (fn) => fn,
    });
    const r = mockRes();
    await router.handle({ method: "POST", url: "http://internal/api/agno/agent-ui/ensure" }, r);
    assert.deepStrictEqual(calls, []);
    assert.strictEqual(r.statusCode, 503);
    assert.strictEqual(r._json.error, "AGENTOS_NOT_READY");
  });

  it("POST /agent-ui/ensure returns a loopback URL", async () => {
    const router = createAgnoRouter({
      config, processManager, modelGate, agentUiProcessManager, modelGatewayToken: "token", toolPolicy, toolGate,
      agnoClient: {}, executionGuard: fakeGuard(), asyncHandler: (fn) => fn,
    });
    const r = mockRes();
    await router.handle({ method: "POST", url: "http://internal/api/agno/agent-ui/ensure" }, r);
    assert.strictEqual(r._json.ok, true);
    assert.strictEqual(r._json.url, "http://127.0.0.1:3000");
  });

  it("POST /agent-ui/ensure does not return a token", async () => {
    const router = createAgnoRouter({
      config, processManager, modelGate, agentUiProcessManager, modelGatewayToken: "token", toolPolicy, toolGate,
      agnoClient: {}, executionGuard: fakeGuard(), asyncHandler: (fn) => fn,
    });
    const r = mockRes();
    await router.handle({ method: "POST", url: "http://internal/api/agno/agent-ui/ensure" }, r);
    const flat = JSON.stringify(r._json);
    assert(!flat.includes("token"), `response leaked token: ${flat}`);
  });

  it("POST /agent-ui/ensure does not return env", async () => {
    const router = createAgnoRouter({
      config, processManager, modelGate, agentUiProcessManager, modelGatewayToken: "token", toolPolicy, toolGate,
      agnoClient: {}, executionGuard: fakeGuard(), asyncHandler: (fn) => fn,
    });
    const r = mockRes();
    await router.handle({ method: "POST", url: "http://internal/api/agno/agent-ui/ensure" }, r);
    assert.strictEqual(r._json.env, undefined);
    assert.strictEqual(r._json.agentUi.env, undefined);
  });

  it("POST /agent-ui/ensure is idempotent", async () => {
    const router = createAgnoRouter({
      config, processManager, modelGate, agentUiProcessManager, modelGatewayToken: "token", toolPolicy, toolGate,
      agnoClient: {}, executionGuard: fakeGuard(), asyncHandler: (fn) => fn,
    });
    const r1 = mockRes();
    await router.handle({ method: "POST", url: "http://internal/api/agno/agent-ui/ensure" }, r1);
    const r2 = mockRes();
    await router.handle({ method: "POST", url: "http://internal/api/agno/agent-ui/ensure" }, r2);
    assert.strictEqual(r1.statusCode, r2.statusCode);
    assert.deepStrictEqual(r1._json, r2._json);
  });

  it("POST /agent-ui/stop stops only Agent UI", async () => {
    const calls = [];
    const uiPm = fakeAgentUiProcessManager({ calls });
    const router = createAgnoRouter({
      config, processManager, modelGate, agentUiProcessManager: uiPm, modelGatewayToken: "token", toolPolicy, toolGate,
      agnoClient: {}, executionGuard: fakeGuard(), asyncHandler: (fn) => fn,
    });
    const r = mockRes();
    await router.handle({ method: "POST", url: "http://internal/api/agno/agent-ui/stop" }, r);
    assert.deepStrictEqual(calls, ["agentui.stop"]);
    assert.strictEqual(r._json.ok, true);
  });

  it("POST /agent-ui/stop does not stop AgentOS", async () => {
    let agentOsStopped = false;
    const pm = { ...processManager, stop: async () => { agentOsStopped = true; return { running: false, healthy: false }; } };
    const router = createAgnoRouter({
      config, processManager: pm, modelGate, agentUiProcessManager, modelGatewayToken: "token", toolPolicy, toolGate,
      agnoClient: {}, executionGuard: fakeGuard(), asyncHandler: (fn) => fn,
    });
    const r = mockRes();
    await router.handle({ method: "POST", url: "http://internal/api/agno/agent-ui/stop" }, r);
    assert.strictEqual(agentOsStopped, false);
  });
});
