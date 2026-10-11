import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmodSync, lstatSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { createWikiGenerationStateStore } from '../src/wiki-generation-state-store.mjs';

const roots = [];
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'ow-state-store-'));
  roots.push(root);
  chmodSync(root, 0o700);
  const stateDir = join(root, 'state');
  const store = createWikiGenerationStateStore({ stateDir });
  const timestamp = new Date().toISOString();
  const record = {
    schema: 1,
    root: join(root, 'repo'),
    baseCommit: 'a'.repeat(40),
    dirtyAtStart: false,
    engine: 'js',
    model: 'ds4-test-model',
    openwikiVersion: '0.7.1',
    runId: null,
    jobId: null,
    phase: 'starting',
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  return { root, stateDir, store, record };
}

after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

test('state store persists only metadata with private permissions', async () => {
  const fx = fixture();
  assert.equal(await fx.store.get('session:one'), null);
  await fx.store.save('session:one', fx.record);
  assert.deepEqual(await fx.store.get('session:one'), fx.record);
  assert.equal(lstatSync(fx.stateDir).mode & 0o777, 0o700);
  const [name] = readdirSync(fx.stateDir);
  assert.match(name, /^[a-f0-9]{64}\.json$/u);
  assert.equal(name.includes('session'), false);
  assert.equal(lstatSync(join(fx.stateDir, name)).mode & 0o777, 0o600);
});

test('atomic replacement leaves one valid latest state file', async () => {
  const fx = fixture();
  await fx.store.save('session:two', fx.record);
  const updated = { ...fx.record, phase: 'generating', runId: 'run-1', updatedAt: new Date(Date.parse(fx.record.createdAt) + 1).toISOString() };
  await fx.store.save('session:two', updated);
  assert.deepEqual(await fx.store.get('session:two'), updated);
  assert.deepEqual(readdirSync(fx.stateDir), [`${createHash('sha256').update('session:two').digest('hex')}.json`]);
  assert.equal(await fx.store.remove('session:two'), true);
  assert.equal(await fx.store.get('session:two'), null);
  assert.equal(await fx.store.remove('session:two'), false);
});

test('key hashing isolates filenames from raw session identifiers', async () => {
  const fx = fixture();
  const key = '../../private/session id';
  await fx.store.save(key, fx.record);
  const names = readdirSync(fx.stateDir);
  assert.deepEqual(names, [`${createHash('sha256').update(key).digest('hex')}.json`]);
});

test('rejects invalid or content-bearing state records', async () => {
  const fx = fixture();
  for (const invalid of [
    { ...fx.record, prompt: 'do not persist' },
    { ...fx.record, pageContent: '# wiki' },
    { ...fx.record, root: 'relative/path' },
    { ...fx.record, schema: 2 },
    { ...fx.record, phase: 'unknown' },
    { ...fx.record, dirtyAtStart: 'false' },
    { ...fx.record, baseCommit: 'not-a-commit' },
    { ...fx.record, updatedAt: 'not-a-date' },
  ]) {
    await assert.rejects(fx.store.save('invalid', invalid), { code: 'STATE_RECORD_INVALID' });
  }
  assert.deepEqual(readdirSync(fx.stateDir), []);
});

test('rejects a symlinked state directory', () => {
  const fx = fixture();
  const link = join(fx.root, 'state-link');
  symlinkSync(fx.stateDir, link);
  assert.throws(() => createWikiGenerationStateStore({ stateDir: link }), { code: 'STATE_DIR_UNSAFE' });
});

test('rejects symlink state files on read and save', async () => {
  const fx = fixture();
  const key = 'symlink-key';
  const hashed = createHash('sha256').update(key).digest('hex');
  symlinkSync(join(fx.root, 'target'), join(fx.stateDir, `${hashed}.json`));
  await assert.rejects(fx.store.get(key), { code: 'STATE_FILE_UNSAFE' });
  await assert.rejects(fx.store.save(key, fx.record), { code: 'STATE_FILE_UNSAFE' });
  assert.equal(readdirSync(fx.stateDir).length, 1);
});

test('rejects truncated or malformed persisted JSON', async () => {
  const fx = fixture();
  const key = 'corrupt-key';
  const hashed = createHash('sha256').update(key).digest('hex');
  writeFileSync(join(fx.stateDir, `${hashed}.json`), '{"schema":', { mode: 0o600 });
  await assert.rejects(fx.store.get(key), { code: 'STATE_FILE_INVALID' });
});

test('rejects state directories with unsafe permissions', () => {
  const fx = fixture();
  chmodSync(fx.stateDir, 0o750);
  assert.throws(() => createWikiGenerationStateStore({ stateDir: fx.stateDir }), { code: 'STATE_DIR_UNSAFE' });
});
