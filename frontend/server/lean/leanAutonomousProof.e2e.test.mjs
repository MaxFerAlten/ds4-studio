// End-to-end regression for the autonomous Lean orchestration.
//
// This reproduces the conversation that motivated the whole change: a single
// user message, five Lean candidates, and a model that after every failure
// wanted to answer in prose and ask the user to write again.
//
// Hermetic by construction — the Lean process is injected, so the real
// contract, the real classifier and the real turn tracker run without a
// toolchain. What is *not* stubbed is the decision path: every "may I answer
// now" question is asked of the same LeanTurnTracker the agent loop uses.

import test from "node:test";
import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { executeLeanCheck } from "./leanExecutor.mjs";
import { normalizeLeanRequest } from "./leanContract.mjs";
import { LeanTurnTracker } from "./leanTurnTracker.mjs";
import { LEAN_ORCHESTRATION_DEFAULTS } from "./leanOrchestrationConfig.mjs";
import { createLeanMetrics } from "./leanMetrics.mjs";

const RUNS_ROOT = resolve(tmpdir(), `ds4-lean-e2e-${process.pid}`);

const CONFIG = {
  enabled: true,
  sandboxRequired: false,
  bwrapBin: "/usr/bin/bwrap",
  prlimitBin: "/usr/bin/prlimit",
  runtimeRoot: "/nonexistent/lean-runtime",
  runsRoot: RUNS_ROOT,
  elanRoot: "/nonexistent/.elan",
  defaultProfile: "core",
  defaultTimeoutSec: 30,
  maxTimeoutSec: 120,
  maxStdoutBytes: 64 * 1024,
  maxStderrBytes: 128 * 1024,
  maxDiagnostics: 200,
  memoryBytes: 4294967296,
  addressSpaceBytes: 17179869184,
  leanThreads: 4,
  cpuSeconds: 30,
  maxProcesses: 512,
  maxOpenFiles: 128,
  retentionHours: 24,
  orchestration: LEAN_ORCHESTRATION_DEFAULTS
};

const PREFLIGHT = {
  ok: true,
  profiles: {
    core: { ok: true, toolchain: "leanprover/lean4:v4.32.2" },
    mathlib: { ok: true, toolchain: "leanprover/lean4:v4.32.2" }
  }
};

const SANDBOX_OK = async () => ({
  ok: true,
  toolchain: { dir: "/toolchains/lean", descriptor: "leanprover/lean4:v4.32.2" }
});

/**
 * The five candidates of the reproduced conversation, each with the Lean
 * output it produced. The source differs every time — a byte-identical retry
 * is refused before the spawn, which is itself part of the contract.
 */
const CANDIDATES = [
  {
    code: "import Mathlib\ntheorem t : ∀ n : Nat, n + 0 = n := by\n  simp\n",
    process: { exitCode: null, timedOut: true, durationMs: 30000, stdout: "", stderr: "" }
  },
  {
    code: "theorem t : ∀ n : Nat, n + 0 = n := by\n  intro n\n  rfl\n/- unterminated\n",
    process: {
      exitCode: 1,
      stdout: "Main.lean:1:0: error: unterminated comment\n"
    }
  },
  {
    code: "theorem t : ∀ n : Nat, n + 0 = n := by\n  intro n\n  induction n with\n  | succ => rfl\n",
    process: {
      exitCode: 1,
      stdout: "Main.lean:3:2: error: invalid alternative name 'succ', expected 'zero' or 'succ'\n"
    }
  },
  {
    code: "theorem t : ∀ n : Nat, n + 0 = n := by\n  intro n\n  rw [Nat.add_comm, Nat.zero_add]\n",
    process: {
      exitCode: 1,
      stdout:
        "Main.lean:3:2: error: tactic 'rewrite' failed, did not find instance of the pattern in the target expression\n" +
        "  0 + ?n\n" +
        "n : Nat\n" +
        "⊢ n + 0 = n\n"
    }
  },
  {
    code: "theorem t : ∀ n : Nat, n + 0 = n := by\n  intro n\n  exact Nat.add_zero n\n",
    process: { exitCode: 0, stdout: "" }
  }
];

function processRunnerFor(step) {
  return async () => ({
    exitCode: 0,
    signal: null,
    timedOut: false,
    cancelled: false,
    durationMs: 25,
    stdout: "",
    stderr: "",
    stdoutTruncated: false,
    stderrTruncated: false,
    pid: 4242,
    ...step
  });
}

test.after(async () => {
  await rm(RUNS_ROOT, { recursive: true, force: true });
});

test("one user message drives five candidates to checked without asking the user again", async () => {
  const tracker = new LeanTurnTracker(CONFIG.orchestration);
  const metrics = createLeanMetrics();

  // The model fixture reproduces the observed behaviour: after the first three
  // failures it tries to answer in prose ("dovrebbe passare", "scrivimi di
  // nuovo"), and only the orchestrator's guidance sends it back to lean_check.
  // From the fourth it complies. Every one of those attempts must be refused,
  // and the turn must still reach checked without a second user message.
  const modelTriesToFinalizeAfterFailure = (index) => index < 3;

  const userMessages = ["Dimostra il teorema usando Lean 4"];
  const leanCalls = [];
  const blockedFinalizations = [];
  const publishedAnswers = [];

  tracker.begin({ targetDeclaration: "t" });
  const proofId = tracker.snapshot().proofId;

  for (const [index, candidate] of CANDIDATES.entries()) {
    const gate = tracker.beforeAttempt({ code: candidate.code });
    assert.equal(gate.allowed, true, "every repaired candidate must be admitted");

    const normalized = normalizeLeanRequest(
      {
        contractVersion: "lean_check_request_v1",
        code: candidate.code,
        sessionId: "session-e2e",
        proofId,
        attempt: gate.attempt,
        taskMode: "proof",
        targetDeclaration: "t",
        // Orchestrator-owned: the statement locked by the first useful result,
        // never a hash the model supplied.
        expectedTargetStatementSha256:
          tracker.snapshot().targetStatementSha256 || undefined
      },
      CONFIG
    );
    assert.equal(normalized.ok, true, JSON.stringify(normalized.error));

    const result = await executeLeanCheck(normalized.value, {
      config: CONFIG,
      preflight: PREFLIGHT,
      resolveSandbox: SANDBOX_OK,
      processRunner: processRunnerFor(candidate.process),
      metrics,
      orchestrationContext: {
        previousFingerprint: tracker.lastFingerprint,
        sameFailureCount: tracker.sameFailureCount,
        strategyChangeAfter: CONFIG.orchestration.strategyChangeAfter
      }
    });
    leanCalls.push(result);
    tracker.recordResult(result);

    if (tracker.mustContinue()) {
      // A repairable failure: no answer may be committed, whatever the model
      // wrote. If it tried anyway, the attempt is counted and answered with
      // canonical guidance rather than published.
      assert.equal(tracker.canFinalize(), false, `attempt ${index + 1} must not finalize`);
      if (modelTriesToFinalizeAfterFailure(index)) {
        const block = tracker.recordPrematureFinalization();
        assert.equal(block.retryAllowed, true);
        blockedFinalizations.push(block.guidance);
      }
      continue;
    }
    publishedAnswers.push(tracker.snapshot());
  }

  // One user message: the loop never needed a second one.
  assert.equal(userMessages.length, 1);

  // Five Lean calls, one proof task, attempts numbered 1..5.
  assert.equal(leanCalls.length, 5);
  assert.deepEqual(
    leanCalls.map((r) => r.orchestration.attempt),
    [1, 2, 3, 4, 5]
  );
  assert.equal(new Set(leanCalls.map((r) => r.proofId)).size, 1);
  assert.deepEqual(
    leanCalls.map((r) => r.runId).filter((v, i, a) => a.indexOf(v) === i).length,
    5,
    "each attempt gets its own run id"
  );

  // The four failures were classified, and none of them was terminal.
  assert.deepEqual(
    leanCalls.slice(0, 4).map((r) => r.orchestration.failureClass),
    ["timeout_repairable", "syntax", "proof_failure", "rewrite_miss"]
  );
  for (const failed of leanCalls.slice(0, 4)) {
    assert.equal(failed.orchestration.verified, false);
    assert.equal(failed.orchestration.terminal, false);
    assert.equal(failed.orchestration.retryable, true);
  }

  // Every premature finalization was blocked, and exactly one answer published.
  assert.equal(blockedFinalizations.length, 3);
  for (const guidance of blockedFinalizations) {
    assert.match(guidance, /LEAN_FINALIZATION_BLOCKED/);
    assert.match(guidance, /call lean_check again/i);
    // The guidance may forbid asking the user; it must never request a turn.
    assert.doesNotMatch(guidance, /(?<!do not )ask the user to (send|write|continue)/i);
  }
  assert.equal(publishedAnswers.length, 1);

  // The published answer is the verified one, tied to the source that elaborated.
  const final = publishedAnswers[0];
  assert.equal(final.state, "verified");
  assert.equal(final.verified, true);
  assert.equal(final.attempt, 5);
  assert.equal(final.checkedSourceSha256, leanCalls[4].sourceArtifact.sha256);
  assert.equal(leanCalls[4].orchestration.verified, true);
  assert.equal(leanCalls[4].orchestration.terminal, true);

  // Metrics see one task, five attempts, one verified outcome.
  const snap = metrics.snapshot().orchestration;
  assert.equal(snap.proof_tasks_total, 1);
  assert.equal(snap.proof_attempts_total, 5);
  assert.equal(snap.proof_verified_total, 1);
  assert.equal(snap.proof_not_verified_total, 0);
});

test("attempt 4 is admitted — the old literal-3 ceiling would have refused it", async () => {
  const tracker = new LeanTurnTracker(CONFIG.orchestration);
  tracker.begin({ targetDeclaration: "t" });
  for (let i = 1; i <= 4; i += 1) {
    const gate = tracker.beforeAttempt({ code: `candidate ${i}` });
    assert.equal(gate.allowed, true, `attempt ${i} must be admitted`);
    assert.equal(gate.attempt, i);
    if (i < 4) {
      tracker.recordResult({
        contractVersion: "lean_result_v1",
        status: "failed",
        isError: true,
        exitCode: 1,
        diagnostics: [{ severity: "error", message: `unsolved goals ${i}` }]
      });
    }
  }

  // …and the contract layer agrees, instead of rejecting attempt 4 as invalid.
  const normalized = normalizeLeanRequest(
    {
      contractVersion: "lean_check_request_v1",
      code: "theorem t : True := trivial",
      sessionId: "session-e2e",
      attempt: 4
    },
    CONFIG
  );
  assert.equal(normalized.ok, true);
});

test("an infrastructure block ends the turn without a proof claim", async () => {
  const tracker = new LeanTurnTracker(CONFIG.orchestration);
  tracker.begin({ targetDeclaration: "t" });
  tracker.beforeAttempt({ code: "theorem t : True := trivial" });

  const normalized = normalizeLeanRequest(
    {
      contractVersion: "lean_check_request_v1",
      code: "theorem t : True := trivial",
      sessionId: "session-e2e",
      attempt: 1
    },
    CONFIG
  );
  const result = await executeLeanCheck(normalized.value, {
    config: CONFIG,
    // No usable profile: the runtime, not the proof, is broken.
    preflight: { ok: false, profiles: { core: { ok: false } } },
    resolveSandbox: SANDBOX_OK,
    processRunner: processRunnerFor({ exitCode: 0 })
  });

  assert.equal(result.orchestration.verified, false);
  assert.equal(result.orchestration.terminal, true);
  assert.equal(result.orchestration.failureClass, "infrastructure");

  const snapshot = tracker.recordResult(result);
  assert.equal(snapshot.state, "infrastructure_block");
  assert.equal(tracker.canFinalize(), true, "a NOT_VERIFIED answer is allowed");
  assert.equal(tracker.mustContinue(), false, "there is nothing left to repair");
  assert.equal(snapshot.verified, false);
});

test("the same failure twice forces a strategy change before the next attempt", async () => {
  const tracker = new LeanTurnTracker(CONFIG.orchestration);
  tracker.begin({ targetDeclaration: "t" });

  const stdout =
    "Main.lean:3:2: error: tactic 'rewrite' failed, did not find instance of the pattern in the target expression\n";
  for (const code of ["candidate A", "candidate B"]) {
    tracker.beforeAttempt({ code });
    const normalized = normalizeLeanRequest(
      {
        contractVersion: "lean_check_request_v1",
        code,
        sessionId: "session-e2e",
        attempt: tracker.snapshot().attempt
      },
      CONFIG
    );
    const result = await executeLeanCheck(normalized.value, {
      config: CONFIG,
      preflight: PREFLIGHT,
      resolveSandbox: SANDBOX_OK,
      processRunner: processRunnerFor({ exitCode: 1, stdout })
    });
    tracker.recordResult(result);
  }

  const snapshot = tracker.snapshot();
  assert.equal(snapshot.state, "strategy_change_required");
  assert.equal(snapshot.sameFailureCount, 2);
  assert.equal(tracker.canFinalize(), false);
  assert.match(snapshot.nextAction, /change proof strategy/);
});

test("a model that refuses to repair ends as NOT_VERIFIED instead of looping", () => {
  const tracker = new LeanTurnTracker(CONFIG.orchestration);
  tracker.begin({ targetDeclaration: "t" });
  tracker.beforeAttempt({ code: "theorem t : True := by rw [foo]" });
  tracker.recordResult({
    contractVersion: "lean_result_v1",
    status: "failed",
    isError: true,
    exitCode: 1,
    diagnostics: [{ severity: "error", message: "unsolved goals" }]
  });

  const guidances = [];
  let guard = 0;
  // The model keeps writing prose instead of calling lean_check again.
  while (tracker.mustContinue() && guard++ < 20) {
    const block = tracker.recordPrematureFinalization();
    if (!block.retryAllowed) break;
    guidances.push(block.guidance);
  }

  assert.ok(guard < 20, "the premature-finalization budget must terminate the loop");
  assert.equal(guidances.length, CONFIG.orchestration.maxPrematureFinalizations);
  const snapshot = tracker.snapshot();
  assert.equal(snapshot.state, "budget_exhausted");
  assert.equal(snapshot.verified, false);
  assert.equal(snapshot.terminalReason, "PREMATURE_FINALIZATION_BUDGET_EXHAUSTED");
  assert.equal(tracker.canFinalize(), true, "the turn may end — as NOT_VERIFIED");
});
