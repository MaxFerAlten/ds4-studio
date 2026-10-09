// WP6 of convergenza.loop.md: token counting and context window that work on
// DS4 (wrapper /v1/token-count), llama-server (/tokenize + /props) and any
// other OpenAI-compatible backend (character estimate).
//
// Field names were verified against the live Vitronia server on 2026-10-03
// (see docs/convergenza/WP6.md): POST /tokenize -> {"tokens":[...]},
// GET /props -> default_generation_settings.n_ctx.  The wrapper's
// /v1/token-count response shape ({ prompt_tokens, context_length }) is the
// one requestPayload.mjs already consumes for auto max_tokens.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";

import { countPromptTokens, contextWindow, renderMessagesForCount } from "./backendContext.mjs";

// ---------------------------------------------------------------- harness

async function startFakeBackend(routes) {
  const log = [];
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      const key = `${req.method} ${req.url}`;
      log.push({ key, body });
      const handler = routes[key];
      if (!handler) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end("{}");
        return;
      }
      const [status, payload] = handler(body);
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(payload));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    base,
    log,
    close: () => new Promise((resolve) => server.close(resolve))
  };
}

const CHAT = {
  model: "m",
  messages: [
    { role: "system", content: "sys" },
    { role: "user", content: "ciao mondo" }
  ]
};

// ---------------------------------------------------------------- count

test("token-count answers and its prompt_tokens wins", async () => {
  const backend = await startFakeBackend({
    "POST /v1/token-count": () => [200, { prompt_tokens: 123, context_length: 4096 }]
  });
  try {
    const result = await countPromptTokens(CHAT, { fetchImpl: fetch, base: backend.base });
    assert.equal(result.tokens, 123);
    assert.equal(result.estimated, false);
    assert.equal(result.method, "token-count");
    assert.deepEqual(JSON.parse(backend.log[0].body).messages, CHAT.messages);
  } finally {
    await backend.close();
  }
});

test("a 404 falls to /tokenize once, then the method is remembered", async () => {
  const backend = await startFakeBackend({
    "POST /tokenize": (body) => {
      const parsed = JSON.parse(body);
      // The content is the rendered messages, as the plan prescribes.
      assert.equal(typeof parsed.content, "string");
      assert.match(parsed.content, /ciao mondo/);
      return [200, { tokens: [66, 21817, 67348] }];
    }
  });
  try {
    const first = await countPromptTokens(CHAT, { fetchImpl: fetch, base: backend.base });
    assert.equal(first.tokens, 3); // tokens.length, verified on Vitronia
    assert.equal(first.estimated, false);
    assert.equal(first.method, "tokenize");
    assert.deepEqual(backend.log.map((e) => e.key), [
      "POST /v1/token-count", "POST /apply-template", "POST /tokenize"
    ]);

    const second = await countPromptTokens(CHAT, { fetchImpl: fetch, base: backend.base });
    assert.equal(second.tokens, 3);
    // Neither 404 is retried against this base (plan §9).
    assert.deepEqual(backend.log.map((e) => e.key).slice(3), ["POST /tokenize"]);
  } finally {
    await backend.close();
  }
});

test("no endpoint works: character estimate, then no request at all", async () => {
  const backend = await startFakeBackend({});
  try {
    const result = await countPromptTokens(CHAT, { fetchImpl: fetch, base: backend.base });
    const rendered = "system\nsys\nuser\nciao mondo";
    assert.equal(result.tokens, Math.ceil(rendered.length / 3.5));
    assert.equal(result.estimated, true);
    assert.equal(result.method, "estimate");

    const before = backend.log.length;
    const again = await countPromptTokens(CHAT, { fetchImpl: fetch, base: backend.base });
    assert.equal(again.estimated, true);
    assert.equal(backend.log.length, before); // estimate is remembered too
  } finally {
    await backend.close();
  }
});

test("a 200 without a usable number is a failure, not a zero", async () => {
  const backend = await startFakeBackend({
    "POST /v1/token-count": () => [200, { unexpected: true }]
  });
  try {
    const result = await countPromptTokens(CHAT, { fetchImpl: fetch, base: backend.base });
    assert.equal(result.estimated, true);
    assert.ok(result.tokens > 0);
  } finally {
    await backend.close();
  }
});

test("a network error estimates without poisoning the cache", async () => {
  const backend = await startFakeBackend({
    "POST /v1/token-count": () => [200, { prompt_tokens: 7 }]
  });
  try {
    let down = true;
    const realFetch = fetch;
    const fetchImpl = async (url, options) => {
      if (down) throw new Error("ECONNREFUSED");
      return realFetch(url, options);
    };
    const failed = await countPromptTokens(CHAT, { fetchImpl, base: backend.base });
    assert.equal(failed.estimated, true);

    down = false;
    const recovered = await countPromptTokens(CHAT, { fetchImpl, base: backend.base });
    assert.equal(recovered.tokens, 7);
    assert.equal(recovered.estimated, false);
  } finally {
    await backend.close();
  }
});

// ---------------------------------------------------------------- window

test("contextWindow prefers config.server.ctx for the local wrapper", async () => {
  const backend = await startFakeBackend({
    "GET /props": () => [200, { default_generation_settings: { n_ctx: 262144 } }]
  });
  try {
    const result = await contextWindow({
      fetchImpl: fetch,
      base: backend.base,
      config: { server: { ctx: 131072 } },
      localWrapper: true
    });
    assert.deepEqual(result, {
      tokens: 131072,
      estimated: false,
      source: "config.server.ctx"
    });
    assert.equal(backend.log.length, 0);
  } finally {
    await backend.close();
  }
});

test("contextWindow reads llama-server /props", async () => {
  // Shape copied from the live GET /props of the Vitronia server (WP6 report).
  const backend = await startFakeBackend({
    "GET /props": () => [200, {
      default_generation_settings: { params: { seed: 1 }, n_ctx: 262144 },
      model_alias: "vitronia"
    }]
  });
  try {
    const result = await contextWindow({ fetchImpl: fetch, base: backend.base, config: {} });
    assert.equal(result.tokens, 262144);
    assert.equal(result.estimated, false);
    assert.equal(result.source, "props");
  } finally {
    await backend.close();
  }
});

test("contextWindow falls back to config, then to 32768, always estimated", async () => {
  const backend = await startFakeBackend({});
  try {
    const fromConfig = await contextWindow({
      fetchImpl: fetch,
      base: backend.base,
      config: { requestDefaults: { context_window: 8192 } }
    });
    assert.deepEqual(fromConfig, {
      tokens: 8192,
      estimated: true,
      source: "config.requestDefaults.context_window"
    });
    // contextWindow never caches, so the same 404 backend answers twice.
    const hard = await contextWindow({ fetchImpl: fetch, base: backend.base, config: {} });
    assert.deepEqual(hard, { tokens: 32768, estimated: true, source: "fallback" });
  } finally {
    await backend.close();
  }
});

test("a props answer without n_ctx falls back", async () => {
  const backend = await startFakeBackend({
    "GET /props": () => [200, { default_generation_settings: { params: {} } }]
  });
  try {
    const result = await contextWindow({ fetchImpl: fetch, base: backend.base, config: {} });
    assert.deepEqual(result, { tokens: 32768, estimated: true, source: "fallback" });
  } finally {
    await backend.close();
  }
});

test("renderMessagesForCount includes tool-call arguments and tool schemas", () => {
  const text = renderMessagesForCount({
    messages: [
      { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "write_file", arguments: "{\"body\":\"BIG-ARGS\"}" } }] },
      { role: "tool", tool_call_id: "c1", content: "ok" }
    ],
    tools: [{ type: "function", function: { name: "write_file", description: "SCHEMA-DESC" } }]
  });
  assert.match(text, /BIG-ARGS/);
  assert.match(text, /SCHEMA-DESC/);
});

test("/tokenize counts the chat template's prompt when /apply-template exists", async () => {
  const backend = await startFakeBackend({
    "POST /apply-template": (body) => {
      const parsed = JSON.parse(body);
      assert.equal(parsed.messages[1].reasoning_content, "LONG-THINK");
      assert.equal(parsed.tools[0].function.name, "read_file");
      return [200, { prompt: "<think>\nLONG-THINK\n</think>TEMPLATED" }];
    },
    "POST /tokenize": (body) => {
      assert.match(JSON.parse(body).content, /TEMPLATED/);
      return [200, { tokens: [1, 2, 3, 4, 5] }];
    }
  });
  try {
    const result = await countPromptTokens({
      messages: [
        { role: "user", content: "ciao" },
        { role: "assistant", content: "ok", reasoning_content: "LONG-THINK" }
      ],
      tools: [{ type: "function", function: { name: "read_file" } }]
    }, { fetchImpl: fetch, base: backend.base });
    assert.equal(result.tokens, 5);
    assert.equal(result.method, "tokenize");
  } finally {
    await backend.close();
  }
});

test("renderMessagesForCount includes reasoning_content", () => {
  assert.match(
    renderMessagesForCount({ messages: [{ role: "assistant", content: "ok", reasoning_content: "THINK-TEXT" }] }),
    /THINK-TEXT/
  );
});

test("backendSingleSlot: a local ds4-wrapper is single-slot without asking", async () => {
  const { backendSingleSlot } = await import("./backendContext.mjs");
  let calls = 0;
  const fetchImpl = async () => { calls++; return new Response("{}", { status: 200 }); };
  assert.equal(await backendSingleSlot({ fetchImpl, base: "http://x", localWrapper: true }), true);
  assert.equal(calls, 0);
});

test("backendSingleSlot reads llama-server total_slots from /props", async () => {
  const { backendSingleSlot } = await import("./backendContext.mjs");
  const props = (slots) => async () => new Response(JSON.stringify({ total_slots: slots }), { status: 200 });
  assert.equal(await backendSingleSlot({ fetchImpl: props(1), base: "http://x" }), true);
  assert.equal(await backendSingleSlot({ fetchImpl: props(4), base: "http://x" }), false);
});

test("backendSingleSlot is false when the backend does not say", async () => {
  const { backendSingleSlot } = await import("./backendContext.mjs");
  const notFound = async () => new Response("no", { status: 404 });
  const noField = async () => new Response(JSON.stringify({ default_generation_settings: {} }), { status: 200 });
  const broken = async () => { throw new Error("down"); };
  for (const fetchImpl of [notFound, noField, broken]) {
    assert.equal(await backendSingleSlot({ fetchImpl, base: "http://x" }), false);
  }
});
