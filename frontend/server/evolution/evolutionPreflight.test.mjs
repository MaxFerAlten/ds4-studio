/** Test origin: DS4 acceptance requirements BEH-PREFLIGHT-001..004, SEC-PREFLIGHT-001..002. */

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";

import { EvolutionPreflight } from "./evolutionPreflight.mjs";

const execFileAsync = promisify(execFile);

if (!process.env.DS4_EVOLUTION_WRITE_TOKEN) {
  process.env.DS4_EVOLUTION_WRITE_TOKEN = "test-token-for-preflight-verification-32b";
}

async function commandExists(name) {
  try {
    await execFileAsync("command", ["-v", name]);
    return true;
  } catch {
    return false;
  }
}

test("BEH-PREFLIGHT-001 Linux prerequisites expose Level B", async () => {
  const preflight = new EvolutionPreflight({
    repositoryRoot: process.cwd(),
    stateDir: "data/evolution-runs",
    workDir: "/tmp/ds4-test-workspaces"
  });
  const caps = await preflight.inspect();
  assert.equal(caps.schema, "ds4_evolution_capabilities_v1");
  assert.equal(typeof caps.enabled, "boolean");
  assert.equal(typeof caps.effectiveMaxLevel, "string");
  assert.ok(["B", "C", "D", "E"].includes(caps.effectiveMaxLevel));
  assert.equal(typeof caps.platform, "string");
  assert.ok(typeof caps.checks === "object");
  assert.ok(typeof caps.levels === "object");
  assert.ok(caps.levels.B);
  assert.ok(caps.levels.C);
  assert.ok(caps.levels.D);
  assert.ok(caps.levels.E);
  assert.equal(caps.levels.E.available, false);
  assert.ok(caps.levels.E.blockers.includes("LEVEL_E_NOT_CERTIFIED"));
  assert.equal(typeof caps.checkedAt, "string");
});

test("BEH-PREFLIGHT-002 missing bwrap blocks B/C/D when detected", async () => {
  const preflight = new EvolutionPreflight({
    repositoryRoot: process.cwd(),
    stateDir: "/tmp",
    workDir: "/tmp",
    bwrapPath: "/nonexistent/bwrap",
    prlimitPath: "/nonexistent/prlimit"
  });
  const caps = await preflight.inspect();
  assert.equal(caps.checks.bubblewrap.ok, false);
  assert.equal(caps.levels.B.available, false);
  assert.ok(caps.levels.B.blockers.some((b) => b.includes("BUBBLEWRAP")));
});

test("BEH-PREFLIGHT-003 unavailable model blocks C/D only", async () => {
  const fakeModelClient = {
    async probe() { throw new Error("connection refused"); }
  };
  const preflight = new EvolutionPreflight({
    repositoryRoot: process.cwd(),
    stateDir: "/tmp",
    workDir: "/tmp",
    modelClient: fakeModelClient,
    modelEndpoint: "http://127.0.0.1:19999"
  });
  const caps = await preflight.inspect({ includeModelProbe: true });
  assert.equal(caps.checks.model.ok, false);
  assert.equal(caps.checks.writeAuth.ok, true, "write auth must be set for this test");
  assert.equal(caps.levels.B.available, true);
  assert.equal(caps.levels.C.available, false);
  assert.ok(caps.levels.C.blockers.some((b) => b.includes("MODEL")));
  assert.equal(caps.levels.D.available, false);
});

test("BEH-PREFLIGHT-004 stale GitNexus blocks D auto path", async () => {
  const fakeGitNexus = {
    async capabilities() {
      return { available: true, version: "1.0.0", repositoryIndexed: true, stale: true };
    }
  };
  const preflight = new EvolutionPreflight({
    repositoryRoot: process.cwd(),
    stateDir: "/tmp",
    workDir: "/tmp",
    gitNexusAdapter: fakeGitNexus
  });
  const caps = await preflight.inspect();
  assert.equal(caps.checks.gitnexus.ok, true);
  assert.equal(caps.checks.gitnexus.stale, true);
  assert.equal(caps.levels.D.available, false);
  assert.ok(caps.levels.D.blockers.some((b) => b.includes("GITNEXUS")));
});

test("SEC-PREFLIGHT-001 response omits absolute paths and token", async () => {
  const preflight = new EvolutionPreflight({
    repositoryRoot: "/home/user/project",
    stateDir: "/tmp",
    workDir: "/tmp"
  });
  const caps = await preflight.inspect();
  const json = JSON.stringify(caps);
  assert.ok(!json.includes("/home/user/project"));
  assert.ok(!json.includes("DS4_EVOLUTION_WRITE_TOKEN"));
});

test("SEC-PREFLIGHT-002 model probe is authenticated and bounded", async () => {
  let probeCalled = false;
  const fakeModelClient = {
    async probe() { probeCalled = true; return { ok: true }; }
  };
  const preflight = new EvolutionPreflight({
    repositoryRoot: process.cwd(),
    stateDir: "/tmp",
    workDir: "/tmp",
    modelClient: fakeModelClient,
    modelEndpoint: "http://127.0.0.1:8080"
  });
  await preflight.inspect({ includeModelProbe: true });
  assert.equal(probeCalled, true);
});

test("effectiveMaxLevel clamps to the most restrictive available level", async () => {
  const preflight = new EvolutionPreflight({
    repositoryRoot: process.cwd(),
    stateDir: "/tmp",
    workDir: "/tmp",
    bwrapPath: "/nonexistent/bwrap",
    prlimitPath: "/nonexistent/prlimit"
  });
  const caps = await preflight.inspect();
  assert.equal(caps.effectiveMaxLevel, "B");
  assert.equal(caps.configuredMaxLevel, "B");
});
