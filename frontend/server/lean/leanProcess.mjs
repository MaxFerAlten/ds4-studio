// Lean 4 bounded process runner for ds4-studio
// Spawns a child process with resource limits and timeout.
// Never uses exec or shell strings.
//
// R9 (§6.12): output is accumulated as Buffers and measured in bytes, never
// UTF-16 code units; after a limit is hit the stream keeps being drained and
// the bytes are discarded instead of destroying the pipe (a destroyed pipe can
// EPIPE the child and changes its behaviour); UTF-8 is decoded once at the end
// with multibyte-boundary handling; the AbortSignal listener is removed on
// settlement; SIGTERM vs SIGKILL escalation is reported honestly; kill errors
// only swallow ESRCH/EPERM.

import { spawn } from "node:child_process";

// Kill attempts against a process group that is already gone are the normal
// race between a SIGTERM and the child exiting. Everything else is worth a log
// line because it usually means the parent could not signal its own child.
const IGNORED_KILL_ERRORS = new Set(["ESRCH", "EPERM"]);

// The two shutdown windows a run can spend *after* its own timeoutMs has
// expired. Exported because they are not an implementation detail: the native
// client's transport deadline must exceed timeoutMs + both of these, and
// leanTransportDeadline.test.mjs proves that arithmetic against the C constant.
export const LEAN_PROCESS_KILL_GRACE_MS = 500;
export const LEAN_PROCESS_SETTLE_TIMEOUT_MS = 2000;

/**
 * Drop a trailing incomplete UTF-8 sequence so a byte-boundary truncation never
 * decodes into a synthetic U+FFFD (and never emits a lone surrogate). The
 * returned buffer is a valid UTF-8 prefix of the original.
 *
 * @param {Buffer} buf
 * @returns {Buffer}
 */
export function trimTrailingPartialUtf8(buf) {
  if (buf.length === 0) return buf;
  // Ends on ASCII -> the last codepoint is complete.
  if (buf[buf.length - 1] < 0x80) return buf;
  // Walk back over trailing continuation bytes to the sequence's lead byte.
  let i = buf.length - 1;
  while (i > 0 && (buf[i] & 0xc0) === 0x80) i -= 1;
  const lead = buf[i];
  let width;
  if (lead >= 0xf0) width = 4;
  else if (lead >= 0xe0) width = 3;
  else if (lead >= 0xc0) width = 2;
  else return buf; // stray continuation bytes without a lead — leave as-is
  const have = buf.length - i;
  // A lead byte whose continuation bytes never arrived is an incomplete
  // sequence: trim it (plus any trailing continuations) so the truncation
  // boundary never decodes into a synthetic U+FFFD.
  return have >= width ? buf : buf.subarray(0, i);
}

/**
 * Decode a collection of Buffers into a byte-accurate UTF-8 string.
 * Concatenation + single decode means a multibyte codepoint spanning two
 * chunks is reassembled, never mojibake'd.
 *
 * @param {Buffer[]} chunks
 * @param {number} bytes
 * @returns {string}
 */
export function decodeLeanOutput(chunks, bytes) {
  if (bytes === 0) return "";
  const buf = Buffer.concat(chunks, bytes);
  return trimTrailingPartialUtf8(buf).toString("utf8");
}

/**
 * Run a bounded child process.
 *
 * @param {object} spec - Process specification
 * @param {string} spec.command - Executable path
 * @param {string[]} spec.args - Argument array (never shell string)
 * @param {string} spec.cwd - Working directory
 * @param {object} spec.env - Environment variables (allowlisted)
 * @param {number} spec.timeoutMs - Timeout in milliseconds
 * @param {number} spec.stdoutLimit - Max stdout bytes to buffer
 * @param {number} spec.stderrLimit - Max stderr bytes to buffer
 * @param {AbortSignal} [spec.abortSignal] - Optional abort signal
 * @param {number} [spec.killGraceMs=500] - Grace between SIGTERM and SIGKILL
 * @param {number} [spec.settleTimeoutMs=2000] - Max wait for the child's exit
 *   event after SIGKILL before the result is force-settled
 * @param {boolean} [spec.detached=true] - Create new process group on Linux
 * @param {object} [spec.logger] - Optional `{ warn() }` for kill failures
 * @param {string|Buffer|null} [spec.input=null] - Written to stdin and closed.
 *   With no input stdin stays closed, which is what the Lean callers want.
 * @param {string} [spec.logTag="lean_process"] - Log tag; this runner is shared
 *   with the Sage bridge, which must not report itself as Lean.
 * @returns {Promise<object>}
 */
export async function runBoundedProcess(spec) {
  const {
    command,
    args,
    cwd,
    env,
    timeoutMs,
    stdoutLimit = 64 * 1024,
    stderrLimit = 128 * 1024,
    abortSignal,
    killGraceMs = LEAN_PROCESS_KILL_GRACE_MS,
    settleTimeoutMs = LEAN_PROCESS_SETTLE_TIMEOUT_MS,
    detached = true,
    logger = null,
    input = null,
    logTag = "lean_process",
  } = spec;

  const warn = (msg) => {
    try {
      if (typeof logger?.warn === "function") logger.warn(logTag, { message: msg });
      else console.warn(`[${logTag}] ${msg}`);
    } catch {
      // Logging is best effort and must never fail a run.
    }
  };

  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    let termReason = null; // "timeout" | "cancel" | null
    let settled = false;
    let sigtermSent = false;
    let sigkillSent = false;
    const stdoutChunks = [];
    const stderrChunks = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let timer = null;
    let killTimer = null;
    let settleTimer = null;
    let childPid = null;

    // Spawn the process. The child must be in its own process group so the
    // whole tree (including grandchildren the sandbox starts) can be signalled.
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: [input == null ? "ignore" : "pipe", "pipe", "pipe"],
      detached,
      shell: false,
    });

    childPid = child.pid;

    if (input != null && child.stdin) {
      // A child that exits before reading its input makes the write EPIPE; that
      // is the child's business, not a runner failure, so it must not reject.
      child.stdin.on("error", () => {});
      child.stdin.end(input);
    }

    // Byte-bounded collection: keep the Buffer up to the limit, then keep
    // consuming (draining) and drop everything past it. The stream must never
    // be destroyed: destroying the pipe can EPIPE the child mid-write and
    // alter what we are trying to measure.
    const collect = (chunks, ref, limit) => (chunk) => {
      if (ref.truncated) return;
      const remaining = limit - ref.count;
      if (chunk.length <= remaining) {
        chunks.push(chunk);
        ref.count += chunk.length;
      } else {
        if (remaining > 0) chunks.push(chunk.subarray(0, remaining));
        ref.count = limit;
        ref.truncated = true;
      }
    };

    const stdoutRef = { count: 0, truncated: false };
    const stderrRef = { count: 0, truncated: false };
    const onStdout = collect(stdoutChunks, stdoutRef, stdoutLimit);
    const onStderr = collect(stderrChunks, stderrRef, stderrLimit);
    child.stdout?.on("data", onStdout);
    child.stderr?.on("data", onStderr);

    const decodeStdout = () => decodeLeanOutput(stdoutChunks, stdoutRef.count);
    const decodeStderr = () => decodeLeanOutput(stderrChunks, stderrRef.count);

    // Send a signal to the child's process group. Only ESRCH (group already
    // gone — the normal SIGTERM/exit race) is ignored; anything else is logged
    // without sensitive payloads.
    const killGroup = (pid, signal, what) => {
      if (!pid) return;
      try {
        process.kill(-pid, signal);
      } catch (err) {
        if (!IGNORED_KILL_ERRORS.has(err.code)) {
          warn(`kill(${what}) failed: code=${err.code || err.message}`);
        }
      }
    };

    // Escalate SIGTERM -> SIGKILL. The first termination reason (timeout or
    // cancel) wins; a second terminate() while the grace timer runs is a no-op.
    const terminate = (reason) => {
      if (settled || sigkillSent || termReason) return;
      termReason = reason;

      sigtermSent = true;
      killGroup(childPid, "SIGTERM", reason);
      clearTimeout(killTimer);
      killTimer = setTimeout(() => {
        killTimer = null;
        if (settled) return;
        sigkillSent = true;
        killGroup(childPid, "SIGKILL", "grace-expired");
        clearTimeout(settleTimer);
        settleTimer = setTimeout(() => {
          settleTimer = null;
          settle();
        }, settleTimeoutMs);
      }, killGraceMs);
    };

    const cleanup = () => {
      clearTimeout(timer);
      clearTimeout(killTimer);
      clearTimeout(settleTimer);
      timer = killTimer = settleTimer = null;
      if (abortSignal && onAbort) abortSignal.removeEventListener("abort", onAbort);
    };

    // Single settlement point. child.exitCode/signalCode are populated by the
    // time this runs (either the exit event or a forced settle after SIGKILL).
    const settle = () => {
      if (settled) return;
      settled = true;
      cleanup();

      const terminated = termReason !== null;
      const exitObserved = child.exitCode !== null || child.signalCode !== null;
      const signal = exitObserved
        ? child.signalCode
        : sigkillSent
          ? "SIGKILL"
          : sigtermSent
            ? "SIGTERM"
            : null;

      resolve({
        exitCode: terminated ? null : child.exitCode,
        signal,
        timedOut: termReason === "timeout",
        cancelled: termReason === "cancel",
        durationMs: Date.now() - startTime,
        stdout: decodeStdout(),
        stderr: decodeStderr(),
        stdoutBytes: stdoutRef.count,
        stderrBytes: stderrRef.count,
        stdoutTruncated: stdoutRef.truncated,
        stderrTruncated: stderrRef.truncated,
        sigtermSent,
        sigkillSent,
        pid: childPid,
      });
    };

    // Timeout handling
    timer = setTimeout(() => terminate("timeout"), timeoutMs);

    // Abort signal handling — kept as a named listener so it can be removed on
    // settlement instead of leaking on the normal exit path.
    let onAbort = null;
    if (abortSignal) {
      onAbort = () => terminate("cancel");
      abortSignal.addEventListener("abort", onAbort, { once: true });
    }

    // Normal exit — including exit during the SIGTERM grace window. Whether the
    // result is marked timedOut/cancelled is decided by termReason, so an exit
    // after a timeout reports the timeout, not a clean exit.
    child.on("exit", settle);

    // Spawn failure (bad binary, missing interpreter, ...). Nothing was
    // buffered and there is no process to signal.
    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err);
    });
  });
}
