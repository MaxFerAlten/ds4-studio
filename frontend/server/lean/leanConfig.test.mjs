// Tests for resolveLeanConfig — the env > config JSON > default precedence
// (R3) plus per-key provenance (sources) and explicit warnings.
import test from "node:test";
import assert from "node:assert/strict";
import { resolveLeanConfig } from "./leanConfig.mjs";

function fileConfig(overrides = {}) {
  return { enabled: false, policyAuto: true, defaultProfile: "core", ...overrides };
}

const DERIVED = {
  runtimeRoot: "/derived/lean-runtime",
  runsRoot: "/derived/lean-runs",
};

test("env absent + JSON false -> false, source file", () => {
  const r = resolveLeanConfig({}, { fileConfig: fileConfig({ enabled: false }), ...DERIVED });
  assert.equal(r.config.enabled, false);
  assert.equal(r.requested.enabled, false);
  assert.equal(r.sources.enabled, "file");
  assert.deepEqual(r.warnings, []);
});

test("env absent + JSON true -> true, source file", () => {
  const r = resolveLeanConfig({}, { fileConfig: fileConfig({ enabled: true }), ...DERIVED });
  assert.equal(r.config.enabled, true);
  assert.equal(r.sources.enabled, "file");
});

test("env false + JSON true -> false, source env", () => {
  const r = resolveLeanConfig(
    { DS4_LEAN_ENABLED: "0" },
    { fileConfig: fileConfig({ enabled: true }), ...DERIVED }
  );
  assert.equal(r.config.enabled, false);
  assert.equal(r.sources.enabled, "env");
});

test("env true + JSON false -> true, source env", () => {
  const r = resolveLeanConfig(
    { DS4_LEAN_ENABLED: "true" },
    { fileConfig: fileConfig({ enabled: false }), ...DERIVED }
  );
  assert.equal(r.config.enabled, true);
  assert.equal(r.sources.enabled, "env");
});

test("env absent + JSON absent -> default false, source default", () => {
  const r = resolveLeanConfig({}, { fileConfig: {}, ...DERIVED });
  assert.equal(r.config.enabled, false);
  assert.equal(r.sources.enabled, "default");
});

test("invalid env -> warning, not silent fallback", () => {
  const r = resolveLeanConfig(
    { DS4_LEAN_ENABLED: "banana" },
    { fileConfig: fileConfig({ enabled: true }), ...DERIVED }
  );
  assert.equal(r.config.enabled, true);
  assert.equal(r.sources.enabled, "file");
  assert.ok(r.warnings.some((w) => w.includes("DS4_LEAN_ENABLED") && w.includes("banana")));
});

test("policyAuto follows the same precedence", () => {
  const fromEnv = resolveLeanConfig(
    { DS4_LEAN_POLICY_AUTO: "0" },
    { fileConfig: fileConfig({ policyAuto: true }), ...DERIVED }
  );
  assert.equal(fromEnv.config.policyAuto, false);
  assert.equal(fromEnv.sources.policyAuto, "env");

  const fromFile = resolveLeanConfig({}, { fileConfig: fileConfig({ policyAuto: false }), ...DERIVED });
  assert.equal(fromFile.config.policyAuto, false);
  assert.equal(fromFile.sources.policyAuto, "file");

  const fromDefault = resolveLeanConfig({}, { fileConfig: {}, ...DERIVED });
  assert.equal(fromDefault.config.policyAuto, true);
  assert.equal(fromDefault.sources.policyAuto, "default");
});

test("defaultProfile: env wins, file next, default last", () => {
  const fromEnv = resolveLeanConfig(
    { DS4_LEAN_DEFAULT_PROFILE: "mathlib" },
    { fileConfig: fileConfig({ defaultProfile: "core" }), ...DERIVED }
  );
  assert.equal(fromEnv.config.defaultProfile, "mathlib");
  assert.equal(fromEnv.sources.defaultProfile, "env");

  const fromFile = resolveLeanConfig({}, { fileConfig: fileConfig({ defaultProfile: "mathlib" }), ...DERIVED });
  assert.equal(fromFile.config.defaultProfile, "mathlib");
  assert.equal(fromFile.sources.defaultProfile, "file");

  const fromDefault = resolveLeanConfig({}, { fileConfig: {}, ...DERIVED });
  assert.equal(fromDefault.config.defaultProfile, "core");
  assert.equal(fromDefault.sources.defaultProfile, "default");
});

test("invalid env defaultProfile is an explicit error, not a fallback", () => {
  assert.throws(
    () =>
      resolveLeanConfig(
        { DS4_LEAN_DEFAULT_PROFILE: "banana" },
        { fileConfig: fileConfig({ defaultProfile: "mathlib" }), ...DERIVED }
      ),
    /Must be 'core' or 'mathlib'/
  );
});

test("runtimeRoot/runsRoot provenance: env wins over derived-project-root", () => {
  const derived = resolveLeanConfig({}, { fileConfig: {}, ...DERIVED });
  assert.equal(derived.config.runtimeRoot, "/derived/lean-runtime");
  assert.equal(derived.sources.runtimeRoot, "derived-project-root");
  assert.equal(derived.sources.runsRoot, "derived-project-root");

  const fromEnv = resolveLeanConfig(
    { DS4_LEAN_RUNTIME_ROOT: "/env/runtime", DS4_LEAN_RUNS_ROOT: "/env/runs" },
    { fileConfig: {}, ...DERIVED }
  );
  assert.equal(fromEnv.config.runtimeRoot, "/env/runtime");
  assert.equal(fromEnv.sources.runtimeRoot, "env");
  assert.equal(fromEnv.sources.runsRoot, "env");
});

test("sandboxRequired stays env/default and always reports a source", () => {
  const fromEnv = resolveLeanConfig(
    { DS4_LEAN_SANDBOX_REQUIRED: "0" },
    { fileConfig: {}, ...DERIVED }
  );
  assert.equal(fromEnv.config.sandboxRequired, false);
  assert.equal(fromEnv.sources.sandboxRequired, "env");

  const fromDefault = resolveLeanConfig({}, { fileConfig: {}, ...DERIVED });
  assert.equal(fromDefault.config.sandboxRequired, true);
  assert.equal(fromDefault.sources.sandboxRequired, "default");
});

test("R6 concurrency defaults are the prudent initial bounds", () => {
  const r = resolveLeanConfig({}, { fileConfig: {}, ...DERIVED });
  assert.equal(r.config.maxGlobalRuns, 2);
  assert.equal(r.config.maxRunsPerSession, 1);
  assert.equal(r.config.maxQueuedPerSession, 1);
  assert.equal(r.config.registryCapacity, 64);
  assert.equal(r.config.registryTtlMs, 3600000);
});

test("R6 concurrency limits are readable from env and validated", () => {
  const r = resolveLeanConfig(
    {
      DS4_LEAN_MAX_GLOBAL_RUNS: "1",
      DS4_LEAN_MAX_RUNS_PER_SESSION: "2",
      DS4_LEAN_MAX_QUEUED_PER_SESSION: "0",
      DS4_LEAN_REGISTRY_CAPACITY: "128",
      DS4_LEAN_REGISTRY_TTL_MS: "600000",
    },
    { fileConfig: {}, ...DERIVED }
  );
  assert.equal(r.config.maxGlobalRuns, 1);
  assert.equal(r.config.maxRunsPerSession, 2);
  assert.equal(r.config.maxQueuedPerSession, 0);
  assert.equal(r.config.registryCapacity, 128);
  assert.equal(r.config.registryTtlMs, 600000);
});

test("R6 invalid concurrency env falls back to the default without warnings being silent", () => {
  const r = resolveLeanConfig(
    { DS4_LEAN_MAX_GLOBAL_RUNS: "banana", DS4_LEAN_MAX_RUNS_PER_SESSION: "99" },
    { fileConfig: {}, ...DERIVED }
  );
  assert.equal(r.config.maxGlobalRuns, 2);
  assert.equal(r.config.maxRunsPerSession, 1);
});

test("R9 retention defaults differentiate infrastructure failures from results", () => {
  const r = resolveLeanConfig({}, { fileConfig: {}, ...DERIVED });
  assert.equal(r.config.retentionHours, 24);
  assert.equal(r.config.infraRetentionHours, 168);
  assert.equal(r.config.fsyncArtifacts, false);
});

test("R9 retention env overrides are read and validated", () => {
  const r = resolveLeanConfig(
    {
      DS4_LEAN_RETENTION_HOURS: "48",
      DS4_LEAN_INFRA_RETENTION_HOURS: "720",
      DS4_LEAN_FSYNC_ARTIFACTS: "1",
    },
    { fileConfig: {}, ...DERIVED }
  );
  assert.equal(r.config.retentionHours, 48);
  assert.equal(r.config.infraRetentionHours, 720);
  assert.equal(r.config.fsyncArtifacts, true);
});

test("R9 invalid infra retention env falls back to the default", () => {
  const r = resolveLeanConfig(
    { DS4_LEAN_INFRA_RETENTION_HOURS: "99999" },
    { fileConfig: {}, ...DERIVED }
  );
  assert.equal(r.config.infraRetentionHours, 168);
  assert.equal(r.config.fsyncArtifacts, false);
});
