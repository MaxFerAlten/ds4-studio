// Lean 4 symbol inspection tool for ds4-studio
// Server-side generates #check source; no arbitrary code from the model.
// Does NOT increment proof attempts, does NOT set verified, does NOT touch
// the LeanTurnTracker. Budget: max 4 inspect per user task, 30s each.
//
// WP01.1 — Canonical result builder (lean.fix.000).
// All return paths go through inspectResult() so the native C parser
// always sees the same camelCase contract fields: status, errorCode,
// sourceSha256, durationMs, timedOut, displayText, runId, sessionId.

import crypto from "crypto";
import { resolve } from "path";

import {
  LEAN_PROFILES,
  LEAN_MAX_STDOUT_BYTES,
  LEAN_MAX_STDERR_BYTES,
  LEAN_INSPECT_RESULT_CONTRACT,
  LEAN_INSPECT_DEFAULT_TIMEOUT_SEC,
  LEAN_INSPECT_MAX_TIMEOUT_SEC,
} from "./leanConstants.mjs";
import { buildLeanSandboxCommand, resolveLeanSandbox } from "./leanSandbox.mjs";
import { runBoundedProcess } from "./leanProcess.mjs";
import { createLeanRunDirectory, cleanupLeanRunDirectory, createLeanRunId } from "./leanPaths.mjs";

/** Maximum inspect calls per user turn. */
export const LEAN_INSPECT_MAX_PER_TASK = 4;
/** Per-inspect timeout in seconds (must match LEAN_INSPECT_DEFAULT_TIMEOUT_SEC). */
export const LEAN_INSPECT_TIMEOUT_SEC = LEAN_INSPECT_DEFAULT_TIMEOUT_SEC;

// --- Input validation --------------------------------------------------------

/** Lean module path: dot-separated identifiers, e.g. Mathlib.Topology.Basic */
const MODULE_RE = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/;
/**
 * Lean symbol name: identifiers, operators, or dotted names, plus common
 * Unicode math symbols that appear in Lean/Mathlib (Greek letters, ℝ, →, ∀,
 * etc.) and trailing sub/superscripts.
 */
const SYMBOL_RE = /^[A-Za-z0-9αβγδεζηθικλμνξοπρστυφχψωΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩℝ→∀∃∈≠≤≥⟨⟩λ⊤⊥·∘]+[A-Za-z0-9_.'³²¹⁻]*$/u;

/** Characters that must never appear in a single module or symbol field. */
const INJECTION_CHARS = /[\n\r;#]/;

/**
 * Validate a single module path string.
 * @param {string} m
 * @returns {{ ok: boolean, error?: string }}
 */
export function validateModule(m) {
  if (typeof m !== "string" || m.length === 0) return { ok: false, error: "empty module" };
  if (m.length > 128) return { ok: false, error: "module path too long" };
  if (INJECTION_CHARS.test(m)) return { ok: false, error: "forbidden character in module" };
  if (/^(Lean|init|_)/.test(m)) return { ok: false, error: "reserved module prefix" };
  if (!MODULE_RE.test(m)) return { ok: false, error: "invalid module syntax" };
  return { ok: true };
}

/**
 * Validate a single symbol name string.
 * @param {string} s
 * @returns {{ ok: boolean, error?: string }}
 */
export function validateSymbol(s) {
  if (typeof s !== "string" || s.length === 0) return { ok: false, error: "empty symbol" };
  if (s.length > 128) return { ok: false, error: "symbol too long" };
  if (INJECTION_CHARS.test(s)) return { ok: false, error: "forbidden character in symbol" };
  if (!SYMBOL_RE.test(s)) {
    return { ok: false, error: "invalid symbol syntax" };
  }
  return { ok: true };
}

/**
 * Validate a full inspect request body.
 * @param {object} body
 * @returns {{ ok: boolean, error?: { code: string, message: string, statusCode: number } }}
 */
export function validateInspectRequest(body) {
  if (!body || typeof body !== "object") {
    return { ok: false, error: { code: "LEAN_INSPECT_INVALID", message: "Body must be a JSON object.", statusCode: 400 } };
  }
  if (!Array.isArray(body.symbols) || body.symbols.length === 0) {
    return { ok: false, error: { code: "LEAN_INSPECT_SYMBOLS_REQUIRED", message: "'symbols' must be a non-empty array.", statusCode: 422 } };
  }
  if (body.symbols.length > 16) {
    return { ok: false, error: { code: "LEAN_INSPECT_SYMBOLS_LIMIT", message: "Maximum 16 symbols per inspect.", statusCode: 422 } };
  }
  for (const s of body.symbols) {
    const v = validateSymbol(s);
    if (!v.ok) return { ok: false, error: { code: "LEAN_INSPECT_SYMBOL_INVALID", message: `Invalid symbol '${s}': ${v.error}.`, statusCode: 422 } };
  }
  if (body.imports) {
    if (!Array.isArray(body.imports) || body.imports.length > 8) {
      return { ok: false, error: { code: "LEAN_INSPECT_IMPORTS_INVALID", message: "'imports' must be an array of max 8 items.", statusCode: 422 } };
    }
    for (const m of body.imports) {
      const v = validateModule(m);
      if (!v.ok) return { ok: false, error: { code: "LEAN_INSPECT_IMPORT_INVALID", message: `Invalid import '${m}': ${v.error}.`, statusCode: 422 } };
    }
  }
  if (body.profile && !LEAN_PROFILES.includes(body.profile)) {
    return { ok: false, error: { code: "LEAN_INSPECT_PROFILE_INVALID", message: `Profile '${body.profile}' not supported.`, statusCode: 422 } };
  }
  if (body.timeout_sec !== undefined) {
    const t = Number(body.timeout_sec);
    if (!Number.isInteger(t) || t < 1 || t > LEAN_INSPECT_MAX_TIMEOUT_SEC) {
      return { ok: false, error: { code: "LEAN_INSPECT_TIMEOUT_INVALID", message: `timeout_sec must be an integer 1-${LEAN_INSPECT_MAX_TIMEOUT_SEC}.`, statusCode: 422 } };
    }
  }
  return { ok: true };
}

// --- Canonical result builder -------------------------------------------------

/**
 * Render a model-facing displayText for an inspect result.
 * WP01.3 — flat text the native C parser can read without JSON array parsing.
 */
function renderInspectDisplay(symbols, { status, errorCode, message, timedOut, processStarted, nextAction, retried }) {
  const lines = ["LEAN_INSPECT"];
  lines.push(`status=${status}`);
  if (errorCode) lines.push(`errorCode=${errorCode}`);
  if (message) lines.push(`message=${message}`);
  if (processStarted !== undefined) lines.push(`processStarted=${processStarted}`);
  if (timedOut) lines.push(`timedOut=true`);
  if (nextAction) lines.push(`nextAction=${nextAction}`);
  if (retried) lines.push(`retried=true`);
  if (Array.isArray(symbols) && symbols.length > 0) {
    for (const s of symbols) {
      lines.push(`${s.name}: ${s.output}`);
    }
  }
  return lines.join("\n");
}

/**
 * Build a canonical lean_inspect result object.
 * WP01.1 — single source of truth; every return path goes through here.
 *
 * Adopts v1 contract version for backward compat with the native C parser.
 * camelCase fields are primary; legacy snake_case aliases are additive.
 *
 * @param {object} opts
 * @param {string} opts.status - "inspected" | "timeout" | "rejected" | "preflight_failed" | "internal_error"
 * @param {string} [opts.profile]
 * @param {string} [opts.errorCode]
 * @param {string} [opts.message]
 * @param {number} [opts.statusCode]
 * @param {string} [opts.runId]
 * @param {string} [opts.sessionId]
 * @param {Array} [opts.symbols]
 * @param {string} [opts.sourceSha256]
 * @param {number} [opts.durationMs]
 * @param {boolean} [opts.timedOut]
 * @param {boolean} [opts.processStarted]
 * @param {string} [opts.nextAction]
 * @returns {object} Canonical inspect result
 */
export function inspectResult(opts = {}) {
  const {
    status = "internal_error",
    profile = null,
    errorCode = null,
    message = "",
    statusCode = 200,
    runId = null,
    sessionId = null,
    symbols = [],
    sourceSha256 = null,
    durationMs = 0,
    timedOut = false,
    processStarted = false,
    nextAction = null,
    retried = false,
  } = opts;

  return {
    contractVersion: LEAN_INSPECT_RESULT_CONTRACT,
    tool: "lean_inspect",
    status,
    isError: status !== "inspected",
    errorCode,
    message,
    profile,
    symbols,
    displayText: renderInspectDisplay(symbols, {
      status, errorCode, message, timedOut, processStarted, nextAction, retried,
    }),
    runId,
    sessionId,
    sourceSha256,
    durationMs,
    timedOut,
    processStarted,
    retried,
    // INV-LEAN-002: inspect NEVER consumes attempts or verifies.
    attemptConsumed: false,
    verified: false,
    // Legacy snake_case aliases (additive, non-breaking).
    source_sha256: sourceSha256,
    duration_ms: durationMs,
    timed_out: timedOut,
    ...(nextAction ? { nextAction } : {}),
    ...(statusCode !== 200 ? { statusCode } : {}),
  };
}

// --- Source generation -------------------------------------------------------

/**
 * Generate Lean source for #check inspection.
 * The model never provides arbitrary code — only module and symbol names.
 *
 * @param {{ imports?: string[], symbols: string[] }} body
 * @returns {string} Lean 4 source
 */
export function generateInspectSource(body) {
  const imports = (body.imports || []).map(m => `import ${m}`);
  const checks = body.symbols.map(s => `#check ${s}`);
  return [...imports, "", ...checks, ""].join("\n");
}

// --- Execution ---------------------------------------------------------------

/**
 * Execute a lean_inspect call.
 *
 * @param {object} body - Parsed JSON request body
 * @param {object} options
 * @param {object} options.config - Lean config (runtimeRoot, etc.)
 * @param {object} [options.preflight] - Preflight report
 * @param {object} [options.logger]
 * @param {AbortSignal} [options.abortSignal]
 * @param {Function} [options.processRunner]
 * @param {Function} [options.resolveSandbox]
 * @returns {Promise<object>} Inspect result
 */
export async function executeLeanInspect(body, options = {}) {
  const {
    config,
    preflight,
    logger = null,
    abortSignal = null,
    processRunner = runBoundedProcess,
    resolveSandbox = resolveLeanSandbox,
    metrics = null,
  } = options;

  const validation = validateInspectRequest(body);
  if (!validation.ok) {
    const result = inspectResult({
      status: "rejected",
      errorCode: validation.error.code,
      message: validation.error.message,
      statusCode: validation.error.statusCode,
    });
    metrics?.recordInspect?.({ type: "lean_inspect", status: "rejected", durationMs: 0 });
    return result;
  }

  const profile = body.profile || config.defaultProfile || "core";
  if (!preflight?.profiles?.[profile]?.ok) {
    const result = inspectResult({
      status: "preflight_failed",
      profile,
      errorCode: "LEAN_INSPECT_RUNTIME_UNAVAILABLE",
      message: `Runtime profile '${profile}' is not prepared.`,
      statusCode: 503,
    });
    metrics?.recordInspect?.({ type: "lean_inspect", status: "preflight_failed", profile, durationMs: 0 });
    return result;
  }

  const source = generateInspectSource(body);
  const sourceSha256 = crypto.createHash("sha256").update(source).digest("hex");

  // Create a temporary run directory for the inspect.
  // Must match RUN_ID_RE (see leanPaths.mjs) — createLeanRunId is the only
  // producer every caller (route, agent bridge, native client) is required
  // to share, so inspect can't drift into a rejected format again.
  const runId = createLeanRunId();
  const sessionId = body.sessionId || `inspect-${Date.now()}`;
  let runDir;
  try {
    runDir = await createLeanRunDirectory(config, { sessionId, runId });
  } catch (err) {
    const result = inspectResult({
      status: "internal_error",
      profile,
      errorCode: "LEAN_INSPECT_INTERNAL_ERROR",
      message: "Failed to create inspect run directory.",
      statusCode: 500,
      runId,
      sessionId,
    });
    metrics?.recordInspect?.({ type: "lean_inspect", status: "error", profile, durationMs: 0 });
    return result;
  }

  try {
    // Write source
    const { writeFile } = await import("fs/promises");
    await writeFile(resolve(runDir, "Main.lean"), source, "utf-8");

    // Resolve sandbox
    const sandbox = await resolveSandbox(config, profile);
    if (!sandbox.ok) {
      const result = inspectResult({
        status: "preflight_failed",
        profile,
        errorCode: "LEAN_INSPECT_SANDBOX_UNAVAILABLE",
        message: "Lean sandbox unavailable for inspect.",
        statusCode: 503,
        runId,
        sessionId,
        sourceSha256,
      });
      metrics?.recordInspect?.({ type: "lean_inspect", status: "preflight_failed", profile, durationMs: 0 });
      return result;
    }

    const sandboxCmd = buildLeanSandboxCommand({
      config,
      profileDir: resolve(config.runtimeRoot, profile),
      runDir,
      toolchain: sandbox.toolchain,
    });

    const timeoutSec = Math.min(Number(body.timeout_sec) || LEAN_INSPECT_TIMEOUT_SEC, LEAN_INSPECT_MAX_TIMEOUT_SEC);

    // WP03.4 — bounded retry: when status=timeout, automatically retry once
    // with escalated timeout. Escalation: T → min(max(2*T, 60), MAX).
    // Only one retry per call; if the retry also times out, return as-is.
    let procResult = await processRunner({
      command: sandboxCmd.command,
      args: sandboxCmd.args,
      cwd: sandboxCmd.cwd,
      env: sandboxCmd.env,
      timeoutMs: timeoutSec * 1000,
      stdoutLimit: LEAN_MAX_STDOUT_BYTES,
      stderrLimit: LEAN_MAX_STDERR_BYTES,
      abortSignal,
      logger,
    });

    if (procResult.timedOut) {
      const escalated = Math.min(Math.max(timeoutSec * 2, 60), LEAN_INSPECT_MAX_TIMEOUT_SEC);
      if (escalated > timeoutSec) {
        procResult = await processRunner({
          command: sandboxCmd.command,
          args: sandboxCmd.args,
          cwd: sandboxCmd.cwd,
          env: sandboxCmd.env,
          timeoutMs: escalated * 1000,
          stdoutLimit: LEAN_MAX_STDOUT_BYTES,
          stderrLimit: LEAN_MAX_STDERR_BYTES,
          abortSignal,
          logger,
        });
      }
    }

    // Parse #check output lines from stdout.
    const outputLines = procResult.stdout
      ? procResult.stdout.split("\n").filter(l => l.trim())
      : [];

    const symbols = body.symbols.map((name, i) => {
      // Lean prints "<name> : <type>" on stdout for #check.
      // Match name followed by space/colon to avoid substring collisions
      // (WP10: Nat.add vs Nat.add_comm).
      const line = outputLines.find(l => {
        const trimmed = l.trimStart();
        return trimmed === name || trimmed.startsWith(name + " ") || trimmed.startsWith(name + "\t") || trimmed.startsWith(name + " :");
      });
      return {
        name,
        output: line || (procResult.timedOut ? "[timed out]" : "[no output]"),
      };
    });

    const status = procResult.timedOut ? "timeout" : procResult.exitCode === 0 ? "inspected" : "error";
    const nextAction = procResult.timedOut ? "retry_discovery_with_extended_timeout" : null;

    const firstAttemptTimedOut = procResult.timedOut && procResult.durationMs >= timeoutSec * 1000 * 0.9;
    const retried = firstAttemptTimedOut && procResult.durationMs > timeoutSec * 1000;

    const result = inspectResult({
      status,
      profile,
      symbols,
      sourceSha256,
      durationMs: procResult.durationMs || 0,
      timedOut: procResult.timedOut,
      processStarted: true,
      runId,
      sessionId,
      nextAction,
      retried,
    });

    metrics?.recordInspect?.({
      type: "lean_inspect",
      status,
      profile,
      durationMs: procResult.durationMs || 0,
      symbolCount: symbols.length,
      retried,
    });

    return result;
  } finally {
    try { await cleanupLeanRunDirectory(runDir); } catch (_) { /* best-effort */ }
  }
}
