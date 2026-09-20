// Lean 4 sandbox builder for ds4-studio
// Builds the Bubblewrap command that runs Lean with no network, no host
// filesystem beyond an explicit allowlist, and bounded resources.
//
// Ordering matters and is not the "obvious" one: prlimit runs *inside* bwrap,
// not around it. RLIMIT_NPROC is counted per-UID across the whole system, so
// applying --nproc before the user namespace is created makes bwrap's own
// clone() fail with EAGAIN on any machine that already has more than N
// processes running as that user. Inside the new user namespace the ucount
// starts fresh.

import { existsSync, lstatSync, readFileSync, realpathSync } from "fs";
import { resolve } from "path";

/** Directories that are symlinks into /usr on merged-/usr distributions. */
const SYSTEM_DIRS = ["/bin", "/lib", "/lib64", "/sbin"];

/**
 * Map a lean-toolchain descriptor to the elan directory that holds it.
 * "leanprover/lean4:v4.32.2" -> "leanprover--lean4---v4.32.2"
 *
 * @param {string} descriptor - Contents of a lean-toolchain file
 * @returns {string} elan toolchain directory name
 */
export function elanToolchainDirName(descriptor) {
  return String(descriptor).trim().replace(/\//g, "--").replace(/:/g, "---");
}

/**
 * Resolve the elan toolchain directory pinned by a profile.
 *
 * @param {string} profileDir - Absolute path to the runtime profile
 * @param {object} config - Lean configuration
 * @returns {{ ok: boolean, dir?: string, name?: string, descriptor?: string, error?: string, reason?: string }}
 */
export function resolveLeanToolchain(profileDir, config) {
  const tcFile = resolve(profileDir, "lean-toolchain");
  if (!existsSync(tcFile)) {
    return {
      ok: false,
      error: "LEAN_RUNTIME_NOT_PREPARED",
      reason: `Missing lean-toolchain in ${profileDir}`,
    };
  }

  const descriptor = readFileSync(tcFile, "utf8").trim();
  if (!descriptor || descriptor.includes("X.Y.Z")) {
    return {
      ok: false,
      error: "LEAN_RUNTIME_NOT_PREPARED",
      reason: `lean-toolchain in ${profileDir} is empty or still a placeholder`,
    };
  }

  const name = elanToolchainDirName(descriptor);
  const dir = resolve(config.elanRoot, "toolchains", name);
  for (const bin of ["lake", "lean"]) {
    if (!existsSync(resolve(dir, "bin", bin))) {
      return {
        ok: false,
        error: "LEAN_RUNTIME_NOT_PREPARED",
        reason: `Toolchain ${descriptor} is not installed (missing ${dir}/bin/${bin}). Run scripts/lean-prepare-runtime.sh.`,
      };
    }
  }

  return { ok: true, dir, name, descriptor };
}

/**
 * Resolve the sandbox configuration for a given profile.
 *
 * @param {object} config - Lean configuration
 * @param {string} profile - Profile name ("core" or "mathlib")
 * @returns {Promise<{ ok: boolean, toolchain?: object, error?: string, reason?: string }>}
 */
export async function resolveLeanSandbox(config, profile) {
  const profileDir = resolve(config.runtimeRoot, profile);

  if (config.sandboxRequired) {
    const { access } = await import("fs/promises");
    const { constants } = await import("fs");
    for (const bin of [config.bwrapBin, config.prlimitBin]) {
      try {
        await access(bin, constants.X_OK);
      } catch {
        return {
          ok: false,
          error: "LEAN_SANDBOX_UNAVAILABLE",
          reason: `${bin} is not executable`,
        };
      }
    }
  }

  const toolchain = resolveLeanToolchain(profileDir, config);
  if (!toolchain.ok) return toolchain;

  return { ok: true, toolchain };
}

/**
 * Bind the host's /bin, /lib, ... into the sandbox, preserving the symlink
 * layout of merged-/usr systems instead of shadowing it with a bind mount.
 */
function systemDirArgs() {
  const args = [];
  for (const dir of SYSTEM_DIRS) {
    if (!existsSync(dir)) continue;
    if (lstatSync(dir).isSymbolicLink()) {
      // e.g. /bin -> usr/bin. Recreate the link; /usr is already bound.
      args.push("--symlink", realpathSync(dir).replace(/^\//, ""), dir);
    } else {
      args.push("--ro-bind", dir, dir);
    }
  }
  return args;
}

/**
 * The Bubblewrap argument prefix shared by every sandboxed command.
 *
 * Start from an empty environment (the --setenv calls are the whole allowlist),
 * kill every descendant when the parent dies, unshare all namespaces (network
 * included), bind /usr, the pinned toolchain and the profile read-only, and
 * give the command exactly one writable directory: its run dir at /work.
 *
 * @param {object} config - Lean configuration
 * @param {object} context
 * @param {object} context.toolchain - Result of resolveLeanToolchain()
 * @param {string} context.profileDir - Absolute path to the prepared runtime profile
 * @param {string} context.runDir - Absolute path to the run directory (writable)
 * @returns {string[]} bwrap argv prefix (before the inner `--`)
 */
export function buildBwrapBaseArgs(config, { toolchain, profileDir, runDir }) {
  if (!toolchain?.dir) {
    throw new Error("buildBwrapBaseArgs requires a resolved toolchain");
  }
  return [
    // Start from an empty environment; the --setenv calls below are the whole
    // allowlist. Without this bwrap forwards the server's environment.
    "--clearenv",
    "--die-with-parent",
    "--new-session",
    "--unshare-user",
    "--unshare-pid",
    "--unshare-net",
    "--unshare-ipc",
    "--unshare-uts",
    "--proc", "/proc",
    "--dev", "/dev",
    "--tmpfs", "/tmp",
    "--ro-bind", "/usr", "/usr",
    ...systemDirArgs(),
    "--ro-bind", toolchain.dir, "/lean-toolchain",
    "--ro-bind", profileDir, "/lean-project",
    "--bind", runDir, "/work",
    "--dir", "/home/ds4",
    "--chdir", "/lean-project",
    "--setenv", "PATH", "/lean-toolchain/bin:/usr/bin:/bin",
    "--setenv", "HOME", "/home/ds4",
    "--setenv", "LANG", "C.UTF-8",
    "--setenv", "LC_ALL", "C.UTF-8",
  ];
}

/**
 * Build the sandbox command for elaborating a single Lean source file.
 *
 * The source is always at /work/Main.lean inside the sandbox; no host path is
 * ever passed through to the command line, and no shell is involved.
 *
 * @param {object} context
 * @param {object} context.config - Lean configuration
 * @param {string} context.profileDir - Absolute path to the prepared runtime profile
 * @param {string} context.runDir - Absolute path to the run directory (writable)
 * @param {object} context.toolchain - Result of resolveLeanToolchain()
 * @returns {{ command: string, args: string[], env: object, cwd: string }}
 */
export function buildLeanSandboxCommand(context) {
  const { config } = context;

  const bwrapArgs = buildBwrapBaseArgs(config, context);

  const prlimitArgs = [
    // ponytail: RLIMIT_AS is a backstop, not the real memory cap. Lean reserves
    // virtual address space proportional to the core count, so an --as tuned to
    // the intended heap size makes Lean abort with "failed to create thread" on
    // a many-core machine. addressSpaceBytes is the calibration knob; the heap
    // is capped by `lean --memory` below, which is the limit that actually binds.
    `--as=${config.addressSpaceBytes}`,
    `--cpu=${config.cpuSeconds}`,
    `--nproc=${config.maxProcesses}`,
    `--nofile=${config.maxOpenFiles}`,
    "--fsize=16777216",
  ];

  const leanArgs = [
    `--memory=${Math.floor(config.memoryBytes / (1024 * 1024))}`,
    `--threads=${config.leanThreads}`,
    "/work/Main.lean",
  ];

  return {
    command: config.bwrapBin,
    args: [
      ...bwrapArgs,
      "--",
      config.prlimitBin, ...prlimitArgs,
      "--",
      "/lean-toolchain/bin/lake", "env", "lean", ...leanArgs,
    ],
    // Everything the sandboxed process sees comes from --clearenv/--setenv;
    // this is only what bwrap itself is started with.
    env: { PATH: "/usr/bin:/bin" },
    cwd: context.runDir,
  };
}

/**
 * Build a sandboxed network-isolation probe.
 *
 * A /usr/bin/node one-liner inside the same bwrap posture as the executor
 * tries to reach a listener on 127.0.0.1:<port>. With --unshare-net the
 * sandbox has no listener and cannot connect: exit 0 means isolated. Without
 * the unshare the probe connects to the host listener and exits 1.
 *
 * @param {object} context - Same shape as buildLeanSandboxCommand()
 * @param {number} context.port - Host probe port to attempt
 * @returns {{ command: string, args: string[], env: object, cwd: string }}
 */
export function buildLeanNetworkProbeCommand(context, { port }) {
  const { config } = context;
  const script = [
    "const p=Number(process.argv[1]);",
    'const s=require("net").createConnection({host:"127.0.0.1",port:p,timeout:3000});',
    's.on("connect",()=>process.exit(1));',
    's.on("error",()=>process.exit(0));',
    's.on("timeout",()=>process.exit(0));',
  ].join("");
  return {
    command: config.bwrapBin,
    args: [
      ...buildBwrapBaseArgs(config, context),
      "--",
      "/usr/bin/node", "-e", script, String(port),
    ],
    env: { PATH: "/usr/bin:/bin" },
    cwd: context.runDir,
  };
}
