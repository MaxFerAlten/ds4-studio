/**
 * DS4 Evolution — independently designed clean-room implementation.
 * Behavioral inputs: docs/evolution/behavioral-specification.md bounded Proposer context.
 * External source code or prompts copied: none.
 * Existing DS4 mechanisms reused: DS4 path-scope invariants.
 */

import fs from "node:fs/promises";
import path from "node:path";

import { sha256 } from "./evolutionIntegrity.mjs";

function inScope(candidate, scopes) {
  return scopes.some((scope) => candidate === scope || candidate.startsWith(`${scope}/`));
}

export class EvolutionSourceContextError extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.name = "EvolutionSourceContextError";
    this.code = code;
  }
}

export class EvolutionSourceContext {
  constructor({ repositoryRoot, maxFileBytes = 64_000, maxTotalBytes = 256_000 } = {}) {
    if (!repositoryRoot) throw new TypeError("repositoryRoot is required");
    this.repositoryRoot = path.resolve(repositoryRoot);
    this.maxFileBytes = maxFileBytes;
    this.maxTotalBytes = maxTotalBytes;
  }

  async build({ taskContract, targetFiles }) {
    const files = [];
    let totalBytes = 0;
    for (const target of [...new Set(targetFiles ?? [])].sort()) {
      if (typeof target !== "string" || path.isAbsolute(target) || target.includes("\0") || target.startsWith(".") ||
          !inScope(target, taskContract.mutablePaths) || inScope(target, taskContract.immutablePaths)) {
        throw new EvolutionSourceContextError("SOURCE_PATH_FORBIDDEN", String(target));
      }
      const absolute = path.resolve(this.repositoryRoot, ...target.split("/"));
      const relative = path.relative(this.repositoryRoot, absolute);
      if (relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
        throw new EvolutionSourceContextError("SOURCE_PATH_ESCAPE", target);
      }
      const stat = await fs.lstat(absolute).catch((error) => {
        if (error.code === "ENOENT") throw new EvolutionSourceContextError("SOURCE_FILE_MISSING", target);
        throw error;
      });
      if (!stat.isFile() || stat.isSymbolicLink()) throw new EvolutionSourceContextError("SOURCE_FILE_UNSUPPORTED", target);
      if (stat.size > this.maxFileBytes || totalBytes + stat.size > this.maxTotalBytes) {
        throw new EvolutionSourceContextError("SOURCE_CONTEXT_TOO_LARGE", target);
      }
      const content = await fs.readFile(absolute, "utf8");
      totalBytes += Buffer.byteLength(content, "utf8");
      files.push(Object.freeze({ path: target, sha256: sha256(content), lines: content.split("\n").length, content }));
    }
    return Object.freeze({ schema: "ds4_evolution_source_context_v1", totalBytes, files: Object.freeze(files) });
  }
}
