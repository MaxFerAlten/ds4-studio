/**
 * DS4 Evolution — independently designed clean-room implementation.
 * Behavioral inputs: docs/evolution/acceptance-contract.md sections 18 and 24-29.
 * External source code or prompts copied: none.
 * Existing DS4 mechanisms reused: none.
 */

import fs from "node:fs/promises";
import path from "node:path";

const KILL_SWITCH_FILE = "data/evolution-disabled";

const RELEASE_GATES = {
  "1": { maxLevel: "B", manualCandidatesOnly: true, autoPromote: false, liveEvidenceRequired: false },
  "2": { maxLevel: "C", manualCandidatesOnly: true, autoPromote: false, liveEvidenceRequired: true },
  "3": { maxLevel: "D", manualCandidatesOnly: true, autoPromote: false, liveEvidenceRequired: true }
};

const LEVEL_ORDER = ["A", "B", "C", "D", "E"];

const LEVEL_D_ALLOWED_PATHS = [
  "frontend/server/evolution/fixtures/",
  "benchmarks/agentic/evolution/fixtures/"
];

const LEVEL_D_BLOCKED_PATHS = [
  "frontend/server/index.mjs",
  "frontend/server/config.mjs",
  "frontend/server/defaultConfig.mjs",
  "frontend/server/evolution/evolutionPromotion*",
  "frontend/server/evolution/evolutionEvaluator*",
  "frontend/server/evolution/evolutionExecutor*",
  "frontend/server/evolution/evolutionProvenance*",
  "frontend/server/evolution/security/",
  "ds4.c", "ds4.h", "ds4_*.c", "ds4_*.h",
  "rocm/", "metal/",
  "Makefile", "package.json", "package-lock.json"
];

function levelRank(level) {
  const index = LEVEL_ORDER.indexOf(level);
  if (index === -1) throw new RangeError(`Unknown level: ${level}`);
  return index;
}

function matchesGlob(filePath, pattern) {
  if (pattern.endsWith("/")) {
    return filePath.startsWith(pattern) || filePath === pattern.slice(0, -1);
  }
  if (pattern.includes("*")) {
    const regex = new RegExp(
      "^" + pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$"
    );
    return regex.test(filePath);
  }
  return filePath === pattern;
}

export async function isEvolutionEnabled(repositoryRoot, killSwitchFile = KILL_SWITCH_FILE) {
  const fullPath = path.resolve(repositoryRoot, killSwitchFile);
  try {
    await fs.access(fullPath);
    return { enabled: false, reason: "EVOLUTION_KILL_SWITCH_ACTIVE" };
  } catch {
    return { enabled: true, reason: null };
  }
}

export function validateReleaseGate(level, releaseVersion) {
  const gate = RELEASE_GATES[String(releaseVersion)];
  if (!gate) {
    return { allowed: false, reason: `UNKNOWN_RELEASE_VERSION: ${releaseVersion}` };
  }
  const requestedRank = levelRank(level);
  const maxRank = levelRank(gate.maxLevel);
  if (requestedRank > maxRank) {
    return {
      allowed: false,
      reason: `LEVEL_${level}_EXCEEDS_RELEASE_${releaseVersion}_MAX_LEVEL_${gate.maxLevel}`
    };
  }
  return { allowed: true, reason: null };
}

export function validateLevelDPaths(targetFiles) {
  const violations = [];
  for (const filePath of targetFiles) {
    const normalized = filePath.replace(/\\/g, "/");
    const isBlocked = LEVEL_D_BLOCKED_PATHS.some((pattern) => matchesGlob(normalized, pattern));
    if (isBlocked) {
      violations.push(normalized);
      continue;
    }
    const isAllowed = LEVEL_D_ALLOWED_PATHS.some((pattern) => matchesGlob(normalized, pattern));
    if (!isAllowed) {
      violations.push(normalized);
    }
  }
  return { allowed: violations.length === 0, violations };
}

export function validateLevelE() {
  return { allowed: false, reason: "LEVEL_E_DISABLED_SEPARATE_PLAN_REQUIRED" };
}

export { RELEASE_GATES, LEVEL_D_ALLOWED_PATHS, LEVEL_D_BLOCKED_PATHS, KILL_SWITCH_FILE };
