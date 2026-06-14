// Call Debug recorder: captures every OUTBOUND HTTP call the node server makes
// (ds4-server model + Deep Research providers) by wrapping globalThis.fetch once
// at boot. Records sanitized metadata plus truncated request/response bodies,
// keeps an in-memory ring for fast reads, and persists to a rotated NDJSON file.

import * as nodeFs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

const SECRET_PARAMS = new Set(["api_key", "apikey", "api-key", "key", "token", "access_token"]);
const SECRET_HEADER = /authorization|api[-_]?key|token|secret|cookie/i;

// Mask secret query parameters (serpapi/tripadvisor put the key in the URL).
export function sanitizeUrl(url) {
  try {
    const u = new URL(url);
    for (const name of [...u.searchParams.keys()]) {
      if (SECRET_PARAMS.has(name.toLowerCase())) u.searchParams.set(name, "***");
    }
    return u.toString();
  } catch {
    return url;
  }
}

function headerEntries(headers) {
  if (!headers) return [];
  if (typeof headers.entries === "function") return [...headers.entries()];
  if (Array.isArray(headers)) return headers;
  return Object.entries(headers);
}

export function sanitizeHeaders(headers) {
  const out = {};
  for (const [key, value] of headerEntries(headers)) {
    out[key] = SECRET_HEADER.test(key) ? "***" : String(value);
  }
  return out;
}

export function truncateBody(str, max) {
  if (typeof str !== "string") return null;
  if (str.length <= max) return str;
  return `${str.slice(0, max)}…[+${str.length - max} chars]`;
}

function hostKey(url) {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

export function categorize(url, modelBase) {
  const a = hostKey(url);
  const b = hostKey(modelBase);
  return a && b && a === b ? "model" : "provider";
}

export function isStreamResponse(res) {
  const ct =
    res && res.headers && typeof res.headers.get === "function"
      ? res.headers.get("content-type")
      : res?.headers?.["content-type"];
  return typeof ct === "string" && ct.includes("text/event-stream");
}

export class CallDebugRecorder {
  constructor({
    dir,
    maxEntries = 200,
    maxBodyChars = 4000,
    maxFileBytes = 5_000_000,
    fs = nodeFs,
    clock = () => Date.now()
  } = {}) {
    this.dir = dir;
    this.maxEntries = maxEntries;
    this.maxBodyChars = maxBodyChars;
    this.maxFileBytes = maxFileBytes;
    this.fs = fs;
    this.clock = clock;
    this.file = path.join(dir, "calls.ndjson");
    this.rotated = `${this.file}.1`;
    this.ring = [];
    this.installed = false;
    this._original = null;
    try {
      this.fs.mkdirSync(this.dir, { recursive: true });
    } catch {
      /* best effort */
    }
    this.#loadRing();
  }

  #loadRing() {
    try {
      if (!this.fs.existsSync(this.file)) return;
      const raw = this.fs.readFileSync(this.file, "utf8");
      const lines = raw.split("\n").filter(Boolean).slice(-this.maxEntries);
      for (const line of lines) {
        try {
          this.ring.push(JSON.parse(line));
        } catch {
          /* skip corrupt line */
        }
      }
    } catch {
      /* best effort */
    }
  }

  record(entry) {
    const full = {
      id: randomUUID(),
      ts: new Date(this.clock()).toISOString(),
      ...entry
    };
    this.ring.push(full);
    while (this.ring.length > this.maxEntries) this.ring.shift();
    this.#append(`${JSON.stringify(full)}\n`);
    return full;
  }

  #append(line) {
    try {
      if (this.fs.existsSync(this.file)) {
        const size = this.fs.statSync(this.file).size;
        if (size + Buffer.byteLength(line) > this.maxFileBytes) {
          this.fs.renameSync(this.file, this.rotated);
        }
      }
      this.fs.appendFileSync(this.file, line);
    } catch {
      /* best effort — persistence must never break a request */
    }
  }

  list({ limit } = {}) {
    const n = limit && limit > 0 ? limit : this.maxEntries;
    return this.ring.slice(-n).reverse();
  }

  clear() {
    this.ring = [];
    try {
      this.fs.writeFileSync(this.file, "");
    } catch {
      /* best effort */
    }
    try {
      if (this.fs.existsSync(this.rotated)) this.fs.rmSync(this.rotated);
    } catch {
      /* best effort */
    }
  }

  // Build a fetch replacement that records each outbound call. The original body
  // streams untouched to the caller; only non-stream responses are cloned/read.
  wrap(originalFetch, modelBase) {
    const self = this;
    return async function recordedFetch(input, init = {}) {
      const url = typeof input === "string" ? input : input?.url;
      if (typeof url !== "string" || !/^https?:/i.test(url)) {
        return originalFetch(input, init);
      }
      const method = String(
        init.method || (typeof input === "object" && input?.method) || "GET"
      ).toUpperCase();
      const rawBody = init.body ?? (typeof input === "object" ? input?.body : undefined);
      const reqBody = typeof rawBody === "string" ? truncateBody(rawBody, self.maxBodyChars) : null;
      const reqHeaders = sanitizeHeaders(
        init.headers || (typeof input === "object" ? input?.headers : undefined)
      );
      const base = {
        category: categorize(url, modelBase),
        host: hostKey(url) || "",
        method,
        url: sanitizeUrl(url),
        reqBody,
        reqHeaders
      };
      const started = self.clock();
      try {
        const res = await originalFetch(input, init);
        const durationMs = self.clock() - started;
        let respBody = null;
        let bytes = null;
        if (isStreamResponse(res)) {
          respBody = "[stream]";
        } else {
          try {
            const text = await res.clone().text();
            bytes = text.length;
            respBody = truncateBody(text, self.maxBodyChars);
          } catch {
            respBody = "[unreadable]";
          }
        }
        self.record({
          ...base,
          status: res.status,
          ok: res.ok,
          durationMs,
          error: null,
          respBody,
          bytes
        });
        return res;
      } catch (err) {
        self.record({
          ...base,
          status: null,
          ok: false,
          durationMs: self.clock() - started,
          error: err?.message || String(err),
          respBody: null,
          bytes: null
        });
        throw err;
      }
    };
  }

  install({ modelBase }) {
    if (this.installed) return;
    this._original = globalThis.fetch;
    globalThis.fetch = this.wrap(this._original.bind(globalThis), modelBase);
    this.installed = true;
  }

  uninstall() {
    if (!this.installed) return;
    globalThis.fetch = this._original;
    this.installed = false;
  }
}
