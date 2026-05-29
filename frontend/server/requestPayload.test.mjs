import assert from "node:assert/strict";
import { test } from "node:test";
import { REQUEST_DEFAULTS } from "./defaultConfig.mjs";
import { buildChatPayload } from "./requestPayload.mjs";

test("direct chat defaults enable thinking with high reasoning effort", () => {
  const payload = buildChatPayload(REQUEST_DEFAULTS, [
    { role: "user", content: "descrivimi la teoria degli oscillatori armonici" }
  ]);

  assert.equal(payload.think, true);
  assert.equal(payload.reasoning_effort, "high");
  assert.ok(payload.max_tokens >= 4096);
});

test("direct chat can opt into thinking with a reasoning effort", () => {
  const payload = buildChatPayload(
    { ...REQUEST_DEFAULTS, thinking: true, reasoning_effort: "max" },
    [{ role: "user", content: "solve" }]
  );

  assert.equal(payload.think, true);
  assert.equal(payload.reasoning_effort, "max");
});
