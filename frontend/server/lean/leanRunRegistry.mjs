// Lean 4 run registry — in-flight and completed run accounting with ownership,
// TTL and capacity bounds.
//
// Ownership: every entry is keyed by sessionId + runId, so session A can never
// read, cancel or reuse a run that belongs to session B. The keys are only
// formed from sanitized ids, so a colon or path-traversal attempt is rejected
// before it ever touches the Map.
//
// Concurrency: reserve() enforces a global ceiling (maxGlobalRuns) and a
// per-session ceiling (maxRunsPerSession). R6 rejects with 429
// LEAN_CONCURRENCY_LIMIT instead of spawning; maxQueuedPerSession is the
// allowance for a future explicit queue and currently just widens nothing —
// per-session in-flight runs are capped at maxRunsPerSession.

import { sanitizeLeanRunId, sanitizeLeanSessionId } from "./leanPaths.mjs";

const DEFAULT_CAPACITY = 64;
const DEFAULT_TTL_MS = 3600 * 1000;

/** Contract-shaped registry error. */
function registryError(code, message, statusCode, extra = {}) {
  return { ok: false, error: { code, message, statusCode, extra } };
}

export class LeanRunRegistry {
  /**
   * @param {object} [options]
   * @param {number} [options.maxGlobalRuns]
   * @param {number} [options.maxRunsPerSession]
   * @param {number} [options.maxQueuedPerSession]
   * @param {number} [options.capacity] - Max concurrent entries in memory.
   * @param {number} [options.ttlMs] - Completed results are pruned after this.
   * @param {Function} [options.now] - Clock, injectable for tests.
   */
  constructor({
    maxGlobalRuns = 2,
    maxRunsPerSession = 1,
    maxQueuedPerSession = 1,
    capacity = DEFAULT_CAPACITY,
    ttlMs = DEFAULT_TTL_MS,
    now = Date.now,
  } = {}) {
    this.maxGlobalRuns = maxGlobalRuns;
    this.maxRunsPerSession = maxRunsPerSession;
    this.maxQueuedPerSession = maxQueuedPerSession;
    this.capacity = capacity;
    this.ttlMs = ttlMs;
    this._now = now;

    this._runs = new Map();
    this._bySession = new Map();
  }

  get size() {
    return this._runs.size;
  }

  /** Number of in-flight (running/queued) runs across all sessions. */
  activeGlobalRuns() {
    return this._countActive();
  }

  /** Number of in-flight (running/queued) runs for one session. */
  activeSessionRuns(sessionId) {
    const s = sanitizeLeanSessionId(sessionId);
    if (!s) return 0;
    return this._countActive(s);
  }

  /** Raw iteration over entries (key -> entry). For introspection/tests. */
  entries() {
    return this._runs.entries();
  }

  /**
   * Reserve a run slot, or return a cached result / a contract error.
   *
   * Return values:
   * - `{ ok: true, entry }` — slot reserved, the caller must execute;
   * - `{ ok: true, cached: true, entry }` — completed run with the same source,
   *   the caller must return the cached result without spawning;
   * - `{ ok: false, error }` — contract error (conflict, concurrency, invalid
   *   ids), the caller must respond and not touch the executor.
   *
   * @param {{ sessionId: string, runId: string, sourceSha: string }} input
   */
  reserve({ sessionId, runId, sourceSha }) {
    const s = sanitizeLeanSessionId(sessionId);
    const r = sanitizeLeanRunId(runId);
    if (!s) return registryError("LEAN_SESSION_ID_INVALID", "sessionId is invalid.", 400);
    if (!r) return registryError("LEAN_RUN_ID_INVALID", `runId '${runId}' is invalid or not sanitizable.`, 422);

    this.prune();

    const key = `${s}:${r}`;
    const existing = this._runs.get(key);
    if (existing) {
      if (existing.sourceSha === sourceSha) {
        if (existing.status === "completed") return { ok: true, cached: true, entry: existing };
        return registryError(
          "LEAN_RUN_ID_CONFLICT",
          `run ${runId} is still running.`,
          409,
          { runId, sessionId: s }
        );
      }
      return registryError(
        "LEAN_RUN_ID_REUSED_WITH_DIFFERENT_INPUT",
        `run ${runId} was already submitted with different source.`,
        409,
        { runId, sessionId: s }
      );
    }

    if (this._countActive() >= this.maxGlobalRuns) {
      return registryError("LEAN_CONCURRENCY_LIMIT", "Global run concurrency limit reached.", 429);
    }
    if (this._countActive(s) >= this.maxRunsPerSession) {
      return registryError("LEAN_CONCURRENCY_LIMIT", "Per-session run concurrency limit reached.", 429);
    }

    if (this._runs.size >= this.capacity) {
      this._evictOldestCompleted();
      if (this._runs.size >= this.capacity) {
        return registryError("LEAN_CONCURRENCY_LIMIT", "Run registry is full.", 429);
      }
    }

    const now = this._now();
    const entry = {
      sessionId: s,
      runId: r,
      sourceSha,
      status: "running",
      result: null,
      httpStatus: null,
      abortController: new AbortController(),
      createdAt: now,
      updatedAt: now,
    };
    this._runs.set(key, entry);

    let keys = this._bySession.get(s);
    if (!keys) {
      keys = new Set();
      this._bySession.set(s, keys);
    }
    keys.add(key);

    return { ok: true, entry };
  }

  /**
   * Mark a reserved run as completed with its final result.
   * No-op when the entry is gone (pruned/evicted).
   *
   * @returns {boolean} true when the entry was found and completed
   */
  complete({ sessionId, runId, result, httpStatus }) {
    const entry = this.get({ sessionId, runId });
    if (!entry) return false;
    entry.status = "completed";
    entry.result = result;
    entry.httpStatus = httpStatus;
    entry.updatedAt = this._now();
    return true;
  }

  /**
   * Look up a run owned by the session. Ownership is enforced by the key, so
   * another session cannot see it.
   *
   * @returns {object|undefined}
   */
  get({ sessionId, runId }) {
    const s = sanitizeLeanSessionId(sessionId);
    const r = sanitizeLeanRunId(runId);
    if (!s || !r) return undefined;
    return this._runs.get(`${s}:${r}`);
  }

  /**
   * Cancel a running run. Idempotent: the first call aborts, later calls
   * report the run is no longer running without aborting again.
   *
   * @returns {{ found: boolean, cancelled: boolean, reason?: string }}
   */
  cancel({ sessionId, runId }) {
    const entry = this.get({ sessionId, runId });
    if (!entry) return { found: false, cancelled: false };
    if (entry.status === "completed") {
      return { found: true, cancelled: false, reason: "already completed" };
    }
    if (entry.status === "cancelled") {
      return { found: true, cancelled: false, reason: "already cancelled" };
    }
    entry.abortController?.abort();
    entry.status = "cancelled";
    entry.updatedAt = this._now();
    return { found: true, cancelled: true };
  }

  /**
   * Drop a run entirely (used on fatal execution errors where there is no
   * result to cache). Unlike complete(), the runId becomes reservable again so
   * a client can retry the exact same submission after a server fault.
   *
   * @returns {boolean} true when an entry was removed
   */
  remove({ sessionId, runId }) {
    const s = sanitizeLeanSessionId(sessionId);
    const r = sanitizeLeanRunId(runId);
    if (!s || !r) return false;
    const key = `${s}:${r}`;
    if (!this._runs.has(key)) return false;
    this._delete(key, s);
    return true;
  }

  /**
   * Drop completed results older than ttlMs. Running/cancelled entries are left
   * alone: their process is still finishing and will complete() shortly.
   *
   * @returns {number} number of pruned entries
   */
  prune() {
    const now = this._now();
    let removed = 0;
    for (const [key, entry] of this._runs) {
      if (entry.status === "completed" && now - entry.updatedAt > this.ttlMs) {
        this._delete(key, entry.sessionId);
        removed += 1;
      }
    }
    return removed;
  }

  _countActive(sessionId) {
    let count = 0;
    if (sessionId) {
      const keys = this._bySession.get(sessionId);
      if (!keys) return 0;
      for (const key of keys) {
        const entry = this._runs.get(key);
        if (entry && (entry.status === "running" || entry.status === "queued")) count += 1;
      }
      return count;
    }
    for (const entry of this._runs.values()) {
      if (entry.status === "running" || entry.status === "queued") count += 1;
    }
    return count;
  }

  _evictOldestCompleted() {
    let oldestKey = null;
    let oldestAt = Infinity;
    for (const [key, entry] of this._runs) {
      if (entry.status !== "completed") continue;
      if (entry.updatedAt < oldestAt) {
        oldestAt = entry.updatedAt;
        oldestKey = key;
      }
    }
    if (oldestKey) {
      const entry = this._runs.get(oldestKey);
      this._delete(oldestKey, entry.sessionId);
    }
  }

  _delete(key, sessionId) {
    this._runs.delete(key);
    const keys = this._bySession.get(sessionId);
    if (keys) {
      keys.delete(key);
      if (keys.size === 0) this._bySession.delete(sessionId);
    }
  }
}
