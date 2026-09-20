// Lean 4 preflight checker for ds4-studio
// Verifies that the runtime environment is ready before accepting requests.
//
// R8 levels (strict progression, "ready" is the only green):
//   configured -> installed -> prepared -> sandbox-capable -> smoke-checked -> ready
// Each level is a set of checks; a profile stops at the first failing level.

import { existsSync, lstatSync, readFileSync, realpathSync } from "fs";
import { access, constants as fsConstants, mkdir, readFile, rm, writeFile } from "fs/promises";
import { spawn } from "child_process";
import { createServer } from "net";
import { basename, dirname, resolve } from "path";

import {
  resolveLeanToolchain,
  buildLeanSandboxCommand,
  buildLeanNetworkProbeCommand,
} from "./leanSandbox.mjs";
import {
  FORBIDDEN_PIN,
  readLeanRuntimeMetadata,
  verifyLeanRuntimeMetadata,
  smokeSourceForProfile,
} from "./leanMetadata.mjs";

export const PREFLIGHT_LEVELS = [
  "configured",
  "installed",
  "prepared",
  "sandbox-capable",
  "smoke-checked",
  "ready",
];

export const USERNS_PROBE_TIMEOUT_MS = 5000;

// Minimal bwrap invocation that fails fast (nonzero exit) when user namespaces
// are unavailable. Binds only read-only system paths plus /proc and /dev; the
// sandbox does not need any project data to prove unshare works.
export const USERNS_PROBE_ARGS = [
  "--unshare-user",
  "--unshare-pid",
  "--proc", "/proc",
  "--dev", "/dev",
  "--ro-bind", "/usr", "/usr",
  "--ro-bind", "/bin", "/bin",
  "--ro-bind", "/lib", "/lib",
  "--ro-bind", "/lib64", "/lib64",
  "--", "/usr/bin/true"
];

/**
 * Probe whether bwrap can create user namespaces on this host.
 *
 * bwrap's own argv parsing runs before any mount syscalls, so a missing
 * `--unshare-user` support shows up as a nonzero exit (or a spawn error when
 * the binary itself is absent). Returns true only for exit code 0.
 *
 * @param {object} [deps]
 * @param {string} [deps.bwrapBin]
 * @param {number} [deps.timeoutMs]
 * @param {Function} [deps.spawnFn]
 * @returns {Promise<boolean>}
 */
export async function probeUserNamespaces({
  bwrapBin = "/usr/bin/bwrap",
  timeoutMs = USERNS_PROBE_TIMEOUT_MS,
  spawnFn = spawn
} = {}) {
  return new Promise((resolveResult) => {
    let child;
    try {
      child = spawnFn(bwrapBin, USERNS_PROBE_ARGS, { stdio: "ignore" });
    } catch {
      resolveResult(false);
      return;
    }
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
    }, timeoutMs);
    child.on("error", () => {
      clearTimeout(timer);
      resolveResult(false);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolveResult(code === 0);
    });
  });
}

const levelIndex = (level) => PREFLIGHT_LEVELS.indexOf(level);

// Deep checks (userns probe, smoke, network probe) are memoized per
// (runtime root, profile) for the process lifetime: they probe host
// capabilities that do not change at runtime, and the smoke is too expensive
// to run on every request (the mathlib smoke alone takes minutes). The cheap
// per-call checks (metadata validity, manifest checksum, toolchain, build
// cache, roots, bwrap/prlimit presence) run every time; the first failing
// cheap check invalidates the memo entry so a drift re-runs the deep checks.
const deepMemo = new Map();
const deepMemoKey = (config, profile) => `${config.runtimeRoot}::${profile}`;

async function isExecutable(bin) {
  if (!bin) return false;
  try {
    await access(bin, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check a path is a real directory (not a symlink) that is writable or, when
 * missing, can be created under a writable, non-symlink ancestor.
 *
 * @param {string} root - Absolute path (runtime root or runs root)
 * @param {string} label - "Runtime root" | "Runs root"
 * @returns {{ ok: boolean, reason: string|null, warning?: string }}
 */
async function checkRootDir(root, label) {
  if (!root) return { ok: false, reason: `${label} not configured (DS4_LEAN_RUNTIME_ROOT / DS4_LEAN_RUNS_ROOT).` };
  let st;
  try {
    st = lstatSync(root);
  } catch {
    // Missing: acceptable when the nearest existing ancestor is a writable,
    // non-symlink directory (the runs root is created lazily on first run).
    let ancestor = root;
    for (;;) {
      const parent = dirname(ancestor);
      if (parent === ancestor) break;
      try {
        st = lstatSync(parent);
        ancestor = parent;
        break;
      } catch {
        ancestor = parent;
      }
    }
    if (st === null || !st) return { ok: false, reason: `${label} ${root} has no existing ancestor.` };
    if (st.isSymbolicLink()) return { ok: false, reason: `${label} ${root} would be created through a symlink (${ancestor}).` };
    try {
      await access(ancestor, fsConstants.W_OK | fsConstants.X_OK);
    } catch {
      return { ok: false, reason: `${label} parent ${ancestor} is not writable.` };
    }
    return { ok: true, reason: null, warning: `${label} ${root} does not exist yet; it will be created on first use.` };
  }
  if (st.isSymbolicLink()) return { ok: false, reason: `${label} ${root} must not be a symlink.` };
  try {
    await access(root, fsConstants.W_OK | fsConstants.X_OK);
  } catch {
    return { ok: false, reason: `${label} ${root} is not writable.` };
  }
  let real;
  try {
    real = realpathSync(root);
  } catch {
    return { ok: false, reason: `${label} ${root} cannot be resolved to a canonical path.` };
  }
  if (real !== resolve(root)) {
    return { ok: false, reason: `${label} ${root} is not canonical (resolves to ${real}).` };
  }
  return { ok: true, reason: null };
}

/**
 * Spawn a sandbox command and wait for it to finish, bounding its lifetime.
 *
 * @returns {Promise<{ ok: boolean, code: number|null, signal?: string, error?: string }>}
 */
function runSandboxCommand(cmd, { timeoutMs, spawnFn = spawn }) {
  return new Promise((resolveResult) => {
    let child;
    try {
      child = spawnFn(cmd.command, cmd.args, { env: cmd.env, cwd: cmd.cwd, stdio: "ignore", timeout: timeoutMs });
    } catch (err) {
      resolveResult({ ok: false, code: null, error: err.message });
      return;
    }
    child.on("error", (err) => {
      resolveResult({ ok: false, code: null, error: err.message });
    });
    child.on("close", (code, signal) => {
      if (code === 0) resolveResult({ ok: true, code });
      else if (signal) resolveResult({ ok: false, code, signal, error: `exited with signal ${signal}` });
      else resolveResult({ ok: false, code, error: `exited with code ${code}` });
    });
  });
}

/**
 * Elaborate the profile's smoke theorem through the same command the executor
 * uses (buildLeanSandboxCommand), in a throwaway run dir.
 */
async function runSmoke(config, toolchain, profileDir, deps) {
  const profile = basename(profileDir);
  const smokeFile = smokeSourceForProfile(profile);
  if (!smokeFile) return { ok: false, error: `no smoke source known for profile ${profile}` };
  const src = resolve(profileDir, smokeFile);
  if (!existsSync(src)) return { ok: false, error: `smoke source ${src} is missing` };
  const runDir = resolve(config.runsRoot, `.preflight-${profile}-${process.pid}-${Date.now()}`);
  try {
    await mkdir(runDir, { recursive: true, mode: 0o700 });
    await writeFile(resolve(runDir, "Main.lean"), await readFile(src));
    const cmd = buildLeanSandboxCommand({ config, profileDir, runDir, toolchain });
    const res = await runSandboxCommand(cmd, {
      timeoutMs: deps.smokeTimeoutMs ?? config.smokeTimeoutMs ?? 600000,
      spawnFn: deps.spawnFn ?? spawn,
    });
    if (res.ok) return { ok: true };
    return { ok: false, error: `smoke theorem failed in the sandbox (${res.error ?? "unknown error"})` };
  } catch (err) {
    return { ok: false, error: `smoke could not run: ${err.message}` };
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
}

/**
 * Prove --unshare-net actually isolates the sandbox from the host network.
 *
 * A listener is opened on the host; a sandboxed probe must be unable to reach
 * it (exit 0 = isolated, exit 1 = connected to the host, anything else = probe
 * failure). This is a loopback test, so it needs no external network.
 */
async function checkNetworkIsolation(config, toolchain, profileDir, deps) {
  const server = createServer();
  let port;
  try {
    await new Promise((res, rej) => {
      server.once("error", rej);
      server.listen(0, "127.0.0.1", res);
    });
    port = server.address().port;
  } catch (err) {
    return { ok: false, reason: `cannot open probe listener: ${err.message}` };
  }
  const profile = basename(profileDir);
  const runDir = resolve(config.runsRoot, `.preflight-net-${profile}-${process.pid}-${Date.now()}`);
  try {
    await mkdir(runDir, { recursive: true, mode: 0o700 });
    const cmd = buildLeanNetworkProbeCommand({ config, profileDir, runDir, toolchain }, { port });
    const res = await runSandboxCommand(cmd, {
      timeoutMs: deps.netProbeTimeoutMs ?? 10000,
      spawnFn: deps.spawnFn ?? spawn,
    });
    if (res.ok) return { ok: true, reason: null };
    if (res.code === 1) return { ok: false, reason: "sandbox reached the host network (not isolated)" };
    return { ok: false, reason: `network probe failed in the sandbox (${res.error ?? "unknown"})` };
  } catch (err) {
    return { ok: false, reason: `network probe could not run: ${err.message}` };
  } finally {
    await rm(runDir, { recursive: true, force: true });
    server.close();
  }
}

/**
 * Deep, expensive per-profile checks: proving user namespaces actually work,
 * elaborating the smoke theorem through the real sandbox command, and proving
 * the sandbox cannot reach the host network. These are memoized per process.
 *
 * @returns {Promise<{
 *   ok: boolean, level: string, reason: string|null,
 *   checks: Record<string, { ok: boolean, reason: string|null }>
 * }>}
 */
async function runDeepChecks(config, toolchain, profileDir, deps) {
  const checks = {};
  const setCheck = (name, ok, reason = null) => { checks[name] = { ok, reason }; };
  const result = { ok: false, level: "prepared", reason: null, checks };

  // --- sandbox-capable ---
  const userns = await (deps.probeUserNamespaces ?? probeUserNamespaces)({
    bwrapBin: deps.bwrapBin || config.bwrapBin,
  });
  setCheck("user-namespaces", userns, "bwrap cannot create user namespaces on this host");
  if (!userns) { result.reason = checks["user-namespaces"].reason; return result; }
  result.level = "sandbox-capable";

  // --- smoke-checked ---
  const smoke = await runSmoke(config, toolchain, profileDir, deps);
  setCheck("smoke", smoke.ok, smoke.error);
  if (!smoke.ok) { result.reason = smoke.error; return result; }
  result.level = "smoke-checked";

  // --- ready ---
  const net = await checkNetworkIsolation(config, toolchain, profileDir, deps);
  setCheck("no-network", net.ok, net.reason);
  if (!net.ok) {
    result.reason = net.reason;
    return result;
  }
  result.level = "ready";
  result.ok = true;
  return result;
}

/**
 * Run preflight checks for a Lean profile directory, returning the highest
 * level reached.
 *
 * @param {string} profileDir - Absolute path to the profile directory
 * @param {object} config - Lean configuration
 * @param {object} deps - Dependency overrides for testing
 * @returns {Promise<{
 *   ok: boolean, level: string, toolchain: string|null, reason: string|null,
 *   checks: Record<string, { ok: boolean, reason: string|null }>
 * }>}
 */
async function checkProfile(profileDir, config, deps) {
  const checks = {};
  const setCheck = (name, ok, reason = null) => { checks[name] = { ok, reason }; };
  const failingReason = (names) => {
    for (const n of names) if (checks[n] && checks[n].ok === false) return checks[n].reason;
    return null;
  };
  const result = { ok: false, level: "configured", toolchain: null, reason: null, checks };
  const profile = basename(profileDir);

  // --- configured ---
  setCheck("profileDir", existsSync(profileDir), `Directory not found: ${profileDir}`);
  if (!checks.profileDir.ok) { result.reason = checks.profileDir.reason; return result; }

  const tcPath = resolve(profileDir, "lean-toolchain");
  setCheck("lean-toolchain", existsSync(tcPath), `Missing lean-toolchain in ${profileDir}`);
  if (checks["lean-toolchain"].ok) {
    let readable = true;
    try {
      await access(tcPath, fsConstants.R_OK);
    } catch {
      readable = false;
    }
    setCheck("lean-toolchain-readable", readable, `Cannot read ${tcPath}`);
    if (readable) {
      const descriptor = readFileSync(tcPath, "utf8").trim();
      setCheck("toolchain-pinned", Boolean(descriptor) && !FORBIDDEN_PIN.test(descriptor),
        `lean-toolchain '${descriptor}' is empty or not pinned`);
    }
  }
  setCheck("lakefile", existsSync(resolve(profileDir, "lakefile.toml")), `Missing lakefile.toml in ${profileDir}`);
  const configuredOk = ["profileDir", "lean-toolchain", "lean-toolchain-readable", "toolchain-pinned", "lakefile"]
    .every((n) => checks[n].ok !== false);
  if (!configuredOk) {
    result.reason = failingReason(["profileDir", "lean-toolchain", "lean-toolchain-readable", "toolchain-pinned", "lakefile"]);
    return result;
  }
  result.level = "configured";

  // --- installed ---
  const toolchain = resolveLeanToolchain(profileDir, config);
  setCheck("toolchain-resolved", toolchain.ok, toolchain.reason);
  if (!toolchain.ok) { result.reason = toolchain.reason; return result; }
  result.toolchain = toolchain.descriptor;
  const leanBin = resolve(toolchain.dir, "bin", "lean");
  const leanExec = await isExecutable(leanBin);
  setCheck("lean-executable", leanExec, `${leanBin} is not executable`);
  if (!leanExec) { result.reason = `${leanBin} is not executable`; return result; }
  result.level = "installed";

  // --- prepared ---
  setCheck("lake-manifest", existsSync(resolve(profileDir, "lake-manifest.json")),
    `Missing lake-manifest.json in ${profileDir}. Run scripts/lean-prepare-runtime.sh.`);
  setCheck("build-cache", existsSync(resolve(profileDir, ".lake", "build", "lib", "lean")),
    `Missing .lake/build in ${profileDir}. Run scripts/lean-prepare-runtime.sh.`);
  const meta = await readLeanRuntimeMetadata(config, profile);
  setCheck("metadata", meta.ok, meta.error || `runtime.metadata.json invalid in ${profileDir}`);
  if (["lake-manifest", "build-cache", "metadata"].some((n) => checks[n].ok === false)) {
    result.reason = failingReason(["lake-manifest", "build-cache", "metadata"]);
    return result;
  }
  const verify = await verifyLeanRuntimeMetadata(config, profile);
  setCheck("manifest-checksum", verify.ok,
    verify.ok ? null : `pinned file hash mismatch: ${verify.mismatches?.map((m) => m.file).join(", ") || "unknown"}`);
  if (!verify.ok) { result.reason = checks["manifest-checksum"].reason; return result; }
  result.level = "prepared";

  // Cheap sandbox gate: the tools must exist for sandbox-capable to be
  // reachable, and their presence can change at runtime, so this stays on the
  // per-request path (the userns probe itself is deep).
  const bwrapExec = await isExecutable(deps.bwrapBin || config.bwrapBin);
  const prlimitExec = await isExecutable(deps.prlimitBin || config.prlimitBin);
  setCheck("bwrap", bwrapExec, `${deps.bwrapBin || config.bwrapBin} is not executable`);
  setCheck("prlimit", prlimitExec, `${deps.prlimitBin || config.prlimitBin} is not executable`);
  if (!bwrapExec || !prlimitExec) {
    result.reason = failingReason(["bwrap", "prlimit"]);
    return result;
  }

  // Runs root must be usable before a smoke run exists; also cheap.
  const runs = await checkRootDir(config.runsRoot, "Runs root");
  setCheck("runs-root", runs.ok, runs.reason);
  if (!runs.ok) { result.reason = runs.reason; return result; }

  // --- deep tail (memoized per process) ---
  const key = deepMemoKey(config, profile);
  const memo = deps.deepMemo ?? deepMemo;
  let tail = memo.get(key);
  if (tail === undefined) {
    tail = await runDeepChecks(config, toolchain, profileDir, deps);
    memo.set(key, tail);
  }
  if (tail.checks) {
    for (const [name, check] of Object.entries(tail.checks)) checks[name] = check;
  }
  result.level = tail.level;
  result.ok = tail.ok;
  result.reason = tail.reason;
  return result;
}

/**
 * Run full Lean preflight.
 *
 * @param {object} config - Loaded Lean configuration from loadLeanConfig()
 * @param {object} deps - Dependency overrides for testing
 * @returns {{
 *   ok: boolean, enabled: boolean, ready: boolean, sandboxAvailable: boolean,
 *   levels: Record<string, boolean>, profiles: object, errors: string[],
 *   warnings: string[]
 * }}
 */
export async function runLeanPreflight(config, deps = {}) {
  const errors = [];
  const warnings = [];
  const levels = {};
  for (const lv of PREFLIGHT_LEVELS) levels[lv] = false;

  // Feature enabled check
  if (!config.enabled) {
    return {
      ok: false,
      enabled: false,
      ready: false,
      sandboxAvailable: false,
      levels,
      profiles: {},
      errors: ["Feature is disabled (DS4_LEAN_ENABLED=0)"],
      warnings: [],
    };
  }

  if (process.platform !== "linux") {
    errors.push("Lean runtime requires Linux (Bubblewrap is not portable).");
  }

  // Sandbox tools
  const bwrapBin = deps.bwrapBin || config.bwrapBin;
  const prlimitBin = deps.prlimitBin || config.prlimitBin;
  const bwrapExec = await isExecutable(bwrapBin);
  const prlimitExec = await isExecutable(prlimitBin);
  const sandboxAvailable = bwrapExec && prlimitExec;
  if (!sandboxAvailable) {
    if (config.sandboxRequired) {
      errors.push("Sandbox tools not available but sandbox is required.");
    } else {
      warnings.push("Sandbox tools not available — running without sandbox.");
    }
  }

  // Runtime and runs roots
  if (!config.runtimeRoot) {
    errors.push("Runtime root not configured (DS4_LEAN_RUNTIME_ROOT).");
  } else {
    const rt = await checkRootDir(config.runtimeRoot, "Runtime root");
    if (!rt.ok) errors.push(rt.reason);
    else if (rt.warning) warnings.push(rt.warning);
  }
  if (!config.runsRoot) {
    errors.push("Runs root not configured (DS4_LEAN_RUNS_ROOT).");
  }

  // Profiles
  const profiles = {};
  if (config.runtimeRoot) {
    profiles.core = await checkProfile(resolve(config.runtimeRoot, "core"), config, deps);
    profiles.mathlib = await checkProfile(resolve(config.runtimeRoot, "mathlib"), config, deps);

    // Core is the required profile: the feature is only usable end-to-end when
    // core is fully ready. Mathlib stays optional (a warning when not ready).
    if (!profiles.core.ok) {
      errors.push(`Profile 'core' is not ready: ${profiles.core.reason}`);
    }
    for (const [name, p] of Object.entries(profiles)) {
      if (p.ok || name === "core") continue;
      warnings.push(`Profile '${name}' is not usable: ${p.reason}`);
    }
    for (const lv of PREFLIGHT_LEVELS) {
      levels[lv] = profiles.core.level !== undefined && levelIndex(profiles.core.level) >= levelIndex(lv);
    }
  }

  const coreReady = Boolean(profiles.core?.ok);
  const ok = errors.length === 0 && coreReady;

  return {
    ok,
    enabled: config.enabled,
    ready: coreReady,
    sandboxAvailable,
    levels,
    profiles,
    errors,
    warnings,
  };
}
