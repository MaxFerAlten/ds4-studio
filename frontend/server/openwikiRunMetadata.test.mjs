import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { collectOpenWikiRunMetadata, collectOpenWikiWorkspaceSnapshot } from './openwikiRunMetadata.mjs';

function fakeGit({ head = `${'a'.repeat(40)}\n`, status = Buffer.alloc(0), headError = null, statusError = null } = {}) {
  const calls = [];
  const execFileImpl = (file, args, options, callback) => {
    calls.push({ file, args, options });
    const isHead = args.at(-1) === 'HEAD';
    const error = isHead ? headError : statusError;
    if (error) callback(error, Buffer.alloc(0), Buffer.from('details must not escape'));
    else callback(null, isHead ? Buffer.from(head) : status, Buffer.alloc(0));
  };
  return { calls, execFileImpl };
}

test('records only current commit, dirty bit, engine, model and pinned version', async () => {
  const git = fakeGit({ status: Buffer.from(' M src/main.c\0?? new.md\0') });
  const metadata = await collectOpenWikiRunMetadata({ root: '/repo', engine: 'native', model: 'selected-model', execFileImpl: git.execFileImpl });
  assert.deepEqual(metadata, { baseCommit: 'a'.repeat(40), dirtyAtStart: true, engine: 'native', model: 'selected-model', openwikiVersion: '0.7.1' });
  assert.equal(git.calls.length, 2);
  assert.ok(git.calls.every(({ file, args, options }) => file === '/usr/bin/git' && args[0] === '-C' && args[1] === '/repo' && options.timeout === 5000));
  assert.equal(JSON.stringify(metadata).includes('src/main.c'), false);
});

test('supports an unborn repository and reports a clean working tree', async () => {
  const git = fakeGit({ headError: Object.assign(new Error('no HEAD'), { code: 128 }) });
  const metadata = await collectOpenWikiRunMetadata({ root: '/repo', engine: 'js', model: 'model', execFileImpl: git.execFileImpl });
  assert.equal(metadata.baseCommit, null);
  assert.equal(metadata.dirtyAtStart, false);
});

test('fails closed on Git errors and invalid metadata without exposing stderr', async () => {
  const git = fakeGit({ statusError: Object.assign(new Error('failed'), { code: 2 }) });
  await assert.rejects(collectOpenWikiRunMetadata({ root: '/repo', engine: 'js', model: 'model', execFileImpl: git.execFileImpl }), {
    code: 'GIT_METADATA_FAILED', message: 'could not read repository status',
  });
  await assert.rejects(collectOpenWikiRunMetadata({ root: '/repo', engine: 'js', model: '', execFileImpl: git.execFileImpl }), { code: 'METADATA_INVALID' });
  assert.equal(git.calls.length, 2);
});

test('propagates caller abort before launching Git', async () => {
  const git = fakeGit();
  const abort = new AbortController();
  abort.abort();
  await assert.rejects(collectOpenWikiRunMetadata({ root: '/repo', engine: 'js', model: 'model', execFileImpl: git.execFileImpl, signal: abort.signal }));
  assert.equal(git.calls.length, 0);
});

test('captures only bounded NUL-safe status paths under openwiki/', async () => {
  const git = fakeGit({ status: Buffer.from(' M openwiki/user edit.md\0?? openwiki/new.md\0') });
  const entries = await collectOpenWikiWorkspaceSnapshot({ root: '/repo', execFileImpl: git.execFileImpl });
  assert.deepEqual(entries, [
    { status: ' M', path: 'openwiki/user edit.md' },
    { status: '??', path: 'openwiki/new.md' },
  ]);
  assert.deepEqual(git.calls[0].args.slice(-2), ['--', 'openwiki/']);
});

test('fails closed when scoped Git status is malformed or exceeds its path bound', async () => {
  const malformed = fakeGit({ status: Buffer.from(' M outside.md\0') });
  await assert.rejects(collectOpenWikiWorkspaceSnapshot({ root: '/repo', execFileImpl: malformed.execFileImpl }), { code: 'GIT_METADATA_INVALID' });
  const tooMany = fakeGit({ status: Buffer.from(' M openwiki/a.md\0 M openwiki/b.md\0') });
  await assert.rejects(collectOpenWikiWorkspaceSnapshot({ root: '/repo', maxPaths: 1, execFileImpl: tooMany.execFileImpl }), { code: 'GIT_METADATA_TOO_LARGE' });
});

test('hashes only bounded files inside openwiki and never follows a symlink', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ow-metadata-snapshot-'));
  try {
    const wiki = join(root, 'openwiki');
    mkdirSync(wiki, { mode: 0o700 });
    writeFileSync(join(wiki, 'page.md'), '# before\n');
    writeFileSync(join(root, 'outside-secret.txt'), 'outside must not be read');
    symlinkSync(join(root, 'outside-secret.txt'), join(wiki, 'escape.md'));
    const before = await collectOpenWikiWorkspaceSnapshot({ root, execFileImpl: fakeGit().execFileImpl });
    assert.deepEqual(before.map(({ path, kind }) => ({ path, kind })), [
      { path: 'openwiki/escape.md', kind: 'symlink' }, { path: 'openwiki/page.md', kind: 'file' },
    ]);
    const previousHash = before.find((entry) => entry.path.endsWith('page.md')).sha256;
    writeFileSync(join(wiki, 'page.md'), '# after\n');
    const after = await collectOpenWikiWorkspaceSnapshot({ root, execFileImpl: fakeGit().execFileImpl });
    assert.notEqual(after.find((entry) => entry.path.endsWith('page.md')).sha256, previousHash);
    assert.equal(JSON.stringify(after).includes('outside must not be read'), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
