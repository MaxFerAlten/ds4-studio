/** Test origin: DS4 acceptance requirements BEH-PROMOTE-001..002, SEC-APPROVAL-001..002, SEC-TOCTOU-001..002, SEC-ROLLBACK-001..003. */

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { EVOLUTION_TASK_VERSION } from "./evolutionContracts.mjs";
import { sha256 } from "./evolutionIntegrity.mjs";
import { EvolutionPromotionService } from "./evolutionPromotion.mjs";
import { captureBaselineSnapshot, EvolutionRunStore } from "./evolutionRunStore.mjs";

const PATCH = `diff --git a/src/value.txt b/src/value.txt
--- a/src/value.txt
+++ b/src/value.txt
@@ -1 +1,2 @@
 one
+two
`;

function task(repository) {
  return {
    contractVersion: EVOLUTION_TASK_VERSION,
    taskId: "promotion-fixture",
    title: "Promotion fixture",
    objective: "Promote and restore a bounded patch",
    workspaceRoot: repository,
    mutablePaths: ["src/value.txt"],
    immutablePaths: ["checks/oracle.txt"],
    baselineRef: "snapshot",
    evaluators: [{ id: "fixture", required: true, configuration: {} }],
    metrics: [{ name: "correct", direction: "boolean", required: true, baselineTolerance: 0, target: true, weight: 1 }],
    budgets: {
      maxRevisions: 2, maxFilesChanged: 2, maxAddedLines: 10, maxDeletedLines: 10,
      maxWallTimeMsPerRevision: 5_000, maxPromptTokensPerRevision: 1_000, maxCompletionTokensPerRevision: 1_000
    },
    approvalPolicy: { mode: "manual", allowedRiskLevels: ["LOW"] }
  };
}

async function setup() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "ds4-evo-promote-"));
  const repository = path.join(directory, "repository");
  await fs.mkdir(path.join(repository, "src"), { recursive: true });
  await fs.mkdir(path.join(repository, "checks"), { recursive: true });
  await fs.writeFile(path.join(repository, "src", "value.txt"), "one\n", "utf8");
  await fs.writeFile(path.join(repository, "checks", "oracle.txt"), "secret\n", "utf8");
  const runId = "evo_00000000000000000001";
  const store = new EvolutionRunStore({ rootDir: path.join(directory, "runs"), runIdFactory: () => runId });
  await store.createRun(task(repository), { repositoryRoot: directory });
  const service = new EvolutionPromotionService({
    repositoryRoot: repository,
    runStore: store,
    nonceFactory: () => "nonce-fixture",
    now: () => new Date("2026-01-01T00:00:00.000Z")
  });
  const candidateHash = sha256(PATCH);
  const rollbackArtifact = await service.prepareRollback({ runId, revision: 1, candidateHash, paths: ["src/value.txt"] });
  return { directory, repository, runId, store, service, candidateHash, rollbackArtifact };
}

test("SEC-ROLLBACK-001 creates rollback material before promotion", async () => {
  const f = await setup();
  try {
    assert.match(f.rollbackArtifact.artifactId, /^sha256:/);
    assert.equal(f.rollbackArtifact.record.entries[0].contentBase64, Buffer.from("one\n").toString("base64"));
    const events = await f.store.readEvents(f.runId);
    assert.ok(events.some((event) => event.type === "ROLLBACK_PREPARED"));
  } finally {
    await fs.rm(f.directory, { recursive: true, force: true });
  }
});

test("BEH-PROMOTE-001 applies the exact candidate after deterministic authorization", async () => {
  const f = await setup();
  try {
    const result = await f.service.promote({
      runId: f.runId,
      revision: 1,
      patchText: PATCH,
      candidateHash: f.candidateHash,
      rollbackArtifact: f.rollbackArtifact,
      gateDecision: { decision: "PROMOTE" },
      smokeEvaluator: async () => ({ passed: true })
    });
    assert.equal(result.applied, true);
    assert.equal(await fs.readFile(path.join(f.repository, "src", "value.txt"), "utf8"), "one\ntwo\n");
  } finally {
    await fs.rm(f.directory, { recursive: true, force: true });
  }
});

test("BEH-PROMOTE-002 smoke failure automatically restores parent content", async () => {
  const f = await setup();
  try {
    await assert.rejects(
      () => f.service.promote({
        runId: f.runId,
        revision: 1,
        patchText: PATCH,
        candidateHash: f.candidateHash,
        rollbackArtifact: f.rollbackArtifact,
        gateDecision: { decision: "PROMOTE" },
        smokeEvaluator: async () => ({ passed: false })
      }),
      (error) => error.code === "POST_APPLY_SMOKE_FAILED"
    );
    assert.equal(await fs.readFile(path.join(f.repository, "src", "value.txt"), "utf8"), "one\n");
    assert.ok((await f.store.readEvents(f.runId)).some((event) => event.type === "PROMOTION_REVERTED"));
  } finally {
    await fs.rm(f.directory, { recursive: true, force: true });
  }
});

test("SEC-TOCTOU-001/002 rejects candidate or parent drift", async () => {
  const candidate = await setup();
  try {
    await assert.rejects(
      () => candidate.service.promote({
        runId: candidate.runId,
        revision: 1,
        patchText: `${PATCH}\n`,
        candidateHash: candidate.candidateHash,
        rollbackArtifact: candidate.rollbackArtifact,
        gateDecision: { decision: "PROMOTE" },
        smokeEvaluator: async () => ({ passed: true })
      }),
      (error) => error.code === "CANDIDATE_HASH_MISMATCH"
    );
  } finally {
    await fs.rm(candidate.directory, { recursive: true, force: true });
  }

  const parent = await setup();
  try {
    await fs.writeFile(path.join(parent.repository, "src", "value.txt"), "drift\n", "utf8");
    await assert.rejects(
      () => parent.service.promote({
        runId: parent.runId,
        revision: 1,
        patchText: PATCH,
        candidateHash: parent.candidateHash,
        rollbackArtifact: parent.rollbackArtifact,
        gateDecision: { decision: "PROMOTE" },
        smokeEvaluator: async () => ({ passed: true })
      }),
      (error) => error.code === "PARENT_SNAPSHOT_MISMATCH"
    );
  } finally {
    await fs.rm(parent.directory, { recursive: true, force: true });
  }
});

test("SEC-TOCTOU-002 detects drift outside the patch across the full evaluated parent", async () => {
  const f = await setup();
  try {
    const integrityPaths = ["src/value.txt", "checks/oracle.txt"];
    const parent = await captureBaselineSnapshot({ repositoryRoot: f.repository, relevantPaths: integrityPaths });
    await fs.writeFile(path.join(f.repository, "checks", "oracle.txt"), "drifted\n", "utf8");
    await assert.rejects(
      () => f.service.promote({
        runId: f.runId,
        revision: 1,
        patchText: PATCH,
        candidateHash: f.candidateHash,
        rollbackArtifact: f.rollbackArtifact,
        gateDecision: { decision: "PROMOTE" },
        integrityPaths,
        expectedParentHash: parent.contentHash,
        smokeEvaluator: async () => ({ passed: true })
      }),
      (error) => error.code === "PARENT_SNAPSHOT_MISMATCH"
    );
    assert.equal(await fs.readFile(path.join(f.repository, "src", "value.txt"), "utf8"), "one\n");
  } finally {
    await fs.rm(f.directory, { recursive: true, force: true });
  }
});

test("SEC-TOCTOU-001 post-apply tree hash mismatch automatically reverts", async () => {
  const f = await setup();
  try {
    await assert.rejects(
      () => f.service.promote({
        runId: f.runId,
        revision: 1,
        patchText: PATCH,
        candidateHash: f.candidateHash,
        rollbackArtifact: f.rollbackArtifact,
        gateDecision: { decision: "PROMOTE" },
        integrityPaths: ["src/value.txt", "checks/oracle.txt"],
        expectedPostHash: "f".repeat(64),
        smokeEvaluator: async () => ({ passed: true })
      }),
      (error) => error.code === "CANDIDATE_HASH_MISMATCH"
    );
    assert.equal(await fs.readFile(path.join(f.repository, "src", "value.txt"), "utf8"), "one\n");
  } finally {
    await fs.rm(f.directory, { recursive: true, force: true });
  }
});

test("SEC-APPROVAL-001/002 approval binds hashes and is single-use", async () => {
  const f = await setup();
  try {
    const approval = await f.service.issueApproval({
      runId: f.runId,
      revision: 1,
      candidateHash: f.candidateHash,
      parentHash: f.rollbackArtifact.parentHash,
      reviewer: "maintainer"
    });
    await assert.rejects(
      () => f.service.consumeApproval({ ...approval, candidateHash: "f".repeat(64) }, {
        runId: f.runId, revision: 1, candidateHash: f.candidateHash, parentHash: f.rollbackArtifact.parentHash
      }),
      (error) => error.code === "APPROVAL_HASH_MISMATCH"
    );
    await assert.rejects(
      () => f.service.consumeApproval(approval, {
        runId: "evo_00000000000000000002", revision: 1,
        candidateHash: f.candidateHash, parentHash: f.rollbackArtifact.parentHash
      }),
      (error) => error.code === "APPROVAL_HASH_MISMATCH"
    );
    const expected = { runId: f.runId, revision: 1, candidateHash: f.candidateHash, parentHash: f.rollbackArtifact.parentHash };
    assert.equal(await f.service.consumeApproval(approval, expected), true);
    await assert.rejects(() => f.service.consumeApproval(approval, expected), (error) => error.code === "APPROVAL_REPLAY");
  } finally {
    await fs.rm(f.directory, { recursive: true, force: true });
  }
});

test("SEC-ROLLBACK-002/003 restores parent hashes and runs smoke gate", async () => {
  const f = await setup();
  try {
    const promoted = await f.service.promote({
      runId: f.runId,
      revision: 1,
      patchText: PATCH,
      candidateHash: f.candidateHash,
      rollbackArtifact: f.rollbackArtifact,
      gateDecision: { decision: "PROMOTE" },
      smokeEvaluator: async () => ({ passed: true })
    });
    const rollback = await f.service.rollback({
      runId: f.runId,
      revision: 1,
      rollbackArtifact: f.rollbackArtifact,
      expectedCurrentHash: promoted.promotedHash,
      smokeEvaluator: async () => ({ passed: true })
    });
    assert.equal(rollback.restoredHash, f.rollbackArtifact.parentHash);
    assert.equal(await fs.readFile(path.join(f.repository, "src", "value.txt"), "utf8"), "one\n");
  } finally {
    await fs.rm(f.directory, { recursive: true, force: true });
  }
});
