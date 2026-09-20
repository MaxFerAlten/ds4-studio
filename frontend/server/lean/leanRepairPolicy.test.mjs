// Tests for leanRepairPolicy.mjs
//
// Fixtures are built by running the production diagnostic parser over Lean's
// own output shape rather than by hand-writing diagnostic objects: a classifier
// that only ever sees invented strings is not evidence that it classifies what
// Lean actually prints (§6.6).

import test from "node:test";
import assert from "node:assert/strict";

import { parseLeanDiagnostics } from "./leanDiagnostics.mjs";
import {
  classifyLeanResult,
  leanDiagnosticFingerprint,
  normalizeMessage,
} from "./leanRepairPolicy.mjs";

/** Build a failed lean_result_v1 from raw Lean stdout. */
function failedResult(stdout, overrides = {}) {
  const { diagnostics } = parseLeanDiagnostics(stdout);
  return {
    contractVersion: "lean_result_v1",
    runId: "lean-a1b2c3d4e5f6-1700000000000-7",
    status: "failed",
    isError: true,
    exitCode: 1,
    timedOut: false,
    cancelled: false,
    diagnostics,
    summary: "Lean reported errors.",
    stdout,
    stderr: "",
    ...overrides,
  };
}

function checkedResult(overrides = {}) {
  return {
    contractVersion: "lean_result_v1",
    runId: "lean-a1b2c3d4e5f6-1700000000000-8",
    status: "checked",
    isError: false,
    exitCode: 0,
    timedOut: false,
    cancelled: false,
    diagnostics: [],
    summary: "Lean elaborated the file without errors.",
    taskMode: "proof",
    profile: "core",
    sourceSha256: "a".repeat(64),
    targetDeclaration: "t",
    targetIdentityAlgorithm: "lean-target-statement-v1",
    targetStatementSha256: "c".repeat(64),
    targetIdentityMatched: true,
    ...overrides,
  };
}

test("checked with sound invariants is the only verified outcome", () => {
  const decision = classifyLeanResult(checkedResult());
  assert.equal(decision.verified, true);
  assert.equal(decision.terminal, true);
  assert.equal(decision.retryable, false);
  assert.equal(decision.failureClass, null);
  assert.equal(decision.nextAction, "publish_verified_result");
  assert.equal(decision.diagnosticFingerprint, null);
});

test("checked that violates an invariant is never verified", () => {
  for (const broken of [{ exitCode: 1 }, { timedOut: true }, { cancelled: true }]) {
    const decision = classifyLeanResult(checkedResult(broken));
    assert.equal(decision.verified, false, JSON.stringify(broken));
    assert.equal(decision.terminal, true);
    assert.equal(decision.failureClass, "infrastructure");
    assert.equal(decision.terminalReason, "LEAN_CHECKED_INVARIANT_VIOLATION");
  }
});

test("cancelled is terminal and not a proof failure", () => {
  const decision = classifyLeanResult(
    failedResult("", { status: "cancelled", cancelled: true })
  );
  assert.equal(decision.failureClass, "user_cancelled");
  assert.equal(decision.terminal, true);
  assert.equal(decision.retryable, false);
  assert.equal(decision.terminalReason, "USER_CANCELLED");
});

test("preflight_failed and internal_error are infrastructure blocks", () => {
  const preflight = classifyLeanResult(
    failedResult("", { status: "preflight_failed", errorCode: "LEAN_RUNTIME_UNAVAILABLE" })
  );
  assert.equal(preflight.failureClass, "infrastructure");
  assert.equal(preflight.retryable, false);
  assert.equal(preflight.nextAction, "publish_not_verified_infrastructure_block");
  assert.equal(preflight.terminalReason, "LEAN_RUNTIME_UNAVAILABLE");

  const internal = classifyLeanResult(
    failedResult("", { status: "internal_error", errorCode: "LEAN_INTERNAL_ERROR" })
  );
  assert.equal(internal.failureClass, "infrastructure");
  assert.equal(internal.terminal, true);
});

test("rejected splits infrastructure from a caller contract error", () => {
  const sandbox = classifyLeanResult(
    failedResult("", { status: "rejected", errorCode: "LEAN_SANDBOX_UNAVAILABLE" })
  );
  assert.equal(sandbox.failureClass, "infrastructure");

  const contract = classifyLeanResult(
    failedResult("", { status: "rejected", errorCode: "LEAN_ATTEMPT_INVALID" })
  );
  assert.equal(contract.failureClass, "contract");
  assert.equal(contract.terminal, true);
  assert.equal(contract.retryable, false);
  assert.equal(contract.terminalReason, "LEAN_ATTEMPT_INVALID");
});

test("timeout is repairable, not a false proof", () => {
  const decision = classifyLeanResult(
    failedResult("", { status: "timeout", timedOut: true, exitCode: null })
  );
  assert.equal(decision.failureClass, "timeout_repairable");
  assert.equal(decision.retryable, true);
  assert.equal(decision.terminal, false);
  assert.match(decision.nextAction, /Narrow the imports/);
});

test("syntax errors classify as syntax", () => {
  const decision = classifyLeanResult(
    failedResult("Main.lean:3:0: error: unterminated comment\n")
  );
  assert.equal(decision.failureClass, "syntax");
  assert.equal(decision.retryable, true);
  assert.match(decision.nextAction, /Do not change the theorem statement/);
});

test("unknown identifiers classify as unknown_identifier", () => {
  const decision = classifyLeanResult(
    failedResult("Main.lean:5:2: error: unknown identifier 'Nat.succ_add_eq'\n")
  );
  assert.equal(decision.failureClass, "unknown_identifier");
  assert.match(decision.nextAction, /namespace, import and spelling/);
});

test("a rewrite that does not apply classifies as rewrite_miss", () => {
  const stdout = [
    "Main.lean:7:8: error: tactic 'rewrite' failed, did not find instance of the pattern in the target expression",
    "  n + 0",
    "n : Nat",
    "⊢ 0 + n = n",
  ].join("\n");
  const decision = classifyLeanResult(failedResult(stdout));
  assert.equal(decision.failureClass, "rewrite_miss");
  assert.match(decision.nextAction, /calc, change, conv/);
});

test("residual goals classify as unsolved_goals", () => {
  const stdout = ["Main.lean:9:0: error: unsolved goals", "n : Nat", "⊢ n + 0 = n"].join("\n");
  const decision = classifyLeanResult(failedResult(stdout));
  assert.equal(decision.failureClass, "unsolved_goals");
});

test("type mismatches classify as type_mismatch", () => {
  const stdout = [
    "Main.lean:4:11: error: type mismatch",
    "  h",
    "has type",
    "  a = b : Prop",
    "but is expected to have type",
    "  b = a : Prop",
  ].join("\n");
  const decision = classifyLeanResult(failedResult(stdout));
  assert.equal(decision.failureClass, "type_mismatch");
});

test("an unrecognised failure still yields a retryable proof_failure", () => {
  const decision = classifyLeanResult(
    failedResult("Main.lean:1:0: error: something Lean has never said before\n")
  );
  assert.equal(decision.failureClass, "proof_failure");
  assert.equal(decision.retryable, true);
  assert.equal(decision.terminal, false);
});

test("an induction error is a retryable proof failure, not terminal", () => {
  const stdout =
    "Main.lean:6:2: error: invalid alternative name 'succ', expected 'zero' or 'succ'\n";
  const decision = classifyLeanResult(failedResult(stdout));
  assert.equal(decision.retryable, true);
  assert.equal(decision.terminal, false);
});

test("the fingerprint ignores run-specific noise", () => {
  const a = failedResult(
    "Main.lean:9:0: error: unsolved goals in /tmp/lean-run-abc/Main.lean after 812 ms\n"
  );
  const b = failedResult(
    "Main.lean:9:0: error: unsolved goals in /tmp/lean-run-zzz/Main.lean after 1904 ms\n"
  );
  assert.equal(leanDiagnosticFingerprint(a), leanDiagnosticFingerprint(b));

  const different = failedResult("Main.lean:9:0: error: unknown identifier 'foo'\n");
  assert.notEqual(leanDiagnosticFingerprint(a), leanDiagnosticFingerprint(different));
});

test("normalizeMessage strips paths, run ids, addresses and durations", () => {
  const normalized = normalizeMessage(
    "failed at /tmp/x/Main.lean run lean-a1b2c3d4e5f6-1700000000000-7 at 0xdeadbeef after 42 ms"
  );
  assert.equal(normalized.includes("/tmp/x"), false);
  assert.equal(normalized.includes("lean-a1b2c3d4e5f6"), false);
  assert.equal(normalized.includes("0xdeadbeef"), false);
  assert.equal(normalized.includes("42 ms"), false);
});

test("the same failure twice demands a strategy change", () => {
  const result = failedResult(
    "Main.lean:7:8: error: tactic 'rewrite' failed, did not find instance of the pattern in the target expression\n"
  );
  const first = classifyLeanResult(result);
  assert.equal(first.strategyChangeRequired, false);
  assert.equal(first.sameFailureCount, 1);

  const second = classifyLeanResult(result, {
    previousFingerprint: first.diagnosticFingerprint,
    sameFailureCount: first.sameFailureCount,
    strategyChangeAfter: 2,
  });
  assert.equal(second.sameFailureCount, 2);
  assert.equal(second.strategyChangeRequired, true);
  assert.match(second.nextAction, /change proof strategy/);
});

test("a different failure resets the repetition counter", () => {
  const first = classifyLeanResult(failedResult("Main.lean:1:0: error: unsolved goals\n"));
  const second = classifyLeanResult(
    failedResult("Main.lean:2:0: error: unknown identifier 'zzz'\n"),
    { previousFingerprint: first.diagnosticFingerprint, sameFailureCount: 1 }
  );
  assert.equal(second.sameFailureCount, 1);
  assert.equal(second.strategyChangeRequired, false);
});

test("a missing result is treated as an infrastructure block, never as a proof", () => {
  const decision = classifyLeanResult(null);
  assert.equal(decision.verified, false);
  assert.equal(decision.terminal, true);
  assert.equal(decision.failureClass, "infrastructure");
});

// Wordings captured from the real toolchain (leanprover/lean4 v4.32.2) through
// tests/test_lean_autonomous_proof_real.sh. Lean rephrases its errors between
// releases — "rewrite tactic failed" became "Tactic `rewrite` failed" — and a
// classifier tested only against invented strings would not have noticed (§6.6).
const REAL_LEAN_4_32 = Object.freeze({
  rewrite_miss:
    "Tactic `rewrite` failed: Did not find an occurrence of the pattern\n  0 + ?n\nin the target expression\n  n + 0 = n\n\nn : Nat\n⊢ n + 0 = n",
  syntax_unterminated: "unterminated comment",
  syntax_eof: "unexpected end of input",
  unsolved_goals: "unsolved goals\nn : Nat\n⊢ n + 0 = n",
  type_mismatch:
    "Type mismatch\n  h\nhas type\n  a = b\nbut expected type\n  b = a",
  unknown_tactic: "unknown tactic",
  unknown_module: "unknown module prefix 'Not'\n\nNo directory 'Not' or file 'Not.olean' in the search path entries:",
  induction_alternative: "Alternative `zero` has not been provided"
});

test("the real Lean 4.32 wordings land in the right class", () => {
  const expected = {
    rewrite_miss: "rewrite_miss",
    syntax_unterminated: "syntax",
    syntax_eof: "syntax",
    unsolved_goals: "unsolved_goals",
    type_mismatch: "type_mismatch",
    unknown_tactic: "unknown_identifier",
    unknown_module: "unknown_identifier",
    // An induction alternative is a proof failure, not a parser error: the
    // model must repair the proof, not the syntax.
    induction_alternative: "proof_failure"
  };

  for (const [name, message] of Object.entries(REAL_LEAN_4_32)) {
    const decision = classifyLeanResult(
      failedResult("", { diagnostics: [{ severity: "error", message }] })
    );
    assert.equal(decision.failureClass, expected[name], `${name}: ${message.split("\n")[0]}`);
    assert.equal(decision.retryable, true, `${name} must stay repairable`);
    assert.equal(decision.terminal, false, `${name} must not end the turn`);
  }
});

test("a failed run with no parsed diagnostics is still repairable, never terminal", () => {
  // Observed against the real runtime: some elaboration errors reach exitCode!=0
  // without a diagnostic the parser recognises. Falling through to "terminal"
  // there would end the turn on a proof error.
  const decision = classifyLeanResult(
    failedResult("", { diagnostics: [], summary: "Lean elaboration failed with 1 error." })
  );
  assert.equal(decision.failureClass, "proof_failure");
  assert.equal(decision.retryable, true);
  assert.equal(decision.terminal, false);
  assert.equal(decision.verified, false);
});

// --- WP01: candidate preflight classification ---

test("candidate placeholder preflight is repairable, not terminal contract failure", () => {
  const decision = classifyLeanResult({
    contractVersion: "lean_result_v1",
    status: "rejected",
    isError: true,
    errorCode: "LEAN_CANDIDATE_PREFLIGHT_BLOCKED",
    exitCode: null,
    timedOut: false,
    cancelled: false,
    diagnostics: [],
    summary: "Source contains placeholder tactics. Lean check was not run."
  });

  assert.equal(decision.failureClass, "candidate_preflight");
  assert.equal(decision.terminal, false);
  assert.equal(decision.retryable, true);
  assert.equal(decision.verified, false);
  assert.equal(decision.terminalReason, null);
});

test("generic invalid request remains terminal contract failure", () => {
  const decision = classifyLeanResult({
    status: "rejected",
    isError: true,
    errorCode: "LEAN_ATTEMPT_INVALID",
    exitCode: null,
    timedOut: false,
    cancelled: false,
    diagnostics: []
  });

  assert.equal(decision.failureClass, "contract");
  assert.equal(decision.terminal, true);
  assert.equal(decision.retryable, false);
});

// ---------------------------------------------------------------------------
// WP-04 — task mode separation and target identity classification.
// ---------------------------------------------------------------------------

test("REPAIR-TARGET-01 target statement mismatch is retryable target_identity", () => {
  const decision = classifyLeanResult({
    status: "rejected",
    isError: true,
    errorCode: "LEAN_TARGET_STATEMENT_MISMATCH",
    exitCode: null,
    timedOut: false,
    cancelled: false,
    diagnostics: [],
  });
  assert.equal(decision.failureClass, "target_identity");
  assert.equal(decision.retryable, true);
  assert.equal(decision.terminal, false);
  assert.equal(decision.verified, false);
  assert.match(decision.nextAction, /Restore the locked target declaration/);
});

test("REPAIR-TARGET-02 target not found / ambiguous / unsupported form are target_identity", () => {
  for (const code of [
    "LEAN_TARGET_DECLARATION_NOT_FOUND",
    "LEAN_TARGET_DECLARATION_AMBIGUOUS",
    "LEAN_TARGET_PROOF_FORM_UNSUPPORTED",
  ]) {
    const decision = classifyLeanResult({
      status: "rejected",
      isError: true,
      errorCode: code,
      exitCode: null,
      timedOut: false,
      cancelled: false,
      diagnostics: [],
    });
    assert.equal(decision.failureClass, "target_identity", code);
    assert.equal(decision.retryable, true, code);
  }
});

test("REPAIR-TARGET-03 invalid or missing target arguments stay terminal contract", () => {
  for (const code of ["LEAN_TARGET_DECLARATION_REQUIRED", "LEAN_TARGET_DECLARATION_INVALID"]) {
    const decision = classifyLeanResult({
      status: "rejected",
      isError: true,
      errorCode: code,
      exitCode: null,
      timedOut: false,
      cancelled: false,
      diagnostics: [],
    });
    assert.equal(decision.failureClass, "contract", code);
    assert.equal(decision.terminal, true, code);
    assert.equal(decision.retryable, false, code);
  }
});

test("REPAIR-MODE-01 utility checked is terminal but never verified", () => {
  const decision = classifyLeanResult(
    checkedResult({ taskMode: "utility", targetIdentityMatched: null })
  );
  assert.equal(decision.terminal, true);
  assert.equal(decision.verified, false);
  assert.equal(decision.retryable, false);
  assert.equal(decision.utilityChecked, true);
  assert.equal(decision.nextAction, "report_checked_utility_result");
  assert.notEqual(decision.terminalReason, "LEAN_CHECKED_INVARIANT_VIOLATION");
});

test("REPAIR-MODE-02 proof checked without identity is an invariant violation", () => {
  for (const broken of [
    { targetDeclaration: null },
    { targetStatementSha256: null },
    { targetStatementSha256: "nothex" },
    { targetIdentityMatched: false },
    { sourceSha256: null },
    { taskMode: "utility" },
  ]) {
    const decision = classifyLeanResult(checkedResult(broken));
    assert.equal(decision.verified, false, JSON.stringify(broken));
    assert.equal(decision.terminal, true, JSON.stringify(broken));
    if (broken.taskMode !== "utility") {
      assert.equal(decision.terminalReason, "LEAN_CHECKED_INVARIANT_VIOLATION", JSON.stringify(broken));
    }
  }
});

test("REPAIR-MODE-03 proof checked with full identity verifies", () => {
  const decision = classifyLeanResult(checkedResult());
  assert.equal(decision.verified, true);
  assert.equal(decision.terminal, true);
  assert.equal(decision.nextAction, "publish_verified_result");
});
