/** Test origin: DS4 acceptance requirements BEH-PROMOTE-002 and SEC-ROLLBACK-003. */

import assert from "node:assert/strict";
import test from "node:test";

import { createEvolutionSmokeEvaluator } from "./evolutionSmoke.mjs";

test("BEH-PROMOTE-002 post-apply smoke checks server syntax and the production frontend build", async () => {
  const calls = [];
  const smoke = createEvolutionSmokeEvaluator({
    repositoryRoot: "/repo",
    async execFileImpl(executable, args, options) { calls.push({ executable, args, options }); return { stdout: "", stderr: "" }; }
  });
  assert.equal((await smoke()).passed, true);
  assert.deepEqual(calls.map((entry) => entry.args), [
    ["--check", "/repo/frontend/server/index.mjs"],
    ["--prefix", "/repo/frontend", "run", "build"]
  ]);
  assert.equal(calls.every((entry) => entry.options.timeout === 120_000), true);
});

test("SEC-ROLLBACK-003 post-apply smoke fails closed without leaking command output", async () => {
  const smoke = createEvolutionSmokeEvaluator({
    repositoryRoot: "/repo",
    async execFileImpl() { throw Object.assign(new Error("secret output"), { code: 1 }); }
  });
  assert.deepEqual(await smoke(), { passed: false, reasonCode: "SMOKE_COMMAND_FAILED" });
});
