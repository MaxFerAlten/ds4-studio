/** Test origin: DS4 acceptance requirements SEC-LEDGER-004 and SEC-TOCTOU-001. */

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  atomicWriteJson,
  canonicalJson,
  hashFile,
  hashJson,
  timingSafeHexEqual
} from "./evolutionIntegrity.mjs";

test("SEC-LEDGER-004 canonical hashes do not depend on object key order", () => {
  assert.equal(canonicalJson({ b: 2, a: { d: 4, c: 3 } }), '{"a":{"c":3,"d":4},"b":2}');
  assert.equal(hashJson({ a: 1, b: 2 }), hashJson({ b: 2, a: 1 }));
  assert.throws(() => canonicalJson({ bad: Number.NaN }), /finite numbers/);
});

test("SEC-TOCTOU-001 atomic JSON writes are hash-verifiable", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "ds4-evo-integrity-"));
  try {
    const file = path.join(directory, "state.json");
    await atomicWriteJson(file, { state: "CREATED" });
    const first = await hashFile(file);
    await atomicWriteJson(file, { state: "COMPLETED" });
    const second = await hashFile(file);
    assert.notEqual(first, second);
    assert.equal(timingSafeHexEqual(first, first), true);
    assert.equal(timingSafeHexEqual(first, second), false);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
