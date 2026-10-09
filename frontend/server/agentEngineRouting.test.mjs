// WP13 of convergenza.loop.md — engine "js" routing with the DS4 wrapper in
// server mode.
//
// Contract (plan §16):
//   1. /api/agent/start with engine js and the wrapper active: verify the
//      wrapper mode (GET /api/wrapper/status, field "active_mode" — copied
//      from ds4_wrapper_metrics.c:98 ds4_wrapper_status_json), switch it to
//      "server" when it is "agent", never call prepareNativeAgentRuntime,
//      start the JS session.
//   3. probeStatefulBackend: engine js + wrapper active => false without a
//      probe (the stateful endpoint does not exist in server mode, §1.2).
// Test (plan §16): with a fake fetch, start with engine js never calls
// switch-mode {mode:"agent"} nor /api/native-agent/prepare.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { ensureServerModeForJsEngine } from "./agentEngine.mjs";

const here = dirname(fileURLToPath(import.meta.url));

function fakeFetch(statusJson, { getStatusOk = true, switchOk = true, throwOnGet = false } = {}) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, method: init.method || "GET", body: init.body });
    if (throwOnGet) throw new Error("ECONNREFUSED");
    if (url.endsWith("/api/wrapper/status")) {
      return {
        ok: getStatusOk,
        status: getStatusOk ? 200 : 503,
        json: async () => statusJson
      };
    }
    if (url.endsWith("/api/wrapper/switch-mode")) {
      return { ok: switchOk, status: switchOk ? 200 : 500, json: async () => ({ switched: switchOk }) };
    }
    throw new Error(`unexpected fetch: ${url}`);
  };
  return { fetchImpl, calls };
}

test("wrapper in agent mode: start switches it to server, nothing else", async () => {
  const { fetchImpl, calls } = fakeFetch({ active_mode: "agent" });
  const result = await ensureServerModeForJsEngine({ fetchImpl, base: "http://wrapper.test" });
  assert.equal(result.ok, true);
  assert.equal(result.switched, true);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].method, "GET");
  assert.match(calls[0].url, /^http:\/\/wrapper\.test\/api\/wrapper\/status$/);
  assert.equal(calls[1].method, "POST");
  assert.match(calls[1].url, /\/api\/wrapper\/switch-mode$/);
  assert.deepEqual(JSON.parse(calls[1].body), { mode: "server" });
  // the plan forbids ever asking the wrapper for agent mode with engine js
  assert.equal(calls.some((c) => c.body && JSON.parse(c.body).mode === "agent"), false);
  assert.equal(calls.some((c) => c.url.includes("/api/native-agent/prepare")), false);
});

test("wrapper already in server mode: no switch request at all", async () => {
  const { fetchImpl, calls } = fakeFetch({ active_mode: "server" });
  const result = await ensureServerModeForJsEngine({ fetchImpl, base: "http://wrapper.test" });
  assert.deepEqual(result, { ok: true, switched: false, activeMode: "server" });
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/api\/wrapper\/status$/);
});

test("unknown mode is left alone (only agent needs the switch)", async () => {
  const { fetchImpl, calls } = fakeFetch({ active_mode: "unknown" });
  const result = await ensureServerModeForJsEngine({ fetchImpl, base: "http://wrapper.test" });
  assert.equal(result.ok, true);
  assert.equal(result.switched, false);
  assert.equal(calls.length, 1);
});

test("status unreachable: failure without any switch attempt", async () => {
  const { fetchImpl, calls } = fakeFetch({}, { throwOnGet: true });
  const result = await ensureServerModeForJsEngine({ fetchImpl, base: "http://wrapper.test" });
  assert.equal(result.ok, false);
  assert.equal(result.switched, false);
  assert.match(result.error, /ECONNREFUSED/);
  assert.equal(calls.length, 1);
});

test("status answers an error: failure, no switch", async () => {
  const { fetchImpl, calls } = fakeFetch({ error: "down" }, { getStatusOk: false });
  const result = await ensureServerModeForJsEngine({ fetchImpl, base: "http://wrapper.test" });
  assert.equal(result.ok, false);
  assert.equal(result.status, 503);
  assert.equal(calls.length, 1);
});

test("switch to server fails: the failure is reported, agent mode never requested", async () => {
  const { fetchImpl, calls } = fakeFetch({ active_mode: "agent" }, { switchOk: false });
  const result = await ensureServerModeForJsEngine({ fetchImpl, base: "http://wrapper.test" });
  assert.equal(result.ok, false);
  assert.equal(result.status, 500);
  assert.equal(calls.length, 2);
  assert.deepEqual(JSON.parse(calls[1].body), { mode: "server" });
});

test("JS start route: wrapper switch before the JS reply, native runtime never on the js path", () => {
  const source = readFileSync(join(here, "index.mjs"), "utf8");
  const startAt = source.indexOf('app.post("/api/agent/start"');
  const stopAt = source.indexOf('app.post("/api/agent/stop"');
  assert.ok(startAt > 0 && stopAt > startAt);
  const route = source.slice(startAt, stopAt);
  const jsReplyAt = route.indexOf("native: false");
  assert.ok(jsReplyAt > 0);
  // the js path goes through the WP13 helper before answering
  const helperAt = route.indexOf("ensureServerModeForJsEngine");
  assert.ok(helperAt > 0 && helperAt < jsReplyAt);
  // prepareNativeAgentRuntime stays confined to the native branch
  assert.ok(route.includes("prepareNativeAgentRuntime("));
  assert.ok(route.lastIndexOf("prepareNativeAgentRuntime(") < route.indexOf("native: false"));
  // the js helper call never asks for agent mode: only the native branch does
  const jsPath = route.slice(route.indexOf("if (agentEngine() === \"native\") {") >= 0 ? helperAt : 0, jsReplyAt);
  assert.equal(jsPath.includes('mode: "agent"'), false);
});

test("probeStatefulBackend: wrapper active means false without a probe (plan §16.3)", () => {
  const source = readFileSync(join(here, "index.mjs"), "utf8");
  const at = source.indexOf("async function probeStatefulBackend() {");
  assert.ok(at > 0);
  const fn = source.slice(at, source.indexOf("\n}", at));
  assert.match(fn, /if \(wrapperEnabled\(\)\) return false;/);
});
