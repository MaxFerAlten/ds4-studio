// Tests for leanProofActivityState.mjs

import test from "node:test";
import assert from "node:assert/strict";

import { applyLeanStatus, leanProofActivityProps } from "./leanProofActivityState.mjs";

const PROOF = "proof-abcdef012345-1-1";

test("nothing is rendered before a proof task exists", () => {
  assert.equal(leanProofActivityProps(null), null);
  assert.equal(leanProofActivityProps({ state: "checking" }), null);
});

test("a running repair reads as autonomous work, without a verdict", () => {
  let activity = applyLeanStatus(null, {
    proofId: PROOF,
    state: "checking",
    attempt: 1,
    maxAttempts: 6,
    profile: "core"
  });
  activity = applyLeanStatus(activity, {
    proofId: PROOF,
    state: "repair_required",
    attempt: 1,
    maxAttempts: 6,
    failureClass: "rewrite_miss",
    summary: "Riscrittura non applicabile."
  });

  const props = leanProofActivityProps(activity);
  assert.equal(props.label, "Correzione autonoma in corso");
  assert.equal(props.badge, null, "no verdict while the proof is still open");
  assert.equal(props.inProgress, true);
  assert.match(props.detail, /tentativo 1\/6/);
  assert.match(props.detail, /riscrittura non applicabile/);
  assert.equal(props.summary, "Riscrittura non applicabile.");
});

test("only a checked run earns the VERIFIED badge", () => {
  let activity = applyLeanStatus(null, { proofId: PROOF, state: "checking", attempt: 5, maxAttempts: 6 });
  activity = applyLeanStatus(activity, {
    proofId: PROOF,
    state: "verified",
    attempt: 5,
    maxAttempts: 6,
    verified: true,
    summary: "Prova verificata: status=checked."
  });

  const props = leanProofActivityProps(activity);
  assert.equal(props.badge, "VERIFIED");
  assert.equal(props.tone, "ok");
  assert.equal(props.inProgress, false);
  assert.equal(props.terminalReason, null);
});

test("every terminal non-checked state reads NOT VERIFIED and names its cause", () => {
  for (const [state, reason] of [
    ["infrastructure_block", "LEAN_SANDBOX_UNAVAILABLE"],
    ["budget_exhausted", "BUDGET_EXHAUSTED"],
    ["cancelled", "USER_CANCELLED"]
  ]) {
    const activity = applyLeanStatus(null, {
      proofId: PROOF,
      state,
      attempt: 3,
      maxAttempts: 6,
      verified: false,
      terminalReason: reason
    });
    const props = leanProofActivityProps(activity);
    assert.equal(props.badge, "NOT VERIFIED", state);
    assert.equal(props.tone, "bad", state);
    assert.equal(props.inProgress, false, state);
    assert.equal(props.terminalReason, reason, state);
  }
});

test("the attempt history is built from state changes, not from prose", () => {
  let activity = applyLeanStatus(null, { proofId: PROOF, state: "checking", attempt: 1, maxAttempts: 6 });
  activity = applyLeanStatus(activity, {
    proofId: PROOF,
    state: "repair_required",
    attempt: 1,
    failureClass: "syntax"
  });
  activity = applyLeanStatus(activity, { proofId: PROOF, state: "checking", attempt: 2 });
  activity = applyLeanStatus(activity, {
    proofId: PROOF,
    state: "strategy_change_required",
    attempt: 2,
    failureClass: "rewrite_miss",
    strategyChangeRequired: true
  });

  const props = leanProofActivityProps(activity);
  assert.equal(props.attempts.length, 4);
  assert.deepEqual(
    props.attempts.map((a) => a.state),
    ["checking", "repair_required", "checking", "strategy_change_required"]
  );
  assert.match(props.detail, /cambio di strategia richiesto/);
});

test("applyLeanStatus never mutates the previous activity", () => {
  const first = applyLeanStatus(null, { proofId: PROOF, state: "checking", attempt: 1 });
  const snapshot = JSON.stringify(first);
  applyLeanStatus(first, { proofId: PROOF, state: "verified", attempt: 1, verified: true });
  assert.equal(JSON.stringify(first), snapshot);
});
