import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

const FRESH_RE = /\b(latest|today|oggi|current|now|breaking|2026|2027)\b/i;

export function cacheKey(provider, query, options = {}) {
  const raw = `${provider}|${String(query).trim().toLowerCase()}|${JSON.stringify(options)}`;
  return createHash("sha256").update(raw).digest("hex").slice(0, 24);
}

export function isFreshQuery(query) {
  return FRESH_RE.test(String(query || ""));
}

export class SourceCache {
  constructor({
    dir,
    enabled = true,
    defaultTtlMs = 86400000,
    freshQueryTtlMs = 900000,
    now = () => Date.now()
  }) {
    this.dir = dir;
    this.enabled = enabled;
    this.defaultTtlMs = defaultTtlMs;
    this.freshQueryTtlMs = freshQueryTtlMs;
    this.now = now;
  }

  #file(provider, key) {
    return path.join(this.dir, "search", provider, `${key}.json`);
  }

  async get(provider, query, options = {}) {
    if (!this.enabled) return null;
    const file = this.#file(provider, cacheKey(provider, query, options));
    const raw = await fs.readFile(file, "utf8").catch((err) => {
      if (err.code === "ENOENT") return null;
      throw err;
    });
    if (raw === null) return null;
    let entry;
    try {
      entry = JSON.parse(raw);
    } catch {
      return null;
    }
    if (this.now() - entry.savedAt > entry.ttlMs) return null;
    return entry.payload;
  }

  async set(provider, query, options = {}, payload) {
    if (!this.enabled) return;
    const ttlMs = isFreshQuery(query)
      ? Math.min(this.freshQueryTtlMs, this.defaultTtlMs)
      : this.defaultTtlMs;
    const file = this.#file(provider, cacheKey(provider, query, options));
    await fs.mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    await fs.writeFile(tmp, JSON.stringify({ savedAt: this.now(), ttlMs, payload }), "utf8");
    await fs.rename(tmp, file);
  }
}
