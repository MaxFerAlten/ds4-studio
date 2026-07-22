/** Test origin: DS4 acceptance requirements BEH-API-001, SEC-API-001, and SEC-UI-002. */

import assert from "node:assert/strict";
import test from "node:test";

import { assertConfiguredLevel, assertReviewBinding, createEvolutionRouter } from "./evolutionApi.mjs";
import { EvolutionAuth } from "./evolutionAuth.mjs";

function dependencies(auth) {
  return {
    runtime: { orchestrator: {}, subscribe() { return () => {}; } },
    runStore: {},
    auth,
    views: {}
  };
}

test("BEH-API-001 SEC-API-001 router exposes bounded routes and write auth rejects missing credentials", () => {
  const token = "t".repeat(32);
  const auth = new EvolutionAuth({ tokenEnv: "TOKEN", env: { TOKEN: token } });
  const router = createEvolutionRouter(dependencies(auth));
  const routes = router.stack.filter((layer) => layer.route).map((layer) => `${Object.keys(layer.route.methods)[0].toUpperCase()} ${layer.route.path}`);
  assert.ok(routes.includes("GET /runs"));
  assert.ok(routes.includes("POST /runs/:runId/revisions/:revision/approve"));
  let status;
  let body;
  let next = false;
  auth.requireWrite({ headers: {} }, { status(value) { status = value; return this; }, json(value) { body = value; } }, () => { next = true; });
  assert.equal(status, 401);
  assert.equal(body.error, "EVOLUTION_UNAUTHORIZED");
  assert.equal(next, false);
});

test("SEC-UI-002 stale approval hashes are rejected before an internal approval can be issued", () => {
  const current = { revision: 1, candidateHash: "a".repeat(64), parentHash: "b".repeat(64), reviewHash: "c".repeat(64) };
  assert.equal(assertReviewBinding({ ...current }, current), true);
  assert.throws(
    () => assertReviewBinding({ ...current, candidateHash: "d".repeat(64) }, current),
    (error) => error.code === "REVIEW_HASH_MISMATCH" && error.status === 409
  );
});

test("write endpoints are disabled when the configured token is absent", () => {
  const auth = new EvolutionAuth({ tokenEnv: "TOKEN", env: {} });
  let status;
  auth.requireWrite({ headers: {} }, { status(value) { status = value; return this; }, json() {} }, () => assert.fail("must not authorize"));
  assert.equal(status, 403);
});

test("SEC-API-001 configured maxLevel fails closed before a higher-level run is created", () => {
  assert.equal(assertConfiguredLevel({ contractVersion: "ds4_evolution_task_v1" }, "B"), "B");
  assert.throws(
    () => assertConfiguredLevel({ contractVersion: "ds4_evolution_task_v2", automation: { level: "D" } }, "C"),
    (error) => error.code === "EVOLUTION_LEVEL_DISABLED" && error.status === 403
  );
});
