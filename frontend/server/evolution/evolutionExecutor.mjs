/**
 * DS4 Evolution — independently designed clean-room implementation.
 * Behavioral inputs: docs/evolution/behavioral-specification.md section 9.
 * External source code or prompts copied: none.
 * Existing DS4 mechanisms reused: ToolBlobStore through EvolutionRunStore.
 */

import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";

import { hashJson } from "./evolutionIntegrity.mjs";

const SAFE_ENV_NAME = /^[A-Z_][A-Z0-9_]{0,127}$/;
const FORBIDDEN_ENV = new Set([
  "BASH_ENV", "ENV", "LD_AUDIT", "LD_LIBRARY_PATH", "LD_PRELOAD", "NODE_OPTIONS",
  "PERL5OPT", "PYTHONHOME", "PYTHONPATH", "RUBYOPT"
]);

export const DEFAULT_EXECUTION_LIMITS = Object.freeze({
  timeoutMs: 600_000,
  maxOutputBytes: 1_000_000,
  maxProcesses: 128,
  maxMemoryBytes: 2_147_483_648,
  maxFileBytes: 67_108_864,
  maxDiskBytes: 134_217_728,
  diskPollMs: 100,
  killGraceMs: 1_000,
  previewBytes: 4_000
});

export class EvolutionExecutorError extends Error {
  constructor(code, message, details = {}) {
    super(`${code}: ${message}`);
    this.name = "EvolutionExecutorError";
    this.code = code;
    this.details = details;
  }
}

function positiveInteger(value, name) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new EvolutionExecutorError("INVALID_RESOURCE_LIMIT", `${name} must be a positive safe integer`);
  }
  return value;
}

function normalizeLimits(input = {}) {
  const limits = { ...DEFAULT_EXECUTION_LIMITS, ...input };
  for (const key of Object.keys(DEFAULT_EXECUTION_LIMITS)) positiveInteger(limits[key], key);
  return Object.freeze(limits);
}

function inside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function normalizeEnvironment(environment = {}) {
  if (!environment || typeof environment !== "object" || Array.isArray(environment)) {
    throw new EvolutionExecutorError("INVALID_ENVIRONMENT", "environment must be an object");
  }
  const result = {};
  for (const [key, rawValue] of Object.entries(environment)) {
    if (!SAFE_ENV_NAME.test(key) || FORBIDDEN_ENV.has(key)) {
      throw new EvolutionExecutorError("ENVIRONMENT_VARIABLE_FORBIDDEN", key);
    }
    const value = String(rawValue);
    if (value.includes("\0") || Buffer.byteLength(value, "utf8") > 16_384) {
      throw new EvolutionExecutorError("INVALID_ENVIRONMENT", key);
    }
    result[key] = value;
  }
  return result;
}

function normalizeArgv(command, args) {
  if (typeof command !== "string" || !path.isAbsolute(command) || command.includes("\0")) {
    throw new EvolutionExecutorError("INVALID_EXECUTABLE", "command must be an absolute path");
  }
  if (!Array.isArray(args) || args.some((arg) => typeof arg !== "string" || arg.includes("\0") || arg.length > 100_000)) {
    throw new EvolutionExecutorError("INVALID_ARGUMENT_VECTOR", "args must be bounded NUL-free strings");
  }
  return { command: path.normalize(command), args: [...args] };
}

function sandboxExecutable(command, workspaceRoot) {
  if (inside(workspaceRoot, command)) {
    return path.posix.join("/workspace", path.relative(workspaceRoot, command).split(path.sep).join("/"));
  }
  if (command === "/bin/sh" || command.startsWith("/usr/")) return command;
  throw new EvolutionExecutorError("EXECUTABLE_OUTSIDE_ALLOWLIST", command);
}

async function currentUserTaskCount() {
  const uid = typeof process.getuid === "function" ? process.getuid() : null;
  if (uid === null) throw new EvolutionExecutorError("PROCESS_BASELINE_UNAVAILABLE", "platform has no numeric uid");
  const entries = await fs.readdir("/proc", { withFileTypes: true }).catch((error) => {
    throw new EvolutionExecutorError("PROCESS_BASELINE_UNAVAILABLE", error.message);
  });
  let tasks = 0;
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^\d+$/.test(entry.name)) continue;
    const processRoot = path.join("/proc", entry.name);
    const stat = await fs.stat(processRoot).catch(() => null);
    if (!stat || stat.uid !== uid) continue;
    const threadEntries = await fs.readdir(path.join(processRoot, "task"), { withFileTypes: true }).catch(() => []);
    tasks += threadEntries.filter((thread) => thread.isDirectory() && /^\d+$/.test(thread.name)).length;
  }
  if (!tasks) throw new EvolutionExecutorError("PROCESS_BASELINE_UNAVAILABLE", "no current user tasks found");
  return tasks;
}

export function redactExecutionText(input, secretValues = []) {
  let text = String(input ?? "");
  for (const secret of secretValues.map(String).filter((value) => value.length >= 4).sort((a, b) => b.length - a.length)) {
    text = text.split(secret).join("[REDACTED]");
  }
  return text.replace(/\b(api[_-]?key|access[_-]?token|token|secret|password)\s*[:=]\s*([^\s,;]+)/gi, "$1=[REDACTED]");
}

export function buildSandboxCommand(input) {
  const workspaceRoot = path.resolve(input.workspaceRoot);
  const limits = normalizeLimits(input.limits);
  const { command, args } = normalizeArgv(input.command, input.args ?? []);
  const environment = normalizeEnvironment(input.environment);
  const bwrapPath = input.bwrapPath ?? "/usr/bin/bwrap";
  const prlimitPath = input.prlimitPath ?? "/usr/bin/prlimit";
  const bwrapArgs = [
    "--die-with-parent", "--new-session", "--unshare-net", "--unshare-pid", "--unshare-uts",
    "--unshare-ipc", "--cap-drop", "ALL", "--clearenv", "--tmpfs", "/", "--proc", "/proc",
    "--dev", "/dev", "--ro-bind", "/usr", "/usr", "--ro-bind-try", "/lib", "/lib",
    "--ro-bind-try", "/lib64", "/lib64", "--dir", "/etc", "--ro-bind-try",
    "/etc/ld.so.cache", "/etc/ld.so.cache", "--tmpfs", "/tmp", "--dir", "/tmp/home",
    "--ro-bind", workspaceRoot, "/workspace"
  ];
  for (const binding of input.writableBindings ?? []) {
    const source = path.resolve(binding.source);
    const target = path.posix.normalize(String(binding.target));
    if (!inside(workspaceRoot, source) || !target.startsWith("/workspace/") || binding.writable !== true) {
      throw new EvolutionExecutorError("INVALID_SANDBOX_BINDING", `${source} -> ${target}`);
    }
    bwrapArgs.push("--bind", source, target);
  }
  for (const binding of input.maskedBindings ?? []) {
    const rawTarget = String(binding?.target ?? "");
    const target = path.posix.normalize(rawTarget);
    if (target !== rawTarget || !target.startsWith("/workspace/") ||
        !new Set(["file", "directory"]).has(binding?.type)) {
      throw new EvolutionExecutorError("INVALID_SANDBOX_MASK", rawTarget);
    }
    if (binding.type === "directory") bwrapArgs.push("--tmpfs", target);
    else bwrapArgs.push("--ro-bind", "/dev/null", target);
  }
  bwrapArgs.push(
    "--chdir", "/workspace",
    "--setenv", "PATH", "/usr/bin:/bin",
    "--setenv", "HOME", "/tmp/home",
    "--setenv", "TMPDIR", "/tmp",
    "--setenv", "LANG", "C.UTF-8"
  );
  for (const [key, value] of Object.entries(environment).sort(([left], [right]) => left.localeCompare(right))) {
    bwrapArgs.push("--setenv", key, value);
  }
  bwrapArgs.push("--", sandboxExecutable(command, workspaceRoot), ...args);
  const cpuSeconds = Math.max(1, Math.ceil(limits.timeoutMs / 1000) + 1);
  const hostProcessCount = Number.isSafeInteger(input.hostProcessCount) && input.hostProcessCount >= 0
    ? input.hostProcessCount
    : 0;
  const nprocLimit = hostProcessCount + limits.maxProcesses;
  return Object.freeze({
    executable: prlimitPath,
    args: Object.freeze([
      `--nproc=${nprocLimit}:${nprocLimit}`,
      `--as=${limits.maxMemoryBytes}:${limits.maxMemoryBytes}`,
      `--fsize=${limits.maxFileBytes}:${limits.maxFileBytes}`,
      `--cpu=${cpuSeconds}:${cpuSeconds}`,
      "--",
      bwrapPath,
      ...bwrapArgs
    ]),
    limits,
    environment,
    commandHash: hashJson({ command, args }),
    environmentHash: hashJson(environment)
  });
}

async function directorySize(root) {
  let total = 0;
  const pending = [root];
  while (pending.length) {
    const current = pending.pop();
    const entries = await fs.readdir(current, { withFileTypes: true }).catch((error) => {
      if (error.code === "ENOENT") return [];
      throw error;
    });
    for (const entry of entries) {
      const candidate = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(candidate);
      else if (entry.isFile()) total += (await fs.lstat(candidate)).size;
    }
  }
  return total;
}

function terminateProcessGroup(child, signal) {
  if (!child?.pid) return;
  try {
    process.kill(-child.pid, signal);
  } catch {
    try {
      child.kill(signal);
    } catch {
      // The process already exited.
    }
  }
}

export class EvolutionExecutor {
  constructor({ runStore = null, spawnImpl = spawn, bwrapPath = "/usr/bin/bwrap", prlimitPath = "/usr/bin/prlimit" } = {}) {
    this.runStore = runStore;
    this.spawnImpl = spawnImpl;
    this.bwrapPath = bwrapPath;
    this.prlimitPath = prlimitPath;
  }

  async execute(input) {
    const startedAt = new Date();
    const startedClock = performance.now();
    const workspaceRoot = await fs.realpath(input.workspaceRoot);
    await Promise.all([
      fs.access(this.bwrapPath, fs.constants.X_OK),
      fs.access(this.prlimitPath, fs.constants.X_OK)
    ]).catch((error) => {
      throw new EvolutionExecutorError("SANDBOX_UNAVAILABLE", error.message);
    });
    const hostProcessCount = await currentUserTaskCount();
    const invocation = buildSandboxCommand({
      ...input,
      workspaceRoot,
      hostProcessCount,
      bwrapPath: this.bwrapPath,
      prlimitPath: this.prlimitPath
    });
    const initialDiskBytes = await directorySize(workspaceRoot);
    const stdoutChunks = [];
    const stderrChunks = [];
    let capturedBytes = 0;
    let settled = false;
    let termination = null;
    let child;
    let killTimer;
    let timeoutTimer;
    let diskTimer;
    let diskCheckActive = false;
    const violations = [];

    const requestTermination = (reason, status) => {
      if (termination) return;
      termination = { reason, status };
      violations.push(reason);
      terminateProcessGroup(child, "SIGTERM");
      killTimer = setTimeout(() => terminateProcessGroup(child, "SIGKILL"), invocation.limits.killGraceMs);
      killTimer.unref?.();
    };

    const capture = (target, chunk) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      const remaining = Math.max(0, invocation.limits.maxOutputBytes - capturedBytes);
      if (remaining) target.push(buffer.subarray(0, remaining));
      capturedBytes += Math.min(buffer.length, remaining);
      if (buffer.length > remaining) requestTermination("OUTPUT_LIMIT_EXCEEDED", "failure");
    };

    const exit = await new Promise((resolve) => {
      if (input.signal?.aborted) {
        termination = { reason: "CANCELLED", status: "cancelled" };
        resolve({ code: null, signal: null, spawnError: null });
        return;
      }
      try {
        child = this.spawnImpl(invocation.executable, invocation.args, {
          cwd: workspaceRoot,
          env: {},
          detached: true,
          stdio: ["ignore", "pipe", "pipe"]
        });
      } catch (error) {
        resolve({ code: null, signal: null, spawnError: error });
        return;
      }
      child.stdout?.on("data", (chunk) => capture(stdoutChunks, chunk));
      child.stderr?.on("data", (chunk) => capture(stderrChunks, chunk));
      const finish = (value) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };
      child.once("error", (error) => finish({ code: null, signal: null, spawnError: error }));
      child.once("close", (code, signal) => finish({ code, signal, spawnError: null }));
      timeoutTimer = setTimeout(() => requestTermination("WALL_TIME_LIMIT_EXCEEDED", "timeout"), invocation.limits.timeoutMs);
      timeoutTimer.unref?.();
      const abort = () => requestTermination("CANCELLED", "cancelled");
      input.signal?.addEventListener("abort", abort, { once: true });
      child.once("close", () => input.signal?.removeEventListener("abort", abort));
      diskTimer = setInterval(async () => {
        if (diskCheckActive || settled) return;
        diskCheckActive = true;
        try {
          const current = await directorySize(workspaceRoot);
          if (current - initialDiskBytes > invocation.limits.maxDiskBytes) {
            requestTermination("DISK_LIMIT_EXCEEDED", "failure");
          }
        } catch {
          requestTermination("DISK_AUDIT_FAILED", "infrastructure_error");
        } finally {
          diskCheckActive = false;
        }
      }, invocation.limits.diskPollMs);
      diskTimer.unref?.();
    });

    clearTimeout(timeoutTimer);
    clearTimeout(killTimer);
    clearInterval(diskTimer);
    if (exit.signal === "SIGXFSZ" && !violations.includes("FILE_SIZE_LIMIT_EXCEEDED")) {
      violations.push("FILE_SIZE_LIMIT_EXCEEDED");
    }

    let status = termination?.status ?? (exit.spawnError ? "infrastructure_error" : exit.code === 0 ? "success" : "failure");
    if (typeof input.postRunAudit === "function") {
      try {
        await input.postRunAudit();
      } catch (error) {
        status = "failure";
        violations.push(error.code ?? "POST_RUN_AUDIT_FAILED");
      }
    }

    const secretValues = input.secretValues ?? [];
    const stdout = redactExecutionText(Buffer.concat(stdoutChunks).toString("utf8"), secretValues);
    const stderrBase = exit.spawnError ? `${Buffer.concat(stderrChunks).toString("utf8")}\n${exit.spawnError.message}` : Buffer.concat(stderrChunks).toString("utf8");
    const stderr = redactExecutionText(stderrBase, secretValues);
    let stdoutArtifact = null;
    let stderrArtifact = null;
    if (this.runStore && input.runId) {
      try {
        if (stdout) stdoutArtifact = await this.runStore.putBlob(input.runId, stdout);
        if (stderr) stderrArtifact = await this.runStore.putBlob(input.runId, stderr);
      } catch {
        status = "infrastructure_error";
        violations.push("OUTPUT_PERSISTENCE_FAILED");
      }
    }

    return Object.freeze({
      executionVersion: "ds4_evolution_execution_v1",
      revision: input.revision,
      status,
      exitCode: Number.isInteger(exit.code) ? exit.code : null,
      signal: exit.signal ?? null,
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      durationMs: Math.max(0, Math.round(performance.now() - startedClock)),
      stdoutArtifact,
      stderrArtifact,
      stdoutPreview: stdout.slice(0, invocation.limits.previewBytes),
      stderrPreview: stderr.slice(0, invocation.limits.previewBytes),
      outputTruncated: violations.includes("OUTPUT_LIMIT_EXCEEDED"),
      violations: Object.freeze([...new Set(violations)]),
      reproducibility: Object.freeze({
        commandHash: invocation.commandHash,
        environmentHash: invocation.environmentHash,
        sandbox: "bubblewrap",
        network: "disabled"
      }),
      resourceUsage: Object.freeze({ maxRssBytes: null, cpuTimeMs: null })
    });
  }
}
