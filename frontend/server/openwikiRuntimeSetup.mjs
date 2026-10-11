import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import { lstat, mkdir, readFile, realpath, rename, writeFile, unlink, mkdtemp, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig, validateWorkspaceRoot } from "../../integrations/openwiki-gateway/src/config.mjs";

const execFile = promisify(execFileCallback);
const DEFAULT_WORKSPACE_ID = "ds4-studio";
const INSTALL_TIMEOUT_MS = 20 * 60 * 1000;
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function absolute(value, label) {
  if (typeof value !== "string" || !value || value.length > 4096 || !path.isAbsolute(value) || value.includes("\0")) {
    throw Object.assign(new Error(`${label} must be an absolute path`), { code: "OPENWIKI_PATH_INVALID" });
  }
  return value;
}

export function openWikiRuntimePaths(env = process.env, home = os.homedir()) {
  const dataHome = env.XDG_DATA_HOME && path.isAbsolute(env.XDG_DATA_HOME) ? env.XDG_DATA_HOME : path.join(home, ".local", "share");
  const stateHome = env.XDG_STATE_HOME && path.isAbsolute(env.XDG_STATE_HOME) ? env.XDG_STATE_HOME : path.join(home, ".local", "state");
  const configPath = env.DS4_OPENWIKI_CONFIG || path.join(home, ".config", "ds4-studio", "openwiki.json");
  return Object.freeze({
    configPath,
    sourcePathPath: path.join(path.dirname(configPath), "openwiki-source.json"),
    workspaceId: env.DS4_OPENWIKI_WORKSPACE || DEFAULT_WORKSPACE_ID,
    stateDir: path.join(stateHome, "ds4-studio", "openwiki"),
    installHome: env.OPENWIKI_HOME || path.join(dataHome, "ds4-openwiki"),
  });
}

async function run(command, args, options = {}) {
  try {
    const result = await execFile(command, args, {
      encoding: "utf8",
      timeout: INSTALL_TIMEOUT_MS,
      maxBuffer: 1024 * 1024,
      ...options,
    });
    return { stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    const details = [error.stderr, error.stdout].filter(Boolean).join("\n").slice(-4000);
    throw Object.assign(new Error(details || `${path.basename(command)} failed`), {
      code: error.killed ? "OPENWIKI_PROVISION_TIMEOUT" : "OPENWIKI_PROVISION_FAILED",
      cause: error,
    });
  }
}

function versionAtLeast(actual, minimum) {
  const parse = (value) => /^(\d+)\.(\d+)\.(\d+)/u.exec(value || "")?.slice(1).map(Number);
  const current = parse(actual);
  const required = parse(minimum);
  if (!current || !required) return false;
  for (let index = 0; index < 3; index += 1) {
    if (current[index] !== required[index]) return current[index] > required[index];
  }
  return true;
}

async function selectSandboxNode(lockPath, env) {
  const lock = JSON.parse(await readFile(lockPath, "utf8"));
  const minimum = /^>=\s*(\d+\.\d+\.\d+)/u.exec(lock.package?.node_engine || "")?.[1];
  if (!minimum) throw new Error("OpenWiki lock does not define a supported Node engine floor");
  const candidates = [...new Set([
    env.DS4_OPENWIKI_NODE,
    "/usr/bin/node",
    "/usr/local/bin/node",
    process.execPath,
  ].filter(Boolean))];
  for (const candidate of candidates) {
    try {
      const canonical = await realpath(candidate);
      const stat = await lstat(canonical);
      if (!stat.isFile() || stat.isSymbolicLink()) continue;
      const { stdout } = await execFile(canonical, ["-p", "JSON.stringify({version:process.versions.node,abi:process.versions.modules})"], {
        encoding: "utf8", timeout: 5000, maxBuffer: 1024 * 1024,
      });
      const runtime = JSON.parse(stdout.trim());
      if (versionAtLeast(runtime.version, minimum) && runtime.abi === process.versions.modules) return canonical;
    } catch {
      // Try the next local Node runtime; no network lookup or install is done.
    }
  }
  throw Object.assign(new Error("No local Node runtime satisfies the OpenWiki engine and sandbox ABI requirements"), {
    code: "OPENWIKI_NODE_RUNTIME_INVALID",
  });
}

async function verifyPinnedSource(sourcePath, lockPath, runCommand) {
  const canonical = await realpath(absolute(sourcePath, "OpenWiki source path"));
  const [rootResult, headResult, lockText] = await Promise.all([
    runCommand("git", ["-C", canonical, "rev-parse", "--show-toplevel"]),
    runCommand("git", ["-C", canonical, "rev-parse", "--verify", "HEAD"]),
    readFile(lockPath, "utf8"),
  ]);
  const root = (rootResult.stdout || "").trim();
  const head = (headResult.stdout || "").trim();
  const lock = JSON.parse(lockText);
  if (!root || await realpath(root) !== canonical) {
    throw Object.assign(new Error("OpenWiki source path must be the Git checkout root"), { code: "OPENWIKI_SOURCE_INVALID" });
  }
  if (!/^[0-9a-f]{40}$/u.test(lock.git_commit || "") || head !== lock.git_commit) {
    throw Object.assign(new Error("OpenWiki checkout HEAD does not match the DS4 pinned commit"), { code: "OPENWIKI_SOURCE_PIN_MISMATCH" });
  }
  return { canonical, head };
}

export function validateOpenWikiWorkspacePath(workspacePath) {
  try {
    const workspace = validateWorkspaceRoot(absolute(workspacePath, "Workspace path"));
    // The gateway admits a group-writable root (it only writes below
    // <root>/openwiki), but a Studio session binds the root itself and
    // AgentSessionManager.setOpenWikiWorkspace refuses group/world write and
    // foreign owners. Reject here, so setup fails with a clear code instead of
    // succeeding and then failing at bind time.
    if (workspace.uid !== process.getuid() || (workspace.mode & 0o022) !== 0) {
      throw new Error("workspace root must be owned by this user and not group/world writable");
    }
    return workspace.root;
  } catch (error) {
    throw Object.assign(new Error("Workspace path must resolve to an existing directory"), {
      code: "OPENWIKI_WORKSPACE_INVALID",
      cause: error,
    });
  }
}

/** Build from the pinned Git object, never from the mutable checkout contents. */
export async function provisionOpenWikiRelease({
  sourcePath,
  repoRoot = REPO_ROOT,
  lockPath = path.join(repoRoot, "docs", "openwiki-integration", "upstream-lock.json"),
  installHome = openWikiRuntimePaths().installHome,
  env = process.env,
  runCommand = run,
  makeTempDir = (base) => mkdtemp(base),
  removeTree = (target) => rm(target, { recursive: true, force: true }),
} = {}) {
  if (!repoRoot) throw new TypeError("repoRoot is required");
  const { canonical, head } = await verifyPinnedSource(sourcePath, lockPath, runCommand);
  const tempRoot = await makeTempDir(path.join(os.tmpdir(), "ds4-openwiki-source-"));
  const cleanCheckout = path.join(tempRoot, "checkout");
  const installer = path.join(repoRoot, "scripts", "openwiki-install-release.sh");
  const verifier = path.join(repoRoot, "scripts", "openwiki-verify-upstream.sh");
  const releaseId = `${head}-node${process.versions.modules}-${process.platform}-${process.arch}`;
  const releaseRoot = path.join(installHome, "releases", releaseId);
  try {
    await runCommand("git", ["clone", "--no-hardlinks", "--no-checkout", "--quiet", "--", canonical, cleanCheckout]);
    await runCommand("git", ["-C", cleanCheckout, "checkout", "--detach", "--quiet", head]);
    await runCommand("bash", [installer, "--confirm", "--source", cleanCheckout, "--home", installHome], {
      env: { ...env, OPENWIKI_SOURCE: cleanCheckout, OPENWIKI_LOCK: lockPath },
    });
    await runCommand("bash", [verifier, "--release", releaseRoot, "--smoke"], {
      env: { ...env, OPENWIKI_LOCK: lockPath },
    });
    return Object.freeze({ commit: head, releaseRoot, releaseDir: path.join(releaseRoot, "package"), sourcePath: canonical });
  } finally {
    await removeTree(tempRoot).catch(() => {});
  }
}

async function ensureOwnedPrivateDirectory(directory, { create = false } = {}) {
  if (create) await mkdir(directory, { recursive: true, mode: 0o700 });
  const stat = await lstat(directory);
  if (stat.isSymbolicLink() || !stat.isDirectory() || stat.uid !== process.getuid() || (stat.mode & 0o777) !== 0o700) {
    throw Object.assign(new Error("OpenWiki directory must be owned by DS4 and mode 0700"), { code: "OPENWIKI_CONFIG_DIRECTORY_INVALID" });
  }
}

export async function readOpenWikiRuntimeSetup({ env = process.env, home = os.homedir() } = {}) {
  const paths = openWikiRuntimePaths(env, home);
  try {
    await lstat(paths.configPath);
  } catch (error) {
    if (error?.code === "ENOENT") {
      return Object.freeze({ configured: false, configPath: paths.configPath, sourcePath: "", workspacePath: "", message: "Configura la sorgente OpenWiki e il repository workspace." });
    }
    throw error;
  }
  try {
    const config = loadConfig(paths.configPath);
    const workspace = config.workspaces[paths.workspaceId];
    if (!workspace || Object.keys(config.workspaces).length !== 1) {
      return Object.freeze({ configured: false, configPath: paths.configPath, sourcePath: "", workspacePath: "", message: "Configura un solo workspace OpenWiki." });
    }
    return Object.freeze({
      configured: true,
      configPath: paths.configPath,
      sourcePath: await readPersistedSourcePath(paths.sourcePathPath) || env.DS4_OPENWIKI_SOURCE || "",
      workspacePath: workspace.root,
      releasePath: config.upstream.releaseDir,
      workspaceId: paths.workspaceId,
    });
  } catch (error) {
    return Object.freeze({
      configured: false,
      configPath: paths.configPath,
      sourcePath: "",
      workspacePath: "",
      message: error?.code === "ENOENT" ? "Configura la sorgente OpenWiki e il repository workspace." : "La configurazione OpenWiki protetta non è valida.",
    });
  }
}

async function readPersistedSourcePath(sourcePathPath) {
  try {
    const stat = await lstat(sourcePathPath);
    if (stat.isSymbolicLink() || !stat.isFile() || stat.uid !== process.getuid() || (stat.mode & 0o777) !== 0o600) return "";
    const value = JSON.parse(await readFile(sourcePathPath, "utf8"))?.sourcePath;
    return typeof value === "string" && path.isAbsolute(value) && !value.includes("\0") ? value : "";
  } catch {
    return "";
  }
}

async function persistSourcePath(sourcePathPath, sourcePath) {
  const candidatePath = `${sourcePathPath}.candidate-${randomUUID()}`;
  try {
    await writeFile(candidatePath, `${JSON.stringify({ sourcePath })}\n`, { flag: "wx", mode: 0o600 });
    await rename(candidatePath, sourcePathPath);
  } finally {
    await unlink(candidatePath).catch(() => {});
  }
}

export async function configureOpenWikiRuntime({
  sourcePath,
  workspacePath,
  releaseDir,
  env = process.env,
  home = os.homedir(),
} = {}) {
  const paths = openWikiRuntimePaths(env, home);
  const canonicalSource = await realpath(absolute(sourcePath, "OpenWiki source path"));
  const root = validateOpenWikiWorkspacePath(workspacePath);
  const canonicalRelease = await realpath(absolute(releaseDir, "OpenWiki release path"));
  const configDir = path.dirname(paths.configPath);
  await ensureOwnedPrivateDirectory(configDir, { create: true });
  await ensureOwnedPrivateDirectory(paths.stateDir, { create: true });
  const config = {
    schema: 1,
    listen: { transport: "unix", socketPath: path.join(paths.stateDir, "gateway.sock") },
    upstream: {
      node: await selectSandboxNode(path.join(REPO_ROOT, "docs", "openwiki-integration", "upstream-lock.json"), env),
      releaseDir: canonicalRelease,
      executable: path.join(canonicalRelease, "dist", "cli", "cli.js"),
    },
    sandbox: { bwrap: "/usr/bin/bwrap" },
    workspaces: { [paths.workspaceId]: { root } },
  };
  const candidatePath = path.join(configDir, `.${path.basename(paths.configPath)}.candidate-${randomUUID()}`);
  let candidateCreated = false;
  try {
    try {
      const existing = await lstat(paths.configPath);
      if (existing.isSymbolicLink() || !existing.isFile() || existing.uid !== process.getuid() || (existing.mode & 0o777) !== 0o600) {
        throw Object.assign(new Error("OpenWiki config must be owned by DS4 and mode 0600"), { code: "OPENWIKI_CONFIG_FILE_INVALID" });
      }
      const prior = loadConfig(paths.configPath);
      config.listen.socketPath = prior.listen.socketPath;
      config.sandbox.bwrap = prior.sandbox.bwrap;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    await writeFile(candidatePath, `${JSON.stringify(config, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    candidateCreated = true;
    loadConfig(candidatePath);
    await rename(candidatePath, paths.configPath);
    candidateCreated = false;
  } finally {
    if (candidateCreated) await unlink(candidatePath).catch(() => {});
  }
  env.DS4_OPENWIKI_CONFIG = paths.configPath;
  env.DS4_OPENWIKI_WORKSPACE = paths.workspaceId;
  env.DS4_OPENWIKI_SOCKET = config.listen.socketPath;
  env.DS4_OPENWIKI_MODE = "on";
  env.DS4_OPENWIKI_SOURCE = canonicalSource;
  await persistSourcePath(paths.sourcePathPath, canonicalSource);
  return Object.freeze({
    configured: true,
    configPath: paths.configPath,
    sourcePath: canonicalSource,
    workspacePath: root,
    releasePath: canonicalRelease,
    workspaceId: paths.workspaceId,
    socketPath: config.listen.socketPath,
  });
}

/** Load a previously configured, protected gateway file on DS4 server startup. */
export function bootstrapOpenWikiEnvironment(env = process.env, home = os.homedir()) {
  const paths = openWikiRuntimePaths(env, home);
  try {
    const config = loadConfig(paths.configPath);
    const ids = Object.keys(config.workspaces);
    const workspaceId = env.DS4_OPENWIKI_WORKSPACE || (ids.length === 1 ? ids[0] : "");
    if (!workspaceId || !config.workspaces[workspaceId] || ids.length !== 1) return false;
    env.DS4_OPENWIKI_CONFIG = paths.configPath;
    env.DS4_OPENWIKI_WORKSPACE = workspaceId;
    env.DS4_OPENWIKI_SOCKET = env.DS4_OPENWIKI_SOCKET || config.listen.socketPath;
    if (env.DS4_OPENWIKI_MODE === undefined) env.DS4_OPENWIKI_MODE = "on";
    return true;
  } catch {
    return false;
  }
}
