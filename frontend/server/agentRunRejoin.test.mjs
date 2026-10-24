// Regression: a page reload or a dropped stream lost the agent turn's answer.
// With the client run id the run now detaches instead of being cancelled, the
// page rejoins it with X-DS4-Run-Join (events replayed, no second model
// call), a join for a run the server no longer has never starts the turn,
// and /api/agent/status shows a run no page is attached to.
import assert from "node:assert/strict";
import { test } from "node:test";
import { startFakeBackend, startServerChild } from "./agent/agentRunParityHarness.mjs";

const SESSION = "rejoin";
const base = { "Content-Type": "application/json", "X-Agent-Session-Key": SESSION };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const modelCalls = (backend) => backend.log.filter((e) => e.path === "POST /v1/chat/completions").length;

test("an identified agent run survives its client and can be rejoined", { timeout: 120000 }, async () => {
  const backend = await startFakeBackend({
    turns: [{ content: "Risposta completa dopo il ricaricamento.", finish: "stop", delayMs: 1500 }]
  });
  const server = await startServerChild(backend);
  try {
    const start = await fetch(`${server.base}/api/agent/start`, { method: "POST", headers: base, body: "{}" });
    const cookie = (start.headers.get("set-cookie") || "").split(";")[0];
    const headers = { ...base, cookie, "X-DS4-Run-Id": "run-reload-1" };
    const body = JSON.stringify({ message: "domanda lunga", messages: [] });

    // The page sends the turn and goes away before the answer.
    const leaving = new AbortController();
    const first = await fetch(`${server.base}/api/agent/chat`, { method: "POST", headers, body, signal: leaving.signal });
    assert.equal(first.status, 200);
    leaving.abort();

    // Still running on the server, owned by this browser.
    await sleep(300);
    const status = await (await fetch(`${server.base}/api/agent/status`, { headers: { ...base, cookie } })).json();
    assert.equal(status.serverRun?.ownedByCaller, true, JSON.stringify(status.serverRun));
    const foreign = await (await fetch(`${server.base}/api/agent/status`, { headers: base })).json();
    assert.equal(foreign.serverRun?.ownedByCaller, false);

    // The reloaded page rejoins: full answer, one model call in total.
    const rejoin = await fetch(`${server.base}/api/agent/chat`, {
      method: "POST", headers: { ...headers, "X-DS4-Run-Join": "1" }, body
    });
    const text = await rejoin.text();
    assert.equal(rejoin.status, 200, text);
    assert.match(text, /Risposta completa dopo il ricaricamento/);
    assert.match(text, /event: agent_done/);
    assert.equal(modelCalls(backend), 1);

    const idle = await (await fetch(`${server.base}/api/agent/status`, { headers: { ...base, cookie } })).json();
    assert.equal(idle.serverRun, null);

    // A join for a run the server does not have is refused, never executed.
    const gone = await fetch(`${server.base}/api/agent/chat`, {
      method: "POST", headers: { ...headers, "X-DS4-Run-Id": "run-unknown", "X-DS4-Run-Join": "1" }, body
    });
    assert.equal(gone.status, 404, await gone.text());
    assert.equal(modelCalls(backend), 1);
  } finally {
    server.stop();
    await backend.close();
  }
});

test("an anonymous agent run is still cancelled when its client leaves", { timeout: 120000 }, async () => {
  const backend = await startFakeBackend({
    turns: [{ content: "Non deve arrivare.", finish: "stop", stallAfterFirstChunk: true }]
  });
  const server = await startServerChild(backend);
  try {
    await fetch(`${server.base}/api/agent/start`, { method: "POST", headers: base, body: "{}" });
    const leaving = new AbortController();
    const res = await fetch(`${server.base}/api/agent/chat`, {
      method: "POST", headers: base, body: JSON.stringify({ message: "x" }), signal: leaving.signal
    });
    assert.equal(res.status, 200);
    await sleep(500);
    leaving.abort();
    for (let i = 0; i < 40; i++) {
      const status = await (await fetch(`${server.base}/api/agent/status`, { headers: base })).json();
      if (status.serverRun === null) return;
      await sleep(250);
    }
    assert.fail("anonymous run kept the lease after its client left");
  } finally {
    backend.releaseAll();
    server.stop();
    await backend.close();
  }
});
