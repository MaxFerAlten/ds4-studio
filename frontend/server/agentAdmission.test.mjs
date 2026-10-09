import assert from "node:assert/strict";
import { createServer, request as httpRequest } from "node:http";
import { test } from "node:test";
import { AgentAdmissionError, createAgentAdmission } from "./agentAdmission.mjs";
import { AGENT_RUN_OUTCOME, createAgentRunService } from "./agent/runService.mjs";
import { createLegacyAgentChatHandler } from "./agent/legacyChatSse.mjs";

const identity = (ownerId, threadId = "thread-1", runId = "run-1", requestHash = "hash-1") => ({
  ownerId, threadId, runId, requestHash
});

function gate() {
  let release;
  const promise = new Promise((resolve) => { release = resolve; });
  return { promise, release };
}

function postJsonResponse(url, body) {
  return new Promise((resolve, reject) => {
    const request = httpRequest(url, {
      method: "POST",
      agent: false,
      headers: { "Content-Type": "application/json", Connection: "close" }
    }, resolve);
    request.once("error", reject);
    request.end(JSON.stringify(body));
  });
}

function responseText(response) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    response.on("data", (chunk) => chunks.push(chunk));
    response.once("error", reject);
    response.once("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
}

test("the admission lease is exclusive across unrelated runs and releases after teardown", async () => {
  const admission = createAgentAdmission();
  const wait = gate();
  const first = admission.execute(identity("owner-a"), async () => {
    await wait.promise;
    return "done";
  });

  await assert.rejects(
    admission.execute(identity("owner-b", "thread-2", "run-2"), async () => "wrong"),
    (error) => error instanceof AgentAdmissionError && error.code === "INFERENCE_BUSY" && error.status === 409
  );
  assert.equal(admission.isBusy(), true);
  wait.release();
  assert.equal((await first).value, "done");
  assert.equal(admission.isBusy(), false);
});

test("nested calls inherit the exact server-side owner and lease without deadlock", async () => {
  const admission = createAgentAdmission();
  const run = identity("owner-a");
  let nestedContext;
  const result = await admission.execute(run, async (parent) => {
    const nested = await admission.execute(run, async (child) => {
      nestedContext = child;
      return "child";
    });
    assert.equal(nested.kind, "nested");
    assert.equal(nested.run.runId, run.runId);
    assert.equal(nested.value, "child");
    assert.equal(nestedContext.signal, parent.signal);
    return "parent";
  });
  assert.equal(result.value, "parent");
  await assert.rejects(
    admission.execute(identity("owner-a", "thread-1", "run-2", "hash-2"), async () => admission.execute(identity("owner-b", "thread-2", "run-3"), async () => {})),
    (error) => error.code === "RUN_OWNERSHIP_MISMATCH"
  );
});

test("same owner/thread/run and hash join an active run; different hash conflicts", async () => {
  const admission = createAgentAdmission();
  const wait = gate();
  const run = identity("owner-a");
  let executions = 0;
  const first = admission.execute(run, async (ctx) => {
    executions++;
    ctx.emit("agent_text", { content: "one" });
    await wait.promise;
    return "result";
  });
  await Promise.resolve();

  const joinedEvents = [];
  const duplicate = admission.execute(run, async () => {
    executions++;
    return "duplicate execution";
  }, { onEvent: (event) => joinedEvents.push(event) });
  await assert.rejects(
    admission.execute({ ...run, requestHash: "different-hash" }, async () => {}),
    (error) => error.code === "RUN_ID_CONFLICT" && error.status === 409
  );
  assert.equal(executions, 1);
  wait.release();
  assert.equal((await first).kind, "executed");
  const joined = await duplicate;
  assert.equal(joined.kind, "duplicate");
  assert.equal(joined.value, "result");
  assert.deepEqual(joinedEvents, [{ type: "agent_text", data: { content: "one" } }]);
  assert.equal(joined.run.state, "finished");

  const replay = await admission.execute(run, async () => {
    executions++;
    return "re-executed";
  });
  assert.equal(replay.kind, "replay");
  assert.equal(replay.value, "result");
  assert.equal(executions, 1);
});

test("idempotency keys are scoped by owner and thread", async () => {
  const admission = createAgentAdmission();
  await admission.execute(identity("owner-a", "thread-a", "same-run", "same-hash"), async () => "A");
  const ownerCollision = await admission.execute(identity("owner-b", "thread-a", "same-run", "same-hash"), async () => "B");
  const threadCollision = await admission.execute(identity("owner-a", "thread-b", "same-run", "same-hash"), async () => "C");
  assert.equal(ownerCollision.kind, "executed");
  assert.equal(threadCollision.kind, "executed");
});

test("cancel is owner-bound, repeatable, and holds the lease until operation teardown", async () => {
  const admission = createAgentAdmission();
  const run = identity("owner-a");
  const wait = gate();
  let observedAbort = false;
  const first = admission.execute(run, async ({ signal }) => {
    signal.addEventListener("abort", () => { observedAbort = true; }, { once: true });
    await wait.promise;
    return "torn down";
  });
  await Promise.resolve();
  assert.throws(() => admission.cancel({ ...run, ownerId: "owner-b" }), (error) => error.code === "RUN_NOT_FOUND");
  assert.equal(admission.cancel(run).accepted, true);
  assert.equal(admission.cancel(run).accepted, true);
  assert.equal(observedAbort, true);
  assert.equal(admission.isBusy(), true);
  assert.equal(admission.lookup(run).state, "cancelling");
  wait.release();
  const settled = await first;
  // The operation resolved normally after the abort: the run is cancelled,
  // never reported as a successful finish.
  assert.equal(settled.run.state, "cancelled");
  assert.equal(admission.isBusy(), false);
  assert.deepEqual(admission.cancel(run), { accepted: false, terminal: true, state: "cancelled" });
});

test("unconfirmed runtime teardown stays in recovery and continues to exclude new work", async () => {
  const admission = createAgentAdmission();
  const run = identity("owner-a");
  const result = await admission.execute(run, async (ctx) => {
    ctx.requireRecovery("native stop is not confirmed");
    return "stream ended";
  });
  assert.equal(result.run.state, "interrupted_recovery");
  assert.equal(admission.isBusy(), true);
  await assert.rejects(admission.execute(identity("owner-b", "thread-2", "run-2"), async () => {}), (error) => error.code === "RUNTIME_RECOVERY_REQUIRED" && error.status === 409);
  assert.throws(() => admission.resolveRecovery({ ...run, ownerId: "owner-b" }), (error) => error.code === "RUN_NOT_FOUND");
  assert.equal(admission.resolveRecovery(run), true);
  assert.equal(admission.isBusy(), false);
});

test("failed synchronous prepare rolls back and releases admission without running inference", async () => {
  const admission = createAgentAdmission();
  let staged = false;
  let executed = false;
  await assert.rejects(admission.execute(identity("owner-a"), async () => {
    executed = true;
    throw new Error("atomic append failed");
  }, {
      prepare() {
        staged = true;
        return () => { staged = false; };
      }
  }), /atomic append failed/);
  assert.equal(executed, true);
  assert.equal(staged, false);
  assert.equal(admission.isBusy(), false);
});

test("event subscribers receive prior and subsequent events only for their own run", async () => {
  const admission = createAgentAdmission();
  const run = identity("owner-a");
  const wait = gate();
  const observed = [];
  const first = admission.execute(run, async (ctx) => {
    ctx.emit("first", { n: 1 });
    await wait.promise;
    ctx.emit("second", { n: 2 });
  });
  await Promise.resolve();
  const unsubscribe = admission.subscribe(run, (event) => observed.push(event.type));
  wait.release();
  await first;
  unsubscribe();
  assert.deepEqual(observed, ["first", "second"]);
  assert.throws(() => admission.subscribe({ ...run, ownerId: "owner-b" }, () => {}), (error) => error.code === "RUN_NOT_FOUND");
});

test("AgentRunService uses one admission lease and replays an identical run without dispatching twice", async () => {
  const admission = createAgentAdmission();
  const wait = gate();
  let dispatches = 0;
  const service = createAgentRunService({
    admission,
    resolveEngine: () => "js",
    runJsTurn: async (_input, emit) => {
      dispatches++;
      emit("run_started", {});
      emit("agent_text", { content: "answer" });
      await wait.promise;
      return { kind: AGENT_RUN_OUTCOME.STREAMED };
    },
    runNativeTurn: async () => { throw new Error("unreachable"); }
  });
  const id = { ...identity("owner-a"), retainEvents: true };
  const originalEvents = [];
  const first = service.runAgentTurn({ body: { message: "hello" }, sessionKey: "ds4-session", admissionIdentity: id }, (type, data) => originalEvents.push({ type, data }), new AbortController().signal);
  await Promise.resolve();

  const busy = await service.runAgentTurn({ body: { message: "other" }, sessionKey: "ds4-session", admissionIdentity: identity("owner-b", "thread-2", "run-2") }, () => {}, new AbortController().signal);
  assert.equal(busy.kind, AGENT_RUN_OUTCOME.REJECTED);
  assert.equal(busy.status, 409);
  assert.equal(busy.body.code, "INFERENCE_BUSY");

  const replayEvents = [];
  const duplicate = service.runAgentTurn({ body: { message: "hello" }, sessionKey: "ds4-session", admissionIdentity: id }, (type, data) => replayEvents.push({ type, data }), new AbortController().signal);
  wait.release();
  assert.equal((await first).kind, AGENT_RUN_OUTCOME.STREAMED);
  assert.equal((await duplicate).kind, AGENT_RUN_OUTCOME.STREAMED);
  assert.deepEqual(replayEvents, originalEvents);
  assert.equal(dispatches, 1);
});

test("real legacy HTTP handler rejects a competing tab with 409 while one run is active", async () => {
  const admission = createAgentAdmission();
  const wait = gate();
  let dispatches = 0;
  const service = createAgentRunService({
    admission,
    resolveEngine: () => "js",
    runJsTurn: async (_input, emit) => {
      dispatches++;
      emit("run_started", {});
      await wait.promise;
      emit("agent_text", { content: "accepted" });
      return { kind: AGENT_RUN_OUTCOME.STREAMED };
    },
    runNativeTurn: async () => { throw new Error("unreachable"); }
  });
  const handler = createLegacyAgentChatHandler({
    service,
    sessionKeyOf: (req) => req.body.sessionKey,
    writeCommandSse(res, events) {
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      for (const event of events) res.write(`event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`);
      res.end();
    },
    abortOnClientDisconnect() { throw new Error("native wiring is not used"); },
    keepaliveMs: 60000
  });

  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    req.body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    req.get = (name) => req.headers[name.toLowerCase()];
    const writeHead = res.writeHead.bind(res);
    res.writeHead = (status, headers) => writeHead(status, { ...headers, Connection: "close" });
    const end = res.end.bind(res);
    res.end = (...args) => {
      res.shouldKeepAlive = false;
      return end(...args);
    };
    res.status = (status) => { res.statusCode = status; return res; };
    res.json = (value) => {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(value));
      return res;
    };
    await handler(req, res);
  });
  server.keepAliveTimeout = 1;
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const url = `http://127.0.0.1:${address.port}/api/agent/chat`;
  const originalSetInterval = globalThis.setInterval;
  const originalClearInterval = globalThis.clearInterval;
  let keepaliveHandle = null;
  let keepaliveCleared = false;
  globalThis.setInterval = (callback, delay, ...args) => {
    const handle = originalSetInterval(callback, delay, ...args);
    if (delay === 60000) keepaliveHandle = handle;
    return handle;
  };
  globalThis.clearInterval = (handle) => {
    if (handle === keepaliveHandle) keepaliveCleared = true;
    return originalClearInterval(handle);
  };
  try {
    const firstPromise = postJsonResponse(url, { sessionKey: "tab-a", message: "first" });
    const second = await postJsonResponse(url, { sessionKey: "tab-b", message: "second" });
    assert.equal(second.statusCode, 409);
    assert.equal(JSON.parse(await responseText(second)).code, "INFERENCE_BUSY");
    assert.equal(dispatches, 1);
    wait.release();
    const first = await firstPromise;
    assert.equal(first.statusCode, 200);
    assert.match(await responseText(first), /accepted/);
    assert.equal(keepaliveCleared, true, "the SSE keepalive timer is cleared on response finish");
  } finally {
    wait.release();
    if (keepaliveHandle) originalClearInterval(keepaliveHandle);
    globalThis.setInterval = originalSetInterval;
    globalThis.clearInterval = originalClearInterval;
    const closed = new Promise((resolve) => server.close(resolve));
    server.closeAllConnections?.();
    await closed;
  }
});
