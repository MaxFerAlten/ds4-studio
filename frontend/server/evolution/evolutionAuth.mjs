/**
 * DS4 Evolution — independently designed clean-room implementation.
 * Behavioral inputs: docs/evolution/threat-model.md API trust boundary.
 * External source code or prompts copied: none.
 * Existing DS4 mechanisms reused: Node timing-safe comparison primitive.
 */

import crypto from "node:crypto";

export class EvolutionAuth {
  constructor({ tokenEnv, env = process.env } = {}) {
    if (typeof tokenEnv !== "string" || !tokenEnv) throw new TypeError("tokenEnv is required");
    const value = env[tokenEnv];
    this.token = typeof value === "string" && Buffer.byteLength(value, "utf8") >= 32 ? Buffer.from(value) : null;
  }

  get writesEnabled() {
    return this.token !== null;
  }

  verifyAuthorization(header) {
    if (!this.token) return false;
    const match = /^Bearer ([^\s]+)$/.exec(String(header ?? ""));
    if (!match) return false;
    const supplied = Buffer.from(match[1]);
    return supplied.length === this.token.length && crypto.timingSafeEqual(supplied, this.token);
  }

  requireWrite(req, res, next) {
    if (!this.writesEnabled) return res.status(403).json({ error: "EVOLUTION_WRITES_DISABLED" });
    if (!this.verifyAuthorization(req.headers.authorization)) return res.status(401).json({ error: "EVOLUTION_UNAUTHORIZED" });
    return next();
  }

  validateReviewer(value) {
    const reviewer = typeof value === "string" ? value.trim() : "";
    if (!/^[A-Za-z0-9][A-Za-z0-9 ._@+-]{1,127}$/.test(reviewer)) {
      const error = new Error("reviewer identity is invalid");
      error.code = "INVALID_REVIEWER";
      error.status = 400;
      throw error;
    }
    return reviewer;
  }
}
