// WP04b MCP supervisor. Runs the fake MCP server (test/fixtures) as the real
// child: SDK Client + StdioClientTransport -> bubblewrap -> node, inside a
// private temp release/workspace/config. No network, no real OpenWiki/DS4.
// Like WP03, these tests FAIL (do not skip) when bubblewrap cannot run.
//
// The only waits are the fake's bounded responses (hang/slow), shortened call
// and handshake deadlines, and a <=1s poll of /proc proving the sandboxed
// process tree is gone after a kill.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import net from 'node:net';
import { LATEST_PROTOCOL_VERSION } from '@modelcontextprotocol/sdk/types.js';
import { BREAKER_STATES, CircuitBreaker, CircuitBreakerError, OUTCOMES } from '../src/circuit-breaker.mjs';
import { ConfigError, loadConfig } from '../src/config.mjs';
import {
  McpSupervisor,
  McpSupervisorError,
  PINNED_LIFECYCLE_TOOLS,
  READ_ONLY_TOOLS,
  canonicalJson,
  computeSchemaFingerprint,
} from '../src/mcp-supervisor.mjs';
import { toolsForMode } from './fixtures/fake-mcp-server.mjs';

const GIT_ENV = { PATH: '/usr/bin:/bin', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', LC_ALL: 'C' };
const FAKE_SERVER = fileURLToPath(new URL('./fixtures/fake-mcp-server.mjs', import.meta.url));
const CERTIFIED_FINGERPRINT = computeSchemaFingerprint(toolsForMode('normal'));
const SANDBOX_ENV_KEYS = new Set(['HOME', 'LANG', 'LC_ALL', 'OPENWIKI_CONFIG_DIR', 'PATH', 'PWD', 'TMPDIR']);
const HANG_TEST = { timeout: 5_000 };
const TEST = { timeout: 10_000 };

const bases = [];
const supervisors = [];
after(async () => {
  await Promise.all(supervisors.map((s) => s.stop({ drain: false }).catch(() => {})));
  for (const base of bases) rmSync(base, { recursive: true, force: true });
});

function initRepo(dir) {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  execFileSync('/usr/bin/git', ['init', '-q', dir], { env: { ...GIT_ENV, HOME: dir }, stdio: 'ignore', timeout: 5000 });
  chmodSync(dir, 0o700);
  return dir;
}

// Temp release whose pinned executable is the fake server named `<mode>.mjs`.
// `patchSource` rewrites the copied fake before it is hashed and pinned.
function writeRelease(release, mode, patchSource) {
  mkdirSync(join(release, 'dist', 'cli'), { recursive: true, mode: 0o700 });
  const exe = join(release, 'dist', 'cli', `${mode}.mjs`);
  if (patchSource) writeFileSync(exe, patchSource(readFileSync(FAKE_SERVER, 'utf8')), { mode: 0o600 });
  else copyFileSync(FAKE_SERVER, exe);
  chmodSync(exe, 0o600);
  return exe;
}

// `releasePath` is relative to the fixture base; `extraWorkspaces` adds
// allowlisted (never selected) workspaces ws-<id>; `hostHome` gives loadConfig
// a temp user home instead of the real one.
function makeFixture(mode = 'normal', { patchSource, releasePath = 'release', extraWorkspaces = [], hostHome = false } = {}) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'ow-wp04b-')));
  bases.push(base);
  chmodSync(base, 0o700);
  const release = join(base, releasePath);
  const exe = writeRelease(release, mode, patchSource);
  const root = initRepo(join(base, 'ws-alpha'));
  const workspaces = { alpha: { root } };
  for (const id of extraWorkspaces) workspaces[id] = { root: initRepo(join(base, `ws-${id}`)) };
  const home = hostHome ? join(base, 'host-home') : null;
  if (home !== null) mkdirSync(home, { mode: 0o700 });
  const etc = join(base, 'etc');
  mkdirSync(etc, { mode: 0o700 });
  const file = join(etc, 'gateway.json');
  writeFileSync(
    file,
    JSON.stringify({
      schema: 1,
      listen: { transport: 'unix', socketPath: join(base, 'gw.sock') },
      upstream: {
        node: process.execPath,
        releaseDir: release,
        executable: exe,
      },
      workspaces,
    }),
    { mode: 0o600 },
  );
  chmodSync(file, 0o600);
  const config = loadConfig(file, home === null ? {} : { userHome: home });
  return { base, root, release, exe, hostHome: home, config };
}

function certifiedOptions(fx) {
  return {
    config: fx.config,
    workspaceId: 'alpha',
    manifest: { certified: true, protocolVersion: LATEST_PROTOCOL_VERSION, schemaFingerprint: CERTIFIED_FINGERPRINT },
    expectedProtocolVersion: LATEST_PROTOCOL_VERSION,
    expectedSchemaFingerprint: CERTIFIED_FINGERPRINT,
    handshakeTimeoutMs: 4_000,
  };
}

function makeSupervisor(fx, overrides = {}) {
  const supervisor = new McpSupervisor({ ...certifiedOptions(fx), ...overrides });
  supervisors.push(supervisor);
  return supervisor;
}

const code = (expected) => (err) => {
  assert.ok(err instanceof McpSupervisorError || err instanceof CircuitBreakerError, err?.stack);
  assert.equal(err.code, expected, err.stack);
  return true;
};

// PIDs whose command line mentions the fixture (bwrap and the sandboxed node).
function processesUsing(marker) {
  const pids = [];
  for (const entry of readdirSync('/proc')) {
    if (!/^\d+$/.test(entry) || Number(entry) === process.pid) continue;
    let cmdline;
    try {
      cmdline = readFileSync(`/proc/${entry}/cmdline`, 'utf8');
    } catch {
      continue;
    }
    if (cmdline.includes(marker)) pids.push(Number(entry));
  }
  return pids;
}

async function assertChildGone(fx) {
  const deadline = Date.now() + 1_000;
  while (processesUsing(fx.base).length > 0 && Date.now() < deadline) await delay(20);
  assert.deepEqual(processesUsing(fx.base), [], 'sandboxed child must not survive');
}

// Polls `predicate` until true, failing after timeoutMs (process state only).
async function waitUntil(predicate, what, timeoutMs = 500) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    assert.ok(Date.now() < deadline, `timed out after ${timeoutMs}ms waiting for ${what}`);
    await delay(10);
  }
}

async function search(supervisor, query, options) {
  const res = await supervisor.callReadOnly('openwiki_search', { query }, options);
  assert.equal(res.isError, false);
  return JSON.parse(res.content[0].text);
}

// --- fingerprint ----------------------------------------------------------------

test('canonical JSON sorts keys recursively and rejects non-JSON values', TEST, () => {
  assert.equal(
    canonicalJson({ b: 1, a: { d: [2, { z: 1, y: 2 }], c: null, u: undefined } }),
    '{"a":{"c":null,"d":[2,{"y":2,"z":1}]},"b":1}',
  );
  assert.throws(() => canonicalJson({ a: Number.NaN }), TypeError);
  assert.throws(() => canonicalJson({ a: 1n }), TypeError);
  const cyclic = {};
  cyclic.self = cyclic;
  assert.throws(() => canonicalJson(cyclic), TypeError);
});

test('schema fingerprint is stable over tool and key order, sensitive to schema drift', TEST, () => {
  const tools = toolsForMode('normal');
  const reordered = [...tools].reverse().map((tool) => Object.fromEntries(Object.entries(tool).reverse()));
  assert.match(CERTIFIED_FINGERPRINT, /^[0-9a-f]{64}$/);
  assert.equal(computeSchemaFingerprint(reordered), CERTIFIED_FINGERPRINT);
  const sorted = [...tools].sort((a, b) => (a.name < b.name ? -1 : 1));
  assert.equal(CERTIFIED_FINGERPRINT, createHash('sha256').update(canonicalJson(sorted)).digest('hex'));
  assert.notEqual(computeSchemaFingerprint(toolsForMode('schema-drift')), CERTIFIED_FINGERPRINT);
  assert.notEqual(computeSchemaFingerprint(toolsForMode('missing-required-tool')), CERTIFIED_FINGERPRINT);
  assert.throws(() => computeSchemaFingerprint([tools[0], tools[0]]), /duplicate/);
  assert.throws(() => computeSchemaFingerprint([{ description: 'no name' }]), TypeError);
});

// --- construction and certification -----------------------------------------------

test('constructor requires certified expectations and an allowlisted workspace', TEST, () => {
  const fx = makeFixture();
  const base = certifiedOptions(fx);
  assert.throws(() => new McpSupervisor({ ...base, expectedProtocolVersion: undefined }), /expectedProtocolVersion/);
  assert.throws(() => new McpSupervisor({ ...base, expectedSchemaFingerprint: null }), /expectedSchemaFingerprint/);
  assert.throws(() => new McpSupervisor({ ...base, expectedSchemaFingerprint: 'A'.repeat(64) }), /64 lowercase hex/);
  assert.throws(() => new McpSupervisor({ ...base, workspaceId: 'beta' }), ConfigError);
  assert.throws(() => new McpSupervisor({ ...base, shell: true }), /unknown supervisor option/);
  assert.throws(() => new McpSupervisor({ ...base, callTimeoutsMs: { search: 5_000 } }), /callTimeoutsMs.search/);
  assert.throws(() => new McpSupervisor({ ...base, handshakeTimeoutMs: 60_000 }), /handshakeTimeoutMs/);
});

test('missing, uncertified or mismatched manifest refuses to start without spawning', TEST, async () => {
  const fx = makeFixture();
  const cases = [
    [null, 'NOT_CERTIFIED'],
    [{ certified: false, protocolVersion: LATEST_PROTOCOL_VERSION, schemaFingerprint: CERTIFIED_FINGERPRINT }, 'NOT_CERTIFIED'],
    [{ certified: true, protocolVersion: '2024-11-05', schemaFingerprint: CERTIFIED_FINGERPRINT }, 'MANIFEST_MISMATCH'],
    [{ certified: true, protocolVersion: LATEST_PROTOCOL_VERSION, schemaFingerprint: '0'.repeat(64) }, 'MANIFEST_MISMATCH'],
  ];
  for (const [manifest, expected] of cases) {
    const supervisor = makeSupervisor(fx, { manifest });
    await assert.rejects(supervisor.start(), code(expected));
    const snap = supervisor.snapshot();
    assert.equal(snap.state, 'stopped');
    assert.equal(snap.generation, 0, 'no child was spawned');
    assert.equal(snap.lastError, expected);
  }
  assert.deepEqual(processesUsing(fx.base), []);
});

// --- handshake ----------------------------------------------------------------------

test('handshake reaches ready with the certified protocol and tool surface', TEST, async () => {
  const fx = makeFixture();
  const supervisor = makeSupervisor(fx);
  assert.equal(supervisor.snapshot().state, 'stopped');
  const [a, b] = await Promise.all([supervisor.start(), supervisor.start()]);
  assert.deepEqual(a, b, 'concurrent start() shares one attempt');
  const snap = supervisor.snapshot();
  assert.equal(snap.state, 'ready');
  assert.equal(snap.generation, 1);
  assert.equal(snap.protocolVersion, LATEST_PROTOCOL_VERSION);
  assert.equal(snap.schemaFingerprint, CERTIFIED_FINGERPRINT);
  assert.deepEqual(snap.tools, toolsForMode('normal').map((t) => t.name).sort());
  assert.equal(snap.lastError, null);
  assert.equal((await supervisor.start()).generation, 1, 'start() while ready is a no-op');

  assert.deepEqual(await supervisor.healthCheck(), { ok: true, generation: 1, toolCount: snap.tools.length });
  const res = await search(supervisor, 'architecture');
  assert.equal(res.ok, true);
  assert.equal(res.query, 'architecture');
  assert.equal(res.observed.cwd, fx.root, 'child runs in the selected workspace root');

  const stopped = await supervisor.stop();
  assert.equal(stopped.state, 'stopped');
  assert.equal(stopped.generation, 2);
  assert.deepEqual(stopped.tools, []);
  assert.equal((await supervisor.stop()).generation, 2, 'stop() is idempotent');
  await assertChildGone(fx);
  await assert.rejects(supervisor.callReadOnly('openwiki_search', { query: 'x' }), code('NOT_READY'));
});

test('pinned MCP command arguments reach the sandbox child unchanged', TEST, async () => {
  const fx = makeFixture();
  const commandArgs = ['mcp', '--host', 'ds4-studio'];
  const supervisor = makeSupervisor(fx, { commandArgs });
  await supervisor.start();
  const res = await search(supervisor, 'command-args');
  assert.deepEqual(res.observed.args, commandArgs);
  await supervisor.stop();
  await assertChildGone(fx);
});

for (const [name, mode, overrides, expected] of [
  ['protocol version mismatch', 'normal', 'old-protocol', 'PROTOCOL_MISMATCH'],
  ['missing required tool', 'missing-required-tool', null, 'MISSING_TOOL'],
  ['schema fingerprint drift', 'schema-drift', null, 'SCHEMA_MISMATCH'],
  ['stdout noise', 'stdout-noise', null, 'PROTOCOL_ERROR'],
]) {
  test(`startup fails closed on ${name} and kills the child`, TEST, async () => {
    const fx = makeFixture(mode);
    const extra =
      overrides === 'old-protocol'
        ? {
            expectedProtocolVersion: '2024-11-05',
            manifest: { certified: true, protocolVersion: '2024-11-05', schemaFingerprint: CERTIFIED_FINGERPRINT },
          }
        : {};
    const supervisor = makeSupervisor(fx, extra);
    await assert.rejects(supervisor.start(), code(expected));
    const snap = supervisor.snapshot();
    assert.equal(snap.state, 'stopped');
    assert.equal(snap.generation, 2, 'one start + one retire');
    assert.equal(snap.lastError, expected);
    assert.deepEqual(snap.tools, []);
    await assertChildGone(fx);
  });
}

test('handshake that never answers times out and leaves no child', HANG_TEST, async () => {
  const fx = makeFixture('handshake-hang');
  const supervisor = makeSupervisor(fx, { handshakeTimeoutMs: 500 });
  const started = Date.now();
  await assert.rejects(supervisor.start(), code('HANDSHAKE_TIMEOUT'));
  assert.ok(Date.now() - started < 2_500, 'absolute handshake deadline, child ignored stdin EOF');
  assert.equal(supervisor.snapshot().state, 'stopped');
  await assertChildGone(fx);
});

test('stop() during a hanging handshake aborts startup and kills the child', HANG_TEST, async () => {
  const fx = makeFixture('handshake-hang');
  const supervisor = makeSupervisor(fx);
  const starting = supervisor.start();
  assert.equal(supervisor.snapshot().state, 'starting');
  await supervisor.stop();
  await assert.rejects(starting, code('STOPPED'));
  assert.equal(supervisor.snapshot().state, 'stopped');
  await assertChildGone(fx);
});

// --- environment ------------------------------------------------------------------

// Pinned copy of the fake that also reports the child's PWD value.
function exposePwd(source) {
  const anchor = '    cwd: process.cwd(),\n';
  assert.ok(source.includes(anchor), 'fake server observed() anchor not found');
  return source.replace(anchor, `${anchor}    pwd: process.env.PWD ?? null,\n`);
}

test('provider and cloud secrets in the gateway environment never reach the child', TEST, async () => {
  const fx = makeFixture('normal', { patchSource: exposePwd });
  const seeded = { OPENAI_API_KEY: 'sk-test-wp04b', ANTHROPIC_API_KEY: 'x', AWS_SECRET_ACCESS_KEY: 'y' };
  const previous = Object.fromEntries(Object.keys(seeded).map((k) => [k, process.env[k]]));
  Object.assign(process.env, seeded);
  try {
    const supervisor = makeSupervisor(fx);
    await supervisor.start();
    const { observed } = await search(supervisor, 'env');
    assert.equal(observed.sawOpenAiKey, false, 'OPENAI_API_KEY must be scrubbed');
    for (const key of observed.envKeys) assert.ok(SANDBOX_ENV_KEYS.has(key), `unexpected child env ${key}`);
    // bwrap keeps PWD through --clearenv and resets it to the --chdir target.
    assert.ok(observed.envKeys.includes('PWD'), 'child sees PWD');
    assert.equal(observed.pwd, fx.root, 'PWD is the authorized workspace root, not a host path');
    assert.equal(observed.cwd, fx.root);
    await supervisor.stop();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('sandboxed child cannot connect to a host loopback endpoint', TEST, async () => {
  let hostConnections = 0;
  const hostServer = net.createServer((socket) => { hostConnections += 1; socket.destroy(); });
  await new Promise((resolve, reject) => {
    hostServer.once('error', reject);
    hostServer.listen(0, '127.0.0.1', resolve);
  });
  const port = hostServer.address().port;
  const fx = makeFixture();
  const supervisor = makeSupervisor(fx);
  try {
    await supervisor.start();
    const { egress } = await search(supervisor, `egress-probe:127.0.0.1:${port}`);
    assert.ok(['ECONNREFUSED', 'ENETUNREACH', 'EHOSTUNREACH', 'TIMEOUT'].includes(egress), `unexpected egress result: ${egress}`);
    assert.equal(hostConnections, 0, 'the host TCP listener must not receive the sandboxed connection');
  } finally {
    await supervisor.stop().catch(() => {});
    await new Promise((resolve) => hostServer.close(resolve));
  }
  await assertChildGone(fx);
});

test('sandboxed MCP child cannot signal a host process', TEST, async () => {
  const victim = spawn(process.execPath, [
    '-e',
    "process.on('SIGTERM', () => process.exit(0)); process.stdout.write('ready'); setInterval(() => {}, 1000)",
  ], { stdio: ['ignore', 'pipe', 'ignore'] });
  const victimClosed = new Promise((resolve) => victim.once('close', resolve));
  await new Promise((resolve, reject) => {
    victim.once('error', reject);
    victim.stdout.once('data', resolve);
  });

  const fx = makeFixture();
  const supervisor = makeSupervisor(fx);
  try {
    await supervisor.start();
    const { signalAttempt } = await search(supervisor, `takeover-probe:${victim.pid}`);
    assert.ok(['ESRCH', 'EPERM'].includes(signalAttempt), `host signal attempt result: ${signalAttempt}`);
    await delay(50);
    assert.equal(victim.exitCode, null, 'the protected host victim remains alive');
    assert.equal(victim.signalCode, null, 'the protected host victim receives no signal');
  } finally {
    await supervisor.stop().catch(() => {});
    if (victim.exitCode === null && victim.signalCode === null) {
      victim.kill('SIGKILL');
    }
    await victimClosed;
  }
  await assertChildGone(fx);
});

test('sandboxed MCP child cannot take over a host process through procfs then signals', TEST, async () => {
  const fx = makeFixture();
  const supervisor = makeSupervisor(fx);
  let victim;
  let victimClosed = Promise.resolve();
  try {
    victim = spawn(process.execPath, [
      '-e',
      "process.on('SIGTERM', () => process.exit(0)); process.stdout.write('ready'); setInterval(() => {}, 1000)",
    ], { stdio: ['ignore', 'pipe', 'ignore'] });
    victimClosed = new Promise((resolve) => victim.once('close', resolve));
    await new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        victim.stdout.off('data', onReady);
        victim.off('error', onError);
        victim.off('close', onClose);
        if (error) reject(error);
        else resolve();
      };
      const onReady = () => finish();
      const onError = (error) => finish(error);
      const onClose = (code, signal) => finish(new Error(`victim exited before readiness (code=${code}, signal=${signal})`));
      const timer = setTimeout(() => finish(new Error('victim readiness timed out after 1000 ms')), 1000);
      victim.stdout.once('data', onReady);
      victim.once('error', onError);
      victim.once('close', onClose);
    });
    await supervisor.start();
    const { processPaths, signalAttempt } = await search(supervisor, `takeover-chain:${victim.pid}`);
    for (const [entry, access] of Object.entries(processPaths)) {
      assert.equal(access.accessible, false, `host /proc/${victim.pid}/${entry} must not be readable`);
      assert.ok(['ENOENT', 'EACCES', 'EPERM'].includes(access.code), `${entry}: ${access.code}`);
    }
    assert.ok(['ESRCH', 'EPERM'].includes(signalAttempt), `host signal attempt result: ${signalAttempt}`);
    await delay(50);
    assert.equal(victim.exitCode, null, 'the protected host victim remains alive');
    assert.equal(victim.signalCode, null, 'the protected host victim receives no signal');
  } finally {
    await supervisor.stop().catch(() => {});
    if (victim && victim.exitCode === null && victim.signalCode === null) victim.kill('SIGKILL');
    await victimClosed;
  }
  await assertChildGone(fx);
});

test('child diagnostics stay byte-bounded and secret-like stderr is absent from snapshots', TEST, async () => {
  const sentinel = 'sk-ds4-wp18-log-sentinel';
  const anchor = '  if (mode === \'handshake-hang\') pin();\n';
  const patchSource = (source) => {
    assert.ok(source.includes(anchor), 'fake server diagnostic anchor not found');
    return source.replace(anchor, `  process.stderr.write(${JSON.stringify(`${sentinel}${'x'.repeat(64 * 1024)}`)});\n${anchor}`);
  };
  const fx = makeFixture('normal', { patchSource });
  const supervisor = makeSupervisor(fx, { stderrMaxBytes: 1024 });
  await supervisor.start();
  try {
    await waitUntil(() => supervisor.snapshot().stderr.droppedBytes > 0, 'stderr ring buffer to discard old bytes');
    const stderr = supervisor.snapshot().stderr;
    assert.equal(stderr.retainedBytes, 1024);
    assert.equal(stderr.retainedBytes + stderr.droppedBytes, Buffer.byteLength(sentinel) + 64 * 1024);
    assert.equal(JSON.stringify(supervisor.snapshot()).includes(sentinel), false);
  } finally {
    await supervisor.stop();
  }
  await assertChildGone(fx);
});

test('RLIMIT_NPROC denies a bounded fork burst and the sandbox reaps every child', TEST, async () => {
  // The fake lowers only its own RLIMIT_NPROC, then is hard-capped at 32 tiny
  // sleep children and kills them immediately after EAGAIN.
  const fx = makeFixture();
  const supervisor = makeSupervisor(fx);
  try {
    await supervisor.start();
    const { attempted, denial } = await search(supervisor, 'fork-probe:32');
    assert.equal(denial, 'EAGAIN', `expected OS process-limit denial, got ${denial} after ${attempted} children`);
    assert.ok(attempted < 32, `RLIMIT_NPROC must stop the 32-child bounded burst; started ${attempted}`);
  } finally {
    await supervisor.stop().catch(() => {});
  }
  await assertChildGone(fx);
});

// --- read-only surface ----------------------------------------------------------------

test('only read-only tools are forwarded; everything else is rejected before MCP', TEST, async () => {
  assert.deepEqual(PINNED_LIFECYCLE_TOOLS, [
    'openwiki_begin',
    'openwiki_submit_plan',
    'openwiki_next_page',
    'openwiki_inspect_page_claims',
    'openwiki_submit_page',
    'openwiki_finish',
  ]);
  assert.equal(PINNED_LIFECYCLE_TOOLS.some((name) => READ_ONLY_TOOLS.includes(name)), false);
  const fx = makeFixture('lifecycle-tools');
  const lifecycleFingerprint = computeSchemaFingerprint(toolsForMode('lifecycle-tools'));
  const supervisor = makeSupervisor(fx, {
    expectedSchemaFingerprint: lifecycleFingerprint,
    manifest: {
      certified: true,
      protocolVersion: LATEST_PROTOCOL_VERSION,
      schemaFingerprint: lifecycleFingerprint,
    },
  });
  await supervisor.start();
  assert.equal(supervisor.snapshot().tools.filter((name) => PINNED_LIFECYCLE_TOOLS.includes(name)).length, 6);
  // The six pinned OWG-04 lifecycle tools (real names) must be rejected locally.
  const pinnedLifecycle = PINNED_LIFECYCLE_TOOLS;
  for (const name of pinnedLifecycle) {
    await assert.rejects(supervisor.callReadOnly(name, {}), code('TOOL_NOT_ALLOWED'), name);
  }
  // Other non-allowlisted names are also rejected.
  const forbidden = [
    'openwiki_delete_page',
    'OPENWIKI_SEARCH',
    '__proto__',
    'constructor',
    '',
    42,
  ];
  for (const name of forbidden) {
    await assert.rejects(supervisor.callReadOnly(name, {}), code('TOOL_NOT_ALLOWED'), String(name));
  }
  for (const args of [[1], 'query', new Map(), { a: 1n }, { q: 'x'.repeat(70 * 1024) }]) {
    await assert.rejects(supervisor.callReadOnly('openwiki_search', args), code('INVALID_ARGUMENTS'));
  }
  await assert.rejects(supervisor.callReadOnly('openwiki_list_wikis', {}), code('TOOL_UNAVAILABLE'));

  const listed = await supervisor.callReadOnly('openwiki_list_workspaces', {});
  assert.equal(listed.isError, false);
  const read = await supervisor.callReadOnly('openwiki_read', { path: 'docs/a.md' });
  assert.deepEqual(JSON.parse(read.content[0].text), { ok: true, path: 'docs/a.md' });

  const { observed } = await search(supervisor, 'stats');
  // Verify no pinned lifecycle tool call reached the child.
  for (const name of pinnedLifecycle) {
    assert.ok(!observed.calledTools.includes(name), `pinned tool ${name} must not reach MCP`);
  }
  assert.deepEqual(observed.calledTools, ['openwiki_list_workspaces', 'openwiki_read', 'openwiki_search']);
  assert.equal(supervisor.snapshot().breaker.consecutiveFailures, 0, 'local rejections never touch the breaker');
  await supervisor.stop();
});

test('tool-level content errors settle CONTENT and keep the child', TEST, async () => {
  const fx = makeFixture();
  const supervisor = makeSupervisor(fx);
  await supervisor.start();
  const res = await supervisor.callReadOnly('openwiki_search', { query: 'content-error' });
  assert.equal(res.isError, true);
  const snap = supervisor.snapshot();
  assert.equal(snap.state, 'ready');
  assert.equal(snap.breaker.state, BREAKER_STATES.CLOSED);
  assert.equal(snap.breaker.consecutiveFailures, 0);
  await supervisor.stop();
});

// --- single flight, deadlines, generations ----------------------------------------------

test('at most one upstream request is in flight', TEST, async () => {
  const fx = makeFixture();
  const supervisor = makeSupervisor(fx);
  await supervisor.start();
  const slow = supervisor.callReadOnly('openwiki_search', { query: 'slow' });
  assert.equal(supervisor.snapshot().inFlight, 'openwiki_search');
  await assert.rejects(supervisor.callReadOnly('openwiki_search', { query: 'second' }), code('UPSTREAM_BUSY'));
  await assert.rejects(supervisor.healthCheck(), code('UPSTREAM_BUSY'));
  assert.equal((await slow).isError, false);
  assert.equal(supervisor.snapshot().inFlight, null);
  const { observed } = await search(supervisor, 'stats');
  assert.equal(observed.toolCalls, 2, 'the rejected request never reached the child');
  await supervisor.stop();
});

test('a call that ignores cancellation hits its deadline and the child is killed', HANG_TEST, async () => {
  const fx = makeFixture();
  const supervisor = makeSupervisor(fx, { callTimeoutsMs: { search: 400 } });
  await supervisor.start();
  const started = Date.now();
  await assert.rejects(supervisor.callReadOnly('openwiki_search', { query: 'hang' }), code('DEADLINE_EXCEEDED'));
  assert.ok(Date.now() - started < 2_500, 'absolute call deadline');
  const snap = supervisor.snapshot();
  assert.equal(snap.state, 'stopped');
  assert.equal(snap.generation, 2);
  assert.equal(snap.lastError, 'DEADLINE_EXCEEDED');
  assert.equal(snap.breaker.consecutiveFailures, 1, 'timeout is an infrastructure failure');
  assert.equal(snap.inFlight, null);
  await assertChildGone(fx);

  // No automatic retry or restart; an explicit start() gets a new generation.
  await supervisor.start();
  assert.equal(supervisor.snapshot().generation, 3);
  assert.equal((await search(supervisor, 'after')).ok, true);
  await supervisor.stop();
});

test('caller abort cancels the call and kills the child', HANG_TEST, async () => {
  const fx = makeFixture();
  const supervisor = makeSupervisor(fx);
  await supervisor.start();
  await assert.rejects(
    supervisor.callReadOnly('openwiki_search', { query: 'x' }, { signal: AbortSignal.abort() }),
    code('ABORTED'),
  );
  assert.equal(supervisor.snapshot().state, 'ready', 'pre-aborted signal never reaches upstream');

  const controller = new AbortController();
  const call = supervisor.callReadOnly('openwiki_search', { query: 'hang' }, { signal: controller.signal });
  controller.abort();
  await assert.rejects(call, code('ABORTED'));
  const snap = supervisor.snapshot();
  assert.equal(snap.state, 'stopped');
  assert.equal(snap.breaker.consecutiveFailures, 0, 'caller abort is neutral for the breaker');
  await assertChildGone(fx);
});

test('a result from a retired child generation is rejected', TEST, async () => {
  const fx = makeFixture();
  const supervisor = makeSupervisor(fx);
  await supervisor.start();
  const call = supervisor.callReadOnly('openwiki_search', { query: 'slow' });
  const stopping = supervisor.stop({ drain: false });
  await assert.rejects(call, code('STALE_GENERATION'));
  assert.equal((await stopping).generation, 2);
  await assertChildGone(fx);
});

test('stop() drains the in-flight call before closing the child', TEST, async () => {
  const fx = makeFixture();
  const supervisor = makeSupervisor(fx);
  await supervisor.start();
  const call = supervisor.callReadOnly('openwiki_search', { query: 'slow' });
  const stopping = supervisor.stop();
  await assert.rejects(supervisor.callReadOnly('openwiki_search', { query: 'late' }), code('NOT_READY'));
  assert.equal((await call).isError, false);
  assert.equal((await stopping).state, 'stopped');
  await assertChildGone(fx);
});

// --- circuit breaker integration -------------------------------------------------------

test('HALF_OPEN admits only the healthCheck probe, which uses tools/list', TEST, async () => {
  const fx = makeFixture();
  const clock = { t: 0 };
  const breaker = new CircuitBreaker({ now: () => clock.t, failureThreshold: 1, openMs: 1_000, maxOpenMs: 4_000 });
  const supervisor = makeSupervisor(fx, { breaker });
  await supervisor.start();

  breaker.acquire().settle(OUTCOMES.INFRASTRUCTURE);
  assert.equal(breaker.state, BREAKER_STATES.OPEN);
  await assert.rejects(supervisor.callReadOnly('openwiki_search', { query: 'x' }), code('CIRCUIT_OPEN'));
  await assert.rejects(supervisor.healthCheck(), code('CIRCUIT_OPEN'));

  clock.t = 1_000;
  assert.equal(breaker.state, BREAKER_STATES.HALF_OPEN);
  await assert.rejects(supervisor.callReadOnly('openwiki_search', { query: 'x' }), code('PROBE_REQUIRED'));
  assert.deepEqual(await supervisor.healthCheck(), { ok: true, generation: 1, toolCount: 6 });
  assert.equal(breaker.state, BREAKER_STATES.CLOSED);

  const { observed } = await search(supervisor, 'stats');
  assert.equal(observed.listCalls, 2, 'handshake + probe were tools/list');
  assert.deepEqual(observed.calledTools, ['openwiki_search'], 'no query was used as a probe');

  // An abandoned probe re-opens the breaker with backoff and retires the child.
  breaker.acquire().settle(OUTCOMES.INFRASTRUCTURE);
  clock.t = 2_000;
  assert.equal(breaker.state, BREAKER_STATES.HALF_OPEN);
  const controller = new AbortController();
  const probe = supervisor.healthCheck({ signal: controller.signal });
  controller.abort();
  await assert.rejects(probe, code('ABORTED'));
  const snap = supervisor.snapshot();
  assert.equal(snap.breaker.state, BREAKER_STATES.OPEN);
  assert.equal(snap.breaker.reopenCount, 1);
  assert.equal(snap.state, 'stopped');
  await assert.rejects(supervisor.healthCheck(), code('NOT_READY'));
  await assertChildGone(fx);
});

// --- WP04 acceptance: sustained sequential load ------------------------------------------

const openFdCount = () => readdirSync('/proc/self/fd').length;
// RSS is a gross-leak guard only: the fake's responses grow with its own call
// history (~18 KB by call 1000, ~9 MB parsed in total) and V8 collects lazily,
// so a tight bound would flake. 64 MiB still catches per-call retention of
// responses, transports or children; FDs and the process set are the tight checks.
const STRESS_CALLS = 1_000;
const STRESS_RSS_GROWTH_BYTES = 64 * 1024 * 1024;

test('1000 sequential searches reuse one child without FD, process or RSS growth', { timeout: 30_000 }, async () => {
  const fx = makeFixture();
  // Explicit per-call hard deadline (<= 5s): a stuck call fails fast, never retried.
  const supervisor = makeSupervisor(fx, { callTimeoutsMs: { search: 2_000 } });
  await supervisor.start();
  const fdBaseline = openFdCount();
  const rssBaseline = process.memoryUsage().rss;
  const children = processesUsing(fx.base).sort((a, b) => a - b);
  assert.ok(children.length > 0, 'sandboxed child is running');

  for (let i = 1; i <= STRESS_CALLS; i += 1) {
    const query = `stress-${i}`;
    const res = await search(supervisor, query);
    assert.equal(res.ok, true);
    assert.equal(res.query, query, 'result belongs to this call');
    // The child counts every tools/call it saw: exactly one per request means
    // no retry, duplicate or silent restart (a new child would reset it).
    assert.equal(res.observed.toolCalls, i);
    assert.equal(res.observed.cwd, fx.root);
    if (i % 100 === 0) {
      const snap = supervisor.snapshot();
      assert.equal(snap.state, 'ready');
      assert.equal(snap.generation, 1, 'same child generation across the batch');
      assert.equal(snap.inFlight, null);
      assert.equal(snap.lastError, null);
      assert.equal(snap.breaker.consecutiveFailures, 0);
      assert.deepEqual(processesUsing(fx.base).sort((a, b) => a - b), children, `same child process set at ${i}`);
      const fds = openFdCount();
      assert.ok(fds <= fdBaseline + 2, `open FDs ${fds} exceed baseline ${fdBaseline} + 2 at call ${i}`);
    }
  }

  const rssGrowth = process.memoryUsage().rss - rssBaseline;
  assert.ok(rssGrowth <= STRESS_RSS_GROWTH_BYTES, `RSS grew ${rssGrowth} bytes over ${STRESS_CALLS} calls`);

  const stopped = await supervisor.stop();
  assert.equal(stopped.state, 'stopped');
  assert.equal(stopped.generation, 2);
  await assertChildGone(fx);
  const fdsAfterStop = openFdCount();
  assert.ok(fdsAfterStop <= fdBaseline, `open FDs ${fdsAfterStop} after stop exceed baseline ${fdBaseline}`);
});

test('MC-007 child exiting after one reply stays down until an explicit start(); nothing is replayed', TEST, async () => {
  const fx = makeFixture();
  const supervisor = makeSupervisor(fx);
  await supervisor.start();
  const first = await search(supervisor, 'exit-after-reply');
  assert.equal(first.query, 'exit-after-reply', 'the completed call keeps its result');
  assert.equal(first.observed.toolCalls, 1);

  await waitUntil(() => supervisor.snapshot().state === 'stopped', 'retirement of the exited child');
  await waitUntil(() => processesUsing(fx.base).length === 0, 'exited child and bwrap to be reaped');
  let snap = supervisor.snapshot();
  assert.equal(snap.generation, 2, 'exit retired generation 1');
  assert.equal(snap.lastError, 'CHILD_EXITED');
  assert.equal(snap.inFlight, null);
  assert.deepEqual(snap.tools, []);

  const started = Date.now();
  await assert.rejects(supervisor.callReadOnly('openwiki_search', { query: 'next' }), code('NOT_READY'));
  await assert.rejects(supervisor.healthCheck(), code('NOT_READY'));
  assert.ok(Date.now() - started < 500, 'not-ready is reported at once, never waits on a child');
  snap = supervisor.snapshot();
  assert.equal(snap.state, 'stopped', 'no automatic restart');
  assert.equal(snap.generation, 2);
  assert.equal(snap.breaker.consecutiveFailures, 0, 'local NOT_READY never touches the breaker');
  assert.deepEqual(processesUsing(fx.base), [], 'the refused call spawned nothing');

  const restarted = await supervisor.start();
  assert.equal(restarted.state, 'ready');
  assert.equal(restarted.generation, 3, 'manual start is a new generation');
  assert.equal(restarted.lastError, null);
  const next = await search(supervisor, 'after-restart');
  assert.equal(next.query, 'after-restart');
  assert.equal(next.observed.toolCalls, 1, 'the new child saw only this call');
  assert.deepEqual(next.observed.calledTools, ['openwiki_search'], 'the completed call was not retried');
  await supervisor.stop();
  await assertChildGone(fx);
});

test('MC-008 child exiting with a pending request rejects CHILD_EXITED promptly and leaves no child', HANG_TEST, async () => {
  const fx = makeFixture();
  const supervisor = makeSupervisor(fx);
  await supervisor.start();
  const started = Date.now();
  const call = supervisor.callReadOnly('openwiki_search', { query: 'exit-pending' });
  assert.equal(supervisor.snapshot().inFlight, 'openwiki_search');
  await assert.rejects(call, code('CHILD_EXITED'));
  assert.ok(Date.now() - started < 5_000, 'pending call settles within 5s, not at a deadline');

  const snap = supervisor.snapshot();
  assert.equal(snap.state, 'stopped');
  assert.equal(snap.generation, 2);
  assert.equal(snap.lastError, 'CHILD_EXITED');
  assert.equal(snap.inFlight, null, 'single-flight slot freed only after retirement');
  assert.equal(snap.breaker.consecutiveFailures, 1, 'child exit is an infrastructure failure');
  await waitUntil(() => processesUsing(fx.base).length === 0, 'exited child and bwrap to be gone');

  // No late response: the slot is free, nothing answers for generation 1, and
  // the next child only ever sees its own request.
  await assert.rejects(supervisor.callReadOnly('openwiki_search', { query: 'late' }), code('NOT_READY'));
  await supervisor.start();
  assert.equal(supervisor.snapshot().generation, 3);
  const next = await search(supervisor, 'after-exit');
  assert.equal(next.query, 'after-exit');
  assert.equal(next.observed.toolCalls, 1);
  await supervisor.stop();
  await assertChildGone(fx);
});

test('MC-015 retargeting a current symlink to release B leaves the pinned release A child untouched', TEST, async () => {
  const fx = makeFixture('normal', { releasePath: join('releases', 'A') });
  const releaseBDir = join(fx.base, 'releases', 'B');
  const exeB = writeRelease(releaseBDir, 'normal', (source) => `${source}\n// release B\n`);
  const current = join(fx.base, 'current');
  symlinkSync(fx.release, current);
  assert.equal(fx.config.upstream.releaseDir, fx.release, 'config pins canonical release A, not the symlink');

  const supervisor = makeSupervisor(fx);
  await supervisor.start();
  const before = await search(supervisor, 'release');
  assert.equal(before.observed.executable, fx.config.upstream.executable);
  const children = processesUsing(fx.base).sort((a, b) => a - b);
  assert.ok(children.length > 0);

  const staged = join(fx.base, 'current.next');
  symlinkSync(releaseBDir, staged);
  renameSync(staged, current);
  assert.equal(realpathSync(current), releaseBDir, 'current now points at release B');
  assert.notEqual(readFileSync(exeB, 'utf8'), readFileSync(fx.exe, 'utf8'));

  const after = await search(supervisor, 'release');
  assert.equal(after.observed.executable, fx.config.upstream.executable, 'live child still runs release A');
  assert.equal(after.observed.toolCalls, 2, 'same child served both calls');
  const snap = supervisor.snapshot();
  assert.equal(snap.state, 'ready');
  assert.equal(snap.generation, 1, 'retarget does not change the generation');
  assert.equal(snap.lastError, null);
  assert.deepEqual(processesUsing(fx.base).sort((a, b) => a - b), children, 'same child process set');
  assert.deepEqual(processesUsing(releaseBDir), [], 'nothing runs from release B');
  assert.deepEqual(await supervisor.healthCheck(), { ok: true, generation: 1, toolCount: 6 });

  await supervisor.stop();
  await supervisor.start();
  const restarted = await search(supervisor, 'release');
  assert.equal(supervisor.snapshot().generation, 3);
  assert.equal(restarted.observed.executable, fx.config.upstream.executable, 'restart still uses pinned release A');
  assert.deepEqual(processesUsing(releaseBDir), []);
  await supervisor.stop();
  await assertChildGone(fx);
});

test('MC-017 a seeded host wiki-workspaces registry is invisible to the sandboxed child', TEST, async () => {
  const fx = makeFixture('normal', { extraWorkspaces: ['beta'], hostHome: true });
  const betaRoot = fx.config.workspaces.beta.root;
  writeFileSync(join(betaRoot, 'SECRET.md'), 'beta-secret\n', { mode: 0o600 });
  const hostConfigDir = join(fx.hostHome, '.openwiki');
  mkdirSync(hostConfigDir, { mode: 0o700 });
  const registryFile = join(hostConfigDir, 'wiki-workspaces.json');
  const registry = `${JSON.stringify({
    version: 1,
    workspaces: [
      { id: 'beta', path: '../ws-beta' },
      { id: 'beta-abs', path: betaRoot },
      { id: 'escape', path: '../../../../etc' },
      { id: 'home', path: '~/.ssh' },
      { id: null, path: 'ws\u0000beta' },
      'not-an-object',
    ],
  })}\n{ trailing garbage`;
  writeFileSync(registryFile, registry, { mode: 0o600 });

  // Even a gateway environment pointing at the seeded registry must not leak.
  const seeded = { HOME: fx.hostHome, OPENWIKI_CONFIG_DIR: hostConfigDir };
  const previous = Object.fromEntries(Object.keys(seeded).map((k) => [k, process.env[k]]));
  Object.assign(process.env, seeded);
  let supervisor;
  try {
    supervisor = makeSupervisor(fx);
    await supervisor.start();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
  assert.equal(supervisor.snapshot().state, 'ready');

  const listed = await supervisor.callReadOnly('openwiki_list_workspaces', {});
  assert.equal(listed.isError, false);
  assert.deepEqual(JSON.parse(listed.content[0].text), { workspaces: [], registry: 'ENOENT' });

  const hidden = [
    fx.hostHome,
    hostConfigDir,
    registryFile,
    betaRoot,
    join(betaRoot, 'SECRET.md'),
    `${fx.root}/../ws-beta/SECRET.md`,
    '/home/openwiki/.openwiki/wiki-workspaces.json',
  ];
  const visible = join(fx.root, '.git');
  const res = await supervisor.callReadOnly('openwiki_search', { query: 'probe', paths: [...hidden, visible] });
  const probe = JSON.parse(res.content[0].text);
  assert.deepEqual(probe.env, { home: '/home/openwiki', configDir: '/home/openwiki/.openwiki' });
  assert.equal(probe.probes[visible], 'directory', 'probe works on the selected workspace');
  for (const path of hidden) assert.equal(probe.probes[path], 'ENOENT', `${path} must not exist in the sandbox`);
  assert.equal(probe.observed.cwd, fx.root);

  assert.equal(readFileSync(registryFile, 'utf8'), registry, 'seeded host registry left untouched');
  await supervisor.stop();
  await assertChildGone(fx);
});

// --- ADMIN mode (OWG-04) -----------------------------------------------------------

function makeAdminFixture({ createOpenwikiDir = true } = {}) {
  const fx = makeFixture('lifecycle-tools');
  // Explicitly create <workspace>/openwiki as required by ADMIN sandbox
  if (createOpenwikiDir) {
    mkdirSync(join(fx.root, 'openwiki'), { mode: 0o700 });
  }
  return { ...fx, lifecycleFingerprint: computeSchemaFingerprint(toolsForMode('lifecycle-tools')) };
}

function makeAdminSupervisor(fx, overrides = {}) {
  const supervisor = new McpSupervisor({
    config: fx.config,
    workspaceId: 'alpha',
    manifest: {
      certified: true,
      protocolVersion: LATEST_PROTOCOL_VERSION,
      schemaFingerprint: fx.lifecycleFingerprint,
    },
    expectedProtocolVersion: LATEST_PROTOCOL_VERSION,
    expectedSchemaFingerprint: fx.lifecycleFingerprint,
    handshakeTimeoutMs: 4_000,
    accessMode: 'admin',
    ...overrides,
  });
  supervisors.push(supervisor);
  return supervisor;
}

function makeReadSupervisor(fx, overrides = {}) {
  const supervisor = new McpSupervisor({
    config: fx.config,
    workspaceId: 'alpha',
    manifest: {
      certified: true,
      protocolVersion: LATEST_PROTOCOL_VERSION,
      schemaFingerprint: fx.lifecycleFingerprint,
    },
    expectedProtocolVersion: LATEST_PROTOCOL_VERSION,
    expectedSchemaFingerprint: fx.lifecycleFingerprint,
    handshakeTimeoutMs: 4_000,
    accessMode: 'read',
    ...overrides,
  });
  supervisors.push(supervisor);
  return supervisor;
}

test('constructor accepts accessMode and defaults to READ', TEST, async () => {
  const fx = makeFixture();
  const readSupervisor = makeSupervisor(fx); // default
  assert.equal(readSupervisor.snapshot().state, 'stopped');
  await assert.rejects(readSupervisor.callAdmin('openwiki_begin', {}), code('TOOL_NOT_ALLOWED'));
  // No direct access to #accessMode, but behavior is tested below.
  // Verify invalid accessMode is rejected.
  assert.throws(
    () => new McpSupervisor({ ...certifiedOptions(fx), accessMode: 'invalid' }),
    /accessMode must be 'read' or 'admin'/,
  );
});

test('ADMIN mode requires <workspace>/openwiki directory and uses buildAdminSandboxInvocation', TEST, async () => {
  // Without openwiki/ directory, ADMIN sandbox should fail
  const fxNoDir = makeAdminFixture({ createOpenwikiDir: false });
  const supervisorNoDir = makeAdminSupervisor(fxNoDir);
  await assert.rejects(supervisorNoDir.start(), code('SANDBOX_FAILED'));
  assert.equal(supervisorNoDir.snapshot().lastError, 'SANDBOX_FAILED');
  await assertChildGone(fxNoDir);

  // With openwiki/ directory, ADMIN sandbox should start
  const fx = makeAdminFixture({ createOpenwikiDir: true });
  const supervisor = makeAdminSupervisor(fx);
  await supervisor.start();
  const snap = supervisor.snapshot();
  assert.equal(snap.state, 'ready');
  assert.equal(snap.generation, 1);
  // Should advertise all 6 pinned lifecycle tools
  assert.equal(snap.tools.filter((name) => PINNED_LIFECYCLE_TOOLS.includes(name)).length, 6);
  await supervisor.stop();
  await assertChildGone(fx);
});

test('ADMIN mode only allows PINNED_LIFECYCLE_TOOLS via callAdmin', TEST, async () => {
  const fx = makeAdminFixture();
  const supervisor = makeAdminSupervisor(fx);
  await supervisor.start();

  // All 6 pinned lifecycle tools should be callable via callAdmin
  for (const name of PINNED_LIFECYCLE_TOOLS) {
    const args = { probe: name };
    const res = await supervisor.callAdmin(name, args);
    assert.equal(res.isError, false);
    assert.equal(res.tool, name);
    assert.equal(res.generation, 1);
    const payload = JSON.parse(res.content[0].text);
    assert.equal(payload.mutated, name);
    assert.deepEqual(payload.args, args);
    assert.deepEqual(payload.observed.calledTools, PINNED_LIFECYCLE_TOOLS.slice(0, PINNED_LIFECYCLE_TOOLS.indexOf(name) + 1));
  }

  // READ_ONLY_TOOLS should be rejected in ADMIN mode
  for (const name of READ_ONLY_TOOLS) {
    await assert.rejects(supervisor.callAdmin(name, {}), code('TOOL_NOT_ALLOWED'), name);
  }

  // Other non-allowlisted names should also be rejected
  await assert.rejects(supervisor.callAdmin('openwiki_delete_page', {}), code('TOOL_NOT_ALLOWED'));
  await assert.rejects(supervisor.callAdmin('OPENWIKI_BEGIN', {}), code('TOOL_NOT_ALLOWED'));
  await assert.rejects(supervisor.callAdmin('', {}), code('TOOL_NOT_ALLOWED'));
  await assert.rejects(supervisor.callAdmin(42, {}), code('TOOL_NOT_ALLOWED'));
  const afterDeniedCalls = await supervisor.callAdmin('openwiki_finish', { probe: 'after-denials' });
  assert.deepEqual(
    JSON.parse(afterDeniedCalls.content[0].text).observed.calledTools,
    [...PINNED_LIFECYCLE_TOOLS, 'openwiki_finish'],
    'read-only and unknown calls never reach the ADMIN fake',
  );

  await supervisor.stop();
  await assertChildGone(fx);
});

test('READ mode only allows READ_ONLY_TOOLS via callReadOnly', TEST, async () => {
  const fx = makeAdminFixture(); // lifecycle-tools fixture has both sets
  const supervisor = makeReadSupervisor(fx);
  await supervisor.start();

  // All READ_ONLY_TOOLS should be callable via callReadOnly
  for (const name of READ_ONLY_TOOLS) {
    if (name === 'openwiki_list_wikis') continue; // not offered by fake
    const res = await supervisor.callReadOnly(name, name === 'openwiki_read' ? { path: 'docs/a.md' } : {});
    assert.equal(res.isError, false);
    assert.equal(res.tool, name);
    assert.equal(res.generation, 1);
  }

  // PINNED_LIFECYCLE_TOOLS should be rejected in READ mode
  for (const name of PINNED_LIFECYCLE_TOOLS) {
    await assert.rejects(supervisor.callReadOnly(name, {}), code('TOOL_NOT_ALLOWED'), name);
  }
  const observed = await search(supervisor, 'mode-audit');
  assert.deepEqual(observed.observed.calledTools, [
    'openwiki_list_workspaces',
    'openwiki_read',
    'openwiki_search',
    'openwiki_search',
  ]);

  await supervisor.stop();
  await assertChildGone(fx);
});

test('callAdmin is only available in ADMIN mode; callReadOnly only in READ mode', TEST, async () => {
  const fx = makeAdminFixture();
  const adminSupervisor = makeAdminSupervisor(fx);
  const readSupervisor = makeReadSupervisor(fx);

  await adminSupervisor.start();
  await readSupervisor.start();

  // callAdmin on READ supervisor should be rejected locally
  await assert.rejects(
    readSupervisor.callAdmin('openwiki_begin', {}),
    code('TOOL_NOT_ALLOWED'),
    'callAdmin rejected in READ mode',
  );

  // callReadOnly on ADMIN supervisor should be rejected locally
  await assert.rejects(
    adminSupervisor.callReadOnly('openwiki_search', { query: 'x' }),
    code('TOOL_NOT_ALLOWED'),
    'callReadOnly rejected in ADMIN mode',
  );

  // Verify no MCP traffic for cross-mode calls (breaker unchanged)
  assert.equal(readSupervisor.snapshot().breaker.consecutiveFailures, 0);
  assert.equal(adminSupervisor.snapshot().breaker.consecutiveFailures, 0);
  assert.equal(readSupervisor.snapshot().generation, 1);
  assert.equal(adminSupervisor.snapshot().generation, 1);

  await adminSupervisor.stop();
  await readSupervisor.stop();
  await assertChildGone(fx);
});

test('ADMIN mode accepts only bounded admin timeout overrides', TEST, async () => {
  const fx = makeAdminFixture();
  assert.throws(
    () => makeAdminSupervisor(fx, { callTimeoutsMs: { admin: 5_001 } }),
    /callTimeoutsMs\.admin/,
  );
  const supervisor = makeAdminSupervisor(fx, { callTimeoutsMs: { admin: 200 } });
  await supervisor.start();

  // Verify a valid short timeout is accepted; the next test exercises expiry.
  const res = await supervisor.callAdmin('openwiki_begin', {});
  assert.equal(res.isError, false);
  assert.equal(res.tool, 'openwiki_begin');

  await supervisor.stop();
  await assertChildGone(fx);
});

test('ADMIN lifecycle call deadline kills a hanging child', HANG_TEST, async () => {
  const fx = makeAdminFixture();
  const supervisor = makeAdminSupervisor(fx, { callTimeoutsMs: { admin: 200 } });
  await supervisor.start();

  await assert.rejects(
    supervisor.callAdmin('openwiki_begin', { probe: 'hang' }),
    code('DEADLINE_EXCEEDED'),
  );
  const snap = supervisor.snapshot();
  assert.equal(snap.state, 'stopped');
  assert.equal(snap.lastError, 'DEADLINE_EXCEEDED');
  await assertChildGone(fx);
});
