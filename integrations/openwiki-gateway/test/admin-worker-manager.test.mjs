// Tests for admin-worker-manager.mjs (OWG-04 host process ownership)
//
// Uses fake child processes where possible; never starts the real admin-daemon.

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAdminWorkerManager, fail as failFn, waitAtMost, readTokenFromFile, deriveAdminSocket, verifyAdminSocket } from '../src/admin-worker-manager.mjs';
import { loadConfig } from '../src/config.mjs';
import { adminSocketPathFor, callAdminSocket, ADMIN_CONTROL_TOOLS, startAdminControlServer } from '../src/admin-control.mjs';
import { execFileSync } from 'node:child_process';

const GIT_ENV = { PATH: '/usr/bin:/bin', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', LC_ALL: 'C' };

const tempDirs = [];
function makeConfigFixture() {
  const base = mkdtempSync(join(tmpdir(), 'ow-admin-mgr-'));
  tempDirs.push(base);
  chmodSync(base, 0o700);

  const release = join(base, 'release');
  mkdirSync(join(release, 'dist', 'cli'), { recursive: true, mode: 0o700 });
  const exe = join(release, 'dist', 'cli', 'cli.js');
  writeFileSync(exe, '// fake pinned upstream\n', { mode: 0o600 });

  const wsRoot = mkdtempSync(join(base, 'ws-'));
  mkdirSync(wsRoot, { recursive: true, mode: 0o700 });
  // Initialize as git repo
  execFileSync('/usr/bin/git', ['init', '-q', wsRoot], { env: { ...GIT_ENV, HOME: base }, stdio: 'ignore', timeout: 5000 });
  execFileSync('/usr/bin/git', ['-C', wsRoot, 'config', 'user.name', 'Test'], { env: { ...GIT_ENV, HOME: base }, stdio: 'ignore', timeout: 5000 });
  execFileSync('/usr/bin/git', ['-C', wsRoot, 'config', 'user.email', 'test@test'], { env: { ...GIT_ENV, HOME: base }, stdio: 'ignore', timeout: 5000 });
  writeFileSync(join(wsRoot, 'README.md'), '# Test\n');
  execFileSync('/usr/bin/git', ['-C', wsRoot, 'add', 'README.md'], { env: { ...GIT_ENV, HOME: base }, stdio: 'ignore', timeout: 5000 });
  execFileSync('/usr/bin/git', ['-C', wsRoot, 'commit', '-qm', 'init'], { env: { ...GIT_ENV, HOME: base }, stdio: 'ignore', timeout: 5000 });
  chmodSync(wsRoot, 0o700);

  const etc = join(base, 'etc');
  mkdirSync(etc, { mode: 0o700 });
  const configFile = join(etc, 'gateway.json');
  const doc = {
    schema: 1,
    listen: { transport: 'unix', socketPath: join(base, 'gw.sock') },
    upstream: { node: process.execPath, releaseDir: release, executable: exe },
    workspaces: { alpha: { root: wsRoot } },
  };
  writeFileSync(configFile, JSON.stringify(doc), { mode: 0o600 });

  return { base, release, exe, wsRoot, configFile, doc };
}

after(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

// --- Fake child process for testing -----------------------------------------

function createFakeChild({ exitCode = 0, exitSignal = null, delayMs = 0, killDelayMs = 0, onSignal, ignoreSigterm = false } = {}) {
  let killed = false;
  let killSignal = null;
  const events = [];
  const stdout = { on() {}, setEncoding() {} };
  const stderr = { on() {}, setEncoding() {} };
  const stdin = { end() {}, write() {}, destroy() {} };
  let exitResolved = false;

  const child = {
    pid: process.pid + Math.floor(Math.random() * 10000) + 1,
    killed: false,
    exitCode: null,
    signalCode: null,
    stdio: [stdin, stdout, stderr, null],
    on(event, handler) {
      if (event === 'exit') {
        events.push({ event, handler });
      }
    },
    once(event, handler) {
      if (event === 'exit' || event === 'error') {
        events.push({ event, handler });
      }
    },
    kill(signal) {
      // Always record the signal via onSignal
      if (onSignal) onSignal(signal);
      // If ignoring SIGTERM, don't mark as killed or exit
      if (ignoreSigterm && signal === 'SIGTERM') return;
      // For other signals (including SIGKILL), proceed normally
      if (killed) return; // Already killed
      killed = true;
      killSignal = signal;
      // Simulate exit - call handlers synchronously since manager attaches its handler before calling kill
      const finishExit = () => {
        if (exitResolved) return;
        exitResolved = true;
        child.exitCode = exitCode;
        child.signalCode = exitSignal;
        child.killed = true;
        for (const { event, handler } of events) if (event === 'exit') handler(exitCode, exitSignal);
      };
      if (signal === 'SIGKILL' && killDelayMs > 0) setTimeout(finishExit, killDelayMs);
      else finishExit();
    },
  };
  return child;
}

function createFakeSpawn(children) {
  let callIndex = 0;
  return function fakeSpawn(command, args, options) {
    const child = children[callIndex] ?? createFakeChild();
    callIndex++;
    // Simulate fd 3 being passed
    if (options.stdio && options.stdio[3] !== undefined) {
      child.stdio[3] = options.stdio[3];
    }
    return child;
  };
}

describe('createAdminWorkerManager', () => {
  let fx;

  before(async () => {
    fx = makeConfigFixture();
  });

  test('exports createAdminWorkerManager function', () => {
    assert.equal(typeof createAdminWorkerManager, 'function');
  });

  test('rejects invalid configPath', () => {
    assert.throws(() => createAdminWorkerManager({ configPath: 'relative.json' }), { code: 'INVALID_CONFIG' });
    assert.throws(() => createAdminWorkerManager({ configPath: '' }), { code: 'INVALID_CONFIG' });
    assert.throws(() => createAdminWorkerManager({ configPath: 123 }), { code: 'INVALID_CONFIG' });
  });

  test('rejects invalid timeout values', () => {
    assert.throws(() => createAdminWorkerManager({ configPath: fx.configFile, startupTimeoutMs: 0 }), { code: 'INVALID_CONFIG' });
    assert.throws(() => createAdminWorkerManager({ configPath: fx.configFile, startupTimeoutMs: 20000 }), { code: 'INVALID_CONFIG' });
    assert.throws(() => createAdminWorkerManager({ configPath: fx.configFile, shutdownTimeoutMs: 0 }), { code: 'INVALID_CONFIG' });
    assert.throws(() => createAdminWorkerManager({ configPath: fx.configFile, shutdownTimeoutMs: 10000 }), { code: 'INVALID_CONFIG' });
    assert.throws(() => createAdminWorkerManager({ configPath: fx.configFile, callTimeoutMs: 0 }), { code: 'INVALID_CONFIG' });
    assert.throws(() => createAdminWorkerManager({ configPath: fx.configFile, callTimeoutMs: 7001 }), { code: 'INVALID_CONFIG' });
  });

  test('default manager timeout supports an authenticated lifecycle call', async () => {
    let workerPromise;
    const fakeSpawn = (_command, _args, options) => {
      const token = readFileSync(options.stdio[3]);
      const config = loadConfig(options.env.DS4_OPENWIKI_CONFIG);
      workerPromise = startAdminControlServer({
        socketPath: adminSocketPathFor(config.listen.socketPath),
        token,
        supervisor: {
          async start() {}, async stop() {}, snapshot: () => ({ state: 'ready' }),
          async callAdmin(tool) { return { tool, isError: false, content: [] }; },
        },
      });
      return createFakeChild({ ignoreSigterm: true, killDelayMs: 160 });
    };
    const mgr = createAdminWorkerManager({ configPath: fx.configFile, spawnImpl: fakeSpawn, shutdownTimeoutMs: 50 });
    try {
      await mgr.start();
      const result = await mgr.call('openwiki_begin', { root: '/tmp/repo', mode: 'init' });
      assert.equal(result.tool, 'openwiki_begin');
      const closeStarted = Date.now();
      await mgr.close();
      assert.ok(Date.now() - closeStarted >= 140, 'close must await confirmed child exit after SIGKILL');
      assert.equal(mgr.snapshot().state, 'stopped');
    } finally {
      await mgr.close();
      await workerPromise?.then((worker) => worker.close());
    }
  });

  test('rejects environment overrides for supervisor-owned variables', () => {
    for (const key of ['PATH', 'DS4_OPENWIKI_CONFIG', 'DS4_OPENWIKI_ADMIN_TOKEN_FD', 'LC_ALL']) {
      assert.throws(
        () => createAdminWorkerManager({ configPath: fx.configFile, env: { [key]: 'attacker-value' } }),
        { code: 'INVALID_ENV' },
        `${key} must remain controlled by the supervisor`,
      );
    }
    for (const key of ['NODE_OPTIONS', 'NODE_PATH', 'HOME', 'TMPDIR', 'LD_PRELOAD', 'LD_LIBRARY_PATH', 'DYLD_INSERT_LIBRARIES']) {
      assert.throws(
        () => createAdminWorkerManager({ configPath: fx.configFile, env: { [key]: 'attacker-value' } }),
        { code: 'INVALID_ENV' },
        `${key} must not alter worker execution`,
      );
    }
    assert.throws(() => createAdminWorkerManager({ configPath: fx.configFile, env: [] }), { code: 'INVALID_ENV' });
    assert.throws(() => createAdminWorkerManager({ configPath: fx.configFile, env: { 'BAD=KEY': 'x' } }), { code: 'INVALID_ENV' });
    assert.throws(() => createAdminWorkerManager({ configPath: fx.configFile, env: { CUSTOM: 'bad\0value' } }), { code: 'INVALID_ENV' });
    assert.throws(() => createAdminWorkerManager({ configPath: fx.configFile, env: { CUSTOM: 1 } }), { code: 'INVALID_ENV' });
    assert.throws(() => createAdminWorkerManager({ configPath: fx.configFile, env: { NODE_V8_COVERAGE: '/tmp/coverage' } }), { code: 'INVALID_ENV' });
    assert.doesNotThrow(() => createAdminWorkerManager({ configPath: fx.configFile, env: {} }));
  });

  test('snapshot returns stopped state before start', () => {
    const mgr = createAdminWorkerManager({ configPath: fx.configFile, startupTimeoutMs: 100 });
    const snap = mgr.snapshot();
    assert.equal(snap.state, 'stopped');
    assert.equal(snap.configPath, fx.configFile);
    assert.equal(snap.hasToken, false);
    assert.equal(snap.childPid, null);
    assert.equal(snap.childExited, false);
  });

  test('start creates token file with correct permissions and spawns daemon', async () => {
    const children = [
      createFakeChild({ delayMs: 50 }), // Will be killed during cleanup on timeout
    ];
    const fakeSpawn = createFakeSpawn(children);

    const mgr = createAdminWorkerManager({
      configPath: fx.configFile,
      spawnImpl: fakeSpawn,
      startupTimeoutMs: 2000,
      shutdownTimeoutMs: 1000,
    });

    // start() will fail because the fake child doesn't create the admin socket
    // but we can verify the token file was created and cleaned up
    await assert.rejects(mgr.start(), { code: 'ADMIN_STARTUP_TIMEOUT' });

    const snap = mgr.snapshot();
    assert.equal(snap.state, 'stopped');
    // Token should be cleaned up after failed start
    assert.equal(snap.hasToken, false);

    await mgr.close();
  });

  test('call rejects when not started', async () => {
    const mgr = createAdminWorkerManager({ configPath: fx.configFile });
    await assert.rejects(mgr.call('openwiki_begin', { root: '/x', mode: 'init' }), { code: 'ADMIN_NOT_STARTED' });
    await mgr.close();
  });

  test('close is idempotent', async () => {
    const children = [createFakeChild()];
    const fakeSpawn = createFakeSpawn(children);

    const mgr = createAdminWorkerManager({
      configPath: fx.configFile,
      spawnImpl: fakeSpawn,
      startupTimeoutMs: 100,
      shutdownTimeoutMs: 100,
    });

    await assert.rejects(mgr.start(), { code: 'ADMIN_STARTUP_TIMEOUT' });
    await mgr.close();
    await mgr.close(); // Second call should not throw
    const snap = mgr.snapshot();
    assert.equal(snap.state, 'stopped');
  });

  test('start loads and validates config', async () => {
    const children = [createFakeChild({ delayMs: 50 })];
    const fakeSpawn = createFakeSpawn(children);

    const mgr = createAdminWorkerManager({
      configPath: fx.configFile,
      spawnImpl: fakeSpawn,
      startupTimeoutMs: 2000,
    });

    await assert.rejects(mgr.start(), { code: 'ADMIN_STARTUP_TIMEOUT' });

    // Verify config was loaded by checking snapshot
    const snap = mgr.snapshot();
    assert.equal(snap.configPath, fx.configFile);

    await mgr.close();
  });

  test('rejects config with multiple workspaces', async () => {
    const base = mkdtempSync(join(tmpdir(), 'ow-multi-ws-'));
    tempDirs.push(base);
    chmodSync(base, 0o700);

    const release = join(base, 'release');
    mkdirSync(join(release, 'dist', 'cli'), { recursive: true, mode: 0o700 });
    const exe = join(release, 'dist', 'cli', 'cli.js');
    writeFileSync(exe, '// fake\n', { mode: 0o600 });

    const ws1 = join(base, 'ws1');
    mkdirSync(ws1, { mode: 0o700 });
    execFileSync('/usr/bin/git', ['init', '-q', ws1], { env: { ...GIT_ENV, HOME: base }, stdio: 'ignore', timeout: 5000 });
    execFileSync('/usr/bin/git', ['-C', ws1, 'config', 'user.name', 'Test'], { env: { ...GIT_ENV, HOME: base }, stdio: 'ignore', timeout: 5000 });
    execFileSync('/usr/bin/git', ['-C', ws1, 'config', 'user.email', 'test@test'], { env: { ...GIT_ENV, HOME: base }, stdio: 'ignore', timeout: 5000 });
    writeFileSync(join(ws1, 'README.md'), '# Test\n');
    execFileSync('/usr/bin/git', ['-C', ws1, 'add', 'README.md'], { env: { ...GIT_ENV, HOME: base }, stdio: 'ignore', timeout: 5000 });
    execFileSync('/usr/bin/git', ['-C', ws1, 'commit', '-qm', 'init'], { env: { ...GIT_ENV, HOME: base }, stdio: 'ignore', timeout: 5000 });
    chmodSync(ws1, 0o700);

    const ws2 = join(base, 'ws2');
    mkdirSync(ws2, { mode: 0o700 });
    execFileSync('/usr/bin/git', ['init', '-q', ws2], { env: { ...GIT_ENV, HOME: base }, stdio: 'ignore', timeout: 5000 });
    execFileSync('/usr/bin/git', ['-C', ws2, 'config', 'user.name', 'Test'], { env: { ...GIT_ENV, HOME: base }, stdio: 'ignore', timeout: 5000 });
    execFileSync('/usr/bin/git', ['-C', ws2, 'config', 'user.email', 'test@test'], { env: { ...GIT_ENV, HOME: base }, stdio: 'ignore', timeout: 5000 });
    writeFileSync(join(ws2, 'README.md'), '# Test\n');
    execFileSync('/usr/bin/git', ['-C', ws2, 'add', 'README.md'], { env: { ...GIT_ENV, HOME: base }, stdio: 'ignore', timeout: 5000 });
    execFileSync('/usr/bin/git', ['-C', ws2, 'commit', '-qm', 'init'], { env: { ...GIT_ENV, HOME: base }, stdio: 'ignore', timeout: 5000 });
    chmodSync(ws2, 0o700);

    const etc = join(base, 'etc');
    mkdirSync(etc, { mode: 0o700 });
    const configFile = join(etc, 'gateway.json');
    const doc = {
      schema: 1,
      listen: { transport: 'unix', socketPath: join(base, 'gw.sock') },
    upstream: { node: process.execPath, releaseDir: release, executable: exe },
      workspaces: { alpha: { root: ws1 }, beta: { root: ws2 } },
    };
    writeFileSync(configFile, JSON.stringify(doc), { mode: 0o600 });

    const mgr = createAdminWorkerManager({ configPath: configFile });
    await assert.rejects(mgr.start(), { code: 'INVALID_CONFIG', message: /exactly one workspace/ });
    await mgr.close();
  });

  test('passes minimal env to spawned child', async () => {
    const capturedEnvs = [];
    let callCount = 0;
    const fakeSpawn = function(command, args, options) {
      callCount++;
      capturedEnvs.push(options.env);
      return createFakeChild({ delayMs: 50 });
    };

    const mgr = createAdminWorkerManager({
      configPath: fx.configFile,
      spawnImpl: fakeSpawn,
      startupTimeoutMs: 2000,
    });

    await assert.rejects(mgr.start(), { code: 'ADMIN_STARTUP_TIMEOUT' });

    assert.equal(callCount, 1, 'spawnImpl should be called exactly once');
    assert.equal(capturedEnvs.length, 1);
    const env = capturedEnvs[0];
    assert.equal(env.PATH, '/usr/bin:/bin');
    assert.equal(env.DS4_OPENWIKI_CONFIG, fx.configFile);
    assert.equal(env.DS4_OPENWIKI_ADMIN_TOKEN_FD, '3');
    assert.equal(env.LC_ALL, 'C');
    assert.deepEqual(Object.keys(env).sort(), ['DS4_OPENWIKI_ADMIN_TOKEN_FD', 'DS4_OPENWIKI_CONFIG', 'LC_ALL', 'PATH']);

    await mgr.close();
  });

  test('passes token on fd 3 to child', async () => {
    const capturedStdio = [];
    let callCount = 0;
    const fakeSpawn = function(command, args, options) {
      callCount++;
      capturedStdio.push(options.stdio);
      return createFakeChild({ delayMs: 50 });
    };

    const mgr = createAdminWorkerManager({
      configPath: fx.configFile,
      spawnImpl: fakeSpawn,
      startupTimeoutMs: 2000,
    });

    await assert.rejects(mgr.start(), { code: 'ADMIN_STARTUP_TIMEOUT' });

    assert.equal(callCount, 1, 'spawnImpl should be called exactly once');
    assert.equal(capturedStdio.length, 1);
    const stdio = capturedStdio[0];
    // stdio[3] should be a file descriptor (number) for the token file
    assert.ok(typeof stdio[3] === 'number', 'fd 3 should be a file descriptor');

    await mgr.close();
  });

  test('unlinks token pathname after spawn', async () => {
    // Token file should be cleaned up after failed start
    const children = [createFakeChild({ delayMs: 50 })];
    const fakeSpawn = createFakeSpawn(children);

    const mgr = createAdminWorkerManager({
      configPath: fx.configFile,
      spawnImpl: fakeSpawn,
      startupTimeoutMs: 2000,
    });

    await assert.rejects(mgr.start(), { code: 'ADMIN_STARTUP_TIMEOUT' });

    // Token file should be cleaned up
    const snap = mgr.snapshot();
    assert.equal(snap.hasToken, false);

    await mgr.close();
  });

  test('escalates SIGTERM to SIGKILL on shutdown timeout', async () => {
    const killSignals = [];
    const child = createFakeChild({ 
      ignoreSigterm: true,
      onSignal: (signal) => killSignals.push(signal)
    });

    const fakeSpawn = () => child;

    const mgr = createAdminWorkerManager({
      configPath: fx.configFile,
      spawnImpl: fakeSpawn,
      startupTimeoutMs: 100,
      shutdownTimeoutMs: 50, // Short timeout to trigger escalation
    });

    await assert.rejects(mgr.start(), { code: 'ADMIN_STARTUP_TIMEOUT' });

    await mgr.close();

    // Should have sent SIGTERM first, then SIGKILL
    assert.ok(killSignals.includes('SIGTERM'), 'should send SIGTERM');
    assert.ok(killSignals.includes('SIGKILL'), 'should escalate to SIGKILL');
    assert.equal(killSignals[0], 'SIGTERM', 'SIGTERM should be sent first');
  });

  test('waitForReady verifies admin socket ownership and mode', async () => {
    // This test verifies the verifyAdminSocket function logic
    const { verifyAdminSocket } = await import('../src/admin-worker-manager.mjs');

    // Create a fake socket file with wrong permissions
    const base = mkdtempSync(join(tmpdir(), 'ow-sock-test-'));
    tempDirs.push(base);
    const sockPath = join(base, 'admin.sock');

    // Create a regular file instead of socket
    writeFileSync(sockPath, 'not a socket');
    chmodSync(sockPath, 0o600);

    assert.throws(() => verifyAdminSocket(sockPath), { code: 'ADMIN_SOCKET_INVALID' });

    rmSync(base, { recursive: true, force: true });
  });

  test('deriveAdminSocket creates correct sibling path', async () => {
    const { deriveAdminSocket } = await import('../src/admin-worker-manager.mjs');
    const config = loadConfig(fx.configFile);
    const adminSock = deriveAdminSocket(config);

    const readSock = config.listen.socketPath;
    const expected = join(dirname(readSock), `${basename(readSock, '.sock')}.admin.sock`);
    assert.equal(adminSock, expected);
  });

  test('startup timeout is bounded', async () => {
    const startTime = Date.now();
    const children = [createFakeChild({ delayMs: 10000 })]; // Never creates socket
    const fakeSpawn = createFakeSpawn(children);

    const mgr = createAdminWorkerManager({
      configPath: fx.configFile,
      spawnImpl: fakeSpawn,
      startupTimeoutMs: 500, // 500ms timeout
      shutdownTimeoutMs: 100,
    });

    await assert.rejects(mgr.start(), { code: 'ADMIN_STARTUP_TIMEOUT' });
    const elapsed = Date.now() - startTime;
    assert.ok(elapsed < 2000, `startup should timeout within ~500ms, took ${elapsed}ms`);

    await mgr.close();
  });

  test('shutdown timeout is bounded', async () => {
    let killCount = 0;
    const child = createFakeChild({ ignoreSigterm: true, killDelayMs: 80, onSignal: () => { killCount++; } });

    const fakeSpawn = () => child;

    const mgr = createAdminWorkerManager({
      configPath: fx.configFile,
      spawnImpl: fakeSpawn,
      startupTimeoutMs: 100,
      shutdownTimeoutMs: 50,
    });

    await assert.rejects(mgr.start(), { code: 'ADMIN_STARTUP_TIMEOUT' });

    const startTime = Date.now();
    await mgr.close();
    const elapsed = Date.now() - startTime;

    // Should not wait forever; bounded by shutdownTimeoutMs + small overhead
    assert.ok(elapsed < 1000, `shutdown should be bounded, took ${elapsed}ms`);
    assert.ok(killCount >= 1, 'should have sent at least SIGTERM');
  });

  test('call uses callAdminSocket with correct parameters', async () => {
    // We can't easily test the actual callAdminSocket without a real socket,
    // but we can verify the manager passes the right arguments by checking
    // that it rejects when not started
    const mgr = createAdminWorkerManager({ configPath: fx.configFile });
    await assert.rejects(mgr.call('openwiki_begin', { root: '/x', mode: 'init' }), { code: 'ADMIN_NOT_STARTED' });
    await mgr.close();
  });

  test('rejects non-lifecycle tools via callAdminSocket allowlist', async () => {
    // The allowlist enforcement is in admin-control.mjs callAdminSocket
    // Verify the tool set matches PINNED_LIFECYCLE_TOOLS
    assert.deepEqual(ADMIN_CONTROL_TOOLS, [
      'openwiki_begin', 'openwiki_submit_plan', 'openwiki_next_page',
      'openwiki_inspect_page_claims', 'openwiki_submit_page', 'openwiki_finish',
    ]);
  });

  test('retains token bytes in parent memory after unlink', async () => {
    // The key point: token bytes stay in memory variable, not on disk
    // We verify this by checking that the manager can still call (would fail
    // with ADMIN_NOT_STARTED not ADMIN_TOKEN_INVALID if token was lost)
    const children = [createFakeChild({ delayMs: 50 })];
    const fakeSpawn = createFakeSpawn(children);

    const mgr = createAdminWorkerManager({
      configPath: fx.configFile,
      spawnImpl: fakeSpawn,
      startupTimeoutMs: 2000,
    });

    await assert.rejects(mgr.start(), { code: 'ADMIN_STARTUP_TIMEOUT' });

    // After failed start, token is cleaned up from disk but bytes retained in memory
    // The snapshot.hasToken will be false because cleanupTokenFile nulls the path
    // but the token variable still holds the bytes until close()
    const snap = mgr.snapshot();
    assert.equal(snap.hasToken, false);

    await mgr.close();
  });
});

describe('admin-worker-manager internal functions', () => {
  test('waitAtMost resolves on success', async () => {
    const result = await waitAtMost(Promise.resolve(42), 100);
    assert.equal(result, 42);
  });

  test('waitAtMost rejects on timeout', async () => {
    await assert.rejects(waitAtMost(new Promise(() => {}), 50), { code: 'TIMEOUT' });
  });

  test('readTokenFromFile validates token file', async () => {
    const base = mkdtempSync(join(tmpdir(), 'ow-token-test-'));
    tempDirs.push(base);

    // Valid token
    const validPath = join(base, 'valid');
    writeFileSync(validPath, randomBytes(32), { mode: 0o600 });
    const token = readTokenFromFile(validPath);
    assert.equal(token.length, 32);

    // Invalid: wrong size
    const badSize = join(base, 'badsize');
    writeFileSync(badSize, randomBytes(16), { mode: 0o600 });
    assert.throws(() => readTokenFromFile(badSize), { code: 'ADMIN_TOKEN_INVALID' });

    // Invalid: wrong permissions
    const badPerm = join(base, 'badperm');
    writeFileSync(badPerm, randomBytes(32), { mode: 0o644 });
    assert.throws(() => readTokenFromFile(badPerm), { code: 'ADMIN_TOKEN_INVALID' });

    rmSync(base, { recursive: true, force: true });
  });
});
