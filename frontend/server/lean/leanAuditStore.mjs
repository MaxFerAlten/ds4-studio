// Lean audit store — extracted from leanRoutes.mjs (FASE R003-10)
// Replaces the inline LEAN_HISTORY_DIR / writeHistoryEntry / readSessionHistory /
// readAllHistory functions with a proper module that:
//   - uses PROJECT_ROOT instead of process.cwd()
//   - derives session paths via SHA-256 (no path traversal)
//   - uses collision-safe filenames: <timestamp>-<attempt>-<runId>.json
//   - writes atomically via temp + rename
//   - returns structured write results instead of best-effort swallowing
//   - supports paginated reads

import { createHash, randomUUID } from "crypto";
import { mkdirSync, readFileSync, writeFileSync, readdirSync, existsSync, statSync, renameSync, unlinkSync } from "fs";
import path from "path";

/**
 * @param {object} opts
 * @param {string} opts.auditRoot - Absolute path to the data/lean directory
 */
export function createLeanAuditStore(opts) {
  const { auditRoot } = opts;
  if (!auditRoot || typeof auditRoot !== "string") {
    throw new Error("createLeanAuditStore: auditRoot is required");
  }
  mkdirSync(auditRoot, { recursive: true });

  /**
   * Derive a safe directory name from a session id via SHA-256.
   * This prevents path traversal without requiring all IDs to be SHA-1.
   */
  function sessionKey(sessionId) {
    return createHash("sha256").update(String(sessionId), "utf8").digest("hex");
  }

  function sessionDir(sessionId) {
    return path.join(auditRoot, sessionKey(sessionId));
  }

  /**
   * Write one history entry. Returns a structured result.
   *
   * @param {string} sessionId
   * @param {object} requestBody
   * @param {object} responseJson
   * @param {object} [meta] - Optional metadata: { attempt, runId }
   * @returns {{ persisted: boolean, entryId: string, relativePath: string } | { persisted: false, error: string }}
   */
  function write(sessionId, requestBody, responseJson, meta = {}) {
    try {
      const dir = sessionDir(sessionId);
      mkdirSync(dir, { recursive: true });

      const timestamp = Date.now();
      const attempt = meta.attempt ?? 0;
      const runId = meta.runId || "unknown";
      const safeRunId = runId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
      // WP08.4 — collision-safe: add short UUID suffix so two writes in the
      // same millisecond with the same runId never overwrite each other.
      const shortUuid = randomUUID().replace(/-/g, "").slice(0, 8);
      const filename = `${timestamp}-${attempt}-${safeRunId}-${shortUuid}.json`;
      const filePath = path.join(dir, filename);

      // Write session metadata if first entry
      const sessionMetaPath = path.join(dir, "session.json");
      if (!existsSync(sessionMetaPath)) {
        const sessionMeta = JSON.stringify({
          sessionId,
          sessionKey: sessionKey(sessionId),
          createdAt: new Date(timestamp).toISOString(),
        }, null, 2);
        writeFileSync(sessionMetaPath, sessionMeta, "utf-8");
      }

      const entry = JSON.stringify({
        timestamp,
        request: requestBody,
        response: responseJson,
      }, null, 2);

      // Atomic write: temp file → rename
      const tempPath = `${filePath}.tmp.${process.pid}`;
      writeFileSync(tempPath, entry, "utf-8");
      renameSync(tempPath, filePath);

      return {
        persisted: true,
        entryId: filename,
        relativePath: path.relative(auditRoot, filePath),
      };
    } catch (err) {
      return { persisted: false, error: err.message };
    }
  }

  /**
   * Read history entries for a session, sorted by timestamp descending (newest first).
   *
   * @param {string} sessionId
   * @param {object} [opts]
   * @param {number} [opts.limit=50]
   * @param {string} [opts.cursor] - Filename cursor for pagination
   * @returns {{ entries: object[], nextCursor: string|null, count: number }}
   */
  function readSession(sessionId, { limit = 50, cursor } = {}) {
    try {
      const dir = sessionDir(sessionId);
      if (!existsSync(dir)) return { entries: [], nextCursor: null, count: 0 };

      let files = readdirSync(dir)
        .filter(f => f.endsWith(".json") && f !== "session.json")
        .sort()
        .reverse(); // newest first

      // Apply cursor: skip entries up to and including the cursor
      if (cursor) {
        const idx = files.indexOf(cursor);
        if (idx >= 0) files = files.slice(idx + 1);
      }

      const entries = [];
      for (const f of files) {
        if (entries.length >= limit) break;
        try {
          const raw = readFileSync(path.join(dir, f), "utf-8");
          entries.push(JSON.parse(raw));
        } catch (_) { /* skip corrupt */ }
      }

      const nextCursor = files.length > limit ? files[limit] : null;
      return { entries, nextCursor, count: entries.length };
    } catch (_) {
      return { entries: [], nextCursor: null, count: 0 };
    }
  }

  /**
   * List all session keys (for the global sessions endpoint).
   * Returns metadata, not full entries.
   *
   * @returns {{ sessions: object[], count: number }}
   */
  function listSessions() {
    try {
      if (!existsSync(auditRoot)) return { sessions: [], count: 0 };
      const dirs = readdirSync(auditRoot);
      const sessions = [];
      for (const d of dirs) {
        const sessionJsonPath = path.join(auditRoot, d, "session.json");
        try {
          if (existsSync(sessionJsonPath)) {
            const meta = JSON.parse(readFileSync(sessionJsonPath, "utf-8"));
            sessions.push(meta);
          }
        } catch (_) { /* skip corrupt */ }
      }
      return { sessions, count: sessions.length };
    } catch (_) {
      return { sessions: [], count: 0 };
    }
  }

  /**
   * Read a global view: newest entries across all sessions.
   *
   * @param {object} [opts]
   * @param {number} [opts.limit=50]
   * @param {string} [opts.cursor]
   * @returns {{ entries: object[], nextCursor: string|null, count: number }}
   */
  function readAll({ limit = 50, cursor } = {}) {
    try {
      if (!existsSync(auditRoot)) return { entries: [], nextCursor: null, count: 0 };
      const sessionDirs = readdirSync(auditRoot);
      const all = [];
      for (const sess of sessionDirs) {
        const dir = path.join(auditRoot, sess);
        let stat;
        try { stat = statSync(dir); } catch (_) { continue; }
        if (!stat.isDirectory()) continue;
        const files = readdirSync(dir)
          .filter(f => f.endsWith(".json") && f !== "session.json")
          .sort();
        for (const f of files) {
          try {
            const raw = readFileSync(path.join(dir, f), "utf-8");
            const parsed = JSON.parse(raw);
            parsed._sessionId = sess;
            parsed._file = f;
            all.push(parsed);
          } catch (_) { /* skip corrupt */ }
        }
      }
      all.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

      let start = 0;
      if (cursor) {
        const idx = all.findIndex(e => e._file === cursor);
        if (idx >= 0) start = idx + 1;
      }

      const entries = all.slice(start, start + limit);
      const nextCursor = start + limit < all.length ? all[start + limit]._file : null;
      return { entries, nextCursor, count: entries.length };
    } catch (_) {
      return { entries: [], nextCursor: null, count: 0 };
    }
  }

  return { write, readSession, listSessions, readAll, sessionKey };
}
