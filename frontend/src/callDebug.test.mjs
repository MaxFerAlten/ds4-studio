import test from "node:test";
import assert from "node:assert/strict";
import { clearCallDebug, fetchCallDebug } from "./utils.mjs";

function okJson(payload) {
  return async () => ({ ok: true, status: 200, json: async () => payload });
}

test("fetchCallDebug requests the limit and returns entries", async () => {
  let calledUrl = null;
  const fetchImpl = async (url) => {
    calledUrl = url;
    return { ok: true, status: 200, json: async () => ({ enabled: true, entries: [{ id: "1" }] }) };
  };
  const out = await fetchCallDebug({ limit: 50, fetchImpl });
  assert.equal(calledUrl, "/api/call-debug?limit=50");
  assert.equal(out.enabled, true);
  assert.deepEqual(out.entries, [{ id: "1" }]);
});

test("fetchCallDebug tolerates a missing entries array", async () => {
  const out = await fetchCallDebug({ fetchImpl: okJson({ enabled: false }) });
  assert.equal(out.enabled, false);
  assert.deepEqual(out.entries, []);
});

test("fetchCallDebug propagates server errors", async () => {
  const fetchImpl = async () => ({ ok: false, status: 500, json: async () => ({ error: "boom" }) });
  await assert.rejects(() => fetchCallDebug({ fetchImpl }), /boom/);
});

test("clearCallDebug issues a DELETE", async () => {
  let method = null;
  const fetchImpl = async (_url, init) => {
    method = init.method;
    return { ok: true, status: 200, json: async () => ({ cleared: true }) };
  };
  assert.equal(await clearCallDebug({ fetchImpl }), true);
  assert.equal(method, "DELETE");
});
