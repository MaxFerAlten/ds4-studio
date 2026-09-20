// Retry helper for transient wrapper "busy" conflicts.
//
// The ds4-wrapper backend serialises a single live session: while one request
// is streaming it answers every other /v1/* request with HTTP 409
// {"error":"conflict","message":"wrapper is busy"}.  That 409 is transient — it
// clears the moment the in-flight generation finishes — so short, backed-off
// retries turn a spurious user-facing error into a brief wait.
//
// A 409 that is NOT about being busy (e.g. "wrong mode: active=server
// required=agent") is a real client/state error and must be surfaced
// unchanged, so it is never retried.

export const BUSY_RETRY_DEFAULTS = Object.freeze({
  maxRetries: 5,
  baseDelayMs: 200,
  maxDelayMs: 1500
});

/* A cancelled ROCm layer-major prefill releases the session only at the next
 * safe chunk boundary. A cold production 8192-token chunk has taken 72s in a
 * live run, so generation requests need a two-minute retry window while
 * lightweight probes keep their short retry budget. */
export const GENERATION_BUSY_RETRY_DEFAULTS = Object.freeze({
  maxRetries: 34,
  baseDelayMs: 250,
  maxDelayMs: 4000
});

const GENERATION_ENDPOINTS = new Set([
  "/v1/chat/completions",
  "/v1/responses",
  "/v1/messages",
  "/v1/completions"
]);

export function isGenerationRequest(method, originalUrl) {
  const path = String(originalUrl || "").split("?", 1)[0];
  return String(method || "").toUpperCase() === "POST" &&
    GENERATION_ENDPOINTS.has(path);
}

export function busyRetryOptionsForRequest(method, originalUrl) {
  return isGenerationRequest(method, originalUrl)
    ? GENERATION_BUSY_RETRY_DEFAULTS
    : BUSY_RETRY_DEFAULTS;
}

/**
 * True only for the transient "wrapper is busy" 409. Other 409s (wrong mode,
 * lost continuation state, …) are real errors and must not be retried.
 */
export function isBusyConflict(status, bodyText) {
  if (status !== 409) return false;
  const text = String(bodyText || "");
  return /busy/i.test(text) && !/wrong mode/i.test(text);
}

/** Exponential backoff with a ceiling. */
export function busyRetryDelay(attempt, opts = {}) {
  const { baseDelayMs, maxDelayMs } = { ...BUSY_RETRY_DEFAULTS, ...opts };
  return Math.min(baseDelayMs * 2 ** attempt, maxDelayMs);
}

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * fetch() wrapper that retries transient "wrapper is busy" 409s with backoff.
 *
 * The body of a retryable 409 is small JSON, so we clone-and-read it to decide
 * whether to retry; the original response is discarded before the next attempt.
 * Non-409 responses (including streaming bodies) and non-busy 409s are returned
 * untouched and unconsumed so callers can pass the stream straight through.
 *
 * @param {typeof fetch} fetchImpl
 * @param {string|URL} url
 * @param {RequestInit} options  may carry an AbortSignal; aborting stops retries
 * @param {{maxRetries?:number, baseDelayMs?:number, maxDelayMs?:number, sleep?:(ms:number)=>Promise<void>}} opts
 */
export async function fetchWithBusyRetry(fetchImpl, url, options = {}, opts = {}) {
  const cfg = { ...BUSY_RETRY_DEFAULTS, ...opts };
  const sleep = cfg.sleep || defaultSleep;
  let attempt = 0;
  for (;;) {
    const res = await fetchImpl(url, options);
    if (res.status !== 409 || attempt >= cfg.maxRetries) return res;
    if (options.signal?.aborted) return res;
    if (typeof res.clone !== "function") return res;

    let text = "";
    try {
      text = await res.clone().text();
    } catch {
      return res;
    }
    if (!isBusyConflict(res.status, text)) return res;

    try {
      await res.body?.cancel();
    } catch {
      // ignore: discarding the retryable 409 body
    }
    await sleep(busyRetryDelay(attempt, cfg));
    attempt++;
  }
}
