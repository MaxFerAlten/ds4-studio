import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createOpenWikiGenerationService } from './openwikiGenerationService.mjs';

function fixture({ workspaceId = 'repo', env = {}, readAlreadyReady = true, runtimeStartError = null, runtimeRunError = null,
  workspaceSnapshots = [], workspaceSnapshotErrorAt = -1 } = {}) {
  const events = [];
  const runArgs = [];
  const cancelled = [];
  let runtimeStops = 0;
  let snapshotIndex = 0;
  const runtime = {
    async start() { events.push('start'); if (runtimeStartError) throw runtimeStartError; return { state: 'ready', workspaceId, root: '/repo', admin: 'running' }; },
    async run(args) { runArgs.push(args); if (runtimeRunError) throw runtimeRunError; return { runId: 'run-1' }; },
    cancel(key) { cancelled.push(key); return true; },
    async stop() { runtimeStops++; events.push('stop'); return { state: 'stopped' }; },
    status() { return { state: 'ready', workspaceId, root: '/repo', admin: 'running', lastError: null }; },
  };
  const service = createOpenWikiGenerationService({
    env: { DS4_OPENWIKI_CONFIG: '/private/gateway.json', DS4_OPENWIKI_WORKSPACE: 'repo', ...env },
    generate: async () => ({}),
    readContext: async () => ({}),
    factories: {
      createStateStore: ({ stateDir }) => { events.push(`state:${stateDir}`); return { get() {}, save() {} }; },
      createRuntime: (options) => { events.push(`runtime:${options.configPath}`); return runtime; },
      collectMetadata: async (metadata) => ({ baseCommit: null, dirtyAtStart: false, ...metadata }),
      collectWorkspaceSnapshot: async () => {
        const index = snapshotIndex++;
        if (index === workspaceSnapshotErrorAt) throw Object.assign(new Error('snapshot failed'), { code: 'GIT_METADATA_FAILED' });
        return workspaceSnapshots[Math.min(index, workspaceSnapshots.length - 1)] ?? [];
      },
      payloadModel: (request) => request.model,
      loadGatewayConfig: () => ({ listen: { socketPath: '/tmp/openwiki.sock' }, workspaces: { repo: { root: '/repo' } } }),
      readOpenWikiConfig: (config) => Object.freeze({ ...config, enabled: config.DS4_OPENWIKI_MODE === 'on', socketPath: config.DS4_OPENWIKI_SOCKET, workspaceId: config.DS4_OPENWIKI_WORKSPACE }),
      assertOpenWikiReady: async () => { events.push('read-ready'); if (!readAlreadyReady && !events.includes('read-start')) throw new Error('not ready'); },
      startReadGateway: async () => { events.push('read-start'); return { async close() { events.push('read-close'); } }; },
    },
  });
  return { service, events, runArgs, cancelled, get runtimeStops() { return runtimeStops; } };
}

test('starts one configured runtime and enables only the caller session', async () => {
  const fx = fixture();
  assert.equal(fx.service.status('session-a').enabled, false);
  assert.equal(fx.service.readConfig('session-a').enabled, false);
  assert.equal(fx.service.hasActiveSessions(), false);
  const [statusA, statusB] = await Promise.all([fx.service.start('session-a'), fx.service.start('session-b')]);
  assert.equal(statusA.enabled, true);
  assert.equal(statusA.root, '/repo');
  assert.equal(statusB.enabled, true);
  assert.equal(fx.events.filter((event) => event === 'start').length, 1);
  assert.equal(fx.service.readConfig('session-a').enabled, true);
  assert.equal(fx.service.hasActiveSessions(), true);
  assert.equal(fx.events.includes('read-start'), false);
});

test('passes session-scoped state identity and active model to the runtime', async () => {
  const fx = fixture();
  await fx.service.start('session-a');
  const result = await fx.service.run({ sessionKey: 'session-a', kind: 'init', root: '/repo', request: { model: 'ds4-model' }, engine: 'native' });
  assert.equal(result.runId, 'run-1');
  assert.equal(fx.runArgs[0].metadata.model, 'ds4-model');
  assert.equal(fx.runArgs[0].metadata.engine, 'native');
  assert.equal(fx.runArgs[0].stateKey.startsWith('session-a:'), true);
  assert.equal(fx.runArgs[0].root, '/repo');
});

test('reports bounded Git path changes against the pre-run OpenWiki snapshot', async () => {
  const fx = fixture({ workspaceSnapshots: [
    [{ path: 'openwiki/existing.md', status: ' M', sha256: 'before' }],
    [{ path: 'openwiki/existing.md', status: ' M', sha256: 'after' }, { path: 'openwiki/new.md', status: '??', sha256: 'new' }],
  ] });
  await fx.service.start('session-a');
  const result = await fx.service.run({ sessionKey: 'session-a', kind: 'update', root: '/repo', request: { model: 'm' }, engine: 'js' });
  assert.deepEqual(result.workspaceChanges, {
    preexistingPathCount: 1, changedPathCount: 1, addedPathCount: 1, removedPathCount: 0, truncated: false,
  });
});

test('captures the scoped post-run snapshot even when the generation fails', async () => {
  const fx = fixture({ runtimeRunError: Object.assign(new Error('run failed'), { code: 'MODEL_REQUEST_FAILED' }), workspaceSnapshots: [
    [], [{ path: 'openwiki/partial.md', status: '??', sha256: 'partial' }],
  ] });
  await fx.service.start('session-a');
  await assert.rejects(fx.service.run({ sessionKey: 'session-a', kind: 'init', root: '/repo', request: { model: 'm' }, engine: 'js' }), { code: 'MODEL_REQUEST_FAILED' });
  assert.equal(fx.service.status('session-a').workspaceChanges.addedPathCount, 1);
});

test('reports successful generation when the final Git snapshot fails, marked incomplete', async () => {
  const fx = fixture({ workspaceSnapshotErrorAt: 1 });
  await fx.service.start('session-a');
  const result = await fx.service.run({ sessionKey: 'session-a', kind: 'init', root: '/repo', request: { model: 'm' }, engine: 'js' });
  assert.equal(result.runId, 'run-1');
  assert.equal(result.workspaceChanges.truncated, true);
  assert.equal(result.workspaceChanges.errorCode, 'GIT_METADATA_FAILED');
});

test('bounds cached workspace summaries to the 64 most recent Agent sessions', async () => {
  const fx = fixture();
  for (let index = 0; index < 65; index++) {
    const sessionKey = `session-${index}`;
    await fx.service.start(sessionKey);
    await fx.service.run({ sessionKey, kind: 'init', root: '/repo', request: { model: 'm' }, engine: 'js' });
  }
  assert.equal(fx.service.status('session-0').workspaceChanges, null);
  assert.ok(fx.service.status('session-1').workspaceChanges);
  assert.ok(fx.service.status('session-64').workspaceChanges);
});

test('denies unstarted sessions and mismatched workspace roots', async () => {
  const fx = fixture();
  await assert.rejects(fx.service.run({ sessionKey: 'session-a', kind: 'init', root: '/repo', request: { model: 'm' }, engine: 'js' }), { code: 'OPENWIKI_NOT_STARTED' });
  await fx.service.start('session-a');
  await assert.rejects(fx.service.run({ sessionKey: 'session-a', kind: 'init', root: '/other', request: { model: 'm' }, engine: 'js' }), { code: 'WORKSPACE_ROOT_MISMATCH' });
  assert.equal(fx.runArgs.length, 0);
});

test('stop cancels only the session and closes the shared runtime when the last session stops', async () => {
  const fx = fixture();
  await fx.service.start('session-a');
  await fx.service.start('session-b');
  await fx.service.run({ sessionKey: 'session-a', kind: 'init', root: '/repo', request: { model: 'm' }, engine: 'js' });
  await fx.service.stop('session-a');
  assert.equal(fx.cancelled.length, 1);
  assert.match(fx.cancelled[0], /^session-a:/u);
  assert.equal(fx.runtimeStops, 0);
  assert.equal(fx.service.status('session-a').enabled, false);
  await fx.service.stop('session-b');
  assert.equal(fx.runtimeStops, 1);
  assert.equal(fx.events.includes('read-close'), false);
});

test('starts and closes an owned READ gateway with the last session', async () => {
  const fx = fixture({ readAlreadyReady: false });
  await fx.service.start('session-a');
  assert.equal(fx.events.indexOf('read-ready') < fx.events.indexOf('start'), true);
  await fx.service.stop('session-a');
  assert.equal(fx.events.includes('read-close'), true);
  assert.equal(fx.service.readConfig('session-a').enabled, false);
});

test('invalidates stale READ config when the readiness check fails', async () => {
  const fx = fixture();
  await fx.service.start('session-a');
  assert.equal(fx.service.readConfig('session-a').enabled, true);
  await fx.service.invalidateRead();
  assert.equal(fx.service.readConfig('session-a').enabled, false);
});

test('tears down an owned READ gateway when ADMIN startup fails', async () => {
  const fx = fixture({ readAlreadyReady: false, runtimeStartError: new Error('startup failure') });
  await assert.rejects(fx.service.start('session-a'), /startup failure/u);
  assert.equal(fx.events.includes('read-close'), true);
  assert.equal(fx.runtimeStops, 1);
  assert.equal(fx.service.status('session-a').enabled, false);
});

test('fails closed when service configuration is absent or workspace identity differs', async () => {
  const absent = fixture({ env: { DS4_OPENWIKI_CONFIG: '', DS4_OPENWIKI_WORKSPACE: 'repo' } });
  await assert.rejects(absent.service.start('session-a'), { code: 'OPENWIKI_NOT_CONFIGURED' });
  const wrong = fixture({ workspaceId: 'other' });
  await assert.rejects(wrong.service.start('session-a'), { code: 'WORKSPACE_SELECTION_INVALID' });
  assert.equal(wrong.runtimeStops, 1);
});
