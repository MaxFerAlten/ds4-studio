/**
 * HTTP bridge for Agno-originated tool calls.
 *
 * Exposes catalog/execute/cancel/status over the pieces built in tasks 6-9:
 * AgnoToolAuthenticator (bearer token), AgnoToolPolicy (allow/deny),
 * AgnoToolGate (concurrency), AgnoToolSessionRegistry (session state), and
 * AgnoToolExecutionService (orchestrates one tool call end-to-end).
 *
 * Not mounted anywhere yet — a later task wires this router into index.mjs,
 * mirroring how agnoRoutes.mjs is mounted there today.
 */
import crypto from "node:crypto";
import { readRequestBody } from "../proxy.mjs";
import { abortOnClientDisconnect } from "../clientDisconnect.mjs";
import { listAgentTools } from "../agentToolCatalog.mjs";

const BASE = "/api/internal/agno-tools";

// Tool-call arguments are small JSON payloads (paths, commands, short
// snippets) — 2MB is generous headroom without inheriting proxy.mjs's 64MB
// default, which is sized for arbitrary upstream proxying.
const MAX_TOOL_REQUEST_BYTES = 2 * 1024 * 1024;

// §16.5 error->HTTP status table, keyed by error.code (not error.status —
// sessionError()/AgnoToolGate's #error() never set .status, only .code).
// Any thrown error whose .code isn't listed here falls back to
// TOOL_EXECUTION_FAILED/502, which also covers raw/unstructured throws from
// deep inside executeTool().
const ERROR_STATUS_TABLE = {
  MISSING_TOOL_BRIDGE_TOKEN: 401,
  INVALID_TOOL_BRIDGE_TOKEN: 403,
  AGNO_TOOLS_DISABLED: 503,
  TOOL_NOT_ALLOWED: 403,
  UNKNOWN_TOOL: 404,
  INVALID_TOOL_ARGUMENTS: 422,
  INVALID_TOOL_CONTEXT: 422,
  NATIVE_AGENT_ACTIVE: 409,
  WRAPPER_STATUS_UNAVAILABLE: 503,
  AGNO_TOOL_QUEUE_FULL: 429,
  AGNO_TOOL_WAIT_TIMEOUT: 504,
  AGNO_TOOL_CANCELLED: 408,
  TOOL_EXECUTION_FAILED: 502
};

function requireAuth(authenticator, req, res) {
  const result = authenticator.require(req);
  if (!result.ok) {
    res.status(result.status).json({ error: result.code });
    return false;
  }
  return true;
}

function requireEnabled(policy, res) {
  if (!policy.enabled) {
    res.status(503).json({ error: "AGNO_TOOLS_DISABLED" });
    return false;
  }
  return true;
}

/** Table-driven mapper for errors thrown by session/gate/policy/service machinery. */
function sendMappedError(res, error) {
  const code = error?.code && Object.prototype.hasOwnProperty.call(ERROR_STATUS_TABLE, error.code)
    ? error.code
    : "TOOL_EXECUTION_FAILED";
  const status = ERROR_STATUS_TABLE[code];
  const payload = { error: code };
  if (error?.message) payload.message = error.message;
  res.status(status).json(payload);
}

/**
 * Read and JSON-parse a request body, sized for tool-call payloads.
 * Distinguishes an oversized body (413, from readRequestBody itself) from a
 * malformed/non-JSON body (400) — both use the generic INVALID_TOOL_REQUEST
 * code since neither is one of the §16.5 table's deeper-layer failures.
 */
async function readJsonBody(req) {
  let raw;
  try {
    raw = await readRequestBody(req, MAX_TOOL_REQUEST_BYTES);
  } catch (err) {
    err.code = "INVALID_TOOL_REQUEST";
    throw err; // err.status is already 413, set by readRequestBody
  }
  try {
    return JSON.parse(raw.toString("utf8"));
  } catch {
    const err = new Error("request body must be valid JSON");
    err.status = 400;
    err.code = "INVALID_TOOL_REQUEST";
    throw err;
  }
}

function catalogDigest(tools) {
  return `sha256:${crypto.createHash("sha256").update(JSON.stringify(tools)).digest("hex")}`;
}

/**
 * Create the router for the /api/internal/agno-tools/* bridge.
 *
 * @param {object} options
 * @param {object} options.authenticator - AgnoToolAuthenticator instance
 * @param {object} options.policy - AgnoToolPolicy instance
 * @param {object} options.gate - AgnoToolGate instance
 * @param {object} options.sessionRegistry - AgnoToolSessionRegistry instance
 * @param {object} options.service - AgnoToolExecutionService instance
 * @param {function} options.asyncHandler - async error handler wrapper
 */
export function createAgnoToolRoutes({
  authenticator,
  policy,
  gate,
  sessionRegistry,
  service,
  asyncHandler
}) {
  const router = createRouter();

  // Catalog: the filtered tool schema list currently allowed by policy.
  router.get(BASE + "/catalog", asyncHandler(async (req, res) => {
    if (!requireAuth(authenticator, req, res)) return;
    if (!requireEnabled(policy, res)) return;

    const allowed = policy.allowedToolNames();
    const tools = listAgentTools().filter((item) => allowed.includes(item.function.name));

    res.status(200).json({
      protocolVersion: 1,
      profile: policy.profile,
      tools,
      catalogDigest: catalogDigest(tools)
    });
  }));

  // Execute: run one tool call end-to-end via AgnoToolExecutionService.
  router.post(BASE + "/execute", asyncHandler(async (req, res) => {
    if (!requireAuth(authenticator, req, res)) return;
    if (!requireEnabled(policy, res)) return;

    let body;
    try {
      body = await readJsonBody(req);
    } catch (err) {
      res.status(err.status || 400).json({ error: err.code || "INVALID_TOOL_REQUEST", message: err.message });
      return;
    }

    if (body.protocolVersion !== 1 || typeof body.callId !== "string" || !body.callId) {
      res.status(400).json({
        error: "INVALID_TOOL_REQUEST",
        message: "protocolVersion must be 1 and callId is required"
      });
      return;
    }

    // toolName/arguments/context validity is the service's job (via
    // validateToolArguments / sessionRegistry.getOrCreate) — not duplicated
    // here, see UNKNOWN_TOOL/INVALID_TOOL_ARGUMENTS/INVALID_TOOL_CONTEXT.
    const { signal, cleanup } = abortOnClientDisconnect(req, res);
    try {
      const result = await service.execute(body, { signal });
      res.status(200).json(result);
    } catch (err) {
      sendMappedError(res, err);
    } finally {
      cleanup();
    }
  }));

  // Cancel: abort a session/run's in-flight tool calls. Idempotent — an
  // unknown (sessionId, runId) pair is a harmless no-op, not an error.
  router.post(BASE + "/cancel", asyncHandler(async (req, res) => {
    if (!requireAuth(authenticator, req, res)) return;
    if (!requireEnabled(policy, res)) return;

    let body;
    try {
      body = await readJsonBody(req);
    } catch (err) {
      res.status(err.status || 400).json({ error: err.code || "INVALID_TOOL_REQUEST", message: err.message });
      return;
    }

    if (body.protocolVersion !== 1) {
      res.status(400).json({ error: "INVALID_TOOL_REQUEST", message: "protocolVersion must be 1" });
      return;
    }

    try {
      sessionRegistry.cancel({ sessionId: body.sessionId, runId: body.runId });
      res.status(200).json({ ok: true });
    } catch (err) {
      sendMappedError(res, err);
    }
  }));

  // Status: sanitized snapshot only — never leak the bearer token or history.
  router.get(BASE + "/status", asyncHandler(async (req, res) => {
    if (!requireAuth(authenticator, req, res)) return;
    if (!requireEnabled(policy, res)) return;

    const gateStatus = gate.status();

    res.status(200).json({
      enabled: policy.enabled,
      profile: policy.profile,
      catalogCount: policy.allowedToolNames().length,
      gate: { inflight: gateStatus.inflight, queued: gateStatus.queued },
      sessions: sessionRegistry.sessions.size
    });
  }));

  return router;
}

// ponytail: duplicated from agnoRoutes.mjs's private createRouter()/
// matchPath() pair (not exported there, so this is a local copy rather than
// a change to a sibling task's file). Extract to a shared module if a third
// router later justifies it.
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

// Matches a route pattern like "/api/internal/agno-tools/execute" against a
// real pathname, returning the extracted params or null if the segment
// counts/literals differ.
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
