// Lean 4 request/result contract validation for ds4-studio
// Pure functions — no Express dependency.

import { hashLeanTargetStatement } from "./leanTaskSpec.mjs";
import {
  LEAN_REQUEST_CONTRACT,
  LEAN_RESULT_CONTRACT,
  LEAN_MAX_SOURCE_BYTES,
  LEAN_PROFILES,
  LEAN_MODES,
} from "./leanConstants.mjs";
import {
  sanitizeLeanSessionId,
  sanitizeLeanRunId,
  createLeanRunId,
  sanitizeLeanProofId,
  createLeanProofId,
} from "./leanPaths.mjs";
import { LEAN_ORCHESTRATION_DEFAULTS } from "./leanOrchestrationConfig.mjs";
import { classifyLeanResult } from "./leanRepairPolicy.mjs";

/**
 * The attempt ceiling in force for a given config. A config that predates the
 * orchestration block falls back to the shared policy default, never to a
 * literal — the C side is generated from the same number.
 */
export function leanMaxAttempts(config) {
  const n = config?.orchestration?.maxAttempts;
  return Number.isInteger(n) ? n : LEAN_ORCHESTRATION_DEFAULTS.maxAttempts;
}

/** A prompt revision: SHA-1 of the Lean policy text injected into a session. */
const HEX40 = /^[a-f0-9]{40}$/;
/** A contract revision: SHA-256 of the canonical lean_check protocol spec. */
const HEX64 = /^[a-f0-9]{64}$/;

/** The policy bundles a session can be primed with. */
export const LEAN_POLICY_MODES = Object.freeze(["base", "autonomous"]);

/**
 * Validate a Lean check request.
 *
 * @param {object} input - Parsed JSON body
 * @param {object} config - Lean configuration
 * @returns {{ ok: boolean, error?: object }}
 */
export function validateLeanRequest(input, config) {
  if (!input || typeof input !== "object") {
    return errorResult("LEAN_REQUEST_INVALID", "Request body must be a JSON object.", 400);
  }

  // contractVersion
  if (input.contractVersion !== LEAN_REQUEST_CONTRACT) {
    return errorResult(
      "LEAN_REQUEST_CONTRACT_UNSUPPORTED",
      `Unsupported contract version: ${input.contractVersion}. Expected ${LEAN_REQUEST_CONTRACT}.`,
      400
    );
  }

  // code
  if (!input.code || typeof input.code !== "string" || input.code.trim().length === 0) {
    return errorResult("LEAN_CODE_REQUIRED", "Field 'code' is required and must be a non-empty string.", 422);
  }
  const maxSourceBytes = config?.maxSourceBytes ?? LEAN_MAX_SOURCE_BYTES;
  if (Buffer.byteLength(input.code, "utf8") > maxSourceBytes) {
    return errorResult("LEAN_SOURCE_TOO_LARGE", `Lean source exceeds ${maxSourceBytes} bytes.`, 413);
  }
  // A generation-time UTF-8 corruption (e.g. a mangled Mathlib symbol) must
  // not be spawned into Lean silently — it either hangs or misleads the
  // diagnostic. Reject it as a repairable contract error instead.
  if (input.code.includes("�")) {
    return errorResult(
      "LEAN_CODE_INVALID_UTF8",
      "Field 'code' contains a Unicode replacement character (U+FFFD), which means it was corrupted before this request. Regenerate the source and retry.",
      422
    );
  }

  // mode
  if (input.mode && !LEAN_MODES.includes(input.mode)) {
    return errorResult("LEAN_MODE_UNSUPPORTED", `Mode '${input.mode}' not supported. Supported modes: ${LEAN_MODES.join(", ")}.`, 422);
  }

  // taskMode — "proof" or "utility". Default is "utility": a legacy client that
  // does not declare a mode must NOT obtain implicit proof authority.
  const taskMode = input.taskMode ?? "utility";
  if (!["proof", "utility"].includes(taskMode)) {
    return errorResult("LEAN_TASK_MODE_INVALID", "taskMode must be 'proof' or 'utility'.", 422);
  }

  // profile
  if (input.profile && !LEAN_PROFILES.includes(input.profile)) {
    return errorResult("LEAN_PROFILE_UNSUPPORTED", `Profile '${input.profile}' not supported. Supported profiles: ${LEAN_PROFILES.join(", ")}.`, 400);
  }

  // timeoutSec
  const timeout = input.timeoutSec !== undefined ? Number(input.timeoutSec) : config.defaultTimeoutSec;
  if (!Number.isInteger(timeout) || timeout < 1 || timeout > config.maxTimeoutSec) {
    return errorResult(
      "LEAN_TIMEOUT_INVALID",
      `timeoutSec must be an integer between 1 and ${config.maxTimeoutSec}.`,
      400
    );
  }

  // sessionId
  if (input.sessionId && (typeof input.sessionId !== "string" || input.sessionId.length > 128)) {
    return errorResult("LEAN_SESSION_ID_INVALID", "sessionId must be a string of max 128 characters.", 400);
  }

  // runId
  if (input.runId && (typeof input.runId !== "string" || input.runId.length > 96)) {
    return errorResult("LEAN_RUN_ID_INVALID", "runId must be a string of max 64 characters.", 422);
  }

  // proofId — optional, stable across the repair attempts of one theorem.
  if (input.proofId && (typeof input.proofId !== "string" || input.proofId.length > 96)) {
    return errorResult("LEAN_PROOF_ID_INVALID", "proofId must be a string of max 96 characters.", 422);
  }

  // attempt — bounded by the orchestration budget, not by a literal 3. A proof
  // that legitimately needs five repairs must be able to make them in one turn.
  if (input.attempt !== undefined) {
    const maxAttempts = leanMaxAttempts(config);
    const n = Number(input.attempt);
    if (!Number.isInteger(n) || n < 1 || n > maxAttempts) {
      return errorResult(
        "LEAN_ATTEMPT_INVALID",
        `attempt must be an integer 1-${maxAttempts}.`,
        400
      );
    }
  }

  // promptRevision — the identity of the policy text this session was primed
  // with. A drift from the server's current text is audit information, not a
  // reason to refuse a check, so nothing here compares it to anything.
  if (input.promptRevision && (typeof input.promptRevision !== "string" || !HEX40.test(input.promptRevision))) {
    return errorResult("LEAN_PROMPT_REVISION_INVALID", "promptRevision must be a 40-character hex SHA-1.", 400);
  }

  // policyRevision — the pre-split name for promptRevision. Kept so a client
  // built before the split still works during the rollout.
  if (input.policyRevision && (typeof input.policyRevision !== "string" || !HEX40.test(input.policyRevision))) {
    return errorResult("LEAN_POLICY_REVISION_INVALID", "policyRevision must be a 40-character hex SHA-1.", 400);
  }
  if (input.policyRevision && config?.allowLegacyPolicyRevision === false && !input.promptRevision) {
    return errorResult(
      "LEAN_LEGACY_POLICY_REVISION_REFUSED",
      "policyRevision is no longer accepted; send promptRevision.",
      409
    );
  }
  // Two names for one value must not carry two values: whichever the server
  // picked, one of the two clients would be reasoning about the wrong policy.
  if (input.promptRevision && input.policyRevision && input.promptRevision !== input.policyRevision) {
    return errorResult(
      "LEAN_PROMPT_REVISION_ALIAS_MISMATCH",
      "promptRevision and policyRevision disagree; send one or make them equal.",
      409
    );
  }

  // contractRevision — the protocol identity. Unlike the prompt revision this
  // one is a compatibility statement, and the route gate does compare it.
  if (input.contractRevision && (typeof input.contractRevision !== "string" || !HEX64.test(input.contractRevision))) {
    return errorResult(
      "LEAN_CONTRACT_REVISION_INVALID",
      "contractRevision must be a 64-character hex SHA-256.",
      400
    );
  }
  // Whether a *missing* contractRevision is fatal is the route's call, not this
  // function's: only the route knows which revision to name as the expected one,
  // and a rejection that cannot state it leaves the client nothing to compare.

  // policyMode
  if (input.policyMode && !LEAN_POLICY_MODES.includes(input.policyMode)) {
    return errorResult(
      "LEAN_POLICY_MODE_UNSUPPORTED",
      `policyMode '${input.policyMode}' not supported. Supported modes: ${LEAN_POLICY_MODES.join(", ")}.`,
      400
    );
  }

  // expectedDeclarations
  if (input.expectedDeclarations) {
    if (!Array.isArray(input.expectedDeclarations)) {
      return errorResult("LEAN_DECLARATION_INVALID", "expectedDeclarations must be an array.", 401);
    }
    if (input.expectedDeclarations.length > 16) {
      return errorResult("LEAN_DECLARATION_INVALID", "expectedDeclarations max 16 items.", 422);
    }
    for (const decl of input.expectedDeclarations) {
      if (typeof decl !== "string" || !/^[A-Za-z_][A-Za-z0-9_.]*$/.test(decl)) {
        return errorResult("LEAN_DECLARATION_INVALID", `Invalid declaration name: ${decl}.`, 400);
      }
    }
  }

  // targetDeclaration — one Lean declaration name for proof tasks
  if (input.targetDeclaration !== undefined && input.targetDeclaration !== null) {
    if (
      typeof input.targetDeclaration !== "string" ||
      !/^[A-Za-z_][A-Za-z0-9_.']*$/.test(input.targetDeclaration)
    ) {
      return errorResult(
        "LEAN_TARGET_DECLARATION_INVALID",
        "targetDeclaration must be one Lean declaration name.",
        422
      );
    }
  }
  // taskMode === "proof" requires a target declaration
  if (taskMode === "proof" && !input.targetDeclaration) {
    return errorResult(
      "LEAN_TARGET_DECLARATION_REQUIRED",
      "taskMode='proof' requires targetDeclaration.",
      422
    );
  }

  // expectedTargetStatementSha256 — orchestrator-only, never in model-facing tool
  if (
    input.expectedTargetStatementSha256 !== undefined &&
    input.expectedTargetStatementSha256 !== null &&
    !/^[0-9a-f]{64}$/.test(input.expectedTargetStatementSha256)
  ) {
    return errorResult(
      "LEAN_TARGET_STATEMENT_SHA_INVALID",
      "expectedTargetStatementSha256 must be 64 lowercase hex characters.",
      422
    );
  }
  // §11.2 — a proof task states what it is proving before any candidate runs.
  // The digest is derived here, from the declared statement, so the native
  // client never has to parse Lean: it sends the header and reads back the
  // sealed digest (§121/§123).
  if (taskMode === "proof" && input.targetStatement !== undefined && input.targetStatement !== null) {
    const sealed = hashLeanTargetStatement(input.targetStatement, input.targetDeclaration);
    if (!sealed.ok) {
      return errorResult(sealed.error.code, sealed.error.message, 422);
    }
    if (
      input.expectedTargetStatementSha256 &&
      input.expectedTargetStatementSha256 !== sealed.value.statementSha256
    ) {
      return errorResult(
        "LEAN_TASKSPEC_MUTATION_ATTEMPT",
        "expectedTargetStatementSha256 does not match the declared targetStatement: " +
          "the sealed task may not be redefined mid-proof.",
        422
      );
    }
  }
  if (taskMode === "utility" && input.targetStatement) {
    return errorResult(
      "LEAN_TARGET_STATEMENT_FORBIDDEN",
      "Utility checks do not seal a target statement.",
      422
    );
  }

  // Utility mode must not carry an authoritative hash
  if (taskMode === "utility" && input.expectedTargetStatementSha256) {
    return errorResult(
      "LEAN_TARGET_STATEMENT_SHA_FORBIDDEN",
      "Utility checks do not carry an authoritative target statement hash.",
      422
    );
  }

  // proofPolicy
  if (input.proofPolicy && input.proofPolicy !== "typecheck") {
    return errorResult("LEAN_PROOF_POLICY_UNSUPPORTED", `proofPolicy '${input.proofPolicy}' not supported in MVP. Only 'typecheck' is allowed.`, 403);
  }

  return { ok: true };
}

function errorResult(code, message, statusCode) {
  return {
    ok: false,
    error: { code, message, statusCode },
  };
}

/**
 * Normalize a raw Lean check request into a frozen canonical request.
 *
 * The canonical request is the single shape the routes, registry and executor
 * agree on. It reuses validateLeanRequest for contract conformance, then:
 * - settles sessionId/runId via the sanitizers (or the injected factories);
 * - fills every default so downstream code never re-derives the constants;
 * - freezes the result so no handler can mutate a request mid-flight.
 *
 * The runId factory must be the production createLeanRunId or an equivalent
 * that produces sanitizer-acceptable ids (lean-<12 hex>-<digits>-<digits>).
 *
 * @param {object} input - Raw parsed JSON body
 * @param {object} config - Lean configuration
 * @param {object} [opts]
 * @param {Function} [opts.sessionIdFactory] - () => string, used when input
 *   has no sessionId. Defaults to () => "default".
 * @param {Function} [opts.runIdFactory] - () => string, used when input has no
 *   runId. Defaults to createLeanRunId.
 * @returns {{ ok: true, value: object } | { ok: false, error: object }}
 */
export function normalizeLeanRequest(input, config, { sessionIdFactory, runIdFactory, proofIdFactory } = {}) {
  const validation = validateLeanRequest(input, config);
  if (!validation.ok) return validation;

  const safeSession = sanitizeLeanSessionId(
    input.sessionId ?? (sessionIdFactory ? sessionIdFactory() : "default")
  );
  if (!safeSession) {
    return errorResult(
      "LEAN_SESSION_ID_INVALID",
      "sessionId must be 1-256 chars of [a-zA-Z0-9_-].",
      400
    );
  }

  let runId;
  if (input.runId !== undefined && input.runId !== null && input.runId !== "") {
    runId = sanitizeLeanRunId(String(input.runId));
    if (!runId) {
      return errorResult(
        "LEAN_RUN_ID_INVALID",
        `runId '${input.runId}' is invalid; expected lean-<12 hex>-<digits>-<digits>.`,
        422
      );
    }
  } else {
    runId = runIdFactory ? runIdFactory() : createLeanRunId();
  }

  // proofId is the stable identity of the proof task. An unparseable one is
  // rejected rather than silently replaced: a caller that thinks it is grouping
  // attempts must not end up with one group per attempt.
  let proofId;
  if (input.proofId !== undefined && input.proofId !== null && input.proofId !== "") {
    proofId = sanitizeLeanProofId(String(input.proofId));
    if (!proofId) {
      return errorResult(
        "LEAN_PROOF_ID_INVALID",
        `proofId '${input.proofId}' is invalid; expected proof-<12 hex>-<digits>-<digits>.`,
        422
      );
    }
  } else {
    proofId = proofIdFactory ? proofIdFactory() : createLeanProofId();
  }

  // One field carries the session's policy identity from here on. A legacy
  // client's policyRevision feeds it (when the rollout still allows that) and is
  // also kept verbatim, so the result can echo back what was actually sent.
  const canonicalPromptRevision =
    input.promptRevision ||
    (config?.allowLegacyPolicyRevision === false ? null : input.policyRevision) ||
    null;

  // Validated above; recomputed here because the canonical request is the one
  // object every later stage reads.
  let sealedTarget = null;
  if ((input.taskMode ?? "utility") === "proof" && input.targetStatement) {
    const sealed = hashLeanTargetStatement(input.targetStatement, input.targetDeclaration);
    if (sealed.ok) sealedTarget = sealed.value;
  }

  const canonical = Object.freeze({
    contractVersion: LEAN_REQUEST_CONTRACT,
    contractRevision: input.contractRevision || null,
    promptRevision: canonicalPromptRevision,
    legacyPolicyRevision: input.policyRevision || null,
    policyMode: input.policyMode || "base",
    code: input.code,
    mode: input.mode || "check",
    profile: input.profile || config.defaultProfile || "core",
    timeoutSec: input.timeoutSec !== undefined ? Number(input.timeoutSec) : config.defaultTimeoutSec,
    sessionId: safeSession,
    runId,
    proofId,
    attempt: input.attempt !== undefined ? Number(input.attempt) : 1,
    // Deprecated alias of promptRevision, kept for consumers written before the
    // split. Never read it to decide anything.
    policyRevision: canonicalPromptRevision,
    expectedDeclarations: input.expectedDeclarations || [],
    proofPolicy: input.proofPolicy || "typecheck",
    taskMode: input.taskMode ?? "utility",
    targetDeclaration: input.targetDeclaration || null,
    targetStatement: sealedTarget ? sealedTarget.statementText : null,
    // The task digest is what the request is *about*; the candidate's own
    // digest is evidence computed later from the source. Deriving the expected
    // value here means the executor's pre-spawn identity check enforces the
    // seal from attempt one, with no new comparison to keep in step.
    taskStatementSha256: sealedTarget ? sealedTarget.statementSha256 : null,
    expectedTargetStatementSha256:
      input.expectedTargetStatementSha256 ||
      (sealedTarget ? sealedTarget.statementSha256 : null),
  });

  return { ok: true, value: canonical };
}

/**
 * Create a base result object from a validated request.
 *
 * @param {object} request - Validated request
 * @param {{ runId: string, sessionId: string, proofId?: string }} metadata
 * @param {object} [config] - Lean config; only its orchestration block is read,
 *   to stamp the attempt budget this result was produced under.
 * @param {object} [policyContext] - What the route resolved about policy identity:
 *   serverPromptRevision, contractRevision, legacyClient. The result reports
 *   both sides so a client never has to guess which revision it is looking at.
 * @returns {object}
 */
export function createLeanResultBase(
  request,
  metadata = {},
  config = undefined,
  policyContext = {}
) {
  const maxAttempts = leanMaxAttempts(config);
  const attempt = request.attempt || 1;

  const requestPromptRevision =
    request.promptRevision || request.policyRevision || "";
  const serverPromptRevision = policyContext.serverPromptRevision || "";
  // Drift is a fact about two texts, not a verdict about a run. It is computed
  // here so every result carries it, and it never touches status or verified.
  const promptDriftDetected = Boolean(
    requestPromptRevision &&
      serverPromptRevision &&
      requestPromptRevision !== serverPromptRevision
  );

  return {
    contractVersion: LEAN_RESULT_CONTRACT,
    runId: metadata.runId || "",
    sessionId: metadata.sessionId || "",
    proofId: metadata.proofId || request.proofId || "",
    status: "pending",
    isError: false,
    mode: request.mode || "check",
    profile: request.profile || "core",
    toolchain: "",

    // Policy identity, in three separate fields because they answer three
    // different questions: which instructions this session holds, which ones the
    // server has now, and whether the two sides speak the same protocol.
    promptRevision: requestPromptRevision,
    serverPromptRevision,
    promptRevisionMatchesServer:
      Boolean(requestPromptRevision) && requestPromptRevision === serverPromptRevision,
    promptDrift: {
      detected: promptDriftDetected,
      blocking: false,
      action: promptDriftDetected ? "refresh-policy-when-convenient" : "none",
    },
    // Flat duplicates for the native client, which reads top-level keys only.
    promptDriftDetected,
    promptDriftBlocking: false,
    contractRevision: policyContext.contractRevision || request.contractRevision || "",
    legacyPolicyRevision: request.legacyPolicyRevision ?? request.policyRevision ?? null,
    legacyClient: Boolean(policyContext.legacyClient),
    policyMode: request.policyMode || "base",
    // Deprecated alias of promptRevision. Present so a consumer written before
    // the split keeps working; it echoes the session's revision, never the
    // server's, which is what the pre-split code already assumed.
    policyRevision: requestPromptRevision,

    attempt: request.attempt || 1,
    exitCode: null,
    signal: null,
    timedOut: false,
    cancelled: false,
    durationMs: 0,
    diagnostics: [],
    summary: "",
    stdout: "",
    stderr: "",
    sourceArtifact: null,
    proofPolicy: request.proofPolicy || "typecheck",
    taskMode: request.taskMode || "utility",
    targetDeclaration: request.targetDeclaration || null,
    targetIdentityAlgorithm: null,
    // The candidate's own digest, computed from the source that was submitted.
    targetStatementSha256: null,
    // The task's digest, sealed from the declared statement before any
    // candidate ran. The native tracker locks this one: locking the former is
    // how a first candidate used to define the task by being the task (§11.2).
    taskStatementSha256: request.taskStatementSha256 || null,
    targetIdentityMatched: request.taskMode === "utility" ? null : false,
    sourceSha256: null,
    containsPlaceholders: false,
    placeholderEvidence: [],
    expectedDeclarations: request.expectedDeclarations || [],
    declarationsObserved: [],
    certified: false,
    certificationReason: "MVP performs elaboration only.",
    attemptConsumed: false,
    // §66 — a probe reports that it cannot settle the task, rather than
    // leaving the caller to infer it from taskMode. A checked utility source
    // is diagnostic evidence; it can never be the proof that was asked for.
    taskVerificationEligible: (request.taskMode || "utility") === "proof",
    truncated: {
      stdout: false,
      stderr: false,
      diagnostics: false,
    },
    // Orchestration decision. Filled by finalizeLeanResult from the runtime's
    // own evidence — never from anything the model said (§3.2). Present but
    // neutral here so no consumer has to test for its absence.
    orchestration: {
      terminal: false,
      verified: false,
      retryable: false,
      failureClass: null,
      nextAction: "",
      strategyChangeRequired: false,
      diagnosticFingerprint: null,
      sameFailureCount: 0,
      attempt,
      maxAttempts,
      attemptsRemaining: Math.max(0, maxAttempts - attempt),
      elapsedWallClockMs: 0,
      maxWallClockMs: 0,
      remainingWallClockMs: 0,
      terminalReason: null,
    },
  };
}

/**
 * Finalize a result before returning.
 *
 * This is the single place the orchestration decision is computed: a route or a
 * bridge that classified a second time would be free to disagree with itself.
 *
 * @param {object} result - Result to finalize
 * @param {object} [context] - Classification context (previousFingerprint,
 *   sameFailureCount, strategyChangeAfter) supplied by the caller's turn state.
 * @returns {object} The same result object (mutated in place)
 */
export function finalizeLeanResult(result, context = {}) {
  // Ensure invariants
  if (result.status === "checked") {
    result.isError = false;
  } else if (result.status !== "pending" && result.status !== "") {
    result.isError = true;
  }
  result.certified = false;

  const previous = result.orchestration || {};
  const attempt = Number.isInteger(previous.attempt) ? previous.attempt : result.attempt || 1;
  const maxAttempts = Number.isInteger(previous.maxAttempts)
    ? previous.maxAttempts
    : leanMaxAttempts(context.config);
  const decision = classifyLeanResult(result, context);

  // Wall clock comes from the caller's turn tracker, which is the only thing
  // that knows when the proof task started. It is reported so the model reads
  // the budget instead of inferring it from the sum of per-call timeouts.
  const maxWallClockMs = Number.isFinite(context.maxWallClockMs)
    ? context.maxWallClockMs
    : Number(context.config?.maxWallClockMs) || 0;
  const elapsedWallClockMs = Math.max(0, Number(context.elapsedWallClockMs) || 0);
  const remainingWallClockMs = Number.isFinite(context.remainingWallClockMs)
    ? Math.max(0, context.remainingWallClockMs)
    : Math.max(0, maxWallClockMs - elapsedWallClockMs);

  result.orchestration = {
    ...decision,
    attempt,
    maxAttempts,
    attemptsRemaining: Math.max(0, maxAttempts - attempt),
    elapsedWallClockMs,
    maxWallClockMs,
    remainingWallClockMs,
  };

  // Utility-mode checks must not claim verification authority (§5.6/§13).
  // A probe is structurally unable to settle the task: it cannot seal the
  // target, cannot consume a proof attempt, and cannot end the turn.
  if (result.taskMode === "utility") {
    result.orchestration.verified = false;
    result.taskVerificationEligible = false;
  }

  // The native client parses top-level keys only; duplicating the decision flat
  // avoids teaching the C JSON reader to descend into objects during this patch
  // (§10.4). The nested object stays authoritative for JS consumers.
  result.orchestrationTerminal = result.orchestration.terminal;
  result.orchestrationVerified = result.orchestration.verified;
  result.orchestrationRetryable = result.orchestration.retryable;
  result.orchestrationFailureClass = result.orchestration.failureClass || "";
  result.orchestrationNextAction = result.orchestration.nextAction || "";
  result.orchestrationFingerprint = result.orchestration.diagnosticFingerprint || "";
  result.orchestrationStrategyChangeRequired = result.orchestration.strategyChangeRequired;
  result.orchestrationTerminalReason = result.orchestration.terminalReason || "";
  result.orchestrationAttempt = attempt;
  result.orchestrationMaxAttempts = maxAttempts;
  result.orchestrationAttemptsRemaining = result.orchestration.attemptsRemaining;
  result.orchestrationElapsedWallClockMs = elapsedWallClockMs;
  result.orchestrationMaxWallClockMs = maxWallClockMs;
  result.orchestrationRemainingWallClockMs = remainingWallClockMs;
  result.orchestrationAttemptConsumed = Boolean(result.attemptConsumed);
  // WP-10: the native client's flat-key parser reads the proof-task identity
  // verdict from these keys. targetStatementSha256 is the digest the runtime
  // itself computed for the locked declaration; checkedTargetStatementSha256
  // is the digest of what actually came back status=checked.
  result.orchestrationTargetIdentityMatched = result.targetIdentityMatched === true;
  // The native client reads top-level keys only (§10.4).
  result.orchestrationTaskStatementSha256 = result.taskStatementSha256 || "";
  result.orchestrationTargetStatementSha256 =
    typeof result.targetStatementSha256 === "string" ? result.targetStatementSha256 : "";
  result.orchestrationCheckedTargetStatementSha256 =
    typeof result.checkedTargetStatementSha256 === "string"
      ? result.checkedTargetStatementSha256
      : "";

  return result;
}

/**
 * Validate a completed result against contract invariants.
 *
 * @param {object} result - Completed result
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function validateLeanResult(result) {
  const errors = [];
  if (!result) return { ok: false, errors: ["Result is null"] };

  if (result.contractVersion !== LEAN_RESULT_CONTRACT) {
    errors.push(`Contract version mismatch: ${result.contractVersion}`);
  }
  if (!result.runId) {
    errors.push("Missing runId");
  }
  if (result.status === "checked" && result.exitCode !== 0) {
    errors.push("status=checked but exitCode != 0");
  }
  if (result.status === "checked" && result.timedOut) {
    errors.push("status=checked but timedOut=true");
  }
  if (result.status === "checked" && result.cancelled) {
    errors.push("status=checked but cancelled=true");
  }
  if (result.certified) {
    errors.push("certified must be false in MVP");
  }

  // Orchestration invariants (§7.4). These are what stop a "verified" claim
  // from ever being reachable without a checked run.
  const orch = result.orchestration;
  if (!orch || typeof orch !== "object") {
    errors.push("Missing orchestration decision");
    return { ok: false, errors };
  }
  // Task mode determines which invariants apply to a checked result.
  const taskMode = result.taskMode || "utility";
  if (result.status === "checked") {
    if (taskMode === "proof") {
      if (!result.targetDeclaration) errors.push("status=checked proof but targetDeclaration is missing");
      if (!result.targetStatementSha256) errors.push("status=checked proof but targetStatementSha256 is missing");
      if (result.targetIdentityMatched !== true) errors.push("status=checked proof but targetIdentityMatched != true");
      if (result.taskVerificationEligible !== true) errors.push("status=checked proof but taskVerificationEligible != true");
      if (!result.sourceSha256) errors.push("status=checked but sourceSha256 is missing");
      if (orch.verified !== true) errors.push("status=checked proof but orchestration.verified != true");
    } else {
      // Utility checked must not claim verified — it has no authority.
      if (orch.verified !== false) errors.push("status=checked utility but orchestration.verified != false");
    }
    if (orch.terminal !== true) errors.push("status=checked but orchestration.terminal != true");
        if (orch.retryable !== false) errors.push("status=checked but orchestration.retryable != false");
  } else if (orch.verified === true) {
    errors.push("orchestration.verified=true without status=checked");
  }
  if (orch.failureClass === "infrastructure" && orch.verified !== false) {
    errors.push("infrastructure block must not be verified");
  }
  if (orch.retryable === true && orch.terminal === true) {
    errors.push("orchestration cannot be retryable and terminal at once");
  }
  if (!Number.isInteger(orch.attemptsRemaining) || orch.attemptsRemaining < 0) {
    errors.push("orchestration.attemptsRemaining must be an integer >= 0");
  }
  // BUDGET-03: remaining is never negative. A negative value here would be
  // rendered as time left by anything that formats it.
  for (const key of ["elapsedWallClockMs", "maxWallClockMs", "remainingWallClockMs"]) {
    if (!Number.isFinite(orch[key]) || orch[key] < 0) {
      errors.push(`orchestration.${key} must be a number >= 0`);
    }
  }

  // A prompt revision drift is audit information. Letting it become blocking is
  // precisely the regression this contract split was made to prevent: the server
  // having newer editorial text must never invalidate a check.
  if (result.promptDrift && result.promptDrift.blocking !== false) {
    errors.push("promptDrift.blocking must be false");
  }
  if (result.promptDriftBlocking === true) {
    errors.push("promptDriftBlocking must be false");
  }
  if (result.promptDrift?.detected === true && result.status === "checked" && orch.verified !== true) {
    errors.push("prompt drift must not withdraw a checked run's verified flag");
  }

  return { ok: errors.length === 0, errors };
}
