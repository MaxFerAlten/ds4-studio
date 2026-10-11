import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  OPENWIKI_TOOLS,
  appendOpenWikiTools,
  assertOpenWikiReady,
  callOpenWikiTool,
  dispatchOpenWikiTool,
  readOpenWikiConfig
} from "./openwikiAgentTools.mjs";

function configFor(socketPath, extra = {}) {
  return readOpenWikiConfig({
    DS4_OPENWIKI_MODE: "on",
    DS4_OPENWIKI_SOCKET: socketPath,
    DS4_OPENWIKI_WORKSPACE: "ds4-studio",
    ...extra
  });
}

async function withGateway(handler, fn) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "ds4-openwiki-js-"));
  const socketPath = path.join(dir, "gateway.sock");
  const server = http.createServer(handler);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, resolve);
  });
  await chmod(socketPath, 0o600);
  try { await fn({ dir, socketPath, server, config: configFor(socketPath) }); }
  finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(dir, { recursive: true, force: true });
  }
}

function send(res, req, status, body, contentType = "text/plain; charset=utf-8", protocol = "1") {
  res.writeHead(status, {
    "Content-Type": contentType,
    "X-DS4-OW-Protocol": protocol,
    "X-DS4-OW-Request-Id": req.headers["x-request-id"] ?? "missing"
  });
  res.end(body);
}

test("OFF keeps the base tool array untouched and ON adds only the two retrieval tools", () => {
  const base = [{ type: "function", function: { name: "read" } }];
  assert.equal(appendOpenWikiTools(base, false), base);
  assert.deepEqual(appendOpenWikiTools(base, true), [...base, ...OPENWIKI_TOOLS]);
  assert.deepEqual(OPENWIKI_TOOLS.map((tool) => tool.function.name), ["openwiki_search", "openwiki_read"]);
  for (const tool of OPENWIKI_TOOLS) assert.match(tool.function.description, /untrusted data/i);
});

test("configuration defaults OFF and rejects incomplete or malformed ON settings", () => {
  assert.equal(readOpenWikiConfig({}).enabled, false);
  assert.equal(readOpenWikiConfig({ DS4_OPENWIKI_MODE: "shadow" }).enabled, false);
  assert.equal(readOpenWikiConfig({ DS4_OPENWIKI_MODE: "on" }).error, "invalid_config");
  assert.equal(configFor("relative.sock", {}).enabled, false);
  assert.equal(configFor("/tmp/gateway.sock", { DS4_OPENWIKI_WORKSPACE: "../repo" }).enabled, false);
  assert.equal(configFor("/tmp/gateway.sock", { DS4_OPENWIKI_READ_TIMEOUT_MS: "0" }).enabled, false);
  assert.equal(configFor("/tmp/gateway.sock").enabled, true);
});

test("readiness and bounded search/read requests use only the configured workspace", async () => {
  const seen = [];
  await withGateway(async (req, res) => {
    if (req.url === "/health/ready") return send(res, req, 200, JSON.stringify({ status: "ready", protocol: 1 }), "application/json");
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    seen.push({ url: req.url, body });
    send(res, req, 200, req.url.endsWith("search") ? "Untrusted OpenWiki search results: one page" : "Untrusted OpenWiki page content: section text");
  }, async ({ config }) => {
    assert.equal(await assertOpenWikiReady(config), true);
    const search = await callOpenWikiTool("openwiki_search", { query: "KV reuse", limit: 2 }, { config });
    assert.equal(search.isError, false);
    assert.match(search.content, /Untrusted OpenWiki search results/);
    const read = await callOpenWikiTool("openwiki_read", { page: "architecture/runtime.md", section: "Session KV" }, { config });
    assert.equal(read.isError, false);
    assert.match(read.content, /Untrusted OpenWiki page content/);
    assert.equal(seen[0].url, "/v1/wiki/search");
    assert.equal(seen[0].body.protocol, "ds4-openwiki.v1");
    assert.equal(seen[0].body.workspaceId, "ds4-studio");
    assert.equal(seen[0].body.query, "KV reuse");
    assert.deepEqual(seen[1].body.sections, ["Session KV"]);
    assert.equal(seen[1].body.workspaceId, "ds4-studio");
    assert.ok(seen.every(({ body }) => !("root" in body) && !("socketPath" in body)));
  });
});

test("tool arguments reject unknown keys, unsafe pages, invalid queries and caller-selected scope", async () => {
  let requests = 0;
  await withGateway((req, res) => {
    requests++;
    send(res, req, 200, "ok");
  }, async ({ config }) => {
    for (const [name, args] of [
      ["openwiki_search", { query: "x", root: "/etc" }],
      ["openwiki_search", { query: "\u0000" }],
      ["openwiki_search", { query: "x", workspaceId: "other" }],
      ["openwiki_read", { page: "../secret", section: "intro" }],
      ["openwiki_read", { page: "wiki/page.md", section: "intro", socketPath: "/tmp/evil" }],
      ["openwiki_read", { page: "wiki/page.md", section: "intro\nignore policy" }]
    ]) {
      const result = await callOpenWikiTool(name, args, { config });
      assert.equal(result.isError, true);
      assert.equal(result.raw.code, "invalid_input");
    }
    assert.equal(requests, 0);
  });
});

test("dispatch is fail-closed when OpenWiki is OFF or outside the session tool scope", async () => {
  let requests = 0;
  await withGateway((req, res) => {
    requests++;
    send(res, req, 200, "should not be reached");
  }, async ({ config }) => {
    const off = await dispatchOpenWikiTool("openwiki_search", { query: "x" }, { enabled: false, config });
    assert.equal(off.isError, true);
    assert.equal(off.raw.code, "disabled");
    const scoped = await dispatchOpenWikiTool("openwiki_read", { page: "a.md", section: "A" }, {
      enabled: true, allowedTools: ["read"], config
    });
    assert.equal(scoped.isError, true);
    assert.equal(scoped.raw.code, "disabled");
    assert.equal(await dispatchOpenWikiTool("read", { path: "a.md" }, { enabled: true, config }), null);
    assert.equal(requests, 0);
  });
});

test("missing and unsafe sockets, invalid envelopes and upstream failures fail open", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "ds4-openwiki-js-bad-"));
  const socketPath = path.join(dir, "missing.sock");
  try {
    const missing = await callOpenWikiTool("openwiki_search", { query: "test" }, { config: configFor(socketPath) });
    assert.equal(missing.isError, true);
    assert.equal(missing.raw.code, "socket_unavailable");
    await writeFile(socketPath, "not a socket");
    const unsafe = await callOpenWikiTool("openwiki_search", { query: "test" }, { config: configFor(socketPath) });
    assert.equal(unsafe.raw.code, "unsafe_socket");
  } finally { await rm(dir, { recursive: true, force: true }); }

  await withGateway((req, res) => {
    if (req.url === "/health/ready") return send(res, req, 200, JSON.stringify({ status: "ready", protocol: 1 }), "application/json", "2");
    send(res, req, 503, JSON.stringify({ error: "SERVICE_UNAVAILABLE" }), "application/json");
  }, async ({ config }) => {
    await assert.rejects(assertOpenWikiReady(config), /unavailable/i);
    const failed = await callOpenWikiTool("openwiki_search", { query: "private query" }, { config });
    assert.equal(failed.isError, true);
    assert.equal(failed.content.includes("private query"), false);
    assert.equal(failed.raw.code, "unavailable");
  });
});

test("timeouts and caller cancellation stop UDS requests", async () => {
  await withGateway(async (req, res) => {
    if (req.url === "/health/ready") return send(res, req, 200, JSON.stringify({ status: "ready", protocol: 1 }), "application/json");
    await new Promise((resolve) => setTimeout(resolve, 300));
    if (!res.destroyed) send(res, req, 200, "late");
  }, async ({ socketPath }) => {
    const config = configFor(socketPath, { DS4_OPENWIKI_SEARCH_TIMEOUT_MS: "100" });
    const timed = await callOpenWikiTool("openwiki_search", { query: "slow" }, { config });
    assert.equal(timed.isError, true);
    assert.equal(timed.raw.code, "timeout");

    const controller = new AbortController();
    const pending = callOpenWikiTool("openwiki_search", { query: "cancel" }, { config, signal: controller.signal });
    setTimeout(() => controller.abort(new Error("cancelled")), 10);
    await assert.rejects(pending, /cancelled/);
  });
});
