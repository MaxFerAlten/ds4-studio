/**
 * DS4 Evolution — independently designed clean-room implementation.
 * Behavioral inputs: docs/evolution/behavioral-specification.md sections 13 and 14.
 * External source code or prompts copied: none.
 * Existing DS4 mechanisms reused: immutable EvolutionRunStore artifacts and ledger events.
 */

import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { sha256, timingSafeHexEqual } from "./evolutionIntegrity.mjs";
import { assertInside } from "./evolutionWorkspace.mjs";
import { captureBaselineSnapshot } from "./evolutionRunStore.mjs";

const execFileAsync = promisify(execFile);
const HEX_HASH = /^[a-f0-9]{64}$/;
const APPROVAL_TTL_MS = 15 * 60_000;

export class EvolutionPromotionError extends Error {
  constructor(code, message, details = {}) {
    super(`${code}: ${message}`);
    this.name = "EvolutionPromotionError";
    this.code = code;
    this.details = details;
  }
}

function serializedRecord(record) {
  return `${JSON.stringify(record, null, 2)}\n`;
}

async function snapshotEntries(repositoryRoot, paths) {
  const entries = [];
  for (const relativePath of [...new Set(paths)].sort()) {
    const absolute = await assertInside(repositoryRoot, relativePath);
    const stat = await fs.lstat(absolute).catch((error) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (!stat) {
      entries.push({ path: relativePath, type: "missing", mode: null, contentBase64: null });
      continue;
    }
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new EvolutionPromotionError("ROLLBACK_PATH_UNSUPPORTED", relativePath);
    }
    entries.push({
      path: relativePath,
      type: "file",
      mode: stat.mode & 0o777,
      contentBase64: (await fs.readFile(absolute)).toString("base64")
    });
  }
  return entries;
}

async function restoreEntries(repositoryRoot, entries) {
  for (const entry of entries) {
    const absolute = await assertInside(repositoryRoot, entry.path);
    if (entry.type === "missing") {
      await fs.rm(absolute, { force: true });
      continue;
    }
    const temporary = path.join(path.dirname(absolute), `.${path.basename(absolute)}.${crypto.randomUUID()}.rollback`);
    await fs.mkdir(path.dirname(absolute), { recursive: true });
    try {
      await fs.writeFile(temporary, Buffer.from(entry.contentBase64, "base64"), { mode: entry.mode ?? 0o600 });
      await fs.rename(temporary, absolute);
      if (entry.mode !== null) await fs.chmod(absolute, entry.mode);
    } catch (error) {
      await fs.rm(temporary, { force: true }).catch(() => {});
      throw error;
    }
  }
}

async function applyPatch(repositoryRoot, patchText) {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "ds4-evo-promote-"));
  const patchFile = path.join(temporary, "candidate.patch");
  try {
    await fs.writeFile(patchFile, patchText, { encoding: "utf8", mode: 0o600 });
    for (const args of [
      ["apply", "--check", "--whitespace=error-all", "--", patchFile],
      ["apply", "--whitespace=error-all", "--", patchFile]
    ]) {
      try {
        await execFileAsync("git", args, { cwd: repositoryRoot, encoding: "utf8", timeout: 30_000, maxBuffer: 1_000_000 });
      } catch (error) {
        throw new EvolutionPromotionError("PROMOTION_APPLY_FAILED", String(error.stderr ?? error.message).slice(0, 2_000));
      }
    }
  } finally {
    await fs.rm(temporary, { recursive: true, force: true });
  }
}

function validateRollbackArtifact(artifact) {
  const record = artifact?.record;
  if (!record || record.schema !== "ds4_evolution_rollback_v1" || !HEX_HASH.test(String(record.candidateHash)) ||
      !HEX_HASH.test(String(record.parentHash)) || !Array.isArray(record.entries)) {
    throw new EvolutionPromotionError("ROLLBACK_ARTIFACT_INVALID", "rollback record is malformed");
  }
  const expectedId = `sha256:${sha256(serializedRecord(record))}`;
  if (artifact.artifactId !== expectedId || artifact.candidateHash !== record.candidateHash ||
      artifact.parentHash !== record.parentHash) {
    throw new EvolutionPromotionError("ROLLBACK_ARTIFACT_INVALID", "rollback artifact hash or binding mismatch");
  }
  return record;
}

export class EvolutionPromotionService {
  constructor({ repositoryRoot, runStore, now = () => new Date(), nonceFactory = () => crypto.randomBytes(32).toString("hex") } = {}) {
    if (!repositoryRoot || !runStore) throw new TypeError("repositoryRoot and runStore are required");
    this.repositoryRoot = path.resolve(repositoryRoot);
    this.runStore = runStore;
    this.now = now;
    this.nonceFactory = nonceFactory;
    this.queue = Promise.resolve();
    this.approvalQueues = new Map();
  }

  serialize(operation) {
    const current = this.queue.catch(() => {}).then(operation);
    this.queue = current;
    return current;
  }

  approvalLock(runId, operation) {
    const previous = this.approvalQueues.get(runId) ?? Promise.resolve();
    const current = previous.catch(() => {}).then(operation);
    this.approvalQueues.set(runId, current);
    return current.finally(() => {
      if (this.approvalQueues.get(runId) === current) this.approvalQueues.delete(runId);
    });
  }

  async prepareRollback({ runId, revision, candidateHash, paths, expectedParentHash = null }) {
    if (!HEX_HASH.test(String(candidateHash)) || !Array.isArray(paths) || !paths.length) {
      throw new EvolutionPromotionError("ROLLBACK_INPUT_INVALID", "candidateHash and paths are required");
    }
    const snapshot = await captureBaselineSnapshot({ repositoryRoot: this.repositoryRoot, relevantPaths: paths });
    if (expectedParentHash && !timingSafeHexEqual(snapshot.contentHash, expectedParentHash)) {
      throw new EvolutionPromotionError("PARENT_SNAPSHOT_MISMATCH", "canonical repository drifted before rollback capture");
    }
    const record = {
      schema: "ds4_evolution_rollback_v1",
      runId,
      revision,
      candidateHash,
      parentHash: snapshot.contentHash,
      createdAt: this.now().toISOString(),
      entries: await snapshotEntries(this.repositoryRoot, paths)
    };
    const stored = await this.runStore.writeRevisionArtifact(runId, revision, "rollback.json", record);
    const artifact = Object.freeze({ ...stored, candidateHash, parentHash: record.parentHash, record: Object.freeze(record) });
    await this.runStore.appendEvent(runId, {
      revision,
      type: "ROLLBACK_PREPARED",
      payload: { artifactId: artifact.artifactId, candidateHash, parentHash: record.parentHash }
    });
    return artifact;
  }

  async issueApproval({ runId, revision, candidateHash, parentHash, reviewer, ttlMs = APPROVAL_TTL_MS }) {
    if (!HEX_HASH.test(String(candidateHash)) || !HEX_HASH.test(String(parentHash)) || !reviewer) {
      throw new EvolutionPromotionError("APPROVAL_INPUT_INVALID", "approval binding is incomplete");
    }
    const nonce = this.nonceFactory();
    const nonceHash = sha256(nonce);
    const issuedAt = this.now();
    const expiresAt = new Date(issuedAt.getTime() + ttlMs).toISOString();
    await this.runStore.appendEvent(runId, {
      revision,
      type: "APPROVAL_ISSUED",
      payload: { nonceHash, candidateHash, parentHash, reviewer: String(reviewer), expiresAt }
    });
    return Object.freeze({ runId, revision, candidateHash, parentHash, nonce, expiresAt });
  }

  async consumeApproval(token, expected) {
    return this.approvalLock(expected.runId, async () => {
      if (!token || token.runId !== expected.runId || token.revision !== expected.revision ||
          token.candidateHash !== expected.candidateHash || token.parentHash !== expected.parentHash) {
        throw new EvolutionPromotionError("APPROVAL_HASH_MISMATCH", "approval does not bind this candidate and parent");
      }
      const nonceHash = sha256(String(token.nonce ?? ""));
      const events = await this.runStore.readEvents(expected.runId);
      const issued = events.find((event) => event.type === "APPROVAL_ISSUED" &&
        event.revision === expected.revision && event.payload?.nonceHash === nonceHash);
      if (!issued || issued.payload.candidateHash !== expected.candidateHash || issued.payload.parentHash !== expected.parentHash) {
        throw new EvolutionPromotionError("APPROVAL_HASH_MISMATCH", "approval was not issued for this candidate");
      }
      if (Date.parse(issued.payload.expiresAt) <= this.now().getTime()) {
        throw new EvolutionPromotionError("APPROVAL_EXPIRED", "approval expired");
      }
      if (events.some((event) => event.type === "APPROVAL_CONSUMED" && event.payload?.nonceHash === nonceHash)) {
        throw new EvolutionPromotionError("APPROVAL_REPLAY", "approval is single-use");
      }
      await this.runStore.appendEvent(expected.runId, {
        revision: expected.revision,
        type: "APPROVAL_CONSUMED",
        payload: { nonceHash, candidateHash: expected.candidateHash, parentHash: expected.parentHash }
      });
      return true;
    });
  }

  async promote(input) {
    return this.serialize(async () => {
      const record = validateRollbackArtifact(input.rollbackArtifact);
      const candidateHash = sha256(input.patchText);
      if (!timingSafeHexEqual(candidateHash, input.candidateHash) ||
          !timingSafeHexEqual(candidateHash, record.candidateHash)) {
        throw new EvolutionPromotionError("CANDIDATE_HASH_MISMATCH", "patch differs from evaluated candidate");
      }
      if (input.gateDecision?.decision === "REJECT") {
        throw new EvolutionPromotionError("PROMOTION_NOT_AUTHORIZED", "deterministic gate rejected candidate");
      }
      if (input.gateDecision?.decision === "MANUAL_REVIEW") {
        await this.consumeApproval(input.approval, {
          runId: input.runId,
          revision: input.revision,
          candidateHash,
          parentHash: record.parentHash
        });
      } else if (input.gateDecision?.decision !== "PROMOTE") {
        throw new EvolutionPromotionError("PROMOTION_NOT_AUTHORIZED", "gate decision is missing");
      }

      const before = await captureBaselineSnapshot({
        repositoryRoot: this.repositoryRoot,
        relevantPaths: record.entries.map((entry) => entry.path)
      });
      if (!timingSafeHexEqual(before.contentHash, record.parentHash)) {
        throw new EvolutionPromotionError("PARENT_SNAPSHOT_MISMATCH", "canonical repository changed after evaluation");
      }
      const rollbackPaths = record.entries.map((entry) => entry.path).sort();
      const integrityPaths = Array.isArray(input.integrityPaths) && input.integrityPaths.length
        ? [...new Set(input.integrityPaths)].sort()
        : rollbackPaths;
      const sameIntegrityScope = integrityPaths.join("\n") === rollbackPaths.join("\n");
      const integrityBefore = sameIntegrityScope
        ? before
        : await captureBaselineSnapshot({ repositoryRoot: this.repositoryRoot, relevantPaths: integrityPaths });
      if (input.expectedParentHash && !timingSafeHexEqual(integrityBefore.contentHash, input.expectedParentHash)) {
        throw new EvolutionPromotionError("PARENT_SNAPSHOT_MISMATCH", "full evaluated parent snapshot changed before application");
      }

      let applied = false;
      try {
        await applyPatch(this.repositoryRoot, input.patchText);
        applied = true;
        const promoted = await captureBaselineSnapshot({
          repositoryRoot: this.repositoryRoot,
          relevantPaths: record.entries.map((entry) => entry.path)
        });
        const integrityPromoted = sameIntegrityScope
          ? promoted
          : await captureBaselineSnapshot({ repositoryRoot: this.repositoryRoot, relevantPaths: integrityPaths });
        if (input.expectedPostHash && !timingSafeHexEqual(integrityPromoted.contentHash, input.expectedPostHash)) {
          throw new EvolutionPromotionError("CANDIDATE_HASH_MISMATCH", "applied tree differs from evaluated workspace");
        }
        const smoke = typeof input.smokeEvaluator === "function" ? await input.smokeEvaluator() : { passed: false };
        if (smoke?.passed !== true) throw new EvolutionPromotionError("POST_APPLY_SMOKE_FAILED", "post-apply smoke gate failed");
        await this.runStore.appendEvent(input.runId, {
          revision: input.revision,
          type: "CANDIDATE_APPLIED",
          payload: {
            candidateHash,
            parentHash: record.parentHash,
            promotedHash: promoted.contentHash,
            integrityHash: integrityPromoted.contentHash,
            rollbackArtifact: input.rollbackArtifact.artifactId
          }
        });
        return Object.freeze({
          applied: true,
          candidateHash,
          parentHash: record.parentHash,
          promotedHash: promoted.contentHash,
          integrityHash: integrityPromoted.contentHash,
          rollbackArtifact: input.rollbackArtifact.artifactId
        });
      } catch (error) {
        if (applied) {
          await restoreEntries(this.repositoryRoot, record.entries);
          await this.runStore.appendEvent(input.runId, {
            revision: input.revision,
            type: "PROMOTION_REVERTED",
            payload: { candidateHash, reasonCode: error.code ?? "PROMOTION_FAILED" }
          });
        }
        throw error;
      }
    });
  }

  async rollback({ runId, revision, rollbackArtifact, expectedCurrentHash, smokeEvaluator }) {
    return this.serialize(async () => {
      const record = validateRollbackArtifact(rollbackArtifact);
      const current = await captureBaselineSnapshot({
        repositoryRoot: this.repositoryRoot,
        relevantPaths: record.entries.map((entry) => entry.path)
      });
      if (!expectedCurrentHash || !timingSafeHexEqual(current.contentHash, expectedCurrentHash)) {
        throw new EvolutionPromotionError("ROLLBACK_TARGET_MISMATCH", "canonical repository is not the promoted revision");
      }
      await restoreEntries(this.repositoryRoot, record.entries);
      const restored = await captureBaselineSnapshot({
        repositoryRoot: this.repositoryRoot,
        relevantPaths: record.entries.map((entry) => entry.path)
      });
      if (!timingSafeHexEqual(restored.contentHash, record.parentHash)) {
        throw new EvolutionPromotionError("ROLLBACK_CONTENT_MISMATCH", "rollback did not restore parent content");
      }
      const smoke = typeof smokeEvaluator === "function" ? await smokeEvaluator() : { passed: false };
      if (smoke?.passed !== true) throw new EvolutionPromotionError("ROLLBACK_SMOKE_FAILED", "restored repository failed smoke gate");
      await this.runStore.appendEvent(runId, {
        revision,
        type: "ROLLBACK_COMPLETED",
        payload: { candidateHash: record.candidateHash, restoredHash: restored.contentHash }
      });
      return Object.freeze({ rolledBack: true, restoredHash: restored.contentHash });
    });
  }
}
