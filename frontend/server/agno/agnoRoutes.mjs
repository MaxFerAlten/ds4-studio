/**
 * Express router for the /api/agno/* endpoints.
 * Provides status, lifecycle control, catalog, run management, and metrics.
 */

import { forwardEventStream } from "./agnoProxy.mjs";
import { readRequestBody } from "../proxy.mjs";

/**
 * Create the Express router for Agno API endpoints.
 *
 * @param {object} options
 * @param {object} options.config - merged config
 * @param {object} options.processManager - AgnoProcessManager instance
 * @param {object} options.modelGate - AgnoModelGate instance
 * @param {string} options.modelGatewayToken - token for gateway auth
 * @param {function} options.ensureServerMode - function to switch to server mode
 * @param {function} options.asyncHandler - async error handler wrapper
 * @returns {import('express').Router}
 */
export function createAgnoRouter({
  config,
  processManager,
  modelGate,
  modelGatewayToken,
  agnoClient,
  ensureServerMode,
  asyncHandler,
  fetchImpl = fetch,
}) {
  const BASE = "/api/agno";
  const router = createRouter();

  // Check native agent status via the wrapper status endpoint. Returns
  // false (fail-open on the *check*, fail-closed on the caller side isn't
  // possible here) if the check itself cannot be completed.
  async function checkNativeAgentActive() {
    try {
      const wrapperStatus = await fetchImpl(`http://${config.control.host}:${config.control.port}/api/wrapper/status`, {
        signal: AbortSignal.timeout(1000),
      });
      if (!wrapperStatus.ok) return false;
      const wrapperData = await wrapperStatus.json();
      return wrapperData.state === "agent" || wrapperData.mode === "agent";
    } catch {
      return false;
    }
  }

  // Health check / status
  router.get(BASE + "/status", asyncHandler(async (req, res) => {
    const pmStatus = processManager.status();
    let agentOsHealth = null;
    const queueStatus = modelGate.status();

    if (pmStatus.running && pmStatus.healthy) {
      try {
        agentOsHealth = await processManager.healthCheck();
      } catch {
        agentOsHealth = false;
      }
    }

    const nativeAgentActive = await checkNativeAgentActive();

    res.json({
      enabled: config.agno.enabled,
      uiEnabled: config.agno.uiEnabled,
      process: {
        running: pmStatus.running,
        healthy: pmStatus.healthy,
        pid: pmStatus.pid,
        startedAt: pmStatus.lastHealthAt?.time || null,
        lastError: pmStatus.lastError?.error || null,
      },
      agentOs: agentOsHealth ? {
        version: "2.8.0",
        serviceVersion: "0.1.0",
        host: config.agno.host,
        port: config.agno.port,
      } : null,
      model: {
        id: config.agno.model || config.server.model,
        backendHealthy: agentOsHealth ? true : false,
        nativeAgentActive,
      },
      queue: queueStatus,
    });
  }));

  // Start AgentOS
  router.post(BASE + "/start", asyncHandler(async (req, res) => {
    if (!config.agno.enabled) {
      res.status(503).json({ error: "AGNO_DISABLED" });
      return;
    }
    const status = await processManager.start();
    res.json({ ok: true, status });
  }));

  // Stop AgentOS
  router.post(BASE + "/stop", asyncHandler(async (req, res) => {
    if (!config.agno.enabled) {
      res.status(503).json({ error: "AGNO_DISABLED" });
      return;
    }
    const status = await processManager.stop();
    res.json({ ok: true, status });
  }));

  // Restart AgentOS
  router.post(BASE + "/restart", asyncHandler(async (req, res) => {
    if (!config.agno.enabled) {
      res.status(503).json({ error: "AGNO_DISABLED" });
      return;
    }
    const status = await processManager.restart();
    res.json({ ok: true, status });
  }));

  // Catalog
  router.get(BASE + "/catalog", asyncHandler(async (req, res) => {
    if (!config.agno.enabled) {
      res.status(503).json({ error: "AGNO_DISABLED" });
      return;
    }
    // In MVP, we return a static catalog from config
    res.json({
      agents: [{ id: "ds4-assistant", kind: "agent", name: "DS4 Assistant", description: "Default assistant", enabled: true }],
      teams: [],
      workflows: [],
    });
  }));

  // Create a run
  router.post(BASE + "/runs", asyncHandler(async (req, res) => {
    if (!config.agno.enabled) {
      res.status(503).json({ error: "AGNO_DISABLED" });
      return;
    }
    if (await checkNativeAgentActive()) {
      res.status(409).json({ error: "NATIVE_AGENT_ACTIVE" });
      return;
    }
    const serverModeOk = await ensureServerMode();
    if (!serverModeOk) {
      res.status(503).json({ error: "DS4_BACKEND_UNAVAILABLE" });
      return;
    }
    const body = await readRequestBody(req);
    const result = await agnoClient.createRun(JSON.parse(body.toString("utf8")));
    res.status(202).json(result);
  }));

  // List runs
  router.get(BASE + "/runs", asyncHandler(async (req, res) => {
    if (!config.agno.enabled) {
      res.status(503).json({ error: "AGNO_DISABLED" });
      return;
    }
    const result = await agnoClient.listRuns();
    res.json(result);
  }));

  // Get run status
  router.get(BASE + "/runs/:id", asyncHandler(async (req, res) => {
    if (!config.agno.enabled) {
      res.status(503).json({ error: "AGNO_DISABLED" });
      return;
    }
    const result = await agnoClient.getRun(req.params.id);
    res.json(result);
  }));

  // Get run events (SSE)
  router.get(BASE + "/runs/:id/events", asyncHandler(async (req, res) => {
    if (!config.agno.enabled) {
      res.status(503).json({ error: "AGNO_DISABLED" });
      return;
    }
    const result = await agnoClient.openRunEvents(req.params.id, { signal: req.signal });
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    // Forward the stream
    forwardEventStream(result, res, { signal: req.signal });
  }));

  // Cancel a run
  router.post(BASE + "/runs/:id/cancel", asyncHandler(async (req, res) => {
    if (!config.agno.enabled) {
      res.status(503).json({ error: "AGNO_DISABLED" });
      return;
    }
    const result = await agnoClient.cancelRun(req.params.id);
    res.json(result);
  }));

  // Metrics
  router.get(BASE + "/metrics", asyncHandler(async (req, res) => {
    if (!config.agno.enabled) {
      res.status(503).json({ error: "AGNO_DISABLED" });
      return;
    }
    const queueStatus = modelGate.status();
    res.json({
      process: {
        running: processManager.status().running,
        healthy: processManager.status().healthy,
      },
      modelGate: queueStatus,
    });
  }));

  // Traces
  router.get(BASE + "/traces", asyncHandler(async (req, res) => {
    if (!config.agno.enabled) {
      res.status(503).json({ error: "AGNO_DISABLED" });
      return;
    }
    res.json({ traces: [] });
  }));

  return router;
}

function createRouter() {
  const routes = { get: [], post: [], use: [] };
  const router = {
    get: (path, handler) => routes.get.push({ path, handler }),
    post: (path, handler) => routes.post.push({ path, handler }),
    use: (handler) => routes.use.push(handler),
    handle: async (req, res) => {
      for (const mw of routes.use) {
        let nextCalled = false;
        const next = () => { nextCalled = true; };
        await mw(req, res, next);
        if (!nextCalled && res.headersSent) return;
      }
      const method = req.method.toLowerCase();
      const routeList = routes[method] || [];
      for (const r of routeList) {
        const urlObj = new URL(req.url, "http://internal");
        const params = matchPath(r.path, urlObj.pathname);
        if (params) {
          req.params = params;
          try {
            await r.handler(req, res);
          } catch (err) {
            if (!res.headersSent) res.status(502).json({ error: err.message });
          }
          return;
        }
      }
      if (!res.headersSent) {
        res.statusCode = 404;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ error: "NOT_FOUND" }));
      }
    },
  };
  return router;
}

// Matches a route pattern like "/api/agno/runs/:id" against a real pathname,
// returning the extracted params or null if the segment counts/literals differ.
function matchPath(pattern, pathname) {
  const patternParts = pattern.split("/").filter(Boolean);
  const pathParts = pathname.split("/").filter(Boolean);
  if (patternParts.length !== pathParts.length) return null;
  const params = {};
  for (let i = 0; i < patternParts.length; i++) {
    const part = patternParts[i];
    if (part.startsWith(":")) {
      params[part.slice(1)] = decodeURIComponent(pathParts[i]);
    } else if (part !== pathParts[i]) {
      return null;
    }
  }
  return params;
}
