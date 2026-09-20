import assert from "node:assert/strict";
import test from "node:test";

import { evaluateLeanFinalCandidate } from "./authoritativeFinalizationGate.mjs";

const VERIFIED_SOURCE = "theorem reconciled : True := by\n  trivial\n";

function snapshot(overrides = {}) {
  return {
    proofId: "proof-test",
    state: "verified",
    verified: true,
    taskSpecSealed: true,
    terminal: true,
    terminalReason: null,
    targetDeclaration: "reconciled",
    targetStatementSha256: "c".repeat(64),
    targetIdentityAlgorithm: "lean-target-statement-v1",
    checkedTargetStatementSha256: "c".repeat(64),
    targetIdentityMatched: true,
    profile: "core",
    checkedProfile: "core",
    ...overrides,
  };
}

test("LEAN-FINAL-01/02/03 source mismatch blocks commit, done and stream decisions", () => {
  const decision = evaluateLeanFinalCandidate({
    assistantContent: "STATO: VERIFIED\n```lean\ntheorem other : True := by trivial\n```",
    leanSnapshot: snapshot(),
    verifiedSource: VERIFIED_SOURCE,
  });

  assert.equal(decision.allowed, false);
  assert.equal(decision.mustContinue, true);
  assert.equal(decision.finishReason, null);
  assert.equal(decision.code, "LEAN_ANSWER_SOURCE_MISMATCH");
});

test("LEAN-FINAL-04/05 exact source is accepted exactly once by the caller", () => {
  const decision = evaluateLeanFinalCandidate({
    assistantContent: `STATO: VERIFIED\n\n\`\`\`lean4\n${VERIFIED_SOURCE}\`\`\``,
    leanSnapshot: snapshot(),
    verifiedSource: VERIFIED_SOURCE,
  });

  assert.equal(decision.allowed, true);
  assert.equal(decision.finishReason, "lean_verified");
});

test("LEAN-FINAL-06 terminal NOT_VERIFIED is not promoted to VERIFIED", () => {
  const decision = evaluateLeanFinalCandidate({
    assistantContent: "STATO: NOT_VERIFIED\nreason=LEAN_RUNTIME_UNAVAILABLE",
    leanSnapshot: snapshot({
      state: "infrastructure_block",
      verified: false,
      terminalReason: "LEAN_RUNTIME_UNAVAILABLE",
    }),
    verifiedSource: null,
  });

  assert.equal(decision.allowed, true);
  assert.equal(decision.code, "LEAN_NOT_VERIFIED");
  assert.equal(decision.finishReason, "lean_not_verified");
});

test("positive claim on terminal non-verification is blocked", () => {
  const decision = evaluateLeanFinalCandidate({
    assistantContent: "STATO: VERIFIED",
    leanSnapshot: snapshot({ state: "budget_exhausted", verified: false }),
    verifiedSource: null,
    claimDecision: {
      block: true,
      type: "STOP_UNSUPPORTED_VERIFIED_CLAIM",
      guidance: "Remove the claim.",
    },
  });

  assert.equal(decision.allowed, false);
  assert.equal(decision.mustContinue, true);
});

test("ordinary chat is outside the authoritative Lean gate", () => {
  const decision = evaluateLeanFinalCandidate({
    assistantContent: "hello",
    leanSnapshot: snapshot({ proofId: null, state: "idle", verified: false, terminal: false }),
    verifiedSource: null,
  });

  assert.equal(decision.allowed, true);
  assert.equal(decision.finishReason, null);
});

// ---------------------------------------------------------------------------
// WP07 — target identity and profile defenses in the final gate.
// ---------------------------------------------------------------------------

test("FINAL-TARGET-01 exact source but targetIdentityMatched=false is blocked", () => {
  const decision = evaluateLeanFinalCandidate({
    assistantContent: `STATO: VERIFIED\n\n\`\`\`lean4\n${VERIFIED_SOURCE}\`\`\``,
    leanSnapshot: snapshot({ targetIdentityMatched: false }),
    verifiedSource: VERIFIED_SOURCE,
  });
  assert.equal(decision.allowed, false);
  assert.equal(decision.mustContinue, true);
  assert.equal(decision.code, "LEAN_TARGET_IDENTITY_MISMATCH");
});

test("FINAL-TARGET-02 checked target hash different from locked hash is blocked", () => {
  const decision = evaluateLeanFinalCandidate({
    assistantContent: `STATO: VERIFIED\n\n\`\`\`lean4\n${VERIFIED_SOURCE}\`\`\``,
    leanSnapshot: snapshot({ checkedTargetStatementSha256: "e".repeat(64) }),
    verifiedSource: VERIFIED_SOURCE,
  });
  assert.equal(decision.allowed, false);
  assert.equal(decision.code, "LEAN_TARGET_IDENTITY_MISMATCH");
});

test("FINAL-TARGET-03 exact source plus matching target identity is allowed", () => {
  const decision = evaluateLeanFinalCandidate({
    assistantContent: `STATO: VERIFIED\n\n\`\`\`lean4\n${VERIFIED_SOURCE}\`\`\``,
    leanSnapshot: snapshot(),
    verifiedSource: VERIFIED_SOURCE,
  });
  assert.equal(decision.allowed, true);
  assert.equal(decision.finishReason, "lean_verified");
});

test("FINAL-PROFILE-01 a checked profile different from the locked one never publishes VERIFIED", () => {
  const decision = evaluateLeanFinalCandidate({
    assistantContent: `STATO: VERIFIED\n\n\`\`\`lean4\n${VERIFIED_SOURCE}\`\`\``,
    leanSnapshot: snapshot({ checkedProfile: "core", profile: "mathlib" }),
    verifiedSource: VERIFIED_SOURCE,
  });
  assert.equal(decision.allowed, false);
  assert.equal(decision.code, "LEAN_PROFILE_IDENTITY_MISMATCH");
  assert.equal(decision.finishReason, "lean_not_verified");
});

test("FINAL-UTILITY-01 proofId null after utility-only checks takes the ordinary path", () => {
  const decision = evaluateLeanFinalCandidate({
    assistantContent: "STATO: checked (utility)",
    leanSnapshot: snapshot({ proofId: null, state: "idle", verified: false, terminal: false }),
    verifiedSource: null,
  });
  assert.equal(decision.allowed, true);
  assert.equal(decision.code, "LEAN_NOT_ACTIVE");
});

// ============================================================================
// UTF8-001 §78/§79/§80 — presentation integrity is a separate property
// ============================================================================
//
// The Cauchy regression had formal source integrity PASS (Lean checked the
// right bytes) while presentation integrity FAILED (the transcript showed
// U+FFFD). Publishing on the strength of the first alone shows the user a
// source that was never verified.

const LEAN_UNICODE_SOURCE =
  "import Mathlib.Analysis.Calculus.Deriv.MeanValue\n" +
  "variable (f g : ℝ → ℝ) {a b : ℝ} (hab : a < b)\n" +
  "theorem reconciled : True := by\n  trivial\n";

test("UTF8-001 Lean Unicode source is published normally", () => {
  const decision = evaluateLeanFinalCandidate({
    assistantContent: `STATO: VERIFIED\n\n\`\`\`lean\n${LEAN_UNICODE_SOURCE}\`\`\``,
    leanSnapshot: snapshot(),
    verifiedSource: LEAN_UNICODE_SOURCE,
  });

  assert.equal(decision.allowed, true);
  assert.equal(decision.code, "LEAN_VERIFIED");
});

test("UTF8-001 U+FFFD in the retained source blocks publication", () => {
  const corrupted = LEAN_UNICODE_SOURCE.replaceAll("ℝ", "���");
  const decision = evaluateLeanFinalCandidate({
    assistantContent: `STATO: VERIFIED\n\n\`\`\`lean\n${corrupted}\`\`\``,
    leanSnapshot: snapshot(),
    verifiedSource: corrupted,
  });

  assert.equal(decision.allowed, false);
  assert.equal(decision.code, "LEAN_PRESENTATION_INTEGRITY_FAILED");
  // Not a proof failure: the guidance must not send the model back to rewrite
  // the mathematics (§279).
  assert.match(decision.guidance, /republish the retained checked source/);
});

test("UTF8-001 U+FFFD in the answer blocks publication even when the retained source is clean", () => {
  const decision = evaluateLeanFinalCandidate({
    assistantContent:
      "STATO: VERIFIED\n\n```lean\n" +
      LEAN_UNICODE_SOURCE.replaceAll("ℝ", "���") +
      "```",
    leanSnapshot: snapshot(),
    verifiedSource: LEAN_UNICODE_SOURCE,
  });

  assert.equal(decision.allowed, false);
  assert.equal(decision.code, "LEAN_PRESENTATION_INTEGRITY_FAILED");
});

test("UTF8-001 presentation integrity is checked before the source match", () => {
  // Both would fail; the integrity failure has to win, because reporting a
  // source mismatch would send the model off repairing the wrong thing.
  const decision = evaluateLeanFinalCandidate({
    assistantContent: "STATO: VERIFIED\n```lean\ntheorem other : ��� := by trivial\n```",
    leanSnapshot: snapshot(),
    verifiedSource: LEAN_UNICODE_SOURCE,
  });

  assert.equal(decision.code, "LEAN_PRESENTATION_INTEGRITY_FAILED");
});

test("LEAN_TASKSPEC_NOT_SEALED: a checked source without a sealed task never publishes VERIFIED", () => {
  // §14.1/§176 — without a spec the target was whatever the first candidate
  // said it was, so "verified" would only mean Lean agreed with that candidate
  // about itself.
  const decision = evaluateLeanFinalCandidate({
    assistantContent: `STATO: VERIFIED\n\n\`\`\`lean4\n${VERIFIED_SOURCE}\`\`\``,
    leanSnapshot: snapshot({ taskSpecSealed: false }),
    verifiedSource: VERIFIED_SOURCE,
  });

  assert.equal(decision.allowed, false);
  assert.equal(decision.code, "LEAN_TASKSPEC_NOT_SEALED");
  assert.equal(decision.mustContinue, true);
  assert.match(decision.guidance, /target_statement/);
});

test("§17/§50 the decision carries the retained and published digests", () => {
  const decision = evaluateLeanFinalCandidate({
    assistantContent: `STATO: VERIFIED\n\n\`\`\`lean4\n${VERIFIED_SOURCE}\`\`\``,
    leanSnapshot: snapshot({ taskId: "lean-task-abc" }),
    verifiedSource: VERIFIED_SOURCE,
  });

  assert.equal(decision.allowed, true);
  assert.equal(decision.taskId, "lean-task-abc");
  assert.match(decision.retainedSourceSha256, /^[0-9a-f]{64}$/);
  assert.equal(decision.publishedSourceSha256, decision.retainedSourceSha256);
});

test("§51 a mismatch is readable as two different digests, not just a false", () => {
  const decision = evaluateLeanFinalCandidate({
    assistantContent: "STATO: VERIFIED\n```lean\ntheorem other : True := by trivial\n```",
    leanSnapshot: snapshot(),
    verifiedSource: VERIFIED_SOURCE,
  });

  assert.equal(decision.allowed, false);
  assert.equal(decision.code, "LEAN_ANSWER_SOURCE_MISMATCH");
  assert.match(decision.retainedSourceSha256, /^[0-9a-f]{64}$/);
  assert.match(decision.publishedSourceSha256, /^[0-9a-f]{64}$/);
  assert.notEqual(decision.publishedSourceSha256, decision.retainedSourceSha256);
});
