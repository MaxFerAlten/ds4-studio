import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import express from "express";
import { HttpAgent } from "@ag-ui/client";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentAdmissionError, createAgentAdmission } from "../agentAdmission.mjs";
import { createAgentRunService, AGENT_RUN_OUTCOME } from "../agent/runService.mjs";
import { createRunIngress } from "../agent/runIngress.mjs";
import { createThreadStore } from "../agent/threadStore.mjs";
import { loadAguiSdk } from "./sdk.mjs";
import { createAguiGateway, isLoopbackRequest, mountAguiRoutes } from "./route.mjs";
import { createAguiRecorder } from "./recorder.mjs";
import { aguiFeatureFlags } from "./featureFlags.mjs";
import { openLocalThreadStorage } from "../agent/localThreadStorage.mjs";

const sdk = await loadAguiSdk();

test("AG-UI feature flag is off by default and enabled only by the explicit value 1", () => {
  assert.equal(aguiFeatureFlags({}).aguiEnabled, false);
  assert.equal(aguiFeatureFlags({ DS4_AGUI_ENABLED: "true" }).aguiEnabled, false);
  assert.equal(aguiFeatureFlags({ DS4_AGUI_ENABLED: "1" }).aguiEnabled, true);
  assert.equal(aguiFeatureFlags({ DS4_AGUI_ENABLED: "1" }).durableHistory, false);
  assert.deepEqual(aguiFeatureFlags({ DS4_AGUI_ENABLED: "1", DS4_LOCAL_THREADS_ENABLED: "1" }), {
    aguiEnabled: true, localThreads: true, nativeMultiThread: false, durableHistory: true
  });
  assert.throws(() => aguiFeatureFlags({ DS4_LOCAL_THREADS_ENABLED: "1" }), /requires DS4_AGUI_ENABLED=1/);
});

test("durable thread library exposes owner-scoped list, create, archive, export and idempotent legacy import", async () => {
  await withGateway(async () => ({ kind: AGENT_RUN_OUTCOME.STREAMED }), async ({ base, store }) => {
    const request = (path, options) => fetch(`${base}${path}`, options).then(async (response) => ({ status: response.status, body: await response.json() }));
    const created = await request("/api/agui/threads", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: "Nuova" }) });
    assert.equal(created.status, 201);
    assert.equal(created.body.title, "Nuova");
    assert.throws(() => store.deleteThread("another-owner", created.body.threadId), { code: "THREAD_NOT_FOUND" });
    const catalog = await request(`/api/agui/dots?threadId=${created.body.threadId}`);
    assert.ok(catalog.body.tools.some((tool) => tool.id === "read" && tool.description));
    assert.equal(catalog.body.tools.some((tool) => tool.id === "sage"), false);
    const listed = await request("/api/agui/threads?limit=1");
    assert.equal(listed.body.threads[0].threadId, created.body.threadId);
    const legacy = { fileName: "sessione.md", messages: [{ id: "u-legacy", role: "user", content: [{ type: "text", text: "Ciao" }] }, { id: "a-legacy", role: "assistant", content: [{ type: "text", text: "Salve" }] }, { id: "tool-legacy", role: "tool", content: "non importato" }] };
    const importOnce = await request("/api/agui/import/legacy", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(legacy) });
    const importTwice = await request("/api/agui/import/legacy", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(legacy) });
    assert.equal(importOnce.status, 201);
    assert.equal(importTwice.status, 200);
    assert.equal(importOnce.body.thread.threadId, importTwice.body.thread.threadId);
    assert.match(importOnce.body.warnings.join(" "), /tool escluso/);
    assert.equal(importOnce.body.thread.title, "sessione.md");
    const messagePage = await request(`/api/agui/threads/${importOnce.body.thread.threadId}?limit=1`);
    assert.equal(messagePage.body.messages[0].content, "Salve");
    assert.ok(messagePage.body.previousCursor);
    const olderPage = await request(`/api/agui/threads/${importOnce.body.thread.threadId}?limit=1&before=${messagePage.body.previousCursor}`);
    assert.equal(olderPage.body.messages[0].content, "Ciao");
    assert.equal((await request("/api/agui/threads?limit=1")).body.threads[0].messages, undefined);
    const exported = await request(`/api/agui/threads/${created.body.threadId}/export`);
    assert.equal(exported.body.format, "ds4-thread-v1");
    const archived = await request(`/api/agui/threads/${created.body.threadId}/archive`, { method: "POST" });
    assert.ok(archived.body.archivedAt);
    assert.equal((await request("/api/agui/threads")).body.threads.some((thread) => thread.threadId === created.body.threadId), false);
    const deleted = await request(`/api/agui/threads/${created.body.threadId}`, { method: "DELETE" });
    assert.equal(deleted.status, 200);
    assert.equal(deleted.body.deleted, true);
    assert.equal((await request(`/api/agui/threads/${created.body.threadId}`)).status, 404);
  }, { durable: true });
});

async function withGateway(runJsTurn, fn, { durable = false } = {}) {
  const admission = createAgentAdmission();
  const dir = durable ? mkdtempSync(join(tmpdir(), "ds4-agui-durable-")) : null;
  const storage = durable ? await openLocalThreadStorage({ databasePath: join(dir, "threads.sqlite") }) : null;
  const store = storage?.store ?? createThreadStore({ mintId: (() => { let id = 0; return () => `id-${++id}`; })() });
  const service = createAgentRunService({
    resolveEngine: () => "js",
    runJsTurn,
    runNativeTurn: async () => { throw new Error("native must stay disabled"); },
    admission
  });
  const ingress = createRunIngress({
    admission, store, service, resolveEngine: () => "js",
    checkpointSession: durable ? ({ ownerId, threadId, frozen }) => store.saveCheckpoint(ownerId, threadId, {
      engine: frozen.engine, profile: { model: frozen.model ?? null },
      checkpoint: { version: 1, messages: [{ role: "assistant", content: "test checkpoint" }] }
    }) : null
  });
  const identity = {
    requireOrigin(req) {
      if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) {
        throw new AgentAdmissionError("ORIGIN_REJECTED", "cross-origin request rejected", 403);
      }
    },
    ownerOf: () => "owner-fixed"
  };
  const app = express();
  app.use((req, res, next) => {
    const write = res.write.bind(res);
    res.write = (chunk) => {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      for (let offset = 0; offset < bytes.length; offset += 3) write(bytes.subarray(offset, offset + 3));
      return true;
    };
    next();
  });
  app.use(express.json());
  const recorder = createAguiRecorder();
  const gateway = createAguiGateway({
    flags: { aguiEnabled: true, nativeMultiThread: false, durableHistory: durable },
    sdk, ingress, store, identity, recorder, engine: () => "js", keepaliveMs: 1000
  });
  mountAguiRoutes(app, gateway);
  const server = createServer(app);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;
  try { await fn({ base, admission, recorder, store }); }
  finally {
    await new Promise((resolve) => server.close(resolve));
    storage?.close();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
}

test("AG-UI gateway uses AgentRunService once, preserves split UTF-8 and sends one terminal", async () => {
  let calls = 0;
  await withGateway(async (_input, emit) => {
    calls += 1;
    emit("run_started", {});
    emit("agent_text", { content: "Risultato: perché " });
    emit("agent_tool_call", { id: "call_1", name: "ds4.read_file", arguments: { path: "notes/è.md" } });
    emit("agent_tool_result", { id: "call_1", name: "ds4.read_file", content: "contenuto ✓" });
    emit("agent_text", { content: "fatto." });
    emit("agent_done", { finish_reason: "stop", iterations: 2 });
    return { kind: AGENT_RUN_OUTCOME.STREAMED };
  }, async ({ base }) => {
    const thread = await (await fetch(`${base}/api/agui/thread`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })).json();
    const agent = new HttpAgent({ url: `${base}/api/agui/agent`, threadId: thread.threadId });
    agent.addMessage({ id: "u-1", role: "user", content: "Leggi il file" });
    const finished = [];
    const errors = [];
    await agent.runAgent({ forwardedProps: { ds4: { baseRevision: thread.revision } } }, {
      onRunFinishedEvent: (event) => finished.push(event),
      onRunErrorEvent: ({ event }) => errors.push(event)
    });

    assert.equal(calls, 1, "the gateway must enter the shared DS4 service once");
    assert.equal(errors.length, 0);
    assert.equal(finished.length, 1);
    assert.equal(finished[0].outcome, "success");
    const text = agent.messages.filter((message) => message.role === "assistant").map((message) => message.content).join(" ");
    assert.match(text, /Risultato: perché/);
    assert.match(text, /fatto\./);
    assert.ok(!text.includes("�"));
    const call = agent.messages.flatMap((message) => message.toolCalls ?? []).find((item) => item.function.name === "ds4.read_file");
    assert.ok(call);
    assert.deepEqual(JSON.parse(call.function.arguments), { path: "notes/è.md" });
    assert.equal(agent.messages.filter((message) => message.role === "tool").at(-1).content, "contenuto ✓");
  });
});

test("AG-UI terminal error is a single RUN_ERROR when the DS4 loop reports agent_error", async () => {
  await withGateway(async (_input, emit) => {
    emit("run_started", {});
    emit("agent_text", { content: "parziale" });
    emit("agent_error", { error: "backend indisponibile" });
    return { kind: AGENT_RUN_OUTCOME.STREAMED };
  }, async ({ base }) => {
    const thread = await (await fetch(`${base}/api/agui/thread`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })).json();
    const agent = new HttpAgent({ url: `${base}/api/agui/agent`, threadId: thread.threadId });
    agent.addMessage({ id: "u-error", role: "user", content: "ciao" });
    const errors = [];
    const finished = [];
    await agent.runAgent({ forwardedProps: { ds4: { baseRevision: thread.revision } } }, {
      onRunErrorEvent: ({ event }) => errors.push(event),
      onRunFinishedEvent: (event) => finished.push(event)
    });
    assert.equal(errors.length, 1);
    assert.equal(errors[0].code, "DS4_AGENT_ERROR");
    assert.equal(finished.length, 0);
  });
});

test("durable AG-UI commits public events before SSE and reconstructs the thread projection", async () => {
  let calls = 0;
  await withGateway(async (_input, emit) => {
    calls += 1;
    emit("run_started", {});
    emit("agent_text", { content: "durevole ✓" });
    emit("agent_done", { finish_reason: "stop" });
    return { kind: AGENT_RUN_OUTCOME.STREAMED };
  }, async ({ base, store }) => {
    const thread = await (await fetch(`${base}/api/agui/thread`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })).json();
    const agent = new HttpAgent({ url: `${base}/api/agui/agent`, threadId: thread.threadId });
    agent.addMessage({ id: "u-durable", role: "user", content: "prova" });
    await agent.runAgent({ forwardedProps: { ds4: { baseRevision: thread.revision } } });

    const persisted = store.getThread("owner-fixed", thread.threadId);
    assert.equal(persisted.revision, 2);
    assert.deepEqual(persisted.messages.map(({ role, content, state }) => ({ role, content, state })), [
      { role: "user", content: "prova", state: "complete" },
      { role: "assistant", content: "durevole ✓", state: "complete" }
    ]);
    const replay = store.replayPublicEvents("owner-fixed", thread.threadId, { after: 0 });
    assert.equal(store.findRun("owner-fixed", thread.threadId, replay[0].runId)?.state, "finished");
    assert.deepEqual(store.loadCheckpoint("owner-fixed", thread.threadId)?.profile, { model: null });
    assert.ok(replay.some(({ payload }) => payload.type === "TEXT_MESSAGE_CONTENT" && payload.delta === "durevole ✓"));
    assert.equal(replay.at(-1).payload.type, "RUN_FINISHED");
    const response = await fetch(`${base}/api/agui/runs/${replay[0].runId}/events?threadId=${thread.threadId}&after=0`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.events.length, replay.length);
    assert.equal(body.events.at(-1).event.type, "RUN_FINISHED");
    const invalidCursor = await fetch(`${base}/api/agui/runs/${replay[0].runId}/events?threadId=${thread.threadId}&after=-1`);
    assert.equal(invalidCursor.status, 400);
    const retryInput = {
      threadId: thread.threadId, runId: replay[0].runId,
      messages: [{ id: "u-durable", role: "user", content: "prova" }],
      tools: [], context: [], protocolVersion: "1.0",
      forwardedProps: { ds4: { baseRevision: 0 } }
    };
    const duplicate = await fetch(`${base}/api/agui/agent`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(retryInput) });
    assert.equal(duplicate.status, 200);
    assert.match(await duplicate.text(), /RUN_FINISHED/);
    assert.equal(calls, 1, "retry must replay the durable stream without running the loop again");
    assert.equal(store.replayPublicEvents("owner-fixed", thread.threadId, { after: 0 }).length, replay.length);
    const conflict = await fetch(`${base}/api/agui/agent`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...retryInput, messages: [{ id: "u-durable", role: "user", content: "modified" }] }) });
    assert.equal(conflict.status, 409);
    assert.equal(calls, 1);
  }, { durable: true });
});

test("a live durable duplicate joins the same run without appending duplicate events", async () => {
  let finish;
  let started;
  const running = new Promise((resolve) => { finish = resolve; });
  const didStart = new Promise((resolve) => { started = resolve; });
  let calls = 0;
  await withGateway(async (_input, emit) => {
    calls += 1;
    emit("run_started", {});
    emit("agent_text", { content: "una volta" });
    started();
    await running;
    emit("agent_done", { finish_reason: "stop" });
    return { kind: AGENT_RUN_OUTCOME.STREAMED };
  }, async ({ base, store }) => {
    const thread = await (await fetch(`${base}/api/agui/thread`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })).json();
    const input = {
      threadId: thread.threadId, runId: "run-live-retry",
      messages: [{ id: "u-live-retry", role: "user", content: "ciao" }],
      tools: [], context: [], protocolVersion: "1.0", forwardedProps: { ds4: { baseRevision: 0 } }
    };
    const first = fetch(`${base}/api/agui/agent`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
    await didStart;
    let eventsBeforeRetry = 0;
    for (let attempt = 0; attempt < 30 && eventsBeforeRetry === 0; attempt += 1) {
      eventsBeforeRetry = store.replayPublicEvents("owner-fixed", thread.threadId, { after: 0 }).length;
      if (!eventsBeforeRetry) await new Promise((resolve) => setTimeout(resolve, 5));
    }
    const second = fetch(`${base}/api/agui/agent`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
    await new Promise((resolve) => setTimeout(resolve, 20));
    finish();
    const [firstResponse, secondResponse] = await Promise.all([first, second]);
    const [firstWire, secondWire] = await Promise.all([firstResponse.text(), secondResponse.text()]);
    assert.equal(firstResponse.status, 200);
    assert.equal(secondResponse.status, 200);
    assert.match(firstWire, /RUN_FINISHED/);
    assert.match(secondWire, /RUN_FINISHED/);
    assert.equal(calls, 1);
    const finalEvents = store.replayPublicEvents("owner-fixed", thread.threadId, { after: 0 });
    assert.equal(finalEvents.filter(({ payload }) => payload.type === "RUN_STARTED").length, 1);
    assert.equal(finalEvents.filter(({ payload }) => payload.type === "TEXT_MESSAGE_CONTENT").length, 1);
    assert.equal(finalEvents.filter(({ payload }) => payload.type === "RUN_FINISHED").length, 1);
    assert.ok(finalEvents.length >= eventsBeforeRetry);
  }, { durable: true });
});

test("HttpAgent Stop aborts the shared run and the admission lease releases after teardown", async () => {
  let turnAborted;
  const aborted = new Promise((resolve) => { turnAborted = resolve; });
  await withGateway(async (_input, emit, signal) => {
    emit("run_started", {});
    emit("agent_text", { content: "inizio" });
    await new Promise((resolve) => signal.addEventListener("abort", resolve, { once: true }));
    turnAborted();
    return { kind: AGENT_RUN_OUTCOME.STREAMED };
  }, async ({ base, admission }) => {
    const thread = await (await fetch(`${base}/api/agui/thread`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })).json();
    const agent = new HttpAgent({ url: `${base}/api/agui/agent`, threadId: thread.threadId });
    agent.addMessage({ id: "u-cancel", role: "user", content: "fermati" });
    let sawText;
    const firstText = new Promise((resolve) => { sawText = resolve; });
    const running = agent.runAgent({ forwardedProps: { ds4: { baseRevision: thread.revision } } }, {
      onEvent: ({ event }) => { if (event.type === sdk.EventType.TEXT_MESSAGE_CONTENT) sawText(); }
    }).catch(() => {});
    await firstText;
    agent.abortRun();
    await running;
    await aborted;
    for (let count = 0; admission.isBusy() && count < 100; count++) await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(admission.isBusy(), false, "the run holds its lease until the loop acknowledges abort");
  });
});

test("AG-UI loopback guard rejects a remote peer or non-loopback Host", () => {
  assert.equal(isLoopbackRequest({ socket: { remoteAddress: "192.0.2.4" }, headers: { host: "127.0.0.1:9000" } }), false);
  assert.equal(isLoopbackRequest({ socket: { remoteAddress: "127.0.0.1" }, headers: { host: "192.0.2.4:9000" } }), false);
  assert.equal(isLoopbackRequest({ socket: { remoteAddress: "::ffff:127.0.0.1" }, headers: { host: "localhost:9000" } }), true);
});

test("workspace page drafts remain private until owner/thread/hash-bound CAS approval", async () => {
  await withGateway(async () => ({ kind: AGENT_RUN_OUTCOME.STREAMED }), async ({ base }) => {
    const request = (path, options) => fetch(`${base}${path}`, options).then(async (response) => ({ status: response.status, body: await response.json() }));
    const thread = await request("/api/agui/threads", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: "Pages" }) });
    const rejectedOrigin = await request("/api/agui/pages/drafts", { method: "POST", headers: { "Content-Type": "application/json", Origin: "http://attacker.invalid" }, body: JSON.stringify({ threadId: thread.body.threadId, slug: "blocked", title: "Blocked", content: "no" }) });
    assert.equal(rejectedOrigin.status, 403);
    assert.equal(rejectedOrigin.body.code, "ORIGIN_REJECTED");
    const draft = await request("/api/agui/pages/drafts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ threadId: thread.body.threadId, slug: "first-page", title: "First page", content: "Review me" }) });
    assert.equal(draft.status, 201);
    const hidden = await request(`/api/agui/pages?threadId=${thread.body.threadId}`);
    assert.equal(hidden.body.pages.length, 0);
    assert.equal(hidden.body.drafts[0].candidateHash, draft.body.candidateHash);
    const approved = await request(`/api/agui/pages/drafts/${draft.body.draftId}/decision`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ threadId: thread.body.threadId, decision: "approve", candidateHash: draft.body.candidateHash }) });
    assert.equal(approved.body.applied, true);
    assert.equal(approved.body.page.content, "Review me");
    assert.equal((await request(`/api/agui/pages?threadId=${thread.body.threadId}`)).body.pages.length, 1);
    assert.equal((await request(`/api/agui/pages/${approved.body.page.pageId}`)).body.revision, 1);
    const replay = await request(`/api/agui/pages/drafts/${draft.body.draftId}/decision`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ threadId: thread.body.threadId, decision: "approve", candidateHash: draft.body.candidateHash }) });
    assert.equal(replay.status, 409);
    assert.equal(replay.body.code, "PAGE_DRAFT_REPLAY");
  }, { durable: true });
});

test("Dots are owner-scoped and a thread binds to a pinned preset revision", async () => {
  await withGateway(async () => ({ kind: AGENT_RUN_OUTCOME.STREAMED }), async ({ base }) => {
    const request = (path, options) => fetch(`${base}${path}`, options).then(async (response) => ({ status: response.status, body: await response.json() }));
    const thread = await request("/api/agui/threads", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: "Dot thread" }) });
    const created = await request("/api/agui/dots", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "Research", instructions: "Be concise", skills: ["metacognition"], allowedTools: ["read"], profile: { model: "local-model" } }) });
    assert.equal(created.status, 201);
    const bound = await request(`/api/agui/threads/${thread.body.threadId}/dot`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dotId: created.body.dotId, revision: created.body.revision }) });
    assert.equal(bound.body.binding.dotId, created.body.dotId);
    const update = await request(`/api/agui/dots/${created.body.dotId}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ baseRevision: 1, name: "Research", instructions: "Updated" }) });
    assert.equal(update.body.revision, 2);
    const state = await request(`/api/agui/dots?threadId=${thread.body.threadId}`);
    assert.equal(state.body.dots[0].revision, 2);
    assert.equal(state.body.binding.revision, 1, "existing thread pins the original preset version");
    const unsafeTool = await request("/api/agui/dots", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "Unsafe", allowedTools: ["retrieve_context_blob"] }) });
    assert.equal(unsafeTool.status, 400);
    assert.equal(unsafeTool.body.code, "DOT_TOOL_UNAVAILABLE");
    const crossOrigin = await request("/api/agui/dots", { method: "POST", headers: { "Content-Type": "application/json", Origin: "http://attacker.invalid" }, body: JSON.stringify({ name: "Blocked" }) });
    assert.equal(crossOrigin.status, 403);
}, { durable: true });
});

test("Dot policy and profile survive A/B/A runs without crossing thread bindings", async () => {
  const turns = [];
  await withGateway(async (input, emit) => {
    turns.push(input.body);
    emit("run_started", {});
    emit("agent_done", { finish_reason: "stop" });
    return { kind: AGENT_RUN_OUTCOME.STREAMED };
  }, async ({ base }) => {
    const request = (path, options = {}) => fetch(`${base}${path}`, { ...options, headers: { "Content-Type": "application/json", ...(options.headers || {}) } }).then(async (response) => ({ status: response.status, body: await response.json() }));
    const dotA = (await request("/api/agui/dots", { method: "POST", body: JSON.stringify({ name: "A", instructions: "solo A", allowedTools: ["read"], profile: { model: "model-a" } }) })).body;
    const dotB = (await request("/api/agui/dots", { method: "POST", body: JSON.stringify({ name: "B", instructions: "solo B", allowedTools: ["bash"], profile: { model: "model-b" } }) })).body;
    const runWith = async (dot, id) => {
      const thread = (await request("/api/agui/threads", { method: "POST", body: JSON.stringify({ title: id }) })).body;
      const bound = await request(`/api/agui/threads/${thread.threadId}/dot`, { method: "PUT", body: JSON.stringify({ dotId: dot.dotId, revision: dot.revision }) });
      assert.equal(bound.status, 200);
      const agent = new HttpAgent({ url: `${base}/api/agui/agent`, threadId: thread.threadId });
      agent.addMessage({ id: `u-${id}`, role: "user", content: id });
      await agent.runAgent({ forwardedProps: { ds4: { baseRevision: 0 } } });
    };
    await runWith(dotA, "a1");
    await runWith(dotB, "b");
    await runWith(dotA, "a2");
    assert.deepEqual(turns.map((turn) => turn.dot.name), ["A", "B", "A"]);
    assert.deepEqual(turns.map((turn) => turn.request.model), ["model-a", "model-b", "model-a"]);
    assert.deepEqual(turns.map((turn) => turn.dot.allowedTools), [["read"], ["bash"], ["read"]]);
  }, { durable: true });
});
