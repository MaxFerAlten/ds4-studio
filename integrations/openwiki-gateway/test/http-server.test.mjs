import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, stat, readFile, unlink, writeFile, chmod, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';
import net from 'node:net';
import { startGateway } from '../src/index.mjs';
import { McpSupervisorError } from '../src/mcp-supervisor.mjs';

const config = { listen: { transport: 'unix' }, workspaces: { docs: { id: 'docs', root: '/srv/wiki' } } };
function fakeMcp() {
  let isReady = true;
  const calls = [];
  return {
    calls,
    snapshot: () => ({ state: isReady ? 'ready' : 'stopped' }),
    setReady(value) { isReady = value; },
    async start() { isReady = true; },
    async stop() { isReady = false; },
    async callReadOnly(tool, args, options) {
      calls.push({ tool, args, options });
      if (tool === 'openwiki_search') return { structuredContent: { results: [{ kind: 'section', ref: ['Guide#Start'], content: 'Hello' }] } };
      return { structuredContent: { page: 'Guide', sections: [{ section: 'Start', content: 'Hello' }] } };
    },
  };
}
function request(socketPath, { method = 'GET', path = '/health/live', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ socketPath, method, path, headers }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    if (body !== undefined) req.end(body); else req.end();
  });
}
async function fixture(t, { allowCloseError = false } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'openwiki-http-'));
  const socketPath = join(dir, 'gateway.sock');
  const mcp = fakeMcp();
  const app = await startGateway({ config: { ...config, listen: { transport: 'unix', socketPath } }, mcp });
  t.after(async () => {
    if (allowCloseError) await app.close().catch(() => {});
    else await app.close();
    await rm(dir, { recursive: true, force: true });
  });
  return { socketPath, mcp, app };
}
function postHeaders(body) {
  return { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body), 'x-ds4-ow-protocol': '1' };
}

test('UDS is 0600; liveness and readiness are separate and content-free', async (t) => {
  const { socketPath, mcp } = await fixture(t);
  assert.equal((await stat(socketPath)).mode & 0o777, 0o600);
  assert.deepEqual(JSON.parse((await request(socketPath)).body), { status: 'live', protocol: 1 });
  mcp.setReady(false);
  assert.equal((await request(socketPath, { path: '/health/ready' })).status, 503);
  assert.equal((await request(socketPath)).status, 200);
});

test('search/read route only to the configured workspace and return fixed-length text', async (t) => {
  const { socketPath, mcp } = await fixture(t);
  const search = JSON.stringify({ protocol: 'ds4-openwiki.v1', workspaceId: 'docs', query: 'start' });
  const found = await request(socketPath, { method: 'POST', path: '/v1/wiki/search', headers: { ...postHeaders(search), 'x-request-id': 'req-123' }, body: search });
  assert.equal(found.status, 200);
  assert.equal(Number(found.headers['content-length']), Buffer.byteLength(found.body));
  assert.equal(found.headers['x-ds4-ow-protocol'], '1');
  assert.equal(found.headers['x-ds4-ow-request-id'], 'req-123');
  assert.match(found.body, /Guide#Start/u);
  const read = JSON.stringify({ protocol: 'ds4-openwiki.v1', workspaceId: 'docs', page: 'Guide', sections: ['Start'] });
  assert.equal((await request(socketPath, { method: 'POST', path: '/v1/wiki/read', headers: postHeaders(read), body: read })).status, 200);
  assert.equal(mcp.calls.length, 2);
  assert.equal(mcp.calls[0].args.root, '/srv/wiki');
  assert.equal(Object.hasOwn(mcp.calls[0].args, 'socketPath'), false);
  assert.equal(Object.hasOwn(mcp.calls[0].args, 'workspaceId'), false);
});

test('invalid framing, UTF-8, media type, protocol, and unknown route never reach MCP', async (t) => {
  const { socketPath, mcp } = await fixture(t);
  const valid = JSON.stringify({ protocol: 'ds4-openwiki.v1', workspaceId: 'docs', query: 'x' });
  const base = { method: 'POST', path: '/v1/wiki/search', body: valid };
  assert.equal((await request(socketPath, { ...base, headers: { ...postHeaders(valid), 'content-type': 'text/plain' } })).status, 415);
  assert.equal((await request(socketPath, { ...base, headers: { ...postHeaders(valid), 'x-ds4-ow-protocol': '2' } })).status, 400);
  const invalidUtf8 = Buffer.from([0xff]);
  const badUtf8 = await request(socketPath, { ...base, headers: { 'content-type': 'application/json', 'content-length': 1, 'x-ds4-ow-protocol': '1' }, body: invalidUtf8 });
  assert.equal(badUtf8.status, 400);
  assert.equal((await request(socketPath, { method: 'POST', path: '/v1/wiki/admin', headers: postHeaders(valid), body: valid })).status, 404);
  assert.equal(mcp.calls.length, 0);
});

test('body limit and workspace allowlist reject before MCP; close is idempotent', async (t) => {
  const { socketPath, mcp, app } = await fixture(t);
  const oversized = Buffer.alloc(8 * 1024 + 1, 0x20);
  const tooBig = await request(socketPath, { method: 'POST', path: '/v1/wiki/search', headers: { 'content-type': 'application/json', 'content-length': oversized.length, 'x-ds4-ow-protocol': '1' }, body: oversized });
  assert.equal(tooBig.status, 413);
  const unknown = JSON.stringify({ protocol: 'ds4-openwiki.v1', workspaceId: 'other', query: 'x' });
  const denied = await request(socketPath, { method: 'POST', path: '/v1/wiki/search', headers: postHeaders(unknown), body: unknown });
  assert.equal(denied.status, 403);
  assert.deepEqual(JSON.parse(denied.body), { error: 'WORKSPACE_DENIED' });
  assert.equal(mcp.calls.length, 0);
  assert.equal(app.telemetry.snapshot().rejected, 2);
  assert.equal(app.telemetry.snapshot().upstreamFailure, 0);
  await app.close(); await app.close();
});

test('malformed bytes on the Unix socket are rejected before reaching MCP', async (t) => {
  const { socketPath, mcp } = await fixture(t);
  const response = await new Promise((resolve, reject) => {
    const chunks = [];
    const socket = net.createConnection(socketPath);
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error('malformed socket request did not close within 2 seconds'));
    }, 2_000);
    socket.once('connect', () => socket.write('GET / HTTP/1.1\r\nBroken Header\r\n\r\n'));
    socket.on('data', (chunk) => chunks.push(chunk));
    socket.once('close', () => {
      clearTimeout(timer);
      resolve(Buffer.concat(chunks).toString('utf8'));
    });
    socket.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
  assert.match(response, /^HTTP\/1\.1 400\b/u);
  assert.equal(mcp.calls.length, 0);
});

test('startup refuses a corrupted socket pathname without deleting it', async (t) => {
  const { socketPath, app } = await fixture(t);
  await app.close();
  await writeFile(socketPath, 'preserve this non-socket file', { mode: 0o600 });
  const mcp = fakeMcp();
  await assert.rejects(
    startGateway({ config: { ...config, listen: { transport: 'unix', socketPath } }, mcp }),
    /unsafe existing socket path/u,
  );
  assert.equal(await readFile(socketPath, 'utf8'), 'preserve this non-socket file');
  assert.equal(mcp.snapshot().state, 'stopped');
});

test('shutdown preserves a replacement path created after the listener starts', async (t) => {
  const { socketPath, app, mcp } = await fixture(t);
  await unlink(socketPath);
  await writeFile(socketPath, 'replacement created during shutdown race', { mode: 0o600 });
  await app.close();
  assert.equal(await readFile(socketPath, 'utf8'), 'replacement created during shutdown race');
  assert.equal(mcp.snapshot().state, 'stopped');
});

test('shutdown still stops MCP when a replacement socket path cannot be quarantined', async (t) => {
  const { socketPath, app, mcp } = await fixture(t, { allowCloseError: true });
  const dir = socketPath.slice(0, socketPath.lastIndexOf('/'));
  const backupPath = `${socketPath}.preserve`;
  await unlink(socketPath);
  await writeFile(socketPath, 'replacement', { mode: 0o600 });
  try {
    await chmod(dir, 0o500);
    await assert.rejects(app.close());
    assert.equal(mcp.snapshot().state, 'stopped');
    assert.equal(app.server.listening, true, 'unsafe pathname failure must not close through Node/libuv unlink');
    assert.equal(await readFile(socketPath, 'utf8'), 'replacement');
  } finally {
    await chmod(dir, 0o700);
    await rename(socketPath, backupPath);
    await new Promise((resolve) => app.server.close(resolve));
    await rename(backupPath, socketPath);
  }
});

test('upstream stderr details never enter the HTTP response', async (t) => {
  const { socketPath, mcp } = await fixture(t);
  const sentinel = 'sk-ds4-wp18-response-sentinel';
  mcp.callReadOnly = async () => {
    throw new McpSupervisorError('UPSTREAM_EXIT', 'upstream failed', { stderrTail: sentinel });
  };
  const body = JSON.stringify({ protocol: 'ds4-openwiki.v1', workspaceId: 'docs', query: 'x' });
  const response = await request(socketPath, {
    method: 'POST', path: '/v1/wiki/search', headers: postHeaders(body), body,
  });
  assert.equal(response.status, 502);
  assert.equal(response.body, JSON.stringify({ error: 'UPSTREAM_ERROR' }));
  assert.equal(response.body.includes(sentinel), false);
});
