// Unit tests for the SageMath state manager: the call log ring buffer (in-memory
// + NDJSON persistence), the binary health check, and the shared state holder.
// sageResponds() spawns the real `sage` binary, so it is only exercised when the
// binary is present.

import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { SageCallLog, sageBinaryExists, sageResponds, sageState } from "./sageState.mjs";

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ds4-sage-test-"));
}

test("SageCallLog.record returns an enriched entry and keeps it in the ring", () => {
  const dir = tmpDir();
  const log = new SageCallLog({ dir });
  const entry = log.record({ code: "2^3", ok: true });
  assert.ok(entry.id, "record assigns an id");
  assert.ok(entry.ts, "record assigns a timestamp");
  assert.equal(entry.code, "2^3");
  assert.equal(entry.ok, true);
  assert.equal(log.list().length, 1);
  assert.equal(log.list()[0].id, entry.id);
});

test("SageCallLog.list returns most-recent-first and honours the limit", () => {
  const dir = tmpDir();
  const log = new SageCallLog({ dir });
  log.record({ code: "a" });
  log.record({ code: "b" });
  log.record({ code: "c" });
  const all = log.list();
  assert.deepEqual(all.map((e) => e.code), ["c", "b", "a"]);
  assert.deepEqual(log.list({ limit: 2 }).map((e) => e.code), ["c", "b"]);
});

test("SageCallLog enforces maxEntries by evicting the oldest", () => {
  const dir = tmpDir();
  const log = new SageCallLog({ dir, maxEntries: 2 });
  log.record({ code: "1" });
  log.record({ code: "2" });
  log.record({ code: "3" });
  assert.deepEqual(log.list().map((e) => e.code), ["3", "2"]);
});

test("SageCallLog persists to NDJSON and reloads across instances", () => {
  const dir = tmpDir();
  const first = new SageCallLog({ dir });
  first.record({ code: "persisted" });
  const file = path.join(dir, "sage-calls.ndjson");
  assert.ok(fs.existsSync(file), "ndjson file is created");
  const reloaded = new SageCallLog({ dir });
  assert.equal(reloaded.list().length, 1);
  assert.equal(reloaded.list()[0].code, "persisted");
});

test("SageCallLog.clear empties the ring and truncates the file", () => {
  const dir = tmpDir();
  const log = new SageCallLog({ dir });
  log.record({ code: "x" });
  log.clear();
  assert.equal(log.list().length, 0);
  const reloaded = new SageCallLog({ dir });
  assert.equal(reloaded.list().length, 0);
});

test("sageBinaryExists returns a boolean", () => {
  assert.equal(typeof sageBinaryExists(), "boolean");
});

test("sageState exposes the shared mutable holder", () => {
  assert.equal(typeof sageState, "object");
  assert.ok("enabled" in sageState);
  assert.ok("version" in sageState);
  assert.ok("lastCheck" in sageState);
});

test("sageResponds resolves to a health-check shape", { skip: !sageBinaryExists() }, async () => {
  const res = await sageResponds();
  assert.equal(typeof res, "object");
  assert.equal(typeof res.ok, "boolean");
  if (res.ok) {
    assert.equal(typeof res.version, "string");
  } else {
    assert.ok(res.error, "a failing health check reports an error");
  }
});
