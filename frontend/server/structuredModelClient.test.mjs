import test from "node:test";
import assert from "node:assert/strict";

import { StructuredModelClient, extractStructuredJson,
  describeJsonFailure
} from "./structuredModelClient.mjs";

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
}

test("structured model client builds a deterministic non-streaming payload", async () => {
  let request;
  const client = new StructuredModelClient({
    baseUrl: "http://model.test/",
    model: "test-model",
    fetchImpl: async (url, options) => {
      request = { url, body: JSON.parse(options.body) };
      return jsonResponse({ choices: [{ message: { content: "ok", reasoning_content: "private" } }], usage: { total_tokens: 3 } });
    }
  });
  const result = await client.completeRole({ roleName: "test", systemPrompt: "s", userPrompt: "u" });
  assert.equal(request.url, "http://model.test/v1/chat/completions");
  assert.deepEqual(request.body.messages, [{ role: "system", content: "s" }, { role: "user", content: "u" }]);
  assert.equal(request.body.stream, false);
  assert.equal(result.reasoning, "private");
  assert.equal(result.usage.total_tokens, 3);
  assert.equal(result.attempts, 1);
});

test("structured model client applies non-thinking model defaults", async () => {
  let request;
  const client = new StructuredModelClient({
    baseUrl: "http://model.test",
    modelConfig: { think: false },
    fetchImpl: async (_url, options) => {
      request = JSON.parse(options.body);
      return jsonResponse({ choices: [{ message: { content: "{}" } }] });
    }
  });

  await client.completeRole({ roleName: "extractor", userPrompt: "input", json: true });

  assert.equal(request.max_tokens, 8192);
  assert.equal(request.think, false);
  assert.equal(request.enable_thinking, false);
  assert.equal(request.reasoning_effort, "none");
});

test("structured JSON extraction and the single repair are bounded", async () => {
  assert.deepEqual(extractStructuredJson("```json\n{\"ok\":true}\n```"), { ok: true });
  let calls = 0;
  const client = new StructuredModelClient({
    baseUrl: "http://model.test",
    fetchImpl: async () => {
      calls += 1;
      return jsonResponse({
        choices: [{ message: { content: calls === 1 ? "invalid" : "{\"fixed\":true}" } }],
        usage: { prompt_tokens: calls, completion_tokens: 1, total_tokens: calls + 1 }
      });
    }
  });
  const result = await client.completeRole({ roleName: "critic", userPrompt: "input", json: true });
  assert.equal(calls, 2);
  assert.deepEqual(result.json, { fixed: true });
  assert.equal(result.attempts, 2);
  assert.deepEqual(result.usage, { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 });
});

test("HTTP error output is bounded", async () => {
  const client = new StructuredModelClient({
    baseUrl: "http://model.test",
    errorPrefix: "evolution model",
    fetchImpl: async () => new Response("x".repeat(2000), { status: 500 })
  });
  await assert.rejects(
    () => client.completeRole({ roleName: "critic", userPrompt: "input" }),
    (error) => error.message.startsWith("evolution model HTTP 500") && error.message.length < 500
  );
});

test("a JSON failure says whether the reply was truncated", () => {
  const truncated = describeJsonFailure("researcher", {
    content: '{"step_id":"st_1","finding":"Gli operatori di innalzamento e abbass',
    finishReason: "length",
    usage: { completion_tokens: 1536, completion_tokens_details: { reasoning_tokens: 537 } }
  });
  assert.match(truncated, /finish_reason=length/);
  assert.match(truncated, /completion_tokens=1536/);
  assert.match(truncated, /reasoning_tokens=537/);
  assert.match(truncated, /raise this role's maxTokens/);
  assert.match(truncated, /innalzamento e abbass/);

  // Prose instead of JSON is a different fix, and must not claim truncation.
  const prose = describeJsonFailure("researcher", {
    content: "Mi dispiace, non posso rispondere.",
    finishReason: "stop",
    usage: { completion_tokens: 12 }
  });
  assert.match(prose, /finish_reason=stop/);
  assert.doesNotMatch(prose, /token budget/);

  assert.match(describeJsonFailure("researcher", { content: "" }), /reply was empty/);
});
