// Tests for leanMetrics.mjs
import test from "node:test";
import assert from "node:assert/strict";

import { createLeanMetrics, leanRunEvent, leanInspectEvent } from "./leanMetrics.mjs";

function result(overrides = {}) {
  return {
    contractVersion: "lean_result_v1",
    runId: "lean-abcdef012345-1-2",
    sessionId: "sess",
    profile: "core",
    toolchain: "leanprover/lean4:v4.32.2",
    status: "checked",
    isError: false,
    exitCode: 0,
    signal: null,
    timedOut: false,
    cancelled: false,
    durationMs: 421,
    diagnostics: [],
    summary: "ok",
    stdout: "",
    stderr: "",
    sourceArtifact: { relativePath: "sess/lean-abcdef012345-1-2/Main.lean", sha256: "a".repeat(64), bytes: 44 },
    containsPlaceholders: false,
    certified: false,
    truncated: { stdout: false, stderr: false, diagnostics: false },
    ...overrides
  };
}

test("the event carries sizes and counts, never content", () => {
  const event = leanRunEvent(
    result({
      stdout: "SECRET_STDOUT_BODY",
      stderr: "SECRET_STDERR_BODY",
      summary: "Lean elaboration completed without errors.",
      diagnostics: [{ severity: "error", message: "type mismatch", raw: "SECRET_RAW" }],
      placeholderEvidence: ["sorry"]
    })
  );

  const serialized = JSON.stringify(event);
  for (const secret of ["SECRET_STDOUT_BODY", "SECRET_STDERR_BODY", "SECRET_RAW", "type mismatch"]) {
    assert.ok(!serialized.includes(secret), `event leaked: ${secret}`);
  }

  assert.equal(event.type, "lean_check");
  assert.equal(event.stdoutBytes, "SECRET_STDOUT_BODY".length);
  assert.equal(event.stderrBytes, "SECRET_STDERR_BODY".length);
  assert.equal(event.diagnosticCount, 1);
  assert.equal(event.sourceBytes, 44);
  assert.equal(event.durationMs, 421);
});

test("the event does not carry the Lean source or any host path", () => {
  const event = leanRunEvent(result());
  const serialized = JSON.stringify(event);
  assert.ok(!serialized.includes("Main.lean"), "no artifact path");
  assert.equal(event.code, undefined);
  // The hash is enough to correlate two runs of the same source.
  assert.equal(event.sourceSha256, "a".repeat(64));
});

test("metrics count each status into its own bucket", () => {
  const m = createLeanMetrics();
  for (const status of ["checked", "checked", "failed", "timeout", "cancelled", "rejected", "preflight_failed", "internal_error"]) {
    m.record(leanRunEvent(result({ status })));
  }
  const s = m.snapshot();
  assert.equal(s.calls, 8);
  assert.equal(s.checked, 2);
  assert.equal(s.failed, 1);
  assert.equal(s.timeout, 1);
  assert.equal(s.cancelled, 1);
  assert.equal(s.rejected, 1);
  assert.equal(s.preflightFailed, 1);
  assert.equal(s.internalError, 1);
});

test("metrics track truncation, placeholders and profile", () => {
  const m = createLeanMetrics();
  m.record(leanRunEvent(result({ truncated: { stdout: true, stderr: false, diagnostics: false } })));
  m.record(leanRunEvent(result({ containsPlaceholders: true, profile: "mathlib" })));
  m.record(leanRunEvent(result({ profile: "mathlib" })));

  const s = m.snapshot();
  assert.equal(s.truncated, 1);
  assert.equal(s.placeholders, 1);
  assert.deepEqual(s.byProfile, { core: 1, mathlib: 2 });
  assert.equal(s.sourceBytesTotal, 132);
});

test("a certified run would be counted — the MVP must keep this at zero", () => {
  const m = createLeanMetrics();
  m.record(leanRunEvent(result()));
  assert.equal(m.snapshot().certified, 0);

  m.record(leanRunEvent(result({ certified: true })));
  assert.equal(m.snapshot().certified, 1, "a regression that certifies must be visible");
});

test("durations land in monotonically increasing buckets", () => {
  const m = createLeanMetrics();
  for (const durationMs of [10, 900, 1500, 4000, 30000, 999999]) {
    m.record(leanRunEvent(result({ durationMs })));
  }
  const buckets = m.snapshot().durationMs;
  assert.equal(buckets.reduce((a, b) => a + b.count, 0), 6);
  assert.equal(buckets[0].count, 1, "10 ms lands in <=500");
  assert.equal(buckets.at(-1).leMs, null, "last bucket is unbounded");
  assert.equal(buckets.at(-1).count, 1);
});

test("metrics ignore anything that is not a lean_check event", () => {
  const m = createLeanMetrics();
  m.record(null);
  m.record({ type: "sage" });
  m.record(undefined);
  assert.equal(m.snapshot().calls, 0);
});

test("snapshots are detached from the live counters", () => {
  const m = createLeanMetrics();
  m.record(leanRunEvent(result()));
  const first = m.snapshot();
  first.calls = 999;
  first.byProfile.core = 999;
  m.record(leanRunEvent(result()));
  assert.equal(m.snapshot().calls, 2);
  assert.equal(m.snapshot().byProfile.core, 2);
});

test("a proof task is counted once, its attempts every time", () => {
  const metrics = createLeanMetrics();
  const proofId = "proof-abcdef012345-1-1";

  for (let attempt = 1; attempt <= 4; attempt += 1) {
    metrics.record(
      leanRunEvent(
        result({
          proofId,
          status: "failed",
          isError: true,
          exitCode: 1,
          orchestration: {
            attempt,
            verified: false,
            terminal: false,
            failureClass: "rewrite_miss",
            strategyChangeRequired: attempt >= 2
          }
        })
      )
    );
  }
  metrics.record(
    leanRunEvent(
      result({
        proofId,
        orchestration: { attempt: 5, verified: true, terminal: true, failureClass: null }
      })
    )
  );

  const snap = metrics.snapshot().orchestration;
  assert.equal(snap.proof_tasks_total, 1);
  assert.equal(snap.proof_attempts_total, 5);
  assert.equal(snap.proof_verified_total, 1);
  assert.equal(snap.proof_not_verified_total, 0);
  assert.equal(snap.proof_strategy_changes_total, 3);
  assert.equal(snap.proof_failure_class_total.rewrite_miss, 4);
});

test("a proof that ends without a check counts as not verified, exactly once", () => {
  const metrics = createLeanMetrics();
  const proofId = "proof-abcdef012345-1-2";
  const terminal = leanRunEvent(
    result({
      proofId,
      status: "preflight_failed",
      isError: true,
      errorCode: "LEAN_RUNTIME_UNAVAILABLE",
      orchestration: { attempt: 1, verified: false, terminal: true, failureClass: "infrastructure" }
    })
  );
  metrics.record(terminal);
  metrics.record(terminal);

  const snap = metrics.snapshot().orchestration;
  assert.equal(snap.proof_not_verified_total, 1);
  assert.equal(snap.proof_verified_total, 0);
  assert.equal(snap.proof_attempts_total, 2);
});

test("decisions taken outside a run are recordable and bounded to known counters", () => {
  const metrics = createLeanMetrics();
  metrics.recordOrchestration("proof_premature_finalizations_blocked_total");
  metrics.recordOrchestration("proof_same_source_rejected_total", 2);
  metrics.recordOrchestration("not_a_counter", 99);

  const snap = metrics.snapshot().orchestration;
  assert.equal(snap.proof_premature_finalizations_blocked_total, 1);
  assert.equal(snap.proof_same_source_rejected_total, 2);
  assert.equal(snap.not_a_counter, undefined);
});

// --- WP09 — inspect metrics ---

function inspectResult(overrides = {}) {
  return {
    contractVersion: "lean_inspect_result_v1",
    runId: "lean-abcdef012345-1-2",
    sessionId: "sess",
    profile: "core",
    status: "inspected",
    timedOut: false,
    durationMs: 123,
    sourceSha256: "b".repeat(64),
    symbols: [{ name: "Nat.add", output: "Nat.add : Nat → Nat → Nat" }],
    retried: false,
    processStarted: true,
    ...overrides,
  };
}

test("leanInspectEvent builds a structured event from an inspect result", () => {
  const event = leanInspectEvent(inspectResult());
  assert.equal(event.type, "lean_inspect");
  assert.equal(event.status, "inspected");
  assert.equal(event.symbolCount, 1);
  assert.equal(event.retried, false);
  assert.equal(event.durationMs, 123);
});

test("leanInspectEvent counts symbols and tracks retry", () => {
  const event = leanInspectEvent(inspectResult({
    symbols: [{ name: "Nat" }, { name: "Nat.add" }],
    retried: true,
    timedOut: false,
  }));
  assert.equal(event.symbolCount, 2);
  assert.equal(event.retried, true);
});

test("recordInspect increments inspect counters by status", () => {
  const m = createLeanMetrics();
  m.recordInspect({ type: "lean_inspect", status: "inspected", durationMs: 100, symbolCount: 2 });
  m.recordInspect({ type: "lean_inspect", status: "inspected", durationMs: 200, symbolCount: 3 });
  m.recordInspect({ type: "lean_inspect", status: "timeout", durationMs: 30000, symbolCount: 1, retried: true });
  m.recordInspect({ type: "lean_inspect", status: "error", durationMs: 50, symbolCount: 0 });
  m.recordInspect({ type: "lean_inspect", status: "rejected", durationMs: 0 });
  m.recordInspect({ type: "lean_inspect", status: "preflight_failed", durationMs: 0 });

  const s = m.snapshot().inspect;
  assert.equal(s.inspect_calls_total, 6);
  assert.equal(s.inspect_success_total, 2);
  assert.equal(s.inspect_timeout_total, 1);
  assert.equal(s.inspect_error_total, 1);
  assert.equal(s.inspect_rejected_total, 1);
  assert.equal(s.inspect_preflight_failed_total, 1);
  assert.equal(s.inspect_retry_total, 1);
  assert.equal(s.inspect_symbol_count_total, 6);
});

test("recordInspect ignores non-inspect events", () => {
  const m = createLeanMetrics();
  m.recordInspect(null);
  m.recordInspect({ type: "lean_check" });
  m.recordInspect({ type: "sage" });
  assert.equal(m.snapshot().inspect.inspect_calls_total, 0);
});

test("inspect durations land in correct buckets", () => {
  const m = createLeanMetrics();
  m.recordInspect({ type: "lean_inspect", status: "inspected", durationMs: 10, symbolCount: 0 });
  m.recordInspect({ type: "lean_inspect", status: "inspected", durationMs: 600, symbolCount: 0 });
  m.recordInspect({ type: "lean_inspect", status: "timeout", durationMs: 999999, symbolCount: 0 });

  const buckets = m.snapshot().inspect.inspect_duration_ms;
  assert.equal(buckets[0].count, 1, "10ms in <=500");
  assert.equal(buckets[1].count, 1, "600ms in <=1000");
  assert.equal(buckets.at(-1).count, 1, "999999ms in unbounded");
});

test("inspect snapshot is detached from live counters", () => {
  const m = createLeanMetrics();
  m.recordInspect({ type: "lean_inspect", status: "inspected", durationMs: 10, symbolCount: 1 });
  const first = m.snapshot().inspect;
  first.inspect_calls_total = 999;
  m.recordInspect({ type: "lean_inspect", status: "inspected", durationMs: 10, symbolCount: 1 });
  assert.equal(m.snapshot().inspect.inspect_calls_total, 2);
});
