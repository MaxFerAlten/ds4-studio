// R11 — production end-to-end: real server process, real HTTP route, real
// registry, real executor, real Bubblewrap, real Lean.
//
// Everything below crosses the same path a model does. Nothing is mocked; when
// the host is not provisioned the affected tests skip with the preflight's own
// reason, and the certification script (R12) refuses to certify a run with
// skips.
import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { promisify } from "node:util";

import { startLeanServer } from "./fixtures/leanServerHarness.mjs";
import { RUN_ID_RE } from "./leanPaths.mjs";
import { requireReady } from "./fixtures/realTestGate.mjs";

const execFileAsync = promisify(execFile);

const server = await startLeanServer();
const status = await (await fetch(`${server.baseUrl}/api/lean/status`)).json();

test.after(async () => {
  await server.stop();
});

/** Skip marker mirroring the server's own preflight verdict — a hard failure
 *  instead of a skip when DS4_TEST_REAL_LEAN=1 (§6.18). */
function only(profile) {
  const p = status.preflight?.profiles?.[profile];
  return requireReady(p && { ok: p.ok, reason: `profile ${profile} is not prepared on this host` }, {
    flag: "DS4_TEST_REAL_LEAN",
    label: `profile ${profile}`,
  });
}
const CORE = only("core");
const MATHLIB = only("mathlib");

let sessionCounter = 0;
function nextSession(tag) {
  sessionCounter += 1;
  return `e2e-${tag}-${sessionCounter}`;
}

async function exec(body) {
  const res = await fetch(`${server.baseUrl}/api/lean/exec`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ contractVersion: "lean_check_request_v1", ...body }),
  });
  return { httpStatus: res.status, result: await res.json() };
}

/** No sandbox, Lean or Lake process may outlive a run. */
async function assertNoResidualProcess(runId) {
  // The bwrap/lean command line carries the run directory, so the run id is a
  // precise probe: pgrep exits 1 when nothing matches, which is the pass case.
  for (let i = 0; i < 20; i++) {
    try {
      const { stdout } = await execFileAsync("pgrep", ["-af", runId]);
      if (i === 19) assert.fail(`processes still alive for ${runId}:\n${stdout}`);
    } catch (err) {
      if (err.code === 1) return; // no match
      throw err;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
}

const SLOW_SOURCE =
  "def loop : Nat → Nat\n  | 0 => 0\n  | n + 1 => loop n\n#eval loop 100000000000\n";

// E2E-01 ---------------------------------------------------------------------
test("E2E-01 route: a valid core theorem checks with a route-generated run id", CORE, async () => {
  const sessionId = nextSession("ok");
  const { httpStatus, result } = await exec({
    code: "theorem e2e_one : 1 + 1 = 2 := by decide",
    sessionId,
  });

  assert.equal(httpStatus, 200, JSON.stringify(result));
  assert.equal(result.status, "checked", result.summary);
  assert.equal(result.isError, false);
  assert.equal(result.certified, false);
  // The id the route invented must be the one the executor accepted — this is
  // the pairing the hex-nonce bug broke in ~98% of runs.
  assert.match(result.runId, RUN_ID_RE);
  assert.deepEqual(result.declarationsObserved, ["e2e_one"]);

  const runDir = resolve(server.runsRoot, sessionId, result.runId);
  assert.ok((await stat(resolve(runDir, "Main.lean"))).isFile());
  const persisted = JSON.parse(await readFile(resolve(runDir, "result.json"), "utf8"));
  assert.equal(persisted.runId, result.runId);
});

// E2E-02 ---------------------------------------------------------------------
test("E2E-02 route: a syntax error is a failed check with diagnostics", CORE, async () => {
  const { httpStatus, result } = await exec({
    code: "theorem broken : 1 + 1 = 2 := by\n  this_tactic_does_not_exist\n",
    sessionId: nextSession("bad"),
  });

  assert.equal(httpStatus, 200, JSON.stringify(result));
  assert.equal(result.status, "failed");
  assert.equal(result.isError, true);
  assert.ok(result.diagnostics.length > 0, `no diagnostics parsed from:\n${result.stdout}${result.stderr}`);
  assert.equal(result.diagnostics[0].file, "Main.lean");
  assert.ok(Number.isInteger(result.diagnostics[0].line));
  assert.notEqual(result.summary, "");
});

// E2E-03 ---------------------------------------------------------------------
test("E2E-03 route: a Unicode theorem reaches Main.lean byte-identical", CORE, async () => {
  const sessionId = nextSession("utf8");
  const code = "theorem add_zero_unicode : ∀ n : Nat, n + 0 = n := by\n  intro n\n  exact Nat.add_zero n\n";
  const { result } = await exec({ code, sessionId });

  assert.equal(result.status, "checked", result.summary + result.stdout + result.stderr);

  const expected = createHash("sha256").update(code, "utf8").digest("hex");
  assert.equal(result.sourceArtifact.sha256, expected);

  const onDisk = await readFile(resolve(server.runsRoot, sessionId, result.runId, "Main.lean"));
  assert.equal(createHash("sha256").update(onDisk).digest("hex"), expected, "the source was mutated on the way in");
  assert.ok(onDisk.toString("utf8").includes("∀"));
});

// E2E-04 ---------------------------------------------------------------------
test("E2E-04 route: a timeout is reported and leaves no process behind", CORE, async () => {
  const { result } = await exec({
    code: SLOW_SOURCE,
    timeoutSec: 3,
    sessionId: nextSession("timeout"),
  });

  assert.equal(result.status, "timeout", result.summary);
  assert.equal(result.timedOut, true);
  assert.equal(result.summary, "Lean elaboration exceeded 3s.");
  await assertNoResidualProcess(result.runId);
});

// E2E-05 ---------------------------------------------------------------------
test("E2E-05 route: a cancelled run stops and leaves no process behind", CORE, async () => {
  const sessionId = nextSession("cancel");
  const runId = `lean-${"ab".repeat(6)}-${Date.now()}-1`;

  const pending = exec({ code: SLOW_SOURCE, timeoutSec: 60, sessionId, runId });

  // Wait for the run to actually be in flight before cancelling it.
  let cancelled = null;
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 250));
    const res = await fetch(
      `${server.baseUrl}/api/lean/sessions/${sessionId}/runs/${runId}/cancel`,
      { method: "POST" }
    );
    if (res.status === 200) {
      cancelled = await res.json();
      break;
    }
  }
  assert.ok(cancelled, "the run never appeared in the registry");
  assert.equal(cancelled.cancelled, true);

  const { result } = await pending;
  assert.equal(result.status, "cancelled", result.summary);
  assert.equal(result.summary, "Lean elaboration was cancelled.");
  await assertNoResidualProcess(runId);
});

// E2E-06 ---------------------------------------------------------------------
test("E2E-06 route: a targeted Mathlib import checks under the mathlib profile", MATHLIB, async () => {
  const { result } = await exec({
    code: "import Mathlib.Data.Nat.Prime.Basic\n\ntheorem e2e_prime_two : Nat.Prime 2 := Nat.prime_two\n",
    profile: "mathlib",
    timeoutSec: 120,
    sessionId: nextSession("mathlib"),
  });
  assert.equal(result.status, "checked", result.summary + result.stdout + result.stderr);
  assert.equal(result.profile, "mathlib");
});

// Contract-level guards on the same live route -------------------------------
test("route: an invalid request is rejected before it can reserve a run", async () => {
  const { httpStatus, result } = await exec({ code: "theorem t : True := trivial", timeoutSec: 3600 });
  assert.equal(httpStatus, 400);
  assert.equal(result.errorCode, "LEAN_TIMEOUT_INVALID");

  const { httpStatus: badId } = await exec({
    code: "theorem t : True := trivial",
    runId: "lean-deadbeefcafe-1-deadbeef", // the old hex-nonce shape
    sessionId: nextSession("badid"),
  });
  assert.equal(badId, 422);
});

test("route: a run is scoped to its session", CORE, async () => {
  const sessionId = nextSession("owner");
  const { result } = await exec({ code: "theorem owned : True := trivial", sessionId });

  const mine = await fetch(`${server.baseUrl}/api/lean/sessions/${sessionId}/runs/${result.runId}`);
  assert.equal(mine.status, 200);

  const theirs = await fetch(`${server.baseUrl}/api/lean/sessions/someone-else/runs/${result.runId}`);
  assert.equal(theirs.status, 404, "another session must not read this run");
});

// E2E-13 ---------------------------------------------------------------------
test("E2E-13 feature off: the route answers 503 and nothing is spawned", async () => {
  const off = await startLeanServer({ leanEnabled: false });
  try {
    const st = await (await fetch(`${off.baseUrl}/api/lean/status`)).json();
    assert.equal(st.enabled, false);
    assert.equal(st.effective.enabled, false);

    const res = await fetch(`${off.baseUrl}/api/lean/exec`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contractVersion: "lean_check_request_v1",
        code: "theorem t : True := trivial",
        sessionId: "e2e-off",
      }),
    });
    assert.equal(res.status, 503);
    const body = await res.json();
    assert.equal(body.errorCode, "LEAN_DISABLED");

    // The skill file is still on disk — and that alone must not enable
    // anything. Policy availability is not a capability (R13 rollback).
    assert.equal(st.policyLoaded, true, "the skill file is expected to be readable");
    assert.equal(st.preflight, null, "a disabled feature must not even preflight");

    // Nothing may reference the disabled server's runs root: no sandbox, no
    // Lean, no run directory.
    await assertNoResidualProcess(off.runsRoot);

    // The rest of the product keeps working with Lean rolled back.
    const sage = await fetch(`${off.baseUrl}/api/sage/status`);
    assert.equal(sage.ok, true, "rolling Lean back must not take Sage down");
  } finally {
    await off.stop();
  }
});

// E2E-15 ---------------------------------------------------------------------
test("E2E-15 restart: artifacts survive, the in-memory registry does not", CORE, async () => {
  const sessionId = nextSession("restart");
  const { result } = await exec({ code: "theorem survives : True := trivial", sessionId });
  assert.equal(result.status, "checked");

  const restarted = await startLeanServer({ env: { DS4_LEAN_RUNS_ROOT: server.runsRoot } });
  try {
    // Documented behaviour: the registry is in-memory, so a completed run is
    // no longer addressable after a restart...
    const res = await fetch(
      `${restarted.baseUrl}/api/lean/sessions/${sessionId}/runs/${result.runId}`
    );
    assert.equal(res.status, 404);

    // ...while the artifacts an operator needs are still on disk.
    const persisted = JSON.parse(
      await readFile(resolve(server.runsRoot, sessionId, result.runId, "result.json"), "utf8")
    );
    assert.equal(persisted.status, "checked");
  } finally {
    await restarted.stop();
  }
});
