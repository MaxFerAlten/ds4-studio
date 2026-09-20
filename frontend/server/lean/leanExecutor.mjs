// Lean 4 executor for ds4-studio
// Orchestrates validation, sandboxing, process execution, and result construction.
//
// R9 (§6.19, §R9): infrastructure failures keep sanitized evidence on disk
// instead of deleting the run directory, result.json is written atomically,
// every terminal status carries a deterministic summary, and no summary the
// model can see names a host path.

import { open, rename, writeFile } from "fs/promises";
import { resolve } from "path";
import crypto from "crypto";

import {
  validateLeanRequest,
  createLeanResultBase,
  finalizeLeanResult,
  validateLeanResult,
} from "./leanContract.mjs";
import { extractLeanTargetIdentity } from "./leanTargetIdentity.mjs";
import {
  parseLeanDiagnostics,
  summarizeLeanDiagnostics,
  detectLeanPlaceholders,
    collectLeanDeclarations,
} from "./leanDiagnostics.mjs";
import { buildLeanSandboxCommand, resolveLeanSandbox } from "./leanSandbox.mjs";
import { runBoundedProcess } from "./leanProcess.mjs";
import {
  createLeanRunDirectory,
  cleanupLeanRunDirectory,
  createLeanRunId,
  leanArtifactRelativePath,
  appendLeanProofIndex,
} from "./leanPaths.mjs";
import { leanRunEvent } from "./leanMetrics.mjs";

// Telemetry that throws is swallowed — an observability sink must never turn a
// completed check into a failure — but it is counted, so a permanently broken
// sink is visible instead of silent (§6.19).
let telemetryFailures = 0;

/** Number of telemetry emissions that threw since process start. */
export function leanTelemetryFailureCount() {
  return telemetryFailures;
}

/**
 * Execute a Lean check request.
 *
 * @param {object} request - Validated request object
 * @param {object} options - Dependency injection & runtime context
 * @returns {Promise<object>}
 */
export async function executeLeanCheck(request, options = {}) {
  const {
    config,
    preflight,
    processRunner = runBoundedProcess,
    resolveSandbox = resolveLeanSandbox,
    now = Date.now,
    logger = null,
    abortSignal = null,
    // Turn state the classifier needs to tell "failed again the same way" from
    // "failed differently": supplied by the caller's Lean turn tracker.
    orchestrationContext = {},
    // What the route resolved about policy identity (server prompt revision,
    // contract revision, legacy client). Reported in the result, never used to
    // decide whether the run happened.
    policyContext = {},
  } = options;
  const classifyContext = { ...orchestrationContext, config };

  // Run directory state, filled in once the directory exists. `fail` uses it to
  // decide between "delete the evidence" and "keep it for an operator".
  const run = { dir: null, id: "", sessionId: "" };

  /**
   * Build a contract-shaped failure, account for it, and decide the fate of the
   * run directory.
   *
   * @param {{code: string, statusCode: number, publicMessage: string, detail?: string}} error
   * @param {{category?: "infrastructure"|"lean", keepEvidence?: boolean}} [disposition]
   */
  const fail = async (error, disposition = {}) => {
    const { category = "infrastructure", keepEvidence = false } = disposition;
    const correlationId = error.correlationId || crypto.randomUUID();

    if (run.dir) {
      if (keepEvidence) {
        await writeErrorArtifact(run.dir, {
          category,
          errorCode: error.code,
          // The detail stays host-side: it can name paths and toolchain
          // internals that must not reach the model.
          detail: error.detail || error.publicMessage,
          correlationId,
          runId: run.id,
          sessionId: run.sessionId,
          at: new Date(now()).toISOString(),
        });
      } else {
        await cleanupLeanRunDirectory(run.dir);
      }
    }

    if (error.detail && typeof logger?.warn === "function") {
      logger.warn("lean_check_failed", { errorCode: error.code, correlationId, detail: error.detail });
    }

    // An internal error tells the model nothing useful, so it carries only the
    // correlation id an operator can grep for in the logs and in error.json.
    const message =
      error.statusCode === 500
        ? `${error.publicMessage} (correlation ${correlationId})`
        : error.publicMessage;

    const result = errorResult(
      {
        code: error.code,
        message,
        statusCode: error.statusCode,
        containsPlaceholders: error.containsPlaceholders,
        placeholderEvidence: error.placeholderEvidence,
        targetIdentity: error.targetIdentity,
        targetIdentityMatched: error.targetIdentityMatched,
      },
      request,
      { runId: run.id, sessionId: run.sessionId, proofId: request.proofId || "" },
      config,
      classifyContext,
      policyContext
    );
    emitLeanRunEvent(result, options);
    return result;
  };

  // Step 1: Validate request. An invalid request never creates an artifact.
  const validation = validateLeanRequest(request, config);
  if (!validation.ok) {
    return fail({
      code: validation.error.code,
      publicMessage: validation.error.message,
      statusCode: validation.error.statusCode,
    });
  }

  // Step 2: Determine profile and verify preflight
  const profile = request.profile || config.defaultProfile;
  run.sessionId = request.sessionId || "";
  if (!preflight?.profiles?.[profile]?.ok) {
    return fail({
      code: "LEAN_RUNTIME_UNAVAILABLE",
      publicMessage: `Runtime profile '${profile}' is not prepared.`,
      statusCode: 503,
    });
  }

  // Step 3: Create run directory. The run id is settled here — the result
  // contract requires it, so it must not be re-derived anywhere downstream.
  // Must satisfy sanitizeLeanRunId's format: lean-<12 hex>-<digits>-<digits>.
  const sessionId = request.sessionId || "default";
  const runId = request.runId || createLeanRunId({ now });
  run.id = runId;
  run.sessionId = sessionId;

  try {
    run.dir = await createLeanRunDirectory(config, { sessionId, runId });
  } catch (err) {
    return fail({
      code: "LEAN_INTERNAL_ERROR",
      publicMessage: "Failed to create the run directory.",
      detail: err.message,
      statusCode: 500,
    });
  }
  const runDir = run.dir;
  const fsync = config.fsyncArtifacts === true;

  // Step 4: Persist the request, then write the source.
  //
  // request.json records what was asked without the source body — the source
  // already lives verbatim in Main.lean, and duplicating it would double the
  // on-disk copies of untrusted input for no benefit.
  try {
    await writeArtifact(
      resolve(runDir, "request.json"),
      JSON.stringify(
        { ...request, code: undefined, sourceBytes: Buffer.byteLength(request.code, "utf8"), runId, sessionId },
        null,
        2
      ),
      fsync
    );
  } catch (err) {
    // Nothing diagnostic exists in the directory yet, so there is no evidence
    // worth retaining.
    return fail({
      code: "LEAN_INTERNAL_ERROR",
      publicMessage: "Failed to persist the request.",
      detail: err.message,
      statusCode: 500,
    });
  }

  const leanPath = resolve(runDir, "Main.lean");
  const sourceSha256 = crypto.createHash("sha256").update(request.code).digest("hex");
  const sourceBytes = Buffer.byteLength(request.code, "utf8");

  // Step 4b: Extract target identity for proof-mode tasks.
  // The statement fingerprint locks the theorem's declaration header so a model
  // cannot substitute a different theorem under the same name (F1.2).
  let targetIdentityResult = null;
  if (request.taskMode === "proof" && request.targetDeclaration) {
    targetIdentityResult = extractLeanTargetIdentity(request.code, request.targetDeclaration);
    // A failed extraction means the source does not contain the promised theorem
    // or uses an unsupported proof syntax — reject before spawning Lean.
    if (!targetIdentityResult.ok) {
      return fail({
        code: "LEAN_TARGET_IDENTITY_EXTRACTION_FAILED",
        publicMessage: `Cannot verify target '${request.targetDeclaration}': ${targetIdentityResult.error.message}`,
        statusCode: 422,
      });
    }
    // The locked statement is the task. A source that keeps the declaration
    // name but changes what it states is a substitution, not a repair, so it
    // is refused before Lean is spawned and without consuming an attempt.
    const identity = targetIdentityResult.value;
    if (
      request.expectedTargetStatementSha256 &&
      identity.statementSha256 !== request.expectedTargetStatementSha256
    ) {
      return fail({
        code: "LEAN_TARGET_STATEMENT_MISMATCH",
        publicMessage:
          `Target '${identity.name}' kept its name but its statement changed. ` +
          "Restore the locked statement and change only the proof body.",
        statusCode: 422,
        targetIdentity: identity,
        targetIdentityMatched: false,
      });
    }
  }

  try {
    await writeArtifact(leanPath, request.code, fsync);
  } catch (err) {
    return fail({
      code: "LEAN_INTERNAL_ERROR",
      publicMessage: "Failed to persist the Lean source.",
      detail: err.message,
      statusCode: 500,
    });
  }

  // Step 5: Candidate preflight — block sorry/admit before spawning Lean.
  // This prevents wasting sandbox compute on sources that cannot possibly verify.
  // lean_inspect never contains placeholders so this gate is harmless for it.
  const placeholderInfo = detectLeanPlaceholders(request.code);
  if (placeholderInfo.containsPlaceholders) {
    const evidence = placeholderInfo.evidence
      .filter((e) => e.placeholder)
      .map((e) => `${e.keyword} (line ${e.line})`)
      .join(", ");
    return fail(
      {
        code: "LEAN_CANDIDATE_PREFLIGHT_BLOCKED",
        publicMessage:
          `Source contains placeholder tactics (${evidence}). ` +
          "Lean check was not run. Remove sorry/admit and retry.",
        statusCode: 422,
        // The statement was already extracted: report it so the turn can lock
        // the target even though this candidate is a placeholder (§6.4).
        targetIdentity: targetIdentityResult?.ok ? targetIdentityResult.value : undefined,
        targetIdentityMatched: targetIdentityResult?.ok
          ? !request.expectedTargetStatementSha256 ||
            request.expectedTargetStatementSha256 ===
              targetIdentityResult.value.statementSha256
          : undefined,
        timedOut: false,
        cancelled: false,
        containsPlaceholders: true,
        placeholderEvidence: placeholderInfo.evidence,
      },
      { keepEvidence: true }
    );
  }

  // Step 6: Resolve the sandbox + pinned toolchain, then build the command.
  // Everything the run needs from the runtime is captured here, once: the
  // spawn must not re-read a runtime that could change under it mid-run.
  const sandbox = await resolveSandbox(config, profile);
  if (!sandbox.ok) {
    return fail(
      {
        code: sandbox.error,
        publicMessage: "The Lean sandbox is unavailable; the check was not run.",
        detail: sandbox.reason || "",
        statusCode: 503,
      },
      { keepEvidence: true }
    );
  }
  const runtimeSnapshot = Object.freeze({
    profile,
    profileDir: resolve(config.runtimeRoot, profile),
    toolchain: sandbox.toolchain,
  });

  let sandboxCmd;
  try {
    sandboxCmd = buildLeanSandboxCommand({
      config,
      profileDir: runtimeSnapshot.profileDir,
      runDir,
      toolchain: runtimeSnapshot.toolchain,
    });
  } catch (err) {
    return fail(
      {
        code: "LEAN_SANDBOX_CONFIGURATION_INVALID",
        publicMessage: "The Lean sandbox configuration is invalid; the check was not run.",
        detail: err.message,
        statusCode: 503,
      },
      { keepEvidence: true }
    );
  }

  // Step 7: Execute bounded process
  const timeoutSec = request.timeoutSec || config.defaultTimeoutSec;
  let procResult;
  try {
    procResult = await processRunner({
      command: sandboxCmd.command,
      args: sandboxCmd.args,
      cwd: sandboxCmd.cwd,
      env: sandboxCmd.env,
      timeoutMs: timeoutSec * 1000,
      stdoutLimit: config.maxStdoutBytes,
      stderrLimit: config.maxStderrBytes,
      abortSignal,
      logger,
    });
  } catch (err) {
    return fail(
      {
        code: "LEAN_PROCESS_SPAWN_FAILED",
        publicMessage: "The Lean sandbox process could not be started.",
        detail: err.message,
        statusCode: 500,
      },
      { keepEvidence: true }
    );
  }

  // Step 8: Parse diagnostics. Lean reports elaboration errors on stdout, not
  // stderr; stderr carries toolchain/Lake failures. Both are parsed so a
  // sandbox or driver problem is not silently dropped.
  const parsed = parseLeanDiagnostics(
    [procResult.stdout, procResult.stderr].filter(Boolean).join("\n"),
    { maxDiagnostics: config.maxDiagnostics }
  );
  const diagnostics = parsed.diagnostics;

  // Step 9: Determine status
  let status;
  if (procResult.timedOut) {
    status = "timeout";
  } else if (procResult.cancelled) {
    status = "cancelled";
  } else if (procResult.exitCode === 0) {
    status = "checked";
  } else {
    status = "failed";
  }

  // Step 10: Verify the declarations the caller promised. Only meaningful once
  // Lean accepted the file, so a syntax error keeps its own diagnostics.
  const declarationsObserved = collectLeanDeclarations(request.code);
  // The proof target is expected by construction: a source that does not
  // declare it must not be able to reach status=checked (§6.6).
  const expected = [...new Set([
    ...(Array.isArray(request.expectedDeclarations) ? request.expectedDeclarations : []),
    ...(request.taskMode === "proof" && request.targetDeclaration
      ? [request.targetDeclaration]
      : []),
  ])];
  const missingDeclarations =
    status === "checked" ? expected.filter((d) => !declarationsObserved.includes(d)) : [];
  if (missingDeclarations.length > 0) {
    status = "failed";
  }

  // Step 11: Build result
  const summary =
    missingDeclarations.length > 0
      ? `Lean elaboration completed, but expected declarations are missing: ${missingDeclarations.join(", ")}.`
      : summarizeLeanDiagnostics(diagnostics, status, { timeoutSec, exitCode: procResult.exitCode });

  const result = createLeanResultBase(
    request,
    { runId, sessionId, proofId: request.proofId || "" },
    config,
    policyContext
  );

  Object.assign(result, {
    status,
    profile,
    toolchain: runtimeSnapshot.toolchain.descriptor,
    exitCode: procResult.exitCode,
    signal: procResult.signal,
    timedOut: procResult.timedOut,
    cancelled: procResult.cancelled,
    durationMs: procResult.durationMs,
    attemptConsumed: true,
    diagnostics,
    summary,
    stdout: procResult.stdout,
    stderr: procResult.stderr,
    sourceArtifact: {
      relativePath: leanArtifactRelativePath(sessionId, runId, "Main.lean"),
      sha256: sourceSha256,
      bytes: sourceBytes,
    },
    // Target identity — locks the theorem declaration header so a model cannot
    // substitute a different theorem under the same name (F1.2).
    taskMode: request.taskMode || "utility",
    targetDeclaration: request.targetDeclaration || null,
    targetIdentityAlgorithm:
      targetIdentityResult?.ok ? targetIdentityResult.value.algorithm : null,
    targetStatementSha256:
      targetIdentityResult?.ok ? targetIdentityResult.value.statementSha256 : null,
    targetIdentityMatched:
      request.taskMode === "proof"
        ? Boolean(targetIdentityResult?.ok) &&
          (!request.expectedTargetStatementSha256 ||
            request.expectedTargetStatementSha256 ===
              targetIdentityResult.value.statementSha256)
        : null,
    sourceSha256,
    containsPlaceholders: placeholderInfo.containsPlaceholders,
    placeholderEvidence: placeholderInfo.evidence,
    expectedDeclarations: expected,
    declarationsObserved,
    certified: false,
    certificationReason: "MVP performs elaboration only.",
    truncated: {
      stdout: procResult.stdoutTruncated,
      stderr: procResult.stderrTruncated,
      diagnostics: parsed.truncated,
    },
  });
  if (missingDeclarations.length > 0) {
    result.errorCode = "LEAN_DECLARATION_MISSING";
  }

  finalizeLeanResult(result, classifyContext);

  // Step 12: Validate result
  const rv = validateLeanResult(result);
  if (!rv.ok) {
    return fail(
      {
        code: "LEAN_RESULT_CONTRACT_INVALID",
        publicMessage: "The Lean result failed contract validation.",
        detail: rv.errors.join(", "),
        statusCode: 500,
      },
      { keepEvidence: true }
    );
  }

  emitLeanRunEvent(result, options);

  // Step 13: Write result.json atomically — a reader must never observe a
  // half-written result, and a rerun must never overwrite one.
  try {
    const tmpPath = resolve(runDir, "result.json.tmp");
    await writeFile(tmpPath, JSON.stringify(result, null, 2), { flag: "wx", mode: 0o600 });
    await rename(tmpPath, resolve(runDir, "result.json"));
  } catch (err) {
    // Non-fatal — the result is already computed and returned.
    logger?.warn?.("lean_result_persist_failed", { runId, message: err.message });
  }

  // Step 14: group this attempt under its proof task. Also non-fatal.
  if (request.proofId) {
    try {
      await appendLeanProofIndex(config, {
        sessionId,
        proofId: request.proofId,
        runId,
        attempt: request.attempt || 1,
        status: result.status,
        sourceSha256,
      });
    } catch (err) {
      logger?.warn?.("lean_proof_index_failed", { runId, message: err.message });
    }
  }

  return result;
}

/**
 * Write a run artifact, optionally flushing it to disk before the sandbox is
 * spawned (audit-grade deployments; costs one fsync per file).
 */
async function writeArtifact(path, data, fsync) {
  if (!fsync) {
    await writeFile(path, data, { flag: "wx", mode: 0o600 });
    return;
  }
  const handle = await open(path, "wx", 0o600);
  try {
    await handle.writeFile(data);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

/**
 * Record why a run died before producing a result. Read back by the retention
 * sweep, which keeps infrastructure evidence longer than ordinary runs.
 */
async function writeErrorArtifact(runDir, payload) {
  try {
    await writeFile(
      resolve(runDir, "error.json"),
      JSON.stringify({ schemaVersion: 1, ...payload }, null, 2),
      { flag: "wx", mode: 0o600 }
    );
  } catch {
    // Best effort: the run already failed, and losing the note must not
    // change what the caller is told.
  }
}

/**
 * Emit the observability event for a finished run. Never throws: telemetry
 * must not be able to turn a completed check into a failure.
 */
function emitLeanRunEvent(result, options) {
  try {
    const event = leanRunEvent(result);
    options.metrics?.record?.(event);
    if (typeof options.logger?.info === "function") options.logger.info("lean_check", event);
  } catch {
    telemetryFailures += 1;
  }
}

/** Map an HTTP-ish status code onto one of the contract's failure states. */
function errorStatus(statusCode) {
  if (statusCode === 503) return "preflight_failed";
  if (statusCode === 500) return "internal_error";
  return "rejected";
}

function errorResult(error, request, metadata, config, classifyContext = {}, policyContext = {}) {
  const base = createLeanResultBase(request, metadata, config, policyContext);
  Object.assign(base, {
    status: errorStatus(error.statusCode),
    isError: true,
    errorCode: error.code,
    statusCode: error.statusCode,
    summary: `${error.code}: ${error.message}`,
    certified: false,
  });
  // Preserved for preflight blocks: the base default (false/[]) would
  // otherwise hide the exact evidence that caused the block.
  if (error.containsPlaceholders) {
    base.containsPlaceholders = true;
    base.placeholderEvidence = error.placeholderEvidence || [];
  }
  // A rejected proof still reports the statement it was about, so the tracker
  // can lock the target even when the candidate never reached Lean (§6.4).
  if (error.targetIdentity) {
    base.targetDeclaration = error.targetIdentity.name;
    base.targetIdentityAlgorithm = error.targetIdentity.algorithm;
    base.targetStatementSha256 = error.targetIdentity.statementSha256;
    base.targetIdentityMatched = error.targetIdentityMatched === true;
  }
  finalizeLeanResult(base, classifyContext);
  return base;
}
