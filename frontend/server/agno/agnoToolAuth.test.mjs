import assert from "node:assert";
import { describe, it } from "node:test";
import { AgnoToolAuthenticator } from "./agnoToolAuth.mjs";

describe("AgnoToolAuthenticator", () => {
  const validToken = "a".repeat(32);

  it("rejects missing Authorization header (401)", () => {
    const auth = new AgnoToolAuthenticator(validToken);
    const req = { headers: {} };
    const result = auth.require(req);
    assert.deepEqual(result, {
      ok: false,
      status: 401,
      code: "MISSING_TOOL_BRIDGE_TOKEN"
    });
  });

  it("rejects Basic auth scheme (401)", () => {
    const auth = new AgnoToolAuthenticator(validToken);
    const req = { headers: { authorization: "Basic dXNlcjpwYXNz" } };
    const result = auth.require(req);
    assert.deepEqual(result, {
      ok: false,
      status: 401,
      code: "MISSING_TOOL_BRIDGE_TOKEN"
    });
  });

  it("rejects wrong token value (403)", () => {
    const auth = new AgnoToolAuthenticator(validToken);
    const req = { headers: { authorization: "Bearer " + "b".repeat(32) } };
    const result = auth.require(req);
    assert.deepEqual(result, {
      ok: false,
      status: 403,
      code: "INVALID_TOOL_BRIDGE_TOKEN"
    });
  });

  it("accepts correct token", () => {
    const auth = new AgnoToolAuthenticator(validToken);
    const req = { headers: { authorization: "Bearer " + validToken } };
    const result = auth.require(req);
    assert.deepEqual(result, { ok: true });
  });

  it("rejects token with prefix character", () => {
    const auth = new AgnoToolAuthenticator(validToken);
    const wrongToken = "x" + validToken;
    const req = { headers: { authorization: "Bearer " + wrongToken } };
    const result = auth.require(req);
    assert.deepEqual(result, {
      ok: false,
      status: 403,
      code: "INVALID_TOOL_BRIDGE_TOKEN"
    });
  });

  it("rejects token with suffix character", () => {
    const auth = new AgnoToolAuthenticator(validToken);
    const wrongToken = validToken + "x";
    const req = { headers: { authorization: "Bearer " + wrongToken } };
    const result = auth.require(req);
    assert.deepEqual(result, {
      ok: false,
      status: 403,
      code: "INVALID_TOOL_BRIDGE_TOKEN"
    });
  });

  it("rejects token with mismatched length without throwing", () => {
    const auth = new AgnoToolAuthenticator(validToken);
    const shortToken = "b".repeat(16);
    const req = { headers: { authorization: "Bearer " + shortToken } };
    const result = auth.require(req);
    assert.deepEqual(result, {
      ok: false,
      status: 403,
      code: "INVALID_TOOL_BRIDGE_TOKEN"
    });
  });

  it("does not log the token value", () => {
    // This is a code inspection check rather than a runtime assertion.
    // Verify that the module source does not contain console.log or similar
    // that would print the token or expectedToken values.
    const auth = new AgnoToolAuthenticator(validToken);
    const req = { headers: { authorization: "Bearer " + validToken } };
    // Capture any output that might occur
    let logged = "";
    const originalLog = console.log;
    const originalError = console.error;
    const originalWarn = console.warn;
    console.log = (...args) => { logged += args.join(" "); };
    console.error = (...args) => { logged += args.join(" "); };
    console.warn = (...args) => { logged += args.join(" "); };
    try {
      auth.require(req);
      assert(!logged.includes(validToken), "token should not be logged");
    } finally {
      console.log = originalLog;
      console.error = originalError;
      console.warn = originalWarn;
    }
  });
});
