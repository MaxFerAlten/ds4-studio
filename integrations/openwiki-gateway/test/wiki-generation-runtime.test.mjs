import assert from 'node:assert/strict';
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { createWikiGenerationRuntime } from '../src/wiki-generation-runtime.mjs';
import { createWikiGenerationStateStore } from '../src/wiki-generation-state-store.mjs';

const CONFIG_PATH = '/etc/ds4-openwiki/gateway.json';
const SECRET = 'sk-test-secret-value';
const TOKEN_MARK = 'admin-token-bytes';
const METADATA = Object.freeze({ baseCommit: null, dirtyAtStart: false, engine: 'ds4', model: 'ds4-test', openwikiVersion: '0.7.1' });

const dirs = [];
after(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

function upstreamScript() {
  let pending = 1;
  return {
    openwiki_begin: () => ({ runId: 'run-1', phase: 'planning' }),
    openwiki_submit_plan: () => ({ accepted: true }),
    openwiki_next_page: () => (pending-- > 0
      ? { status: 'pending', job: { id: 'job-1', path: '/openwiki/quickstart.md', title: 'Quickstart', purpose: 'Start here' } }
      : { status: 'complete' }),
    openwiki_submit_page: () => ({ accepted: true }),
    openwiki_finish: () => ({ sourceChanged: false }),
  };
}

function fixture({ workspaces, sandboxError, managerStartError, callImpl, generate, writerImpl } = {}) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'ow-runtime-')));
  dirs.push(base);
  chmodSync(base, 0o700);
  const root = join(base, 'repo');
  mkdirSync(root, { mode: 0o700 });
  const stateStore = createWikiGenerationStateStore({ stateDir: join(base, 'state') });
  const log = [];
  const calls = [];
  const writes = [];
  const managers = [];
  const script = upstreamScript();
  const config = Object.freeze({
    uid: process.getuid(),
    listen: { socketPath: join(base, 'gw.sock') },
    workspaces: workspaces?.(root) ?? { repo: { id: 'repo', root, dev: 1, ino: 2 } },
  });

  const factories = {
    loadConfig(path) { log.push(`loadConfig:${path}`); return config; },
    validateWorkspaceRoot(candidate) {
      log.push('validateWorkspaceRoot');
      return { root: realpathSync(candidate), dev: 1, ino: 2 };
    },
    assertSandboxUsable(cfg, id) {
      log.push(`assertSandboxUsable:${id}`);
      if (sandboxError) throw Object.assign(new Error('bwrap missing'), { code: 'SANDBOX_UNUSABLE' });
      return true;
    },
    createAdminWorkerManager(options) {
      log.push('createAdminWorkerManager');
      let running = false;
      const manager = {
        options,
        starts: 0,
        closes: 0,
        async start() {
          manager.starts++;
          log.push('manager.start');
          if (managerStartError) throw Object.assign(new Error('worker failed'), { code: 'ADMIN_STARTUP_TIMEOUT' });
          running = true;
        },
        async call(tool, args, opts) {
          calls.push(tool);
          if (callImpl) return callImpl(tool, args, opts);
          return { structuredContent: script[tool](args) };
        },
        async close() { manager.closes++; running = false; log.push('manager.close'); },
        snapshot() {
          return { state: running ? 'running' : 'stopped', configPath: CONFIG_PATH,
            adminSocketPath: join(base, 'gw.sock.admin'), hasToken: true, token: TOKEN_MARK };
        },
      };
      managers.push(manager);
      return manager;
    },
    createAdminPageWriter(cfg, workspaceId) {
      log.push(`createAdminPageWriter:${workspaceId}`);
      if (writerImpl) return writerImpl({ log, writes });
      return { async writePage(job, markdown, { signal } = {}) {
        assert.ok(signal instanceof AbortSignal);
        writes.push({ path: job.path, markdown });
        return { path: job.path, bytes: Buffer.byteLength(markdown) };
      } };
    },
  };

  const generateCalls = [];
  const generator = generate ?? (async (request) => {
    generateCalls.push(request);
    if (request.kind === 'plan') return { value: { pages: [{ path: '/openwiki/quickstart.md', title: 'Quickstart', purpose: 'Start' }] } };
    return { value: { markdown: '# Quickstart\n' } };
  });
  generator.probeModel ??= async () => { log.push('model.probe'); return true; };
  const runtime = createWikiGenerationRuntime({
    configPath: CONFIG_PATH,
    stateStore,
    factories,
    generate: generator,
  });
  return { base, root, wikiDir: join(root, 'openwiki'), runtime, stateStore, log, calls, writes, managers, generateCalls };
}

const runArgs = (fx, extra = {}) => ({ kind: 'init', root: fx.root, stateKey: 'session:1', metadata: METADATA,
  modelContext: { apiKey: SECRET }, ...extra });

test('start is idempotent and validates workspace and sandbox without starting ADMIN', async () => {
  const fx = fixture();
  await assert.rejects(fx.runtime.run(runArgs(fx)), { code: 'RUNTIME_NOT_STARTED' });
  const [a, b] = await Promise.all([fx.runtime.start(), fx.runtime.start()]);
  assert.equal(a.state, 'ready');
  assert.equal(b.state, 'ready');
  assert.equal((await fx.runtime.start()).state, 'ready');
  assert.equal(fx.managers.length, 1);
  assert.equal(fx.managers[0].starts, 0);
  assert.deepEqual(fx.managers[0].options, { configPath: CONFIG_PATH });
  assert.deepEqual(fx.log, [
    `loadConfig:${CONFIG_PATH}`, 'assertSandboxUsable:repo', 'createAdminWorkerManager', 'createAdminPageWriter:repo',
  ]);
  const status = fx.runtime.status();
  assert.equal(status.workspaceId, 'repo');
  assert.equal(status.root, fx.root);
  assert.equal(status.admin, 'stopped');

  await Promise.all([fx.runtime.stop(), fx.runtime.stop()]);
  await fx.runtime.stop();
  assert.equal(fx.managers[0].closes, 1);
  assert.equal(fx.runtime.status().state, 'stopped');
  assert.equal(fx.runtime.status().admin, 'stopped');
  await assert.rejects(fx.runtime.run(runArgs(fx)), { code: 'RUNTIME_NOT_STARTED' });

  await fx.runtime.start();
  assert.equal(fx.managers.length, 2, 'runtime restarts with a fresh manager');
  await fx.runtime.stop();
});

test('start refuses multiple workspaces or an unusable sandbox without starting ADMIN', async () => {
  const multi = fixture({ workspaces: (root) => ({ a: { id: 'a', root }, b: { id: 'b', root: `${root}-b` } }) });
  await assert.rejects(multi.runtime.start(), { code: 'WORKSPACE_SELECTION_INVALID' });
  assert.equal(multi.managers.length, 0);
  assert.equal(multi.runtime.status().state, 'stopped');
  assert.equal(multi.runtime.status().lastError, 'WORKSPACE_SELECTION_INVALID');

  const sandbox = fixture({ sandboxError: true });
  await assert.rejects(sandbox.runtime.start(), { code: 'SANDBOX_UNUSABLE' });
  assert.equal(sandbox.managers.length, 0);
  assert.equal(sandbox.runtime.status().state, 'stopped');

  const worker = fixture({ managerStartError: true });
  assert.equal((await worker.runtime.start()).state, 'ready');
  assert.equal(worker.managers[0].starts, 0);
  await assert.rejects(worker.runtime.run(runArgs(worker)), { code: 'ADMIN_STARTUP_TIMEOUT' });
  assert.equal(worker.managers[0].starts, 1);
  assert.equal(worker.runtime.status().state, 'ready');
  assert.equal(existsSync(worker.wikiDir), false, 'failed ADMIN startup leaves no empty output directory');
  await worker.runtime.stop();
  assert.equal(worker.managers[0].closes, 1);
  assert.equal(worker.runtime.status().state, 'stopped');
});

test('init creates a private openwiki directory and runs through manager, generate and writer', async () => {
  const fx = fixture();
  await fx.runtime.start();
  const result = await fx.runtime.run(runArgs(fx));
  assert.equal(result.runId, 'run-1');
  assert.equal(result.pageCount, 1);
  const st = lstatSync(fx.wikiDir);
  assert.ok(st.isDirectory());
  assert.equal(st.mode & 0o777, 0o700);
  assert.deepEqual(fx.calls, ['openwiki_begin', 'openwiki_submit_plan', 'openwiki_next_page', 'openwiki_submit_page', 'openwiki_next_page', 'openwiki_finish']);
  assert.deepEqual(fx.writes, [{ path: '/openwiki/quickstart.md', markdown: '# Quickstart\n' }]);
  assert.deepEqual(fx.generateCalls[0].modelContext, { apiKey: SECRET });
  const record = await fx.stateStore.get('session:1');
  assert.equal(record.phase, 'completed');
  assert.equal(record.root, fx.root);
  assert.equal(record.model, 'ds4-test');
  assert.equal(record.runId, 'run-1');
  assert.equal(fx.runtime.status().state, 'ready');
  assert.equal(fx.runtime.status().lastResult.pageCount, 1);

  // A second init must not overwrite the now-existing directory.
  fx.calls.length = 0;
  await assert.rejects(fx.runtime.run(runArgs(fx, { stateKey: 'session:2' })), { code: 'OPENWIKI_DIR_EXISTS' });
  assert.deepEqual(fx.calls, []);
  assert.equal(await fx.stateStore.get('session:2'), null);
  await fx.runtime.stop();
});

test('unsupported model tool calling fails before init creates openwiki or begins upstream work', async () => {
  const generator = async () => { throw new Error('generation must not start'); };
  generator.probeModel = async () => { throw Object.assign(new Error('unsupported'), { code: 'MODEL_TOOL_CALL_UNSUPPORTED' }); };
  const fx = fixture({ generate: generator });
  await fx.runtime.start();
  await assert.rejects(fx.runtime.run(runArgs(fx)), { code: 'MODEL_TOOL_CALL_UNSUPPORTED' });
  assert.equal(existsSync(fx.wikiDir), false);
  assert.deepEqual(fx.calls, []);
  assert.equal(fx.generateCalls.length, 0);
  await fx.runtime.stop();
});

test('init resumes an interrupted run with its existing openwiki directory and saved run ID', async () => {
  const fx = fixture();
  mkdirSync(fx.wikiDir, { mode: 0o700 });
  writeFileSync(join(fx.wikiDir, 'quickstart.md'), '# partial\n', { mode: 0o600 });
  const timestamp = new Date().toISOString();
  await fx.stateStore.save('session:1', { schema: 1, root: fx.root, ...METADATA, runId: 'run-1', jobId: 'job-1',
    phase: 'failed', createdAt: timestamp, updatedAt: timestamp });
  await fx.runtime.start();
  const result = await fx.runtime.run(runArgs(fx));
  assert.equal(result.runId, 'run-1');
  assert.deepEqual(fx.calls.slice(0, 2), ['openwiki_begin', 'openwiki_submit_plan']);
  await fx.runtime.stop();
});

test('init recovers an empty directory left between starting and upstream run ID persistence', async () => {
  const fx = fixture();
  mkdirSync(fx.wikiDir, { mode: 0o700 });
  const timestamp = new Date().toISOString();
  await fx.stateStore.save('session:1', { schema: 1, root: fx.root, ...METADATA, runId: null, jobId: null,
    phase: 'starting', createdAt: timestamp, updatedAt: timestamp });
  await fx.runtime.start();
  const result = await fx.runtime.run(runArgs(fx));
  assert.equal(result.runId, 'run-1');
  assert.equal(fx.calls[0], 'openwiki_begin');
  await fx.runtime.stop();
});

test('init rejects existing paths including symlinks and files before any upstream call', async () => {
  const fx = fixture();
  await fx.runtime.start();
  const target = join(fx.base, 'elsewhere');
  mkdirSync(target, { mode: 0o700 });
  symlinkSync(target, fx.wikiDir);
  await assert.rejects(fx.runtime.run(runArgs(fx)), { code: 'OPENWIKI_DIR_EXISTS' });
  assert.ok(lstatSync(fx.wikiDir).isSymbolicLink(), 'existing symlink left untouched');
  assert.deepEqual(fx.calls, []);
  await fx.runtime.stop();
});

test('update requires an existing safe non-symlink openwiki directory', async () => {
  const fx = fixture({ callImpl: async (tool) => ({ structuredContent: tool === 'openwiki_begin' ? { status: 'noop' } : {} }) });
  await fx.runtime.start();
  const update = runArgs(fx, { kind: 'update' });

  await assert.rejects(fx.runtime.run(update), { code: 'OPENWIKI_DIR_MISSING' });
  assert.equal(existsSync(fx.wikiDir), false, 'update never creates the directory');

  const target = join(fx.base, 'elsewhere');
  mkdirSync(target, { mode: 0o700 });
  symlinkSync(target, fx.wikiDir);
  await assert.rejects(fx.runtime.run(update), { code: 'OPENWIKI_DIR_UNSAFE' });
  rmSync(fx.wikiDir);

  mkdirSync(fx.wikiDir, { mode: 0o700 });
  chmodSync(fx.wikiDir, 0o777);
  await assert.rejects(fx.runtime.run(update), { code: 'OPENWIKI_DIR_UNSAFE' });
  assert.deepEqual(fx.calls, []);

  chmodSync(fx.wikiDir, 0o755);
  const result = await fx.runtime.run(update);
  assert.equal(result.noop, true);
  assert.deepEqual(fx.calls, ['openwiki_begin']);
  assert.equal((await fx.stateStore.get('session:1')).phase, 'completed');
  await fx.runtime.stop();
});

test('run validates the root against the configured workspace before any mutation', async () => {
  const fx = fixture();
  await fx.runtime.start();
  const other = join(fx.base, 'other');
  mkdirSync(other, { mode: 0o700 });
  await assert.rejects(fx.runtime.run(runArgs(fx, { root: other })), { code: 'WORKSPACE_ROOT_MISMATCH' });
  await assert.rejects(fx.runtime.run(runArgs(fx, { kind: 'delete' })), { code: 'INVALID_KIND' });
  await assert.rejects(fx.runtime.run(runArgs(fx, { stateKey: '' })), { code: 'STATE_KEY_INVALID' });
  await assert.rejects(fx.runtime.run(runArgs(fx, { metadata: null })), { code: 'METADATA_INVALID' });
  await assert.rejects(fx.runtime.run(runArgs(fx, { metadata: { ...METADATA, engine: '' } })), { code: 'METADATA_INVALID' });
  assert.equal(existsSync(join(other, 'openwiki')), false);
  assert.equal(existsSync(fx.wikiDir), false);
  assert.deepEqual(fx.calls, []);
  assert.equal(await fx.stateStore.get('session:1'), null);
  await fx.runtime.stop();
});

test('state root mismatch fails before init creates the wiki directory', async () => {
  const fx = fixture();
  await fx.runtime.start();
  await fx.stateStore.save('session:1', { schema: 1, root: '/tmp/other-repo', ...METADATA, runId: 'old-run', jobId: null,
    phase: 'failed', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' });
  await assert.rejects(fx.runtime.run(runArgs(fx)), { code: 'STATE_ROOT_MISMATCH' });
  assert.equal(existsSync(fx.wikiDir), false);
  assert.deepEqual(fx.calls, []);
  assert.equal((await fx.stateStore.get('session:1')).root, '/tmp/other-repo');
  await fx.runtime.stop();
});

test('manager errors propagate, remove only the empty init directory and keep the runtime usable', async () => {
  const fx = fixture({ callImpl: async () => { throw Object.assign(new Error('socket refused'), { code: 'ADMIN_CALL_FAILED' }); } });
  await fx.runtime.start();
  await assert.rejects(fx.runtime.run(runArgs(fx)), { code: 'ADMIN_CALL_FAILED' });
  assert.equal(existsSync(fx.wikiDir), false);
  assert.equal(fx.runtime.status().state, 'ready');
  assert.equal(fx.runtime.status().lastError, 'ADMIN_CALL_FAILED');
  const record = await fx.stateStore.get('session:1');
  assert.equal(record.phase, 'failed');
  assert.equal(record.engine, 'ds4');
  await fx.runtime.stop();
});

test('stop aborts the active run, waits for it to settle, then closes the manager', async () => {
  let seenSignal = null;
  let release;
  const entered = new Promise((resolve) => { release = resolve; });
  const fx = fixture({ generate: ({ signal }) => new Promise((_, reject) => {
    seenSignal = signal;
    release();
    signal.addEventListener('abort', () => setTimeout(() => reject(signal.reason), 10), { once: true });
  }) });
  await fx.runtime.start();
  const running = fx.runtime.run(runArgs(fx));
  const settled = running.then(() => 'resolved', (error) => error.code);
  await entered;
  assert.equal(fx.runtime.status().state, 'running');
  assert.equal(fx.runtime.status().activeRun.kind, 'init');
  await assert.rejects(fx.runtime.run(runArgs(fx)), { code: 'RUNTIME_BUSY' });

  const stopped = await fx.runtime.stop();
  assert.equal(stopped.state, 'stopped');
  assert.equal(seenSignal.aborted, true);
  assert.equal(await settled, 'RUNTIME_STOPPING');
  assert.equal(fx.managers[0].closes, 1);
  assert.ok(fx.log.indexOf('manager.close') > 0);
  assert.equal((await fx.stateStore.get('session:1')).phase, 'failed');
});

test('stop waits for the confined writer to reap before closing ADMIN', async () => {
  let entered;
  const writerEntered = new Promise((resolve) => { entered = resolve; });
  const fx = fixture({ writerImpl: ({ log }) => ({ writePage: (_job, _markdown, { signal }) => new Promise((resolve, reject) => {
    entered();
    signal.addEventListener('abort', () => setTimeout(() => {
      log.push('writer.reaped');
      reject(signal.reason);
    }, 25), { once: true });
  }) }) });
  await fx.runtime.start();
  const run = fx.runtime.run(runArgs(fx));
  await writerEntered;
  const settledRun = run.catch(() => {});
  await fx.runtime.stop();
  await settledRun;
  assert.ok(fx.log.indexOf('writer.reaped') >= 0);
  assert.ok(fx.log.indexOf('manager.close') > fx.log.indexOf('writer.reaped'));
});

test('caller abort signal reaches the controller and generate adapter', async () => {
  const controller = new AbortController();
  const fx = fixture({ generate: ({ signal }) => new Promise((_, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    setTimeout(() => controller.abort(), 0);
  }) });
  await fx.runtime.start();
  await assert.rejects(fx.runtime.run(runArgs(fx, { signal: controller.signal })), { code: 'ABORTED' });
  assert.equal(fx.runtime.status().state, 'ready');

  const pre = new AbortController();
  pre.abort();
  await assert.rejects(fx.runtime.run(runArgs(fx, { signal: pre.signal })), { code: 'ABORTED' });
  await fx.runtime.stop();
});

test('session cancellation is scoped to the matching state key', async () => {
  let entered;
  const started = new Promise((resolve) => { entered = resolve; });
  const fx = fixture({ generate: ({ signal }) => new Promise((_, reject) => {
    entered();
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  }) });
  await fx.runtime.start();
  const run = fx.runtime.run(runArgs(fx));
  await started;
  assert.equal(fx.runtime.cancel('another-session'), false);
  assert.equal(fx.runtime.cancel('session:1'), true);
  await assert.rejects(run, { code: 'RUNTIME_CANCELLED' });
  assert.equal(fx.runtime.status().state, 'ready');
  assert.equal(fx.managers[0].closes, 0);
  await fx.runtime.stop();
});

test('status exposes a fixed redacted field list', async () => {
  const fx = fixture();
  await fx.runtime.start();
  await fx.runtime.run(runArgs(fx));
  const status = fx.runtime.status();
  assert.deepEqual(Object.keys(status).sort(), ['activeRun', 'admin', 'generation', 'lastError', 'lastResult', 'root', 'state', 'workspaceId']);
  const serialized = JSON.stringify(status);
  for (const forbidden of [SECRET, TOKEN_MARK, CONFIG_PATH, 'gw.sock', 'session:1', 'ds4-test', 'Quickstart', 'hasToken']) {
    assert.equal(serialized.includes(forbidden), false, `status leaked ${forbidden}`);
  }
  assert.ok(Object.isFrozen(status));
  await fx.runtime.stop();
});

test('constructor rejects missing collaborators and unknown factories', () => {
  const stateStore = { get() {}, save() {} };
  const generate = async () => ({});
  assert.throws(() => createWikiGenerationRuntime({ configPath: 'relative', stateStore, generate }), TypeError);
  assert.throws(() => createWikiGenerationRuntime({ configPath: CONFIG_PATH, generate }), TypeError);
  assert.throws(() => createWikiGenerationRuntime({ configPath: CONFIG_PATH, stateStore }), TypeError);
  assert.throws(() => createWikiGenerationRuntime({ configPath: CONFIG_PATH, stateStore, generate, factories: { spawn() {} } }), TypeError);
});
