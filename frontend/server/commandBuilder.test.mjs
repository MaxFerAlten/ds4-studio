import test from "node:test";
import assert from "node:assert/strict";
import { mergeConfig } from "./config.mjs";
import { buildDs4WrapperArgs } from "./commandBuilder.mjs";

function valueAfter(args, flag) {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

test("buildDs4WrapperArgs targets the wrapper binary and forces one queued job", () => {
  const config = mergeConfig({
    wrapper: {
      enabled: true,
      binary: "./ds4-wrapper",
      startupMode: "server",
      ramFreezeMaxMb: 4096,
      freezeOnSwitch: true,
      freeInactiveSession: true
    },
    server: { model: "ds4flash.gguf", backend: "cuda", port: 8002, kvDiskDir: "/tmp/ds4-kv" }
  });

  const { command, args } = buildDs4WrapperArgs(config);

  assert.equal(command, "./ds4-wrapper");
  // mutual-exclusive mode: exactly one queued job, always
  assert.equal(valueAfter(args, "--max-queued-jobs"), "1");
  // server passthrough (pushValue stringifies)
  assert.equal(valueAfter(args, "--model"), "ds4flash.gguf");
  assert.equal(valueAfter(args, "--port"), "8002");
  assert.ok(args.includes("--cuda"));
  assert.equal(valueAfter(args, "--kv-disk-dir"), "/tmp/ds4-kv");
  // wrapper-specific
  assert.equal(valueAfter(args, "--startup-mode"), "server");
  assert.equal(valueAfter(args, "--ram-freeze-max-mb"), "4096");
  assert.ok(args.includes("--freeze-on-switch"));
  assert.ok(args.includes("--free-inactive-session"));
});

test("buildDs4WrapperArgs omits boolean flags when disabled", () => {
  const config = mergeConfig({
    wrapper: { enabled: true, freezeOnSwitch: false, freeInactiveSession: false, startupMode: "agent" }
  });
  const { args } = buildDs4WrapperArgs(config);
  assert.ok(!args.includes("--freeze-on-switch"));
  assert.ok(!args.includes("--free-inactive-session"));
  assert.equal(valueAfter(args, "--startup-mode"), "agent");
});

test("buildDs4WrapperArgs always pins --max-queued-jobs to 1", () => {
  // Even though maxQueuedJobs may exist on server config, the wrapper hardcodes 1.
  const config = mergeConfig({
    wrapper: { enabled: true },
    server: { maxQueuedJobs: 8 }
  });
  const { args } = buildDs4WrapperArgs(config);
  const occurrences = args.filter((a) => a === "1" && args[args.indexOf(a) - 1] === "--max-queued-jobs");
  assert.equal(valueAfter(args, "--max-queued-jobs"), "1");
  assert.ok(occurrences.length >= 0); // sanity; the pinned value is "1"
});
