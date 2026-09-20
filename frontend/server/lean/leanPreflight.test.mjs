// Tests for leanPreflight.mjs — leveled readiness checks with injected
// spawn/probe fakes (no real sandbox, no real Lean required).
import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { chmodSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { EventEmitter } from "node:events";

import { loadLeanConfig } from "./leanConfig.mjs";
import { runLeanPreflight, PREFLIGHT_LEVELS } from "./leanPreflight.mjs";
import { writeLeanRuntimeMetadata } from "./leanMetadata.mjs";

function makeEnv(overrides = {}) {
  return Object.assign(
    {
      DS4_LEAN_ENABLED: "1",
      DS4_LEAN_POLICY_AUTO: "1",
      DS4_LEAN_SANDBOX_REQUIRED: "1",
      DS4_LEAN_BWRAP_BIN: "/usr/bin/bwrap",
      DS4_LEAN_PRLIMIT_BIN: "/usr/bin/prlimit",
      DS4_LEAN_RUNTIME_ROOT: "/tmp/test-lean-runtime",
      DS4_LEAN_RUNS_ROOT: "/tmp/test-lean-runs",
      DS4_LEAN_DEFAULT_PROFILE: "core",
      DS4_LEAN_TIMEOUT_SEC: "30",
      DS4_LEAN_MAX_TIMEOUT_SEC: "120",
      DS4_LEAN_MEMORY_BYTES: "4294967296",
      DS4_LEAN_CPU_SECONDS: "30",
      DS4_LEAN_MAX_PROCESSES: "64",
      DS4_LEAN_MAX_OPEN_FILES: "128",
      DS4_LEAN_RETENTION_HOURS: "24",
    },
    overrides
  );
}

test("loadLeanConfig — valid environment", () => {
  const config = loadLeanConfig(makeEnv());
  assert.equal(config.enabled, true);
  assert.equal(config.sandboxRequired, true);
  assert.equal(config.policyAuto, true);
  assert.equal(config.defaultProfile, "core");
  assert.equal(config.bwrapBin, "/usr/bin/bwrap");
});

test("loadLeanConfig — disabled feature", () => {
  const env = makeEnv({ DS4_LEAN_ENABLED: "0" });
  const config = loadLeanConfig(env);
  assert.equal(config.enabled, false);
});

test("loadLeanConfig — boolean parsing (true/false)", () => {
  const env = makeEnv({
    DS4_LEAN_ENABLED: "true",
    DS4_LEAN_SANDBOX_REQUIRED: "false",
  });
  const config = loadLeanConfig(env);
  assert.equal(config.enabled, true);
  assert.equal(config.sandboxRequired, false);
});

test("loadLeanConfig — invalid profile throws", () => {
  const env = makeEnv({ DS4_LEAN_DEFAULT_PROFILE: "invalid" });
  assert.throws(() => loadLeanConfig(env), /Must be 'core' or 'mathlib'/);
});

test("loadLeanConfig — numeric out of range", () => {
  const env = makeEnv({ DS4_LEAN_TIMEOUT_SEC: "999" });
  const config = loadLeanConfig(env);
  // Falls back to default
  assert.equal(config.defaultTimeoutSec, 30);
});

// ---------------------------------------------------------------------------
// Leveled preflight fixture: a fake profile that reaches "ready" when every
// sandbox dependency is stubbed to succeed.
// ---------------------------------------------------------------------------

const TOOLCHAIN = "leanprover--lean4---v4.32.2";

async function makeFixture({ driftManifest = false, toolchain = TOOLCHAIN } = {}) {
  const root = await mkdtemp(resolve(tmpdir(), "ds4-pf-"));
  const runtimeRoot = join(root, "runtime");
  const runsRoot = join(root, "runs");
  await mkdir(runsRoot, { recursive: true });
  const profileDir = join(runtimeRoot, "core");
  const buildLib = join(profileDir, ".lake", "build", "lib", "lean");
  await mkdir(buildLib, { recursive: true });

  const pinnedFiles = {
    "lean-toolchain": "leanprover/lean4:v4.32.2\n",
    "lakefile.toml": "name = \"ds4LeanCore\"\n",
    "lake-manifest.json": '{"version":"1.2.0","packages":[]}\n',
    "Ds4LeanCore.lean": "theorem ds4_core_smoke : 1 + 1 = 2 := by decide\n",
  };
  for (const [name, content] of Object.entries(pinnedFiles)) {
    await writeFile(join(profileDir, name), content);
  }

  const elanRoot = join(root, "elan");
  const tcDir = join(elanRoot, "toolchains", toolchain, "bin");
  await mkdir(tcDir, { recursive: true });
  for (const bin of ["lean", "lake"]) {
    const p = join(tcDir, bin);
    await writeFile(p, "#!/bin/sh\nexit 0\n");
    chmodSync(p, 0o755);
  }

  const config = {
    enabled: true,
    sandboxRequired: true,
    bwrapBin: "/usr/bin/bwrap",
    prlimitBin: "/usr/bin/prlimit",
    runtimeRoot,
    runsRoot,
    elanRoot,
    memoryBytes: 4294967296,
    addressSpaceBytes: 17179869184,
    cpuSeconds: 30,
    maxProcesses: 64,
    maxOpenFiles: 128,
    leanThreads: 4,
  };

  const meta = await writeLeanRuntimeMetadata(config, "core", {
    mode: "locked",
    descriptor: "leanprover/lean4:v4.32.2",
    leanVersion: "Lean (version 4.32.2, x86_64-unknown-linux-gnu, commit f3b06c705e6c85f5314019d5d3baab0fec5b580c, Release)",
    lakeVersion: "Lake version 5.0.0-src+f3b06c7 (Lean version 4.32.2)",
  });
  assert.equal(meta.ok, true);

  // Drift AFTER the lock is recorded, so the recorded hash goes stale.
  if (driftManifest) {
    await writeFile(join(profileDir, "lake-manifest.json"), '{"version":"1.2.0","packages":[{"drift":true}]}\n');
  }

  return { root, config, profileDir, cleanup: () => rm(root, { recursive: true, force: true }) };
}

/** Fake spawn that records the inner command and resolves a fixed exit code. */
function fakeSpawnFactory({ code = 0, signal = null } = {}) {
  const calls = [];
  const spawnFn = (cmd, args) => {
    calls.push({ cmd, args });
    const child = new EventEmitter();
    child.kill = () => {};
    process.nextTick(() => child.emit("close", code, signal));
    return child;
  };
  spawnFn.calls = calls;
  return spawnFn;
}

const READY_DEPS = {
  probeUserNamespaces: async () => true,
  spawnFn: fakeSpawnFactory({ code: 0 }),
};

test("runLeanPreflight — feature disabled", async () => {
  const config = { enabled: false };
  const result = await runLeanPreflight(config);
  assert.equal(result.ok, false);
  assert.equal(result.enabled, false);
  assert.equal(result.ready, false);
  assert.ok(result.errors.length > 0);
});

test("runLeanPreflight — sandbox missing with required=true", async () => {
  const config = loadLeanConfig(makeEnv(), {
    bwrapBin: "/nonexistent/bwrap",
    prlimitBin: "/nonexistent/prlimit",
  });
  const result = await runLeanPreflight(config);
  if (config.sandboxRequired) {
    assert.ok(result.errors.length > 0);
  }
});

test("a fully prepared profile with working sandbox reaches ready", async () => {
  const fix = await makeFixture();
  try {
    const result = await runLeanPreflight(fix.config, READY_DEPS);
    assert.equal(result.ready, true, JSON.stringify(result.errors));
    assert.equal(result.ok, true);
    assert.equal(result.profiles.core.level, "ready");
    assert.equal(result.profiles.core.ok, true);
    for (const lv of PREFLIGHT_LEVELS) assert.equal(result.levels[lv], true, lv);
    assert.equal(result.profiles.mathlib.ok, false, "mathlib profile does not exist in the fixture");
  } finally {
    await fix.cleanup();
  }
});

test("missing runtime metadata stops the profile at installed", async () => {
  const fix = await makeFixture();
  try {
    const { rm } = await import("node:fs/promises");
    await rm(join(fix.config.runtimeRoot, "core", "runtime.metadata.json"));
    const result = await runLeanPreflight(fix.config, READY_DEPS);
    assert.equal(result.profiles.core.level, "installed");
    assert.equal(result.profiles.core.ok, false);
    assert.match(result.profiles.core.reason, /metadata/);
    assert.equal(result.ready, false);
  } finally {
    await fix.cleanup();
  }
});

test("a drifted pinned manifest fails the checksum check at installed", async () => {
  const fix = await makeFixture({ driftManifest: true });
  try {
    const result = await runLeanPreflight(fix.config, READY_DEPS);
    assert.equal(result.profiles.core.level, "installed");
    assert.equal(result.profiles.core.ok, false);
    assert.match(result.profiles.core.reason, /hash mismatch/);
  } finally {
    await fix.cleanup();
  }
});

test("failing user namespaces stops the profile at prepared", async () => {
  const fix = await makeFixture();
  try {
    const result = await runLeanPreflight(fix.config, {
      ...READY_DEPS,
      probeUserNamespaces: async () => false,
    });
    assert.equal(result.profiles.core.level, "prepared");
    assert.equal(result.profiles.core.ok, false);
    assert.match(result.profiles.core.reason, /user namespaces/);
  } finally {
    await fix.cleanup();
  }
});

test("a failing smoke theorem stops the profile at smoke-checked", async () => {
  const fix = await makeFixture();
  try {
    const result = await runLeanPreflight(fix.config, {
      probeUserNamespaces: async () => true,
      spawnFn: fakeSpawnFactory({ code: 1 }),
    });
    assert.equal(result.profiles.core.level, "sandbox-capable");
    assert.equal(result.profiles.core.ok, false);
    assert.match(result.profiles.core.reason, /smoke theorem failed/);
    assert.equal(result.levels["smoke-checked"], false);
  } finally {
    await fix.cleanup();
  }
});

test("a sandbox that can reach the host network is not ready", async () => {
  const fix = await makeFixture();
  try {
    // A spawn that behaves like the network probe: exit 1 means "connected".
    const calls = [];
    const spawnFn = (cmd, args) => {
      calls.push({ cmd, args });
      const nodeIdx = args.indexOf("/usr/bin/node");
      const child = new EventEmitter();
      child.kill = () => {};
      process.nextTick(() => child.emit("close", nodeIdx >= 0 ? 1 : 0, null));
      return child;
    };
    const result = await runLeanPreflight(fix.config, {
      probeUserNamespaces: async () => true,
      spawnFn,
    });
    assert.equal(result.profiles.core.level, "smoke-checked");
    assert.equal(result.profiles.core.ok, false);
    assert.match(result.profiles.core.reason, /reached the host network/);
  } finally {
    await fix.cleanup();
  }
});

test("an unwritable runs root stops the profile at prepared", async () => {
  const fix = await makeFixture();
  try {
    const { chmod } = await import("node:fs/promises");
    await chmod(fix.config.runsRoot, 0o500);
    const result = await runLeanPreflight(fix.config, READY_DEPS);
    assert.equal(result.profiles.core.level, "prepared");
    assert.equal(result.profiles.core.ok, false);
    assert.match(result.profiles.core.reason, /Runs root/);
    await chmod(fix.config.runsRoot, 0o755);
  } finally {
    await fix.cleanup();
  }
});

test("the levels are reported as an ordered strict progression", () => {
  assert.deepEqual(PREFLIGHT_LEVELS, [
    "configured",
    "installed",
    "prepared",
    "sandbox-capable",
    "smoke-checked",
    "ready",
  ]);
});

test("deep checks run once per process and are reused", async () => {
  const fix = await makeFixture();
  try {
    const spawnFn = fakeSpawnFactory({ code: 0 });
    const deps = { probeUserNamespaces: async () => true, spawnFn };
    const r1 = await runLeanPreflight(fix.config, deps);
    assert.equal(r1.profiles.core.level, "ready");
    const deepCalls = spawnFn.calls.length;
    assert.ok(deepCalls >= 2, "smoke + network probe must have run");
    const r2 = await runLeanPreflight(fix.config, deps);
    assert.equal(r2.profiles.core.level, "ready");
    assert.equal(spawnFn.calls.length, deepCalls,
      "memoized deep checks must not re-spawn on a second preflight");
  } finally {
    await fix.cleanup();
  }
});

test("drift surfaces through the cheap checks and recovers without re-deep", async () => {
  const fix = await makeFixture();
  try {
    const spawnFn = fakeSpawnFactory({ code: 0 });
    const deps = { probeUserNamespaces: async () => true, spawnFn };
    const r1 = await runLeanPreflight(fix.config, deps);
    assert.equal(r1.profiles.core.level, "ready");
    const deepCalls = spawnFn.calls.length;
    await writeFile(join(fix.profileDir, "lake-manifest.json"), '{"version":"1.2.0","packages":[{"drift":true}]}\n');
    const r2 = await runLeanPreflight(fix.config, deps);
    assert.equal(r2.profiles.core.level, "installed");
    assert.match(r2.profiles.core.reason, /hash mismatch/);
    await writeFile(join(fix.profileDir, "lake-manifest.json"), '{"version":"1.2.0","packages":[]}\n');
    const r3 = await runLeanPreflight(fix.config, deps);
    assert.equal(r3.profiles.core.level, "ready",
      "after restoring the pinned files the deep result is still valid");
    assert.equal(spawnFn.calls.length, deepCalls,
      "a drift+restore round trip must not needlessly re-run the deep checks");
  } finally {
    await fix.cleanup();
  }
});

test("memoized failures stick for the process lifetime (fail closed)", async () => {
  const fix = await makeFixture();
  try {
    const spawnFn = fakeSpawnFactory({ code: 1 });
    const deps = { probeUserNamespaces: async () => true, spawnFn };
    const r1 = await runLeanPreflight(fix.config, deps);
    assert.equal(r1.profiles.core.level, "sandbox-capable");
    assert.match(r1.profiles.core.reason, /smoke theorem failed/);
    spawnFn.code = 0;
    const r2 = await runLeanPreflight(fix.config, deps);
    assert.equal(r2.profiles.core.level, "sandbox-capable",
      "a failed deep check must not recover silently in-process");
  } finally {
    await fix.cleanup();
  }
});
