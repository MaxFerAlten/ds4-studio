import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ResearchStateStore, initialState, newSessionId } from "./researchStateStore.mjs";
import { makeEvent } from "./researchEvents.mjs";

async function tmpStore(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ds4-research-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return new ResearchStateStore({ rootDir: dir });
}

test("newSessionId matches the safe pattern", () => {
  assert.match(newSessionId(), /^rs_[a-f0-9]{12}$/);
});

test("initialState has the documented shape", () => {
  const state = initialState("q");
  assert.equal(state.status, "running");
  assert.equal(state.query, "q");
  assert.equal(state.seq, 0);
  assert.equal(state.planIterations, 0);
  assert.equal(state.currentPlan, null);
  assert.equal(state.finalReport, null);
  assert.deepEqual(state.nodes, {});
  assert.equal(state.threadId, state.sessionId);
});

test("createSession persists initial state and loads it back", async (t) => {
  const store = await tmpStore(t);
  const state = await store.createSession("test query");
  const loaded = await store.loadState(state.sessionId);
  assert.equal(loaded.query, "test query");
  assert.equal(loaded.status, "running");
});

test("loadState returns null for unknown session", async (t) => {
  const store = await tmpStore(t);
  assert.equal(await store.loadState(newSessionId()), null);
});

test("sessionDir rejects path-escape ids", async (t) => {
  const store = await tmpStore(t);
  assert.throws(() => store.sessionDir("../etc"), /invalid sessionId/);
  assert.throws(() => store.sessionDir("rs_UPPER0000000"), /invalid sessionId/);
});

test("appendEvent/readEvents round-trip in order", async (t) => {
  const store = await tmpStore(t);
  const state = await store.createSession("q");
  await store.appendEvent(makeEvent(state, "research_started", {}));
  await store.appendEvent(makeEvent(state, "node_started", {}, "coordinator"));
  const events = await store.readEvents(state.sessionId);
  assert.deepEqual(events.map((e) => e.seq), [1, 2]);
});

test("readEvents returns [] for a session without events", async (t) => {
  const store = await tmpStore(t);
  const state = await store.createSession("q");
  assert.deepEqual(await store.readEvents(state.sessionId), []);
});

test("saveState is atomic and bumps updatedAt", async (t) => {
  const store = await tmpStore(t);
  const state = await store.createSession("q");
  const before = state.updatedAt;
  await new Promise((r) => setTimeout(r, 5));
  state.status = "completed";
  await store.saveState(state);
  const loaded = await store.loadState(state.sessionId);
  assert.equal(loaded.status, "completed");
  assert.notEqual(loaded.updatedAt, before);
  const leftovers = await fs.readdir(store.sessionDir(state.sessionId));
  assert.ok(!leftovers.some((f) => f.endsWith(".tmp")));
});

test("listSessions returns newest persisted summaries and skips corrupt entries", async (t) => {
  const store = await tmpStore(t);
  const oldestId = "rs_111111111111";
  const newestId = "rs_222222222222";
  const corruptId = "rs_333333333333";

  const writeState = async (sessionId, state) => {
    await fs.mkdir(store.sessionDir(sessionId), { recursive: true });
    await fs.writeFile(store.statePath(sessionId), `${JSON.stringify(state)}\n`, "utf8");
  };

  await writeState(oldestId, {
    sessionId: oldestId,
    query: "old query",
    status: "completed",
    createdAt: "2026-06-13T08:00:00.000Z",
    updatedAt: "2026-06-13T09:00:00.000Z"
  });
  await writeState(newestId, {
    sessionId: newestId,
    query: "new query",
    status: "running",
    createdAt: "2026-06-13T10:00:00.000Z",
    updatedAt: "2026-06-13T11:00:00.000Z"
  });
  await fs.mkdir(store.sessionDir(corruptId), { recursive: true });
  await fs.writeFile(store.statePath(corruptId), "{not-json", "utf8");

  const sessions = await store.listSessions();
  assert.deepEqual(sessions.map((item) => item.sessionId), [newestId, oldestId]);
  assert.deepEqual(Object.keys(sessions[0]).sort(), [
    "createdAt",
    "engine",
    "query",
    "sessionId",
    "status",
    "updatedAt"
  ]);
});

test("initialState records the engine (default local) and a null interactionId", () => {
  assert.equal(initialState("q").engine, "local");
  assert.equal(initialState("q").interactionId, null);
  assert.equal(initialState("q", { engine: "gemini" }).engine, "gemini");
  assert.equal(initialState("q", { engine: "prism" }).engine, "prism");
  assert.equal(initialState("q", { engine: "unknown" }).engine, "local");
});

test("listSessions summaries include the engine", async (t) => {
  const store = await tmpStore(t);
  const s = await store.createSession("q", { engine: "prism" });
  const list = await store.listSessions();
  const found = list.find((x) => x.sessionId === s.sessionId);
  assert.equal(found.engine, "prism");
});
