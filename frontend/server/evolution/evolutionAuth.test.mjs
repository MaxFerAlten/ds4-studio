/** Test origin: DS4 acceptance requirement SEC-API-001. */

import assert from "node:assert/strict";
import test from "node:test";

import { EvolutionAuth } from "./evolutionAuth.mjs";

test("SEC-API-001 write authentication is fail-closed and timing-safe compatible", () => {
  const token = "x".repeat(32);
  const auth = new EvolutionAuth({ tokenEnv: "TOKEN", env: { TOKEN: token } });
  assert.equal(auth.writesEnabled, true);
  assert.equal(auth.verifyAuthorization(`Bearer ${token}`), true);
  assert.equal(auth.verifyAuthorization(`Bearer ${"y".repeat(32)}`), false);
  assert.equal(auth.verifyAuthorization("Basic x"), false);
  assert.equal(new EvolutionAuth({ tokenEnv: "TOKEN", env: { TOKEN: "short" } }).writesEnabled, false);
});

test("reviewer identity is validated independently from model output", () => {
  const auth = new EvolutionAuth({ tokenEnv: "TOKEN", env: {} });
  assert.equal(auth.validateReviewer("Reviewer One"), "Reviewer One");
  assert.throws(() => auth.validateReviewer("<script>"), (error) => error.code === "INVALID_REVIEWER");
});
