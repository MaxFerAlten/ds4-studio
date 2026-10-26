import test from "node:test";
import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadLeanConfig } from "./leanConfig.mjs";
import { runLeanPreflight } from "./leanPreflight.mjs";
import { executeLeanCheck } from "./leanExecutor.mjs";
import { prepareLeanGoal } from "./leanGoalPreparation.mjs";
import { requireReady } from "./fixtures/realTestGate.mjs";

const root = resolve(fileURLToPath(import.meta.url), "..", "..", "..", "..");
const runsRoot = resolve(tmpdir(), `ds4-lean-goals-${process.pid}`);
const config = loadLeanConfig(process.env, { enabled: true, runtimeRoot: resolve(root, "lean-runtime"), runsRoot });
const preflight = await runLeanPreflight(config);
const core = requireReady(preflight.profiles?.core, { flag: "DS4_TEST_REAL_LEAN", label: "core" });
const mathlib = requireReady(preflight.profiles?.mathlib, { flag: "DS4_TEST_REAL_LEAN", label: "mathlib" });
const checkGoal = (body) => executeLeanCheck({ ...body, sessionId: "goal-tests" }, { config, preflight });
const reviewGoal = async () => ({ matches_request: true, selection_question: false, discriminates: true, feedback: "Fixture scope accepted; mathematical proof still required." });
test.after(() => rm(runsRoot, { recursive: true, force: true }));

test("real goal preparation rejects undeclared variables, then accepts a repaired header before proving it", core, async () => {
  const args = { claim: "Addition of naturals is commutative.", target_declaration: "addition_commutes",
    target_statement: "theorem addition_commutes (n : Nat) : x + n = n + x" };
  const bad = await prepareLeanGoal(args, { checkGoal, reviewGoal });
  assert.equal(bad.prepared, false);
  assert.equal(bad.spec, undefined);
  assert.match(bad.diagnostics?.[0]?.message ?? "", /Unknown identifier `x`/);
  args.target_statement = "theorem addition_commutes (x n : Nat) : x + n = n + x";
  const ready = await prepareLeanGoal(args, { checkGoal, reviewGoal });
  assert.equal(ready.prepared, true, JSON.stringify(ready));
  assert.equal(ready.verified, false);
  const proof = await executeLeanCheck({ contractVersion: "lean_check_request_v1", sessionId: "goal-tests",
    code: `${args.target_statement} := by exact Nat.add_comm x n`, taskMode: "proof", profile: "core",
    targetDeclaration: args.target_declaration, expectedTargetStatementSha256: ready.spec.targetStatementSha256
  }, { config, preflight });
  assert.equal(proof.orchestration.verified, true, proof.summary);
});

test("real goal preparation permits fixing legacy sum syntax before the target is sealed", mathlib, async () => {
  const args = { claim: "The general binomial expansion identity.", target_declaration: "binomial_expansion",
    imports: ["Mathlib.Data.Nat.Choose.Sum"],
    target_statement: "theorem binomial_expansion (x y : ℚ) (n : ℕ) : (x+y)^n = ∑ k in Finset.range (n+1), (n.choose k : ℚ)*x^k*y^(n-k)" };
  const bad = await prepareLeanGoal(args, { checkGoal, reviewGoal });
  assert.equal(bad.prepared, false);
  assert.equal(bad.spec, undefined);
  args.target_statement = args.target_statement.replace(" k in ", " k ∈ ");
  const ready = await prepareLeanGoal(args, { checkGoal, reviewGoal });
  assert.equal(ready.prepared, true, JSON.stringify(ready));
  assert.equal(ready.verified, false);
});
