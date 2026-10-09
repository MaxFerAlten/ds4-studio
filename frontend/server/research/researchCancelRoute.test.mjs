import assert from "node:assert/strict";
import { test } from "node:test";
import { createAgentAdmission } from "../agentAdmission.mjs";
import { createAgentIdentity } from "../agentIdentity.mjs";
import { createAdmissionGuards } from "../agent/admissionGuards.mjs";
import { createResearchCancelHandler } from "./researchCancelRoute.mjs";

function response() {
  const headers = new Map();
  return {
    statusCode: 200,
    body: undefined,
    headersSent: false,
    setHeader(name, value) { headers.set(name, value); },
    getHeader(name) { return headers.get(name); },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; }
  };
}

test("research cancel rejects cross-origin requests before touching the runtime", async () => {
  const identity = createAgentIdentity({ secret: "test-secret" });
  const admission = createAgentAdmission();
  const guards = createAdmissionGuards({ admission, identity });
  let cancelCalls = 0;
  const handler = createResearchCancelHandler({
    identity,
    refuse: guards.refuse,
    requireEnabled: () => true,
    admission,
    runtime: { async cancel() { cancelCalls += 1; return { status: "cancelled" }; } }
  });
  const res = response();

  await handler({ headers: { origin: "http://evil.example", host: "127.0.0.1:8732" }, body: { sessionId: "rs_123" } }, res);

  assert.equal(res.statusCode, 403);
  assert.deepEqual(res.body, { error: "cross-origin request rejected", code: "ORIGIN_REJECTED" });
  assert.equal(cancelCalls, 0);
});

test("research cancel preserves same-origin and non-browser behavior", async () => {
  const identity = createAgentIdentity({ secret: "test-secret" });
  const admission = createAgentAdmission();
  const guards = createAdmissionGuards({ admission, identity });
  const calls = [];
  const handler = createResearchCancelHandler({
    identity,
    refuse: guards.refuse,
    requireEnabled: () => true,
    admission,
    runtime: { async cancel(sessionId) { calls.push(sessionId); return { status: "cancelled" }; } }
  });

  for (const headers of [
    { origin: "http://127.0.0.1:8732", host: "127.0.0.1:8732" },
    { host: "127.0.0.1:8732" }
  ]) {
    const res = response();
    await handler({ headers, body: { sessionId: "rs_123" } }, res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, { status: "cancelled" });
  }
  assert.deepEqual(calls, ["rs_123", "rs_123"]);
});

test("a running research job can only be cancelled by the owner holding its lease", async () => {
  const identity = createAgentIdentity({ secret: "test-secret" });
  const admission = createAgentAdmission();
  const guards = createAdmissionGuards({ admission, identity });
  const ownerReq = { headers: { host: "127.0.0.1:8732" } };
  const ownerRes = response();
  const ownerId = identity.ownerOf(ownerReq, ownerRes);
  const ownerCookie = ownerRes.getHeader("Set-Cookie").split(";")[0];
  let release;
  let entered;
  const active = new Promise((resolve) => { entered = resolve; });
  const lease = admission.exclusive("research", async () => {
    entered();
    await new Promise((resolve) => { release = resolve; });
  }, { ownerId });
  await active;

  const calls = [];
  const handler = createResearchCancelHandler({
    identity,
    refuse: guards.refuse,
    requireEnabled: () => true,
    admission,
    runtime: { jobs: new Map([["rs_123", { running: true }]]), async cancel(id) { calls.push(id); return { status: "cancelled" }; } }
  });
  try {
    const otherRes = response();
    await handler({ headers: { host: "127.0.0.1:8732" }, body: { sessionId: "rs_123" } }, otherRes);
    assert.equal(otherRes.statusCode, 409);
    assert.equal(otherRes.body.code, "LEASE_NOT_OWNED");
    assert.deepEqual(calls, []);

    const sameOwnerRes = response();
    await handler({ headers: { host: "127.0.0.1:8732", cookie: ownerCookie }, body: { sessionId: "rs_123" } }, sameOwnerRes);
    assert.equal(sameOwnerRes.statusCode, 200);
    assert.deepEqual(calls, ["rs_123"]);
  } finally {
    release();
    await lease;
  }
});
