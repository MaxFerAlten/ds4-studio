import { readRequestBody } from "../proxy.mjs";
import { fetchWithBusyRetry } from "../backendRetry.mjs";
import { abortOnClientDisconnect } from "../clientDisconnect.mjs";

const ALLOWLISTED_PATHS = new Set([
  "/v1/models",
  "/v1/chat/completions",
]);

const MAX_BODY_BYTES = 32 * 1024 * 1024;

/**
 * Create an Express router for the Agno model gateway.
 *
 * Routes:
 *   GET  /api/agno-model/v1/models
 *   POST /api/agno-model/v1/chat/completions
 *
 * All requests require a valid model gateway bearer token.
 * The gate ensures at most one in-flight call to ds4-server.
 *
 * @param {object} options
 * @param {object} options.config - merged config
 * @param {string} options.backendBase - base URL for ds4-server
 * @param {AgnoModelGate} options.modelGate - FIFO gate instance
 * @param {string} options.modelGatewayToken - expected bearer token
 * @param {function} options.fetchImpl - fetch function (for testing)
 * @returns {import('express').Router}
 */
export function createAgnoModelGateway({
  config,
  backendBase,
  modelGate,
  modelGatewayToken,
  fetchImpl = fetch,
}) {
  const router = createRouter();

  // Auth middleware for all gateway routes
  router.use(async (req, res, next) => {
    const auth = req.headers["authorization"] || "";
    if (!auth.startsWith("Bearer ")) {
      res.status(401).json({ error: "MISSING_GATEWAY_TOKEN" });
      return;
    }
    const token = auth.slice(7).trim();
    if (token !== modelGatewayToken) {
      res.status(403).json({ error: "INVALID_GATEWAY_TOKEN" });
      return;
    }
    next();
  });

  // GET /v1/models — passthrough
  router.get("/v1/models", async (req, res) => {
    try {
      const upstream = await fetchImpl(`${backendBase}/v1/models`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!upstream.ok) {
        res.status(502).json({ error: "DS4_BACKEND_UNAVAILABLE" });
        return;
      }
      const body = await upstream.json();
      res.json(body);
    } catch {
      res.status(503).json({ error: "DS4_BACKEND_UNAVAILABLE" });
    }
  });

  // POST /v1/chat/completions — gated, streaming-aware
  router.post("/v1/chat/completions", async (req, res) => {
    // 1. Feature enabled check
    if (!config.agno?.enabled) {
      res.status(503).json({ error: "AGNO_DISABLED" });
      return;
    }

    // 2. Body size and content type
    const contentType = req.headers["content-type"] || "";
    if (!contentType.includes("application/json")) {
      res.status(415).json({ error: "UNSUPPORTED_MEDIA_TYPE" });
      return;
    }

    let body;
    try {
      body = await readRequestBody(req, MAX_BODY_BYTES);
      body = JSON.parse(body.toString("utf8"));
    } catch (err) {
      const status = err.status || 400;
      res.status(status).json({ error: "INVALID_REQUEST_BODY" });
      return;
    }

    // 3. Acquire gate
    const { signal, cleanup } = abortOnClientDisconnect(req, res);
    let lease;
    try {
      lease = await modelGate.acquire({
        signal,
        runId: body?.run_id || body?.session_id || "unknown",
      });
    } catch (err) {
      cleanup();
      const code = err.code || "AGNO_MODEL_GATE_ERROR";
      if (code === "AGNO_MODEL_QUEUE_FULL") {
        res.status(429).json({ error: code });
      } else if (code === "AGNO_MODEL_WAIT_TIMEOUT") {
        res.status(504).json({ error: code });
      } else {
        res.status(503).json({ error: code });
      }
      return;
    }

    // 4. Forward to ds4-server with busy retry
    try {
      const upstream = await fetchWithBusyRetry(
        fetchImpl,
        `${backendBase}/v1/chat/completions`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
          signal,
        },
        { maxRetries: 5, baseDelayMs: 200, maxDelayMs: 1500 }
      );

      if (!upstream.ok) {
        const errBody = await upstream.json().catch(() => ({ error: "unknown" }));
        const status = upstream.status === 409 ? 409 : upstream.status;
        res.status(status).json(errBody);
        lease.release();
        cleanup();
        return;
      }

      // Check if streaming
      const isStreaming = body.stream === true;
      if (isStreaming) {
        // Pipe SSE with backpressure
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");
        res.flushHeaders();

        const upstreamBody = upstream.body;
        if (!upstreamBody) {
          res.end();
          lease.release();
          cleanup();
          return;
        }

        const reader = upstreamBody.getReader();
        const pump = async () => {
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              res.write(value);
            }
          } catch (err) {
            // Stream error — upstream or client disconnected
          } finally {
            res.end();
            lease.release();
            cleanup();
          }
        };
        pump().catch(() => {
          res.end();
          lease.release();
          cleanup();
        });
      } else {
        const result = await upstream.json();
        res.json(result);
        lease.release();
        cleanup();
      }
    } catch (err) {
      if (!res.headersSent) {
        res.status(502).json({ error: "DS4_BACKEND_UNAVAILABLE" });
      }
      lease.release();
      cleanup();
    }
  });

  // Unknown routes — must be registered as a separate handler, not use(),
  // so it runs after the auth middleware but after route matching fails.
  // We handle 404 in the handle() method instead.
  // (The catch-all in use() would run before route matching.)

  return router;
}

/**
 * Minimal Express-like router factory.
 * Avoids pulling in express for testability.
 */
function createRouter() {
  const routes = { get: [], post: [], use: [] };
  const stack = [];

  const router = {
    get: (path, handler) => {
      routes.get.push({ path, handler });
    },
    post: (path, handler) => {
      routes.post.push({ path, handler });
    },
    use: (handler) => {
      routes.use.push(handler);
    },
    /**
     * Handle an incoming (req, res) pair.
     */
    handle: async (req, res) => {
      // Run global middleware
      for (const mw of routes.use) {
        let nextCalled = false;
        const next = () => { nextCalled = true; };
        await mw(req, res, next);
        if (!nextCalled) {
          if (res.headersSent) return;
        }
      }
      // Route match
      const method = req.method.toLowerCase();
      const routeList = routes[method] || [];
      for (const r of routeList) {
        const urlObj = new URL(req.url, "http://internal");
        if (r.path === urlObj.pathname) {
          req.params = {};
          await r.handler(req, res);
          return;
        }
      }
      // No match
      if (!res.headersSent) {
        res.statusCode = 404;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ error: "NOT_FOUND" }));
      }
    },

  };
  return router;
}

function matchRoute(routePath, requestUrl) {
  const urlObj = new URL(requestUrl, "http://internal");
  const pathname = urlObj.pathname;
  if (routePath === pathname) return { params: {} };
  return null;
}
