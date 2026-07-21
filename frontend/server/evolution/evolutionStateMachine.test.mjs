/** Test origin: DS4 acceptance requirements BEH-STATE-001..004. */

import assert from "node:assert/strict";
import test from "node:test";

import {
  ALLOWED_TRANSITIONS,
  EVOLUTION_STATES,
  TERMINAL_STATES,
  EvolutionStateError,
  assertTransition,
  nextRunState
} from "./evolutionStateMachine.mjs";

test("BEH-STATE-001 accepts every normative transition", () => {
  for (const [from, targets] of Object.entries(ALLOWED_TRANSITIONS)) {
    for (const to of targets) assert.equal(assertTransition(from, to), true, `${from} -> ${to}`);
  }
  assert.deepEqual(new Set(Object.keys(ALLOWED_TRANSITIONS)), new Set(EVOLUTION_STATES));
});

test("BEH-STATE-002 rejects invalid transitions", () => {
  for (const [from, to] of [["CREATED", "PROMOTED"], ["BASELINE_READY", "GATING"], ["REJECTED", "EXECUTING"]]) {
    assert.throws(
      () => assertTransition(from, to),
      (error) => error instanceof EvolutionStateError && error.code === "INVALID_STATE_TRANSITION"
    );
  }
});

test("BEH-STATE-003 terminal states are immutable", () => {
  for (const state of ["COMPLETED", "STOPPED", "FAILED"]) {
    assert.throws(() => assertTransition(state, "PROPOSING"), (error) => error.code === "TERMINAL_STATE_IMMUTABLE");
  }
});

test("BEH-STATE-005 every non-terminal state supports a typed hard failure", () => {
  for (const state of EVOLUTION_STATES.filter((name) => !TERMINAL_STATES.has(name))) {
    assert.equal(assertTransition(state, "FAILED", {
      kind: "hard_failure",
      reasonCode: "BASELINE_MUTATED"
    }), true);
  }
  assert.throws(
    () => assertTransition("CANDIDATE_READY", "FAILED"),
    (error) => error.code === "INVALID_STATE_TRANSITION"
  );
  assert.throws(
    () => assertTransition("CANDIDATE_READY", "FAILED", { kind: "hard_failure" }),
    (error) => error.code === "MISSING_HARD_FAILURE_REASON"
  );
});

test("BEH-STATE-006 every non-terminal state supports an explicit stop", () => {
  for (const state of EVOLUTION_STATES.filter((name) => !TERMINAL_STATES.has(name))) {
    assert.equal(assertTransition(state, "STOPPED", { kind: "stop" }), true);
  }
  assert.throws(
    () => assertTransition("EXECUTING", "STOPPED"),
    (error) => error.code === "INVALID_STATE_TRANSITION"
  );
});

test("nextRunState returns a new immutable state object", () => {
  const original = { runId: "evo_fixture", state: "CREATED", updatedAt: "old" };
  const next = nextRunState(original, "BASELINE_CAPTURING", { now: new Date("2026-01-01T00:00:00Z") });
  assert.equal(original.state, "CREATED");
  assert.equal(next.state, "BASELINE_CAPTURING");
  assert.equal(next.updatedAt, "2026-01-01T00:00:00.000Z");
  assert.equal(Object.isFrozen(next), true);
});
