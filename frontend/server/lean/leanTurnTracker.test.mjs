// Tests for leanTurnTracker.mjs — the state matrix of §8.3/§8.5/§8.6.

import test from "node:test";
import assert from "node:assert/strict";

import { LeanTurnTracker, sha256Hex, leanAnswerMatchesVerifiedSource } from "./leanTurnTracker.mjs";
import { LEAN_ORCHESTRATION_DEFAULTS } from "./leanOrchestrationConfig.mjs";
import { createLeanTaskSpec } from "./leanTaskSpec.mjs";

const CONFIG = Object.freeze({
  maxAttempts: 6,
  maxSameFailure: 2,
  maxPrematureFinalizations: 3,
  maxWallClockMs: 360000,
  strategyChangeAfter: 2,
  enabled: true,
});

function tracker(overrides = {}, now) {
  return new LeanTurnTracker({ ...CONFIG, ...overrides }, now);
}

function failed(stdout, overrides = {}) {
  return {
    contractVersion: "lean_result_v1",
    runId: "lean-a1b2c3d4e5f6-1700000000000-1",
    status: "failed",
    isError: true,
    exitCode: 1,
    timedOut: false,
    cancelled: false,
    diagnostics: [{ severity: "error", message: stdout }],
    summary: stdout,
    ...overrides,
  };
}

function checked(sha = "a".repeat(64)) {
  return {
    contractVersion: "lean_result_v1",
    runId: "lean-a1b2c3d4e5f6-1700000000000-9",
    status: "checked",
    isError: false,
    exitCode: 0,
    timedOut: false,
    cancelled: false,
    diagnostics: [],
    sourceArtifact: { sha256: sha },
    taskMode: "proof",
    profile: "core",
    sourceSha256: sha,
    targetDeclaration: "t",
    targetIdentityAlgorithm: "lean-target-statement-v1",
    targetStatementSha256: "c".repeat(64),
    targetIdentityMatched: true,
  };
}

test("an unused tracker never blocks a plain answer", () => {
  const t = tracker();
  assert.equal(t.state, "idle");
  assert.equal(t.canFinalize(), true);
  assert.equal(t.mustContinue(), false);
});

test("begin mints a stable proofId and keeps it across attempts", () => {
  const t = tracker();
  const first = t.begin({ targetDeclaration: "t", profile: "core" });
  assert.match(first.proofId, /^proof-[a-f0-9]{12}-\d+-\d+$/);
  t.beforeAttempt({ code: "one" });
  t.recordResult(failed("unsolved goals"));
  t.beforeAttempt({ code: "two" });
  assert.equal(t.snapshot().proofId, first.proofId);
});

test("a retryable failure blocks finalization and demands another attempt", () => {
  const t = tracker();
  t.begin({ targetDeclaration: "t", profile: "core" });
  t.beforeAttempt({ code: "one" });
  const snap = t.recordResult(failed("unsolved goals"));
  assert.equal(snap.state, "repair_required");
  assert.equal(t.canFinalize(), false);
  assert.equal(t.mustContinue(), true);
});

test("checked is the only state that releases a verified answer", () => {
  const t = tracker();
  t.begin({ targetDeclaration: "t", profile: "core" });
  t.beforeAttempt({ code: "one" });
  const snap = t.recordResult(checked("b".repeat(64)));
  assert.equal(snap.state, "verified");
  assert.equal(snap.verified, true);
  assert.equal(t.canFinalize(), true);
  assert.equal(t.mustContinue(), false);
  assert.equal(snap.checkedSourceSha256, "b".repeat(64));
  assert.equal(snap.checkedRunId, "lean-a1b2c3d4e5f6-1700000000000-9");
});

test("attempt 4 of 6 is allowed; attempt 7 is refused as budget exhausted", () => {
  const t = tracker();
  t.begin({ targetDeclaration: "t", profile: "core" });
  for (let i = 1; i <= 6; i += 1) {
    const decision = t.beforeAttempt({ code: `candidate-${i}` });
    assert.equal(decision.allowed, true, `attempt ${i} must be allowed`);
    assert.equal(decision.attempt, i);
    if (i < 6) t.recordResult(failed(`unsolved goals ${i}`));
  }
  t.recordResult(failed("unsolved goals 6"));
  assert.equal(t.snapshot().state, "budget_exhausted");
  const seventh = t.beforeAttempt({ code: "candidate-7" });
  assert.equal(seventh.allowed, false);
  assert.equal(seventh.code, "LEAN_PROOF_ALREADY_TERMINAL");
  assert.equal(t.canFinalize(), true);
});

test("resending the identical source after a failure is refused before the spawn", () => {
  const t = tracker();
  t.begin({ targetDeclaration: "t", profile: "core" });
  t.beforeAttempt({ code: "same" });
  t.recordResult(failed("unsolved goals"));
  const again = t.beforeAttempt({ code: "same" });
  assert.equal(again.allowed, false);
  assert.equal(again.code, "LEAN_SOURCE_UNCHANGED_AFTER_FAILURE");
  assert.equal(t.snapshot().attempt, 1, "a refused attempt must not burn budget");

  const authorized = t.beforeAttempt({ code: "same", allowUnchangedSource: true });
  assert.equal(authorized.allowed, true, "an authorized infrastructure retry is exempt");
});

test("beforeAttempt accepts a precomputed source hash", () => {
  const t = tracker();
  t.begin({ targetDeclaration: "t", profile: "core" });
  t.beforeAttempt({ sourceSha256: sha256Hex("x") });
  t.recordResult(failed("unsolved goals"));
  const again = t.beforeAttempt({ sourceSha256: sha256Hex("x") });
  assert.equal(again.allowed, false);
});

test("the same fingerprint twice forces a strategy change", () => {
  const t = tracker();
  t.begin({ targetDeclaration: "t", profile: "core" });
  t.beforeAttempt({ code: "one" });
  const first = t.recordResult(failed("rewrite tactic failed, motive is not type correct"));
  assert.equal(first.state, "repair_required");

  t.beforeAttempt({ code: "two" });
  const second = t.recordResult(failed("rewrite tactic failed, motive is not type correct"));
  assert.equal(second.state, "strategy_change_required");
  assert.equal(second.strategyChangeRequired, true);
  assert.equal(second.strategyGeneration, 1);
  assert.equal(t.canFinalize(), false);
  assert.equal(t.mustContinue(), true);
});

test("an infrastructure block is terminal and finalizable, but not verified", () => {
  const t = tracker();
  t.begin({ targetDeclaration: "t", profile: "core" });
  t.beforeAttempt({ code: "one" });
  const snap = t.recordResult(
    failed("", { status: "preflight_failed", errorCode: "LEAN_RUNTIME_UNAVAILABLE" })
  );
  assert.equal(snap.state, "infrastructure_block");
  assert.equal(snap.verified, false);
  assert.equal(snap.terminalReason, "LEAN_RUNTIME_UNAVAILABLE");
  assert.equal(t.canFinalize(), true);
  assert.equal(t.mustContinue(), false);
});

test("cancellation is its own terminal state", () => {
  const t = tracker();
  t.begin({ targetDeclaration: "t", profile: "core" });
  t.beforeAttempt({ code: "one" });
  const snap = t.recordResult(failed("", { status: "cancelled", cancelled: true }));
  assert.equal(snap.state, "cancelled");
  assert.equal(snap.verified, false);
  assert.equal(t.canFinalize(), true);
});

test("premature finalizations escalate, then exhaust the budget", () => {
  const t = tracker();
  t.begin({ targetDeclaration: "t", profile: "core" });
  t.beforeAttempt({ code: "one" });
  t.recordResult(failed("unsolved goals"));

  const first = t.recordPrematureFinalization();
  assert.equal(first.retryAllowed, true);
  assert.match(first.guidance, /LEAN_FINALIZATION_BLOCKED/);

  const second = t.recordPrematureFinalization();
  assert.equal(second.retryAllowed, true);
  assert.match(second.guidance, /emit the corrected Lean source/);

  const third = t.recordPrematureFinalization();
  assert.equal(third.retryAllowed, true);
  assert.equal(third.state, "strategy_change_required");

  const fourth = t.recordPrematureFinalization();
  assert.equal(fourth.retryAllowed, false);
  assert.equal(fourth.state, "budget_exhausted");
  assert.equal(fourth.terminalReason, "PREMATURE_FINALIZATION_BUDGET_EXHAUSTED");
  assert.equal(t.canFinalize(), true);
});

test("the wall clock ends the proof even with attempts left", () => {
  let clock = 0;
  const t = tracker({ maxWallClockMs: 1000 }, () => clock);
  t.begin({ targetDeclaration: "t", profile: "core" });
  t.beforeAttempt({ code: "one" });
  t.recordResult(failed("unsolved goals"));
  clock = 5000;
  const decision = t.beforeAttempt({ code: "two" });
  assert.equal(decision.allowed, false);
  assert.equal(decision.code, "LEAN_WALL_CLOCK_EXHAUSTED");
  assert.equal(t.snapshot().state, "budget_exhausted");
  assert.equal(t.canFinalize(), true);
});

test("the rollback switch drops the gate but keeps the classification", () => {
  const t = tracker({ enabled: false });
  t.beforeAttempt({ code: "one" });
  const snap = t.recordResult(failed("unsolved goals"));
  assert.equal(snap.state, "repair_required");
  assert.equal(snap.failureClass, "unsolved_goals");
  assert.equal(t.canFinalize(), true, "gate is off");
  assert.equal(t.mustContinue(), false);
  assert.equal(snap.verified, false, "no checked, no verified — even in rollback");
});

test("the conversation sequence completes inside one turn", () => {
  const t = tracker();
  t.begin({ targetDeclaration: "t", profile: "core" });
  const sequence = [
    failed("", { status: "timeout", timedOut: true, exitCode: null }),
    failed("unterminated comment"),
    failed("invalid alternative name 'succ'"),
    failed("rewrite tactic failed, did not find instance of the pattern"),
    checked(),
  ];

  for (let i = 0; i < sequence.length; i += 1) {
    const decision = t.beforeAttempt({ code: `candidate-${i}` });
    assert.equal(decision.allowed, true, `attempt ${i + 1} must be allowed`);
    t.recordResult(sequence[i]);
    if (i < sequence.length - 1) {
      assert.equal(t.canFinalize(), false, `no finalization after attempt ${i + 1}`);
      assert.equal(t.mustContinue(), true);
    }
  }

  const snap = t.snapshot();
  assert.equal(snap.state, "verified");
  assert.equal(snap.attempt, 5);
  assert.equal(t.canFinalize(), true);
  assert.equal(t.mustContinue(), false);
});

test("resending the same source forever ends the turn instead of looping", () => {
  const t = tracker();
  t.begin({ targetDeclaration: "t", profile: "core" });
  t.beforeAttempt({ code: "stuck" });
  t.recordResult(failed("unsolved goals"));

  let guard = 0;
  let last = null;
  while (guard++ < 20) {
    last = t.beforeAttempt({ code: "stuck" });
    if (last.state === "budget_exhausted") break;
  }

  assert.ok(guard < 20, "the unchanged-source refusal must be bounded");
  assert.equal(last.allowed, false);
  assert.equal(last.code, "LEAN_SOURCE_UNCHANGED_BUDGET_EXHAUSTED");
  assert.equal(t.snapshot().state, "budget_exhausted");
  assert.equal(t.snapshot().terminalReason, "SOURCE_UNCHANGED_BUDGET_EXHAUSTED");
  assert.equal(t.snapshot().verified, false);
  assert.equal(t.canFinalize(), true, "the turn may end — as NOT_VERIFIED");
});

test("a repaired source clears the unchanged-source counter", () => {
  const t = tracker();
  t.begin({ targetDeclaration: "t", profile: "core" });
  t.beforeAttempt({ code: "one" });
  t.recordResult(failed("unsolved goals"));
  assert.equal(t.beforeAttempt({ code: "one" }).allowed, false);
  assert.equal(t.beforeAttempt({ code: "two" }).allowed, true);
  assert.equal(t.unchangedSourceRejections, 0);
});

test("the published answer must show the source that was verified", () => {
  const verified = "theorem t : ∀ n : Nat, n + 0 = n := by\n  intro n\n  exact Nat.add_zero n\n";

  assert.equal(
    leanAnswerMatchesVerifiedSource({
      answerText: "STATO: VERIFIED",
      verifiedSource: verified,
      requireSource: true,
    }),
    false
  );

  for (const language of ["lean", "lean4"]) {
    assert.equal(
      leanAnswerMatchesVerifiedSource({
        answerText: `Ecco la prova:\n\n\`\`\`${language}\n${verified}\`\`\``,
        verifiedSource: verified,
      }),
      true
    );
  }

  assert.equal(
    leanAnswerMatchesVerifiedSource({
      answerText:
        "```lean\ntheorem t : ∀ n : Nat, n + 0 = n := by   \n  intro n\n  exact Nat.add_zero n\n```",
      verifiedSource: verified,
    }),
    true
  );

  assert.equal(
    leanAnswerMatchesVerifiedSource({
      answerText: "```lean\ntheorem t : ∀ n : Nat, n + 0 = n := by\n  simp\n```",
      verifiedSource: verified,
    }),
    false
  );

  assert.equal(
    leanAnswerMatchesVerifiedSource({
      answerText:
        "Prima:\n```lean\ntheorem t := by simp\n```\nPoi:\n```lean\n" + verified + "```",
      verifiedSource: verified,
    }),
    true
  );

  assert.equal(
    leanAnswerMatchesVerifiedSource({
      answerText: "```lean\nanything\n```",
      verifiedSource: null,
    }),
    false
  );
});
test("the tracker keeps the exact source that elaborated", () => {
  const t = tracker();
  t.begin({ targetDeclaration: "t", profile: "core" });
  const good = "theorem t : True := trivial\n";
  t.beforeAttempt({ code: "theorem t : True := by rw [foo]\n" });
  t.recordResult(failed("unsolved goals"));
  t.beforeAttempt({ code: good });
  t.recordResult(checked());
  assert.equal(t.checkedSource, good);
  assert.equal(
    leanAnswerMatchesVerifiedSource({
      answerText: "```lean\n" + good + "```",
      verifiedSource: t.checkedSource,
    }),
    true
  );
});

test("requireSource=false permits prose but null verified source still fails closed", () => {
  assert.equal(
    leanAnswerMatchesVerifiedSource({
      answerText: "No source is claimed.",
      verifiedSource: "theorem hidden : True := by trivial",
      requireSource: false,
    }),
    true
  );
  assert.equal(
    leanAnswerMatchesVerifiedSource({
      answerText: "No source is claimed.",
      verifiedSource: null,
      requireSource: false,
    }),
    false
  );
});

// ── refactoring.003 R003-07: the budget is data, not an inference ───────────

test("BUDGET-01/03/05 the tracker reports wall clock, and it is never negative", () => {
  let clock = 1_000;
  const tracker = new LeanTurnTracker(
    { ...LEAN_ORCHESTRATION_DEFAULTS, maxWallClockMs: 360_000 },
    () => clock,
  );
  tracker.begin({ proofId: "p1", targetDeclaration: "t", profile: "core" });

  assert.equal(tracker.elapsedWallClockMs(), 0);
  assert.equal(tracker.remainingWallClockMs(), 360_000);

  // Two calls with 30s and 90s per-call timeouts do not add up to the elapsed
  // wall clock — this is exactly the arithmetic the observed model did.
  clock += 241_233;
  assert.equal(tracker.elapsedWallClockMs(), 241_233);
  assert.equal(tracker.remainingWallClockMs(), 118_767);

  const snapshot = tracker.snapshot();
  assert.equal(snapshot.elapsedWallClockMs, 241_233);
  assert.equal(snapshot.maxWallClockMs, 360_000);
  assert.equal(snapshot.remainingWallClockMs, 118_767);

  // Past the budget, remaining is 0 rather than a negative "time left".
  clock += 500_000;
  assert.equal(tracker.remainingWallClockMs(), 0);
  assert.equal(tracker.snapshot().remainingWallClockMs, 0);
});

// --- WP03: candidate preflight and attempt accounting ---

test("TRACK-CP-01: candidate preflight rolls back attempt and sets repair_required", () => {
  const t = tracker();
  t.begin({ targetDeclaration: "t", profile: "core" });
  const before = t.beforeAttempt({ sourceSha256: "aaa" });
  assert.equal(before.allowed, true);
  assert.equal(before.attempt, 1);

  const snap = t.recordResult({
    status: "rejected",
    isError: true,
    errorCode: "LEAN_CANDIDATE_PREFLIGHT_BLOCKED",
    attemptConsumed: false,
    exitCode: null,
    timedOut: false,
    cancelled: false,
    diagnostics: [],
  });

  assert.equal(snap.attempt, 0, "attempt rolled back");
  assert.equal(snap.state, "repair_required");
  assert.equal(t.mustContinue(), true);
  assert.equal(t.canFinalize(), false);
  assert.equal(snap.failureClass, "candidate_preflight");
});

test("TRACK-CP-02: after preflight rollback, next attempt is allowed at attempt=1", () => {
  const t = tracker();
  t.begin({ targetDeclaration: "t", profile: "core" });
  t.beforeAttempt({ sourceSha256: "aaa" });
  t.recordResult({
    status: "rejected",
    isError: true,
    errorCode: "LEAN_CANDIDATE_PREFLIGHT_BLOCKED",
    attemptConsumed: false,
    exitCode: null,
    timedOut: false,
    cancelled: false,
    diagnostics: [],
  });

  const next = t.beforeAttempt({ sourceSha256: "bbb" });
  assert.equal(next.allowed, true);
  assert.equal(next.attempt, 1);
});

test("TRACK-CP-03: fixed candidate after preflight rollback verifies at attempt=1 (D10.2)", () => {
  const t = tracker();
  t.begin({ targetDeclaration: "t", profile: "core" });
  t.beforeAttempt({ sourceSha256: "aaa" });
  t.recordResult({
    status: "rejected",
    isError: true,
    errorCode: "LEAN_CANDIDATE_PREFLIGHT_BLOCKED",
    attemptConsumed: false,
    exitCode: null,
    timedOut: false,
    cancelled: false,
    diagnostics: [],
  });

  const next = t.beforeAttempt({ sourceSha256: "bbb" });
  assert.equal(next.attempt, 1);
  t.recordResult(checked("b".repeat(64)));

  const snap = t.snapshot();
  assert.equal(snap.state, "verified");
  assert.equal(snap.verified, true);
  assert.equal(snap.attempt, 1);
  assert.equal(t.canFinalize(), true);
});

test("TRACK-CONTRACT: generic contract error sets contract_block terminal", () => {
  const t = tracker();
  t.begin({ targetDeclaration: "t", profile: "core" });
  t.beforeAttempt({ sourceSha256: "aaa" });
  const snap = t.recordResult({
    status: "rejected",
    isError: true,
    errorCode: "LEAN_CONTRACT_REVISION_MISMATCH",
    attemptConsumed: false,
    exitCode: null,
    timedOut: false,
    cancelled: false,
    diagnostics: [],
  });

  assert.equal(snap.state, "contract_block");
  assert.equal(snap.terminal, true);
  assert.equal(snap.verified, false);
});

// F1.4 — a silent transport timeout produces no lean_result_v1 at all. The
// watchdog (D-017) ends the stream, but nothing ever calls recordResult, so the
// proof task must still read as owed: never finalizable, never verified, and
// still resumable. The failure this guards against is a turn that goes quiet and
// is then treated as finished.
test("TRACK-PENDING: a silent transport timeout leaves the proof task pending", () => {
  const t = tracker();
  t.begin({ targetDeclaration: "t", profile: "core" });
  t.beforeAttempt({ sourceSha256: "aaa", code: "theorem t : True := trivial" });

  // The stream died here. No result, no classification, no terminal reason.
  const snap = t.snapshot();
  assert.equal(snap.state, "checking");
  assert.equal(snap.terminal, false);
  assert.equal(snap.verified, false);
  assert.equal(snap.terminalReason, null);
  assert.equal(t.canFinalize(), false, "a silent timeout must not release a final answer");
  assert.equal(t.mustContinue(), true, "the turn still owes another lean_check");
});

test("TRACK-PENDING: the same source may be resent after a transport failure", () => {
  const t = tracker();
  t.begin({ targetDeclaration: "t", profile: "core" });
  t.beforeAttempt({ sourceSha256: "aaa", code: "theorem t : True := trivial" });

  // §8.6: the source was never the problem, so the one authorized retry sends
  // the identical bytes rather than forcing a pointless edit.
  const retry = t.beforeAttempt({ sourceSha256: "aaa", allowUnchangedSource: true });
  assert.equal(retry.allowed, true);
  assert.equal(retry.attempt, 2);
  assert.equal(t.canFinalize(), false);
});

// F3.1 — doc6's live regression: the model cycled invented theorem names, each
// producing a *different* unknown_identifier message. The fingerprint never
// repeated, so the old rule (identical failure only) never escalated and the
// model was free to keep guessing until the attempt budget ran out. Distinct
// candidates that keep failing the same way must force a strategy change.
test("TRACK-ESCALATE: distinct candidates failing the same class force a strategy change", () => {
  const t = tracker();
  t.begin({ targetDeclaration: "t", profile: "core" });

  const names = ["Nat.add_comm_foo", "Nat.addCommBar", "Nat.add_commute_baz"];
  const snapshots = names.map((name, i) => {
    t.beforeAttempt({ sourceSha256: String(i).repeat(64) });
    return t.recordResult(
      failed(`Main.lean:3:2: error: unknown identifier '${name}'`)
    );
  });

  // Every fingerprint is distinct — this is the case the old rule missed.
  const fingerprints = new Set(snapshots.map((s) => s.diagnosticFingerprint));
  assert.equal(fingerprints.size, names.length, "the candidates must fail differently");
  assert.equal(snapshots[0].sameFailureCount, 1);
  assert.equal(snapshots[2].sameFailureCount, 1);

  // The class does repeat, and that is what escalates: two rounds of ordinary
  // repair, then a forced change of approach on the third.
  assert.deepEqual(
    snapshots.map((s) => s.sameClassCount),
    [1, 2, 3]
  );
  assert.equal(snapshots[0].strategyChangeRequired, false);
  assert.equal(snapshots[1].strategyChangeRequired, false);
  assert.equal(snapshots[2].strategyChangeRequired, true, "the Nth must escalate");
  assert.equal(snapshots[2].state, "strategy_change_required");
  assert.match(snapshots[2].nextAction, /lean_inspect/);
});

test("TRACK-ESCALATE: a class that actually moves resets the escalation counter", () => {
  const t = tracker();
  t.begin({ targetDeclaration: "t", profile: "core" });

  t.beforeAttempt({ sourceSha256: "1".repeat(64) });
  t.recordResult(failed("Main.lean:3:2: error: unknown identifier 'Foo.bar'"));
  t.beforeAttempt({ sourceSha256: "2".repeat(64) });
  const second = t.recordResult(failed("Main.lean:3:2: error: unknown identifier 'Foo.baz'"));
  assert.equal(second.sameClassCount, 2);

  // Real progress: the name resolved, the proof now has a residual goal.
  t.beforeAttempt({ sourceSha256: "3".repeat(64) });
  const moved = t.recordResult(failed("Main.lean:5:0: error: unsolved goals\n⊢ n + 0 = n"));
  assert.equal(moved.failureClass, "unsolved_goals");
  assert.equal(moved.sameClassCount, 1, "a different class starts a fresh count");
  assert.equal(moved.strategyChangeRequired, false);
  assert.equal(moved.state, "repair_required");
});

// ---------------------------------------------------------------------------
// WP05 — target identity and profile lock.
// ---------------------------------------------------------------------------

test("TRACK-TARGET-01 begin locks the target name", () => {
  const t = tracker();
  const snap = t.begin({ targetDeclaration: "cauchy_mean_value", profile: "mathlib" });
  assert.equal(snap.allowed, true);
  assert.equal(snap.targetDeclaration, "cauchy_mean_value");
  assert.equal(t.snapshot().profile, "mathlib");
});

test("TRACK-TARGET-02 retry with the same target is allowed", () => {
  const t = tracker();
  t.begin({ targetDeclaration: "t", profile: "core" });
  t.beforeAttempt({ code: "one" });
  t.recordResult(failed("unsolved goals"));
  const again = t.begin({ targetDeclaration: "t" });
  assert.equal(again.allowed, true);
  const retry = t.beforeAttempt({ code: "two", targetDeclaration: "t" });
  assert.equal(retry.allowed, true);
});

test("TRACK-TARGET-03 a different target name is refused without spending an attempt", () => {
  const t = tracker();
  t.begin({ targetDeclaration: "cauchy_mean_value", profile: "core" });
  t.beforeAttempt({ code: "one" });
  const refusal = t.beforeAttempt({ code: "two", targetDeclaration: "test" });
  assert.equal(refusal.allowed, false);
  assert.equal(refusal.code, "LEAN_TARGET_DECLARATION_MISMATCH");
  assert.equal(t.snapshot().attempt, 1, "refused attempt must not burn budget");
});

test("TRACK-TARGET-04 the first target hash locks even on candidate_preflight", () => {
  const t = tracker();
  t.begin({ targetDeclaration: "t", profile: "core" });
  t.beforeAttempt({ code: "sorry-proof" });
  const snap = t.recordResult({
    status: "rejected",
    isError: true,
    errorCode: "LEAN_CANDIDATE_PREFLIGHT_BLOCKED",
    attemptConsumed: false,
    timedOut: false,
    cancelled: false,
    exitCode: null,
    diagnostics: [],
    taskMode: "proof",
    targetDeclaration: "t",
    targetIdentityAlgorithm: "lean-target-statement-v1",
    targetStatementSha256: "d".repeat(64),
    targetIdentityMatched: true,
  });
  assert.equal(snap.targetStatementSha256, "d".repeat(64));
  assert.equal(snap.state, "repair_required");
});

test("TRACK-TARGET-05 same name but different statement hash never verifies", () => {
  const t = tracker();
  t.begin({ targetDeclaration: "t", profile: "core" });
  t.beforeAttempt({ code: "theorem t : True := by trivial" });
  t.recordResult({
    ...checked(),
    status: "rejected",
    isError: true,
    errorCode: "LEAN_CANDIDATE_PREFLIGHT_BLOCKED",
    attemptConsumed: false,
    exitCode: null,
  });
  // Locked now. A retry that keeps the name but swaps the statement must be
  // refused by the executor pre-spawn; if one slips through anyway the
  // tracker must not verify it.
  t.beforeAttempt({ code: "theorem t : 1 + 1 = 2 := by decide" });
  const snap = t.recordResult({ ...checked(), targetStatementSha256: "e".repeat(64) });
  assert.equal(snap.verified, false);
  assert.equal(snap.state, "repair_required");
  assert.equal(snap.failureClass, "target_identity");
  assert.equal(snap.targetStatementSha256, "c".repeat(64), "locked hash is never overwritten");
});

test("TRACK-TARGET-06 verified requires checked hash == locked hash", () => {
  const t = tracker();
  t.begin({ targetDeclaration: "t", profile: "core" });
  t.beforeAttempt({ code: "one" });
  const snap = t.recordResult(checked());
  assert.equal(snap.state, "verified");
  assert.equal(snap.checkedTargetStatementSha256, snap.targetStatementSha256);
  assert.equal(snap.targetIdentityMatched, true);
});

test("TRACK-PROFILE-01 profile is locked on begin", () => {
  const t = tracker();
  const snap = t.begin({ targetDeclaration: "t", profile: "mathlib" });
  assert.equal(snap.profile, "mathlib");
});

test("TRACK-PROFILE-02 a profile change within one proof is blocked", () => {
  const t = tracker();
  t.begin({ targetDeclaration: "t", profile: "mathlib" });
  t.beforeAttempt({ code: "one", profile: "mathlib" });
  const switched = t.beforeAttempt({ code: "two", profile: "core" });
  assert.equal(switched.allowed, false);
  assert.equal(switched.code, "LEAN_PROFILE_CHANGED_WITHIN_PROOF");
  assert.equal(t.snapshot().attempt, 1);
});

test("TRACK-SNAPSHOT-01 snapshot exposes the target identity fields", () => {
  const t = tracker();
  t.begin({ targetDeclaration: "cauchy_mean_value", profile: "core" });
  t.beforeAttempt({ code: "one" });
  const snap = t.recordResult(checked("b".repeat(64)));
  assert.equal(snap.targetDeclaration, "cauchy_mean_value");
  assert.equal(snap.targetStatementSha256, "c".repeat(64));
  assert.equal(snap.targetIdentityAlgorithm, "lean-target-statement-v1");
  assert.equal(snap.checkedTargetStatementSha256, "c".repeat(64));
  assert.equal(snap.targetIdentityMatched, true);
  assert.equal(snap.profile, "core");
  assert.equal(snap.checkedProfile, "core");
});

test("a verified-looking result under a different profile never records checkedProfile", () => {
  const t = tracker();
  t.begin({ targetDeclaration: "t", profile: "mathlib" });
  t.beforeAttempt({ code: "one" });
  const snap = t.recordResult(checked("b".repeat(64)));
  // The result claims proof-mode identity for the locked statement but was
  // elaborated under a different profile than the one locked at begin.
  // checkedProfile stays unset so the finalization gate can refuse VERIFIED.
  assert.equal(snap.state, "verified");
  assert.equal(snap.checkedProfile, null);
});

test("begin without a target declaration refuses to mint a proof task", () => {
  const t = tracker();
  const refusal = t.begin({});
  assert.equal(refusal.allowed, false);
  assert.equal(refusal.code, "LEAN_TARGET_DECLARATION_REQUIRED");
  assert.equal(t.used, false);
});

// ============================================================================
// §11.2/§61 — the target may not be derived from the first lean_check
// ============================================================================
//
// This is the regression the sealed spec exists for. Before it, the tracker
// locked whatever statement the first result reported, so a candidate that
// redefined the theorem locked *itself* as the task, matched itself, and
// reached verified. Lean was never wrong: it really did check that term.

const CAUCHY_HEADER =
  "theorem cauchy_mvt (f g : ℝ → ℝ) (a b : ℝ) (hab : a < b) :\n" +
  "    ∃ c ∈ Set.Ioo a b, deriv f c * (g b - g a) = deriv g c * (f b - f a)";

function sealedCauchySpec() {
  const sealed = createLeanTaskSpec({
    targetDeclaration: "cauchy_mvt",
    targetStatement: CAUCHY_HEADER,
    requiredProfile: "mathlib",
  });
  assert.equal(sealed.ok, true);
  return sealed.value;
}

test("a sealed spec locks the statement before the first attempt", () => {
  const t = tracker();
  const spec = sealedCauchySpec();
  const began = t.begin({ targetDeclaration: "cauchy_mvt", profile: "mathlib", taskSpec: spec });

  assert.equal(began.allowed, true);
  const snap = t.snapshot();
  assert.equal(snap.taskSpecSealed, true);
  assert.equal(snap.targetStatementSha256, spec.targetStatementSha256);
  assert.equal(snap.requiredProfile, "mathlib");
  // Nothing has run yet — the task is defined before any candidate exists.
  assert.equal(snap.attempt, 0);
});

test("§61 a checked candidate that redefined the theorem never verifies", () => {
  const t = tracker();
  const spec = sealedCauchySpec();
  t.begin({ targetDeclaration: "cauchy_mvt", profile: "mathlib", taskSpec: spec });
  t.beforeAttempt({ code: "theorem cauchy_mvt : True := by trivial", targetDeclaration: "cauchy_mvt", profile: "mathlib" });

  // Lean genuinely checked it — status=checked, no diagnostics.
  const snap = t.recordResult({
    ...checked("d".repeat(64)),
    profile: "mathlib",
    targetDeclaration: "cauchy_mvt",
    targetStatementSha256: "e".repeat(64),
    targetIdentityMatched: true,
  });

  assert.equal(snap.verified, false);
  assert.equal(snap.state, "repair_required");
  assert.equal(snap.failureClass, "target_identity");
  assert.match(snap.nextAction, /sealed target/);
});

test("a candidate that states the sealed target does verify", () => {
  const t = tracker();
  const spec = sealedCauchySpec();
  t.begin({ targetDeclaration: "cauchy_mvt", profile: "mathlib", taskSpec: spec });
  t.beforeAttempt({ code: `${CAUCHY_HEADER} := by\n  exact real_proof`, targetDeclaration: "cauchy_mvt", profile: "mathlib" });

  const snap = t.recordResult({
    ...checked("f".repeat(64)),
    profile: "mathlib",
    targetDeclaration: "cauchy_mvt",
    targetStatementSha256: spec.targetStatementSha256,
    targetIdentityMatched: true,
  });

  assert.equal(snap.verified, true);
  assert.equal(snap.taskSpecSealed, true);
  assert.equal(snap.checkedTargetStatementSha256, spec.targetStatementSha256);
});

test("§60 a sealed spec refuses a renamed target on a later call", () => {
  const t = tracker();
  const spec = sealedCauchySpec();
  t.begin({ targetDeclaration: "cauchy_mvt", profile: "mathlib", taskSpec: spec });

  const again = t.begin({ targetDeclaration: "easier_thm", profile: "mathlib", taskSpec: spec });
  assert.equal(again.allowed, false);
  // The pre-existing declaration lock speaks first; either refusal is correct
  // so long as the rename never proceeds.
  assert.match(again.code, /LEAN_TARGET_DECLARATION_MISMATCH|LEAN_TASKSPEC_MUTATION_ATTEMPT/);
});

test("without a sealed spec the snapshot says so", () => {
  const t = tracker();
  t.begin({ targetDeclaration: "t", profile: "core" });
  assert.equal(t.snapshot().taskSpecSealed, false);
});
