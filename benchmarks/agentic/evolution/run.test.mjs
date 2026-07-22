/** Test origin: DS4 acceptance requirement for stable Level B benchmark commands. */

import assert from "node:assert/strict";
import test from "node:test";

import { parseArguments } from "./run.mjs";

test("offline certification CLI parses the stable selftest gate command", () => {
  assert.deepEqual(parseArguments(["--selftest", "--gate", "--artifacts-dir", "/tmp/evidence"]), {
    selftest: true,
    gate: true,
    live: false,
    level: "B",
    outputDir: "/tmp/evidence"
  });
});

test("offline certification CLI accepts explicit Level C and D catalogs", () => {
  assert.equal(parseArguments(["--selftest", "--level", "C"]).level, "C");
  assert.equal(parseArguments(["--selftest", "--level", "D"]).level, "D");
  assert.throws(() => parseArguments(["--selftest", "--level", "E"]), /INVALID_LEVEL/);
});

test("unknown arguments fail closed", () => {
  assert.throws(() => parseArguments(["--enable-unsafe"]), /UNKNOWN_ARGUMENT/);
});
