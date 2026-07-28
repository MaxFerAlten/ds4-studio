/**
 * Per-session/run registry for Agno tool-bridge requests.
 *
 * Tracks one record per (sessionId, runId) pair seen by the (not yet built)
 * tool-execution bridge: an AbortController for cancellation, a bounded and
 * sanitized message history, and idle-expiry bookkeeping.
 *
 * Deliberately does NOT construct any filesystem path from a raw session,
 * run or user id. `sanitizeExternalId()` below is an ID-*syntax* validator
 * (length + charset) — its regex still permits values like ".." because
 * dots are valid identifier characters. Path-safety is a separate concern
 * and already lives in `sanitizeSessionId()` / `sageSessionDir()` in
 * `../agentTools.mjs` (which strips leading dots and falls back to
 * "default"). A later phase that creates a Sage directory per session must
 * go through `sageSessionDir()`, not join a raw id into a path directly.
 * This module never calls `path.join` / `sageSessionDir` itself, so the
 * "ID looks safe but isn't path-safe" gap never gets a chance to matter
 * here — see agnoToolSession.test.mjs's "nessun path injection" case.
 */
export class AgnoToolSessionRegistry {
  constructor({
    workspaceRoot,
    maxHistoryMessages = 64,
    maxHistoryBytes = 65_536,
    idleTtlMs = 30 * 60_000
  } = {}) {
    this.workspaceRoot = workspaceRoot;
    this.maxHistoryMessages = maxHistoryMessages;
    this.maxHistoryBytes = maxHistoryBytes;
    this.idleTtlMs = idleTtlMs;
    this.sessions = new Map();
  }

  getOrCreate(context) {
    const sessionId = sanitizeExternalId(context.sessionId, "session");
    const runId = sanitizeExternalId(context.runId, "run");

    const key = `${sessionId}:${runId}`;

    let record = this.sessions.get(key);

    if (!record) {
      record = {
        key,
        sessionId,
        runId,
        userId: sanitizeOptionalExternalId(context.userId),
        createdAt: Date.now(),
        lastSeenAt: Date.now(),
        controller: new AbortController(),
        history: [],
        gitnexusPolicyState: null,
        activeToolCalls: new Set()
      };
      this.sessions.set(key, record);
    }

    record.lastSeenAt = Date.now();
    record.history = normalizeHistory(context.history, {
      maxMessages: this.maxHistoryMessages,
      maxBytes: this.maxHistoryBytes
    });

    return record;
  }

  /**
   * Abort the record's controller without removing it from the registry.
   * No-op (not an error) if the (sessionId, runId) pair is unknown — the
   * caller may race with the session's natural expiry via sweep().
   */
  cancel({ sessionId, runId }) {
    const record = this.sessions.get(`${sessionId}:${runId}`);
    if (!record) return;
    if (!record.controller.signal.aborted) record.controller.abort();
  }

  cancelAndClose({ sessionId, runId }) {
    const key = `${sessionId}:${runId}`;
    const record = this.sessions.get(key);
    if (!record) return;
    if (!record.controller.signal.aborted) record.controller.abort();
    this.sessions.delete(key);
  }

  /**
   * Abort the record's controller and remove it from the registry.
   * No-op if the (sessionId, runId) pair is unknown.
   */
  close({ sessionId, runId }) {
    const key = `${sessionId}:${runId}`;
    const record = this.sessions.get(key);
    if (!record) return;
    if (!record.controller.signal.aborted) record.controller.abort();
    this.sessions.delete(key);
  }

  /**
   * Abort + remove every record idle for longer than `idleTtlMs`.
   * Returns the number of records swept.
   */
  sweep(now = Date.now()) {
    let swept = 0;
    for (const [key, record] of this.sessions) {
      if (now - record.lastSeenAt > this.idleTtlMs) {
        if (!record.controller.signal.aborted) record.controller.abort();
        this.sessions.delete(key);
        swept++;
      }
    }
    return swept;
  }

  /**
   * Unconditional full shutdown: abort every record and clear the registry,
   * regardless of idle time. Analogous to AgnoToolGate.cancelAll() but for
   * the whole registry.
   */
  closeAll() {
    for (const record of this.sessions.values()) {
      if (!record.controller.signal.aborted) record.controller.abort();
    }
    this.sessions.clear();
  }
}

const ID_MAX_LENGTH = 128;
const ID_PATTERN = /^[A-Za-z0-9._:-]+$/;

/**
 * Small error factory mirroring AgnoToolGate's `#error()` style: returns
 * (does not throw) an Error with a `.code` set, so callers control the
 * throw site.
 */
export function sessionError(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

/**
 * ID-syntax validator: required, <=128 chars, charset [A-Za-z0-9._:-].
 * This is NOT a path-safety guarantee (see module comment above) — do not
 * use the returned value to build a filesystem path without going through
 * `sageSessionDir()` / `sanitizeSessionId()` from ../agentTools.mjs.
 */
export function sanitizeExternalId(value, label) {
  const text = String(value || "").trim();

  if (!text || text.length > ID_MAX_LENGTH) {
    throw sessionError(
      "INVALID_TOOL_CONTEXT",
      `${label} is missing or too long`
    );
  }

  if (!ID_PATTERN.test(text)) {
    throw sessionError(
      "INVALID_TOOL_CONTEXT",
      `${label} contains invalid characters`
    );
  }

  return text;
}

/**
 * Same rules as sanitizeExternalId(), except a missing/empty value is
 * valid and normalizes to null instead of throwing.
 */
export function sanitizeOptionalExternalId(value, label = "userId") {
  const text = String(value || "").trim();

  if (!text) return null;

  if (text.length > ID_MAX_LENGTH) {
    throw sessionError(
      "INVALID_TOOL_CONTEXT",
      `${label} is missing or too long`
    );
  }

  if (!ID_PATTERN.test(text)) {
    throw sessionError(
      "INVALID_TOOL_CONTEXT",
      `${label} contains invalid characters`
    );
  }

  return text;
}

/**
 * Reduce a raw (possibly untrusted / Python-originated) history array down
 * to the canonical {role, content[, tool_call_id]} shape, bounded by
 * message count and total serialized byte size.
 *
 * - Non-array input normalizes to [] (no throw).
 * - Only known keys are ever copied to the output objects — this is the
 *   mechanism that drops arbitrary metadata: unknown input properties are
 *   simply never read.
 * - Entries whose `content` is not a string are discarded (this drops raw
 *   media/non-serializable content: a string-only content field is by
 *   construction not a buffer/blob/object).
 * - Entries whose `content` string itself *looks like* base64-encoded media
 *   (a data: URI, or a long run of base64-alphabet-only characters) are
 *   also discarded — see `looksLikeBase64Media()`.
 * - Entries whose `role` is not a non-empty string are discarded.
 * - Cap 1 (maxMessages) is applied first, keeping the most recent messages.
 * - Cap 2 (maxBytes) is applied second: the total
 *   `Buffer.byteLength(JSON.stringify(array), "utf8")` of the surviving
 *   array must not exceed the budget; oldest messages are dropped first,
 *   consistent with cap 1's "keep the most recent" direction.
 */
const DATA_URI_BASE64_RE = /^data:[^,]+;base64,/i;
const BASE64_BLOB_RE = /^[A-Za-z0-9+/]+={0,2}$/;
const BASE64_BLOB_MIN_LENGTH = 200;

// ponytail: heuristic, not a real base64 decoder — a data: URI prefix, or a
// long (>200 char) whitespace-free run of base64-alphabet characters. False
// negatives possible (short blobs, unusual encodings); upgrade to sniffing
// actual bytes if that turns out to matter.
function looksLikeBase64Media(content) {
  if (DATA_URI_BASE64_RE.test(content)) return true;
  return content.length > BASE64_BLOB_MIN_LENGTH && BASE64_BLOB_RE.test(content);
}

export function normalizeHistory(history, { maxMessages, maxBytes } = {}) {
  if (!Array.isArray(history)) return [];

  const messageCap = Number.isFinite(maxMessages) ? maxMessages : Infinity;
  const byteCap = Number.isFinite(maxBytes) ? maxBytes : Infinity;

  const canonical = [];
  for (const entry of history) {
    if (!entry || typeof entry !== "object") continue;

    const role = entry.role;
    const content = entry.content;

    if (typeof role !== "string" || !role) continue;
    if (typeof content !== "string") continue;
    if (looksLikeBase64Media(content)) continue;

    const message = { role, content };
    if (role === "tool" && typeof entry.tool_call_id === "string") {
      message.tool_call_id = entry.tool_call_id;
    }
    canonical.push(message);
  }

  let trimmed = canonical.length > messageCap
    ? canonical.slice(canonical.length - messageCap)
    : canonical;

  while (
    trimmed.length > 0 &&
    Buffer.byteLength(JSON.stringify(trimmed), "utf8") > byteCap
  ) {
    trimmed = trimmed.slice(1);
  }

  return trimmed;
}
