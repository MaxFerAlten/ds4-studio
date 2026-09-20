// The rule that keeps certification honest: a real suite may skip on an
// unprovisioned laptop, but never when the run claims the host is provisioned.
import test from "node:test";
import assert from "node:assert/strict";

import { requireReady } from "./fixtures/realTestGate.mjs";

const FLAG = "DS4_TEST_GATE_FIXTURE";

test.afterEach(() => {
  delete process.env[FLAG];
});

test("a ready profile runs the tests", () => {
  assert.deepEqual(requireReady({ ok: true }, { flag: FLAG, label: "profile core" }), {});
});

test("an unready profile skips when the flag is not set", () => {
  const opts = requireReady({ ok: false, reason: "no toolchain" }, { flag: FLAG, label: "profile core" });
  assert.equal(opts.skip, "no toolchain");
});

test("an unready profile is a failure when the flag claims readiness", () => {
  process.env[FLAG] = "1";
  assert.throws(
    () => requireReady({ ok: false, reason: "no toolchain" }, { flag: FLAG, label: "profile core" }),
    /must fail, never skip/
  );
});

test("a missing profile entry is treated as unready", () => {
  const opts = requireReady(undefined, { flag: FLAG, label: "profile mathlib" });
  assert.equal(opts.skip, "profile mathlib is not prepared");

  process.env[FLAG] = "1";
  assert.throws(() => requireReady(undefined, { flag: FLAG, label: "profile mathlib" }), /not ready/);
});

test("only the exact flag value '1' makes readiness mandatory", () => {
  process.env[FLAG] = "0";
  assert.equal(requireReady({ ok: false, reason: "nope" }, { flag: FLAG, label: "x" }).skip, "nope");
});
