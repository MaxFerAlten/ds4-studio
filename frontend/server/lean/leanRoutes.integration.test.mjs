// Integration test: production router wired to the REAL executor.
//
// Unlike leanRoutes.test.mjs (which stubs executeLeanCheck entirely) and
// leanExecutor.test.mjs (which calls the executor directly), this test drives
// the whole production path: real Express router -> real executeLeanCheck ->
// real createLeanRunDirectory on a real temp runs root. Only the process
// runner and the sandbox resolver are faked, because this test must not
// require Bubblewrap or an installed Lean toolchain.
//
// The core regression it guards: a POST /api/lean/exec WITHOUT a runId must
// produce an id the executor's sanitizer accepts, create a valid run
// directory, and return a domain result (checked/failed) — never
// LEAN_RUN_ID_INVALID.
import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { createLeanRouter } from "./leanRoutes.mjs";
import { executeLeanCheck } from "./leanExecutor.mjs";
import { sanitizeLeanRunId, RUN_ID_RE } from "./leanPaths.mjs";
import { LeanRunRegistry } from "./leanRunRegistry.mjs";
import { createLeanAuditStore } from "./leanAuditStore.mjs";

const RUNS_ROOT = await mkdtemp(resolve(tmpdir(), "ds4-lean-route-int-"));
const AUDIT_ROOT = await mkdtemp(resolve(tmpdir(), "ds4-lean-audit-int-"));
const auditStore = createLeanAuditStore({ auditRoot: AUDIT_ROOT });

const CONFIG = {
  enabled: true,
  sandboxRequired: true,
  bwrapBin: "/usr/bin/bwrap",
  prlimitBin: "/usr/bin/prlimit",
  runtimeRoot: "/nonexistent/lean-runtime",
  runsRoot: RUNS_ROOT,
  elanRoot: "/nonexistent/.elan",
  defaultProfile: "core",
  defaultTimeoutSec: 30,
  maxTimeoutSec: 120,
  maxStdoutBytes: 64 * 1024,
  maxStderrBytes: 128 * 1024,
  maxDiagnostics: 200,
  memoryBytes: 4294967296,
  addressSpaceBytes: 17179869184,
  leanThreads: 4,
  cpuSeconds: 30,
  maxProcesses: 512,
  maxOpenFiles: 128,
  retentionHours: 24,
};

const PREFLIGHT = {
  ok: true,
  sandboxAvailable: true,
  profiles: { core: { ok: true, toolchain: "leanprover/lean4:v4.32.2" } },
  errors: [],
};

const FAKE_SANDBOX = async () => ({
  ok: true,
  toolchain: { dir: "/toolchains/lean", descriptor: "leanprover/lean4:v4.32.2" },
});

const FAKE_RUNNER = async (spec) => ({
  exitCode: 0,
  signal: null,
  timedOut: false,
  cancelled: false,
  durationMs: 9,
  stdout: "",
  stderr: "",
  stdoutTruncated: false,
  stderrTruncated: false,
  pid: 4321,
  spec,
});

const REQ = {
  contractVersion: "lean_check_request_v1",
  code: "theorem t : 1 + 1 = 2 := by decide",
  sessionId: "session-int-1",
};

async function call(request, runnerResult = {}) {
  const runRegistry = new LeanRunRegistry({ maxGlobalRuns: 2, maxRunsPerSession: 1 });
  const app = express();
  app.use(express.json());
  app.use(
    "/api/lean",
    createLeanRouter({
      express,
      config: CONFIG,
      executeLeanCheck: (req, options) =>
        executeLeanCheck(req, {
          ...options,
          processRunner: async (spec) => ({ ...(await FAKE_RUNNER(spec)), ...runnerResult }),
          resolveSandbox: FAKE_SANDBOX,
        }),
      getPreflight: async () => PREFLIGHT,
      getLeanPolicyState: async () => ({ loaded: true, revision: "a".repeat(40) }),
      runRegistry,
      auditStore,
      metrics: { record() {}, snapshot: () => ({}) },
      logger: { info() {}, warn() {}, error() {} },
    })
  );

  const server = createServer(app);
  await new Promise((r) => server.listen(0, r));
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/lean${request.path}`, {
      method: request.method,
      headers: { "Content-Type": "application/json" },
      body: request.body === undefined ? undefined : JSON.stringify(request.body),
    });
    const text = await res.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
    return { status: res.status, body, runRegistry };
  } finally {
    server.close();
  }
}

test.after(async () => {
  await rm(RUNS_ROOT, { recursive: true, force: true });
  await rm(AUDIT_ROOT, { recursive: true, force: true });
});

test("POST /exec without runId crosses the real executor and real filesystem", async () => {
  const { status, body, runRegistry } = await call({ method: "POST", path: "/exec", body: REQ });

  assert.equal(status, 200);
  assert.equal(body.status, "checked");
  assert.equal(body.isError, false);

  // The route-settled runId must satisfy the production sanitizer.
  assert.match(body.runId, RUN_ID_RE);
  assert.equal(sanitizeLeanRunId(body.runId), body.runId, "route-generated runId must be sanitizer-acceptable");
  assert.notEqual(body.runId, "lean-", "a real id must be produced");

  // The executor ran through createLeanRunDirectory: real dir, real artifacts.
  const runDir = resolve(RUNS_ROOT, REQ.sessionId, body.runId);
  assert.ok(existsSync(runDir), `run directory must exist: ${runDir}`);
  assert.ok(existsSync(resolve(runDir, "Main.lean")), "source artifact missing");
  assert.ok(existsSync(resolve(runDir, "request.json")), "request metadata missing");
  assert.ok(existsSync(resolve(runDir, "result.json")), "result artifact missing");

  const persisted = JSON.parse(await readFile(resolve(runDir, "result.json"), "utf8"));
  assert.equal(persisted.runId, body.runId);
  assert.equal(persisted.certified, false);

  assert.equal(body.sourceArtifact.relativePath, `${REQ.sessionId}/${body.runId}/Main.lean`);
  assert.ok(runRegistry.size >= 1, "the run must be registered");
});

test("POST /exec without runId on a syntax error returns a domain failure, not an id rejection", async () => {
  const { status, body } = await call(
    {
      method: "POST",
      path: "/exec",
      body: { ...REQ, code: "theorem broken : True := by\n  unfixable tactic" },
    },
    { exitCode: 1, stdout: "/work/Main.lean:1:17: error: unsolved goals\n" }
  );

  assert.equal(status, 200, "a Lean failure is a domain result, HTTP 200");
  assert.equal(body.isError, true);
  assert.match(body.runId, RUN_ID_RE);
  assert.notEqual(body.errorCode, "LEAN_RUN_ID_INVALID", "runId must never be the failure reason");
  assert.notEqual(body.errorCode, "LEAN_INTERNAL_ERROR");
});

test("the generated runId is unique across submissions", async () => {
  const first = await call({ method: "POST", path: "/exec", body: { ...REQ, sessionId: "session-unique" } });
  const second = await call({ method: "POST", path: "/exec", body: { ...REQ, sessionId: "session-unique" } });
  assert.notEqual(first.body.runId, second.body.runId);
  assert.match(first.body.runId, RUN_ID_RE);
  assert.match(second.body.runId, RUN_ID_RE);
});

test("POST /inspect leaves an audit trail readable via /history/:sessionId (D11.1)", async () => {
  const inspectRes = await call({
    method: "POST",
    path: "/inspect",
    body: { symbols: ["Nat.add"], sessionId: "inspect-audit-test" },
  });
  // Real leanInspect.mjs is not injectable through the router (R1.2); against
  // this test's fake runtimeRoot it resolves to a sandbox-unavailable
  // rejection — deterministic, no bwrap/Lean toolchain required, and still a
  // call that must be audited.
  assert.equal(inspectRes.body.errorCode, "LEAN_INSPECT_SANDBOX_UNAVAILABLE");

  const historyRes = await call({ method: "GET", path: "/history/inspect-audit-test" });
  assert.equal(historyRes.status, 200);
  assert.equal(historyRes.body.count, 1);
  assert.deepEqual(historyRes.body.entries[0].request.symbols, ["Nat.add"]);
  assert.equal(historyRes.body.entries[0].response.errorCode, "LEAN_INSPECT_SANDBOX_UNAVAILABLE");
});

test("POST /exec leaves an audit trail carrying the D11.2 minimum fields", async () => {
  const { body: execBody } = await call({
    method: "POST",
    path: "/exec",
    // A proof task: only a proof can be verified, so only a proof exercises
    // the full set of audit fields.
    body: {
      ...REQ,
      sessionId: "check-audit-test",
      taskMode: "proof",
      targetDeclaration: "t",
    },
  });
  assert.equal(execBody.status, "checked");

  const { status, body } = await call({ method: "GET", path: "/history/check-audit-test" });
  assert.equal(status, 200);
  assert.equal(body.count, 1);

  const { request, response } = body.entries[0];
  // D11.2 minimum: proofId, runId, attempt, profile, sourceSha256, status,
  // failureClass, retryable, terminal, verified, attemptConsumed — each must
  // be reachable from the persisted entry, not merely implied.
  assert.ok(request.proofId, "proofId");
  assert.equal(response.runId, execBody.runId);
  assert.equal(request.attempt, 1);
  assert.equal(response.profile, "core");
  assert.equal(response.sourceArtifact.sha256.length, 64);
  assert.equal(response.status, "checked");
  assert.equal(response.orchestrationFailureClass, "");
  assert.equal(response.orchestrationRetryable, false);
  assert.equal(response.orchestrationTerminal, true);
  assert.equal(response.orchestrationVerified, true);
  assert.equal(response.attemptConsumed, true);
});
