// Tests for leanExecutor.mjs
//
// Hermetic: the sandbox resolution and the process runner are injected, so
// these run without bubblewrap or an installed Lean toolchain. The real thing
// is covered by leanSandbox.test.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { executeLeanCheck, leanTelemetryFailureCount } from "./leanExecutor.mjs";

const RUNS_ROOT = resolve(tmpdir(), `ds4-lean-exec-${process.pid}`);

const CONFIG = {
  enabled: true,
  sandboxRequired: false,
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
  retentionHours: 24
};

const PREFLIGHT = {
  ok: true,
  profiles: {
    core: { ok: true, toolchain: "leanprover/lean4:v4.32.2" },
    mathlib: { ok: true, toolchain: "leanprover/lean4:v4.32.2" }
  }
};

const SANDBOX_OK = async () => ({
  ok: true,
  toolchain: { dir: "/toolchains/lean", descriptor: "leanprover/lean4:v4.32.2" }
});

/** A process runner that returns a canned result and records its input. */
function runner(result, sink) {
  return async (spec) => {
    if (sink) sink.spec = spec;
    return {
      exitCode: 0,
      signal: null,
      timedOut: false,
      cancelled: false,
      durationMs: 12,
      stdout: "",
      stderr: "",
      stdoutTruncated: false,
      stderrTruncated: false,
      pid: 1234,
      ...result
    };
  };
}

function request(overrides = {}) {
  return {
    contractVersion: "lean_check_request_v1",
    code: "theorem t : 1 + 1 = 2 := by decide",
    sessionId: "session-abc",
    ...overrides
  };
}

function run(req, options = {}) {
  return executeLeanCheck(req, {
    config: CONFIG,
    preflight: PREFLIGHT,
    resolveSandbox: SANDBOX_OK,
    processRunner: runner({}),
    ...options
  });
}

test.after(async () => {
  await rm(RUNS_ROOT, { recursive: true, force: true });
});

test("a successful elaboration is checked but never certified", async () => {
  const result = await run(request());
  assert.equal(result.status, "checked");
  assert.equal(result.isError, false);
  assert.equal(result.certified, false);
  assert.equal(result.contractVersion, "lean_result_v1");
  assert.equal(result.toolchain, "leanprover/lean4:v4.32.2");
  assert.match(result.runId, /^lean-/);
});

test("a non-zero exit is a failed check with diagnostics", async () => {
  const result = await run(request(), {
    processRunner: runner({
      exitCode: 1,
      stdout: "/work/Main.lean:3:17: error: type mismatch\n"
    })
  });
  assert.equal(result.status, "failed");
  assert.equal(result.isError, true);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].line, 3);
  assert.equal(result.diagnostics[0].column, 17);
  assert.equal(result.certified, false);
});

test("a timeout is reported as timeout, not failure", async () => {
  const result = await run(request(), {
    processRunner: runner({ exitCode: null, timedOut: true, signal: "SIGKILL" })
  });
  assert.equal(result.status, "timeout");
  assert.equal(result.isError, true);
});

test("a cancellation is reported as cancelled", async () => {
  const result = await run(request(), {
    processRunner: runner({ exitCode: null, cancelled: true })
  });
  assert.equal(result.status, "cancelled");
  assert.equal(result.isError, true);
});

test("output truncation is reported in the result", async () => {
  const result = await run(request(), {
    processRunner: runner({ stdoutTruncated: true, stderrTruncated: true })
  });
  assert.equal(result.truncated.stdout, true);
  assert.equal(result.truncated.stderr, true);
});

test("the run id and session id settle once and reach the result", async () => {
  const result = await run(request({ runId: "lean-aaaaaaaaaaaa-1-9", sessionId: "sess-1" }));
  assert.equal(result.runId, "lean-aaaaaaaaaaaa-1-9");
  assert.equal(result.sessionId, "sess-1");
  assert.equal(result.sourceArtifact.relativePath, "sess-1/lean-aaaaaaaaaaaa-1-9/Main.lean");
});

test("request.json, Main.lean and result.json are written with the right sha", async () => {
  const code = "theorem written : True := trivial";
  const result = await run(request({ code, runId: "lean-bbbbbbbbbbbb-1-1", sessionId: "sess-files" }));

  const runDir = resolve(RUNS_ROOT, "sess-files", "lean-bbbbbbbbbbbb-1-1");
  assert.ok(existsSync(resolve(runDir, "Main.lean")));
  assert.ok(existsSync(resolve(runDir, "request.json")));
  assert.ok(existsSync(resolve(runDir, "result.json")));

  const persistedRequest = JSON.parse(await readFile(resolve(runDir, "request.json"), "utf8"));
  assert.equal(persistedRequest.runId, "lean-bbbbbbbbbbbb-1-1");
  assert.equal(persistedRequest.sessionId, "sess-files");
  assert.equal(persistedRequest.sourceBytes, Buffer.byteLength(code, "utf8"));
  // The source lives in Main.lean; request.json must not duplicate it.
  assert.equal(persistedRequest.code, undefined);

  const written = await readFile(resolve(runDir, "Main.lean"), "utf8");
  assert.equal(written, code);
  assert.equal(result.sourceArtifact.sha256, createHash("sha256").update(code).digest("hex"));
  assert.equal(result.sourceArtifact.bytes, Buffer.byteLength(code, "utf8"));

  const persisted = JSON.parse(await readFile(resolve(runDir, "result.json"), "utf8"));
  assert.equal(persisted.runId, "lean-bbbbbbbbbbbb-1-1");
  assert.equal(persisted.certified, false);
});

test("reusing a run directory fails instead of overwriting the source", async () => {
  const first = await run(request({ runId: "lean-cccccccccccc-1-1", sessionId: "sess-collide" }));
  assert.equal(first.status, "checked");

  const second = await run(
    request({ runId: "lean-cccccccccccc-1-1", sessionId: "sess-collide", code: "theorem other : True := trivial" })
  );
  assert.equal(second.isError, true);
  assert.notEqual(second.status, "checked");
});

test("the source is passed by its in-sandbox path, never a host path", async () => {
  const sink = {};
  await run(request(), { processRunner: runner({}, sink) });

  // The run directory legitimately appears as the source of the /work bind
  // mount; what must not leak is a host path in the Lean command itself.
  const leanCommand = sink.spec.args.slice(sink.spec.args.lastIndexOf("--") + 1);
  assert.ok(leanCommand.includes("/work/Main.lean"));
  assert.ok(
    !leanCommand.some((a) => a.includes(RUNS_ROOT)),
    `host path leaked into the Lean command: ${leanCommand.join(" ")}`
  );
});

test("the requested timeout reaches the process runner", async () => {
  const sink = {};
  await run(request({ timeoutSec: 7 }), { processRunner: runner({}, sink) });
  assert.equal(sink.spec.timeoutMs, 7000);
});

test("a missing contract version is rejected before anything is written", async () => {
  const result = await run({ code: "theorem t : True := trivial" });
  assert.equal(result.isError, true);
  assert.equal(result.status, "rejected");
  assert.match(result.summary, /LEAN_REQUEST_CONTRACT_UNSUPPORTED/);
});

test("empty code is rejected", async () => {
  const result = await run(request({ code: "   " }));
  assert.equal(result.isError, true);
  assert.match(result.summary, /LEAN_CODE_REQUIRED/);
});

test("oversized source is rejected without spawning anything", async () => {
  let spawned = false;
  const result = await run(request({ code: "-- x\n".repeat(200000) }), {
    processRunner: async () => {
      spawned = true;
      return {};
    }
  });
  assert.equal(spawned, false);
  assert.match(result.summary, /LEAN_SOURCE_TOO_LARGE/);
});

test("an unprepared profile fails closed with preflight_failed", async () => {
  const result = await run(request({ profile: "mathlib" }), {
    preflight: { ok: false, profiles: { core: { ok: true }, mathlib: { ok: false } } }
  });
  assert.equal(result.status, "preflight_failed");
  assert.equal(result.isError, true);
  assert.match(result.summary, /LEAN_RUNTIME_UNAVAILABLE/);
});

test("an unavailable sandbox fails closed and never runs Lean", async () => {
  let spawned = false;
  const result = await run(request(), {
    resolveSandbox: async () => ({
      ok: false,
      error: "LEAN_SANDBOX_UNAVAILABLE",
      reason: "/usr/bin/bwrap is not executable"
    }),
    processRunner: async () => {
      spawned = true;
      return {};
    }
  });
  assert.equal(spawned, false);
  assert.equal(result.status, "preflight_failed");
  assert.match(result.summary, /LEAN_SANDBOX_UNAVAILABLE/);
});

test("placeholder evidence is blocked before reaching Lean (FASE R003-08)", async () => {
  const result = await run(request({ code: "theorem t : False := by\n  sorry\n" }));
  assert.equal(result.isError, true);
  assert.equal(result.errorCode, "LEAN_CANDIDATE_PREFLIGHT_BLOCKED");
  assert.ok(result.summary.includes("sorry"));
  assert.equal(result.certified, false);
});

test("the word sorry inside a comment is not placeholder evidence", async () => {
  const result = await run(request({ code: "-- sorry, this is a comment\ntheorem t : True := trivial\n" }));
  assert.equal(result.containsPlaceholders, false);
});

test("every run emits exactly one accounted event, successes and failures alike", async () => {
  const events = [];
  const metrics = { record: (e) => events.push(e) };

  await run(request(), { metrics });
  assert.equal(events.length, 1);
  assert.equal(events[0].type, "lean_check");
  assert.equal(events[0].status, "checked");

  // A rejection never reaches the sandbox but must still be counted.
  await run({ code: "theorem t : True := trivial" }, { metrics });
  assert.equal(events.length, 2);
  assert.equal(events[1].status, "rejected");

  await run(request({ profile: "mathlib" }), {
    metrics,
    preflight: { ok: false, profiles: { core: { ok: true }, mathlib: { ok: false } } }
  });
  assert.equal(events.length, 3);
  assert.equal(events[2].status, "preflight_failed");
});

test("a broken metrics sink cannot fail a successful check, but is counted", async () => {
  const before = leanTelemetryFailureCount();
  const result = await run(request(), {
    metrics: { record() { throw new Error("sink exploded"); } },
    logger: { info() { throw new Error("logger exploded"); } }
  });
  assert.equal(result.status, "checked");
  assert.equal(result.isError, false);
  assert.equal(leanTelemetryFailureCount(), before + 1, "a silent sink failure must still be visible somewhere");
});

// ---------------------------------------------------------------------------
// R9 — evidence retention, atomic results, deterministic summaries
// ---------------------------------------------------------------------------

test("an infrastructure failure keeps the run directory with sanitized evidence", async () => {
  const runId = "lean-dddddddddddd-1-1";
  const result = await run(request({ runId, sessionId: "sess-infra" }), {
    processRunner: async () => {
      throw new Error(`spawn ${RUNS_ROOT}/bwrap ENOENT`);
    }
  });
  assert.equal(result.errorCode, "LEAN_PROCESS_SPAWN_FAILED");

  const runDir = resolve(RUNS_ROOT, "sess-infra", runId);
  assert.ok(existsSync(runDir), "spawn evidence must survive for diagnosis");
  assert.ok(existsSync(resolve(runDir, "Main.lean")), "the source that triggered it is part of the evidence");

  const error = JSON.parse(await readFile(resolve(runDir, "error.json"), "utf8"));
  assert.equal(error.category, "infrastructure");
  assert.equal(error.errorCode, "LEAN_PROCESS_SPAWN_FAILED");
  assert.ok(error.detail.includes("ENOENT"), "the host-side detail is kept on disk");
  assert.ok(error.correlationId);
});

test("an unavailable sandbox leaves evidence but never leaks host paths to the model", async () => {
  const runId = "lean-eeeeeeeeeeee-1-1";
  const result = await run(request({ runId, sessionId: "sess-sandbox" }), {
    resolveSandbox: async () => ({
      ok: false,
      error: "LEAN_SANDBOX_UNAVAILABLE",
      reason: `/home/someone/secret/bwrap is not executable (${RUNS_ROOT})`
    })
  });

  assert.equal(result.status, "preflight_failed");
  assert.match(result.summary, /LEAN_SANDBOX_UNAVAILABLE/);
  assert.ok(!result.summary.includes("/home/someone"), `host path leaked in summary: ${result.summary}`);
  assert.ok(!result.summary.includes(RUNS_ROOT));

  const error = JSON.parse(await readFile(resolve(RUNS_ROOT, "sess-sandbox", runId, "error.json"), "utf8"));
  assert.ok(error.detail.includes("/home/someone"), "the operator still gets the real reason on disk");
});

test("an internal error hands the model a correlation id, not an internal message", async () => {
  // A runs root that is a regular file: no run directory can be created under it.
  await mkdir(RUNS_ROOT, { recursive: true });
  const blockedRoot = resolve(RUNS_ROOT, "not-a-directory");
  await writeFile(blockedRoot, "x");

  const result = await run(request({ runId: "lean-ffffffffffff-1-1", sessionId: "sess-int" }), {
    config: { ...CONFIG, runsRoot: blockedRoot }
  });
  assert.equal(result.status, "internal_error");
  assert.match(result.summary, /LEAN_INTERNAL_ERROR/);
  assert.match(result.summary, /correlation [0-9a-f-]{36}/);
  assert.ok(!result.summary.includes(blockedRoot), `host path leaked in summary: ${result.summary}`);
});

test("result.json is written atomically and no temp file is left behind", async () => {
  const runId = "lean-111111111111-1-1";
  await run(request({ runId, sessionId: "sess-atomic" }));
  const runDir = resolve(RUNS_ROOT, "sess-atomic", runId);
  assert.ok(existsSync(resolve(runDir, "result.json")));
  assert.equal(existsSync(resolve(runDir, "result.json.tmp")), false);
});

test("fsyncArtifacts persists the request and source before the spawn", async () => {
  const runId = "lean-222222222222-1-1";
  const sink = {};
  const result = await run(request({ runId, sessionId: "sess-fsync", code: "theorem f : True := trivial" }), {
    config: { ...CONFIG, fsyncArtifacts: true },
    processRunner: runner({}, sink)
  });
  assert.equal(result.status, "checked");
  const runDir = resolve(RUNS_ROOT, "sess-fsync", runId);
  assert.equal(await readFile(resolve(runDir, "Main.lean"), "utf8"), "theorem f : True := trivial");
  assert.ok(sink.spec, "the sandbox still ran");
});

test("timeout and cancellation carry a deterministic summary", async () => {
  const timedOut = await run(request({ timeoutSec: 7 }), {
    processRunner: runner({ exitCode: null, timedOut: true, signal: "SIGKILL" })
  });
  assert.equal(timedOut.summary, "Lean elaboration exceeded 7s.");

  const cancelled = await run(request(), {
    processRunner: runner({ exitCode: null, cancelled: true })
  });
  assert.equal(cancelled.summary, "Lean elaboration was cancelled.");

  const failed = await run(request(), { processRunner: runner({ exitCode: 2 }) });
  assert.notEqual(failed.summary, "");
  assert.match(failed.summary, /exit 2/);
});

test("declarationsObserved reports what the source declares", async () => {
  const result = await run(
    request({ code: "theorem alpha : True := trivial\ndef beta : Nat := 0\n" })
  );
  assert.deepEqual(result.declarationsObserved, ["alpha", "beta"]);
});

test("a missing expected declaration fails the check instead of passing it", async () => {
  const result = await run(
    request({
      code: "theorem alpha : True := trivial",
      expectedDeclarations: ["alpha", "gamma"]
    })
  );
  assert.equal(result.status, "failed");
  assert.equal(result.isError, true);
  assert.equal(result.errorCode, "LEAN_DECLARATION_MISSING");
  assert.match(result.summary, /gamma/);

  const ok = await run(
    request({ code: "theorem alpha : True := trivial", expectedDeclarations: ["alpha"] })
  );
  assert.equal(ok.status, "checked");
});

test("diagnostics truncation is reported only when diagnostics were dropped", async () => {
  const header = (n) => `/work/Main.lean:${n}:0: error: e${n}\n`;
  const atCap = await run(request(), {
    config: { ...CONFIG, maxDiagnostics: 2 },
    processRunner: runner({ exitCode: 1, stdout: header(1) + header(2) })
  });
  assert.equal(atCap.diagnostics.length, 2);
  assert.equal(atCap.truncated.diagnostics, false);

  const over = await run(request(), {
    config: { ...CONFIG, maxDiagnostics: 2 },
    processRunner: runner({ exitCode: 1, stdout: header(1) + header(2) + header(3) })
  });
  assert.equal(over.truncated.diagnostics, true);
});

// ---------------------------------------------------------------------------
// Policy identity in the result (fix-revision-lean §19)
// ---------------------------------------------------------------------------

test("a checked run whose prompt revision drifted is still verified", async () => {
  const result = await run(
    request({
      promptRevision: "a".repeat(40),
      contractRevision: "b".repeat(64),
      taskMode: "proof",
      targetDeclaration: "t",
      expectedTargetStatementSha256: "fc566816ebd7145978dfbeada7a60e9e3c6d5c626a4f93f236fdfcad10f74368"
    }),
    {
      policyContext: {
        serverPromptRevision: "f".repeat(40),
        contractRevision: "b".repeat(64),
        legacyClient: false
      }
    }
  );

  assert.equal(result.status, "checked");
  assert.equal(result.promptRevision, "a".repeat(40), "the session's revision, echoed back");
  assert.equal(result.serverPromptRevision, "f".repeat(40));
  assert.equal(result.contractRevision, "b".repeat(64));
  assert.equal(result.promptDriftDetected, true);
  assert.equal(result.promptDriftBlocking, false);
  assert.equal(result.promptDrift.action, "refresh-policy-when-convenient");
  // The whole point: newer editorial text on the server does not withdraw a
  // proof that Lean actually accepted.
  assert.equal(result.orchestration.verified, true);
  assert.equal(result.orchestration.failureClass, null);
});

test("a rejection carries the policy context too", async () => {
  const result = await run(request({ code: "" }), {
    policyContext: {
      serverPromptRevision: "f".repeat(40),
      contractRevision: "b".repeat(64),
      legacyClient: true
    }
  });

  assert.equal(result.isError, true);
  assert.equal(result.serverPromptRevision, "f".repeat(40));
  assert.equal(result.contractRevision, "b".repeat(64));
  assert.equal(result.legacyClient, true);
  assert.equal(result.promptDriftBlocking, false);
});

// --- WP02: attemptConsumed contract ---

test("AC-01: placeholder preflight does not consume attempt", async () => {
  const result = await run(request({ code: "theorem t : False := by\n  sorry\n" }));
  assert.equal(result.errorCode, "LEAN_CANDIDATE_PREFLIGHT_BLOCKED");
  assert.equal(result.attemptConsumed, false);
});

test("AC-02: checked result consumes attempt", async () => {
  const result = await run(request());
  assert.equal(result.status, "checked");
  assert.equal(result.attemptConsumed, true);
});

test("AC-03: timeout consumes attempt", async () => {
  const result = await run(request({ code: "theorem t : True := trivial", timeoutSec: 1 }), {
    processRunner: async () => ({
      exitCode: null,
      signal: "SIGTERM",
      timedOut: true,
      cancelled: false,
      stdout: "",
      stderr: "",
      durationMs: 1000,
    }),
  });
  assert.equal(result.status, "timeout");
  assert.equal(result.attemptConsumed, true);
});

test("AC-04: sandbox failure does not consume attempt", async () => {
  const result = await run(request(), {
    preflight: { ok: false, profiles: { core: { ok: false } } },
  });
  assert.equal(result.status, "preflight_failed");
  assert.equal(result.attemptConsumed, false);
});

test("AC-05: spawn failure does not consume attempt", async () => {
  const result = await run(request(), {
    processRunner: async () => { throw new Error("ENOENT"); },
  });
  assert.equal(result.errorCode, "LEAN_PROCESS_SPAWN_FAILED");
  assert.equal(result.attemptConsumed, false);
});

// --- WP-03 §6.8 — proof target identity -------------------------------------

const CAUCHY_SRC = [
  "theorem cauchy_mean_value (P : Prop) : P → P := by",
  "  intro h",
  "  exact h",
].join("\n");

function proofRequest(overrides = {}) {
  return request({
    code: CAUCHY_SRC,
    taskMode: "proof",
    targetDeclaration: "cauchy_mean_value",
    ...overrides,
  });
}

/** A runner that fails the test if the sandbox is ever spawned. */
function neverRuns(t) {
  return async () => {
    t.diagnostic("process runner was invoked");
    throw new Error("the process runner must not be reached");
  };
}

test("EXEC-TARGET-01: a proof whose target is present is checked with its statement hash", async () => {
  const result = await run(proofRequest());
  assert.equal(result.status, "checked");
  assert.equal(result.taskMode, "proof");
  assert.equal(result.targetDeclaration, "cauchy_mean_value");
  assert.equal(result.targetIdentityAlgorithm, "lean-target-statement-v1");
  assert.match(result.targetStatementSha256, /^[a-f0-9]{64}$/);
  // No expected hash was sent: the first attempt mints the lock, so identity
  // matches by construction. Reporting false here would make a first proof
  // attempt unverifiable forever.
  assert.equal(result.targetIdentityMatched, true);
  assert.equal(result.orchestration.verified, true);
});

test("EXEC-TARGET-02: a proof missing its target is rejected without spawning Lean", async (t) => {
  const result = await run(
    proofRequest({ code: "theorem other : True := trivial" }),
    { processRunner: neverRuns(t) },
  );
  assert.notEqual(result.status, "checked");
  assert.equal(result.attemptConsumed, false);
  assert.equal(result.orchestration.verified, false);
});

test("EXEC-TARGET-03: a statement hash mismatch is refused before the spawn", async (t) => {
  const result = await run(
    proofRequest({ expectedTargetStatementSha256: "f".repeat(64) }),
    { processRunner: neverRuns(t) },
  );
  assert.notEqual(result.status, "checked");
  assert.equal(result.attemptConsumed, false);
  assert.equal(result.errorCode, "LEAN_TARGET_STATEMENT_MISMATCH");
});

test("EXEC-TARGET-04: the same statement with a different proof body keeps the hash", async () => {
  const first = await run(proofRequest());
  const second = await run(
    proofRequest({
      code: [
        "theorem cauchy_mean_value (P : Prop) : P → P := by",
        "  exact fun h => h",
      ].join("\n"),
      expectedTargetStatementSha256: first.targetStatementSha256,
    }),
  );
  assert.equal(second.status, "checked");
  assert.equal(second.targetStatementSha256, first.targetStatementSha256);
  assert.equal(second.targetIdentityMatched, true);
});

test("EXEC-TARGET-05: the same name with a different statement is a mismatch", async (t) => {
  const first = await run(proofRequest());
  const second = await run(
    proofRequest({
      code: "theorem cauchy_mean_value : True := by trivial",
      expectedTargetStatementSha256: first.targetStatementSha256,
    }),
    { processRunner: neverRuns(t) },
  );
  assert.notEqual(second.status, "checked");
  assert.equal(second.errorCode, "LEAN_TARGET_STATEMENT_MISMATCH");
  assert.equal(second.attemptConsumed, false);
});

test("EXEC-TARGET-06: the target is an expected declaration even when not listed", async () => {
  const sink = {};
  const result = await run(proofRequest(), { processRunner: runner({}, sink) });
  assert.equal(result.status, "checked");
  assert.ok(result.expectedDeclarations.includes("cauchy_mean_value"));
});

test("EXEC-TARGET-07: a utility check needs no target and is never verified", async () => {
  const result = await run(request({ taskMode: "utility" }));
  assert.equal(result.status, "checked");
  assert.equal(result.taskMode, "utility");
  assert.equal(result.targetStatementSha256, null);
  assert.equal(result.targetIdentityMatched, null);
  assert.equal(result.orchestration.verified, false);
});

test("EXEC-ECHO-01: the flat sourceSha256 equals the artifact digest", async () => {
  const result = await run(proofRequest());
  assert.match(result.sourceSha256, /^[a-f0-9]{64}$/);
  assert.equal(result.sourceSha256, result.sourceArtifact.sha256);
  assert.equal(
    result.sourceSha256,
    createHash("sha256").update(CAUCHY_SRC).digest("hex"),
  );
});

test("EXEC-PROFILE-01: the result echoes the requested profile", async () => {
  const result = await run(proofRequest({ profile: "mathlib" }));
  assert.equal(result.profile, "mathlib");
});
