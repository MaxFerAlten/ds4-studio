// Tests for leanRoutes.mjs — exercises the real router against a real express
// app. The executor is stubbed so these stay fast and hermetic; the executor
// itself is covered by leanExecutor.test.mjs and leanSandbox.test.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { createLeanRouter } from "./leanRoutes.mjs";
import { LeanRunRegistry } from "./leanRunRegistry.mjs";
import { createLeanAuditStore } from "./leanAuditStore.mjs";

const AUDIT_ROOT = await mkdtemp(resolve(tmpdir(), "ds4-lean-route-audit-"));
const auditStore = createLeanAuditStore({ auditRoot: AUDIT_ROOT });
test.after(async () => {
  await rm(AUDIT_ROOT, { recursive: true, force: true });
});

const POLICY_REVISION = "a".repeat(40);
const CONTRACT_REVISION = "c".repeat(64);
const RID = (n) => `lean-${"a".repeat(12)}-${n}-${n}`;

/** Shared config shape matching loadLeanConfig output (registry defaults). */
function baseConfig(overrides = {}) {
  return {
    enabled: true,
    defaultProfile: "core",
    defaultTimeoutSec: 30,
    maxTimeoutSec: 120,
    maxGlobalRuns: 2,
    maxRunsPerSession: 1,
    maxQueuedPerSession: 1,
    registryCapacity: 64,
    registryTtlMs: 3600000,
    ...overrides,
  };
}

/**
 * Mount the router with per-test dependencies and issue one request.
 *
 * @param {{ method: string, path: string, body?: object, headers?: object }} request
 * @param {object} [deps] - Overrides for the router dependencies
 * @returns {Promise<{ status: number, body: any, headers: object, runRegistry: object }>}
 */
async function call(request, deps = {}) {
  const app = express();
  app.use(express.json());
  const runRegistry =
    deps.runRegistry ||
    new LeanRunRegistry({
      maxGlobalRuns: deps.config?.maxGlobalRuns,
      maxRunsPerSession: deps.config?.maxRunsPerSession,
      maxQueuedPerSession: deps.config?.maxQueuedPerSession,
      capacity: deps.config?.registryCapacity,
      ttlMs: deps.config?.registryTtlMs,
    });
  app.use(
    "/api/lean",
    createLeanRouter({
      express,
      config: baseConfig(deps.config),
      executeLeanCheck:
        deps.executeLeanCheck ||
        (async (req) => ({
          contractVersion: "lean_result_v1",
          runId: req.runId,
          sessionId: req.sessionId,
          status: "checked",
          isError: false,
          summary: "ok",
          certified: false,
        })),
      getPreflight: deps.getPreflight || (async () => ({ ok: true, sandboxAvailable: true, profiles: {}, errors: [] })),
      getLeanPolicyState:
        deps.getLeanPolicyState || (async () => ({ loaded: true, revision: POLICY_REVISION })),
      getLeanContractPolicy:
        deps.getLeanContractPolicy || (async () => ({ policy: {}, revision: CONTRACT_REVISION })),
      runRegistry,
      auditStore,
      metrics: deps.metrics,
      logger: { error() {} },
    })
  );

  const server = createServer(app);
  await new Promise((r) => server.listen(0, r));
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/lean${request.path}`, {
      method: request.method,
      headers: { "Content-Type": "application/json", ...request.headers },
      body: request.body === undefined ? undefined : JSON.stringify(request.body),
    });
    const text = await res.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
    return { status: res.status, body, headers: res.headers, runRegistry };
  } finally {
    server.close();
  }
}

const REQ = { contractVersion: "lean_check_request_v1", code: "theorem t : 1 + 1 = 2 := by decide" };

test("GET /status reports the feature and preflight verdict", async () => {
  const res = await call({ method: "GET", path: "/status" });
  assert.equal(res.status, 200);
  assert.equal(res.body.enabled, true);
  assert.equal(res.body.policyLoaded, true);
  assert.equal(res.body.contractVersion, "lean_result_v1");
  assert.equal(res.body.preflight.ok, true);
});

test("GET /status reports requested vs effective vs source (R3 gate)", async () => {
  const res = await call(
    { method: "GET", path: "/status" },
    {
      config: {
        enabled: true,
        policyAuto: false,
        sandboxRequired: true,
        defaultProfile: "mathlib",
        orchestration: { maxAttempts: 6, maxSameFailure: 2, maxPrematureFinalizations: 3, maxWallClockMs: 360000 },
        requested: { enabled: true, policyAuto: true, sandboxRequired: true, defaultProfile: "core" },
        sources: {
          enabled: "env",
          policyAuto: "file",
          sandboxRequired: "default",
          defaultProfile: "file",
          runtimeRoot: "derived-project-root",
          runsRoot: "derived-project-root",
        },
      },
    }
  );
  assert.equal(res.body.enabled, true);
  assert.deepEqual(res.body.requested, {
    enabled: true,
    policyAuto: true,
    sandboxRequired: true,
    defaultProfile: "core",
  });
  assert.deepEqual(res.body.effective, {
    enabled: true,
    policyAuto: false,
    sandboxRequired: true,
    defaultProfile: "mathlib",
    // The native client reads the proof budget from here at preflight, so it
    // is part of the effective contract, not a debug extra.
    orchestration: { maxAttempts: 6, maxSameFailure: 2, maxPrematureFinalizations: 3, maxWallClockMs: 360000 },
  });
  assert.equal(res.body.source.enabled, "env");
  assert.equal(res.body.source.policyAuto, "file");
  assert.equal(res.body.source.runtimeRoot, "derived-project-root");
  assert.ok(!JSON.stringify(res.body).includes("derived/lean-runtime"));
});

test("GET /status does not leak host paths from preflight reasons", async () => {
  const res = await call(
    { method: "GET", path: "/status" },
    {
      getPreflight: async () => ({
        ok: false,
        sandboxAvailable: true,
        profiles: { core: { ok: false, toolchain: null, reason: "/home/secret/lean-runtime/core missing" } },
        errors: [],
      }),
    }
  );
  assert.equal(res.body.preflight.profiles.core.ok, false);
  assert.ok(!JSON.stringify(res.body).includes("/home/secret"));
});

test("GET /status reports the registry concurrency bounds and current load", async () => {
  const res = await call({ method: "GET", path: "/status" });
  assert.deepEqual(res.body.concurrency, {
    maxGlobalRuns: 2,
    maxRunsPerSession: 1,
    maxQueuedPerSession: 1,
    activeGlobalRuns: 0,
    activeRuns: 0,
  });
});

test("POST /exec returns the executor result", async () => {
  const res = await call({ method: "POST", path: "/exec", body: REQ });
  assert.equal(res.status, 200);
  assert.equal(res.body.status, "checked");
  assert.match(res.body.runId, /^lean-/);
});

test("POST /exec passes a settled sessionId and runId to the executor", async () => {
  let seen = null;
  await call(
    { method: "POST", path: "/exec", body: { ...REQ, sessionId: "s1", runId: RID(1) } },
    {
      executeLeanCheck: async (req) => {
        seen = req;
        return { contractVersion: "lean_result_v1", status: "checked", isError: false, certified: false };
      },
    }
  );
  assert.equal(seen.sessionId, "s1");
  assert.equal(seen.runId, RID(1));
});

test("POST /exec forwards the preflight report to the executor", async () => {
  let seenOptions = null;
  await call(
    { method: "POST", path: "/exec", body: REQ },
    {
      getPreflight: async () => ({ ok: true, profiles: { core: { ok: true } } }),
      executeLeanCheck: async (_req, options) => {
        seenOptions = options;
        return { contractVersion: "lean_result_v1", status: "checked", isError: false, certified: false };
      },
    }
  );
  assert.equal(seenOptions.preflight.profiles.core.ok, true, "executor must receive a real preflight");
  assert.ok(seenOptions.abortSignal);
});

test("POST /exec when disabled returns 503", async () => {
  const res = await call({ method: "POST", path: "/exec", body: REQ }, { config: { enabled: false } });
  assert.equal(res.status, 503);
  assert.equal(res.body.errorCode, "LEAN_DISABLED");
});

test("POST /exec rejects a non-object body with 400, not 500", async () => {
  // express.json() rejects this before the handler; what matters is that a
  // malformed body is never turned into a run.
  const res = await call({ method: "POST", path: "/exec", body: "nope" });
  assert.equal(res.status, 400);
});

test("R6: invalid contract version is rejected without registering a run", async () => {
  const runRegistry = new LeanRunRegistry();
  const res = await call(
    { method: "POST", path: "/exec", body: { ...REQ, contractVersion: "bogus_v9" } },
    { runRegistry }
  );
  assert.equal(res.status, 400);
  assert.equal(res.body.errorCode, "LEAN_REQUEST_CONTRACT_UNSUPPORTED");
  assert.equal(runRegistry.size, 0, "invalid requests must never enter the registry");
});

test("R6: invalid sessionId is rejected without registering a run", async () => {
  const runRegistry = new LeanRunRegistry();
  const res = await call(
    { method: "POST", path: "/exec", body: { ...REQ, sessionId: "../etc" } },
    { runRegistry }
  );
  assert.equal(res.status, 400);
  assert.equal(res.body.errorCode, "LEAN_SESSION_ID_INVALID");
  assert.equal(runRegistry.size, 0);
});

test("R6: runId with colon or path traversal is rejected before the Map", async () => {
  const runRegistry = new LeanRunRegistry();
  for (const runId of ["lean-aaaaaaaaaaaa-1-1:../../x", "lean-aaaaaaaaaaaa-1-1/../..", "..%2F..%2Fetc"]) {
    const res = await call({ method: "POST", path: "/exec", body: { ...REQ, runId } }, { runRegistry });
    assert.equal(res.status, 422, `runId ${runId} must be rejected`);
    assert.equal(res.body.errorCode, "LEAN_RUN_ID_INVALID");
  }
  assert.equal(runRegistry.size, 0, "no traversal attempt may reach the Map");
});

// A prompt revision drift used to be a 409 here. It is not: the server having
// newer editorial text in skills/lean/SKILL.md says nothing about whether this
// client can read a lean_result_v1. The run proceeds and the drift is reported.
test("POST /exec runs a check whose prompt revision drifted from the server's", async () => {
  let seenPolicyContext = null;
  const res = await call(
    {
      method: "POST",
      path: "/exec",
      body: { ...REQ, promptRevision: "b".repeat(40), contractRevision: CONTRACT_REVISION },
    },
    {
      executeLeanCheck: async (req, opts) => {
        seenPolicyContext = opts.policyContext;
        return {
          contractVersion: "lean_result_v1",
          runId: req.runId,
          status: "checked",
          isError: false,
          certified: false,
        };
      },
    }
  );
  assert.equal(res.status, 200);
  assert.equal(res.body.status, "checked");
  assert.equal(seenPolicyContext.promptDriftDetected, true);
  assert.equal(seenPolicyContext.requestPromptRevision, "b".repeat(40));
  assert.equal(seenPolicyContext.serverPromptRevision, POLICY_REVISION);
  assert.equal(seenPolicyContext.contractRevision, CONTRACT_REVISION);
  assert.equal(seenPolicyContext.legacyClient, false);
});

test("POST /exec refuses an incompatible contract revision without spawning", async () => {
  let spawned = false;
  const res = await call(
    {
      method: "POST",
      path: "/exec",
      body: { ...REQ, promptRevision: POLICY_REVISION, contractRevision: "d".repeat(64) },
    },
    {
      executeLeanCheck: async () => {
        spawned = true;
        return { contractVersion: "lean_result_v1", status: "checked", isError: false, certified: false };
      },
    }
  );
  assert.equal(res.status, 409);
  assert.equal(res.body.errorCode, "LEAN_CONTRACT_REVISION_MISMATCH");
  assert.equal(res.body.expectedContractRevision, CONTRACT_REVISION);
  assert.equal(res.body.receivedContractRevision, "d".repeat(64));
  assert.equal(spawned, false, "no contract mismatch may reach the Lean process");
  assert.equal(res.body.orchestration.terminal, true);
  assert.equal(res.body.orchestration.verified, false);
});

test("POST /exec treats a client with no contractRevision per the rollout flag", async () => {
  const legacyBody = { ...REQ, policyRevision: POLICY_REVISION };

  let seenPolicyContext = null;
  const permissive = await call(
    { method: "POST", path: "/exec", body: legacyBody },
    {
      executeLeanCheck: async (req, opts) => {
        seenPolicyContext = opts.policyContext;
        return { contractVersion: "lean_result_v1", runId: req.runId, status: "checked", isError: false, certified: false };
      },
    }
  );
  assert.equal(permissive.status, 200);
  assert.equal(seenPolicyContext.legacyClient, true);
  assert.equal(seenPolicyContext.promptDriftDetected, false, "the legacy alias still feeds promptRevision");

  const strict = await call(
    { method: "POST", path: "/exec", body: legacyBody },
    { config: { requireContractRevision: true } }
  );
  assert.equal(strict.status, 409);
  assert.equal(strict.body.errorCode, "LEAN_CONTRACT_REVISION_REQUIRED");
  assert.equal(strict.body.expectedContractRevision, CONTRACT_REVISION);
});

test("POST /exec refuses two disagreeing names for one prompt revision", async () => {
  const res = await call({
    method: "POST",
    path: "/exec",
    body: {
      ...REQ,
      promptRevision: "b".repeat(40),
      policyRevision: "e".repeat(40),
      contractRevision: CONTRACT_REVISION,
    },
  });
  assert.equal(res.status, 409);
  assert.equal(res.body.errorCode, "LEAN_PROMPT_REVISION_ALIAS_MISMATCH");
});

test("GET /status reports the contract revision and does not claim session visibility", async () => {
  const res = await call({ method: "GET", path: "/status" });
  assert.equal(res.body.contractRevision, CONTRACT_REVISION);
  assert.equal(res.body.contractDescriptorError, null);
  assert.equal(res.body.sessionPolicyVisible, false);
  assert.equal(res.body.policy.promptRevision, POLICY_REVISION);
  assert.equal(res.body.policy.available, true);
  assert.equal(res.body.policy.bundleStale, false);
});

test("GET /status surfaces a stale contract descriptor instead of hiding it", async () => {
  const res = await call(
    { method: "GET", path: "/status" },
    {
      getLeanContractPolicy: async () => {
        const err = new Error("LEAN_CONTRACT_DESCRIPTOR_STALE: regenerate");
        err.code = "LEAN_CONTRACT_DESCRIPTOR_STALE";
        throw err;
      },
    }
  );
  assert.equal(res.status, 200);
  assert.equal(res.body.contractRevision, "");
  assert.equal(res.body.contractDescriptorError, "LEAN_CONTRACT_DESCRIPTOR_STALE");
});

test("a typecheck failure is HTTP 200 with isError", async () => {
  const res = await call(
    { method: "POST", path: "/exec", body: REQ },
    {
      executeLeanCheck: async () => ({
        contractVersion: "lean_result_v1",
        status: "failed",
        isError: true,
        certified: false,
      }),
    }
  );
  assert.equal(res.status, 200, "a Lean error is not an HTTP error");
  assert.equal(res.body.isError, true);
});

test("a runtime failure propagates its status code", async () => {
  const res = await call(
    { method: "POST", path: "/exec", body: REQ },
    {
      executeLeanCheck: async () => ({
        contractVersion: "lean_result_v1",
        status: "preflight_failed",
        isError: true,
        statusCode: 503,
        errorCode: "LEAN_SANDBOX_UNAVAILABLE",
        certified: false,
      }),
    }
  );
  assert.equal(res.status, 503);
});

test("an executor throw becomes 500 and does not poison the registry", async () => {
  const runRegistry = new LeanRunRegistry();
  const res = await call(
    { method: "POST", path: "/exec", body: { ...REQ, sessionId: "s", runId: RID(99) } },
    { runRegistry, executeLeanCheck: async () => { throw new Error("kaboom"); } }
  );
  assert.equal(res.status, 500);
  assert.equal(res.body.status, "internal_error");
  assert.equal(runRegistry.size, 0, "a fatal error must free the slot for a retry");
});

test("replaying the same run id with the same source returns the cached result", async () => {
  const runRegistry = new LeanRunRegistry();
  let calls = 0;
  const deps = {
    runRegistry,
    executeLeanCheck: async (req) => {
      calls += 1;
      return { contractVersion: "lean_result_v1", runId: req.runId, status: "checked", isError: false, certified: false };
    },
  };
  const body = { ...REQ, sessionId: "s1", runId: RID(11) };
  const first = await call({ method: "POST", path: "/exec", body }, deps);
  const second = await call({ method: "POST", path: "/exec", body }, deps);

  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(calls, 1, "the second submission must not start a second process");
});

test("reusing a run id with different source is rejected", async () => {
  const runRegistry = new LeanRunRegistry();
  const deps = { runRegistry };
  await call(
    { method: "POST", path: "/exec", body: { ...REQ, sessionId: "s1", runId: RID(12) } },
    deps
  );
  const res = await call(
    {
      method: "POST",
      path: "/exec",
      body: { ...REQ, sessionId: "s1", runId: RID(12), code: "theorem other : True := trivial" },
    },
    deps
  );
  assert.equal(res.status, 409);
  assert.equal(res.body.errorCode, "LEAN_RUN_ID_REUSED_WITH_DIFFERENT_INPUT");
});

test("R6: concurrent per-session run limit returns 429 without spawning", async () => {
  const runRegistry = new LeanRunRegistry();
  let spawned = 0;
  let release;
  const blocker = new Promise((r) => { release = r; });
  const started = call(
    { method: "POST", path: "/exec", body: { ...REQ, sessionId: "s1", runId: RID(21) } },
    {
      runRegistry,
      executeLeanCheck: async () => {
        spawned += 1;
        await blocker;
        return { contractVersion: "lean_result_v1", status: "checked", isError: false, certified: false };
      },
    }
  );
  try {
    while (runRegistry.activeGlobalRuns() === 0) await new Promise((r) => setTimeout(r, 5));

    const second = await call(
      { method: "POST", path: "/exec", body: { ...REQ, sessionId: "s1", runId: RID(22) } },
      { runRegistry }
    );
    assert.equal(second.status, 429);
    assert.equal(second.body.errorCode, "LEAN_CONCURRENCY_LIMIT");
    assert.equal(spawned, 1, "the rejected request must not spawn");
    assert.equal(runRegistry.size, 1);
  } finally {
    release();
  }
  const first = await started;
  assert.equal(first.status, 200);
});

test("R6: global concurrent run limit returns 429 for another session", async () => {
  const runRegistry = new LeanRunRegistry({ maxGlobalRuns: 1 });
  let release;
  const blocker = new Promise((r) => { release = r; });
  const started = call(
    { method: "POST", path: "/exec", body: { ...REQ, sessionId: "s1", runId: RID(31) } },
    {
      runRegistry,
      config: { maxGlobalRuns: 1 },
      executeLeanCheck: async () => {
        await blocker;
        return { contractVersion: "lean_result_v1", status: "checked", isError: false, certified: false };
      },
    }
  );
  try {
    while (runRegistry.activeGlobalRuns() === 0) await new Promise((r) => setTimeout(r, 5));

    const second = await call(
      { method: "POST", path: "/exec", body: { ...REQ, sessionId: "s2", runId: RID(32) } },
      { runRegistry, config: { maxGlobalRuns: 1 } }
    );
    assert.equal(second.status, 429);
    assert.equal(second.body.errorCode, "LEAN_CONCURRENCY_LIMIT");
  } finally {
    release();
  }
  await started;
});

test("R6: session A cannot read or cancel session B through the scoped routes", async () => {
  const runRegistry = new LeanRunRegistry();
  let release;
  const blocker = new Promise((r) => { release = r; });
  const started = call(
    { method: "POST", path: "/exec", body: { ...REQ, sessionId: "session-a", runId: RID(41) } },
    {
      runRegistry,
      executeLeanCheck: async () => {
        await blocker;
        return { contractVersion: "lean_result_v1", status: "checked", isError: false, certified: false };
      },
    }
  );
  try {
    while (runRegistry.activeGlobalRuns() === 0) await new Promise((r) => setTimeout(r, 5));

    const peek = await call({ method: "GET", path: "/sessions/session-b/runs/lean-aaaaaaaaaaaa-41-41" }, { runRegistry });
    assert.equal(peek.status, 404, "session B must not see session A's run");

    const cancel = await call(
      { method: "POST", path: "/sessions/session-b/runs/lean-aaaaaaaaaaaa-41-41/cancel" },
      { runRegistry }
    );
    assert.equal(cancel.status, 404, "session B must not cancel session A's run");
    assert.equal(runRegistry.get({ sessionId: "session-a", runId: RID(41) }).status, "running");
  } finally {
    release();
  }
  await started;
});

test("scoped GET returns the completed result for the owning session", async () => {
  const runRegistry = new LeanRunRegistry();
  await call(
    { method: "POST", path: "/exec", body: { ...REQ, sessionId: "s1", runId: RID(51) } },
    { runRegistry }
  );
  const res = await call({ method: "GET", path: "/sessions/s1/runs/lean-aaaaaaaaaaaa-51-51" }, { runRegistry });
  assert.equal(res.status, 200);
  assert.equal(res.body.status, "checked");
});

test("scoped GET reports 202 while a run is still executing", async () => {
  const runRegistry = new LeanRunRegistry();
  let release;
  const blocker = new Promise((r) => { release = r; });
  const started = call(
    { method: "POST", path: "/exec", body: { ...REQ, sessionId: "s1", runId: RID(52) } },
    {
      runRegistry,
      executeLeanCheck: async () => {
        await blocker;
        return { contractVersion: "lean_result_v1", status: "checked", isError: false, certified: false };
      },
    }
  );
  try {
    while (runRegistry.activeGlobalRuns() === 0) await new Promise((r) => setTimeout(r, 5));
    const res = await call({ method: "GET", path: "/sessions/s1/runs/lean-aaaaaaaaaaaa-52-52" }, { runRegistry });
    assert.equal(res.status, 202);
    assert.equal(res.body.status, "running");
  } finally {
    release();
  }
  await started;
});

test("scoped GET on an unknown run id returns 404", async () => {
  const res = await call({ method: "GET", path: "/sessions/s1/runs/lean-aaaaaaaaaaaa-99-99" });
  assert.equal(res.status, 404);
});

test("scoped cancel with a traversal runId returns 404 before touching the Map", async () => {
  const runRegistry = new LeanRunRegistry();
  const res = await call(
    { method: "POST", path: "/sessions/s1/runs/lean-aaaaaaaaaaaa-1-1%3A..%2F..%2Fetc/cancel" },
    { runRegistry }
  );
  assert.equal(res.status, 404);
  assert.equal(runRegistry.size, 0);
});

test("scoped cancel aborts a running check", async () => {
  const runRegistry = new LeanRunRegistry();
  let observedAbort = false;
  const started = call(
    { method: "POST", path: "/exec", body: { ...REQ, sessionId: "s1", runId: RID(61) } },
    {
      runRegistry,
      executeLeanCheck: async (_req, options) =>
        new Promise((resolve) => {
          options.abortSignal.addEventListener("abort", () => {
            observedAbort = true;
            resolve({ contractVersion: "lean_result_v1", status: "cancelled", isError: true, certified: false });
          });
        }),
    }
  );

  while (runRegistry.activeGlobalRuns() === 0) await new Promise((r) => setTimeout(r, 5));

  const cancel = await call(
    { method: "POST", path: "/sessions/s1/runs/lean-aaaaaaaaaaaa-61-61/cancel" },
    { runRegistry }
  );
  assert.equal(cancel.status, 200);
  assert.equal(cancel.body.cancelled, true);

  const result = await started;
  assert.equal(observedAbort, true);
  assert.equal(result.body.status, "cancelled");
});

test("cancellation is idempotent", async () => {
  const runRegistry = new LeanRunRegistry();
  let release;
  const blocker = new Promise((r) => { release = r; });
  const started = call(
    { method: "POST", path: "/exec", body: { ...REQ, sessionId: "s1", runId: RID(62) } },
    {
      runRegistry,
      executeLeanCheck: async () => {
        await blocker;
        return { contractVersion: "lean_result_v1", status: "cancelled", isError: true, certified: false };
      },
    }
  );
  try {
    while (runRegistry.activeGlobalRuns() === 0) await new Promise((r) => setTimeout(r, 5));

    const first = await call(
      { method: "POST", path: "/sessions/s1/runs/lean-aaaaaaaaaaaa-62-62/cancel" },
      { runRegistry }
    );
    const second = await call(
      { method: "POST", path: "/sessions/s1/runs/lean-aaaaaaaaaaaa-62-62/cancel" },
      { runRegistry }
    );
    assert.equal(first.body.cancelled, true);
    assert.equal(second.status, 200);
    assert.equal(second.body.cancelled, false);
    assert.equal(second.body.reason, "already cancelled");
  } finally {
    release();
  }
  await started;
});

test("legacy /cancel requires the session header and emits Deprecation", async () => {
  const runRegistry = new LeanRunRegistry();
  let release;
  const blocker = new Promise((r) => { release = r; });
  const started = call(
    { method: "POST", path: "/exec", body: { ...REQ, sessionId: "s1", runId: RID(71) } },
    {
      runRegistry,
      executeLeanCheck: async () => {
        await blocker;
        return { contractVersion: "lean_result_v1", status: "cancelled", isError: true, certified: false };
      },
    }
  );
  try {
    while (runRegistry.activeGlobalRuns() === 0) await new Promise((r) => setTimeout(r, 5));

    const res = await call(
      { method: "POST", path: "/cancel/lean-aaaaaaaaaaaa-71-71", headers: { "x-lean-session-id": "s1" } },
      { runRegistry }
    );
    assert.equal(res.status, 200);
    assert.equal(res.body.cancelled, true);
    assert.equal(res.headers.get("deprecation"), "true");
    assert.ok(res.headers.get("link").includes("rel=\"successor-version\""));
    assert.ok(res.headers.get("link").includes("/sessions/s1/runs/lean-aaaaaaaaaaaa-71-71/cancel"));
  } finally {
    release();
  }
  await started;
});

test("legacy cancel without the right session header does not touch another session's run", async () => {
  const runRegistry = new LeanRunRegistry();
  let release;
  const blocker = new Promise((r) => { release = r; });
  const started = call(
    { method: "POST", path: "/exec", body: { ...REQ, sessionId: "s1", runId: RID(72) } },
    {
      runRegistry,
      executeLeanCheck: async () => {
        await blocker;
        return { contractVersion: "lean_result_v1", status: "checked", isError: false, certified: false };
      },
    }
  );
  try {
    while (runRegistry.activeGlobalRuns() === 0) await new Promise((r) => setTimeout(r, 5));

    const res = await call({ method: "POST", path: "/cancel/lean-aaaaaaaaaaaa-72-72" }, { runRegistry });
    assert.equal(res.status, 404, "default session must not see s1's run");
  } finally {
    release();
  }
  await started;
});

test("legacy GET /runs requires the session header", async () => {
  const runRegistry = new LeanRunRegistry();
  await call(
    { method: "POST", path: "/exec", body: { ...REQ, sessionId: "s1", runId: RID(73) } },
    { runRegistry }
  );
  const res = await call(
    { method: "GET", path: "/runs/lean-aaaaaaaaaaaa-73-73", headers: { "x-lean-session-id": "s1" } },
    { runRegistry }
  );
  assert.equal(res.status, 200);
  assert.equal(res.body.status, "checked");
  assert.equal(res.headers.get("deprecation"), "true");
});

test("legacy GET /runs on an unknown run id returns 404", async () => {
  const res = await call({ method: "GET", path: "/runs/lean-nope" });
  assert.equal(res.status, 404);
});

test("GET /status exposes metrics when a collector is wired", async () => {
  const res = await call(
    { method: "GET", path: "/status" },
    { metrics: { snapshot: () => ({ calls: 3, checked: 2, failed: 1 }) } }
  );
  assert.deepEqual(res.body.metrics, { calls: 3, checked: 2, failed: 1 });
});

test("GET /status reports null metrics rather than failing without a collector", async () => {
  const res = await call({ method: "GET", path: "/status" });
  assert.equal(res.status, 200);
  assert.equal(res.body.metrics, null);
});

test("POST /exec hands the metrics collector to the executor", async () => {
  let seen = null;
  const metrics = { record() {}, snapshot: () => ({}) };
  await call(
    { method: "POST", path: "/exec", body: REQ },
    {
      metrics,
      executeLeanCheck: async (_req, options) => {
        seen = options.metrics;
        return { contractVersion: "lean_result_v1", status: "checked", isError: false, certified: false };
      }
    }
  );
  assert.equal(seen, metrics);
});
