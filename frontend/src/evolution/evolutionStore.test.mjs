import assert from "node:assert/strict";
import test from "node:test";

import { applyEvolutionEvent, initialEvolutionView, replaceEvolutionRun } from "./evolutionStore.mjs";

test("Evolution UI store ignores duplicate sequences and applies ordered state DTO events", () => {
  let view = replaceEvolutionRun(initialEvolutionView(), { state: "BASELINE_READY", revision: 0, sequence: 1 });
  const duplicate = applyEvolutionEvent(view, { sequence: 1, type: "STATE_TRANSITION", payload: { to: "FAILED" } });
  assert.equal(duplicate, view);
  view = applyEvolutionEvent(view, { sequence: 2, revision: 1, type: "STATE_TRANSITION", payload: { to: "PROPOSING" } });
  assert.equal(view.run.state, "PROPOSING");
  assert.equal(view.run.revision, 1);
});

test("Evolution UI store marks a sequence gap stale until a full refresh", () => {
  const view = replaceEvolutionRun(initialEvolutionView(), { state: "CREATED", revision: 0, sequence: 2 });
  const stale = applyEvolutionEvent(view, { sequence: 4, type: "STATE_TRANSITION", payload: { to: "FAILED" } });
  assert.equal(stale.gap, true);
  assert.equal(stale.connection, "stale");
  assert.equal(stale.run.state, "CREATED");
});
