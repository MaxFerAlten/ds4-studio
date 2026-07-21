/** Test origin: DS4 acceptance requirements SEC-PATH-001..005 and SEC-ISOLATION-001. */

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { EVOLUTION_TASK_VERSION, validateEvolutionTask } from "./evolutionContracts.mjs";
import {
  EvolutionWorkspaceManager,
  assertInside,
  auditWorkspace
} from "./evolutionWorkspace.mjs";

function rawTask(repository, overrides = {}) {
  return {
    contractVersion: EVOLUTION_TASK_VERSION,
    taskId: "workspace-fixture",
    title: "Workspace fixture",
    objective: "Verify candidate containment",
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
}

async function setup() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "ds4-evo-workspace-"));
  const repository = path.join(directory, "repository");
  const workRoot = path.join(directory, "workspaces");
  await fs.mkdir(path.join(repository, "src"), { recursive: true });
  await fs.mkdir(path.join(repository, "checks"), { recursive: true });
  await fs.writeFile(path.join(repository, "src", "value.txt"), "one\n", "utf8");
  await fs.writeFile(path.join(repository, "checks", "oracle.txt"), "secret\n", "utf8");
  const contract = validateEvolutionTask(rawTask(repository), { repositoryRoot: directory });
  const manager = new EvolutionWorkspaceManager({ repositoryRoot: repository, workRoot });
  return { directory, repository, workRoot, contract, manager };
}

test("SEC-PATH-001/002 blocks parent traversal and absolute paths", async () => {
  const f = await setup();
  try {
    await assert.rejects(() => assertInside(f.repository, "../../outside.txt"), (error) => error.code === "WORKSPACE_PATH_ESCAPE");
    await assert.rejects(() => assertInside(f.repository, "/tmp/outside.txt"), (error) => error.code === "WORKSPACE_PATH_ESCAPE");
  } finally {
    await fs.rm(f.directory, { recursive: true, force: true });
  }
});

test("SEC-PATH-003 blocks a symlink escape", async () => {
  const f = await setup();
  try {
    const outside = path.join(f.directory, "outside");
    await fs.mkdir(outside);
    await fs.symlink(outside, path.join(f.repository, "src", "escape"));
    await assert.rejects(
      () => assertInside(f.repository, "src/escape/write.txt"),
      (error) => error.code === "WORKSPACE_SYMLINK_ESCAPE"
    );
  } finally {
    await fs.rm(f.directory, { recursive: true, force: true });
  }
});

test("SEC-ISOLATION-001 creates separate disposable workspaces", async () => {
  const f = await setup();
  try {
    const first = await f.manager.createWorkspace({ runId: "evo_00000000000000000001", revision: 1 });
    const second = await f.manager.createWorkspace({ runId: "evo_00000000000000000002", revision: 1 });
    assert.notEqual(first.root, second.root);
    await fs.writeFile(path.join(first.root, "src", "value.txt"), "candidate\n", "utf8");
    assert.equal(await fs.readFile(path.join(f.repository, "src", "value.txt"), "utf8"), "one\n");
    assert.equal(await fs.readFile(path.join(second.root, "src", "value.txt"), "utf8"), "one\n");
    await f.manager.destroyWorkspace({ runId: first.runId, revision: 1 });
    await assert.rejects(() => fs.access(first.root));
  } finally {
    await fs.rm(f.directory, { recursive: true, force: true });
  }
});

test("SEC-PATH-004 rejects immutable changes before execution", async () => {
  const f = await setup();
  try {
    const workspace = await f.manager.createWorkspace({ runId: "evo_00000000000000000001", revision: 1 });
    await fs.writeFile(path.join(workspace.root, "checks", "oracle.txt"), "tampered\n", "utf8");
    await assert.rejects(
      () => auditWorkspace({ sourceRoot: f.repository, workspaceRoot: workspace.root, taskContract: f.contract }),
      (error) => error.code === "IMMUTABLE_PATH_WRITE"
    );
  } finally {
    await fs.rm(f.directory, { recursive: true, force: true });
  }
});

test("SEC-PATH-005 audit reports only bounded mutable changes", async () => {
  const f = await setup();
  try {
    const workspace = await f.manager.createWorkspace({ runId: "evo_00000000000000000001", revision: 1 });
    await fs.writeFile(path.join(workspace.root, "src", "value.txt"), "one\ntwo\n", "utf8");
    const audit = await f.manager.audit(workspace.root, f.contract);
    assert.equal(audit.filesChanged, 1);
    assert.equal(audit.addedLines, 1);
    assert.equal(audit.deletedLines, 0);
    assert.equal(audit.changes[0].path, "src/value.txt");
  } finally {
    await fs.rm(f.directory, { recursive: true, force: true });
  }
});
