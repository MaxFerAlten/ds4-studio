import assert from "node:assert/strict";
import test from "node:test";

import {
  fetchAgnoStatus,
  startAgno,
  createAgnoRun,
  fetchAgnoRuns,
  fetchAgnoRun,
  cancelAgnoRun,
  ensureAgnoUi,
  stopAgnoUi,
} from "./agnoApi.mjs";

function response(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

test("agnoApi never attaches an Authorization header (no tokens in the client)", async () => {
  let headers;
  await fetchAgnoStatus({ fetchImpl: async (_url, options) => { headers = options.headers; return response({ enabled: true }); } });
  assert.equal(headers.Authorization, undefined);
});

test("fetchAgnoStatus reads /api/agno/status", async () => {
  let capturedUrl;
  const status = await fetchAgnoStatus({
    fetchImpl: async (url) => { capturedUrl = url; return response({ enabled: true, uiEnabled: true }); },
  });
  assert.equal(capturedUrl, "/api/agno/status");
  assert.equal(status.enabled, true);
});

test("startAgno posts to /api/agno/start", async () => {
  let capturedUrl, capturedMethod;
  await startAgno({
    fetchImpl: async (url, options) => { capturedUrl = url; capturedMethod = options.method; return response({ ok: true }); },
  });
  assert.equal(capturedUrl, "/api/agno/start");
  assert.equal(capturedMethod, "POST");
});

test("createAgnoRun posts payload to /api/agno/runs", async () => {
  let capturedBody;
  const payload = { message: "hi", agentId: "ds4-assistant" };
  const result = await createAgnoRun(payload, {
    fetchImpl: async (_url, options) => { capturedBody = JSON.parse(options.body); return response({ runId: "abc" }); },
  });
  assert.deepEqual(capturedBody, payload);
  assert.equal(result.runId, "abc");
});

test("createAgnoRun surfaces NATIVE_AGENT_ACTIVE as a typed error", async () => {
  await assert.rejects(
    () => createAgnoRun({ message: "hi" }, { fetchImpl: async () => response({ error: "NATIVE_AGENT_ACTIVE" }, 409) }),
    (error) => error.code === "NATIVE_AGENT_ACTIVE" && error.status === 409
  );
});

test("fetchAgnoRuns reads /api/agno/runs", async () => {
  let capturedUrl;
  const result = await fetchAgnoRuns({
    fetchImpl: async (url) => { capturedUrl = url; return response({ runs: [{ runId: "run-1" }] }); },
  });
  assert.equal(capturedUrl, "/api/agno/runs");
  assert.equal(result.runs.length, 1);
});

test("fetchAgnoRun and cancelAgnoRun target the run id path", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => { calls.push({ url, method: options.method }); return response({ runId: "run-1" }); };
  await fetchAgnoRun("run-1", { fetchImpl });
  await cancelAgnoRun("run-1", { fetchImpl });
  assert.equal(calls[0].url, "/api/agno/runs/run-1");
  assert.equal(calls[1].url, "/api/agno/runs/run-1/cancel");
  assert.equal(calls[1].method, "POST");
});

test("ensureAgnoUi uses POST to /api/agno/agent-ui/ensure", async () => {
  let capturedUrl, capturedMethod, capturedBody;
  const result = await ensureAgnoUi({
    fetchImpl: async (url, options) => {
      capturedUrl = url;
      capturedMethod = options.method;
      capturedBody = JSON.parse(options.body);
      return response({ ok: true, url: "http://127.0.0.1:3000" });
    },
  });
  assert.equal(capturedUrl, "/api/agno/agent-ui/ensure");
  assert.equal(capturedMethod, "POST");
  assert.deepEqual(capturedBody, {});
  assert.equal(result.url, "http://127.0.0.1:3000");
});

test("ensureAgnoUi propagates server error codes", async () => {
  await assert.rejects(
    () => ensureAgnoUi({
      fetchImpl: async () => response({ error: "AGNO_UI_DISABLED" }, 503),
    }),
    (error) => error.code === "AGNO_UI_DISABLED" && error.status === 503
  );
});

test("stopAgnoUi uses POST to /api/agno/agent-ui/stop", async () => {
  let capturedUrl, capturedMethod;
  await stopAgnoUi({
    fetchImpl: async (url, options) => {
      capturedUrl = url;
      capturedMethod = options.method;
      return response({ ok: true });
    },
  });
  assert.equal(capturedUrl, "/api/agno/agent-ui/stop");
  assert.equal(capturedMethod, "POST");
});
