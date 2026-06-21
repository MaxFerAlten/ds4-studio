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
  assert.equal(payload.max_tokens, "auto");
  assert.equal(payload.max_tokens_safety_cap, 32768);
  assert.equal(payload.context_margin, 1024);
});

test("direct chat can opt into thinking with a reasoning effort", () => {
  const payload = buildChatPayload(
    { ...REQUEST_DEFAULTS, thinking: true, reasoning_effort: "max" },
    [{ role: "user", content: "solve" }]
  );

  assert.equal(payload.think, true);
  assert.equal(payload.reasoning_effort, "max");
});

test("direct chat still accepts a fixed numeric max_tokens override", () => {
  const payload = buildChatPayload(
    { ...REQUEST_DEFAULTS, max_tokens: 1234 },
    [{ role: "user", content: "solve" }]
  );

  assert.equal(payload.max_tokens, 1234);
  assert.equal(payload.max_tokens_safety_cap, undefined);
  assert.equal(payload.context_margin, undefined);
});
