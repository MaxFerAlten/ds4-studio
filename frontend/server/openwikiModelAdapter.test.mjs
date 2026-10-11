import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createOpenWikiModelGenerator } from './openwikiModelAdapter.mjs';
import { buildChatPayload } from './requestPayload.mjs';

const schema = { type: 'object', required: ['markdown'], properties: { markdown: { type: 'string' } } };
const request = Object.freeze({ model: 'ds4-selected-model', temperature: 0.2, max_tokens: 2048 });
const modelContext = Object.freeze({ request });

function fixture(response = { status: 200, body: JSON.stringify({ choices: [{ message: { tool_calls: [
  { type: 'function', function: { name: 'openwiki_page', arguments: '{"markdown":"# generated"}' } },
] } }] }) }) {
  const calls = [];
  const generate = createOpenWikiModelGenerator({
    buildChatPayload: (params, messages) => ({ model: params.model, max_tokens: params.max_tokens, stream: params.stream, think: params.think, messages }),
    endpoint: () => 'http://127.0.0.1:8732/v1/chat/completions',
    postJson: async (...args) => { calls.push(args); return response; },
  });
  return { calls, generate };
}

test('uses the selected DS4 model and requires one named structured function call', async () => {
  const fx = fixture();
  const signal = new AbortController().signal;
  const result = await fx.generate({ kind: 'page', schema, prompt: 'bounded context', maxTokens: 4096, signal, modelContext });
  assert.deepEqual(result, { mode: 'tool', toolCalls: [{ name: 'openwiki_page', arguments: '{"markdown":"# generated"}' }] });
  const [url, payload, sentSignal] = fx.calls[0];
  assert.equal(url, 'http://127.0.0.1:8732/v1/chat/completions');
  assert.equal(sentSignal, signal);
  assert.equal(payload.model, 'ds4-selected-model');
  assert.equal(payload.max_tokens, 4096);
  assert.equal(payload.stream, false);
  assert.deepEqual(payload.tools[0].function.parameters, schema);
  assert.deepEqual(payload.tool_choice, { type: 'function', function: { name: 'openwiki_page' } });
  assert.equal(JSON.stringify(payload).includes('api_key'), false);
});

test('uses separate plan tool name and schema', async () => {
  const fx = fixture({ status: 200, body: JSON.stringify({ choices: [{ message: { tool_calls: [
    { type: 'function', function: { name: 'openwiki_plan', arguments: '{"pages":[]}' } },
  ] } }] }) });
  await fx.generate({ kind: 'plan', schema, prompt: 'plan', maxTokens: 2048, modelContext });
  assert.equal(fx.calls[0][1].tools[0].function.name, 'openwiki_plan');
});

test('capability probe uses selected model with one tiny structured call', async () => {
  const fx = fixture({ status: 200, body: JSON.stringify({ choices: [{ message: { tool_calls: [
    { type: 'function', function: { name: 'openwiki_capability_probe', arguments: '{"ready":true}' } },
  ] } }] }) });
  await fx.generate.probeModel({ modelContext, signal: new AbortController().signal });
  const [, payload] = fx.calls[0];
  assert.equal(payload.model, 'ds4-selected-model');
  assert.equal(payload.max_tokens, 256);
  assert.deepEqual(payload.tool_choice, { type: 'function', function: { name: 'openwiki_capability_probe' } });
});

test('capability probe fails closed when the model returns text instead of its function call', async () => {
  const fx = fixture({ status: 200, body: JSON.stringify({ choices: [{ message: { content: 'ready=true', tool_calls: [] } }] }) });
  await assert.rejects(fx.generate.probeModel({ modelContext }), { code: 'MODEL_TOOL_CALL_UNSUPPORTED' });
});

test('rejects malformed, missing, extra, or wrong tool calls without text fallback', async (t) => {
  const cases = [
    [{ choices: [{ message: { content: 'looks like JSON', tool_calls: [] } }] }, 'MODEL_TOOL_CALL_UNSUPPORTED'],
    [{ choices: [{ message: { tool_calls: [{ type: 'function', function: { name: 'other', arguments: '{}' } }] } }] }, 'MODEL_TOOL_CALL_UNSUPPORTED'],
    [{ choices: [{ message: { tool_calls: [
      { type: 'function', function: { name: 'openwiki_page', arguments: '{}' } },
      { type: 'function', function: { name: 'openwiki_page', arguments: '{}' } },
    ] } }] }, 'MODEL_TOOL_CALL_UNSUPPORTED'],
  ];
  for (const [body, code] of cases) {
    const fx = fixture({ status: 200, body: JSON.stringify(body) });
    await assert.rejects(fx.generate({ kind: 'page', schema, prompt: 'p', maxTokens: 100, modelContext }), { code });
  }
  const invalid = fixture({ status: 502, body: 'secret upstream detail' });
  await assert.rejects(invalid.generate({ kind: 'page', schema, prompt: 'p', maxTokens: 100, modelContext }), {
    code: 'MODEL_REQUEST_FAILED', message: 'active DS4 model returned an unsuccessful status',
  });
});

test('validates model context, bounds and abort before transport', async () => {
  const fx = fixture();
  await assert.rejects(fx.generate({ kind: 'page', schema, prompt: 'p', maxTokens: 100 }), { code: 'MODEL_CONTEXT_INVALID' });
  await assert.rejects(fx.generate({ kind: 'page', schema, prompt: 'p', maxTokens: 8193, modelContext }), { code: 'MODEL_REQUEST_INVALID' });
  const abort = new AbortController();
  abort.abort();
  await assert.rejects(fx.generate({ kind: 'page', schema, prompt: 'p', maxTokens: 100, modelContext, signal: abort.signal }));
  assert.equal(fx.calls.length, 0);
});

test('all OpenWiki requests disable native and llama-server reasoning without changing chat settings', async () => {
  for (const kind of ['probe', 'plan', 'page']) {
    const fx = fixture({ status: 200, body: JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: '{"ready":true}' } }] }) });
    const settings = Object.freeze({ ...request, thinking: true, think: true, reasoning_effort: 'high' });
    await fx.generate({ kind, schema, prompt: 'bounded context', maxTokens: 256, modelContext: { request: settings } });
    const payload = fx.calls[0][1];
    assert.equal(payload.think, false);
    assert.equal(payload.enable_thinking, false);
    assert.deepEqual(payload.chat_template_kwargs, { enable_thinking: false });
    assert.equal(payload.reasoning_effort, 'none');
    assert.equal(settings.thinking, true);
    assert.equal(settings.reasoning_effort, 'high');
    if (kind === 'page') {
      assert.match(payload.messages[0].content, /under 1000 words/);
      assert.match(payload.messages[0].content, /repo:\/\/README\.md#L1-L5/);
    }
  }
});

test('JSON-capable probe selects JSON mode for the following page', async () => {
  const fx = fixture({ status: 200, body: JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: '{"ready":true}' } }] }) });
  await fx.generate.probeModel({ modelContext });
  await fx.generate({ kind: 'page', schema, prompt: 'p', maxTokens: 256, modelContext });
  const payload = fx.calls[1][1];
  assert.deepEqual(payload.response_format, { type: 'json_object' });
  assert.equal(payload.tools, undefined);
  assert.equal(payload.tool_choice, undefined);
});

test('truncation is reported as an output budget failure rather than missing model support', async () => {
  const fx = fixture({ status: 200, body: JSON.stringify({ choices: [{ finish_reason: 'length', message: { content: '{"markdown":"unfinished' } }] }) });
  await assert.rejects(fx.generate({ kind: 'page', schema, prompt: 'p', maxTokens: 256, modelContext }), { code: 'MODEL_OUTPUT_TRUNCATED' });
  assert.equal(fx.calls.length, 1, 'truncation does not trigger another expensive request');
});

test('Vitronia uses constrained JSON without tools for probe, plan and page', async () => {
  const fx = fixture({ status: 200, body: JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: '{"ready":true}' } }] }) });
  const selected = Object.freeze({ request: Object.freeze({ ...request, model: 'qwen3.8-flash-next-Vitronia' }) });
  await fx.generate.probeModel({ modelContext: selected });
  for (const kind of ['plan', 'page']) {
    await fx.generate({ kind, schema, prompt: 'bounded context', maxTokens: 256, modelContext: selected });
  }
  assert.equal(fx.calls.length, 3, 'no retry or second local model is needed');
  for (const [, payload] of fx.calls) {
    assert.equal(payload.model, selected.request.model);
    assert.deepEqual(payload.response_format, { type: 'json_object' });
    assert.equal(payload.tools, undefined);
    assert.equal(payload.tool_choice, undefined);
    assert.match(payload.messages[0].content, /Return exactly one JSON object/);
    assert.equal(payload.enable_thinking, false);
  }
});

test('Vitronia JSON mode still rejects tool markup and fenced JSON', async () => {
  const selected = { request: { ...request, model: 'qwen3.8-flash-next-vitronia' } };
  for (const content of ['{"markdown":"# page"}\n</parameter>', '```json\n{"markdown":"# page"}\n```']) {
    const fx = fixture({ status: 200, body: JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content } }] }) });
    await assert.rejects(fx.generate({ kind: 'page', schema, prompt: 'p', maxTokens: 256, modelContext: selected }), { code: 'MODEL_TOOL_CALL_UNSUPPORTED' });
    assert.equal(fx.calls.length, 1);
  }
});

test('non-Vitronia models retain named tools for probe, plan and page without changing chat settings', async () => {
  for (const model of ['deepseek-v4-flash', 'qwen4', 'glm-4.7', 'custom-openai-compatible']) {
    const selected = Object.freeze({ request: Object.freeze({ model, temperature: 0.2, thinking: true, think: true, reasoning_effort: 'high' }) });
    const before = buildChatPayload(selected.request, [{ role: 'user', content: 'chat' }]);
    const calls = [];
    const generate = createOpenWikiModelGenerator({
      buildChatPayload, endpoint: () => 'http://backend.invalid/v1/chat/completions',
      postJson: async (url, payload) => {
        calls.push(payload);
        const name = payload.tools[0].function.name;
        const value = name === 'openwiki_capability_probe' ? { ready: true } : { markdown: '# page' };
        return { status: 200, body: JSON.stringify({ choices: [{ finish_reason: 'tool_calls', message: {
          tool_calls: [{ type: 'function', function: { name, arguments: JSON.stringify(value) } }],
        } }] }) };
      },
    });
    await generate.probeModel({ modelContext: selected });
    for (const kind of ['plan', 'page']) {
      const result = await generate({ kind, schema, prompt: 'context', maxTokens: 512, modelContext: selected });
      assert.equal(result.mode, 'tool', model);
    }
    assert.deepEqual(calls.map(p => p.tools[0].function.name), ['openwiki_capability_probe', 'openwiki_plan', 'openwiki_page']);
    for (const payload of calls) {
      assert.equal(payload.model, model);
      assert.deepEqual(payload.tool_choice, { type: 'function', function: { name: payload.tools[0].function.name } });
      assert.equal(payload.response_format, undefined);
      assert.equal(payload.think, false);
      assert.equal(payload.enable_thinking, false);
    }
    assert.deepEqual(buildChatPayload(selected.request, [{ role: 'user', content: 'chat' }]), before);
    assert.equal(before.think, true);
    assert.equal(before.reasoning_effort, 'high');
  }
});

test('switching Vitronia, native tool models and JSON-only models isolates learned modes', async () => {
  const calls = [];
  const generate = createOpenWikiModelGenerator({
    buildChatPayload, endpoint: () => 'http://backend.invalid/v1/chat/completions',
    postJson: async (url, payload) => {
      const name = payload.tools?.[0]?.function.name;
      calls.push({ model: payload.model, json: Boolean(payload.response_format), name });
      const probe = name === 'openwiki_capability_probe' || payload.messages[0].content.startsWith('Return ready=true');
      if (payload.model === 'json-only-model' && name) {
        return { status: 200, body: JSON.stringify({ choices: [{ message: { content: 'Function calls are unavailable.' } }] }) };
      }
      const value = probe ? { ready: true } : { markdown: '# page' };
      const message = name
        ? { tool_calls: [{ type: 'function', function: { name, arguments: JSON.stringify(value) } }] }
        : { content: JSON.stringify(value) };
      return { status: 200, body: JSON.stringify({ choices: [{ message }] }) };
    },
  });
  const context = model => ({ request: { model } });
  const page = model => generate({ kind: 'page', schema, prompt: 'context', maxTokens: 512, modelContext: context(model) });
  await generate.probeModel({ modelContext: context('qwen3.8-flash-next-vitronia') });
  assert.equal((await page('qwen3.8-flash-next-vitronia')).mode, 'json');
  await generate.probeModel({ modelContext: context('deepseek-v4-flash') });
  assert.equal((await page('deepseek-v4-flash')).mode, 'tool');
  await generate.probeModel({ modelContext: context('json-only-model') });
  assert.equal((await page('json-only-model')).mode, 'json');
  assert.equal((await page('deepseek-v4-flash')).mode, 'tool');
  assert.equal((await page('qwen3.8-flash-next-vitronia')).mode, 'json');
  assert.deepEqual(calls.map(c => [c.model, c.json]), [
    ['qwen3.8-flash-next-vitronia', true], ['qwen3.8-flash-next-vitronia', true],
    ['deepseek-v4-flash', false], ['deepseek-v4-flash', false],
    ['json-only-model', false], ['json-only-model', true], ['json-only-model', true],
    ['deepseek-v4-flash', false], ['qwen3.8-flash-next-vitronia', true],
  ]);
});

test('learned JSON mode does not cross backend endpoints for the same model', async () => {
  let endpoint = 'http://first.invalid/v1/chat/completions';
  const calls = [];
  const generate = createOpenWikiModelGenerator({
    buildChatPayload, endpoint: () => endpoint,
    postJson: async (url, payload) => {
      calls.push({ url, json: Boolean(payload.response_format) });
      const value = { markdown: '# page' };
      const message = url.includes('first.invalid')
        ? { content: JSON.stringify(value) }
        : { tool_calls: [{ type: 'function', function: { name: 'openwiki_page', arguments: JSON.stringify(value) } }] };
      return { status: 200, body: JSON.stringify({ choices: [{ message }] }) };
    },
  });
  const page = () => generate({ kind: 'page', schema, prompt: 'context', maxTokens: 512, modelContext });
  assert.equal((await page()).mode, 'json');
  assert.equal((await page()).mode, 'json');
  endpoint = 'http://second.invalid/v1/chat/completions';
  assert.equal((await page()).mode, 'tool');
  endpoint = 'http://first.invalid/v1/chat/completions';
  assert.equal((await page()).mode, 'json');
  assert.deepEqual(calls.map(c => c.json), [false, true, false, true]);
});
