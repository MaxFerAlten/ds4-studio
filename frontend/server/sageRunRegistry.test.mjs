import test from "node:test";
import assert from "node:assert/strict";

import { SageRunRegistry, SAGE_RUN_TTL_MS } from "./sageRunRegistry.mjs";

function clock(start = 1_000_000) {
  let value = start;
  return {
    now: () => value,
    advance(ms) {
      value += ms;
    }
  };
}

test("lo stesso run ritrova il proprio tracker", () => {
  const registry = new SageRunRegistry();
  const first = registry.getOrCreate({ sessionId: "s1", runId: "r1", taskType: "evaluate" });
  assert.equal(first.ok, true);
  assert.equal(first.created, true);
  first.entry.tracker.recordCall({ phase: "compute" });

  const second = registry.getOrCreate({ sessionId: "s1", runId: "r1" });
  assert.equal(second.created, false);
  assert.equal(second.entry.tracker, first.entry.tracker);
  assert.equal(second.entry.tracker.snapshot().computeCount, 1);
});

test("un run appartiene alla sessione che lo ha creato", () => {
  const registry = new SageRunRegistry();
  registry.getOrCreate({ sessionId: "s1", runId: "r1", taskType: "evaluate" });
  assert.equal(registry.get({ sessionId: "s2", runId: "r1" }), null);

  const other = registry.getOrCreate({ sessionId: "s2", runId: "r1" });
  assert.equal(other.created, true, "una sessione diversa ha ricevuto il run altrui");
  assert.equal(registry.size(), 2);
});

test("SAGE-REG-01/02 TTL elimina terminali ma conserva run attive", () => {
  const time = clock();
  const registry = new SageRunRegistry({ now: time.now });
  const terminal = registry.getOrCreate({
    sessionId: "s1",
    runId: "terminale",
    taskType: "evaluate"
  });
  terminal.entry.tracker.markCancelled();
  registry.getOrCreate({ sessionId: "s1", runId: "attivo", taskType: "evaluate" });
  time.advance(SAGE_RUN_TTL_MS + 1);
  registry.getOrCreate({ sessionId: "s1", runId: "nuovo", taskType: "evaluate" });

  assert.equal(registry.get({ sessionId: "s1", runId: "terminale" }), null);
  assert.ok(registry.get({ sessionId: "s1", runId: "attivo" }));
  assert.ok(registry.get({ sessionId: "s1", runId: "nuovo" }));
});

test("il cap evince solo run terminali", () => {
  const registry = new SageRunRegistry({ maxEntries: 2 });
  const a = registry.getOrCreate({ sessionId: "s", runId: "a", taskType: "evaluate" });
  registry.getOrCreate({ sessionId: "s", runId: "b", taskType: "evaluate" });

  // Entrambi attivi: il terzo run viene rifiutato, non ruba lo slot.
  const busy = registry.getOrCreate({ sessionId: "s", runId: "c", taskType: "evaluate" });
  assert.equal(busy.ok, false);
  assert.equal(busy.code, "SAGE_RUN_REGISTRY_BUSY");

  a.entry.tracker.markCancelled();
  const accepted = registry.getOrCreate({ sessionId: "s", runId: "c", taskType: "evaluate" });
  assert.equal(accepted.ok, true);
  assert.equal(registry.get({ sessionId: "s", runId: "a" }), null);
  assert.ok(registry.get({ sessionId: "s", runId: "b" }));
});

test("update conserva candidato, validazione e risultato finale", () => {
  const time = clock();
  const registry = new SageRunRegistry({ now: time.now });
  const { entry } = registry.getOrCreate({ sessionId: "s", runId: "r", taskType: "evaluate" });
  const createdAt = entry.updatedAt;

  time.advance(1000);
  registry.update(entry, {
    candidate: { code: "1+1" },
    validation: { passed: false },
    finalResult: null
  });

  assert.deepEqual(entry.lastCandidate, { code: "1+1" });
  assert.deepEqual(entry.lastValidation, { passed: false });
  assert.ok(entry.updatedAt > createdAt);
});

test("un run senza id non viene registrato", () => {
  const registry = new SageRunRegistry();
  assert.deepEqual(registry.getOrCreate({ sessionId: "s" }), {
    ok: false,
    code: "SAGE_RUN_ID_REQUIRED"
  });
});
