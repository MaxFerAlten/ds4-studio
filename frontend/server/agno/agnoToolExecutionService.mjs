/**
 * Orchestrating service for a single Agno tool-bridge invocation.
 *
 * Wires together the pieces built in prior tasks — AgnoToolPolicy (allow/
 * deny + per-tool metadata), AgnoToolGate (concurrency lease),
 * AgnoToolSessionRegistry (per-(sessionId,runId) state), AgnoExecutionGuard
 * (native-agent/server-mode guard) — plus the existing OpenAI-facing tool
 * catalog/schema/dispatcher (agentToolCatalog.mjs, agentToolSchema.mjs,
 * agentTools.mjs) that already implement the actual tool behavior. This
 * class does not reimplement any tool's policy (PageAgent queueing, Sage's
 * authoritative executor, etc.) — it only validates, gates, guards, and
 * post-processes around a call to the existing `executeTool()`.
 *
 * Not yet wired to HTTP — that's the tool-execution bridge (a later task).
 */
import { getAgentToolDefinition } from "../agentToolCatalog.mjs";
import { validateToolArguments } from "../agentToolSchema.mjs";
import { executeTool, checkBashFileReadFallback, sageSessionDir } from "../agentTools.mjs";
import {
  checkPostGitnexusAnalyzeAction,
  recordGitnexusAnalyzeResult
} from "../agentGitnexusPolicy.mjs";
import { compressToolResultForModel } from "../toolOutputCompressor.mjs";

// Large/streamable tool outputs worth live-zone compression before handing
// them back to the model. Mirrors §15.5 of the task-9 brief; deliberately
// excludes write/edit/page_action/page_task (their results are already
// short/bounded) and applies only to non-error results (see normalizeResult).
const COMPRESSIBLE_TOOLS = new Set([
  "bash",
  "read",
  "search",
  "web_search",
  "web_read",
  "crawl",
  "research_discover",
  "sage"
]);

const REDACT_KEY_RE = /token|secret|password|apikey|credential/i;
const DROP_KEY_NAMES = new Set(["env", "environment"]);
const SANITIZE_MAX_DEPTH = 4;
const SANITIZE_MAX_FANOUT = 50;
const SANITIZE_MAX_STRING_LENGTH = 4000;

export class AgnoToolExecutionError extends Error {
  constructor(code, status, message) {
    super(message);
    this.name = "AgnoToolExecutionError";
    this.code = code;
    this.status = status;
  }
}

function serviceError(code, status, message) {
  return new AgnoToolExecutionError(code, status, message);
}

/**
 * Combine N AbortSignals into one. Filters out null/undefined; uses
 * AbortSignal.any() when available; falls back to the first defined signal
 * when it isn't (older Node without AbortSignal.any).
 * (No `anySignal` helper exists in this repo — see structuredModelClient.mjs's
 * `timeoutSignal()` for the two-signal precedent this generalizes.)
 */
export function combineSignals(signals) {
  const defined = (signals || []).filter(Boolean);
  if (defined.length === 0) return undefined;
  if (defined.length === 1) return defined[0];
  if (typeof AbortSignal.any === "function") return AbortSignal.any(defined);
  return defined[0];
}

function isDangerousValue(value) {
  return (
    Buffer.isBuffer(value) ||
    value instanceof Error ||
    value instanceof AbortController ||
    value instanceof AbortSignal ||
    typeof value === "function"
  );
}

/**
 * Defense-in-depth scrub of a tool result's optional `.raw` field before it
 * is sent to the model/Python side. Not a strict schema — an allowlist-style
 * best effort covering: token/secret-looking keys (redacted, not recursed
 * into), env/environment keys (dropped), Buffers/Errors (carry stack
 * traces)/AbortController/AbortSignal/functions (dropped), plus bounded
 * recursion depth and array/object fan-out so a huge manifest can't blow up
 * the response.
 */
export function sanitizeToolRaw(raw, depth = 0) {
  if (raw === null || raw === undefined) return raw;

  if (typeof raw === "string") {
    return raw.length > SANITIZE_MAX_STRING_LENGTH
      ? `${raw.slice(0, SANITIZE_MAX_STRING_LENGTH)}...[truncated]`
      : raw;
  }

  if (typeof raw === "number" || typeof raw === "boolean") return raw;

  if (isDangerousValue(raw)) return "[redacted]";

  if (depth >= SANITIZE_MAX_DEPTH) return "[truncated: max depth]";

  if (Array.isArray(raw)) {
    const items = raw.slice(0, SANITIZE_MAX_FANOUT).map((item) => sanitizeToolRaw(item, depth + 1));
    if (raw.length > SANITIZE_MAX_FANOUT) items.push(`[truncated: ${raw.length - SANITIZE_MAX_FANOUT} more]`);
    return items;
  }

  if (typeof raw === "object") {
    const out = {};
    const keys = Object.keys(raw);
    for (const key of keys.slice(0, SANITIZE_MAX_FANOUT)) {
      if (DROP_KEY_NAMES.has(key)) continue;
      if (REDACT_KEY_RE.test(key)) {
        out[key] = "[redacted]";
        continue;
      }
      const value = raw[key];
      if (isDangerousValue(value)) continue;
      out[key] = sanitizeToolRaw(value, depth + 1);
    }
    if (keys.length > SANITIZE_MAX_FANOUT) {
      out.__truncated = `[truncated: ${keys.length - SANITIZE_MAX_FANOUT} more keys]`;
    }
    return out;
  }

  return raw;
}

export class AgnoToolExecutionService {
  constructor({
    policy,
    gate,
    sessionRegistry,
    executionGuard,
    workspaceRoot,
    toolBlobStore,
    sageCallLog,
    researchService,
    crawlBaseUrl,
    crawlToken,
    audit,
    executeToolImpl = executeTool,
    compressImpl = compressToolResultForModel
  }) {
    this.policy = policy;
    this.gate = gate;
    this.sessionRegistry = sessionRegistry;
    this.executionGuard = executionGuard;
    this.workspaceRoot = workspaceRoot;
    this.toolBlobStore = toolBlobStore;
    this.sageCallLog = sageCallLog;
    this.researchService = researchService;
    this.crawlBaseUrl = crawlBaseUrl;
    this.crawlToken = crawlToken;
    this.audit = audit;
    this.executeToolImpl = executeToolImpl;
    this.compressImpl = compressImpl;
  }

  /**
   * @param {object} request
   * @param {string} request.toolName
   * @param {object} [request.arguments]
   * @param {string} request.callId
   * @param {object} [request.context] - {sessionId, runId, userId, history}
   * @param {{signal?: AbortSignal}} [opts]
   */
  async execute(request, { signal } = {}) {
    const startedAt = performance.now();

    const definition = getAgentToolDefinition(request.toolName);
    if (!definition) {
      throw serviceError("UNKNOWN_TOOL", 404, `Unknown tool: ${request.toolName}`);
    }

    // Throws AgnoToolPolicyError when disabled/unknown/not-allowed.
    const metadata = this.policy.assertAllowed(request.toolName);

    // Throws ToolArgumentValidationError on schema mismatch.
    const args = validateToolArguments(
      definition.function.parameters,
      request.arguments || {},
      { rejectUnknown: true }
    );

    // Throws AgnoExecutionGuardError when the native agent is active / the
    // wrapper can't be confirmed in server mode. Runs before any session or
    // gate state is touched, so a blocked call leaves nothing to clean up.
    await this.executionGuard.ensureModelCallAllowed();

    const session = this.sessionRegistry.getOrCreate(request.context || {});
    session.activeToolCalls.add(request.callId);

    let lease = null;
    try {
      const combinedSignal = combineSignals([
        signal,
        session.controller.signal,
        AbortSignal.timeout(metadata.maxTimeoutMs)
      ]);

      lease = await this.gate.acquire({ signal: combinedSignal });

      const options = this.buildOptions({
        toolName: request.toolName,
        args,
        session,
        signal: combinedSignal
      });

      const policyBlock = await this.preflightPolicy({
        toolName: request.toolName,
        args,
        session
      });
      if (policyBlock) {
        const blocked = {
          ok: false,
          toolName: request.toolName,
          content: policyBlock.content,
          isError: true,
          guarded: true,
          compressed: false,
          code: policyBlock.code,
          raw: null,
          durationMs: performance.now() - startedAt
        };
        await this.safeAudit({
          type: "tool_blocked",
          toolName: request.toolName,
          sessionId: session.sessionId,
          runId: session.runId,
          args,
          isError: true,
          guarded: true,
          code: blocked.code,
          content: blocked.content,
          durationMs: blocked.durationMs
        });
        return blocked;
      }

      const rawResult = await this.executeToolImpl(request.toolName, args, options);

      recordGitnexusAnalyzeResult(
        { tool: request.toolName, args },
        rawResult,
        session.gitnexusPolicyState
      );

      const result = await this.normalizeResult(request.toolName, rawResult);
      result.durationMs = performance.now() - startedAt;

      await this.safeAudit({
        toolName: request.toolName,
        sessionId: session.sessionId,
        runId: session.runId,
        args,
        isError: result.isError,
        guarded: result.guarded,
        content: result.content,
        durationMs: result.durationMs
      });

      return result;
    } finally {
      lease?.release();
      session.activeToolCalls.delete(request.callId);
    }
  }

  /**
   * Audit writes must never change a tool call's outcome — a disk-full audit
   * writer shouldn't turn an already-completed write/edit/bash side effect
   * into a rejected execute() call. Log and swallow instead of propagating.
   */
  async safeAudit(record) {
    try {
      await this.audit.write(record);
    } catch (err) {
      console.error("agno-tool-execution: audit write failed", err);
    }
  }

  buildOptions({ toolName, args, session, signal }) {
    const base = {
      cwd: this.workspaceRoot,
      signal,
      sessionKey: session.sessionId,
      history: session.history
    };

    switch (toolName) {
      case "crawl":
        return {
          ...base,
          crawlBaseUrl: this.crawlBaseUrl,
          crawlToken: this.crawlToken
        };

      case "research_discover":
        return {
          ...base,
          researchService: this.researchService
        };

      case "retrieve_context_blob":
        return {
          ...base,
          toolBlobStore: this.toolBlobStore
        };

      case "sage":
        return {
          ...base,
          sageCallLog: this.sageCallLog,
          toolBlobStore: this.toolBlobStore,
          sageWorkdir: sageSessionDir(this.workspaceRoot, session.sessionId),
          runId: session.runId,
          sageAttempt: 1
        };

      default:
        return base;
    }
  }

  /**
   * Shared preflight checks applied before executeTool() runs. Returns a
   * synthetic guarded/isError tool-result object (matching §15.4 of the
   * task-9 brief) when blocked, or null/undefined to proceed.
   *
   * Order mirrors the real native-agent loop (frontend/server/index.mjs):
   * GitNexus post-analyze check first, then the bash read-bypass guard.
   */
  async preflightPolicy({ toolName, args, session }) {
    if (!session.gitnexusPolicyState) {
      session.gitnexusPolicyState = { gitnexusAnalyzeSeen: false };
    }

    const decision = checkPostGitnexusAnalyzeAction(
      {
        tool: toolName,
        target: args.path || args.command || "",
        args
      },
      session.gitnexusPolicyState
    );

    if (decision?.block) {
      return {
        content: `[${decision.type}]\n${decision.reason}\n${decision.guidance}`,
        isError: true,
        guarded: true,
        code: decision.type || "GITNEXUS_POLICY_BLOCKED"
      };
    }

    if (toolName === "bash") {
      const block = checkBashFileReadFallback(args, false);
      if (block?.block) {
        return {
          content: block.reason,
          isError: true,
          guarded: true,
          code: "BASH_FILE_READ_BYPASS_BLOCKED"
        };
      }
    }

    return null;
  }

  /**
   * Compress (when applicable) and sanitize a raw executeTool() result into
   * the stable response envelope from §15.6 of the task-9 brief. durationMs
   * is left null here — execute() fills it in with the full call duration.
   */
  async normalizeResult(toolName, rawResult) {
    let result = rawResult;
    if (!rawResult?.isError && COMPRESSIBLE_TOOLS.has(toolName)) {
      result = await this.compressImpl(toolName, rawResult, this.toolBlobStore);
    }

    return {
      ok: !result?.isError,
      toolName,
      content: String(result?.content || ""),
      isError: Boolean(result?.isError),
      guarded: Boolean(result?.guarded),
      compressed: Boolean(result?.compressed),
      code: result?.code || null,
      raw: sanitizeToolRaw(result?.raw),
      durationMs: null
    };
  }
}
