import test from "node:test";
import assert from "node:assert/strict";
import {
  BUSY_RETRY_DEFAULTS,
  busyRetryDelay,
  fetchWithBusyRetry,
  isBusyConflict
} from "./backendRetry.mjs";

function jsonResponse(status, body) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return new Response(text, {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

test("isBusyConflict only matches transient busy 409s", () => {
  assert.equal(isBusyConflict(409, '{"error":"conflict","message":"wrapper is busy"}'), true);
  assert.equal(isBusyConflict(409, '{"error":"conflict","message":"wrong mode: active=server required=agent"}'), false);
  assert.equal(isBusyConflict(200, "wrapper is busy"), false);
  assert.equal(isBusyConflict(503, "busy"), false);
  assert.equal(isBusyConflict(409, ""), false);
});

test("busyRetryDelay grows exponentially up to the ceiling", () => {
  assert.equal(busyRetryDelay(0), BUSY_RETRY_DEFAULTS.baseDelayMs);
  assert.equal(busyRetryDelay(1), BUSY_RETRY_DEFAULTS.baseDelayMs * 2);
  assert.equal(busyRetryDelay(2), BUSY_RETRY_DEFAULTS.baseDelayMs * 4);
  assert.equal(busyRetryDelay(20), BUSY_RETRY_DEFAULTS.maxDelayMs);
});

test("retries a busy 409 then returns the eventual success", async () => {
  const statuses = [409, 409, 200];
  let calls = 0;
  const fetchImpl = async () => {
    const status = statuses[calls++];
    return status === 200
      ? jsonResponse(200, { ok: true })
      : jsonResponse(409, { error: "conflict", message: "wrapper is busy" });
  };
  const res = await fetchWithBusyRetry(fetchImpl, "http://x/v1/token-count", {}, { sleep: async () => {} });
  assert.equal(calls, 3);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
});

test("does not retry a non-busy 409 and leaves its body readable", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls++;
    return jsonResponse(409, { error: "conflict", message: "wrong mode: active=server required=agent" });
  };
  const res = await fetchWithBusyRetry(fetchImpl, "http://x/v1/chat/completions", {}, { sleep: async () => {} });
  assert.equal(calls, 1);
  assert.equal(res.status, 409);
  assert.match((await res.json()).message, /wrong mode/);
});

test("gives up after maxRetries and returns the last 409", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls++;
    return jsonResponse(409, { error: "conflict", message: "wrapper is busy" });
  };
  const res = await fetchWithBusyRetry(
    fetchImpl,
    "http://x/v1/token-count",
    {},
    { maxRetries: 2, sleep: async () => {} }
  );
  assert.equal(calls, 3); // initial + 2 retries
  assert.equal(res.status, 409);
});

test("stops retrying once the abort signal fires", async () => {
  const controller = new AbortController();
  let calls = 0;
  const fetchImpl = async () => {
    calls++;
    if (calls === 1) controller.abort();
    return jsonResponse(409, { error: "conflict", message: "wrapper is busy" });
  };
  const res = await fetchWithBusyRetry(
    fetchImpl,
    "http://x/v1/token-count",
    { signal: controller.signal },
    { sleep: async () => {} }
  );
  assert.equal(calls, 1);
  assert.equal(res.status, 409);
});

test("passes a streaming success response through untouched", async () => {
  const body = new ReadableStream({
    start(c) {
      c.enqueue(new TextEncoder().encode("data: hi\n\n"));
      c.close();
    }
  });
  const fetchImpl = async () => new Response(body, { status: 200 });
  const res = await fetchWithBusyRetry(fetchImpl, "http://x/v1/chat/completions", {}, { sleep: async () => {} });
  assert.equal(res.status, 200);
  assert.equal(await res.text(), "data: hi\n\n");
});
