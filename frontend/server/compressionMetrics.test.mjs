import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createCompressionMetrics,
  createCompressionMetricsHandler
} from "./compressionMetrics.mjs";
import { compressAgentToolResult } from "./agentToolOutputCompression.mjs";

function responseCapture() {
  return {
    statusCode: 200,
    payload: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    }
  };
}

test("compression metrics count only actual transforms and successful retrieves", () => {
  const metrics = createCompressionMetrics();

  assert.equal(metrics.recordCompression(null), false);
  assert.equal(metrics.recordCompression({ changed: false, text: "same" }), false);
  assert.equal(metrics.recordCompression({
    changed: true,
    text: "compressed",
    originalBytes: 9000,
    compressedBytes: 1400,
    blobId: "blob-1",
    strategy: "log_compressor"
  }), true);
  assert.equal(metrics.recordRetrieve(false), false);
  assert.equal(metrics.recordRetrieve(true), true);

  assert.deepEqual(metrics.snapshot({ enabled: true }), {
    ok: true,
    active: false,
    events: 1,
    originalBytes: 9000,
    compressedBytes: 1400,
    blobCount: 1,
    retrieveCount: 1,
    lastStrategy: "log_compressor",
    lastBlobId: "blob-1",
    enabled: true,
    source: "node-js"
  });
});

test("Agent JS compression follows the Headroom toggle and records a real transform", async () => {
  const metrics = createCompressionMetrics();
  let stored = 0;
  const blobStore = {
    async put() {
      stored += 1;
      return { id: `blob-${stored}` };
    }
  };
  const result = {
    content: Array.from({ length: 100 }, (_, i) => `src/file_${i}.c`).join("\n"),
    isError: false
  };

  const disabled = await compressAgentToolResult({
    enabled: false, toolName: "list", result, blobStore, metrics
  });
  assert.equal(disabled.compressed, false);
  assert.equal(stored, 0);
  assert.equal(metrics.snapshot().events, 0);

  const enabled = await compressAgentToolResult({
    enabled: true, toolName: "list", result, blobStore, metrics
  });
  assert.equal(enabled.compressed, true);
  assert.equal(stored, 1);
  assert.equal(metrics.snapshot().events, 1);
  assert.equal(metrics.snapshot().blobCount, 1);
});

test("JS metrics come from DS4 without querying an OpenAI-compatible backend", async () => {
  const metrics = createCompressionMetrics();
  metrics.recordCompression({
    changed: true,
    text: "compressed",
    originalBytes: 5000,
    compressedBytes: 800,
    strategy: "log_compressor"
  });
  let fetchCalls = 0;
  const handler = createCompressionMetricsHandler({
    getEngine: () => "js",
    getBackendBase: () => "http://127.0.0.1:8732",
    isEnabled: () => true,
    metrics,
    fetchImpl: async () => { fetchCalls += 1; throw new Error("must not fetch"); }
  });
  const res = responseCapture();

  await handler({}, res);

  assert.equal(fetchCalls, 0);
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.source, "node-js");
  assert.equal(res.payload.enabled, true);
  assert.equal(res.payload.events, 1);
  assert.equal(res.payload.originalBytes, 5000);
});

test("native metrics proxy the wrapper and preserve its counters", async () => {
  const metrics = createCompressionMetrics();
  const handler = createCompressionMetricsHandler({
    getEngine: () => "native",
    getBackendBase: () => "http://127.0.0.1:8002",
    isEnabled: () => true,
    metrics,
    fetchImpl: async (url, options) => {
      assert.equal(url, "http://127.0.0.1:8002/api/agent/compression-metrics");
      assert.equal(options.headers.Accept, "application/json");
      return new Response(JSON.stringify({ ok: true, events: 3, originalBytes: 12000 }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }
  });
  const res = responseCapture();

  await handler({}, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.payload, {
    ok: true,
    events: 3,
    originalBytes: 12000,
    source: "wrapper-native"
  });
});

test("native wrapper errors stay visible instead of falling back to JS counters", async () => {
  const metrics = createCompressionMetrics();
  metrics.recordCompression({ changed: true, text: "local", originalBytes: 5000, compressedBytes: 500 });
  const handler = createCompressionMetricsHandler({
    getEngine: () => "native",
    getBackendBase: () => "http://127.0.0.1:8002",
    isEnabled: () => true,
    metrics,
    fetchImpl: async () => new Response(JSON.stringify({ error: "missing route" }), { status: 404 })
  });
  const res = responseCapture();

  await handler({}, res);

  assert.equal(res.statusCode, 404);
  assert.equal(res.payload.ok, false);
  assert.equal(res.payload.source, "wrapper-native");
  assert.match(res.payload.error, /missing route/);
  assert.equal("events" in res.payload, false);
});
