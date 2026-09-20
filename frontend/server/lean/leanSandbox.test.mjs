// Tests for leanSandbox.mjs
//
// The first half checks the shape of the generated command. The second half
// actually executes bwrap: a sandbox that is only asserted to be a non-empty
// argv is not a sandbox. Those tests skip themselves when the host has no
// bubblewrap or no prepared core profile.
import test from "node:test";
import assert from "node:assert/strict";
import { accessSync, constants, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildLeanSandboxCommand,
  elanToolchainDirName,
  resolveLeanSandbox,
  resolveLeanToolchain,
} from "./leanSandbox.mjs";
import { loadLeanConfig } from "./leanConfig.mjs";
import { runBoundedProcess } from "./leanProcess.mjs";

const HERE = resolve(fileURLToPath(import.meta.url), "..");
const REPO_ROOT = resolve(HERE, "..", "..", "..");
const RUNTIME_ROOT = resolve(REPO_ROOT, "lean-runtime");

function testConfig(overrides = {}) {
  return loadLeanConfig(
    {},
    { enabled: true, runtimeRoot: RUNTIME_ROOT, runsRoot: tmpdir(), ...overrides }
  );
}

/** The real sandbox tests need bwrap, prlimit and a built core profile. */
function sandboxReady(config) {
  for (const bin of [config.bwrapBin, config.prlimitBin]) {
    try {
      accessSync(bin, constants.X_OK);
    } catch {
      return `missing ${bin}`;
    }
  }
  const core = resolve(RUNTIME_ROOT, "core");
  if (!existsSync(resolve(core, ".lake", "build", "lib", "lean"))) {
    return "core profile not built — run scripts/lean-prepare-runtime.sh --profile core";
  }
  const tc = resolveLeanToolchain(core, config);
  return tc.ok ? null : tc.reason;
}

/** Run one Lean source through the real sandbox. */
async function runInSandbox(source, config, extraEnv = {}) {
  const runDir = mkdtempSync(resolve(tmpdir(), "ds4-lean-sbx-"));
  try {
    writeFileSync(resolve(runDir, "Main.lean"), source, { mode: 0o600 });
    const profileDir = resolve(RUNTIME_ROOT, "core");
    const cmd = buildLeanSandboxCommand({
      config,
      profileDir,
      runDir,
      toolchain: resolveLeanToolchain(profileDir, config),
    });
    return await runBoundedProcess({
      command: cmd.command,
      args: cmd.args,
      cwd: cmd.cwd,
      env: { ...cmd.env, ...extraEnv },
      timeoutMs: 120_000,
      stdoutLimit: 64 * 1024,
      stderrLimit: 128 * 1024,
    });
  } finally {
    rmSync(runDir, { recursive: true, force: true });
  }
}

// --------------------------------------------------------------------------
// Command construction
// --------------------------------------------------------------------------

test("elanToolchainDirName maps a descriptor to the elan directory", () => {
  assert.equal(
    elanToolchainDirName("leanprover/lean4:v4.32.2\n"),
    "leanprover--lean4---v4.32.2"
  );
});

test("resolveLeanToolchain reports a placeholder toolchain", () => {
  const dir = mkdtempSync(resolve(tmpdir(), "ds4-lean-tc-"));
  try {
    writeFileSync(resolve(dir, "lean-toolchain"), "leanprover/lean4:vX.Y.Z\n");
    const r = resolveLeanToolchain(dir, testConfig());
    assert.equal(r.ok, false);
    assert.equal(r.error, "LEAN_RUNTIME_NOT_PREPARED");
    assert.match(r.reason, /placeholder/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("resolveLeanSandbox fails closed when bwrap is missing", async () => {
  const config = testConfig({ bwrapBin: "/nonexistent/bwrap" });
  const r = await resolveLeanSandbox(config, "core");
  assert.equal(r.ok, false);
  assert.equal(r.error, "LEAN_SANDBOX_UNAVAILABLE");
});

test("buildLeanSandboxCommand runs prlimit inside bwrap, not around it", () => {
  const config = testConfig();
  const cmd = buildLeanSandboxCommand({
    config,
    profileDir: "/runtime/core",
    runDir: "/runs/abc",
    toolchain: { dir: "/toolchains/lean", descriptor: "leanprover/lean4:v4.32.2" },
  });

  assert.equal(cmd.command, config.bwrapBin);

  // Everything before the first "--" belongs to bwrap; prlimit comes after it.
  const firstSep = cmd.args.indexOf("--");
  const bwrapFlags = cmd.args.slice(0, firstSep);
  assert.ok(bwrapFlags.includes("--unshare-net"), "bwrap must get --unshare-net");
  assert.ok(bwrapFlags.includes("--clearenv"), "bwrap must start from an empty env");
  assert.equal(cmd.args[firstSep + 1], config.prlimitBin);

  // RLIMIT_NPROC must not be imposed on the process that creates the namespace.
  assert.ok(!bwrapFlags.some((a) => a.startsWith("--nproc")));

  // No shell, and the source is referenced by its in-sandbox path only.
  assert.ok(!cmd.args.includes("sh"));
  assert.ok(!cmd.args.some((a) => a.includes("/runs/abc/Main.lean")));
  assert.ok(cmd.args.includes("/work/Main.lean"));
});

test("buildLeanSandboxCommand keeps the address-space backstop above the heap cap", () => {
  const config = testConfig();
  assert.ok(config.addressSpaceBytes > config.memoryBytes);
  const cmd = buildLeanSandboxCommand({
    config,
    profileDir: "/runtime/core",
    runDir: "/runs/abc",
    toolchain: { dir: "/toolchains/lean", descriptor: "leanprover/lean4:v4.32.2" },
  });
  assert.ok(cmd.args.includes(`--as=${config.addressSpaceBytes}`));
  assert.ok(cmd.args.includes(`--memory=${Math.floor(config.memoryBytes / 1048576)}`));
});

test("buildLeanSandboxCommand refuses to build without a toolchain", () => {
  assert.throws(
    () => buildLeanSandboxCommand({ config: testConfig(), profileDir: "/a", runDir: "/b" }),
    /resolved toolchain/
  );
});

// --------------------------------------------------------------------------
// Real execution — these are the tests that make the sandbox a sandbox
// --------------------------------------------------------------------------

const CONFIG = testConfig();
// node:test skips whenever the `skip` key is present, truthy or not, so the
// option has to be absent entirely when the sandbox is usable.
const REASON = sandboxReady(CONFIG);
const SKIP = REASON ? { skip: REASON } : {};

test("sandbox elaborates a valid theorem", SKIP, async () => {
  const r = await runInSandbox("theorem t : 1 + 1 = 2 := by decide\n", CONFIG);
  assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
  assert.equal(r.timedOut, false);
});

test("sandbox reports a type error without succeeding", SKIP, async () => {
  const r = await runInSandbox("theorem t : 1 = 2 := by rfl\n", CONFIG);
  assert.notEqual(r.exitCode, 0);
  assert.match(r.stdout + r.stderr, /error/i);
});

test("sandbox cannot read a host file outside the run directory", SKIP, async () => {
  const secret = resolve(tmpdir(), "ds4-lean-sentinel");
  writeFileSync(secret, "SECRET_SENTINEL", { mode: 0o600 });
  try {
    const r = await runInSandbox(
      `#eval (do
  let s ← IO.FS.readFile ${JSON.stringify(secret)} <|> pure "UNREADABLE"
  IO.println s : IO Unit)\n`,
      CONFIG
    );
    const out = r.stdout + r.stderr;
    assert.ok(!out.includes("SECRET_SENTINEL"), `sentinel leaked: ${out}`);
  } finally {
    rmSync(secret, { force: true });
  }
});

test("sandbox cannot read the repository", SKIP, async () => {
  const target = resolve(REPO_ROOT, "ds4_agent.c");
  const r = await runInSandbox(
    `#eval (do
  let s ← IO.FS.readFile ${JSON.stringify(target)} <|> pure "UNREADABLE"
  IO.println (s.take 20) : IO Unit)\n`,
    CONFIG
  );
  assert.match(r.stdout, /UNREADABLE/);
});

test("sandbox does not forward the server environment", SKIP, async () => {
  const r = await runInSandbox(
    `#eval (do
  let e ← IO.getEnv "DS4_TEST_SECRET"
  IO.println ("ENV=" ++ toString e) : IO Unit)\n`,
    CONFIG,
    { DS4_TEST_SECRET: "SECRET_ENV_SENTINEL" }
  );
  const out = r.stdout + r.stderr;
  assert.ok(!out.includes("SECRET_ENV_SENTINEL"), `env leaked: ${out}`);
  assert.match(r.stdout, /ENV=none/);
});

test("sandbox has no network", SKIP, async () => {
  const r = await runInSandbox(
    `#eval (do
  let o ← IO.Process.output { cmd := "curl", args := #["-sS", "--max-time", "5", "https://example.com"] }
  IO.println ("OUT=" ++ o.stdout ++ " ERR=" ++ o.stderr) : IO Unit)\n`,
    CONFIG
  );
  assert.match(
    r.stdout + r.stderr,
    /Could not resolve host|Couldn't resolve|Network is unreachable|No such file/i
  );
});

test("sandbox cannot write into the read-only runtime profile", SKIP, async () => {
  const r = await runInSandbox(
    `#eval (do
  IO.FS.writeFile "/lean-project/pwned.txt" "x" <|> IO.println "WRITE_BLOCKED" : IO Unit)\n`,
    CONFIG
  );
  assert.match(r.stdout + r.stderr, /WRITE_BLOCKED/);
  assert.ok(!existsSync(resolve(RUNTIME_ROOT, "core", "pwned.txt")));
});

test("sandbox does not execute a Lean main", SKIP, async () => {
  const r = await runInSandbox(`def main : IO Unit := IO.println "SHOULD_NOT_RUN"\n`, CONFIG);
  assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
  assert.ok(!(r.stdout + r.stderr).includes("SHOULD_NOT_RUN"));
});
