/** Test origin: DS4 acceptance requirement for stable Level B benchmark commands. */

import assert from "node:assert/strict";
import test from "node:test";

import { parseArguments } from "./run.mjs";

test("offline certification CLI parses the stable selftest gate command", () => {
  assert.deepEqual(parseArguments(["--selftest", "--gate", "--artifacts-dir", "/tmp/evidence"]), {
    selftest: true,
    gate: true,
    live: false,
    outputDir: "/tmp/evidence"
  });
});

test("unknown arguments fail closed", () => {
  assert.throws(() => parseArguments(["--enable-unsafe"]), /UNKNOWN_ARGUMENT/);
});
