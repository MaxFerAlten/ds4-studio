import test from "node:test";
import assert from "node:assert/strict";
import {
  ALLOWED_CLAIM_TRANSITIONS,
  CLAIM_STATES,
  EPISTEMIC_TYPES,
  EpistemicStateError,
  FAILURE_CODES,
  FAILURE_SEVERITY,
  MANDATORY_HIGH_SEVERITY,
  SEVERITY,
  TERMINAL_CLAIM_STATES,
  assertClaimTransition,
  assertTypePromotion,
  blocksPublication
} from "./epistemicContracts.mjs";

const throwsWith = (code, fn) =>
  assert.throws(fn, (err) => {
    assert.ok(err instanceof EpistemicStateError, `expected EpistemicStateError, got ${err?.name}`);
    assert.equal(err.code, code);
    return true;
  });

test("direct verify is rejected", () => {
  // The whole point of the state machine: nothing reaches VERIFIED without
  // passing through verification. A claim that skips it is the QHO failure.
  throwsWith("INVALID_CLAIM_TRANSITION", () => assertClaimTransition("PROPOSED", "VERIFIED"));
  throwsWith("INVALID_CLAIM_TRANSITION", () => assertClaimTransition("CLASSIFIED", "VERIFIED"));
  throwsWith("INVALID_CLAIM_TRANSITION", () =>
    assertClaimTransition("EVIDENCE_REQUIRED", "VERIFIED")
  );
  // The only door into VERIFIED.
  assert.equal(assertClaimTransition("VERIFICATION_PENDING", "VERIFIED"), true);
});

test("terminal states are immutable", () => {
  for (const from of TERMINAL_CLAIM_STATES) {
    assert.deepEqual(ALLOWED_CLAIM_TRANSITIONS[from], []);
    for (const to of CLAIM_STATES) {
      throwsWith("TERMINAL_STATE_IMMUTABLE", () => assertClaimTransition(from, to));
    }
    // Not even an exceptional kind reopens them.
    throwsWith("TERMINAL_STATE_IMMUTABLE", () =>
      assertClaimTransition(from, "VERIFICATION_PENDING", { kind: "challenge" })
    );
  }
});

test("a challenge is an event, not an implicit edge", () => {
  // CHALLENGED is absent from every settled state's allowed list, so it can
  // only be reached by naming the event.
  throwsWith("INVALID_CLAIM_TRANSITION", () => assertClaimTransition("VERIFIED", "CHALLENGED"));
  for (const from of ["VERIFIED", "PARTIAL", "UNKNOWN"]) {
    assert.equal(assertClaimTransition(from, "CHALLENGED", { kind: "challenge" }), true);
  }
  // A claim still awaiting verification is not challengeable: there is no
  // verdict to contest yet.
  throwsWith("INVALID_CLAIM_TRANSITION", () =>
    assertClaimTransition("VERIFICATION_PENDING", "CHALLENGED", { kind: "challenge" })
  );
  // A challenge sends the claim back through verification, never straight to a
  // verdict — this is EPI-016: a user critique is not truth.
  assert.equal(assertClaimTransition("CHALLENGED", "VERIFICATION_PENDING"), true);
  throwsWith("INVALID_CLAIM_TRANSITION", () => assertClaimTransition("CHALLENGED", "REJECTED"));
});

test("dependency invalidation requires a named premise", () => {
  throwsWith("INVALID_CLAIM_TRANSITION", () => assertClaimTransition("VERIFIED", "INVALIDATED"));
  throwsWith("MISSING_DEPENDENCY_FAILURE_REASON", () =>
    assertClaimTransition("VERIFIED", "INVALIDATED", { kind: "dependency_failure" })
  );
  throwsWith("MISSING_DEPENDENCY_FAILURE_REASON", () =>
    assertClaimTransition("VERIFIED", "INVALIDATED", { kind: "dependency_failure", reasonCode: "no" })
  );
  assert.equal(
    assertClaimTransition("VERIFIED", "INVALIDATED", {
      kind: "dependency_failure",
      reasonCode: "PREMISE_C1_REJECTED"
    }),
    true
  );
  // New evidence reopens an invalidated claim; nothing else does.
  assert.equal(assertClaimTransition("INVALIDATED", "VERIFICATION_PENDING"), true);
  throwsWith("INVALID_CLAIM_TRANSITION", () => assertClaimTransition("INVALIDATED", "VERIFIED"));
});

test("UNKNOWN is a verdict, not a resting place", () => {
  assert.equal(assertClaimTransition("VERIFICATION_PENDING", "UNKNOWN"), true);
  // It cannot quietly become knowledge.
  throwsWith("INVALID_CLAIM_TRANSITION", () => assertClaimTransition("UNKNOWN", "VERIFIED"));
  throwsWith("INVALID_CLAIM_TRANSITION", () => assertClaimTransition("UNKNOWN", "PARTIAL"));
  // It can be challenged or invalidated like any other settled state.
  assert.equal(assertClaimTransition("UNKNOWN", "CHALLENGED", { kind: "challenge" }), true);
  assert.equal(
    assertClaimTransition("UNKNOWN", "INVALIDATED", {
      kind: "dependency_failure",
      reasonCode: "PREMISE_FAILED"
    }),
    true
  );
});

test("unknown states are refused by name", () => {
  throwsWith("UNKNOWN_SOURCE_STATE", () => assertClaimTransition("NOPE", "VERIFIED"));
  throwsWith("UNKNOWN_TARGET_STATE", () => assertClaimTransition("PROPOSED", "NOPE"));
  throwsWith("UNKNOWN_SOURCE_STATE", () => assertClaimTransition(undefined, "VERIFIED"));
});

test("every state has a transition list and every target is a real state", () => {
  assert.deepEqual(Object.keys(ALLOWED_CLAIM_TRANSITIONS).sort(), [...CLAIM_STATES].sort());
  for (const [from, targets] of Object.entries(ALLOWED_CLAIM_TRANSITIONS)) {
    for (const to of targets) {
      assert.ok(CLAIM_STATES.includes(to), `${from} -> ${to} is not a state`);
    }
  }
});

test("type promotion needs the evidence it claims", () => {
  // §34: the four promotions the plan names, refused without evidence.
  throwsWith("UNAUTHORIZED_TYPE_PROMOTION", () => assertTypePromotion("ANALOGY", "DERIVED"));
  throwsWith("UNAUTHORIZED_TYPE_PROMOTION", () => assertTypePromotion("HYPOTHESIS", "OBSERVED"));
  throwsWith("UNAUTHORIZED_TYPE_PROMOTION", () => assertTypePromotion("ESTIMATE", "SOURCE_FACT"));
  throwsWith("UNAUTHORIZED_TYPE_PROMOTION", () => assertTypePromotion("CODE_DRAFT", "EXECUTED"));

  // With the right evidence kind they are allowed.
  assert.equal(
    assertTypePromotion("CODE_DRAFT", "EXECUTED", { evidenceKind: "execution_evidence" }),
    true
  );
  assert.equal(
    assertTypePromotion("ANALOGY", "DERIVED", { evidenceKind: "derivation_evidence" }),
    true
  );
  // The wrong evidence kind does not authorise it: running the code does not
  // make an analogy a derivation.
  throwsWith("UNAUTHORIZED_TYPE_PROMOTION", () =>
    assertTypePromotion("ANALOGY", "DERIVED", { evidenceKind: "execution_evidence" })
  );

  // Demotions and unrelated moves stay free.
  assert.equal(assertTypePromotion("OBSERVED", "HYPOTHESIS"), true);
  assert.equal(assertTypePromotion("ANALOGY", "ANALOGY"), true);
  throwsWith("UNKNOWN_TARGET_TYPE", () => assertTypePromotion("ANALOGY", "FACT"));
});

test("failure taxonomy is complete and severities are assigned", () => {
  const codes = Object.keys(FAILURE_CODES);
  assert.equal(codes.length, 40);
  assert.deepEqual(codes, Array.from({ length: 40 }, (_, i) => `F${String(i + 1).padStart(2, "0")}`));
  assert.deepEqual(
    Object.fromEntries(codes.slice(26, 33).map((code) => [code, FAILURE_CODES[code]])),
    {
      F27: "VERIFIER_SCOPE_MISMATCH",
      F28: "PRINTED_ASSERTION_PRESENTED_AS_VERIFICATION",
      F29: "FAILED_SUBCHECK_HIDDEN_BY_SUCCESSFUL_SUBCHECK",
      F30: "CIRCULAR_VERIFICATION",
      F31: "ASSUMPTION_NOT_VERIFIED",
      F32: "DOMAIN_MODEL_MISMATCH",
      F33: "VERIFICATION_AGGREGATION_OVERCLAIM"
    }
  );
  assert.deepEqual(
    Object.fromEntries(codes.slice(33).map((code) => [code, FAILURE_CODES[code]])),
    {
      F34: "SELF_CHALLENGE_NOT_PERSISTED",
      F35: "ASSUMPTION_PRESENTED_AS_PROOF",
      F36: "CORRECTIVE_STATE_REGRESSION",
      F37: "SOURCE_ASSUMPTION_PROMOTED_TO_FACT",
      F38: "MODEL_CAPABILITY_MISMATCH",
      F39: "UNRESOLVED_CHALLENGE_DEBT",
      F40: "PROOF_DEPENDENCY_NOT_AUDITED"
    }
  );
  for (const code of codes) {
    assert.ok(Number.isInteger(FAILURE_SEVERITY[code]), `${code} has no severity`);
    assert.ok(FAILURE_SEVERITY[code] >= SEVERITY.NONE && FAILURE_SEVERITY[code] <= SEVERITY.CRITICAL);
  }
  // §46's mandatory classes must be at or above HIGH — this part is the plan's,
  // not this module's judgement.
  for (const code of MANDATORY_HIGH_SEVERITY) {
    assert.ok(FAILURE_SEVERITY[code] >= SEVERITY.HIGH, `${code} must be high severity`);
  }
  assert.ok(EPISTEMIC_TYPES.includes("SOURCE_FACT"));
  assert.equal(new Set(EPISTEMIC_TYPES).size, EPISTEMIC_TYPES.length);
  assert.equal(new Set(CLAIM_STATES).size, CLAIM_STATES.length);
});

test("blocksPublication compares against the configured threshold", () => {
  assert.equal(blocksPublication([], 4), false);
  assert.equal(blocksPublication(null, 4), false);
  assert.equal(blocksPublication(["F15"], 4), false); // LOW
  assert.equal(blocksPublication(["F15"], 2), true); // threshold lowered to LOW
  assert.equal(blocksPublication(["F18"], 4), true); // CRITICAL
  assert.equal(blocksPublication(["F15", "F03"], 4), true); // one high code is enough
  assert.equal(blocksPublication(["F08"], 5), false); // MEDIUM under a CRITICAL-only threshold
  // An unrecognised code is treated as CRITICAL: a verifier reporting a class
  // this module does not know is a reason to stop, not to continue.
  assert.equal(blocksPublication(["F99"], 5), true);
  // A missing threshold falls back to HIGH rather than to "never block".
  assert.equal(blocksPublication(["F03"], undefined), true);
});
