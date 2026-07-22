/**
 * DS4 Evolution — independently designed clean-room implementation.
 * Behavioral inputs: docs/evolution/acceptance-contract.md post-apply smoke requirement.
 * External source code or prompts copied: none.
 * Existing DS4 mechanisms reused: the frontend production build command.
 */

import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export function createEvolutionSmokeEvaluator({ repositoryRoot, timeoutMs = 120_000, execFileImpl = execFileAsync } = {}) {
  const root = path.resolve(repositoryRoot ?? "");
  if (!repositoryRoot) throw new TypeError("repositoryRoot is required");
  return async function evolutionSmokeEvaluator() {
    const environment = {
      PATH: process.env.PATH ?? "/usr/bin:/bin",
      LANG: "C.UTF-8",
      NODE_ENV: "production",
      TMPDIR: process.env.TMPDIR ?? "/tmp"
    };
    try {
      await execFileImpl(process.execPath, ["--check", path.join(root, "frontend/server/index.mjs")], {
        cwd: root,
        encoding: "utf8",
        timeout: timeoutMs,
        maxBuffer: 1_000_000,
        env: environment
      });
      await execFileImpl("npm", ["--prefix", path.join(root, "frontend"), "run", "build"], {
        cwd: root,
        encoding: "utf8",
        timeout: timeoutMs,
        maxBuffer: 4_000_000,
        env: environment
      });
      return Object.freeze({ passed: true, checks: Object.freeze(["server-syntax", "frontend-production-build"]) });
    } catch (error) {
      return Object.freeze({
        passed: false,
        reasonCode: error?.code === "ETIMEDOUT" ? "SMOKE_TIMEOUT" : "SMOKE_COMMAND_FAILED"
      });
    }
  };
}
