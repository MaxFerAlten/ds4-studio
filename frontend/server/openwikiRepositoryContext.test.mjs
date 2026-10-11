import assert from 'node:assert/strict';
import { chmodSync, lstatSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { createOpenWikiRepositoryContext } from './openwikiRepositoryContext.mjs';

const roots = [];
function fixture() {
  const base = mkdtempSync(join(tmpdir(), 'ow-context-'));
  roots.push(base);
  chmodSync(base, 0o700);
  const root = join(base, 'repo');
  mkdirSync(root, { mode: 0o700 });
  mkdirSync(join(root, 'src'), { mode: 0o700 });
  const stat = lstatSync(root);
  const validateRoot = (candidate) => {
    if (candidate !== root) throw Object.assign(new Error('root mismatch'), { code: 'INVALID_ROOT' });
    return { root, dev: stat.dev, ino: stat.ino, uid: process.getuid(), id: 'fixture' };
  };
  return { base, root, readContext: createOpenWikiRepositoryContext({ validateRoot }) };
}

after(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });

test('reads bounded repository seeds and excludes secret-looking paths', async () => {
  const fx = fixture();
  writeFileSync(join(fx.root, 'README.md'), '# project\noverview\n');
  writeFileSync(join(fx.root, 'src', 'engine.mjs'), 'export const engine = true;\n');
  writeFileSync(join(fx.root, '.env'), 'SECRET=do-not-read');
  const result = await fx.readContext({ root: fx.root, job: { seedPaths: ['src/engine.mjs', '.env', '../outside.md'] } });
  assert.deepEqual(result.files.map(({ path }) => path), ['src/engine.mjs', 'README.md']);
  assert.match(result.files[0].content, /engine = true/u);
  assert.equal(JSON.stringify(result).includes('do-not-read'), false);
  assert.ok(result.totalBytes <= 128 * 1024);
});

test('rejects symlink escapes, binary files and oversized source without leaking content', async () => {
  const fx = fixture();
  const outside = join(fx.base, 'outside.md');
  writeFileSync(outside, 'OUTSIDE-SECRET');
  symlinkSync(outside, join(fx.root, 'src', 'escape.md'));
  writeFileSync(join(fx.root, 'src', 'binary.md'), Buffer.from([0, 1, 2]));
  writeFileSync(join(fx.root, 'src', 'large.md'), 'x'.repeat(33 * 1024));
  const result = await fx.readContext({ root: fx.root, job: { seedPaths: ['src/escape.md', 'src/binary.md', 'src/large.md'] } });
  assert.deepEqual(result.files, []);
  assert.equal(JSON.stringify(result).includes('OUTSIDE-SECRET'), false);
  assert.equal(result.totalBytes, 0);
});

test('bounds the number of files and total returned bytes', async () => {
  const fx = fixture();
  const paths = [];
  for (let index = 0; index < 20; index++) {
    const name = `src/${String(index).padStart(2, '0')}.md`;
    writeFileSync(join(fx.root, name), 'x'.repeat(12 * 1024));
    paths.push(name);
  }
  const result = await fx.readContext({ root: fx.root, job: { seedPaths: paths } });
  assert.equal(result.files.length, 10); // the 128 KiB aggregate byte budget stops further reads
  assert.ok(result.totalBytes <= 128 * 1024);
  assert.ok(result.files.every(({ content }) => Buffer.byteLength(content) <= 12 * 1024));
});

test('rejects non-canonical root and honors abort before reading', async () => {
  const fx = fixture();
  await assert.rejects(fx.readContext({ root: '/tmp/not-the-repository' }), { code: 'INVALID_ROOT' });
  const abort = new AbortController();
  abort.abort();
  await assert.rejects(fx.readContext({ root: fx.root, signal: abort.signal }));
});
