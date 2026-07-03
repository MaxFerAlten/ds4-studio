import { test } from "node:test";
import assert from "node:assert/strict";
import { resetUiAgentForTests, getUiAgentStatus } from "./pageAgentClient.mjs";

test("getUiAgentStatus returns not_initialized before initialization", () => {
  resetUiAgentForTests();
  assert.equal(getUiAgentStatus(), "not_initialized");
});

test("resetUiAgentForTests clears singleton", () => {
  resetUiAgentForTests();
  assert.equal(getUiAgentStatus(), "not_initialized");
});
