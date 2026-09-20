// End-to-end tests: real Lean, real Bubblewrap, real Lake project.
//
// These are the tests that decide whether the feature works at all — the
// fixture-backed suites can only prove the plumbing is consistent with itself.
// Each test skips with a reason when the host is not provisioned, so the file
// is safe to keep in the default `node --test frontend/server/lean/*.test.mjs`
// run; `make lean-preflight` tells you why they skip.
import test from "node:test";
import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { executeLeanCheck } from "./leanExecutor.mjs";
import { loadLeanConfig } from "./leanConfig.mjs";
import { runLeanPreflight } from "./leanPreflight.mjs";
import { requireReady } from "./fixtures/realTestGate.mjs";

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), "..", "..", "..", "..");
const RUNS_ROOT = resolve(tmpdir(), `ds4-lean-real-${process.pid}`);

const CONFIG = loadLeanConfig(process.env, {
  enabled: true,
  runtimeRoot: resolve(REPO_ROOT, "lean-runtime"),
  runsRoot: RUNS_ROOT
});

const PREFLIGHT = await runLeanPreflight(CONFIG);

/** Skips when the host is not provisioned — unless DS4_TEST_REAL_LEAN=1 says
 *  it is, in which case an unready profile is a failure (§6.18). */
function only(profile) {
  return requireReady(PREFLIGHT.profiles?.[profile], {
    flag: "DS4_TEST_REAL_LEAN",
    label: `profile ${profile}`,
  });
}

const CORE = only("core");
const MATHLIB = only("mathlib");

/** The toolchain a profile is pinned to, read from the profile itself. */
function pinnedToolchain(profile) {
  return readFileSync(resolve(CONFIG.runtimeRoot, profile, "lean-toolchain"), "utf8").trim();
}

function check(code, profile = "core", timeoutSec = 120) {
  return executeLeanCheck(
    {
      contractVersion: "lean_check_request_v1",
      code,
      profile,
      timeoutSec,
      sessionId: "real-tests"
    },
    { config: CONFIG, preflight: PREFLIGHT }
  );
}

test.after(async () => {
  await rm(RUNS_ROOT, { recursive: true, force: true });
});

test("core: a true theorem checks", CORE, async () => {
  const r = await check("theorem one_plus_one : 1 + 1 = 2 := by\n  decide\n");
  assert.equal(r.status, "checked", r.summary);
  assert.equal(r.isError, false);
  assert.equal(r.certified, false, "the MVP must never certify");
  assert.equal(r.exitCode, 0);
  assert.equal(r.toolchain, pinnedToolchain("core"));
});

test("core: a syntax error fails with a positioned diagnostic", CORE, async () => {
  const r = await check("theorem broken : True := by\n");
  assert.equal(r.status, "failed");
  assert.equal(r.isError, true);
  assert.ok(r.diagnostics.length > 0, `no diagnostics: ${r.stderr}`);
  assert.equal(r.diagnostics[0].severity, "error");
});

test("core: a false theorem fails", CORE, async () => {
  const r = await check("theorem impossible : 1 = 2 := by\n  rfl\n");
  assert.equal(r.status, "failed");
  assert.equal(r.certified, false);
});

test("core: sorry is flagged and never certified", CORE, async () => {
  const r = await check("theorem placeholder : False := by\n  sorry\n");
  assert.equal(r.containsPlaceholders, true);
  assert.equal(r.certified, false);
  assert.doesNotMatch(r.summary, /certified|proved/i);
  assert.equal(r.status, "rejected");
  assert.equal(r.errorCode, "LEAN_CANDIDATE_PREFLIGHT_BLOCKED");
  assert.equal(r.orchestration.failureClass, "candidate_preflight");
  assert.equal(r.orchestration.terminal, false);
  assert.equal(r.orchestration.retryable, true);
  assert.equal(r.attemptConsumed, false);
});

test("core: a Lean main is elaborated but not executed", CORE, async () => {
  const r = await check('def main : IO Unit := IO.println "SHOULD_NOT_RUN"\n');
  assert.equal(r.status, "checked", r.summary);
  assert.ok(!(r.stdout + r.stderr).includes("SHOULD_NOT_RUN"));
});

test("core: the sandbox denies filesystem and network access", CORE, async () => {
  const r = await check(
    `#eval (do
  let s ← IO.FS.readFile "/etc/shadow" <|> pure "DENIED"
  IO.println ("FS=" ++ s) : IO Unit)
#eval (do
  let o ← IO.Process.output { cmd := "curl", args := #["-sS", "--max-time", "5", "https://example.com"] }
  IO.println ("NET=" ++ o.stdout) : IO Unit)
`
  );
  const out = r.stdout + r.stderr;
  assert.match(out, /FS=DENIED/);
  assert.doesNotMatch(out, /NET=<!doctype|NET=<html/i);
});

test("core: a runaway loop is stopped by the timeout", CORE, async () => {
  const r = await check(
    "def loop : Nat → Nat\n  | 0 => 0\n  | n + 1 => loop n\n#eval loop 100000000000\n",
    "core",
    5
  );
  assert.ok(r.status === "timeout" || r.status === "failed", `unexpected status ${r.status}`);
  assert.equal(r.isError, true);
});

test("mathlib: a targeted Mathlib import checks under the mathlib profile", MATHLIB, async () => {
  const r = await check(
    "import Mathlib.Data.Nat.Prime.Basic\n\ntheorem prime_two : Nat.Prime 2 := Nat.prime_two\n",
    "mathlib"
  );
  assert.equal(r.status, "checked", r.summary + "\n" + r.stdout + r.stderr);
  assert.equal(r.profile, "mathlib");
  // The pinned descriptor comes from the profile, never from a literal in a
  // test — a test that hardcodes it breaks on every legitimate toolchain bump.
  assert.equal(r.toolchain, pinnedToolchain("mathlib"));
  assert.equal(r.certified, false);
});

// A root `import Mathlib` is expensive, but "it always times out" is not an
// invariant: how it ends depends on version, cache, hardware and the sandbox
// budget. Observed on the reference machine it does not time out at all — it
// aborts at ~2.5 s with Lean's own `memory_exception: excessive memory
// consumption` (exit 134) inside the sandbox memory limit. The contract is
// what this test pins: a bounded terminal state, honestly reported, never a
// false success and never an empty summary.
test("mathlib: a root import is bounded and reported honestly, whatever the machine does", MATHLIB, async () => {
  const r = await check("import Mathlib\n\ntheorem t : True := trivial\n", "mathlib", 20);
  assert.ok(
    ["checked", "timeout", "failed"].includes(r.status),
    `unexpected status ${r.status}: ${r.summary}`
  );
  if (r.status === "checked") {
    assert.equal(r.isError, false);
  } else {
    assert.equal(r.isError, true);
    assert.notEqual(r.summary, "", "a terminal failure must always explain itself");
    if (r.status === "timeout") assert.equal(r.timedOut, true);
  }
  assert.equal(r.certified, false);
});

test("mathlib imports are unavailable under the core profile", CORE, async () => {
  const r = await check("import Mathlib.Data.Nat.Prime.Basic\n\ntheorem t : True := trivial\n", "core");
  assert.equal(r.status, "failed");
  assert.ok(r.diagnostics.length > 0 || r.stderr.length > 0);
});
