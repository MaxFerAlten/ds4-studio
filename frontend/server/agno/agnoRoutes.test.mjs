import assert from "node:assert";
import { describe, it } from "node:test";
import { createAgnoRouter } from "./agnoRoutes.mjs";

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

describe("createAgnoRouter", () => {
  const config = {
    agno: { enabled: true, uiEnabled: true, host: "127.0.0.1", port: 7777, model: "deepseek-v4-flash" },
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
  const notNativeAgentFetch = async () => ({ ok: true, json: async () => ({ state: "idle" }) });

  it("GET /status returns enabled state", async () => {
    const router = createAgnoRouter({
      config, processManager, modelGate, modelGatewayToken: "token",
      agnoClient: {}, ensureServerMode: async () => true, asyncHandler: (fn) => fn,
      fetchImpl: notNativeAgentFetch,
    });
    const r = mockRes();
    await router.handle({ method: "GET", url: "http://internal/api/agno/status" }, r);
    assert(r._json.enabled === true);
  });

  it("GET /status returns disabled state when agno not enabled", async () => {
    const router = createAgnoRouter({
      config: { ...config, agno: { ...config.agno, enabled: false } },
      processManager, modelGate, modelGatewayToken: "token",
      agnoClient: {}, ensureServerMode: async () => true, asyncHandler: (fn) => fn,
      fetchImpl: notNativeAgentFetch,
    });
    const r = mockRes();
    await router.handle({ method: "GET", url: "http://internal/api/agno/status" }, r);
    assert(r._json.enabled === false);
  });

  it("GET /status reports native agent active", async () => {
    const router = createAgnoRouter({
      config, processManager, modelGate, modelGatewayToken: "token",
      agnoClient: {}, ensureServerMode: async () => true, asyncHandler: (fn) => fn,
      fetchImpl: async () => ({ ok: true, json: async () => ({ state: "agent" }) }),
    });
    const r = mockRes();
    await router.handle({ method: "GET", url: "http://internal/api/agno/status" }, r);
    assert(r._json.model.nativeAgentActive === true);
  });

  it("POST /start starts the process manager", async () => {
    let started = false;
    const pm = {
      ...processManager,
      start: async () => { started = true; return { running: true, healthy: true }; },
    };
    const router = createAgnoRouter({
      config, processManager: pm, modelGate, modelGatewayToken: "token",
      agnoClient: {}, ensureServerMode: async () => true, asyncHandler: (fn) => fn,
      fetchImpl: notNativeAgentFetch,
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
      config, processManager: pm, modelGate, modelGatewayToken: "token",
      agnoClient: {}, ensureServerMode: async () => true, asyncHandler: (fn) => fn,
      fetchImpl: notNativeAgentFetch,
    });
    const r = mockRes();
    await router.handle({ method: "POST", url: "http://internal/api/agno/stop" }, r);
    assert(stopped === true);
  });

  it("GET /catalog returns agent list", async () => {
    const router = createAgnoRouter({
      config, processManager, modelGate, modelGatewayToken: "token",
      agnoClient: {}, ensureServerMode: async () => true, asyncHandler: (fn) => fn,
      fetchImpl: notNativeAgentFetch,
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
      config, processManager, modelGate, modelGatewayToken: "token",
      agnoClient, ensureServerMode: async () => true, asyncHandler: (fn) => fn,
      fetchImpl: notNativeAgentFetch,
    });
    const r = mockRes();
    const req = mockReqWithBody("POST", "http://internal/api/agno/runs", { message: "hi" });
    await router.handle(req, r);
    assert(r._json.runId === "abc");
    assert(createRunPayload.message === "hi");
  });

  it("POST /runs returns 409 if native agent active", async () => {
    const agnoClient = { createRun: async () => ({ runId: "should-not-be-called" }) };
    const router = createAgnoRouter({
      config, processManager, modelGate, modelGatewayToken: "token",
      agnoClient, ensureServerMode: async () => true, asyncHandler: (fn) => fn,
      fetchImpl: async () => ({ ok: true, json: async () => ({ state: "agent" }) }),
    });
    const r = mockRes();
    const req = mockReqWithBody("POST", "http://internal/api/agno/runs", { message: "hi" });
    await router.handle(req, r);
    assert(r.statusCode === 409);
    assert(r._json.error === "NATIVE_AGENT_ACTIVE");
  });

  it("POST /runs returns 503 if ensureServerMode fails", async () => {
    const agnoClient = { createRun: async () => ({ runId: "should-not-be-called" }) };
    const router = createAgnoRouter({
      config, processManager, modelGate, modelGatewayToken: "token",
      agnoClient, ensureServerMode: async () => false, asyncHandler: (fn) => fn,
      fetchImpl: notNativeAgentFetch,
    });
    const r = mockRes();
    const req = mockReqWithBody("POST", "http://internal/api/agno/runs", { message: "hi" });
    await router.handle(req, r);
    assert(r.statusCode === 503);
    assert(r._json.error === "DS4_BACKEND_UNAVAILABLE");
  });

  it("GET /runs lists runs using the injected agno client", async () => {
    const agnoClient = {
      listRuns: async () => ({ runs: [{ runId: "abc" }] }),
    };
    const router = createAgnoRouter({
      config, processManager, modelGate, modelGatewayToken: "token",
      agnoClient, ensureServerMode: async () => true, asyncHandler: (fn) => fn,
      fetchImpl: notNativeAgentFetch,
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
      config, processManager, modelGate, modelGatewayToken: "token",
      agnoClient, ensureServerMode: async () => true, asyncHandler: (fn) => fn,
      fetchImpl: notNativeAgentFetch,
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
      config, processManager, modelGate, modelGatewayToken: "token",
      agnoClient, ensureServerMode: async () => true, asyncHandler: (fn) => fn,
      fetchImpl: notNativeAgentFetch,
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
      config, processManager, modelGate, modelGatewayToken: "token",
      agnoClient, ensureServerMode: async () => true, asyncHandler: (fn) => fn,
      fetchImpl: notNativeAgentFetch,
    });
    const r = mockRes();
    await router.handle({ method: "POST", url: "http://internal/api/agno/runs/abc123/cancel" }, r);
    assert(cancelledId === "abc123");
    assert(r._json.status === "cancelled");
  });
});
