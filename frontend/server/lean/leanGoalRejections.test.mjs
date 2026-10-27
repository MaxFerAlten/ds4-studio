import test from "node:test";
import assert from "node:assert/strict";
import { LeanGoalRejections } from "./leanGoalRejections.mjs";

const goal = (statement) => ({ target_declaration: "t", target_statement: statement });
const refused = { code: "LEAN_GOAL_NOT_DISCRIMINATING", message: "A competing answer satisfies it too." };

test("a statement the review refused is refused again without running", () => {
  const rejections = new LeanGoalRejections({ maxRejections: 3 });
  assert.equal(rejections.check(goal("theorem t (n : ℕ) : n = n")), undefined);
  assert.equal(rejections.record(goal("theorem t (n : ℕ) : n = n"), refused), undefined);
  const again = rejections.check(goal("theorem t (n : ℕ) :  n = n"));
  assert.equal(again.code, "LEAN_GOAL_ALREADY_REJECTED");
  assert.match(again.content, /LEAN_GOAL_NOT_DISCRIMINATING/);
  assert.match(again.content, /Refusals left before Lean ends NOT_VERIFIED: 1/);
  assert.equal(rejections.check(goal("theorem t (n : ℕ) : n + 0 = n")), undefined);
});

test("typecheck failures never mark a statement as rejected", () => {
  const rejections = new LeanGoalRejections({ maxRejections: 1 });
  assert.equal(rejections.record(goal("theorem t : True"), { code: "LEAN_GOAL_TYPECHECK_FAILED" }), undefined);
  assert.equal(rejections.check(goal("theorem t : True")), undefined);
  assert.equal(rejections.record(goal("theorem t : True"), { prepared: true }), undefined);
});

test("the refusal budget, repeats included, ends Lean NOT_VERIFIED", () => {
  const rejections = new LeanGoalRejections({ maxRejections: 3 });
  rejections.record(goal("theorem t : 1 = 1"), refused);
  rejections.check(goal("theorem t : 1 = 1"));
  const terminal = rejections.record(goal("theorem t : 2 = 2"), { code: "LEAN_GOAL_SCOPE_MISMATCH", message: "tautology" });
  assert.equal(terminal.code, "LEAN_GOAL_REJECTED_REPEATEDLY");
  assert.match(terminal.content, /NOT_VERIFIED/);
  assert.equal(rejections.check(goal("theorem t : 3 = 3")).code, "LEAN_GOAL_REJECTED_REPEATEDLY");
});
