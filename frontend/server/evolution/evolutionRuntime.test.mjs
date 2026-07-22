/** Test origin: DS4 acceptance requirements BEH-API-003 and SEC-API-002. */

import assert from "node:assert/strict";
import test from "node:test";

import { EvolutionRuntime } from "./evolutionRuntime.mjs";

test("BEH-API-002 concurrent resume calls share exactly one active job", async () => {
  let executions = 0;
  let resolve;
  const state = { state: "BASELINE_READY", events: [] };
  const store = {
    async readEvents() { return state.events; },
    async loadRun() { return state; }
  };
  const orchestrator = { runStore: store, async stop() { state.state = "STOPPED"; return state; } };
  const loopController = {
    runUntilPause() {
      executions += 1;
      return new Promise((done) => { resolve = () => done(state); });
    }
  };
  const runtime = new EvolutionRuntime({ orchestrator, loopController, logger: { error() {} } });
  const first = runtime.resume("evo_0123456789abcdefabcd");
  const second = runtime.resume("evo_0123456789abcdefabcd");
  assert.equal(first, second);
  assert.equal(executions, 1);
  resolve();
  await first;
  assert.equal(runtime.status("evo_0123456789abcdefabcd").running, false);
});

test("SEC-API-002 broken subscribers do not fail publication", async () => {
  const event = { sequence: 1, type: "RUN_CREATED" };
  const state = { state: "MANUAL_REVIEW", events: [event] };
  const store = { async readEvents() { return [event]; }, async loadRun() { return state; } };
  const orchestrator = { runStore: store };
  const runtime = new EvolutionRuntime({ orchestrator, loopController: { async runUntilPause() { return state; } } });
  runtime.subscribe("evo_0123456789abcdefabcd", () => { throw new Error("broken"); });
  await runtime.resume("evo_0123456789abcdefabcd");
  assert.equal(runtime.status("evo_0123456789abcdefabcd").running, false);
});

test("BEH-API-003 cancellation is idempotent", async () => {
  let stops = 0;
  const state = { state: "BASELINE_READY", events: [] };
  const store = { async readEvents() { return []; }, async loadRun() { return state; } };
  const orchestrator = {
    runStore: store,
    async stop() { stops += 1; state.state = "STOPPED"; return state; }
  };
  const runtime = new EvolutionRuntime({ orchestrator, loopController: {} });
  await runtime.cancel("evo_0123456789abcdefabcd");
  await runtime.cancel("evo_0123456789abcdefabcd");
  assert.equal(stops, 1);
  assert.equal(state.state, "STOPPED");
});
