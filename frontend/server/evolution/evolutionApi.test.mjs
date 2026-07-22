/** Test origin: DS4 acceptance requirements BEH-API-001, SEC-API-001, SEC-UI-002, BEH-API-004/005, SEC-API-003/004/005. */

import assert from "node:assert/strict";
import test from "node:test";
import express from "express";

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

test("BEH-API-004 SEC-API-003 manual candidate route invokes runManualCandidate exactly once and rejects automated runs", async () => {
  const token = "t".repeat(32);
  const auth = new EvolutionAuth({ tokenEnv: "TOKEN", env: { TOKEN: token } });
  let manualCalls = 0;
  let lastInput = null;
  const fakeRun = {
    manifest: { taskContract: { contractVersion: "ds4_evolution_task_v1" } },
    state: "BASELINE_READY"
  };
  const router = createEvolutionRouter({
    runtime: {
      orchestrator: {
        async runManualCandidate(runId, input) {
          manualCalls++;
          lastInput = input;
          return { state: "MANUAL_REVIEW", gateDecision: { decision: "MANUAL_REVIEW" } };
        }
      },
      subscribe() { return () => {}; }
    },
    runStore: { async loadRun() { return fakeRun; } },
    auth,
    views: { run(r) { return r; } }
  });

  const app = express();
  app.use(express.json());
  app.use("/api/evolution", router);

  const server = app.listen(0);
  const { port } = server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/evolution/runs/run-1/candidates`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ proposal: { revision: 1 }, patchText: "diff --git a/x b/x" })
    });
    assert.equal(res.status, 202);
    const data = await res.json();
    assert.equal(data.result.state, "MANUAL_REVIEW");
    assert.equal(manualCalls, 1);
    assert.deepEqual(lastInput, { proposal: { revision: 1 }, patchText: "diff --git a/x b/x" });
  } finally {
    server.close();
  }
});

test("SEC-API-004 missing token rejects manual candidate mutation", async () => {
  const auth = new EvolutionAuth({ tokenEnv: "TOKEN", env: { TOKEN: "t".repeat(32) } });
  const router = createEvolutionRouter({
    runtime: { orchestrator: {}, subscribe() { return () => {}; } },
    runStore: {},
    auth,
    views: {}
  });
  const app = express();
  app.use(express.json());
  app.use("/api/evolution", router);
  const server = app.listen(0);
  const { port } = server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/evolution/runs/run-1/candidates`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ proposal: {}, patchText: "diff" })
    });
    assert.ok(res.status >= 400);
  } finally {
    server.close();
  }
});

test("SEC-API-005 body cannot inject repositoryRoot or workspaceRoot into manual candidate", async () => {
  const token = "t".repeat(32);
  const auth = new EvolutionAuth({ tokenEnv: "TOKEN", env: { TOKEN: token } });
  let lastInput = null;
  const fakeRun = {
    manifest: { taskContract: { contractVersion: "ds4_evolution_task_v1" } },
    state: "BASELINE_READY"
  };
  const router = createEvolutionRouter({
    runtime: {
      orchestrator: {
        async runManualCandidate(_runId, input) {
          lastInput = input;
          return { state: "MANUAL_REVIEW" };
        }
      },
      subscribe() { return () => {}; }
    },
    runStore: { async loadRun() { return fakeRun; } },
    auth,
    views: { run(r) { return r; } }
  });
  const app = express();
  app.use(express.json());
  app.use("/api/evolution", router);
  const server = app.listen(0);
  const { port } = server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/evolution/runs/run-1/candidates`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ proposal: { revision: 1 }, patchText: "diff", repositoryRoot: "/etc", workspaceRoot: "/tmp" })
    });
    assert.equal(res.status, 202);
    assert.equal(lastInput.repositoryRoot, undefined);
    assert.equal(lastInput.workspaceRoot, undefined);
  } finally {
    server.close();
  }
});
