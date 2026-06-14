import test from "node:test";
import assert from "node:assert/strict";
import { RESEARCH_ROLE_OPTIONS, ResearchModelClient, extractJson } from "./researchModelClient.mjs";

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function sseResponse(chunks) {
  const stream = new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(new TextEncoder().encode(c));
      controller.close();
    }
  });
  return new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

test("extractJson parses plain objects", () => {
  assert.deepEqual(extractJson('{"a":1}'), { a: 1 });
});

test("extractJson strips fences and surrounding prose", () => {
  assert.deepEqual(extractJson('Sure!\n```json\n{"a": 1}\n```'), { a: 1 });
  assert.deepEqual(extractJson('thinking… {"a": {"b": 2}} done'), { a: { b: 2 } });
});

test("extractJson returns null on garbage", () => {
  assert.equal(extractJson("no json here"), null);
  assert.equal(extractJson(""), null);
});

test("completeRole posts to /v1/chat/completions and parses json", async () => {
  const calls = [];
  const client = new ResearchModelClient({
    baseUrl: "http://test",
    fetchImpl: async (url, options) => {
      calls.push({ url, body: JSON.parse(options.body) });
      return jsonResponse({
        choices: [{ message: { content: '{"ok":true}' } }],
        usage: { total_tokens: 10 }
      });
    }
  });
  const out = await client.completeRole({
    roleName: "planner",
    systemPrompt: "sys",
    userPrompt: "user",
    json: true
  });
  assert.deepEqual(out.json, { ok: true });
  assert.equal(out.usage.total_tokens, 10);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "http://test/v1/chat/completions");
  assert.equal(calls[0].body.stream, false);
  assert.deepEqual(calls[0].body.messages[0], { role: "system", content: "sys" });
  assert.deepEqual(calls[0].body.messages[1], { role: "user", content: "user" });
});

test("completeRole forwards think:false and a per-role max_tokens", async () => {
  let body = null;
  const client = new ResearchModelClient({
    baseUrl: "http://test",
    modelConfig: { max_tokens: 8192 },
    fetchImpl: async (_url, options) => {
      body = JSON.parse(options.body);
      return jsonResponse({ choices: [{ message: { content: '{"ok":true}' } }] });
    }
  });
  await client.completeRole({
    roleName: "coordinator",
    userPrompt: "u",
    json: true,
    ...RESEARCH_ROLE_OPTIONS.coordinator
  });
  assert.equal(body.think, false);
  assert.equal(body.max_tokens, 1024);
  assert.equal(body.reasoning_effort, undefined);
});

test("completeRole omits think when unset (reporter keeps server default)", async () => {
  let body = null;
  const client = new ResearchModelClient({
    baseUrl: "http://test",
    modelConfig: { max_tokens: 8192 },
    fetchImpl: async (_url, options) => {
      body = JSON.parse(options.body);
      return jsonResponse({ choices: [{ message: { content: "report" } }] });
    }
  });
  await client.completeRole({ roleName: "reporter", userPrompt: "u" });
  assert.equal("think" in body, false);
  assert.equal(body.max_tokens, 8192);
});

test("reporter is not assigned a reduced role option", () => {
  assert.equal(RESEARCH_ROLE_OPTIONS.reporter, undefined);
});

test("completeRole retries once when json is invalid", async () => {
  let n = 0;
  const client = new ResearchModelClient({
    baseUrl: "http://test",
    fetchImpl: async () => {
      n += 1;
      return jsonResponse({
        choices: [{ message: { content: n === 1 ? "not json" : '{"fixed":1}' } }]
      });
    }
  });
  const out = await client.completeRole({ roleName: "planner", userPrompt: "u", json: true });
  assert.equal(n, 2);
  assert.deepEqual(out.json, { fixed: 1 });
});

test("completeRole fails after a second invalid json reply", async () => {
  const client = new ResearchModelClient({
    baseUrl: "http://test",
    fetchImpl: async () => jsonResponse({ choices: [{ message: { content: "still not json" } }] })
  });
  await assert.rejects(
    () => client.completeRole({ roleName: "planner", userPrompt: "u", json: true }),
    /did not return valid JSON/
  );
});

test("completeRole streams deltas via onDelta", async () => {
  const client = new ResearchModelClient({
    baseUrl: "http://test",
    fetchImpl: async () =>
      sseResponse([
        'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"lo"}}],"usage":{"total_tokens":3}}\n\n',
        "data: [DONE]\n\n"
      ])
  });
  const deltas = [];
  const out = await client.completeRole({
    roleName: "reporter",
    userPrompt: "u",
    onDelta: (d) => deltas.push(d.content)
  });
  assert.equal(out.content, "Hello");
  assert.deepEqual(deltas, ["Hel", "lo"]);
  assert.equal(out.usage.total_tokens, 3);
});

test("tokenCount posts to /v1/token-count", async () => {
  let captured;
  const client = new ResearchModelClient({
    baseUrl: "http://test",
    fetchImpl: async (url, options) => {
      captured = { url, body: JSON.parse(options.body) };
      return jsonResponse({ tokens: 42 });
    }
  });
  const out = await client.tokenCount([{ role: "user", content: "hi" }]);
  assert.equal(out.tokens, 42);
  assert.equal(captured.url, "http://test/v1/token-count");
});

test("http errors raise a descriptive error", async () => {
  const client = new ResearchModelClient({
    baseUrl: "http://test",
    fetchImpl: async () => new Response("boom", { status: 500 })
  });
  await assert.rejects(
    () => client.completeRole({ roleName: "x", userPrompt: "u" }),
    /HTTP 500/
  );
});

test("health returns false when backend unreachable", async () => {
  const client = new ResearchModelClient({
    baseUrl: "http://test",
    fetchImpl: async () => {
      throw new Error("ECONNREFUSED");
    }
  });
  assert.equal(await client.health(), false);
});
