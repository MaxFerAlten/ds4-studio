import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { lstatSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { connect } from 'node:net';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  ADMIN_CONTROL_TOOLS,
  adminSocketPathFor,
  callAdminSocket,
  pingAdminSocket,
  startAdminControlServer,
} from '../src/admin-control.mjs';

const tempDirs = [];
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'ow-admin-control-'));
  tempDirs.push(dir);
  const token = randomBytes(32);
  const calls = [];
  const events = [];
  const supervisor = {
    state: 'stopped',
    async start() { events.push('start'); this.state = 'ready'; },
    async stop() { events.push('stop'); this.state = 'stopped'; },
    snapshot() { return { state: this.state }; },
    async callAdmin(tool, args, { signal } = {}) {
      assert.equal(signal?.aborted, false);
      calls.push({ tool, args });
      return { generation: 1, tool, isError: false, content: [{ type: 'text', text: 'ok' }] };
    },
  };
  return { dir, token, calls, events, supervisor, socketPath: join(dir, 'wiki.admin.sock') };
}

after(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

test('ADMIN control is a separate authenticated Unix socket with only lifecycle calls', async () => {
  const fx = fixture();
  const originalUmask = process.umask();
  const worker = await startAdminControlServer({
    socketPath: fx.socketPath,
    token: fx.token,
    supervisor: fx.supervisor,
  });
  try {
    assert.deepEqual(fx.events, ['start']);
    const socketStat = lstatSync(fx.socketPath);
    assert.equal(socketStat.isSocket(), true);
    assert.equal(socketStat.mode & 0o777, 0o600);
    assert.equal(process.umask(), originalUmask, 'ADMIN socket setup must restore the process umask');
    const readSocketPath = join(fx.dir, 'wiki.sock');
    assert.equal(adminSocketPathFor(readSocketPath), fx.socketPath);
    assert.notEqual(readSocketPath, fx.socketPath);
    assert.deepEqual(ADMIN_CONTROL_TOOLS, [
      'openwiki_begin', 'openwiki_submit_plan', 'openwiki_next_page',
      'openwiki_inspect_page_claims', 'openwiki_submit_page', 'openwiki_finish',
    ]);

    const response = await callAdminSocket({
      socketPath: fx.socketPath,
      token: fx.token,
      tool: 'openwiki_begin',
      args: { root: '/tmp/repo', mode: 'init' },
    });
    assert.equal(response.tool, 'openwiki_begin');
    assert.deepEqual(fx.calls, [{ tool: 'openwiki_begin', args: { root: '/tmp/repo', mode: 'init' } }]);
    assert.deepEqual(await pingAdminSocket({ socketPath: fx.socketPath, token: fx.token }), { state: 'ready' });
    assert.equal(fx.calls.length, 1, 'health probe must not dispatch a lifecycle tool');
  } finally {
    await worker.close();
  }
  assert.deepEqual(fx.events, ['start', 'stop']);
  assert.throws(() => lstatSync(fx.socketPath), { code: 'ENOENT' });
});

test('ADMIN plan boundary normalizes legacy text instructions without changing other fields', async () => {
  const fx = fixture();
  const worker = await startAdminControlServer({ socketPath: fx.socketPath, token: fx.token, supervisor: fx.supervisor });
  try {
    const pages = [
      { path: '/openwiki/quickstart.md', instructions: 'Use source evidence', seedPaths: ['README.md'] },
      { path: '/openwiki/design.md', instructions: ['Keep this array'] },
      { path: '/openwiki/testing.md' },
    ];
    await callAdminSocket({ socketPath: fx.socketPath, token: fx.token,
      tool: 'openwiki_submit_plan', args: { runId: 'run-1', pages } });
    assert.deepEqual(fx.calls[0].args, { runId: 'run-1', pages: [
      { path: '/openwiki/quickstart.md', instructions: ['Use source evidence'], seedPaths: ['README.md'] },
      pages[1], pages[2],
    ] });
    assert.equal(pages[0].instructions, 'Use source evidence', 'caller payload remains unchanged');
  } finally { await worker.close(); }
});

test('ADMIN health probe authenticates the worker token', async () => {
  const fx = fixture();
  const worker = await startAdminControlServer({ socketPath: fx.socketPath, token: fx.token, supervisor: fx.supervisor });
  try {
    await assert.rejects(pingAdminSocket({ socketPath: fx.socketPath, token: randomBytes(32) }), { code: 'ADMIN_UNAUTHORIZED' });
    assert.deepEqual(fx.calls, []);
  } finally {
    await worker.close();
  }
});

test('ADMIN socket rejects bad token and non-lifecycle tools without dispatch', async () => {
  const fx = fixture();
  const worker = await startAdminControlServer({
    socketPath: fx.socketPath,
    token: fx.token,
    supervisor: fx.supervisor,
  });
  try {
    await assert.rejects(callAdminSocket({
      socketPath: fx.socketPath,
      token: randomBytes(32),
      tool: 'openwiki_begin',
      args: { root: '/tmp/repo', mode: 'init' },
    }), { code: 'ADMIN_UNAUTHORIZED' });
    await assert.rejects(callAdminSocket({
      socketPath: fx.socketPath,
      token: fx.token,
      tool: 'openwiki_read',
      args: { root: '/tmp/repo', page: 'openwiki/index.md' },
    }), { code: 'ADMIN_INVALID_REQUEST' });
    assert.deepEqual(fx.calls, []);
  } finally {
    await worker.close();
  }
});

test('ADMIN client settles when a connected worker closes before answering', async () => {
  const fx = fixture();
  let entered;
  const callEntered = new Promise((resolve) => { entered = resolve; });
  fx.supervisor.callAdmin = () => {
    entered();
    return new Promise(() => {});
  };
  const worker = await startAdminControlServer({
    socketPath: fx.socketPath,
    token: fx.token,
    supervisor: fx.supervisor,
  });
  const request = callAdminSocket({
    socketPath: fx.socketPath,
    token: fx.token,
    tool: 'openwiki_begin',
    args: { root: '/tmp/repo', mode: 'init' },
  });
  try {
    await callEntered;
    await worker.close();
    await assert.rejects(request, (error) => ['ADMIN_NO_RESPONSE', 'ECONNRESET'].includes(error.code));
  } finally {
    await worker.close().catch(() => {});
  }
});

test('ADMIN client propagates caller cancellation to the worker', async () => {
  const fx = fixture();
  let callSignal;
  let entered;
  const callEntered = new Promise((resolve) => { entered = resolve; });
  let resolveAborted;
  const signalAborted = new Promise((resolve) => { resolveAborted = resolve; });
  fx.supervisor.callAdmin = (_tool, _args, { signal }) => {
    callSignal = signal;
    signal.addEventListener('abort', resolveAborted, { once: true });
    entered();
    return new Promise((resolve) => signal.addEventListener('abort', () => resolve({}), { once: true }));
  };
  const worker = await startAdminControlServer({ socketPath: fx.socketPath, token: fx.token, supervisor: fx.supervisor });
  const abort = new AbortController();
  const request = callAdminSocket({
    socketPath: fx.socketPath, token: fx.token, tool: 'openwiki_begin',
    args: { root: '/tmp/repo', mode: 'init' },
  }, { signal: abort.signal });
  try {
    await callEntered;
    abort.abort();
    await assert.rejects(request, { code: 'ABORT_ERR' });
    await Promise.race([
      signalAborted,
      new Promise((_, reject) => setTimeout(() => reject(new Error('worker did not receive abort')), 1000)),
    ]);
    assert.equal(callSignal?.aborted, true);
  } finally {
    await worker.close();
  }
});

test('ADMIN server error shuts down the worker without an uncaught exception', async () => {
  const fx = fixture();
  const worker = await startAdminControlServer({
    socketPath: fx.socketPath,
    token: fx.token,
    supervisor: fx.supervisor,
  });
  const closed = new Promise((resolve) => worker.server.once('close', resolve));
  worker.server.emit('error', Object.assign(new Error('synthetic server fault'), { code: 'EIO' }));
  await closed;
  await worker.close();
  assert.deepEqual(fx.events, ['start', 'stop']);
  assert.throws(() => lstatSync(fx.socketPath), { code: 'ENOENT' });
});

test('ADMIN worker handles a reset client and enforces an absolute deadline', async () => {
  const fx = fixture();
  const worker = await startAdminControlServer({
    socketPath: fx.socketPath,
    token: fx.token,
    supervisor: fx.supervisor,
    connectionTimeoutMs: 100,
    idleTimeoutMs: 50,
  });
  try {
    const raw = connect({ path: fx.socketPath });
    raw.on('error', () => {});
    await once(raw, 'connect');
    const rawClosed = new Promise((resolve) => raw.once('close', resolve));
    raw.destroy(new Error('test client reset'));
    await rawClosed;
    assert.equal((await callAdminSocket({
      socketPath: fx.socketPath,
      token: fx.token,
      tool: 'openwiki_begin',
      args: { root: '/tmp/repo', mode: 'init' },
    })).tool, 'openwiki_begin');

    const slow = connect({ path: fx.socketPath });
    slow.on('error', () => {});
    await once(slow, 'connect');
    slow.write('{');
    const slowClosed = new Promise((resolve) => slow.once('close', resolve));
    const trickle = setInterval(() => { if (!slow.destroyed) slow.write(' '); }, 10);
    const started = Date.now();
    try { await slowClosed; }
    finally { clearInterval(trickle); }
    assert.ok(Date.now() - started < 1_000, 'absolute connection deadline must defeat a trickling client');
  } finally {
    await worker.close();
  }
});

test('ADMIN idle timeout stops after dispatch while lifecycle call is running', async () => {
  const fx = fixture();
  fx.supervisor.callAdmin = async (tool) => {
    await new Promise((resolve) => setTimeout(resolve, 100));
    return { generation: 1, tool, isError: false, content: [{ type: 'text', text: 'slow ok' }] };
  };
  const worker = await startAdminControlServer({
    socketPath: fx.socketPath,
    token: fx.token,
    supervisor: fx.supervisor,
    idleTimeoutMs: 25,
  });
  try {
    const response = await callAdminSocket({
      socketPath: fx.socketPath,
      token: fx.token,
      tool: 'openwiki_begin',
      args: { root: '/tmp/repo', mode: 'init' },
    });
    assert.equal(response.content[0].text, 'slow ok');
  } finally {
    await worker.close();
  }
});

test('ADMIN absolute deadline aborts a dispatched lifecycle call', async () => {
  const fx = fixture();
  let callSignal;
  let signalAborted;
  fx.supervisor.callAdmin = (_tool, _args, { signal }) => {
    callSignal = signal;
    signalAborted = new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true }));
    return new Promise((resolve) => {
      signal.addEventListener('abort', () => resolve({}), { once: true });
    });
  };
  const worker = await startAdminControlServer({
    socketPath: fx.socketPath,
    token: fx.token,
    supervisor: fx.supervisor,
    connectionTimeoutMs: 100,
    idleTimeoutMs: 25,
  });
  try {
    await assert.rejects(callAdminSocket({
      socketPath: fx.socketPath,
      token: fx.token,
      tool: 'openwiki_begin',
      args: { root: '/tmp/repo', mode: 'init' },
    }), (error) => ['ADMIN_NO_RESPONSE', 'ECONNRESET'].includes(error.code));
    await signalAborted;
    assert.equal(callSignal?.aborted, true);
  } finally {
    await worker.close();
  }
});

test('ADMIN socket requires a ready supervisor, a protected directory, and a bounded token', async () => {
  const fx = fixture();
  const notReady = { ...fx.supervisor, snapshot: () => ({ state: 'stopped' }), async stop() {} };
  await assert.rejects(startAdminControlServer({
    socketPath: fx.socketPath,
    token: fx.token,
    supervisor: notReady,
  }), { code: 'NOT_READY' });
  await assert.rejects(startAdminControlServer({
    socketPath: fx.socketPath,
    token: Buffer.alloc(8),
    supervisor: fx.supervisor,
  }), { code: 'ADMIN_AUTH_CONFIG' });
});

test('ADMIN daemon rejects a pipe token descriptor instead of blocking during startup', async () => {
  const entry = fileURLToPath(new URL('../src/admin-daemon.mjs', import.meta.url));
  const child = spawn(process.execPath, [entry], {
    env: { PATH: process.env.PATH ?? '/usr/bin:/bin', DS4_OPENWIKI_ADMIN_TOKEN_FD: '3' },
    stdio: ['ignore', 'ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const guard = setTimeout(() => child.kill('SIGKILL'), 4_000);
  try {
    const [code, signal] = await once(child, 'exit');
    assert.equal(signal, null);
    assert.equal(code, 1);
    assert.match(stderr, /startup failed \(ADMIN_AUTH_CONFIG\)/);
  } finally {
    clearTimeout(guard);
    child.stdio[3]?.destroy();
    if (child.exitCode === null) child.kill('SIGKILL');
  }
});
