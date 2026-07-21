/** Test origin: DS4 acceptance requirements BEH-BASE-001..002, BEH-STATE-004, SEC-BASE-001..002, SEC-LEDGER-001..005. */

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { EVOLUTION_TASK_VERSION } from "./evolutionContracts.mjs";
import { hashJson } from "./evolutionIntegrity.mjs";
import {
  EvolutionRunStore,
  EvolutionRunStoreError,
  captureBaselineSnapshot
} from "./evolutionRunStore.mjs";

function task(workspaceRoot) {
  return {
    contractVersion: EVOLUTION_TASK_VERSION,
    taskId: "ledger-fixture",
    title: "Ledger fixture",
    objective: "Verify durable deterministic state",
    workspaceRoot,
    mutablePaths: ["src/value.txt"],
    immutablePaths: ["checks/evaluator.mjs"],
    baselineRef: "snapshot",
    evaluators: [{ id: "fixture", required: true, configuration: {} }],
    metrics: [{ name: "correct", direction: "boolean", required: true, baselineTolerance: 0, target: true, weight: 1 }],
    budgets: {
      maxRevisions: 2,
      maxFilesChanged: 2,
      maxAddedLines: 100,
      maxDeletedLines: 100,
      maxWallTimeMsPerRevision: 5_000,
      maxPromptTokensPerRevision: 1_000,
      maxCompletionTokensPerRevision: 1_000
    },
    approvalPolicy: { mode: "manual", allowedRiskLevels: ["LOW"] }
  };
}

async function fixture() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "ds4-evo-store-"));
  const repository = path.join(directory, "repo");
  await fs.mkdir(path.join(repository, "src"), { recursive: true });
  await fs.mkdir(path.join(repository, "checks"), { recursive: true });
  await fs.writeFile(path.join(repository, "src", "value.txt"), "baseline\n", "utf8");
  await fs.writeFile(path.join(repository, "checks", "evaluator.mjs"), "export default true;\n", "utf8");
  const runId = "evo_00000000000000000001";
  const store = new EvolutionRunStore({
    rootDir: path.join(directory, "runs"),
    runIdFactory: () => runId,
    eventIdFactory: (() => { let id = 0; return () => `event-${++id}`; })(),
    now: (() => { let second = 0; return () => new Date(Date.UTC(2026, 0, 1, 0, 0, second++)); })()
  });
  await store.createRun(task(repository), { repositoryRoot: directory });
  return { directory, repository, runId, store };
}

test("BEH-STATE-004 transition persists exactly one monotonic event", async () => {
  const f = await fixture();
  try {
    const before = await f.store.readEvents(f.runId);
    const event = await f.store.transitionRun(f.runId, "BASELINE_CAPTURING");
    const after = await f.store.readEvents(f.runId);
    assert.equal(after.length, before.length + 1);
    assert.equal(event.sequence, 2);
    assert.equal(after[1].payload.from, "CREATED");
    assert.equal(after[1].payload.to, "BASELINE_CAPTURING");
  } finally {
    await fs.rm(f.directory, { recursive: true, force: true });
  }
});

test("SEC-LEDGER-001/002 sequences are monotonic and duplicates are rejected", async () => {
  const f = await fixture();
  try {
    await assert.rejects(
      () => f.store.appendEvent(f.runId, { sequence: 1, revision: 0, type: "FIXTURE_EVENT", payload: {} }),
      (error) => error.code === "DUPLICATE_OR_OUT_OF_ORDER_SEQUENCE"
    );
    const event = await f.store.appendEvent(f.runId, { revision: 0, type: "FIXTURE_EVENT", payload: { ok: true } });
    assert.equal(event.sequence, 2);
  } finally {
    await fs.rm(f.directory, { recursive: true, force: true });
  }
});

test("SEC-LEDGER-003 recovers a truncated final line without losing valid events", async () => {
  const f = await fixture();
  try {
    await fs.appendFile(f.store.eventsPath(f.runId), '{"partial":', "utf8");
    const events = await f.store.readEvents(f.runId);
    assert.equal(events.length, 1);
    const repaired = await fs.readFile(f.store.eventsPath(f.runId), "utf8");
    assert.equal(repaired.endsWith("\n"), true);
    assert.equal(repaired.includes("partial"), false);
  } finally {
    await fs.rm(f.directory, { recursive: true, force: true });
  }
});

test("SEC-LEDGER-004 detects payload tampering", async () => {
  const f = await fixture();
  try {
    const file = f.store.eventsPath(f.runId);
    const events = (await fs.readFile(file, "utf8")).trimEnd().split("\n").map(JSON.parse);
    events[0].payload.state = "PROMOTED";
    await fs.writeFile(file, `${events.map(JSON.stringify).join("\n")}\n`, "utf8");
    await assert.rejects(() => f.store.readEvents(f.runId), (error) => error.code === "LEDGER_INTEGRITY_FAILURE");
  } finally {
    await fs.rm(f.directory, { recursive: true, force: true });
  }
});

test("SEC-LEDGER-005 restart reconstructs the exact state", async () => {
  const f = await fixture();
  try {
    await f.store.transitionRun(f.runId, "BASELINE_CAPTURING");
    const restarted = new EvolutionRunStore({ rootDir: path.join(f.directory, "runs") });
    const run = await restarted.loadRun(f.runId);
    assert.equal(run.state, "BASELINE_CAPTURING");
    assert.equal(run.sequence, 2);
  } finally {
    await fs.rm(f.directory, { recursive: true, force: true });
  }
});

test("BEH-BASE-001 captures hashes and SEC-BASE-002 detects mutation", async () => {
  const f = await fixture();
  try {
    await f.store.transitionRun(f.runId, "BASELINE_CAPTURING");
    const snapshot = await captureBaselineSnapshot({
      repositoryRoot: f.repository,
      relevantPaths: ["src/value.txt", "checks/evaluator.mjs"],
      configuration: { mode: "fixture" },
      now: new Date("2026-01-01T00:00:00Z")
    });
    assert.equal(snapshot.files.length, 2);
    assert.match(snapshot.contentHash, /^[a-f0-9]{64}$/);
    await f.store.saveBaseline(f.runId, snapshot, { status: "passed" });
    assert.deepEqual(await f.store.verifyBaseline(f.runId, f.repository), { ok: true, contentHash: snapshot.contentHash });
    await fs.writeFile(path.join(f.repository, "src", "value.txt"), "mutated\n", "utf8");
    await assert.rejects(
      () => f.store.verifyBaseline(f.runId, f.repository),
      (error) => error instanceof EvolutionRunStoreError && error.code === "BASELINE_MUTATED"
    );
  } finally {
    await fs.rm(f.directory, { recursive: true, force: true });
  }
});

test("SEC-BASE-001 baseline records cannot be overwritten", async () => {
  const f = await fixture();
  try {
    const snapshot = await captureBaselineSnapshot({ repositoryRoot: f.repository, relevantPaths: ["src/value.txt"] });
    await f.store.saveBaseline(f.runId, snapshot);
    await assert.rejects(() => f.store.saveBaseline(f.runId, snapshot), (error) => error.code === "IMMUTABLE_ARTIFACT_EXISTS");
  } finally {
    await fs.rm(f.directory, { recursive: true, force: true });
  }
});

test("SEC-BASE-002 a self-consistent baseline rewrite is rejected by the ledger binding", async () => {
  const f = await fixture();
  try {
    const snapshot = await captureBaselineSnapshot({ repositoryRoot: f.repository, relevantPaths: ["src/value.txt"] });
    await f.store.saveBaseline(f.runId, snapshot, { status: "passed" });
    const rewritten = structuredClone(snapshot);
    rewritten.files[0].hash = "f".repeat(64);
    rewritten.contentHash = hashJson(rewritten.files);
    await fs.writeFile(f.store.baselinePath(f.runId, "snapshot.json"), `${JSON.stringify(rewritten, null, 2)}\n`, "utf8");
    await assert.rejects(
      () => f.store.loadBaseline(f.runId),
      (error) => error.code === "BASELINE_INTEGRITY_FAILURE"
    );
  } finally {
    await fs.rm(f.directory, { recursive: true, force: true });
  }
});

test("BEH-LEDGER-001/SEC-ISOLATION-002 externalizes large output and blocks cross-run evidence access", async () => {
  const f = await fixture();
  try {
    const reference = await f.store.putBlob(f.runId, "large-output".repeat(10_000));
    assert.equal((await f.store.getBlob(f.runId, reference, 0, 12)), "large-output");
    await assert.rejects(
      () => f.store.getBlob(f.runId, { ...reference, runId: "evo_00000000000000000002" }),
      (error) => error.code === "CROSS_RUN_ACCESS_ATTEMPT"
    );
  } finally {
    await fs.rm(f.directory, { recursive: true, force: true });
  }
});
