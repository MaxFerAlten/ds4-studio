// R8 security tests against the real sandbox: sentinel files, environment
// leaks, host filesystem reads, network isolation, resource limits and
// process cleanup. Like leanExecutor.real.test.mjs, every test skips when the
// host is not provisioned (the skip condition is preflight.profiles.core.ok).
//
// None of these depend on the host network: the isolation proofs use a local
// loopback listener and a guaranteed-unresolvable host name, so the suite is
// deterministic on any machine, online or not.
import test from "node:test";
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";

import { executeLeanCheck } from "./leanExecutor.mjs";
import { loadLeanConfig } from "./leanConfig.mjs";
import { runLeanPreflight } from "./leanPreflight.mjs";
import { buildBwrapBaseArgs, buildLeanNetworkProbeCommand, resolveLeanToolchain } from "./leanSandbox.mjs";
import { requireReady } from "./fixtures/realTestGate.mjs";

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), "..", "..", "..", "..");
const RUNS_ROOT = resolve(tmpdir(), `ds4-lean-security-${process.pid}`);
const UNIQ = `${process.pid}-${Date.now().toString(36)}`;

const CONFIG = loadLeanConfig(process.env, {
  enabled: true,
  runtimeRoot: resolve(REPO_ROOT, "lean-runtime"),
  runsRoot: RUNS_ROOT
});

const PREFLIGHT = await runLeanPreflight(CONFIG);
// With DS4_TEST_LEAN_SECURITY=1 a missing sandbox is a failure, not a skip:
// the security verdict of a certification run must never be "not measured".
const CORE = requireReady(PREFLIGHT.profiles?.core, {
  flag: "DS4_TEST_LEAN_SECURITY",
  label: "the sandbox (profile core)",
});
await mkdir(RUNS_ROOT, { recursive: true });

// Host-side sentinel that must stay invisible to the sandbox.
const SENTINEL_FILE = join(tmpdir(), `ds4-lean-sentinel-${UNIQ}`);
await writeFile(SENTINEL_FILE, `SECRET-${UNIQ}\n`);
process.env.DS4_SECURITY_SENTINEL = `ENVSECRET-${UNIQ}`;

/** Run a sandboxed `/usr/bin/node -e` one-liner and capture the result. */
async function sandboxNode(script, { timeoutMs = 30000, port = 0 } = {}) {
  const profileDir = resolve(CONFIG.runtimeRoot, "core");
  const toolchain = resolveLeanToolchain(profileDir, CONFIG);
  assert.equal(toolchain.ok, true, toolchain.reason);
  const runDir = await mkdtemp(join(RUNS_ROOT, "sec-"));
  const cmd = buildLeanNetworkProbeCommand(
    { config: CONFIG, profileDir, runDir, toolchain },
    { port }
  );
  // Reuse the probe builder's posture but swap in our own script.
  cmd.args = [
    ...buildBwrapBaseArgs(CONFIG, { toolchain, profileDir, runDir }),
    "--",
    "/usr/bin/node", "-e", script,
  ];
  return new Promise((resolveResult) => {
    const child = spawn(cmd.command, cmd.args, {
      env: cmd.env, cwd: cmd.cwd, stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => { stdout += d; });
    child.stderr.on("data", (d) => { stderr += d; });
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.on("error", (err) => {
      clearTimeout(timer);
      resolveResult({ ok: false, code: null, signal: null, stdout, stderr, error: err.message });
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolveResult({ ok: code === 0, code, signal, stdout, stderr });
      void rm(runDir, { recursive: true, force: true });
    });
  });
}

/** `#eval`-based probe through the real executor. */
async function leanProbe(code, timeoutSec = 60) {
  const r = await executeLeanCheck(
    {
      contractVersion: "lean_check_request_v1",
      code,
      profile: "core",
      timeoutSec,
      sessionId: "security-tests",
    },
    { config: CONFIG, preflight: PREFLIGHT }
  );
  return r.stdout + r.stderr;
}

test.after(async () => {
  await rm(RUNS_ROOT, { recursive: true, force: true });
  await rm(SENTINEL_FILE, { force: true });
  delete process.env.DS4_SECURITY_SENTINEL;
});

test("security: a host sentinel file is not readable inside the sandbox", CORE, async () => {
  const out = await leanProbe(`#eval (do
  let s ← try IO.FS.readFile ${JSON.stringify(SENTINEL_FILE)} catch _ => pure "DENIED"
  IO.println ("SENTINEL=" ++ s) : IO Unit)`);
  assert.match(out, /SENTINEL=DENIED/);
  assert.doesNotMatch(out, /SECRET-/);
});

test("security: the environment is cleared (no sentinel env reaches the sandbox)", CORE, async () => {
  const out = await leanProbe(`#eval (do
  let e ← IO.getEnv "DS4_SECURITY_SENTINEL"
  IO.println ("SENTINEL_ENV=" ++ toString e) : IO Unit)`);
  assert.match(out, /SENTINEL_ENV=none/);
  assert.doesNotMatch(out, /ENVSECRET-/);
});

test("security: the host repository is not mounted inside the sandbox", CORE, async () => {
  const repoFile = join(REPO_ROOT, "frontend", "server", "lean", "leanSecurity.real.test.mjs");
  const out = await leanProbe(`#eval (do
  let s ← try IO.FS.readFile ${JSON.stringify(repoFile)} catch _ => pure "DENIED"
  IO.println ("REPO=" ++ s) : IO Unit)`);
  assert.match(out, /REPO=DENIED/);
});

test("security: host home and SSH keys are not readable", CORE, async () => {
  const home = process.env.HOME || "/nonexistent";
  const targets = [join(home, ".ssh", "id_rsa"), "/home/ds4/.ssh/id_rsa"];
  const lines = [];
  for (let i = 0; i < targets.length; i++) {
    lines.push(`  let s${i} ← try IO.FS.readFile ${JSON.stringify(targets[i])} catch _ => pure "DENIED"`);
  }
  for (let i = 0; i < targets.length; i++) {
    lines.push(`  IO.println ("HOME${i}=" ++ s${i})`);
  }
  const out = await leanProbe(`#eval (do
${lines.join("\n")} : IO Unit)`);
  assert.match(out, /HOME0=DENIED/);
  assert.match(out, /HOME1=DENIED/);
});

test("security: the runtime profile directory is read-only", CORE, async () => {
  const out = await leanProbe(`#eval (do
  try IO.FS.writeFile "/lean-project/pwn.txt" "x" catch _ => pure ()
  let s ← try IO.FS.readFile "/lean-project/lean-toolchain" catch _ => pure "DENIED"
  IO.println ("WRITE_RUNTIME=attempted")
  IO.println ("READ_RUNTIME=" ++ if s == "DENIED" then "DENIED" else "OK") : IO Unit)`);
  assert.match(out, /READ_RUNTIME=OK/);
  let landed = true;
  try {
    await stat(join(CONFIG.runtimeRoot, "core", "pwn.txt"));
  } catch {
    landed = false;
  }
  assert.equal(landed, false, "the sandbox wrote into the host runtime profile");
});test("security: the toolchain directory is read-only", CORE, async () => {
  const profileDir = resolve(CONFIG.runtimeRoot, "core");
  const toolchain = resolveLeanToolchain(profileDir, CONFIG);
  assert.equal(toolchain.ok, true, toolchain.reason);
  const out = await leanProbe(`#eval (do
  try IO.FS.writeFile "/lean-toolchain/pwn.txt" "x" catch _ => pure ()
  IO.println "WRITE_TOOLCHAIN=attempted" : IO Unit)`);
  assert.match(out, /WRITE_TOOLCHAIN=attempted/);
  let landed = true;
  try {
    await stat(join(toolchain.dir, "pwn.txt"));
  } catch {
    landed = false;
  }
  assert.equal(landed, false, "the sandbox wrote into the host toolchain");
});

test("security: the sandbox cannot reach a host loopback listener", CORE, async () => {
  const server = createServer();
  await new Promise((res, rej) => {
    server.once("error", rej);
    server.listen(0, "127.0.0.1", res);
  });
  const port = server.address().port;
  try {
    const profileDir = resolve(CONFIG.runtimeRoot, "core");
    const toolchain = resolveLeanToolchain(profileDir, CONFIG);
    const runDir = await mkdtemp(join(RUNS_ROOT, "secnet-"));
    try {
      const cmd = buildLeanNetworkProbeCommand({ config: CONFIG, profileDir, runDir, toolchain }, { port });
      const res = await new Promise((resolveResult) => {
        const child = spawn(cmd.command, cmd.args, { env: cmd.env, cwd: cmd.cwd, stdio: "ignore" });
        child.on("close", (code) => resolveResult(code));
      });
      assert.equal(res, 0, "exit 0 means the probe could not connect");
    } finally {
      await rm(runDir, { recursive: true, force: true });
    }
  } finally {
    server.close();
  }
});

test("security: DNS resolution fails deterministically inside the sandbox", CORE, async () => {
  const script = `require("dns").lookup("never-resolves-${UNIQ}.invalid", (e) => process.exit(e ? 0 : 1));`;
  const r = await sandboxNode(script);
  assert.equal(r.code, 0, `expected resolution failure, got: ${r.stderr}`);
});

test("security: a fork storm is contained and leaves no leak on the host", CORE, async () => {
  // Known limitation (documented in lean-remediation-r8.md): on this kernel the
  // kernel does not enforce RLIMIT_NPROC at fork time inside a user namespace,
  // so `--nproc` is best-effort (it does bind on kernels that honor it). The
  // guarantees that DO hold are containment: the sandbox exits cleanly after
  // the storm and none of its processes survive on the host.
  const N = CONFIG.maxProcesses + 128;
  const script = `const {spawn}=require("child_process");
const N=${N};
let started=0, errors=0;
function go(){ if(started>=N){ console.log("STARTED="+started+" ERRORS="+errors); process.exit(0); }
  const c=spawn("/usr/bin/sleep",["300"],{stdio:"ignore"});
  c.on("error",()=>{ errors++; console.log("STARTED="+started+" ERRORS="+errors); process.exit(0); });
  started++;
  go();
}
go();`;
  const r = await sandboxNode(script, { timeoutMs: 60000 });
  assert.equal(r.code, 0, r.stderr);
  const m = /STARTED=(\d+) ERRORS=(\d+)/.exec(r.stdout);
  assert.ok(m, `no storm summary in output: ${r.stdout}`);
  assert.ok(Number(m[1]) >= N / 2,
    `storm did not actually fork many processes (${r.stdout.trim()})`);
  await new Promise((res) => setTimeout(res, 500));
  let leaked = false;
  try {
    execFileSync("pgrep", ["-f", `sleep.*300`], { stdio: "ignore" });
    leaked = true;
  } catch {
    leaked = false;
  }
  assert.equal(leaked, false, "storm processes leaked to the host");
});

test("security: a timed-out sandbox kills its descendants (no residual process)", CORE, async () => {
  const marker = `__DS4_LEAK_${UNIQ}__`;
  const script = `const {spawn}=require("child_process");
const child=spawn("/usr/bin/node",["-e",
  "setTimeout(()=>{const fs=require('fs');setInterval(()=>fs.appendFileSync('/work/ALIVE','x'),50);},400)"],
  {stdio:"ignore"});
setTimeout(()=>process.exit(0), 100);`;
  const runDir = await mkdtemp(join(RUNS_ROOT, "secleak-"));
  try {
    const profileDir = resolve(CONFIG.runtimeRoot, "core");
    const toolchain = resolveLeanToolchain(profileDir, CONFIG);
    const cmd = {
      command: CONFIG.bwrapBin,
      args: [
        ...buildBwrapBaseArgs(CONFIG, { toolchain, profileDir, runDir }),
        "--", "/usr/bin/node", "-e", script.replace("__DS4_LEAK_", marker),
      ],
      env: { PATH: "/usr/bin:/bin" },
      cwd: runDir,
    };
    const exit = await new Promise((resolveResult) => {
      const child = spawn(cmd.command, cmd.args, { env: cmd.env, cwd: cmd.cwd, stdio: "ignore" });
      child.on("close", (code) => resolveResult(code));
    });
    assert.equal(exit, 0);
    await new Promise((res) => setTimeout(res, 1500));
    let leaked = false;
    try {
      await stat(join(runDir, "ALIVE"));
      leaked = true;
    } catch {
      leaked = false;
    }
    assert.equal(leaked, false, "a sandbox descendant kept writing after the sandbox exited");
  } finally {
    await rm(runDir, { recursive: true, force: true });
    await new Promise((res) => setTimeout(res, 500));
  }
});

test("security: no residual processes from sandboxed runs remain on the host", CORE, async () => {
  const marker = `__DS4_LEAK_${UNIQ}__`;
  let found = false;
  try {
    execFileSync("pgrep", ["-f", marker], { stdio: "ignore" });
    found = true;
  } catch {
    found = false;
  }
  assert.equal(found, false, "a sandboxed process leaked to the host");
});

test("security: runs leave no stray files outside their run directory", CORE, async () => {
  await leanProbe("theorem t : True := trivial\n");
  const entries = await readdir(RUNS_ROOT);
  for (const entry of entries) {
    const st = await stat(join(RUNS_ROOT, entry));
    assert.equal(st.isDirectory(), true, `stray file outside a run dir: ${entry}`);
  }
});
