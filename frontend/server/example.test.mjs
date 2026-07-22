import assert from "node:assert/strict";
import test from "node:test";

import { validateRequest } from "./example.mjs";

test("validateRequest accepts JSON with a non-empty Bearer token", () => {
  assert.deepEqual(validateRequest({
    "Content-Type": "application/json; charset=utf-8",
    Authorization: "Bearer token-123"
  }), { valid: true, reason: "" });
});

test("validateRequest rejects missing or malformed headers", () => {
  assert.equal(validateRequest().valid, false);
  assert.equal(validateRequest(null).valid, false);
  assert.equal(validateRequest({ "content-type": "text/plain", authorization: "Bearer token" }).reason,
    "Content-Type must be application/json");
  assert.equal(validateRequest({ "content-type": "application/json", authorization: "Bearer " }).reason,
    "Authorization must use a non-empty Bearer token");
});

test("validateRequest does not accept application/jsonp or non-string values", () => {
  assert.equal(validateRequest({ "content-type": "application/jsonp", authorization: "Bearer token" }).valid, false);
  assert.equal(validateRequest({ "content-type": ["application/json"], authorization: "Bearer token" }).valid, false);
});
