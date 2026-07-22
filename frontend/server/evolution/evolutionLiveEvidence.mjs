/**
 * DS4 Evolution — independently designed clean-room implementation.
 * Behavioral inputs: docs/evolution/acceptance-contract.md sections 24-29.
 * External source code or prompts copied: none.
 * Existing DS4 mechanisms reused: none.
 */

import fs from "node:fs/promises";
import path from "node:path";

import { hashFile, hashJson, sha256 } from "./evolutionIntegrity.mjs";

const LIVE_EVIDENCE_VERSION = "ds4_evolution_live_evidence_v1";
const REQUIRED_FIELDS = Object.freeze([
  "executed", "runsRequested", "runsCompleted", "runsPassed",
  "model", "modelEndpointHash", "taskFixtureHash", "runArtifacts",
  "rollbackDrillPassed", "sourceRevision", "decidedAt"
]);
const RUN_ARTIFACT_KEYS = Object.freeze(["runId", "artifactHash", "passed"]);

export class LiveEvidenceError extends Error {
  constructor(code, message, details = {}) {
    super(`${code}: ${message}`);
    this.name = "LiveEvidenceError";
    this.code = code;
    this.details = details;
  }
}

function plainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype;
}

function issue(issues, code, field, message) {
  issues.push({ code, path: field, message });
}

function requireString(value, field, issues, { max = 10_000 } = {}) {
  if (typeof value !== "string" || !value.trim() || value.length > max) {
    issue(issues, "INVALID_STRING", field, `must be a non-empty string no longer than ${max}`);
    return "";
  }
  return value.trim();
}

export function validateLiveEvidence(record) {
  if (!plainObject(record)) {
    throw new LiveEvidenceError("INVALID_LIVE_EVIDENCE", "live evidence must be a plain object");
  }
  const issues = [];
  if (record.schema !== LIVE_EVIDENCE_VERSION) {
    issue(issues, "INVALID_LIVE_EVIDENCE_SCHEMA", "schema", `expected ${LIVE_EVIDENCE_VERSION}`);
  }
  if (typeof record.executed !== "boolean") {
    issue(issues, "INVALID_TYPE", "executed", "must be boolean");
  }
  if (typeof record.runsRequested !== "number" || !Number.isInteger(record.runsRequested) || record.runsRequested < 0) {
    issue(issues, "INVALID_TYPE", "runsRequested", "must be a non-negative integer");
  }
  if (typeof record.runsCompleted !== "number" || !Number.isInteger(record.runsCompleted) || record.runsCompleted < 0) {
    issue(issues, "INVALID_TYPE", "runsCompleted", "must be a non-negative integer");
  }
  if (typeof record.runsPassed !== "number" || !Number.isInteger(record.runsPassed) || record.runsPassed < 0) {
    issue(issues, "INVALID_TYPE", "runsPassed", "must be a non-negative integer");
  }
  if (typeof record.runsCompleted === "number" && typeof record.runsRequested === "number" &&
      record.runsCompleted > record.runsRequested) {
    issue(issues, "INVALID_RUN_COUNTS", "runsCompleted", "cannot exceed runsRequested");
  }
  if (typeof record.runsPassed === "number" && typeof record.runsCompleted === "number" &&
      record.runsPassed > record.runsCompleted) {
    issue(issues, "INVALID_RUN_COUNTS", "runsPassed", "cannot exceed runsCompleted");
  }
  requireString(record.model, "model", issues, { max: 256 });
  requireString(record.modelEndpointHash, "modelEndpointHash", issues, { max: 128 });
  requireString(record.taskFixtureHash, "taskFixtureHash", issues, { max: 128 });
  if (!Array.isArray(record.runArtifacts)) {
    issue(issues, "INVALID_TYPE", "runArtifacts", "must be an array");
  } else {
    for (let index = 0; index < record.runArtifacts.length; index++) {
      const entry = record.runArtifacts[index];
      const field = `runArtifacts[${index}]`;
      if (!plainObject(entry)) {
        issue(issues, "INVALID_TYPE", field, "must be an object");
        continue;
      }
      for (const key of RUN_ARTIFACT_KEYS) {
        if (!(key in entry)) issue(issues, "MISSING_FIELD", `${field}.${key}`, `${key} is required`);
      }
      requireString(entry.runId, `${field}.runId`, issues, { max: 128 });
      requireString(entry.artifactHash, `${field}.artifactHash`, issues, { max: 128 });
      if (typeof entry.passed !== "boolean") {
        issue(issues, "INVALID_TYPE", `${field}.passed`, "must be boolean");
      }
    }
  }
  if (typeof record.rollbackDrillPassed !== "boolean") {
    issue(issues, "INVALID_TYPE", "rollbackDrillPassed", "must be boolean");
  }
  requireString(record.sourceRevision, "sourceRevision", issues, { max: 512 });
  requireString(record.decidedAt, "decidedAt", issues, { max: 64 });
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(record.decidedAt ?? "")) {
    issue(issues, "INVALID_TIMESTAMP", "decidedAt", "must be an ISO 8601 timestamp");
  }
  if (issues.length) {
    const preferred = issues[0];
    throw new LiveEvidenceError(preferred.code, preferred.message, issues);
  }
  return Object.freeze({ ...record });
}

export async function verifyLiveEvidenceHashes(evidence, artifactsDir) {
  if (!plainObject(evidence) || !Array.isArray(evidence.runArtifacts)) {
    throw new LiveEvidenceError("INVALID_LIVE_EVIDENCE", "evidence must have runArtifacts array");
  }
  const mismatches = [];
  for (const entry of evidence.runArtifacts) {
    const artifactPath = path.join(artifactsDir, `${entry.runId}.json`);
    try {
      const actualHash = await hashFile(artifactPath);
      if (actualHash !== entry.artifactHash) {
        mismatches.push({
          runId: entry.runId,
          expected: entry.artifactHash,
          actual: actualHash
        });
      }
    } catch (error) {
      if (error.code === "ENOENT") {
        mismatches.push({
          runId: entry.runId,
          expected: entry.artifactHash,
          actual: null,
          error: "ARTIFACT_NOT_FOUND"
        });
      } else {
        throw error;
      }
    }
  }
  if (mismatches.length) {
    throw new LiveEvidenceError("ARTIFACT_HASH_MISMATCH", `${mismatches.length} artifact hash mismatch(es)`, { mismatches });
  }
  return true;
}

export function bindLiveEvidenceToRevision(evidence, expectedRevision) {
  if (!plainObject(evidence)) {
    throw new LiveEvidenceError("INVALID_LIVE_EVIDENCE", "evidence must be an object");
  }
  if (evidence.sourceRevision !== expectedRevision) {
    throw new LiveEvidenceError("LIVE_EVIDENCE_SOURCE_REVISION_MISMATCH", `expected revision ${expectedRevision}, got ${evidence.sourceRevision}`, {
      expected: expectedRevision,
      actual: evidence.sourceRevision
    });
  }
  return true;
}
