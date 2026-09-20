// Lean 4 HTTP routes for ds4-studio
// Importable Express router — not inline in index.mjs.
//
// R6: every /exec submission follows a fixed order (feature readiness, body,
// normalize, policy gate, source SHA, registry reserve, preflight freshness,
// execute, complete registry, respond). Invalid requests never reach the
// registry; concurrent runs over the limits get a 429 without spawning.
//
// History: uses LeanAuditStore (extracted from inline in R003-10).
// Session paths are SHA-256 derived, filenames collision-safe,
// writes are atomic via temp+rename.

import { createHash } from "crypto";
import path from "path";

import { LEAN_RESULT_CONTRACT } from "./leanConstants.mjs";
import { normalizeLeanRequest, leanMaxAttempts } from "./leanContract.mjs";
import { loadLeanContractPolicy } from "./leanContractPolicy.mjs";
import { classifyLeanResult } from "./leanRepairPolicy.mjs";
import { LeanRunRegistry } from "./leanRunRegistry.mjs";
import { createLeanAuditStore } from "./leanAuditStore.mjs";

/** Contract-shaped rejection for failures that never reach the executor.
 *
 * These still carry an orchestration decision: a client that only learns
 * "rejected" has to guess whether repairing the proof could help, and guessing
 * is exactly what the orchestration contract removes.
 *
 * @param {string} code
 * @param {string} message
 * @param {object} [extra] - Extra contract fields (runId, sessionId, …)
 * @param {number} [maxAttempts] - Budget to report; the rejection itself never
 *   leaves attempts, so this is informational only.
 */
function rejection(code, message, extra = {}, maxAttempts = leanMaxAttempts()) {
  const result = {
    contractVersion: LEAN_RESULT_CONTRACT,
    status: "rejected",
    isError: true,
    errorCode: code,
    summary: `${code}: ${message}`,
    certified: false,
    attemptConsumed: false,
    diagnostics: [],
    exitCode: null,
    timedOut: false,
    cancelled: false,
    ...extra,
  };
  const decision = classifyLeanResult(result);
  result.orchestration = {
    ...decision,
    attempt: 1,
    maxAttempts,
    attemptsRemaining: 0,
  };
  result.orchestrationTerminal = decision.terminal;
  result.orchestrationVerified = false;
  result.orchestrationRetryable = decision.retryable;
  result.orchestrationFailureClass = decision.failureClass || "";
  result.orchestrationNextAction = decision.nextAction || "";
  result.orchestrationFingerprint = decision.diagnosticFingerprint || "";
  result.orchestrationStrategyChangeRequired = decision.strategyChangeRequired;
  result.orchestrationTerminalReason = decision.terminalReason || "";
  return result;
}

/** Session id for the deprecated legacy routes, from header or the default. */
function sessionFromHeader(req, fallback) {
  const raw = req.get("x-lean-session-id") || req.get("x-session-id");
  return (raw && raw.trim()) || fallback;
}

/** Mark a deprecated endpoint and point at its scoped successor. */
function markDeprecated(res, successorPath) {
  res.set("Deprecation", "true");
  res.set("Sunset", "Thu, 31 Dec 2026 23:59:59 GMT");
  res.set("Link", `<${successorPath}>; rel="successor-version"`);
}

/**
 * Create an Express router for Lean endpoints.
 *
 * @param {object} deps - Dependencies
 * @param {object} deps.express - Express module
 * @param {object} deps.config - Lean configuration (loadLeanConfig output)
 * @param {function} deps.executeLeanCheck - Executor function
 * @param {function} deps.getPreflight - Async () => preflight report
 * @param {function} [deps.getLeanPolicyState] - Async () => ({ loaded, revision })
 * @param {function} [deps.getLeanContractPolicy] - Async () => ({ policy, revision }).
 *   Defaults to the generated descriptor loader; injectable so a test can stand
 *   up a server whose contract revision differs from this build's.
 * @param {LeanRunRegistry} [deps.runRegistry] - Shared run registry. When absent
 *   a registry is built from config.*Run* limits.
 * @param {object} [deps.logger] - Logger
 * @returns {object} Router
 */
export function createLeanRouter(deps) {
  const {
    express,
    config,
    executeLeanCheck,
    getPreflight,
    getLeanPolicyState,
    getLeanContractPolicy = loadLeanContractPolicy,
    metrics,
    logger,
  } = deps;

  const runRegistry =
    deps.runRegistry ??
    new LeanRunRegistry({
      maxGlobalRuns: config.maxGlobalRuns,
      maxRunsPerSession: config.maxRunsPerSession,
      maxQueuedPerSession: config.maxQueuedPerSession,
      capacity: config.registryCapacity,
      ttlMs: config.registryTtlMs,
    });
  if (!(runRegistry instanceof LeanRunRegistry)) {
    throw new Error("createLeanRouter: runRegistry must be a LeanRunRegistry instance");
  }

  // --- History (R003-10: extracted to LeanAuditStore) ------------------------
  const LEAN_HISTORY_DIR = path.resolve(process.cwd(), "data", "lean");
  const auditStore = deps.auditStore ?? createLeanAuditStore({ auditRoot: LEAN_HISTORY_DIR });

  const router = express.Router();

  // GET /status — health check and preflight info
  router.get("/status", async (req, res) => {
    try {
      const policyState = getLeanPolicyState ? await getLeanPolicyState() : {};
      // A stale descriptor must be visible in status rather than only at the
      // moment a check is refused.
      let contractState = null;
      let contractError = null;
      try {
        contractState = await getLeanContractPolicy();
      } catch (err) {
        contractError = err.code || "LEAN_CONTRACT_DESCRIPTOR_STALE";
        logger?.error?.("lean_contract_descriptor_error", err.message);
      }
      const preflight = config.enabled && getPreflight ? await getPreflight() : null;
      res.json({
        enabled: Boolean(config.enabled),
        // R3: requested (what was asked for) vs effective (what is applied) vs
        // source (per-key provenance: env / file / default). The runtimeRoot and
        // runsRoot are never echoed, only their provenance.
        requested: {
          enabled: Boolean(config.requested?.enabled ?? config.enabled),
          policyAuto: Boolean(config.requested?.policyAuto ?? config.policyAuto),
          sandboxRequired: Boolean(config.requested?.sandboxRequired ?? config.sandboxRequired),
          defaultProfile: config.requested?.defaultProfile || config.defaultProfile || "core",
        },
        effective: {
          enabled: Boolean(config.enabled),
          policyAuto: Boolean(config.policyAuto),
          sandboxRequired: Boolean(config.sandboxRequired),
          defaultProfile: config.defaultProfile || "core",
          // The resolved proof budget. The native client reads it at preflight
          // so C and Node never run on two different policies (§5.4).
          orchestration: config.orchestration || null,
        },
        source: {
          enabled: config.sources?.enabled || "env",
          policyAuto: config.sources?.policyAuto || "env",
          sandboxRequired: config.sources?.sandboxRequired || "env",
          defaultProfile: config.sources?.defaultProfile || "env",
          runtimeRoot: config.sources?.runtimeRoot || "env",
          runsRoot: config.sources?.runsRoot || "env",
        },
        policyLoaded: Boolean(policyState.loaded),
        // Deprecated alias of policy.promptRevision.
        policyRevision: policyState.revision || "",
        contractVersion: LEAN_RESULT_CONTRACT,
        contractRevision: contractState?.revision || "",
        contractDescriptorError: contractError,
        policy: {
          available: Boolean(policyState.loaded),
          mode: policyState.mode || "base",
          promptRevision: policyState.revision || "",
          bundleStale: Boolean(policyState.stale),
        },
        // The Node server sees the policy on disk, not the one a given native
        // session was primed with. Claiming otherwise is how a status page ends
        // up contradicting the client it is supposed to explain.
        sessionPolicyVisible: false,
        rollout: {
          requireContractRevision: Boolean(config.requireContractRevision),
          allowLegacyPolicyRevision: config.allowLegacyPolicyRevision !== false,
        },
        concurrency: {
          maxGlobalRuns: config.maxGlobalRuns,
          maxRunsPerSession: config.maxRunsPerSession,
          maxQueuedPerSession: config.maxQueuedPerSession,
          activeGlobalRuns: runRegistry.activeGlobalRuns(),
          activeRuns: runRegistry.size,
        },
        preflight: preflight
          ? {
              ok: preflight.ok,
              sandboxAvailable: preflight.sandboxAvailable,
              // Profile reasons name host paths; only the verdict is exposed.
              profiles: Object.fromEntries(
                Object.entries(preflight.profiles || {}).map(([name, p]) => [
                  name,
                  { ok: p.ok, toolchain: p.toolchain || null },
                ])
              ),
              errors: preflight.errors || [],
            }
          : null,
        metrics: metrics ? metrics.snapshot() : null,
      });
    } catch (err) {
      logger?.error?.("lean_status_error", err.message);
      res.status(500).json({ error: "internal_error" });
    }
  });

  // GET /history — global lean_check log across all sessions
  router.get("/history", (req, res) => {
    const limit = Math.min(parseInt(req.query.limit) || 200, 2000);
    const cursor = req.query.cursor || undefined;
    const { entries, nextCursor, count } = auditStore.readAll({ limit, cursor });
    res.json({ count, entries, nextCursor, limit });
  });

  // GET /history/sessions — list all session ids
  router.get("/history/sessions", (req, res) => {
    const { sessions, count } = auditStore.listSessions();
    res.json({ count, sessions });
  });

  // GET /history/:sessionId — per-session lean_check log
  router.get("/history/:sessionId", (req, res) => {
    const { sessionId } = req.params;
    const limit = Math.min(parseInt(req.query.limit) || 500, 2000);
    const cursor = req.query.cursor || undefined;
    const { entries, nextCursor, count } = auditStore.readSession(sessionId, { limit, cursor });
    res.json({ sessionId, count, entries, nextCursor, limit });
  });

  // POST /exec — execute a Lean check
  router.post("/exec", async (req, res) => {
    let reserved = false;
    let request = null;
    try {
      // 1. feature/effective readiness
      if (!config.enabled) {
        return res.status(503).json(rejection("LEAN_DISABLED", "Lean feature is disabled."));
      }

      // 2. body object
      const body = req.body;
      if (!body || typeof body !== "object") {
        return res.status(400).json(rejection("LEAN_REQUEST_INVALID", "Body must be a JSON object."));
      }

      // 3. normalize request (settles defaults, validates ids, freezes)
      const normalized = normalizeLeanRequest(body, config);
      if (!normalized.ok) {
        return res
          .status(normalized.error.statusCode)
          .json(rejection(normalized.error.code, normalized.error.message));
      }
      request = normalized.value;

      // 4. contract gate — the only revision comparison allowed to refuse a run.
      //
      // What used to be here compared the *prompt* hashes and returned 409 when
      // they differed, so editing skills/lean/SKILL.md locked out every session
      // already primed with the previous text — for a difference the lean_check
      // protocol cannot even observe. The prompt comparison still happens, below,
      // and is reported; it no longer blocks.
      const contractState = await getLeanContractPolicy();
      if (!request.contractRevision) {
        if (config.requireContractRevision) {
          return res.status(409).json(
            rejection("LEAN_CONTRACT_REVISION_REQUIRED", "The client did not provide contractRevision.", {
              expectedContractRevision: contractState.revision,
              runId: request.runId,
              sessionId: request.sessionId,
            })
          );
        }
      } else if (request.contractRevision !== contractState.revision) {
        metrics?.recordContractMismatch?.();
        return res.status(409).json(
          rejection(
            "LEAN_CONTRACT_REVISION_MISMATCH",
            "The Lean client and server implement incompatible lean_check contracts.",
            {
              expectedContractRevision: contractState.revision,
              receivedContractRevision: request.contractRevision,
              runId: request.runId,
              sessionId: request.sessionId,
            }
          )
        );
      }

      // 4b. prompt drift — recorded, passed downstream, never a refusal.
      const promptState = getLeanPolicyState
        ? await getLeanPolicyState()
        : { loaded: false, revision: "" };
      const promptDriftDetected = Boolean(
        promptState?.revision &&
          request.promptRevision &&
          request.promptRevision !== promptState.revision
      );
      if (promptDriftDetected) metrics?.recordPromptDrift?.();
      if (!request.contractRevision) metrics?.recordLegacyRevisionRequest?.();
      const policyContext = {
        requestPromptRevision: request.promptRevision || "",
        serverPromptRevision: promptState?.revision || "",
        promptDriftDetected,
        contractRevision: contractState.revision,
        legacyClient: !request.contractRevision,
      };

      // 5. source SHA
      const sourceSha = createHash("sha256").update(request.code).digest("hex");

      // 6. reserve registry — dedup, ownership and concurrency gates.
      const reservation = runRegistry.reserve({
        sessionId: request.sessionId,
        runId: request.runId,
        sourceSha,
      });
      if (!reservation.ok) {
        return res
          .status(reservation.error.statusCode)
          .json(rejection(reservation.error.code, reservation.error.message, reservation.error.extra));
      }
      if (reservation.cached) {
        return res
          .status(reservation.entry.httpStatus || 200)
          .json(reservation.entry.result);
      }
      const entry = reservation.entry;
      reserved = true;

      // 7. preflight freshness (after reservation, so a stale preflight can
      //    never spawn outside the concurrency budget)
      const preflight = getPreflight ? await getPreflight() : null;

      // 8. execute
      const result = await executeLeanCheck(request, {
        config,
        preflight,
        abortSignal: entry.abortController.signal,
        metrics,
        logger,
        policyContext,
      });

      // 9. complete registry — the result is now owned by the session/run key
      const httpStatus = result.isError ? result.statusCode || 200 : 200;
      runRegistry.complete({
        sessionId: request.sessionId,
        runId: request.runId,
        result,
        httpStatus,
      });

      // 10. log history entry (best-effort, never blocks)
      auditStore.write(request.sessionId, request, result, { attempt: request.attempt, runId: result.runId });

      // 11. response
      return res.status(httpStatus).json(result);
    } catch (err) {
      logger?.error?.("lean_exec_error", err.message);
      // A genuine server fault: free the slot so the exact same runId can be
      // retried, and never cache an exception as a result.
      if (reserved && request) runRegistry.remove({ sessionId: request.sessionId, runId: request.runId });
      // status is set through `extra` so the classifier sees internal_error and
      // reports an infrastructure block, not a contract error.
      return res.status(500).json(
        rejection(
          "LEAN_INTERNAL_ERROR",
          err.message,
          { status: "internal_error" },
          leanMaxAttempts(config)
        )
      );
    }
  });

  // POST /inspect — lean symbol inspection (does NOT consume proof attempts)
  router.post("/inspect", async (req, res) => {
    try {
      if (!config.enabled) {
        return res.status(503).json({ error: "Lean feature is disabled." });
      }
      const { executeLeanInspect } = await import("./leanInspect.mjs");
      const body = req.body;
      if (!body || typeof body !== "object") {
        return res.status(400).json({ error: "Body must be a JSON object." });
      }
      const preflight = getPreflight ? await getPreflight() : null;
      const result = await executeLeanInspect(body, { config, preflight, logger, metrics });
      const status = result.statusCode || (result.isError ? 400 : 200);

      // log history entry (best-effort, never blocks) — mirrors /exec so every
      // inspect call leaves the same audit trail a check does (D11.1).
      // Use result.sessionId (canonical) over body.sessionId (may be undefined
      // from native C client). WP08.1 — lean.fix.000.
      const auditSessionId = result.sessionId || body.sessionId || "unknown";
      auditStore.write(auditSessionId, body, result, {
        attempt: 0,
        runId: result.runId,
      });

      return res.status(status).json(result);
    } catch (err) {
      logger?.error?.("lean_inspect_error", err.message);
      return res.status(500).json({ error: err.message });
    }
  });

  // R6 target endpoints — ownership-scoped by sessionId.

  // POST /sessions/:sessionId/runs/:runId/cancel — cancel a running check
  router.post("/sessions/:sessionId/runs/:runId/cancel", (req, res) => {
    const { sessionId, runId } = req.params;
    const out = runRegistry.cancel({ sessionId, runId });
    if (!out.found) return res.status(404).json({ error: "run not found", runId });
    res.json({ cancelled: out.cancelled, runId, ...(out.reason ? { reason: out.reason } : {}) });
  });

  // GET /sessions/:sessionId/runs/:runId — retrieve a completed result
  router.get("/sessions/:sessionId/runs/:runId", (req, res) => {
    const { sessionId, runId } = req.params;
    const entry = runRegistry.get({ sessionId, runId });
    if (!entry) return res.status(404).json({ error: "run not found", runId });
    if (entry.result) return res.json(entry.result);
    return res.status(202).json({ status: entry.status, runId });
  });

  // Deprecated legacy routes (kept for compatibility). They require the session
  // via the X-Lean-Session-Id header and always emit Deprecation headers.

  // POST /cancel/:runId
  router.post("/cancel/:runId", (req, res) => {
    const { runId } = req.params;
    const sessionId = sessionFromHeader(req, "default");
    const successor = `/api/lean/sessions/${encodeURIComponent(sessionId)}/runs/${encodeURIComponent(runId)}/cancel`;
    markDeprecated(res, successor);
    const out = runRegistry.cancel({ sessionId, runId });
    if (!out.found) return res.status(404).json({ error: "run not found", runId });
    res.json({ cancelled: out.cancelled, runId, ...(out.reason ? { reason: out.reason } : {}) });
  });

  // GET /runs/:runId
  router.get("/runs/:runId", (req, res) => {
    const { runId } = req.params;
    const sessionId = sessionFromHeader(req, "default");
    const successor = `/api/lean/sessions/${encodeURIComponent(sessionId)}/runs/${encodeURIComponent(runId)}`;
    markDeprecated(res, successor);
    const entry = runRegistry.get({ sessionId, runId });
    if (!entry) return res.status(404).json({ error: "run not found", runId });
    if (entry.result) return res.json(entry.result);
    return res.status(202).json({ status: entry.status, runId });
  });

  return router;
}
