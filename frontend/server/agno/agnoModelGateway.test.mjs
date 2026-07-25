import assert from "node:assert";
import { describe, it } from "node:test";
import { createAgnoModelGateway } from "./agnoModelGateway.mjs";
import { AgnoModelGate } from "./agnoModelGate.mjs";

/** Minimal mock HTTP server that simulates ds4-server endpoints. */
class MockBackend {
  constructor() {
    this.handlers = new Map();
    this.setHandler("/v1/models", async () => ({
      status: 200,
      body: { data: [{ id: "deepseek-v4-flash" }] },
    }));
  }

  setHandler(path, fn) {
    this.handlers.set(path, fn);
  }

  async handleRequest(method, path, body) {
    const handler = this.handlers.get(path);
    if (!handler) return { status: 404, body: { error: "not found" } };
    return handler(method, body);
  }
}

/** Convert mock backend response to a fetch-like response object. */
function mockFetch(mockBackend) {
  return async (url, options = {}) => {
    const urlObj = new URL(url);
    const path = urlObj.pathname;
    const method = options.method || "GET";
    let body = null;
    if (options.body) {
      try { body = JSON.parse(options.body); } catch {}
    }
    const result = await mockBackend.handleRequest(method, path, body);
    const responseBody = JSON.stringify(result.body);
    const status = result.status;
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => result.body,
      body: result.stream ? result.stream : new ReadableStream({
        start(controller) {
          controller.enqueue(Buffer.from(responseBody));
          controller.close();
        },
      }),
      clone: () => ({
        json: async () => result.body,
        text: async () => responseBody,
        body: null,
      }),
      text: async () => responseBody,
    };
  };
}

/** Mock SSE streaming backend. */
function mockStreamingBackend(chunks, delayMs = 10) {
  return async (url, options = {}) => {
    let index = 0;
    const stream = new ReadableStream({
      async pull(controller) {
        if (index >= chunks.length) {
          controller.close();
          return;
        }
        await new Promise((r) => setTimeout(r, delayMs));
        controller.enqueue(Buffer.from(chunks[index]));
        index++;
      },
    });
    return {
      ok: true,
      status: 200,
      json: async () => ({ error: "not json" }),
      body: stream,
      text: async () => "streaming",
      clone: () => ({ text: async () => "streaming", json: async () => ({}) }),
    };
  };
}

function createTestGateway({ config = {}, modelGatewayToken = "test-token-abcdef123456", mockBackend, fetchImpl }) {
  const gate = new AgnoModelGate({ maxInflight: 1, maxQueued: 8 });
  const router = createAgnoModelGateway({
    config: {
      agno: { enabled: true, ...config.agno },
      ...config,
    },
    backendBase: "http://mock-backend",
    modelGate: gate,
    modelGatewayToken,
    fetchImpl,
  });
  return { router, gate };
}

function req(method, url, headers = {}, body) {
  const r = {
    method,
    url,
    headers,
    on: (evt, fn) => {
      if (evt === "aborted") r._aborted = fn;
    },
    off: () => {},
    _aborted: null,
  };
  if (body) {
    r.body = body;
    let yielded = false;
    r[Symbol.asyncIterator] = async function* () {
      if (!yielded) {
        yielded = true;
        yield Buffer.from(JSON.stringify(body));
      }
    };
  }
  return r;
}

function res() {
  let _statusCode = 200;
  let headers = {};
  let body = "";
  let _headersSent = false;
  let _writableEnded = false;
  let jsonData = null;
  const listeners = {};
  const r = {
    status: function(code) { _statusCode = code; return r; },
    json: function(data) {
      _headersSent = true;
      _writableEnded = true;
      body = JSON.stringify(data);
      jsonData = data;
    },
    setHeader: function(k, v) { headers[k] = v; },
    getHeader: function(k) { return headers[k]; },
    flushHeaders: function() {},
    write: function(chunk) { body += chunk.toString(); },
    end: function(chunk) {
      if (chunk) body += chunk.toString();
      _headersSent = true;
      _writableEnded = true;
    },
    on: function(evt, fn) {
      listeners[evt] = listeners[evt] || [];
      listeners[evt].push(fn);
    },
    off: function(evt, fn) {
      const arr = listeners[evt];
      if (arr) {
        const idx = arr.indexOf(fn);
        if (idx !== -1) arr.splice(idx, 1);
      }
    },
    get headersSent() { return _headersSent; },
    set headersSent(v) { _headersSent = v; },
    get writableEnded() { return _writableEnded; },
    set writableEnded(v) { _writableEnded = v; },
    get statusCode() { return _statusCode; },
    set statusCode(v) { _statusCode = v; },
    get _body() { return body; },
    get _json() { return jsonData; },
  };
  return r;
}

describe("createAgnoModelGateway", () => {
  it("rejects missing token", async () => {
    const mock = new MockBackend();
    const { router } = createTestGateway({
      config: { agno: { enabled: true } },
      modelGatewayToken: "test-token-abcdef123456",
      mockBackend: mock,
      fetchImpl: mockFetch(mock),
    });
    const r = res();
    await router.handle(req("GET", "http://internal/v1/models", {}), r);
    assert(r.statusCode === 401);
    assert(r._json.error === "MISSING_GATEWAY_TOKEN");
  });

  it("rejects wrong token", async () => {
    const mock = new MockBackend();
    const { router } = createTestGateway({
      config: { agno: { enabled: true } },
      modelGatewayToken: "test-token-abcdef123456",
      mockBackend: mock,
      fetchImpl: mockFetch(mock),
    });
    const r = res();
    await router.handle(
      req("GET", "http://internal/v1/models", { authorization: "Bearer wrong-token" }),
      r
    );
    assert(r.statusCode === 403);
    assert(r._json.error === "INVALID_GATEWAY_TOKEN");
  });

  it("proxies GET /v1/models", async () => {
    const mock = new MockBackend();
    const { router } = createTestGateway({
      config: { agno: { enabled: true } },
      modelGatewayToken: "test-token-abcdef123456",
      mockBackend: mock,
      fetchImpl: mockFetch(mock),
    });
    const r = res();
    await router.handle(
      req("GET", "http://internal/v1/models", { authorization: "Bearer test-token-abcdef123456" }),
      r
    );
    assert(r.statusCode === 200);
    assert(r._json.data[0].id === "deepseek-v4-flash");
  });

  it("returns AGNO_DISABLED when agno not enabled", async () => {
    const mock = new MockBackend();
    const { router } = createTestGateway({
      config: { agno: { enabled: false } },
      modelGatewayToken: "test-token-abcdef123456",
      mockBackend: mock,
      fetchImpl: mockFetch(mock),
    });
    const r = res();
    await router.handle(
      req("POST", "http://internal/v1/chat/completions", {
        authorization: "Bearer test-token-abcdef123456",
        "content-type": "application/json",
      }),
      r
    );
    assert(r.statusCode === 503);
    assert(r._json.error === "AGNO_DISABLED");
  });

  it("rejects non-JSON content type", async () => {
    const mock = new MockBackend();
    const { router } = createTestGateway({
      config: { agno: { enabled: true } },
      modelGatewayToken: "test-token-abcdef123456",
      mockBackend: mock,
      fetchImpl: mockFetch(mock),
    });
    const r = res();
    await router.handle(
      req("POST", "http://internal/v1/chat/completions", {
        authorization: "Bearer test-token-abcdef123456",
        "content-type": "text/plain",
      }),
      r
    );
    assert(r.statusCode === 415);
  });

  it("forwards non-streaming chat request through gate", async () => {
    const mock = new MockBackend();
    mock.setHandler("/v1/chat/completions", async (method, body) => ({
      status: 200,
      body: { id: "chat-1", choices: [{ message: { content: "hello" } }] },
    }));
    const { router } = createTestGateway({
      config: { agno: { enabled: true } },
      modelGatewayToken: "test-token-abcdef123456",
      mockBackend: mock,
      fetchImpl: mockFetch(mock),
    });
    const r = res();
    await router.handle(
      req("POST", "http://internal/v1/chat/completions", {
        authorization: "Bearer test-token-abcdef123456",
        "content-type": "application/json",
      }, { messages: [{ role: "user", content: "hi" }] }),
      r
    );
    assert(r.statusCode === 200);
    assert(r._json.choices[0].message.content === "hello");
  });

  it("streams SSE chat request through gate", async () => {
    const chunks = [
      'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n',
      'data: [DONE]\n\n',
    ];
    const { router, gate } = createTestGateway({
      config: { agno: { enabled: true } },
      modelGatewayToken: "test-token-abcdef123456",
      mockBackend: null,
      fetchImpl: mockStreamingBackend(chunks, 10),
    });
    const r = res();
    await router.handle(
      req("POST", "http://internal/v1/chat/completions", {
        authorization: "Bearer test-token-abcdef123456",
        "content-type": "application/json",
      }, { stream: true, messages: [{ role: "user", content: "hi" }] }),
      r
    );
    // Wait for stream pump to finish
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert(r.statusCode === 200);
    assert(r._body.includes("Hello"), `body: ${r._body}`);
    assert(gate.status().inflight === 0);
  });

  it("rejects unknown routes with 404", async () => {
    const mock = new MockBackend();
    const { router } = createTestGateway({
      config: { agno: { enabled: true } },
      modelGatewayToken: "test-token-abcdef123456",
      mockBackend: mock,
      fetchImpl: mockFetch(mock),
    });
    const r = res();
    await router.handle(
      req("GET", "http://internal/v1/usage", { authorization: "Bearer test-token-abcdef123456" }),
      r
    );
    assert(r.statusCode === 404);
  });

  it("releases gate lease after streaming completes", async () => {
    const chunks = ['data: [DONE]\n\n'];
    const { router, gate } = createTestGateway({
      config: { agno: { enabled: true } },
      modelGatewayToken: "test-token-abcdef123456",
      fetchImpl: mockStreamingBackend(chunks, 5),
    });
    const r = res();
    await router.handle(
      req("POST", "http://internal/v1/chat/completions", {
        authorization: "Bearer test-token-abcdef123456",
        "content-type": "application/json",
        body: { stream: true, messages: [{ role: "user", content: "hi" }] },
      }),
      r
    );
    assert(gate.status().inflight === 0);
  });

  it("handles 409 busy with retry", async () => {
    let attempt = 0;
    const busyFn = async () => {
      attempt++;
      if (attempt <= 2) {
        return {
          status: 409,
          ok: false,
          json: async () => ({ error: "conflict", message: "wrapper is busy" }),
          text: async () => JSON.stringify({ error: "conflict", message: "wrapper is busy" }),
          clone: () => ({
            json: async () => ({ error: "conflict", message: "wrapper is busy" }),
            text: async () => JSON.stringify({ error: "conflict", message: "wrapper is busy" }),
          }),
          body: null,
        };
      }
      return {
        status: 200,
        ok: true,
        json: async () => ({ id: "chat-1", choices: [{ message: { content: "ok" } }] }),
        text: async () => "ok",
        clone: () => ({
          json: async () => ({ id: "chat-1", choices: [{ message: { content: "ok" } }] }),
          text: async () => "ok",
        }),
        body: null,
      };
    };
    const { router } = createTestGateway({
      config: { agno: { enabled: true } },
      modelGatewayToken: "test-token-abcdef123456",
      fetchImpl: busyFn,
    });
    const r = res();
    await router.handle(
      req("POST", "http://internal/v1/chat/completions", {
        authorization: "Bearer test-token-abcdef123456",
        "content-type": "application/json",
      }, { messages: [{ role: "user", content: "hi" }] }),
      r
    );
    assert(r.statusCode === 200);
    assert(r._json.choices[0].message.content === "ok");
    assert(attempt === 3, "should retry twice then succeed");
  });
});
