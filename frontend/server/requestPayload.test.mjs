import assert from "node:assert/strict";
import { test } from "node:test";
import { REQUEST_DEFAULTS } from "./defaultConfig.mjs";
import { buildChatPayload, resolveAutoMaxTokens } from "./requestPayload.mjs";

test("direct chat defaults disable thinking and omit reasoning effort", () => {
  const payload = buildChatPayload(REQUEST_DEFAULTS, [
    { role: "user", content: "descrivimi la teoria degli oscillatori armonici" }
  ]);

  assert.equal(payload.think, false);
  assert.equal(payload.reasoning_effort, undefined);
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

test("resolveAutoMaxTokens fills the context room minus prompt and margin", () => {
  const max = resolveAutoMaxTokens(
    { context_length: 100000, prompt_tokens: 4000 },
    { safetyCap: 32768, contextMargin: 1024 }
  );
  // room = 100000 - 4000 - 1024 = 94976, capped at safetyCap 32768
  assert.equal(max, 32768);
});

test("resolveAutoMaxTokens is bounded by the remaining room when room < cap", () => {
  const max = resolveAutoMaxTokens(
    { context_length: 5000, prompt_tokens: 4000 },
    { safetyCap: 32768, contextMargin: 100 }
  );
  // room = 5000 - 4000 - 100 = 900
  assert.equal(max, 900);
});

test("resolveAutoMaxTokens falls back to the safety cap when count is null (probe failed)", () => {
  const max = resolveAutoMaxTokens(null, { safetyCap: 8192, contextMargin: 1024 });
  assert.equal(max, 8192);
});

test("resolveAutoMaxTokens falls back to the safety cap when context_length is missing", () => {
  const max = resolveAutoMaxTokens({ prompt_tokens: 50 }, { safetyCap: 4096, contextMargin: 1024 });
  assert.equal(max, 4096);
});

test("resolveAutoMaxTokens never returns less than 1 even if the prompt overflows", () => {
  const max = resolveAutoMaxTokens(
    { context_length: 1000, prompt_tokens: 5000 },
    { safetyCap: 32768, contextMargin: 1024 }
  );
  assert.equal(max, 1);
});

test("resolveAutoMaxTokens uses REQUEST_DEFAULTS when settings are blank", () => {
  const max = resolveAutoMaxTokens({ context_length: 1000000, prompt_tokens: 0 }, {});
  assert.equal(max, REQUEST_DEFAULTS.max_tokens_safety_cap);
});
