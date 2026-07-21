/** Test origin: DS4 requirements for candidate scope, supply chain, budgets, and GitNexus preflight. */

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { EVOLUTION_PROPOSAL_VERSION, EVOLUTION_TASK_VERSION, validateEvolutionTask } from "./evolutionContracts.mjs";
import { EvolutionCandidateBuilder, inspectUnifiedPatch } from "./evolutionCandidateBuilder.mjs";
import { EvolutionWorkspaceManager } from "./evolutionWorkspace.mjs";

async function setup(overrides = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "ds4-evo-candidate-"));
  const repository = path.join(directory, "repository");
  const workRoot = path.join(directory, "workspaces");
  await fs.mkdir(path.join(repository, "src"), { recursive: true });
  await fs.mkdir(path.join(repository, "checks"), { recursive: true });
  await fs.writeFile(path.join(repository, "src", "value.txt"), "one\n", "utf8");
  await fs.writeFile(path.join(repository, "checks", "oracle.txt"), "secret\n", "utf8");
  await fs.writeFile(path.join(repository, "package.json"), '{"private":true}\n', "utf8");
  const raw = {
    contractVersion: EVOLUTION_TASK_VERSION,
    taskId: "candidate-fixture",
    title: "Candidate fixture",
    objective: "Apply a bounded manual patch",
    workspaceRoot: repository,
    mutablePaths: ["src"],
    immutablePaths: ["checks"],
    baselineRef: "snapshot",
    evaluators: [{ id: "fixture", required: true, configuration: {} }],
    metrics: [{ name: "correct", direction: "boolean", required: true, baselineTolerance: 0, target: true, weight: 1 }],
    budgets: {
      maxRevisions: 3,
      maxFilesChanged: 2,
      maxAddedLines: 10,
      maxDeletedLines: 10,
      maxWallTimeMsPerRevision: 5_000,
      maxPromptTokensPerRevision: 1_000,
      maxCompletionTokensPerRevision: 1_000
    },
    approvalPolicy: { mode: "manual", allowedRiskLevels: ["LOW"] },
    ...overrides
  };
  const taskContract = validateEvolutionTask(raw, { repositoryRoot: directory });
  const manager = new EvolutionWorkspaceManager({ repositoryRoot: repository, workRoot });
  const workspace = await manager.createWorkspace({ runId: "evo_00000000000000000001", revision: 1 });
  return { directory, repository, taskContract, manager, workspace };
}

function proposal(overrides = {}) {
  return {
    proposalVersion: EVOLUTION_PROPOSAL_VERSION,
    revision: 1,
    summary: "Append a second value",
    hypothesis: "A second line satisfies the fixture",
    targetFiles: ["src/value.txt"],
    targetSymbols: [],
    plannedChanges: [{ file: "src/value.txt", symbol: null, change: "append line", reason: "fixture", expectedMetricEffect: { metric: "correct", direction: "increase" } }],
    testsToRun: ["fixture"],
    knownRisks: [],
    stopInstead: false,
    impactAnalysis: null,
    ...overrides
  };
}

const VALID_PATCH = `diff --git a/src/value.txt b/src/value.txt
--- a/src/value.txt
+++ b/src/value.txt
@@ -1 +1,2 @@
 one
+two
`;

test("candidate builder applies a minimal patch only in the isolated workspace", async () => {
  const f = await setup();
  try {
    const result = await new EvolutionCandidateBuilder().build({
      taskContract: f.taskContract,
      proposal: proposal(),
      patchText: VALID_PATCH,
      sourceRoot: f.repository,
      workspaceRoot: f.workspace.root
    });
    assert.equal(result.audit.filesChanged, 1);
    assert.equal(result.patchMetadata.addedLines, 1);
    assert.equal(await fs.readFile(path.join(f.workspace.root, "src", "value.txt"), "utf8"), "one\ntwo\n");
    assert.equal(await fs.readFile(path.join(f.repository, "src", "value.txt"), "utf8"), "one\n");
  } finally {
    await fs.rm(f.directory, { recursive: true, force: true });
  }
});

test("SEC-PATH-001 patch parser rejects traversal before git apply", () => {
  const malicious = VALID_PATCH.replaceAll("src/value.txt", "../outside.txt");
  assert.throws(() => inspectUnifiedPatch(malicious), (error) => error.code === "UNSAFE_PATCH_PATH");
});

test("SEC-PATH-004 builder rejects immutable patch targets", async () => {
  const f = await setup();
  try {
    const patch = VALID_PATCH.replaceAll("src/value.txt", "checks/oracle.txt").replace(" one", " secret");
    await assert.rejects(
      () => new EvolutionCandidateBuilder().build({
        taskContract: f.taskContract,
        proposal: proposal({ targetFiles: ["checks/oracle.txt"] }),
        patchText: patch,
        sourceRoot: f.repository,
        workspaceRoot: f.workspace.root
      }),
      (error) => error.code === "IMMUTABLE_PATH_WRITE"
    );
  } finally {
    await fs.rm(f.directory, { recursive: true, force: true });
  }
});

test("SEC-SUPPLY-001 dependency changes are rejected by default", async () => {
  const f = await setup({ mutablePaths: ["src", "package.json"] });
  const patch = `diff --git a/package.json b/package.json
--- a/package.json
+++ b/package.json
@@ -1 +1 @@
-{"private":true}
+{"private":true,"dependencies":{"bad":"latest"}}
`;
  try {
    await assert.rejects(
      () => new EvolutionCandidateBuilder().build({
        taskContract: f.taskContract,
        proposal: proposal({ targetFiles: ["package.json"] }),
        patchText: patch,
        sourceRoot: f.repository,
        workspaceRoot: f.workspace.root
      }),
      (error) => error.code === "DEPENDENCY_CHANGE_REJECTED"
    );
  } finally {
    await fs.rm(f.directory, { recursive: true, force: true });
  }
});

test("SEC-SUPPLY-002..004 exact allowlisting accepts a locked change but forces manual review", async () => {
  const f = await setup({ mutablePaths: ["src", "package.json"] });
  const patch = `diff --git a/package.json b/package.json
--- a/package.json
+++ b/package.json
@@ -1 +1 @@
-{"private":true}
+{"private":true,"dependencies":{"safe":"1.2.3"}}
`;
  try {
    const input = {
      taskContract: f.taskContract,
      proposal: proposal({ targetFiles: ["package.json"] }),
      patchText: patch,
      sourceRoot: f.repository,
      workspaceRoot: f.workspace.root
    };
    await assert.rejects(
      () => new EvolutionCandidateBuilder({ dependencyPolicy: async () => ({ allowed: true, exact: false }) }).build(input),
      (error) => error.code === "DEPENDENCY_CHANGE_REJECTED"
    );
    const result = await new EvolutionCandidateBuilder({
      dependencyPolicy: async () => ({ allowed: true, exact: true })
    }).build(input);
    assert.deepEqual(result.dependencyChanges, ["package.json"]);
    assert.equal(result.requiresManualReview, true);
  } finally {
    await fs.rm(f.directory, { recursive: true, force: true });
  }
});

test("SEC-RISK-003 high GitNexus risk forces manual review", async () => {
  const f = await setup();
  try {
    const builder = new EvolutionCandidateBuilder({ impactProvider: async () => ({ risk: "HIGH", direct: 20 }) });
    const result = await builder.build({
      taskContract: f.taskContract,
      proposal: proposal({ targetSymbols: ["criticalFunction"], impactAnalysis: { source: "gitnexus" } }),
      patchText: VALID_PATCH,
      sourceRoot: f.repository,
      workspaceRoot: f.workspace.root
    });
    assert.equal(result.requiresManualReview, true);
    assert.equal(result.impact.risk, "HIGH");
  } finally {
    await fs.rm(f.directory, { recursive: true, force: true });
  }
});

test("symlink-mode and binary patches fail closed", () => {
  assert.throws(() => inspectUnifiedPatch(`${VALID_PATCH}new file mode 120000\n`), (error) => error.code === "SYMLINK_CHANGE_FORBIDDEN");
  assert.throws(() => inspectUnifiedPatch(`${VALID_PATCH}GIT binary patch\n`), (error) => error.code === "BINARY_CHANGE_FORBIDDEN");
});
