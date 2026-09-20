// Lean 4 path utilities for ds4-studio
// Safe session/run ID sanitization, directory creation, and cleanup.

import { lstat, mkdir, readdir, readFile, realpath, rename, rm, rmdir, writeFile } from "fs/promises";
import { existsSync } from "fs";
import { resolve, sep, normalize } from "path";
import { randomBytes } from "crypto";

const SESSION_ID_RE = /^[a-zA-Z0-9_-]{1,128}$/;

// Single production run-ID format: the last segment must be decimal because
// sanitizeLeanRunId validates the whole id against this regex, and the route's
// old hex nonce matched it only ~2% of the time.
export const RUN_ID_RE = /^lean-[a-f0-9]{12}-[0-9]+-[0-9]+$/;

// A proof id groups every repair attempt of one theorem: runId changes per
// attempt, proofId does not. Same shape as the run id so the same path-safety
// rules apply without a second sanitizer to keep in sync.
export const PROOF_ID_RE = /^proof-[a-f0-9]{12}-[0-9]+-[0-9]+$/;

/**
 * Create a production-conformant run ID.
 *
 * Every producer (HTTP route, JS agent bridge, C native client) must use this
 * factory so no caller can generate an id the sanitizer rejects. The nonce is
 * a decimal uint32 read from random bytes, never hex.
 *
 * @param {object} [opts]
 * @param {function} [opts.now] - Clock, injectable for tests
 * @param {function} [opts.randomBytes] - crypto.randomBytes-like, injectable
 * @returns {string}
 */
export function createLeanRunId({ now = Date.now, randomBytes: rng = randomBytes } = {}) {
  const entropy = rng(6).toString("hex");
  const nonce = rng(4).readUInt32BE(0);
  return `lean-${entropy}-${now()}-${nonce}`;
}

/**
 * Sanitize a session ID value.
 * Returns the trimmed string or null if invalid.
 */
export function sanitizeLeanSessionId(value) {
  if (!value || typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 256) return null;
  // Allow alphanumeric, underscore, hyphen only
  if (!/^[a-zA-Z0-9_-]{1,256}$/.test(trimmed)) return null;
  return trimmed;
}

/**
 * Sanitize a run ID value.
 * Returns the trimmed string or null if invalid.
 */
export function sanitizeLeanRunId(value) {
  if (!value || typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!RUN_ID_RE.test(trimmed)) return null;
  return trimmed;
}

/**
 * Create a proof ID: one per proof task, stable across its repair attempts.
 *
 * @param {object} [opts]
 * @param {function} [opts.now] - Clock, injectable for tests
 * @param {function} [opts.randomBytes] - crypto.randomBytes-like, injectable
 * @returns {string}
 */
export function createLeanProofId({ now = Date.now, randomBytes: rng = randomBytes } = {}) {
  const entropy = rng(6).toString("hex");
  const nonce = rng(4).readUInt32BE(0);
  return `proof-${entropy}-${now()}-${nonce}`;
}

/**
 * Sanitize a proof ID value.
 * Returns the trimmed string or null if invalid.
 */
export function sanitizeLeanProofId(value) {
  if (!value || typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!PROOF_ID_RE.test(trimmed)) return null;
  return trimmed;
}

/**
 * Assert that a name is safe for use as a file/directory component.
 * Throws on invalid characters.
 */
export function assertSafeLeanName(value, fieldName) {
  if (!value || typeof value !== "string") {
    throw new Error(`${fieldName}: must be a non-empty string`);
  }
  if (/[<>:"\\|?*\x00-\x1f]/.test(value)) {
    throw new Error(`${fieldName}: contains forbidden characters`);
  }
  if (value.includes("..")) {
    throw new Error(`${fieldName}: path traversal detected (..)`);
  }
  if (value.startsWith("/") || value.startsWith("\\")) {
    throw new Error(`${fieldName}: absolute path not allowed`);
  }
}

/**
 * Create a run directory and verify it's within the runs root.
 *
 * @param {object} config - Lean configuration
 * @param {{ sessionId: string, runId: string }} ids
 * @returns {Promise<string>} Absolute path to the created run directory
 */
export async function createLeanRunDirectory(config, { sessionId, runId }) {
  const safeSession = sanitizeLeanSessionId(sessionId);
  if (!safeSession) throw new Error(`LEAN_SESSION_ID_INVALID: ${JSON.stringify(sessionId)}`);

  const safeRun = sanitizeLeanRunId(runId);
  if (!safeRun) throw new Error(`LEAN_RUN_ID_INVALID: ${JSON.stringify(runId)} does not match ${RUN_ID_RE}`);

  const runsRoot = resolve(config.runsRoot);
  const sessionDir = resolve(runsRoot, safeSession);
  const runDir = resolve(sessionDir, safeRun);

  // Verify both paths are under runsRoot
  await assertPathWithin(runsRoot, sessionDir);
  await assertPathWithin(runsRoot, runDir);

  // Create with restrictive permissions
  await mkdir(sessionDir, { recursive: true, mode: 0o700 });
  await mkdir(runDir, { mode: 0o700 });

  // Verify realpath matches (no symlink tricks)
  const realRunDir = await realpath(runDir);
  if (realRunDir !== runDir) {
    throw new Error(`Run directory symlink detected: ${runDir}`);
  }

  return runDir;
}

/**
 * Assert that candidate is a child of root (or equal).
 * Both must be absolute and canonical.
 */
export async function assertPathWithin(root, candidate) {
  const absRoot = resolve(root);
  const absCandidate = resolve(candidate);
  if (!absCandidate.startsWith(absRoot + sep) && absCandidate !== absRoot) {
    throw new Error(`Path escape: ${candidate} not within ${root}`);
  }
}

/**
 * Clean up a run directory. Idempotent — does not throw if already gone.
 */
export async function cleanupLeanRunDirectory(runDir) {
  try {
    await rm(runDir, { recursive: true, force: true });
  } catch {
    // Already removed or non-existent
  }
}

/**
 * Relative path of an artifact inside a run directory, relative to runsRoot.
 *
 * Single place that builds these paths so callers never hand-interpolate
 * sessionId/runId into artifact paths (§6.19).
 *
 * @param {string} sessionId - Sanitized session id
 * @param {string} runId - Sanitized run id
 * @param {string} fileName - Artifact file name (e.g. "Main.lean")
 * @returns {string} `sessionId/runId/fileName`
 */
export function leanArtifactRelativePath(sessionId, runId, fileName) {
  return `${sessionId}/${runId}/${fileName}`;
}

/**
 * Record one attempt in the session's proof index.
 *
 * The on-disk layout stays `<runsRoot>/<sessionId>/<runId>/` — moving every run
 * under a proof directory would break the retention sweep and the registry for
 * no gain right now. `proof.json` supplies the missing grouping instead: which
 * runs belong to which proof task, in order.
 *
 * Best effort by design: losing the index must never turn a completed check
 * into a failure.
 *
 * @param {object} config - Lean config (uses runsRoot)
 * @param {{ sessionId: string, proofId: string, runId: string, attempt: number,
 *   status: string, sourceSha256?: string }} entry
 */
export async function appendLeanProofIndex(config, entry) {
  const safeSession = sanitizeLeanSessionId(entry?.sessionId);
  const safeProof = sanitizeLeanProofId(entry?.proofId);
  const safeRun = sanitizeLeanRunId(entry?.runId);
  if (!safeSession || !safeProof || !safeRun || !config?.runsRoot) return;

  const runsRoot = resolve(config.runsRoot);
  const sessionDir = resolve(runsRoot, safeSession);
  await assertPathWithin(runsRoot, sessionDir);
  const indexPath = resolve(sessionDir, "proof.json");

  let index = { schemaVersion: 1, proofs: {} };
  try {
    const parsed = JSON.parse(await readFile(indexPath, "utf8"));
    if (parsed && typeof parsed.proofs === "object" && parsed.proofs) index = parsed;
  } catch {
    // Missing or corrupt index: start a fresh one rather than losing the run.
  }

  const attempts = Array.isArray(index.proofs[safeProof]) ? index.proofs[safeProof] : [];
  attempts.push({
    runId: safeRun,
    attempt: Number.isInteger(entry.attempt) ? entry.attempt : attempts.length + 1,
    status: String(entry.status || ""),
    sourceSha256: entry.sourceSha256 || null,
    at: new Date().toISOString(),
  });
  index.proofs[safeProof] = attempts;

  const tmpPath = `${indexPath}.tmp`;
  await writeFile(tmpPath, JSON.stringify(index, null, 2), { mode: 0o600 });
  await rename(tmpPath, indexPath);
}

/**
 * Prune run directories older than retentionHours.
 *
 * Ages individual *runs*, not session directories: a session's mtime is bumped
 * every time a new run is created inside it, so ageing at session level would
 * keep every old run of an active session alive forever.
 *
 * Retention is differentiated (R9): runs carrying an `error.json` whose
 * category is `infrastructure` keep their diagnostic evidence for
 * `infraRetentionHours`; everything else (successes, Lean failures, timeouts)
 * is pruned after `retentionHours`. Invalid requests never create a run
 * directory, so there is nothing to retain or prune for them.
 *
 * Never follows symlinks — an attacker-planted link must not turn retention
 * into an arbitrary delete.
 *
 * @param {object} config - Lean configuration
 * @param {number} [now] - Current time in ms, injectable for tests
 * @returns {Promise<{ removed: string[] }>}
 */
export async function pruneExpiredLeanRuns(config, now = Date.now()) {
  const removed = [];
  const runsRoot = config.runsRoot;
  if (!runsRoot || !existsSync(runsRoot) || !(config.retentionHours > 0)) {
    return { removed };
  }

  const defaultMaxAgeMs = config.retentionHours * 3600 * 1000;
  const infraMaxAgeMs = config.infraRetentionHours > 0
    ? config.infraRetentionHours * 3600 * 1000
    : defaultMaxAgeMs;

  let sessions;
  try {
    sessions = await readdir(runsRoot, { withFileTypes: true });
  } catch {
    return { removed };
  }

  for (const session of sessions) {
    if (!session.isDirectory() || session.isSymbolicLink()) continue;
    const sessionDir = resolve(runsRoot, session.name);

    let runs;
    try {
      runs = await readdir(sessionDir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const run of runs) {
      if (!run.isDirectory() || run.isSymbolicLink()) continue;
      const runDir = resolve(sessionDir, run.name);
      try {
        const st = await lstat(runDir);
        if (!st.isDirectory()) continue;
        const maxAgeMs = (await readErrorArtifactCategory(runDir)) === "infrastructure"
          ? infraMaxAgeMs
          : defaultMaxAgeMs;
        if (now - st.mtimeMs <= maxAgeMs) continue;
        await rm(runDir, { recursive: true, force: true });
        removed.push(`${session.name}/${run.name}`);
      } catch {
        // Skip inaccessible entries; retention is best effort.
      }
    }

    // Drop the session directory once its last run is gone. rmdir refuses a
    // non-empty directory, so a run created since the readdir above survives.
    try {
      await rmdir(sessionDir);
    } catch {
      // Not empty, or raced with a new run. The next pass will catch it.
    }
  }

  return { removed };
}

/**
 * Read the failure category off a run's error artifact, if present.
 *
 * @param {string} runDir
 * @returns {Promise<string|null>} "infrastructure" | "lean" | null
 */
async function readErrorArtifactCategory(runDir) {
  try {
    const buf = await readFile(resolve(runDir, "error.json"), "utf8");
    const data = JSON.parse(buf);
    return data && typeof data.category === "string" ? data.category : null;
  } catch {
    return null;
  }
}
