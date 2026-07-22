/** Test origin: DS4 acceptance requirements BEH-LOOP-003 and SEC-LOOP-003. */

import assert from "node:assert/strict";
import test from "node:test";

import { EvolutionLoopController } from "./evolutionLoopController.mjs";
import { hashJson } from "./evolutionIntegrity.mjs";

function fixture() {
  const calls = [];
  const events = [];
  const artifacts = new Map();
  const run = {
    runId: "evo_0123456789abcdefabcd",
    state: "BASELINE_READY",
    revision: 0,
    manifest: {
      taskContract: {
        objective: "Improve",
        automation: { level: "D", proposerEnabled: true, autoContinue: true },
        budgets: {
          maxTotalPromptTokens: 100,
          maxTotalCompletionTokens: 100,
          maxTotalWallTimeMs: 1000,
          maxModelCallsPerRevision: 4,
          maxRepeatedFailureSignatures: 2
        }
      }
    },
    events
  };
  const store = {
    async loadRun() { return run; },
    async readEvents() { return events; },
    async writeRevisionArtifact(_runId, _revision, name, value) { calls.push(`write:${name}`); artifacts.set(name, value); },
    async readRevisionArtifact(_runId, _revision, name) {
      if (!artifacts.has(name)) throw Object.assign(new Error(name), { code: "ARTIFACT_NOT_FOUND" });
      return { truncated: false, content: JSON.stringify(artifacts.get(name)) };
    },
    async appendEvent(_runId, event) { events.push({ sequence: events.length + 1, ...event }); }
  };
  const orchestrator = {
    runStore: store,
    async buildRevision() { calls.push("build"); run.state = "CANDIDATE_READY"; run.revision = 1; return { revision: 1, workspace: { root: "/tmp/work" } }; },
    async executeAndEvaluate() { calls.push("evaluate"); run.state = "GATING"; return { state: "GATING", evaluation: {}, candidate: {} }; },
    async gateRevision() { calls.push("gate"); run.state = "MANUAL_REVIEW"; },
    async stop(_runId, reason) { calls.push(`stop:${reason}`); run.state = "STOPPED"; return run; }
  };
  const evidence = {
    role: "proposer",
    usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    calls: 1,
    repairs: 0,
    responseHash: "b".repeat(64)
  };
  const proposal = { revision: 1, stopInstead: false };
  const proposalHash = hashJson(proposal);
  const proposer = {
    async propose() { calls.push("propose"); return { proposal, proposalHash, modelEvidence: evidence }; },
    async producePatch() {
      calls.push("patch");
      return {
        patchText: "diff",
        generatedPatch: { proposalHash, patchText: "diff" },
        modelEvidence: { ...evidence, role: "patcher", responseHash: "c".repeat(64) }
      };
    }
  };
  return { calls, run, orchestrator, proposer, artifacts };
}

test("BEH-LOOP-003 executes one ordered revision and pauses at manual review", async () => {
  const f = fixture();
  const controller = new EvolutionLoopController({ orchestrator: f.orchestrator, proposer: f.proposer });
  const run = await controller.runUntilPause(f.run.runId);
  assert.equal(run.state, "MANUAL_REVIEW");
  assert.deepEqual(f.calls.filter((entry) => ["propose", "patch", "build", "evaluate", "gate"].includes(entry)), ["propose", "patch", "build", "evaluate", "gate"]);
});

test("BEH-LOOP-002 restart reuses durable Proposer and Patcher outputs without duplicate model calls", async () => {
  const f = fixture();
  let builds = 0;
  const originalBuild = f.orchestrator.buildRevision;
  f.orchestrator.buildRevision = async (...args) => {
    builds += 1;
    if (builds === 1) throw new Error("simulated crash after model output persistence");
    return originalBuild(...args);
  };
  const controller = new EvolutionLoopController({ orchestrator: f.orchestrator, proposer: f.proposer });
  await assert.rejects(() => controller.runOneRevision(f.run.runId), /simulated crash/);
  await controller.runOneRevision(f.run.runId);
  assert.equal(f.calls.filter((entry) => entry === "propose").length, 1);
  assert.equal(f.calls.filter((entry) => entry === "patch").length, 1);
  assert.equal(f.artifacts.has("generated-proposal.json"), true);
  assert.equal(f.artifacts.has("generated-patch.json"), true);
});

test("SEC-LOOP-003 stops before proposing when total budget is exhausted", async () => {
  const f = fixture();
  f.orchestrator.runStore.readEvents = async () => [{
    type: "MODEL_CALL_COMPLETED",
    revision: 0,
    payload: { usage: { promptTokens: 101, completionTokens: 1 }, wallTimeMs: 0 }
  }];
  const controller = new EvolutionLoopController({ orchestrator: f.orchestrator, proposer: f.proposer });
  const run = await controller.runOneRevision(f.run.runId);
  assert.equal(run.state, "STOPPED");
  assert.equal(f.calls.includes("propose"), false);
});
