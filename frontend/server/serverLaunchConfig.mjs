import fs from "node:fs/promises";
import path from "node:path";

function optionalString(value) {
  return value === null || value === undefined || String(value).trim() === ""
    ? ""
    : String(value).trim();
}

function assertProjectRoot(projectRoot) {
  if (typeof projectRoot !== "string" || !projectRoot.trim()) {
    throw new TypeError("projectRoot is required");
  }
  return path.resolve(projectRoot);
}

function rejectUnsafeRelativeDirectory(value, projectRoot, fieldName) {
  const relative = value.replaceAll("\\", "/");
  const normalized = path.posix.normalize(relative);
  const runtimeRoot = path.resolve(projectRoot, ".runtime") + path.sep;
  const resolved = path.resolve(projectRoot, value);
  if (normalized === "." || normalized === ".." || normalized.startsWith("../")) {
    throw new Error(`${fieldName} must not escape the project runtime directory`);
  }
  if (resolved !== path.resolve(projectRoot, ".runtime") && !resolved.startsWith(runtimeRoot)) {
    throw new Error(`${fieldName} relative path must be under .runtime`);
  }
  return resolved;
}

export function resolveOptionalLaunchFile(value, projectRoot, fieldName = "file") {
  const text = optionalString(value);
  if (!text) return "";
  const root = assertProjectRoot(projectRoot);
  return path.resolve(root, text);
}

export function resolveOptionalLaunchDirectory(value, projectRoot, fieldName = "directory") {
  const text = optionalString(value);
  if (!text) return "";
  const root = assertProjectRoot(projectRoot);
  if (path.isAbsolute(text)) return path.resolve(text);
  return rejectUnsafeRelativeDirectory(text, root, fieldName);
}

export function buildServerLaunchConfig(config, projectRoot) {
  if (!config || typeof config !== "object" || !config.server || typeof config.server !== "object") {
    throw new TypeError("config.server is required");
  }
  return {
    ...config,
    server: {
      ...config.server,
      trace: resolveOptionalLaunchFile(config.server.trace, projectRoot, "server.trace"),
      kvDiskDir: resolveOptionalLaunchDirectory(config.server.kvDiskDir, projectRoot, "server.kvDiskDir"),
    },
  };
}

async function assertPrivateDirectory(absDir, fieldName) {
  if (!path.isAbsolute(absDir)) throw new Error(`${fieldName} must be absolute`);
  await fs.mkdir(absDir, { recursive: true, mode: 0o700 });
  const before = await fs.lstat(absDir);
  if (before.isSymbolicLink()) throw new Error(`${fieldName} must not be a symlink`);
  if (!before.isDirectory()) throw new Error(`${fieldName} must be a directory`);
  await fs.chmod(absDir, 0o700);
  const after = await fs.stat(absDir);
  if (!after.isDirectory()) throw new Error(`${fieldName} must be a directory`);
  if ((after.mode & 0o777) !== 0o700) throw new Error(`${fieldName} must have mode 0700`);
  await fs.access(absDir, fs.constants.R_OK | fs.constants.W_OK | fs.constants.X_OK);
}

export async function prepareServerLaunchPaths(launchConfig, projectRoot) {
  if (!launchConfig?.server) throw new TypeError("launchConfig.server is required");
  const root = assertProjectRoot(projectRoot);
  const trace = optionalString(launchConfig.server.trace);
  const kvDir = optionalString(launchConfig.server.kvDiskDir);
  if (trace) await fs.mkdir(path.dirname(trace), { recursive: true });
  if (kvDir) {
    const runtimeRoot = path.resolve(root, ".runtime");
    if (!path.isAbsolute(kvDir)) throw new Error("server.kvDiskDir must be absolute at launch");
    const originalRelative = path.resolve(root, kvDir) === kvDir && kvDir.startsWith(runtimeRoot);
    await assertPrivateDirectory(kvDir, "server.kvDiskDir");
    if (originalRelative) {
      const runtimeReal = await fs.realpath(runtimeRoot);
      const kvReal = await fs.realpath(kvDir);
      if (kvReal !== runtimeReal && !kvReal.startsWith(`${runtimeReal}${path.sep}`)) {
        throw new Error("server.kvDiskDir resolved outside .runtime");
      }
    }
  }
  return launchConfig;
}
