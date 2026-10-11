import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createOpenWikiAgentCommandHandler } from './openwikiAgentCommand.mjs';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

function fixture({ root = '/repo with space', enabled = false, runResult, error } = {}) {
  const calls = [];
  let state = { state: 'stopped', enabled, workspaceId: null, root: null, admin: 'stopped', activeRun: null, generation: null, lastError: null };
  const service = {
    async start(sessionKey) { calls.push(['start', sessionKey]); state = { ...state, state: 'ready', enabled: true, workspaceId: 'repo', root, admin: 'running' }; return state; },
    async run(args) { calls.push(['run', args]); if (error) throw error; return runResult ?? { runId: 'run-1', pageCount: 2, totalTextBytes: 300, noop: false }; },
    async stop(sessionKey) { calls.push(['stop', sessionKey]); state = { ...state, state: 'stopped', enabled: false, root: null, admin: 'stopped' }; return state; },
    status() { return state; },
  };
  const session = {
    active: true,
    setOpenWikiWorkspace(value) { calls.push(['bind', value.root]); },
  };
  const handler = createOpenWikiAgentCommandHandler({
    service,
    validateRoot(path) {
      if (path !== root) throw Object.assign(new Error('bad root'), { code: 'INVALID_ROOT' });
      return { root: path, uid: 1000, dev: 1, ino: 2 };
    },
  });
  return { handler, service, session, calls, setState: (value) => { state = value; } };
}

test('start/status/stop are intercepted as host commands and status is bounded', async () => {
  const fx = fixture();
  const started = await fx.handler({ message: '/openwiki start', session: fx.session, sessionKey: 's1' });
  assert.equal(started.ok, true);
  assert.equal(started.payload.openwiki.root, '/repo with space');
  assert.deepEqual(fx.calls.map(([name]) => name), ['start', 'bind']);
  fx.setState({ state: 'running', enabled: true, workspaceId: 'repo', root: '/repo with space', admin: 'running',
    activeRun: { kind: 'init', aborted: false, startedAt: 'secret-time' }, generation: { state: 'generating', pageCount: 1 }, lastError: null });
  const status = await fx.handler({ message: '/openwiki status', session: fx.session, sessionKey: 's1' });
  assert.match(status.payload.message, /OpenWiki ON/u);
  assert.equal(JSON.stringify(status.payload).includes('secret-time'), false);
  const stopped = await fx.handler({ message: '/openwiki stop', session: fx.session, sessionKey: 's1' });
  assert.equal(stopped.payload.openwiki.state, 'stopped');
});

test('init passes only the canonical configured repository and active request/model', async () => {
  const fx = fixture();
  await fx.handler({ message: '/openwiki start', session: fx.session, sessionKey: 's1' });
  const request = { model: 'ds4-model', temperature: 0.1 };
  const result = await fx.handler({ message: '/openwiki /repo with space init', session: fx.session, sessionKey: 's1', request, engine: 'native' });
  assert.equal(result.ok, true);
  assert.deepEqual(fx.calls.find(([name]) => name === 'run')[1], {
    sessionKey: 's1', kind: 'init', root: '/repo with space', request, engine: 'native', modelContext: { request }, signal: undefined,
  });
  assert.equal(result.payload.openwiki.pageCount, 2);
});

test('requires Agent Mode, start, matching workspace and valid command syntax', async () => {
  const fx = fixture();
  const inactive = { ...fx.session, active: false };
  assert.equal((await fx.handler({ message: '/openwiki start', session: inactive, sessionKey: 's1' })).payload.code, 'AGENT_MODE_REQUIRED');
  assert.equal((await fx.handler({ message: '/openwiki /repo with space init', session: fx.session, sessionKey: 's1' })).payload.code, 'OPENWIKI_NOT_STARTED');
  await fx.handler({ message: '/openwiki start', session: fx.session, sessionKey: 's1' });
  assert.equal((await fx.handler({ message: '/openwiki /elsewhere init', session: fx.session, sessionKey: 's1' })).payload.code, 'OPENWIKI_PATH_INVALID');
  assert.equal((await fx.handler({ message: '/openwiki start unexpected', session: fx.session, sessionKey: 's1' })).payload.code, 'OPENWIKI_USAGE_INVALID');
});

test('reports generation failures with a stable code and no internal error detail', async () => {
  const fx = fixture({ error: Object.assign(new Error('/home/user/private/gateway.json leaked'), { code: 'MODEL_TOOL_CALL_UNSUPPORTED' }) });
  await fx.handler({ message: '/openwiki start', session: fx.session, sessionKey: 's1' });
  const result = await fx.handler({ message: '/openwiki /repo with space init', session: fx.session, sessionKey: 's1' });
  assert.equal(result.payload.code, 'MODEL_TOOL_CALL_UNSUPPORTED');
  assert.equal(JSON.stringify(result.payload).includes('/home/user'), false);
});

test('existing wiki is a conflict with an exact update command, with or without trailing slash', async () => {
  for (const suffix of ['', '/', '///']) {
    const fx = fixture({ error: Object.assign(new Error('private internal details'), { code: 'OPENWIKI_DIR_EXISTS' }) });
    const started = await fx.handler({ message: '/openwiki start', session: fx.session, sessionKey: 's1' });
    assert.match(started.payload.message, /se esiste già, usa \/openwiki \/repo with space update/u);
    const result = await fx.handler({ message: `/openwiki /repo with space${suffix} init`, session: fx.session, sessionKey: 's1' });
    assert.equal(result.ok, false);
    assert.equal(result.status, 409);
    assert.equal(result.payload.code, 'OPENWIKI_DIR_EXISTS');
    assert.match(result.payload.message, /\/openwiki \/repo with space update/u);
    assert.equal(result.payload.message.includes('private internal details'), false);
    assert.equal(fx.calls.find(([name]) => name === 'run')[1].root, '/repo with space');
  }
});

test('missing wiki during update tells the user to initialize it', async () => {
  const fx = fixture({ error: Object.assign(new Error('internal'), { code: 'OPENWIKI_DIR_MISSING' }) });
  await fx.handler({ message: '/openwiki start', session: fx.session, sessionKey: 's1' });
  const result = await fx.handler({ message: '/openwiki /repo with space/ update', session: fx.session, sessionKey: 's1' });
  assert.equal(result.status, 409);
  assert.equal(result.payload.code, 'OPENWIKI_DIR_MISSING');
  assert.match(result.payload.message, /\/openwiki \/repo with space init/u);
});

test('real directory validation accepts trailing slashes without Git and reports invalid paths as 400', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'openwiki-command-path-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const calls = [];
  const status = { enabled: true, root };
  const handler = createOpenWikiAgentCommandHandler({ service: {
    async start() { return status; }, async stop() { return status; }, status() { return status; },
    async run(args) { calls.push(args); return { runId: 'test', pageCount: 1, totalTextBytes: 20 }; },
  } });
  const session = { active: true, setOpenWikiWorkspace() {} };
  assert.equal(existsSync(join(root, '.git')), false);
  for (const action of ['init', 'update']) {
    const result = await handler({ message: `/openwiki ${root}/ ${action}`, session, sessionKey: 's1' });
    assert.equal(result.status, 200);
    assert.equal(calls.at(-1).root, root);
    assert.equal(calls.at(-1).kind, action);
  }
  for (const [path, code] of [[`${root}/missing/`, 'OPENWIKI_PATH_INVALID'], ['relative/path', 'OPENWIKI_USAGE_INVALID']]) {
    const result = await handler({ message: `/openwiki ${path} init`, session, sessionKey: 's1' });
    assert.equal(result.status, 400);
    assert.equal(result.payload.code, code);
    assert.equal(result.payload.message.includes('Git'), false);
  }
  assert.equal(calls.length, 2, 'invalid paths never reach the generation service');
});

test('commands without request parameters follow the active model and preserve explicit overrides', async () => {
  const fx = fixture();
  await fx.handler({ message: '/openwiki start', session: fx.session, sessionKey: 's1' });
  let defaults = { model: 'qwen3.8-flash-next-vitronia', temperature: 0.6 };
  const handler = createOpenWikiAgentCommandHandler({
    service: fx.service,
    validateRoot: root => ({ root, uid: 1000, dev: 1, ino: 2 }),
    getDefaultRequest: () => defaults,
  });
  const invoke = request => handler({ message: '/openwiki /repo with space/ update', session: fx.session, sessionKey: 's1', request });
  assert.equal((await invoke()).status, 200);
  let sent = fx.calls.filter(([name]) => name === 'run').at(-1)[1];
  assert.deepEqual(sent.request, defaults);
  assert.strictEqual(sent.request, sent.modelContext.request);
  defaults = Object.freeze({ model: 'deepseek-v4-flash', temperature: 0.2 });
  assert.equal((await invoke()).status, 200);
  sent = fx.calls.filter(([name]) => name === 'run').at(-1)[1];
  assert.deepEqual(sent.request, defaults);
  assert.equal((await invoke(Object.freeze({ model: 'custom-model', temperature: 0.4 }))).status, 200);
  sent = fx.calls.filter(([name]) => name === 'run').at(-1)[1];
  assert.deepEqual(sent.request, { model: 'custom-model', temperature: 0.4 });
  assert.deepEqual(defaults, { model: 'deepseek-v4-flash', temperature: 0.2 });
});

test('invalid generated plan returns a bounded conflict rather than an internal server error', async () => {
  const fx = fixture({ error: Object.assign(new Error('private plan payload'), { code: 'INVALID_PLAN' }) });
  await fx.handler({ message: '/openwiki start', session: fx.session, sessionKey: 's1' });
  const result = await fx.handler({ message: '/openwiki /repo with space update', session: fx.session, sessionKey: 's1' });
  assert.equal(result.status, 409);
  assert.equal(result.payload.code, 'INVALID_PLAN');
  assert.match(result.payload.message, /Nessuna pagina è stata scritta/u);
  assert.equal(result.payload.message.includes('private plan payload'), false);
});
