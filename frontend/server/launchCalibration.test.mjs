import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { LaunchCalibrator, appendObservation, readObservations } from "./launchCalibration.mjs";

const START = "ds4: ROCm backend initialized on AMD Radeon Graphics (sm_115)";
const PLAN = "ds4: memory: KV 7.15 GiB (raw 0.10 + compressed 7.05) + buffers 1.05 GiB "
  + "+ resident model 90.88 GiB = 99.09 GiB planned";
const DETAIL = "ds4: memory detail: ctx=550000 prefill_cap=1024 raw_kv_rows=1280";

function drive(lines) {
  const seen = [];
  const c = new LaunchCalibrator((o) => seen.push(o));
  for (const l of lines) c.observe(l);
  return seen;
}

test("a successful launch is recorded with its sidecar cost", () => {
  const seen = drive([
    START,
    "ds4: ROCm startup model preparation covered 90.88 GiB of tensor spans in 19.5s",
    "ds4: ROCm startup model preparation covered 0.87 GiB of tensor spans in 1.4s",
    PLAN, DETAIL,
    "ds4-wrapper: HTTP server listening on 127.0.0.1:8002",
  ]);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].outcome, "ok");
  assert.equal(seen[0].ctx, 550000);
  assert.equal(seen[0].extraGib, 0.87);          // encoder only, never the target
  assert.equal(seen[0].totalGib, 99.96);
});

test("a refused launch is recorded as refused", () => {
  const seen = drive([
    START,
    "ds4: ROCm startup model preparation covered 90.88 GiB of tensor spans in 21.5s",
    "ds4: ROCm startup model preparation covered 5.58 GiB of tensor spans in 1.4s",
    PLAN, DETAIL,
    "ds4: ROCm allocation refused: 64.00 MiB requested, 2.04 GiB usable",
  ]);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].outcome, "refused");
  assert.equal(seen[0].totalGib, 104.67);
});

test("only the first outcome of a launch counts", () => {
  const seen = drive([
    START, PLAN, DETAIL,
    "ds4: ROCm allocation refused: 8.00 MiB requested, 2.00 GiB usable",
    "ds4: ROCm allocation refused: 8.00 MiB requested, 2.00 GiB usable",
    "ds4-wrapper: session startup failed",
  ]);
  assert.equal(seen.length, 1);
});

test("a plan with no ctx line yet never closes an observation", () => {
  assert.equal(drive([START, PLAN, "ds4-wrapper: HTTP server listening"]).length, 0);
});

test("a second launch in the same process is recorded separately", () => {
  const seen = drive([
    START, PLAN, DETAIL, "ds4-wrapper: HTTP server listening on 127.0.0.1:8002",
    START, PLAN, DETAIL, "ds4: ROCm allocation refused: 8.00 MiB requested",
  ]);
  assert.equal(seen.length, 2);
  assert.deepEqual(seen.map((o) => o.outcome), ["ok", "refused"]);
});

test("a writer that throws cannot break the launch", () => {
  const c = new LaunchCalibrator(() => { throw new Error("disk full"); });
  for (const l of [START, PLAN, DETAIL, "ds4-wrapper: HTTP server listening"]) {
    assert.doesNotThrow(() => c.observe(l));
  }
});

test("observations round-trip through the file", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ds4-calib-"));
  const file = path.join(dir, "calibration.json");
  assert.deepEqual(readObservations(file), []);          // missing file is empty, not a throw
  appendObservation({ ctx: 4096, outcome: "ok" }, file);
  appendObservation({ ctx: 8192, outcome: "refused" }, file);
  const rows = readObservations(file);
  assert.deepEqual(rows.map((r) => r.ctx), [4096, 8192]);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("a corrupt calibration file reads as empty instead of throwing", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ds4-calib-"));
  const file = path.join(dir, "calibration.json");
  fs.writeFileSync(file, "{ not json");
  assert.deepEqual(readObservations(file), []);
  fs.rmSync(dir, { recursive: true, force: true });
});
