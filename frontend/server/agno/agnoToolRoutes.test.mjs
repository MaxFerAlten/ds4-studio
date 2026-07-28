import assert from "node:assert";
import { describe, it } from "node:test";
import { createAgnoToolRoutes } from "./agnoToolRoutes.mjs";

function mockRes() {
  let _statusCode = 200, _headersSent = false, _jsonData = null;
  return {
    status: function(code) { _statusCode = code; return this; },
    json: function(data) { _headersSent = true; _jsonData = data; },
    setHeader: function() {},
    end: function() { _headersSent = true; },
    on: function() {},
    off: function() {},
    get headersSent() { return _headersSent; },
    get writableEnded() { return _headersSent; },
    get statusCode() { return _statusCode; },
    set statusCode(v) { _statusCode = v; },
    get _json() { return _jsonData; },
  };
}

function mockReq({ method = "GET", url, headers = {}, bodyText = null } = {}) {
  return {
    method,
    url,
    headers,
    on: function() {},
    off: function() {},
    async *[Symbol.asyncIterator]() {
      if (bodyText !== null) yield Buffer.from(bodyText);
    },
  };
}

const VALID_AUTH = { authorization: "Bearer good-token" };

function fakeAuthenticator({ ok = true, status = 401, code = "MISSING_TOOL_BRIDGE_TOKEN" } = {}) {
  let calls = 0;
  return {
    get calls() { return calls; },
    require: (req) => {
      calls++;
      if (!ok) return { ok: false, status, code };
      return { ok: true };
    },
  };
}

function fakePolicy({ enabled = true, profile = "full", allowed = ["read", "bash"] } = {}) {
  let allowedCalls = 0;
  return {
    enabled,
    profile,
    get allowedCalls() { return allowedCalls; },
    allowedToolNames: () => { allowedCalls++; return allowed; },
  };
}

function fakeGate(status = { inflight: 1, queued: 2, maxInflight: 1, maxQueued: 8, totalAcquired: 9, totalRejected: 0, totalTimedOut: 0, totalCancelled: 0 }) {
  return { status: () => status };
}

function fakeSessionRegistry({ size = 0, onCancel } = {}) {
  const calls = [];
  return {
    sessions: { size },
    cancel: (args) => {
      calls.push(args);
      if (onCancel) onCancel(args);
    },
    get cancelCalls() { return calls; },
  };
}

function fakeService({ onExecute } = {}) {
  const calls = [];
  return {
    execute: async (body, opts) => {
      calls.push({ body, opts });
      if (onExecute) return onExecute(body, opts);
      return {
        ok: true, toolName: body.toolName, content: "done", isError: false,
        guarded: false, compressed: false, code: null, raw: null, durationMs: 1,
      };
    },
    get executeCalls() { return calls; },
  };
}

function makeRouter(overrides = {}) {
  return createAgnoToolRoutes({
    authenticator: overrides.authenticator ?? fakeAuthenticator(),
    policy: overrides.policy ?? fakePolicy(),
    gate: overrides.gate ?? fakeGate(),
    sessionRegistry: overrides.sessionRegistry ?? fakeSessionRegistry(),
    service: overrides.service ?? fakeService(),
    asyncHandler: (fn) => fn,
  });
}

const CATALOG_URL = "http://internal/api/internal/agno-tools/catalog";
const STATUS_URL = "http://internal/api/internal/agno-tools/status";
const EXECUTE_URL = "http://internal/api/internal/agno-tools/execute";
const CANCEL_URL = "http://internal/api/internal/agno-tools/cancel";

describe("createAgnoToolRoutes: auth", () => {
  it("GET /catalog with missing token returns 401 and never reaches policy", async () => {
    const authenticator = fakeAuthenticator({ ok: false, status: 401, code: "MISSING_TOOL_BRIDGE_TOKEN" });
    const policy = fakePolicy();
    const router = makeRouter({ authenticator, policy });
    const res = mockRes();
    await router.handle(mockReq({ method: "GET", url: CATALOG_URL, headers: {} }), res);
    assert.strictEqual(res.statusCode, 401);
    assert.deepStrictEqual(res._json, { error: "MISSING_TOOL_BRIDGE_TOKEN" });
    assert.strictEqual(policy.allowedCalls, 0);
  });

  it("POST /execute with invalid token returns 403 and never calls the service", async () => {
    const authenticator = fakeAuthenticator({ ok: false, status: 403, code: "INVALID_TOOL_BRIDGE_TOKEN" });
    const service = fakeService();
    const router = makeRouter({ authenticator, service });
    const res = mockRes();
    await router.handle(mockReq({
      method: "POST", url: EXECUTE_URL,
      headers: { authorization: "Bearer wrong" },
      bodyText: JSON.stringify({ protocolVersion: 1, callId: "c1", toolName: "read", arguments: {}, context: {} }),
    }), res);
    assert.strictEqual(res.statusCode, 403);
    assert.deepStrictEqual(res._json, { error: "INVALID_TOOL_BRIDGE_TOKEN" });
    assert.strictEqual(service.executeCalls.length, 0);
  });

  it("POST /cancel with missing token returns 401 and never calls the registry", async () => {
    const authenticator = fakeAuthenticator({ ok: false, status: 401, code: "MISSING_TOOL_BRIDGE_TOKEN" });
    const sessionRegistry = fakeSessionRegistry();
    const router = makeRouter({ authenticator, sessionRegistry });
    const res = mockRes();
    await router.handle(mockReq({ method: "POST", url: CANCEL_URL, headers: {} }), res);
    assert.strictEqual(res.statusCode, 401);
    assert.strictEqual(sessionRegistry.cancelCalls.length, 0);
  });

  it("GET /status with missing token returns 401", async () => {
    const router = makeRouter({ authenticator: fakeAuthenticator({ ok: false }) });
    const res = mockRes();
    await router.handle(mockReq({ method: "GET", url: STATUS_URL }), res);
    assert.strictEqual(res.statusCode, 401);
  });
});

describe("createAgnoToolRoutes: AGNO_TOOLS_DISABLED gating", () => {
  for (const [name, method, url] of [
    ["catalog", "GET", CATALOG_URL],
    ["status", "GET", STATUS_URL],
    ["execute", "POST", EXECUTE_URL],
    ["cancel", "POST", CANCEL_URL],
  ]) {
    it(`${method} ${name} returns 503 AGNO_TOOLS_DISABLED when policy.enabled is false`, async () => {
      const policy = fakePolicy({ enabled: false });
      const router = makeRouter({ policy });
      const res = mockRes();
      await router.handle(mockReq({
        method, url, headers: VALID_AUTH,
        bodyText: method === "POST" ? JSON.stringify({ protocolVersion: 1 }) : null,
      }), res);
      assert.strictEqual(res.statusCode, 503);
      assert.deepStrictEqual(res._json, { error: "AGNO_TOOLS_DISABLED" });
    });
  }
});

describe("createAgnoToolRoutes: catalog", () => {
  it("returns the filtered tool list and a stable digest across two identical calls", async () => {
    const policy = fakePolicy({ allowed: ["read", "bash"] });
    const router = makeRouter({ policy });
    const res1 = mockRes();
    await router.handle(mockReq({ method: "GET", url: CATALOG_URL, headers: VALID_AUTH }), res1);
    const res2 = mockRes();
    await router.handle(mockReq({ method: "GET", url: CATALOG_URL, headers: VALID_AUTH }), res2);

    assert.strictEqual(res1.statusCode, 200);
    assert.ok(res1._json.tools.every((t) => ["read", "bash"].includes(t.function.name)));
    assert.ok(res1._json.catalogDigest.startsWith("sha256:"));
    assert.strictEqual(res1._json.catalogDigest, res2._json.catalogDigest);
  });

  it("digest changes when the filtered tool set changes", async () => {
    const routerAll = makeRouter({ policy: fakePolicy({ allowed: ["read", "bash", "search"] }) });
    const routerFew = makeRouter({ policy: fakePolicy({ allowed: ["read"] }) });
    const resAll = mockRes();
    const resFew = mockRes();
    await routerAll.handle(mockReq({ method: "GET", url: CATALOG_URL, headers: VALID_AUTH }), resAll);
    await routerFew.handle(mockReq({ method: "GET", url: CATALOG_URL, headers: VALID_AUTH }), resFew);
    assert.notStrictEqual(resAll._json.catalogDigest, resFew._json.catalogDigest);
  });
});

describe("createAgnoToolRoutes: execute", () => {
  const VALID_BODY = { protocolVersion: 1, callId: "call-1", toolName: "read", arguments: { path: "README.md" }, context: { sessionId: "s1", runId: "r1" } };

  it("happy path calls service.execute with the parsed body and an AbortSignal", async () => {
    const service = fakeService();
    const router = makeRouter({ service });
    const res = mockRes();
    await router.handle(mockReq({ method: "POST", url: EXECUTE_URL, headers: VALID_AUTH, bodyText: JSON.stringify(VALID_BODY) }), res);
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(service.executeCalls.length, 1);
    assert.deepStrictEqual(service.executeCalls[0].body, VALID_BODY);
    assert.ok(service.executeCalls[0].opts.signal instanceof AbortSignal);
  });

  it("rejects a malformed request (bad protocolVersion) with 400 INVALID_TOOL_REQUEST", async () => {
    const service = fakeService();
    const router = makeRouter({ service });
    const res = mockRes();
    await router.handle(mockReq({
      method: "POST", url: EXECUTE_URL, headers: VALID_AUTH,
      bodyText: JSON.stringify({ ...VALID_BODY, protocolVersion: 2 }),
    }), res);
    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(res._json.error, "INVALID_TOOL_REQUEST");
    assert.strictEqual(service.executeCalls.length, 0);
  });

  it("rejects non-JSON body with 400 INVALID_TOOL_REQUEST", async () => {
    const router = makeRouter();
    const res = mockRes();
    await router.handle(mockReq({ method: "POST", url: EXECUTE_URL, headers: VALID_AUTH, bodyText: "{not json" }), res);
    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(res._json.error, "INVALID_TOOL_REQUEST");
  });

  it("rejects an oversized body with 413", async () => {
    const router = makeRouter();
    const res = mockRes();
    const oversized = JSON.stringify({ ...VALID_BODY, padding: "a".repeat(3 * 1024 * 1024) });
    await router.handle(mockReq({ method: "POST", url: EXECUTE_URL, headers: VALID_AUTH, bodyText: oversized }), res);
    assert.strictEqual(res.statusCode, 413);
    assert.strictEqual(res._json.error, "INVALID_TOOL_REQUEST");
  });

  const errorCases = [
    { code: "UNKNOWN_TOOL", status: 404 },
    { code: "AGNO_TOOL_QUEUE_FULL", status: 429 },
    { code: "INVALID_TOOL_CONTEXT", status: 422 },
    { code: "SOME_UNMAPPED_WEIRD_CODE", status: 502 },
  ];
  for (const { code, status } of errorCases) {
    it(`maps thrown error code ${code} to HTTP ${status}`, async () => {
      const service = fakeService({
        onExecute: () => { const err = new Error(code); err.code = code; throw err; },
      });
      const router = makeRouter({ service });
      const res = mockRes();
      await router.handle(mockReq({ method: "POST", url: EXECUTE_URL, headers: VALID_AUTH, bodyText: JSON.stringify(VALID_BODY) }), res);
      assert.strictEqual(res.statusCode, status);
      const expectedCode = status === 502 && code === "SOME_UNMAPPED_WEIRD_CODE" ? "TOOL_EXECUTION_FAILED" : code;
      assert.strictEqual(res._json.error, expectedCode);
    });
  }

  it("maps an error without a .code at all to 502 TOOL_EXECUTION_FAILED (fallback, no reliance on .status)", async () => {
    const service = fakeService({
      onExecute: () => { const err = new Error("boom"); err.status = 418; throw err; }, // .status deliberately misleading
    });
    const router = makeRouter({ service });
    const res = mockRes();
    await router.handle(mockReq({ method: "POST", url: EXECUTE_URL, headers: VALID_AUTH, bodyText: JSON.stringify(VALID_BODY) }), res);
    assert.strictEqual(res.statusCode, 502);
    assert.strictEqual(res._json.error, "TOOL_EXECUTION_FAILED");
  });
});

describe("createAgnoToolRoutes: cancel", () => {
  it("calls sessionRegistry.cancel with sessionId/runId from the body", async () => {
    const sessionRegistry = fakeSessionRegistry();
    const router = makeRouter({ sessionRegistry });
    const res = mockRes();
    await router.handle(mockReq({
      method: "POST", url: CANCEL_URL, headers: VALID_AUTH,
      bodyText: JSON.stringify({ protocolVersion: 1, sessionId: "s1", runId: "r1" }),
    }), res);
    assert.strictEqual(res.statusCode, 200);
    assert.deepStrictEqual(res._json, { ok: true });
    assert.deepStrictEqual(sessionRegistry.cancelCalls, [{ sessionId: "s1", runId: "r1" }]);
  });

  it("no-ops gracefully (200) when the session/run is unknown", async () => {
    // fakeSessionRegistry's cancel never throws, mirroring the real
    // AgnoToolSessionRegistry.cancel()'s documented idempotent no-op.
    const sessionRegistry = fakeSessionRegistry();
    const router = makeRouter({ sessionRegistry });
    const res = mockRes();
    await router.handle(mockReq({
      method: "POST", url: CANCEL_URL, headers: VALID_AUTH,
      bodyText: JSON.stringify({ protocolVersion: 1, sessionId: "unknown", runId: "unknown" }),
    }), res);
    assert.strictEqual(res.statusCode, 200);
    assert.deepStrictEqual(res._json, { ok: true });
  });

  it("maps an error thrown by sessionRegistry.cancel through the same table", async () => {
    const sessionRegistry = fakeSessionRegistry({
      onCancel: () => { const err = new Error("nope"); err.code = "AGNO_TOOL_CANCELLED"; throw err; },
    });
    const router = makeRouter({ sessionRegistry });
    const res = mockRes();
    await router.handle(mockReq({
      method: "POST", url: CANCEL_URL, headers: VALID_AUTH,
      bodyText: JSON.stringify({ protocolVersion: 1, sessionId: "s1", runId: "r1" }),
    }), res);
    assert.strictEqual(res.statusCode, 408);
    assert.strictEqual(res._json.error, "AGNO_TOOL_CANCELLED");
  });
});

describe("createAgnoToolRoutes: status", () => {
  it("returns exactly the documented shape with no leaked fields", async () => {
    const policy = fakePolicy({ enabled: true, profile: "full", allowed: ["read", "bash", "search"] });
    const gate = fakeGate({ inflight: 1, queued: 3, maxInflight: 1, maxQueued: 8, totalAcquired: 9, totalRejected: 1, totalTimedOut: 0, totalCancelled: 0 });
    const sessionRegistry = fakeSessionRegistry({ size: 2 });
    const router = makeRouter({ policy, gate, sessionRegistry });
    const res = mockRes();
    await router.handle(mockReq({ method: "GET", url: STATUS_URL, headers: VALID_AUTH }), res);

    assert.strictEqual(res.statusCode, 200);
    assert.deepStrictEqual(res._json, {
      enabled: true,
      profile: "full",
      catalogCount: 3,
      gate: { inflight: 1, queued: 3 },
      sessions: 2,
    });
    assert.deepStrictEqual(Object.keys(res._json).sort(), ["catalogCount", "enabled", "gate", "profile", "sessions"]);
    assert.deepStrictEqual(Object.keys(res._json.gate).sort(), ["inflight", "queued"]);
  });
});
