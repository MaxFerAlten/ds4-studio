/**
 * DS4 Evolution — independently designed clean-room implementation.
 * Behavioral inputs: docs/evolution/behavioral-specification.md section 8.
 * External source code or prompts copied: none.
 * Existing DS4 mechanisms reused: DS4 workspace-sandbox invariant, implemented here at process scope.
 */

import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { captureBaselineSnapshot } from "./evolutionRunStore.mjs";

const execFileAsync = promisify(execFile);
const RUN_ID_PATTERN = /^evo_[a-f0-9]{20}$/;
const DEFAULT_EXCLUDED_ROOTS = new Set([
  ".git", ".gitnexus", "graphify-out", "node_modules", "artifacts", "data/evolution-runs"
]);

export class EvolutionWorkspaceError extends Error {
  constructor(code, message, details = {}) {
    super(`${code}: ${message}`);
    this.name = "EvolutionWorkspaceError";
    this.code = code;
    this.details = details;
  }
}

function inside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function normalizeRequestedPath(requestedPath) {
  if (typeof requestedPath !== "string" || requestedPath.includes("\0") ||
      path.isAbsolute(requestedPath) || path.win32.isAbsolute(requestedPath)) {
    throw new EvolutionWorkspaceError("WORKSPACE_PATH_ESCAPE", "path must be relative");
  }
  const normalized = path.posix.normalize(requestedPath.replaceAll("\\", "/")).replace(/^\.\//, "");
  if (normalized === ".." || normalized.startsWith("../")) {
    throw new EvolutionWorkspaceError("WORKSPACE_PATH_ESCAPE", requestedPath);
  }
  return normalized || ".";
}

export async function assertInside(workspaceRoot, requestedPath, options = {}) {
  const root = await fs.realpath(workspaceRoot);
  const normalized = normalizeRequestedPath(requestedPath);
  const segments = normalized === "." ? [] : normalized.split("/");
  let current = root;
  for (let index = 0; index < segments.length; index += 1) {
    current = path.join(current, segments[index]);
    const stat = await fs.lstat(current).catch((error) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (!stat) {
      if (options.mustExist) throw new EvolutionWorkspaceError("WORKSPACE_PATH_MISSING", normalized);
      current = path.join(current, ...segments.slice(index + 1));
      break;
    }
    if (stat.isSymbolicLink()) {
      const resolved = await fs.realpath(current);
      if (!inside(root, resolved)) {
        throw new EvolutionWorkspaceError("WORKSPACE_SYMLINK_ESCAPE", normalized, { resolved });
      }
      current = resolved;
    }
  }
  const resolved = path.resolve(current);
  if (!inside(root, resolved)) throw new EvolutionWorkspaceError("WORKSPACE_PATH_ESCAPE", normalized);
  return resolved;
}

function scopeContains(scope, candidate) {
  return candidate === scope || candidate.startsWith(`${scope}/`);
}

function entryIdentity(entry) {
  if (!entry) return "missing";
  return JSON.stringify({ type: entry.type, mode: entry.mode, size: entry.size, hash: entry.hash, target: entry.target });
}

async function lineCount(file) {
  const text = await fs.readFile(file, "utf8");
  if (!text) return 0;
  const rows = text.split(/\r?\n/);
  if (rows.at(-1) === "") rows.pop();
  return rows.length;
}

async function diffStat(sourceFile, candidateFile, sourceEntry, candidateEntry) {
  if (sourceEntry?.type === "file" && candidateEntry?.type === "file") {
    if (Math.max(sourceEntry.size ?? 0, candidateEntry.size ?? 0) > 10_000_000) {
      return { addedLines: 0, deletedLines: 0, binary: true };
    }
    try {
      await execFileAsync("git", ["diff", "--no-index", "--numstat", "--", sourceFile, candidateFile], {
        encoding: "utf8",
        timeout: 10_000,
        maxBuffer: 1_000_000
      });
      return { addedLines: 0, deletedLines: 0, binary: false };
    } catch (error) {
      if (error.code !== 1 && error.status !== 1) throw error;
      const row = String(error.stdout ?? "").trim().split("\n").at(-1) ?? "";
      const [added, deleted] = row.split("\t");
      if (added === "-" || deleted === "-") return { addedLines: 0, deletedLines: 0, binary: true };
      if (/^\d+$/.test(added) && /^\d+$/.test(deleted)) {
        return { addedLines: Number(added), deletedLines: Number(deleted), binary: false };
      }
    }
  }
  if (candidateEntry?.type === "file" && sourceEntry?.type !== "file") {
    return { addedLines: await lineCount(candidateFile), deletedLines: 0, binary: false };
  }
  if (sourceEntry?.type === "file" && candidateEntry?.type !== "file") {
    return { addedLines: 0, deletedLines: await lineCount(sourceFile), binary: false };
  }
  return { addedLines: 0, deletedLines: 0, binary: false };
}

export async function auditWorkspace({ sourceRoot, workspaceRoot, taskContract }) {
  const relevantPaths = [...new Set([...taskContract.mutablePaths, ...taskContract.immutablePaths])].sort();
  const [source, candidate] = await Promise.all([
    captureBaselineSnapshot({ repositoryRoot: sourceRoot, relevantPaths }),
    captureBaselineSnapshot({ repositoryRoot: workspaceRoot, relevantPaths })
  ]);
  const sourceEntries = new Map(source.files.map((entry) => [entry.path, entry]));
  const candidateEntries = new Map(candidate.files.map((entry) => [entry.path, entry]));
  const paths = [...new Set([...sourceEntries.keys(), ...candidateEntries.keys()])].sort();
  const changes = [];
  let addedLines = 0;
  let deletedLines = 0;
  for (const relativePath of paths) {
    const before = sourceEntries.get(relativePath);
    const after = candidateEntries.get(relativePath);
    if (entryIdentity(before) === entryIdentity(after)) continue;
    const mutable = taskContract.mutablePaths.some((scope) => scopeContains(scope, relativePath));
    const immutable = taskContract.immutablePaths.some((scope) => scopeContains(scope, relativePath));
    if (!mutable || immutable) {
      throw new EvolutionWorkspaceError("IMMUTABLE_PATH_WRITE", relativePath);
    }
    if (before?.type === "symlink" || after?.type === "symlink") {
      throw new EvolutionWorkspaceError("SYMLINK_CHANGE_FORBIDDEN", relativePath);
    }
    const stat = await diffStat(
      path.join(sourceRoot, ...relativePath.split("/")),
      path.join(workspaceRoot, ...relativePath.split("/")),
      before,
      after
    );
    if (stat.binary) throw new EvolutionWorkspaceError("BINARY_CHANGE_FORBIDDEN", relativePath);
    addedLines += stat.addedLines;
    deletedLines += stat.deletedLines;
    changes.push({
      path: relativePath,
      kind: !before || before.type === "missing" ? "added" : !after || after.type === "missing" ? "deleted" : "modified",
      ...stat
    });
  }
  const changedFiles = changes.filter((change) => {
    const entry = candidateEntries.get(change.path) ?? sourceEntries.get(change.path);
    return entry?.type !== "directory";
  });
  if (changedFiles.length > taskContract.budgets.maxFilesChanged) {
    throw new EvolutionWorkspaceError("FILE_BUDGET_EXCEEDED", `${changedFiles.length} files changed`);
  }
  if (addedLines > taskContract.budgets.maxAddedLines || deletedLines > taskContract.budgets.maxDeletedLines) {
    throw new EvolutionWorkspaceError("LINE_BUDGET_EXCEEDED", "candidate diff exceeds line budget", { addedLines, deletedLines });
  }
  return Object.freeze({
    changes: Object.freeze(changedFiles),
    filesChanged: changedFiles.length,
    addedLines,
    deletedLines,
    sourceHash: source.contentHash,
    candidateHash: candidate.contentHash
  });
}

export class EvolutionWorkspaceManager {
  constructor({ repositoryRoot, workRoot, excludedRoots = DEFAULT_EXCLUDED_ROOTS } = {}) {
    if (!repositoryRoot || !workRoot) throw new TypeError("repositoryRoot and workRoot are required");
    this.repositoryRoot = path.resolve(repositoryRoot);
    this.workRoot = path.resolve(workRoot);
    if (inside(this.repositoryRoot, this.workRoot)) {
      throw new EvolutionWorkspaceError("WORK_ROOT_INSIDE_REPOSITORY", "workRoot must be outside repositoryRoot");
    }
    this.excludedRoots = new Set(excludedRoots);
  }

  workspacePath(runId, revision) {
    if (!RUN_ID_PATTERN.test(String(runId)) || !Number.isSafeInteger(revision) || revision <= 0) {
      throw new EvolutionWorkspaceError("INVALID_WORKSPACE_ID", "runId or revision is invalid");
    }
    return path.join(this.workRoot, runId, `r${String(revision).padStart(4, "0")}`, "workspace");
  }

  async createWorkspace({ runId, revision }) {
    const destination = this.workspacePath(runId, revision);
    await fs.mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
    const exists = await fs.lstat(destination).then(() => true, (error) => {
      if (error.code === "ENOENT") return false;
      throw error;
    });
    if (exists) throw new EvolutionWorkspaceError("WORKSPACE_ALREADY_EXISTS", destination);
    await fs.cp(this.repositoryRoot, destination, {
      recursive: true,
      dereference: false,
      preserveTimestamps: true,
      filter: (source) => {
        const relative = path.relative(this.repositoryRoot, source).split(path.sep).join("/");
        if (!relative) return true;
        return ![...this.excludedRoots].some((excluded) => relative === excluded || relative.startsWith(`${excluded}/`));
      }
    });
    return Object.freeze({ runId, revision, root: destination });
  }

  async writableBindings(workspaceRoot, taskContract) {
    const bindings = [];
    for (const relativePath of taskContract.mutablePaths) {
      const source = await assertInside(workspaceRoot, relativePath, { mustExist: true });
      const stat = await fs.lstat(source);
      if (stat.isSymbolicLink()) throw new EvolutionWorkspaceError("MUTABLE_SYMLINK_FORBIDDEN", relativePath);
      bindings.push(Object.freeze({ source, target: path.posix.join("/workspace", relativePath), writable: true }));
    }
    return Object.freeze(bindings);
  }

  async audit(workspaceRoot, taskContract) {
    return auditWorkspace({ sourceRoot: this.repositoryRoot, workspaceRoot, taskContract });
  }

  async destroyWorkspace({ runId, revision }) {
    const target = this.workspacePath(runId, revision);
    const relative = path.relative(this.workRoot, target);
    if (!relative || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new EvolutionWorkspaceError("UNSAFE_CLEANUP_TARGET", target);
    }
    await fs.rm(path.join(this.workRoot, runId, `r${String(revision).padStart(4, "0")}`), {
      recursive: true,
      force: true
    });
  }
}
