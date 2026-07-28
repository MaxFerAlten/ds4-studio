import assert from "node:assert";
import { describe, it } from "node:test";
import { AgnoExecutionGuard, AgnoExecutionGuardError, sendAgnoGuardError } from "./agnoExecutionGuard.mjs";

/** Routes fetch calls to per-path canned responses/throwers; records call counts. */
function fakeFetch(routes) {
  const calls = { status: 0, switchMode: 0 };
  const fn = async (url, options = {}) => {
    const path = new URL(url).pathname;
    if (path === "/api/wrapper/status") {
      calls.status++;
      const step = routes.status.shift() || routes.status[routes.status.length - 1];
      if (step.throws) throw step.throws;
      return { ok: step.ok !== false, status: step.httpStatus || 200, json: async () => step.body };
    }
    if (path === "/api/wrapper/switch-mode") {
      calls.switchMode++;
      const step = routes.switchMode.shift() || routes.switchMode[routes.switchMode.length - 1];
      if (step.throws) throw step.throws;
      return { ok: step.ok !== false, status: step.httpStatus || 200, json: async () => step.body || {} };
    }
    throw new Error(`unexpected fetch: ${path}`);
  };
  return { fn, calls };
}

function makeGuard({ wrapperEnabled = () => true, fetchImpl }) {
  return new AgnoExecutionGuard({
    controlBaseUrl: "http://127.0.0.1:5173",
    wrapperEnabled,
    fetchImpl,
  });
}

describe("AgnoExecutionGuard", () => {
  it("1. wrapper disabled → allows without any fetch", async () => {
    const { fn, calls } = fakeFetch({ status: [], switchMode: [] });
    const guard = makeGuard({ wrapperEnabled: () => false, fetchImpl: fn });
    const result = await guard.ensureModelCallAllowed();
    assert.equal(result.nativeAgentActive, false);
    assert.equal(calls.status, 0);
    assert.equal(calls.switchMode, 0);
  });

  it("2. wrapper already in server mode → allows, no switch attempted", async () => {
    const { fn, calls } = fakeFetch({
      status: [{ body: { active_mode: "server", state: "ready" } }],
      switchMode: [],
    });
    const guard = makeGuard({ fetchImpl: fn });
    const result = await guard.ensureModelCallAllowed();
    assert.equal(result.mode, "server");
    assert.equal(calls.switchMode, 0);
  });

  it("3. wrapper in agent mode → 409 NATIVE_AGENT_ACTIVE", async () => {
    const { fn } = fakeFetch({ status: [{ body: { active_mode: "agent", state: "ready" } }], switchMode: [] });
    const guard = makeGuard({ fetchImpl: fn });
    await assert.rejects(
      () => guard.ensureModelCallAllowed(),
      (err) => {
        assert.ok(err instanceof AgnoExecutionGuardError);
        assert.equal(err.code, "NATIVE_AGENT_ACTIVE");
        assert.equal(err.status, 409);
        return true;
      }
    );
  });

  it("4. status fetch throws → 503 WRAPPER_STATUS_UNAVAILABLE (fail closed)", async () => {
    const { fn } = fakeFetch({ status: [{ throws: new Error("ECONNREFUSED") }], switchMode: [] });
    const guard = makeGuard({ fetchImpl: fn });
    await assert.rejects(
      () => guard.ensureModelCallAllowed(),
      (err) => {
        assert.equal(err.code, "WRAPPER_STATUS_UNAVAILABLE");
        assert.equal(err.status, 503);
        return true;
      }
    );
  });

  it("5. status HTTP 500 → fail closed WRAPPER_STATUS_UNAVAILABLE", async () => {
    const { fn } = fakeFetch({ status: [{ ok: false, httpStatus: 500, body: {} }], switchMode: [] });
    const guard = makeGuard({ fetchImpl: fn });
    await assert.rejects(
      () => guard.ensureModelCallAllowed(),
      (err) => err.code === "WRAPPER_STATUS_UNAVAILABLE" && err.status === 503
    );
  });

  it("6. invalid status payload (no state/mode) → fail closed WRAPPER_STATUS_INVALID", async () => {
    const { fn } = fakeFetch({ status: [{ body: { foo: "bar" } }], switchMode: [] });
    const guard = makeGuard({ fetchImpl: fn });
    await assert.rejects(
      () => guard.ensureModelCallAllowed(),
      (err) => err.code === "WRAPPER_STATUS_INVALID" && err.status === 503
    );
  });

  it("7. state neither server nor agent → attempts a switch to server mode", async () => {
    const { fn, calls } = fakeFetch({
      status: [{ body: { active_mode: "idle", state: "ready" } }, { body: { active_mode: "server", state: "ready" } }],
      switchMode: [{ body: {} }],
    });
    const guard = makeGuard({ fetchImpl: fn });
    await guard.ensureModelCallAllowed();
    assert.equal(calls.switchMode, 1);
  });

  it("8. switch-mode HTTP failure → fail closed SERVER_MODE_SWITCH_FAILED", async () => {
    const { fn } = fakeFetch({
      status: [{ body: { state: "idle" } }],
      switchMode: [{ ok: false, httpStatus: 500 }],
    });
    const guard = makeGuard({ fetchImpl: fn });
    await assert.rejects(
      () => guard.ensureModelCallAllowed(),
      (err) => err.code === "SERVER_MODE_SWITCH_FAILED" && err.status === 503
    );
  });

  it("9. switch succeeds but re-check still shows agent/non-server → fail closed SERVER_MODE_NOT_CONFIRMED", async () => {
    const { fn } = fakeFetch({
      status: [{ body: { active_mode: "idle", state: "ready" } }, { body: { active_mode: "agent", state: "ready" } }],
      switchMode: [{ body: {} }],
    });
    const guard = makeGuard({ fetchImpl: fn });
    await assert.rejects(
      () => guard.ensureModelCallAllowed(),
      (err) => err.code === "SERVER_MODE_NOT_CONFIRMED" && err.status === 503
    );
  });

  it("10. switch succeeds and re-check confirms server → allows", async () => {
    const { fn } = fakeFetch({
      status: [{ body: { active_mode: "idle", state: "ready" } }, { body: { active_mode: "server", state: "ready" } }],
      switchMode: [{ body: {} }],
    });
    const guard = makeGuard({ fetchImpl: fn });
    const result = await guard.ensureModelCallAllowed();
    assert.equal(result.mode, "server");
    assert.equal(result.nativeAgentActive, false);
  });

  it("11. switch-mode fetch throws (e.g. timeout) → fail closed SERVER_MODE_SWITCH_FAILED", async () => {
    const { fn } = fakeFetch({
      status: [{ body: { state: "idle" } }],
      switchMode: [{ throws: new Error("timeout") }],
    });
    const guard = makeGuard({ fetchImpl: fn });
    await assert.rejects(
      () => guard.ensureModelCallAllowed(),
      (err) => err.code === "SERVER_MODE_SWITCH_FAILED" && err.status === 503
    );
  });

  it("12. does not call switch-mode when already server (redundant with #2, explicit call-count check)", async () => {
    const { fn, calls } = fakeFetch({ status: [{ body: { active_mode: "server", state: "ready" } }], switchMode: [] });
    const guard = makeGuard({ fetchImpl: fn });
    await guard.ensureModelCallAllowed();
    assert.equal(calls.switchMode, 0);
    assert.equal(calls.status, 1);
  });
});

describe("sendAgnoGuardError", () => {
  it("writes status+body for an AgnoExecutionGuardError and returns true", () => {
    let statusCode, body;
    const res = { status(c) { statusCode = c; return this; }, json(b) { body = b; } };
    const handled = sendAgnoGuardError(res, new AgnoExecutionGuardError("NATIVE_AGENT_ACTIVE", "The native DS4 agent is active", 409));
    assert.equal(handled, true);
    assert.equal(statusCode, 409);
    assert.deepEqual(body, { error: "NATIVE_AGENT_ACTIVE", message: "The native DS4 agent is active" });
  });

  it("returns false and writes nothing for a non-guard error", () => {
    let called = false;
    const res = { status() { called = true; return this; }, json() { called = true; } };
    const handled = sendAgnoGuardError(res, new Error("boom"));
    assert.equal(handled, false);
    assert.equal(called, false);
  });
});
