import assert from "node:assert/strict";
import { createServer } from "node:http";
import express from "express";
import { test } from "node:test";
import { openWikiEnabledForAgentRequest, registerOpenWikiControlRoutes } from "./openwikiRoutes.mjs";

async function withRoutes(t, overrides = {}) {
  const calls = [];
  const service = Object.hasOwn(overrides, "service") ? overrides.service : {
    status: (key) => ({ state: "ready", enabled: key === "session-a", workspaceId: "repo" }),
    hasActiveSessions: () => false,
  };
  const app = express();
  app.use(express.json());
  registerOpenWikiControlRoutes(app, {
    asyncHandler: (handler) => (req, res, next) => Promise.resolve(handler(req, res)).catch(next),
    sessionKeyForRequest: (req) => req.get("x-test-session") || "session-a",
    getGenerationService: () => service,
    getAgentSession: (sessionKey) => ({ key: sessionKey }),
    openWikiCommand: async (args) => {
      calls.push(args);
      if (overrides.commandError) throw overrides.commandError;
      return { status: overrides.commandStatus ?? 200, payload: { ok: true, message: args.message } };
    },
    getConfig: () => overrides.config ?? { configPath: "/tmp/gateway.json", workspaceId: "repo" },
    loadGatewayConfig: overrides.loadConfig ?? (() => ({ workspaces: { repo: { root: "/tmp/repository" } } })),
    getSetupConfig: async () => ({ configured: false, sourcePath: "", workspacePath: "" }),
    validateWorkspacePath: async () => {},
    provisionRelease: async ({ sourcePath }) => {
      calls.push({ kind: "provision", sourcePath });
      return { commit: "a".repeat(40), releaseDir: "/tmp/openwiki-release/package" };
    },
    configureRuntime: async (config) => {
      calls.push({ kind: "configure", ...config });
      return { configured: true, ...config };
    },
    resetRuntimeConfig: async () => { calls.push({ kind: "reset" }); },
    getDefaultRequest: () => ({ model: "selected-ds4-model" }),
    getEngine: () => overrides.engine ?? "js",
    timeoutSignal: (milliseconds) => {
      assert.equal(milliseconds, 30 * 60 * 1000);
      return new AbortController().signal;
    },
  });
  app.use((error, _req, res, _next) => res.status(500).json({ message: error.message }));
  const server = createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  const address = server.address();
  return { base: `http://127.0.0.1:${address.port}`, calls };
}

test("OpenWiki setup provisions the pinned source then persists source and workspace config", async (t) => {
  const fx = await withRoutes(t);
  const current = await fetch(`${fx.base}/api/openwiki/config`);
  assert.equal(current.status, 200);
  assert.deepEqual(await current.json(), { configured: false, sourcePath: "", workspacePath: "" });

  const response = await fetch(`${fx.base}/api/openwiki/config`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sourcePath: "/tmp/openwiki-source", workspacePath: "/tmp/repository" }),
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    configured: true,
    sourcePath: "/tmp/openwiki-source",
    workspacePath: "/tmp/repository",
    releaseDir: "/tmp/openwiki-release/package",
    commit: "a".repeat(40),
  });
  assert.deepEqual(fx.calls.map(({ kind }) => kind), ["provision", "configure", "reset"]);
});

test("OpenWiki setup rejects relative paths and refuses reconfiguration while a session is active", async (t) => {
  const fx = await withRoutes(t);
  const invalid = await fetch(`${fx.base}/api/openwiki/config`, {
    method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sourcePath: "relative", workspacePath: "/tmp/repository" }),
  });
  assert.equal(invalid.status, 400);
  assert.equal((await invalid.json()).code, "OPENWIKI_PATH_INVALID");
  assert.equal(fx.calls.length, 0);

  const active = await withRoutes(t, { service: { hasActiveSessions: () => true } });
  const conflict = await fetch(`${active.base}/api/openwiki/config`, {
    method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sourcePath: "/tmp/openwiki-source", workspacePath: "/tmp/repository" }),
  });
  assert.equal(conflict.status, 409);
  assert.equal((await conflict.json()).code, "OPENWIKI_SESSION_ACTIVE");
  assert.equal(active.calls.length, 0);

  const unsafe = await withRoutes(t, {
    validateWorkspacePath: async () => { throw Object.assign(new Error("unsafe workspace"), { code: "OPENWIKI_WORKSPACE_INVALID" }); },
  });
  const unsafeResponse = await fetch(`${unsafe.base}/api/openwiki/config`, {
    method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sourcePath: "/tmp/openwiki-source", workspacePath: "/tmp/repository" }),
  });
  assert.equal(unsafeResponse.status, 400);
  assert.equal((await unsafeResponse.json()).code, "OPENWIKI_WORKSPACE_INVALID");
  assert.equal(unsafe.calls.length, 0);
});

test("OpenWiki status is session scoped and OFF when the service has not started", async (t) => {
  const fx = await withRoutes(t, { service: null });
  const response = await fetch(`${fx.base}/api/openwiki/status`);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).status.enabled, false);
  assert.equal(fx.calls.length, 0);
});

test("OpenWiki control routes validate actions and forward start and stop to the session handler", async (t) => {
  const fx = await withRoutes(t, { engine: "native" });
  const invalid = await fetch(`${fx.base}/api/openwiki/control`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "write" }),
  });
  assert.equal(invalid.status, 400);
  assert.equal((await invalid.json()).code, "OPENWIKI_USAGE_INVALID");
  assert.equal(fx.calls.length, 0);

  for (const action of ["start", "stop"]) {
    const response = await fetch(`${fx.base}/api/openwiki/control`, {
      method: "POST", headers: { "Content-Type": "application/json", "x-test-session": "session-b" },
      body: JSON.stringify({ action }),
    });
    assert.equal(response.status, 200);
  }
  assert.deepEqual(fx.calls.map(({ message }) => message), ["/openwiki start", "/openwiki stop"]);
  assert.equal(fx.calls[0].sessionKey, "session-b");
  assert.deepEqual(fx.calls[0].session, { key: "session-b" });
  assert.equal(fx.calls[0].engine, "native");
  assert.equal(fx.calls[0].request.model, "selected-ds4-model");
});

test("init and update require one configured workspace and pass its canonical root", async (t) => {
  const fx = await withRoutes(t);
  for (const action of ["init", "update"]) {
    const response = await fetch(`${fx.base}/api/openwiki/control`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }),
    });
    assert.equal(response.status, 200);
  }
  assert.deepEqual(fx.calls.map(({ message }) => message), [
    "/openwiki /tmp/repository init", "/openwiki /tmp/repository update",
  ]);

  const bad = await withRoutes(t, { config: { configPath: null, workspaceId: null } });
  const response = await fetch(`${bad.base}/api/openwiki/control`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "init" }),
  });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).code, "OPENWIKI_NOT_CONFIGURED");
  assert.equal(bad.calls.length, 0);
});

test("control errors and non-success handler statuses propagate without being reported as success", async (t) => {
  const fx = await withRoutes(t, { commandStatus: 409 });
  const conflict = await fetch(`${fx.base}/api/openwiki/control`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "start" }),
  });
  assert.equal(conflict.status, 409);

  const failing = await withRoutes(t, { commandError: new Error("start failed") });
  const response = await fetch(`${failing.base}/api/openwiki/control`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "start" }),
  });
  assert.equal(response.status, 500);
  assert.equal((await response.json()).message, "start failed");
});

test("Agent Mode forwards the OpenWiki capability only for the session that started it", () => {
  const sessions = new Set(["session-a"]);
  const service = { status: (sessionKey) => ({ enabled: sessions.has(sessionKey) }) };
  assert.equal(openWikiEnabledForAgentRequest(true, "session-a", service), true);
  assert.equal(openWikiEnabledForAgentRequest(true, "session-b", service), false);
  assert.equal(openWikiEnabledForAgentRequest(false, "session-a", service), false);
  assert.equal(openWikiEnabledForAgentRequest("true", "session-a", service), false);
  assert.equal(openWikiEnabledForAgentRequest(true, "session-a", null), false);
});
