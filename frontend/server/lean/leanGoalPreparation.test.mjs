import test from "node:test";
import assert from "node:assert/strict";
import { buildLeanGoalCheck, prepareLeanGoal, parseLeanGoalReview, formatLeanGoalPreparation } from "./leanGoalPreparation.mjs";

const goal = (extra = {}) => ({ claim: "Addition of naturals is commutative.", target_declaration: "addition_commutes",
  target_statement: "theorem addition_commutes (x n : ℕ) : x + n = n + x", ...extra });
const checked = async () => ({ status: "checked", exitCode: 0, taskMode: "utility", isError: false });
const accepted = async () => ({ matches_request: true, selection_question: false, discriminates: true, feedback: "The quantified equality matches the task." });

test("preparation checks a Prop definition with explicit variables, without claiming a proof", async () => {
  let request;
  const result = await prepareLeanGoal(goal(), { checkGoal: async (body) => { request = body; return checked(); }, reviewGoal: accepted });
  assert.equal(request.taskMode, "utility");
  assert.match(request.code, /set_option autoImplicit false/);
  assert.match(request.code, /noncomputable def addition_commutes \(x n : ℕ\) : Prop :=/);
  assert.doesNotMatch(request.code, /\bsorry\b|\badmit\b|\baxiom\b/);
  assert.equal(result.prepared, true);
  assert.equal(result.verified, false);
  assert.equal(result.attemptConsumed, false);
  assert.equal(result.spec.sealed, true);
  assert.equal(Object.isFrozen(result.spec), true);
  assert.match(formatLeanGoalPreparation(result), /prepared=true\nverified=false/);
  assert.match(formatLeanGoalPreparation(result), /not a proof/);
});

test("a malformed goal never reaches semantic approval or locks the next corrected proposal", async () => {
  let reviews = 0;
  const broken = await prepareLeanGoal(goal({ target_statement: "theorem addition_commutes (n : ℕ) : ..." }), {
    checkGoal: async () => ({ status: "failed", exitCode: 1, summary: "unexpected token", diagnostics: [{ severity: "error", message: "unexpected token" }] }),
    reviewGoal: async () => { reviews++; return accepted(); }
  });
  assert.equal(broken.prepared, false);
  assert.equal(broken.spec, undefined);
  assert.equal(reviews, 0);
  const repaired = await prepareLeanGoal(goal(), { checkGoal: checked, reviewGoal: accepted });
  assert.equal(repaired.prepared, true);
});

test("a well-typed weaker or circular goal is refused by semantic review without sealing", async () => {
  const result = await prepareLeanGoal(goal({ target_statement: "theorem addition_commutes : True" }), {
    checkGoal: checked, reviewGoal: async () => ({ matches_request: false, selection_question: false, discriminates: true, feedback: "True does not state commutativity." })
  });
  assert.equal(result.code, "LEAN_GOAL_SCOPE_MISMATCH");
  assert.equal(result.prepared, false);
  assert.equal(result.spec, undefined);
  assert.equal(result.verified, false);
});

test("unavailable or invalid semantic reviews fail closed", async () => {
  for (const reviewGoal of [async () => undefined, async () => { throw new Error("offline"); }]) {
    const result = await prepareLeanGoal(goal(), { checkGoal: checked, reviewGoal });
    assert.equal(result.code, "LEAN_GOAL_REVIEW_UNAVAILABLE");
    assert.equal(result.prepared, false);
    assert.equal(result.spec, undefined);
  }
  assert.throws(() => parseLeanGoalReview('{"matches_request":"true","feedback":"ok"}'));
  assert.throws(() => parseLeanGoalReview('{"matches_request":true,"feedback":"no discrimination field"}'));
  assert.deepEqual(parseLeanGoalReview('{"matches_request":false,"selection_question":false,"discriminates":true,"feedback":"missing ordering"}'),
    { matches_request: false, selection_question: false, discriminates: true, competing_statement: "", feedback: "missing ordering" });
});

test("imports cannot inject extra commands into the generated goal source", () => {
  assert.equal(buildLeanGoalCheck(goal({ imports: ["Mathlib\n#eval 1"] })).code, "LEAN_GOAL_IMPORTS_INVALID");
  assert.equal(buildLeanGoalCheck(goal({ imports: ["Mathlib.Data.Nat.Choose.Sum"] })).profile, "mathlib");
});

test("the whole Mathlib import is refused before any Lean run", async () => {
  let ran = false;
  const result = await prepareLeanGoal({ claim: "c", target_declaration: "t", target_statement: "theorem t : True", imports: ["Mathlib"] },
    { checkGoal: async () => { ran = true; return {}; }, reviewGoal: async () => ({ matches_request: true }) });
  assert.equal(result.code, "LEAN_GOAL_IMPORTS_TOO_BROAD");
  assert.equal(ran, false);
});

test("the reviewer never receives the model's claim, only the statement and its imports", async () => {
  let seen;
  await prepareLeanGoal(goal(), { checkGoal: checked, reviewGoal: async (proposal) => { seen = proposal; return accepted(); } });
  assert.equal("claim" in seen, false);
  assert.equal(seen.target_statement, goal().target_statement);
});

test("a statement a competing answer would also satisfy is refused without sealing", async () => {
  const result = await prepareLeanGoal(goal({ target_statement: "theorem addition_commutes (f : ℕ → ℕ) : f 0 + f 1 = f 1 + f 0" }), {
    checkGoal: checked,
    reviewGoal: async () => ({ matches_request: true, selection_question: true, discriminates: false,
      competing_statement: "theorem t' (f g : ℕ → ℕ) : f 0 + f 1 = g 0 + g 1",
      feedback: "The sum is invariant under reordering the terms." })
  });
  assert.equal(result.code, "LEAN_GOAL_NOT_DISCRIMINATING");
  assert.equal(result.prepared, false);
  assert.equal(result.spec, undefined);
  assert.equal(result.retryable, true);
  const text = formatLeanGoalPreparation(result);
  assert.match(text, /competing_statement=theorem t'/);
  assert.match(text, /The target is not locked/);
});

test("a single stated claim is never refused for lack of discrimination", async () => {
  const result = await prepareLeanGoal(goal(), { checkGoal: checked,
    reviewGoal: async () => ({ matches_request: true, selection_question: false, discriminates: false, feedback: "ok" }) });
  assert.equal(result.prepared, true);
});
