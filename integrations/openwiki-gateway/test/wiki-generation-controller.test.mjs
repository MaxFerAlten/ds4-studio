import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createWikiGenerationController, GENERATION_STATES } from '../src/wiki-generation-controller.mjs';
import { createWikiGenerationStateStore } from '../src/wiki-generation-state-store.mjs';

function fixture({ begin = { status: 'active', runId: 'run-1', phase: 'planning', resumed: false }, maxJobs = 1 } = {}) {
  const calls = [];
  const writes = [];
  const modelKinds = [];
  const events = [];
  let jobIndex = 0;
  const deps = {
    async callAdmin(tool, args, { signal } = {}) {
      calls.push({ tool, args });
      events.push(tool);
      if (signal?.aborted) throw signal.reason;
      if (tool === 'openwiki_begin') return { structuredContent: begin };
      if (tool === 'openwiki_next_page') {
        if (jobIndex++ >= maxJobs) return { structuredContent: { status: 'complete' } };
        return { structuredContent: { status: 'pending', job: {
          id: `job-${jobIndex}`, path: '/openwiki/quickstart.md', title: `Page ${jobIndex}`,
          purpose: 'Document a source module', mode: 'init', claimsRequiringAttention: [],
        } } };
      }
      if (tool === 'openwiki_inspect_page_claims') return { structuredContent: { page: 'docs/page.md', claims: [] } };
      return { structuredContent: { status: 'complete' } };
    },
    async generate({ kind, signal }) {
      if (signal?.aborted) throw signal.reason;
      modelKinds.push(kind);
      if (kind === 'plan') return { value: { pages: [{ path: '/openwiki/quickstart.md', title: 'Quickstart', purpose: 'Document a source module' }] } };
      return { value: { markdown: '# Page 1\n\nEvidence based.', claims: [], confirmedClaimIds: [], retractedClaimIds: [] } };
    },
    async readContext() { return { files: ['src/module.mjs'] }; },
    async writePage(job, markdown) { events.push('writePage'); writes.push({ job, markdown }); },
  };
  return { controller: createWikiGenerationController(deps, { maxPages: 5, maxTotalTimeMs: 1000 }), calls, writes, modelKinds, events, deps };
}

test('OWG-06 runs pinned lifecycle with DS4 model output and upstream run/job IDs', async () => {
  const fx = fixture();
  const result = await fx.controller.run({ kind: 'init', root: '/tmp/repo', modelContext: { engine: 'ds4' } });
  assert.equal(result.runId, 'run-1');
  assert.equal(result.pageCount, 1);
  assert.equal(fx.controller.snapshot().state, GENERATION_STATES.COMPLETED);
  assert.deepEqual(fx.calls.map(({ tool }) => tool), [
    'openwiki_begin', 'openwiki_submit_plan', 'openwiki_next_page',
    'openwiki_submit_page', 'openwiki_next_page', 'openwiki_finish',
  ]);
  assert.deepEqual(fx.events, [
    'openwiki_begin', 'openwiki_submit_plan', 'openwiki_next_page', 'writePage',
    'openwiki_submit_page', 'openwiki_next_page', 'openwiki_finish',
  ]);
  assert.deepEqual(fx.calls[0].args, { root: '/tmp/repo', mode: 'init' });
  assert.deepEqual(fx.calls[1].args, {
    runId: 'run-1', pages: [{ path: '/openwiki/quickstart.md', title: 'Quickstart', purpose: 'Document a source module' }],
  });
  assert.deepEqual(fx.calls[2].args, { runId: 'run-1' });
  assert.deepEqual(fx.calls[3].args, {
    runId: 'run-1', jobId: 'job-1', confirmedClaimIds: [], retractedClaimIds: [], claims: [],
  });
  assert.equal(Object.hasOwn(fx.calls[3].args, 'markdown'), false);
  assert.equal(fx.writes[0].job.path, '/openwiki/quickstart.md');
  assert.match(fx.writes[0].markdown, /Evidence based/u);
});

test('OWG-06 plan instructions use the upstream string-array contract', async () => {
  for (const instructions of ['Keep evidence explicit', ['Keep evidence explicit']]) {
    const fx = fixture();
    const generated = fx.deps.generate;
    let schema;
    fx.deps.generate = async (request) => {
      const output = await generated(request);
      if (request.kind === 'plan') {
        schema = request.schema;
        output.value.pages[0].instructions = instructions;
      }
      return output;
    };
    await fx.controller.run({ kind: 'init', root: '/tmp/repo' });
    const plan = fx.calls.find(({ tool }) => tool === 'openwiki_submit_plan');
    assert.deepEqual(plan.args.pages[0].instructions, ['Keep evidence explicit']);
    assert.equal(schema.properties.pages.items.properties.instructions.type, 'array');
    assert.equal(schema.properties.pages.items.properties.instructions.items.type, 'string');
  }
});

test('OWG-06 rejects malformed plan instructions before the upstream call', async () => {
  for (const instructions of [42, [''], [false]]) {
    const fx = fixture();
    const generated = fx.deps.generate;
    fx.deps.generate = async (request) => {
      const output = await generated(request);
      if (request.kind === 'plan') output.value.pages[0].instructions = instructions;
      return output;
    };
    await assert.rejects(fx.controller.run({ kind: 'init', root: '/tmp/repo' }));
    assert.equal(fx.calls.some(({ tool }) => tool === 'openwiki_submit_plan'), false);
  }
});

test('OWG-06 accepts upstream update no-op without generating or finishing', async () => {
  const fx = fixture({ begin: { status: 'noop', updatePreflight: {} } });
  const result = await fx.controller.run({ kind: 'update', root: '/tmp/repo' });
  assert.equal(result.noop, true);
  assert.deepEqual(fx.calls.map(({ tool }) => tool), ['openwiki_begin']);
  assert.equal(fx.writes.length, 0);
});

test('OWG-06 resumes a generating run without submitting a new plan', async () => {
  const fx = fixture({ begin: { status: 'active', runId: 'run-resume', phase: 'generating', resumed: true } });
  const result = await fx.controller.run({ kind: 'init', root: '/tmp/repo' });
  assert.equal(result.runId, 'run-resume');
  assert.deepEqual(fx.modelKinds, ['page']);
  assert.equal(fx.calls.some(({ tool }) => tool === 'openwiki_submit_plan'), false);
});

test('OWG-06 fails closed on unknown resumed phase', async () => {
  const fx = fixture({ begin: { status: 'active', runId: 'run-unknown', resumed: true, phase: 'waiting' } });
  await assert.rejects(fx.controller.run({ kind: 'init', root: '/tmp/repo' }), { code: 'UPSTREAM_ERROR' });
  assert.deepEqual(fx.calls.map(({ tool }) => tool), ['openwiki_begin']);
});

test('OWG-06 rejects unsafe model page paths before submitting a plan', async () => {
  const fx = fixture();
  const baseGenerate = fx.controller;
  // Use an injected model with traversal output and ensure the lifecycle stops at planning.
  const unsafe = createWikiGenerationController({
    callAdmin: async (tool, args) => {
      fx.calls.push({ tool, args });
      return { structuredContent: tool === 'openwiki_begin'
        ? { status: 'active', runId: 'run-unsafe', phase: 'planning' } : { status: 'complete' } };
    },
    generate: async () => ({ value: { pages: [{ path: '/openwiki/../outside.md', title: 'Escape', purpose: 'bad' }] } }),
    writePage: async () => assert.fail('must not write'),
  });
  await assert.rejects(unsafe.run({ kind: 'init', root: '/tmp/repo' }), { code: 'INVALID_PLAN' });
  assert.deepEqual(fx.calls.map(({ tool }) => tool), ['openwiki_begin']);
  assert.equal(baseGenerate.snapshot().state, GENERATION_STATES.IDLE);
});

test('OWG-06 preserves resumable upstream state on a page-generation failure', async () => {
  const fx = fixture();
  // Fail the model after the upstream plan has been durably installed.
  const failing = createWikiGenerationController({
    ...{
      callAdmin: async (tool, args) => {
        fx.calls.push({ tool, args });
        if (tool === 'openwiki_begin') return { structuredContent: { status: 'active', runId: 'run-fail', phase: 'planning' } };
        return { structuredContent: { status: 'pending', job: { id: 'job-fail', path: '/openwiki/quickstart.md', title: 'Quickstart', purpose: 'test', claimsRequiringAttention: [] } } };
      },
      generate: async ({ kind }) => kind === 'plan'
        ? { value: { pages: [{ path: '/openwiki/quickstart.md', title: 'Quickstart', purpose: 'test' }] } }
        : { value: {} },
      writePage: async () => assert.fail('invalid model output must not write'),
    },
  });
  await assert.rejects(failing.run({ kind: 'init', root: '/tmp/repo' }), { code: 'MODEL_OUTPUT_INVALID' });
  assert.equal(failing.snapshot().state, GENERATION_STATES.FAILED);
  assert.equal(fx.calls.some(({ tool }) => tool === 'openwiki_finish'), false);
});

test('OWG-06 treats tool-level failures from plan, page, and finish as failures', async () => {
  for (const failedTool of ['openwiki_submit_plan', 'openwiki_submit_page', 'openwiki_finish']) {
    const fx = fixture();
    const controller = createWikiGenerationController({
      ...fx.deps,
      async callAdmin(tool, args, options) {
        if (tool === failedTool) return { isError: true, structuredContent: { code: 'invalid_state' } };
        return fx.deps.callAdmin(tool, args, options);
      },
    }, { maxPages: 5, maxTotalTimeMs: 1000 });
    await assert.rejects(controller.run({ kind: 'init', root: '/tmp/repo' }), { code: 'UPSTREAM_ERROR' }, failedTool);
    assert.equal(controller.snapshot().state, GENERATION_STATES.FAILED, failedTool);
  }
});

test('OWG-06 deadline rejects a hung dependency and leaves the run resumable', async () => {
  const controller = createWikiGenerationController({
    callAdmin: async (tool) => {
      if (tool === 'openwiki_begin') return new Promise(() => {});
      return { structuredContent: {} };
    },
    generate: async () => ({ value: {} }),
    writePage: async () => {},
  }, { maxTotalTimeMs: 25 });
  await assert.rejects(controller.run({ kind: 'init', root: '/tmp/repo' }), { code: 'TIME_LIMIT_EXCEEDED' });
  assert.equal(controller.snapshot().state, GENERATION_STATES.FAILED);
});

test('OWG-06 abort signal is propagated to the active model call', async () => {
  const aborter = new AbortController();
  let modelStarted;
  const started = new Promise((resolve) => { modelStarted = resolve; });
  const controller = createWikiGenerationController({
    callAdmin: async (tool) => ({ structuredContent: tool === 'openwiki_begin'
      ? { status: 'active', runId: 'run-abort', phase: 'planning' } : { status: 'complete' } }),
    generate: async ({ signal }) => {
      modelStarted();
      await new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
      return { value: {} };
    },
    writePage: async () => assert.fail('must not write'),
  });
  const run = controller.run({ kind: 'init', root: '/tmp/repo', signal: aborter.signal });
  await started;
  aborter.abort();
  await assert.rejects(run, { code: 'ABORTED' });
  assert.equal(controller.snapshot().state, GENERATION_STATES.FAILED);
});

test('OWG-06 rejects invalid AbortSignal input without leaving controller busy', async () => {
  const fx = fixture();
  await assert.rejects(fx.controller.run({ kind: 'init', root: '/tmp/repo', signal: {} }), { code: 'INVALID_SIGNAL' });
  assert.equal(fx.controller.snapshot().state, GENERATION_STATES.IDLE);
  assert.deepEqual(fx.calls, []);
});

test('OWG-06 normalizes async undefined read context to an empty bounded context', async () => {
  const fx = fixture();
  const controller = createWikiGenerationController({ ...fx.deps, async readContext() { return undefined; } }, { maxPages: 5, maxTotalTimeMs: 1000 });
  const result = await controller.run({ kind: 'init', root: '/tmp/repo' });
  assert.equal(result.pageCount, 1);
});

const METADATA = Object.freeze({
  baseCommit: 'a'.repeat(40), dirtyAtStart: false, engine: 'ds4', model: 'qwen-test', openwikiVersion: '0.1.0',
});
const RECORD_FIELDS = ['baseCommit', 'createdAt', 'dirtyAtStart', 'engine', 'jobId', 'model',
  'openwikiVersion', 'phase', 'root', 'runId', 'schema', 'updatedAt'];

function recordingStore(t) {
  const dir = mkdtempSync(join(tmpdir(), 'owg07-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const store = createWikiGenerationStateStore({ stateDir: join(dir, 'state') });
  const saved = [];
  return {
    saved, store, dir: join(dir, 'state'),
    stateStore: {
      get: (key) => store.get(key),
      async save(key, record) { saved.push(structuredClone(record)); return store.save(key, record); },
    },
  };
}

function storeController(fx, stateStore) {
  const controller = createWikiGenerationController({ ...fx.deps, stateStore }, { maxPages: 5, maxTotalTimeMs: 1000 });
  return Object.freeze({ ...controller, run: (options) => controller.run({ stateKey: 'session-a', ...options }) });
}

test('OWG-07 persists strict metadata at each lifecycle transition', async (t) => {
  const fx = fixture();
  const st = recordingStore(t);
  const result = await storeController(fx, st.stateStore).run({ kind: 'init', root: '/tmp/repo', metadata: METADATA });
  assert.equal(result.runId, 'run-1');
  assert.deepEqual(st.saved.map(({ phase, runId, jobId }) => [phase, runId, jobId]), [
    ['starting', null, null], ['planning', 'run-1', null], ['generating', 'run-1', null],
    ['generating', 'run-1', 'job-1'], ['completed', 'run-1', null],
  ]);
  for (const record of st.saved) {
    assert.deepEqual(Object.keys(record).sort(), RECORD_FIELDS);
    assert.equal(record.createdAt, st.saved[0].createdAt);
    assert.equal(record.root, '/tmp/repo');
    assert.equal(record.baseCommit, METADATA.baseCommit);
    assert.equal(record.model, METADATA.model);
  }
  for (let index = 1; index < st.saved.length; index++) {
    assert.ok(Date.parse(st.saved[index].updatedAt) >= Date.parse(st.saved[index - 1].updatedAt));
  }
  assert.deepEqual(await st.store.get('session-a'), st.saved.at(-1));
});

test('OWG-07 never persists prompts, source context, page Markdown, or claims', async (t) => {
  const fx = fixture();
  const prompts = [];
  const st = recordingStore(t);
  const controller = createWikiGenerationController({
    ...fx.deps,
    stateStore: st.stateStore,
    async readContext() { return { files: ['SECRET-SOURCE-CONTEXT'] }; },
    async generate(request) {
      prompts.push(request.prompt);
      if (request.kind === 'plan') return fx.deps.generate(request);
      return { value: { markdown: '# SECRET-MARKDOWN', confirmedClaimIds: ['SECRET-CLAIM-ID'], retractedClaimIds: [],
        claims: [{ statement: 'SECRET-CLAIM-STATEMENT', evidence: [{ resource: 'SECRET-EVIDENCE' }] }] } };
    },
  }, { maxPages: 5, maxTotalTimeMs: 1000 });
  await controller.run({ kind: 'init', root: '/tmp/repo', stateKey: 'session-a', metadata: METADATA, modelContext: { secret: 'SECRET-MODEL-CONTEXT' } });
  assert.equal(prompts.length, 2);
  const persisted = JSON.stringify(st.saved) + readdirSync(st.dir).map((name) => readFileSync(join(st.dir, name), 'utf8')).join('');
  for (const secret of ['SECRET-SOURCE-CONTEXT', 'SECRET-MARKDOWN', 'SECRET-CLAIM', 'SECRET-EVIDENCE',
    'SECRET-MODEL-CONTEXT', 'Repository context', 'Write Markdown', 'quickstart.md']) {
    assert.equal(persisted.includes(secret), false, secret);
  }
});

test('OWG-07 persists resumed upstream run and job IDs and keeps the original createdAt', async (t) => {
  const fx = fixture({ begin: { status: 'active', runId: 'run-resume', phase: 'generating', resumed: true } });
  const st = recordingStore(t);
  const earlier = { schema: 1, root: '/tmp/repo', ...METADATA, runId: 'run-resume', jobId: 'job-old', phase: 'failed',
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:05:00.000Z' };
  await st.store.save('session-a', earlier);
  await storeController(fx, st.stateStore).run({ kind: 'init', root: '/tmp/repo', metadata: METADATA });
  assert.deepEqual(st.saved.map(({ phase, runId, jobId }) => [phase, runId, jobId]), [
    ['starting', null, null], ['generating', 'run-resume', null],
    ['generating', 'run-resume', 'job-1'], ['completed', 'run-resume', null],
  ]);
  assert.equal(st.saved.at(-1).createdAt, earlier.createdAt);
  assert.equal(fx.calls.some(({ tool }) => tool === 'openwiki_submit_plan'), false);
});

test('OWG-07 persists failed phase with current run and job IDs without masking the error', async (t) => {
  const fx = fixture();
  const st = recordingStore(t);
  const controller = createWikiGenerationController({
    ...fx.deps,
    stateStore: st.stateStore,
    generate: async (request) => request.kind === 'plan' ? fx.deps.generate(request) : { value: {} },
  }, { maxPages: 5, maxTotalTimeMs: 1000 });
  await assert.rejects(controller.run({ kind: 'init', root: '/tmp/repo', stateKey: 'session-a', metadata: METADATA }), { code: 'MODEL_OUTPUT_INVALID' });
  const stored = await st.store.get('session-a');
  assert.equal(stored.phase, 'failed');
  assert.equal(stored.runId, 'run-1');
  assert.equal(stored.jobId, 'job-1');
  assert.equal(fx.writes.length, 0);
});

test('OWG-07 keeps timestamps monotonic when the clock moves backwards', async (t) => {
  const fx = fixture();
  const st = recordingStore(t);
  await st.store.save('session-a', { schema: 1, root: '/tmp/repo', ...METADATA, runId: null, jobId: null,
    phase: 'completed', createdAt: '2026-06-01T00:00:00.000Z', updatedAt: '2026-06-01T00:00:00.000Z' });
  let clock = Date.parse('2026-05-01T00:00:00.000Z');
  t.mock.method(Date, 'now', () => (clock -= 1000));
  await storeController(fx, st.stateStore).run({ kind: 'init', root: '/tmp/repo', metadata: METADATA });
  for (const [index, record] of st.saved.entries()) {
    assert.ok(Date.parse(record.updatedAt) >= Date.parse('2026-06-01T00:00:00.000Z'));
    assert.ok(Date.parse(record.updatedAt) >= Date.parse(record.createdAt));
    if (index > 0) assert.ok(Date.parse(record.updatedAt) >= Date.parse(st.saved[index - 1].updatedAt));
  }
});

test('OWG-07 rejects missing or invalid metadata before any upstream or store mutation', async (t) => {
  const invalid = [undefined, {}, { ...METADATA, baseCommit: 'not-a-commit' }, { ...METADATA, dirtyAtStart: 'no' },
    { ...METADATA, engine: '' }, { ...METADATA, model: 'x'.repeat(201) }, { ...METADATA, openwikiVersion: 'v\n1' },
    { ...METADATA, prompt: 'extra' }, (({ model, ...rest }) => rest)(METADATA)];
  for (const metadata of invalid) {
    const fx = fixture();
    const st = recordingStore(t);
    const controller = storeController(fx, st.stateStore);
    await assert.rejects(controller.run({ kind: 'init', root: '/tmp/repo', metadata }), { code: 'METADATA_INVALID' });
    assert.deepEqual(fx.calls, []);
    assert.deepEqual(st.saved, []);
    assert.equal(controller.snapshot().state, GENERATION_STATES.IDLE);
  }
});

test('OWG-07 store failure before begin prevents upstream mutation', async () => {
  const fx = fixture();
  const controller = storeController(fx, {
    async get() { return null; },
    async save() { throw Object.assign(new Error('disk full'), { code: 'STATE_WRITE_FAILED' }); },
  });
  await assert.rejects(controller.run({ kind: 'init', root: '/tmp/repo', metadata: METADATA }), { code: 'STATE_WRITE_FAILED' });
  assert.deepEqual(fx.calls, []);
  assert.equal(controller.snapshot().state, GENERATION_STATES.FAILED);
});

test('OWG-07 requires an opaque state key before any store or upstream mutation', async (t) => {
  const fx = fixture();
  const st = recordingStore(t);
  const controller = createWikiGenerationController({ ...fx.deps, stateStore: st.stateStore }, { maxPages: 5 });
  await assert.rejects(controller.run({ kind: 'init', root: '/tmp/repo', metadata: METADATA }), { code: 'STATE_KEY_INVALID' });
  assert.deepEqual(st.saved, []);
  assert.deepEqual(fx.calls, []);
  assert.equal(controller.snapshot().state, GENERATION_STATES.IDLE);
});

test('OWG-07 isolates concurrent sessions for the same repository', async (t) => {
  const first = fixture();
  const second = fixture();
  const st = recordingStore(t);
  await storeController(first, st.stateStore).run({ kind: 'init', root: '/tmp/repo', metadata: METADATA, stateKey: 'session-first' });
  await storeController(second, st.stateStore).run({ kind: 'init', root: '/tmp/repo', metadata: { ...METADATA, model: 'second-session-model' }, stateKey: 'session-second' });
  assert.equal((await st.store.get('session-first')).phase, 'completed');
  assert.equal((await st.store.get('session-second')).phase, 'completed');
  assert.equal((await st.store.get('session-first')).model, METADATA.model);
  assert.equal((await st.store.get('session-second')).model, 'second-session-model');
});

test('OWG-07 refuses a state key already associated with another repository', async (t) => {
  const fx = fixture();
  const st = recordingStore(t);
  await st.store.save('session-a', { schema: 1, root: '/tmp/other-repo', ...METADATA,
    runId: 'old-run', jobId: null, phase: 'failed', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' });
  await assert.rejects(storeController(fx, st.stateStore).run({ kind: 'init', root: '/tmp/repo', metadata: METADATA }), { code: 'STATE_ROOT_MISMATCH' });
  assert.deepEqual(st.saved, []);
  assert.deepEqual(fx.calls, []);
  assert.equal((await st.store.get('session-a')).root, '/tmp/other-repo');
});

test('OWG-07 accepts null baseCommit and persists update no-op as completed', async (t) => {
  const fx = fixture({ begin: { status: 'noop' } });
  const st = recordingStore(t);
  await storeController(fx, st.stateStore).run({ kind: 'update', root: '/tmp/repo',
    metadata: { ...METADATA, baseCommit: null, dirtyAtStart: true } });
  assert.deepEqual(st.saved.map(({ phase, runId }) => [phase, runId]), [['starting', null], ['completed', null]]);
  assert.equal(st.saved.at(-1).baseCommit, null);
});

test('OWG-07 rejects a malformed stateStore and ignores metadata without a store', async () => {
  const fx = fixture();
  assert.throws(() => createWikiGenerationController({ ...fx.deps, stateStore: { save() {} } }), TypeError);
  const result = await fx.controller.run({ kind: 'init', root: '/tmp/repo', metadata: { bogus: true } });
  assert.equal(result.pageCount, 1);
});

test('plan rejects upstream-reserved page paths before submission or page writes', async () => {
  for (const path of ['/openwiki/index.md', '/openwiki/log.md', '/openwiki/instructions.md',
    '/openwiki/Index.md', '/openwiki/_draft.md', '/openwiki/nested/_draft.md',
    '/openwiki/.claims/page.md', '/openwiki/.CLAIMS/page.md', '/openwiki/page.MD']) {
    const fx = fixture();
    fx.deps.generate = async () => ({ value: { pages: [{ path, title: 'Page', purpose: 'Test' }] } });
    await assert.rejects(fx.controller.run({ kind: 'update', root: '/tmp/repo' }), { code: 'INVALID_PLAN' });
    assert.deepEqual(fx.calls.map(c => c.tool), ['openwiki_begin']);
    assert.deepEqual(fx.writes, []);
  }
});

test('plan rejects reserved or noncanonical relatedPages as well as page paths', async () => {
  for (const related of ['/openwiki/index.md', '/openwiki/_scratch.md', '/openwiki/.claims/page.md', 'overview.md']) {
    const fx = fixture();
    fx.deps.generate = async () => ({ value: { pages: [{
      path: '/openwiki/overview.md', title: 'Overview', purpose: 'Test', relatedPages: [related],
    }] } });
    await assert.rejects(fx.controller.run({ kind: 'update', root: '/tmp/repo' }), { code: 'INVALID_PLAN' });
    assert.deepEqual(fx.calls.map(c => c.tool), ['openwiki_begin']);
    assert.deepEqual(fx.writes, []);
  }
});

test('init and update planners receive the upstream structural-path rules', async () => {
  for (const kind of ['init', 'update']) {
    const fx = fixture({ maxJobs: 0 });
    const original = fx.deps.generate;
    let prompt;
    fx.deps.generate = async request => { prompt = request.prompt; return original(request); };
    await fx.controller.run({ kind, root: '/tmp/repo' });
    for (const token of ['index.md', 'log.md', 'instructions.md', '.claims', 'basename starting with _', 'pages or relatedPages']) {
      assert(prompt.includes(token));
    }
    assert(prompt.includes('OpenWiki builds index.md itself'));
  }
});
