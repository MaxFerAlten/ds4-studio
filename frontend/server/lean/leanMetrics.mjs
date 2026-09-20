// Lean 4 observability for ds4-studio.
//
// One event shape, two consumers: a structured log line and an in-memory
// counter set exposed on GET /api/lean/status. Both the HTTP route and the
// agent tool go through the executor, so this is the single place where a run
// is accounted for.
//
// Nothing here may carry Lean source, stderr bodies, host paths, environment
// or the contents of files the sandbox touched — a sandbox log that leaks what
// the sandbox contains defeats the sandbox.

/** Duration buckets in ms. Coarse on purpose: this is a health signal. */
const DURATION_BUCKETS = [500, 1000, 2000, 5000, 15000, 60000, Infinity];

/**
 * Build the structured event for a completed run.
 *
 * @param {object} result - A lean_result_v1
 * @returns {object} Event safe to log
 */
export function leanRunEvent(result) {
  return {
    type: "lean_check",
    runId: result.runId || "",
    profile: result.profile || "",
    toolchain: result.toolchain || "",
    status: result.status,
    isError: Boolean(result.isError),
    errorCode: result.errorCode || null,
    exitCode: result.exitCode ?? null,
    signal: result.signal ?? null,
    timedOut: Boolean(result.timedOut),
    cancelled: Boolean(result.cancelled),
    durationMs: result.durationMs || 0,
    sourceBytes: result.sourceArtifact?.bytes ?? 0,
    sourceSha256: result.sourceArtifact?.sha256 || "",
    diagnosticCount: Array.isArray(result.diagnostics) ? result.diagnostics.length : 0,
    stdoutBytes: Buffer.byteLength(result.stdout || "", "utf8"),
    stderrBytes: Buffer.byteLength(result.stderr || "", "utf8"),
    truncated: Boolean(
      result.truncated?.stdout || result.truncated?.stderr || result.truncated?.diagnostics
    ),
    containsPlaceholders: Boolean(result.containsPlaceholders),
    certified: Boolean(result.certified),
    // Orchestration facts. A proof task is one theorem across its repairs, so
    // "how many runs" alone cannot answer whether the loop is converging.
    proofId: result.proofId || "",
    attempt: result.orchestration?.attempt ?? result.attempt ?? 1,
    verified: Boolean(result.orchestration?.verified),
    terminal: Boolean(result.orchestration?.terminal),
    failureClass: result.orchestration?.failureClass || null,
    strategyChangeRequired: Boolean(result.orchestration?.strategyChangeRequired)
  };
}

/**
 * Build the structured event for a completed inspect run.
 *
 * @param {object} result - An inspect_result_v1
 * @returns {object} Event safe to log
 */
export function leanInspectEvent(result) {
  return {
    type: "lean_inspect",
    runId: result.runId || "",
    profile: result.profile || "",
    status: result.status,
    errorCode: result.errorCode || null,
    timedOut: Boolean(result.timedOut),
    durationMs: result.durationMs || 0,
    sourceSha256: result.sourceSha256 || "",
    symbolCount: Array.isArray(result.symbols) ? result.symbols.length : 0,
    retried: Boolean(result.retried),
    processStarted: Boolean(result.processStarted)
  };
}

/** Counter names an orchestration consumer may record directly (§15.3). */
export const LEAN_ORCHESTRATION_COUNTERS = Object.freeze([
  "proof_premature_finalizations_blocked_total",
  "proof_same_source_rejected_total"
]);

/**
 * In-memory counters. Reset on restart; this is a health signal, not billing.
 *
 * @returns {{ record: (event: object) => void, snapshot: () => object }}
 */
export function createLeanMetrics() {
  const counts = {
    calls: 0,
    checked: 0,
    failed: 0,
    timeout: 0,
    cancelled: 0,
    rejected: 0,
    preflightFailed: 0,
    internalError: 0,
    truncated: 0,
    placeholders: 0,
    certified: 0
  };
  const byProfile = Object.create(null);
  const durations = new Array(DURATION_BUCKETS.length).fill(0);
  let sourceBytesTotal = 0;

  // Proof-level accounting (§15.3). A task is counted once, on the first
  // attempt that names its proofId; the outcome is counted when it turns
  // terminal, so a proof never lands in both verified and not_verified.
  const proof = {
    proof_tasks_total: 0,
    proof_verified_total: 0,
    proof_not_verified_total: 0,
    proof_attempts_total: 0,
    proof_strategy_changes_total: 0,
    proof_premature_finalizations_blocked_total: 0,
    proof_same_source_rejected_total: 0
  };
  const failureClasses = Object.create(null);
  const seenProofs = new Set();
  const settledProofs = new Set();

  // Policy identity accounting. These separate "the server has newer editorial
  // text" (expected, harmless, should trend to zero as sessions refresh) from
  // "the two sides implement different protocols" (a deploy is broken). Only
  // hash prefixes ever reach a log; none of these hold policy text.
  const policy = {
    lean_prompt_drift_total: 0,
    lean_contract_mismatch_total: 0,
    lean_prompt_echo_mismatch_total: 0,
    lean_local_prompt_mismatch_total: 0,
    lean_session_policy_restore_total: 0,
    lean_session_policy_restore_failure_total: 0,
    lean_legacy_revision_request_total: 0,
    lean_bundle_stale_total: 0
  };

  // WP09 — inspect-specific observability. lean_inspect was previously
  // uninstrumented; these counters expose it through GET /api/lean/status.
  const inspect = {
    inspect_calls_total: 0,
    inspect_success_total: 0,
    inspect_timeout_total: 0,
    inspect_error_total: 0,
    inspect_rejected_total: 0,
    inspect_preflight_failed_total: 0,
    inspect_retry_total: 0,
    inspect_symbol_count_total: 0
  };
  const inspectDurations = new Array(DURATION_BUCKETS.length).fill(0);

  const STATUS_KEY = {
    checked: "checked",
    failed: "failed",
    timeout: "timeout",
    cancelled: "cancelled",
    rejected: "rejected",
    preflight_failed: "preflightFailed",
    internal_error: "internalError"
  };

  return {
    record(event) {
      if (!event || event.type !== "lean_check") return;
      counts.calls += 1;

      const key = STATUS_KEY[event.status];
      if (key) counts[key] += 1;

      if (event.truncated) counts.truncated += 1;
      if (event.containsPlaceholders) counts.placeholders += 1;
      // Tracked so a future auditor flipping this to true is visible, and so a
      // regression that certifies an MVP run cannot pass unnoticed.
      if (event.certified) counts.certified += 1;

      if (event.profile) byProfile[event.profile] = (byProfile[event.profile] || 0) + 1;
      sourceBytesTotal += event.sourceBytes || 0;

      const i = DURATION_BUCKETS.findIndex((b) => event.durationMs <= b);
      durations[i === -1 ? durations.length - 1 : i] += 1;

      if (event.proofId) {
        proof.proof_attempts_total += 1;
        if (!seenProofs.has(event.proofId)) {
          seenProofs.add(event.proofId);
          proof.proof_tasks_total += 1;
        }
        if (event.strategyChangeRequired) proof.proof_strategy_changes_total += 1;
        if (event.failureClass) {
          failureClasses[event.failureClass] = (failureClasses[event.failureClass] || 0) + 1;
        }
        if (event.terminal && !settledProofs.has(event.proofId)) {
          settledProofs.add(event.proofId);
          if (event.verified) proof.proof_verified_total += 1;
          else proof.proof_not_verified_total += 1;
        }
      }
    },

    /**
     * Record an orchestration decision the executor never sees: a premature
     * finalization the loop blocked, or an unchanged source refused before the
     * spawn. Both happen outside a run, so neither produces a lean_check event.
     */
    recordOrchestration(counter, delta = 1) {
      if (!Object.prototype.hasOwnProperty.call(proof, counter)) return;
      proof[counter] += delta;
    },

    /** Bump one of the policy-identity counters by name. */
    recordPolicy(counter, delta = 1) {
      if (!Object.prototype.hasOwnProperty.call(policy, counter)) return;
      policy[counter] += delta;
    },

    recordPromptDrift() {
      policy.lean_prompt_drift_total += 1;
    },
    recordContractMismatch() {
      policy.lean_contract_mismatch_total += 1;
    },
    recordLegacyRevisionRequest() {
      policy.lean_legacy_revision_request_total += 1;
    },

    /** WP09 — record an inspect-specific event. */
    recordInspect(event) {
      if (!event || event.type !== "lean_inspect") return;
      inspect.inspect_calls_total += 1;

      const STATUS_KEY = {
        inspected: "inspect_success_total",
        timeout: "inspect_timeout_total",
        error: "inspect_error_total",
        rejected: "inspect_rejected_total",
        preflight_failed: "inspect_preflight_failed_total"
      };
      const key = STATUS_KEY[event.status];
      if (key) inspect[key] += 1;

      if (event.retried) inspect.inspect_retry_total += 1;
      inspect.inspect_symbol_count_total += event.symbolCount || 0;

      const i = DURATION_BUCKETS.findIndex((b) => event.durationMs <= b);
      inspectDurations[i === -1 ? inspectDurations.length - 1 : i] += 1;
    },

    snapshot() {
      return {
        ...counts,
        byProfile: { ...byProfile },
        sourceBytesTotal,
        durationMs: DURATION_BUCKETS.map((bound, i) => ({
          leMs: bound === Infinity ? null : bound,
          count: durations[i]
        })),
        inspect: {
          ...inspect,
          inspect_duration_ms: DURATION_BUCKETS.map((bound, i) => ({
            leMs: bound === Infinity ? null : bound,
            count: inspectDurations[i]
          }))
        },
        orchestration: {
          ...proof,
          proof_failure_class_total: { ...failureClasses }
        },
        policy: { ...policy }
      };
    }
  };
}
