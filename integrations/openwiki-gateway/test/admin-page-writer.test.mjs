import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { loadConfig } from '../src/config.mjs';
import { createAdminPageWriter } from '../src/admin-page-writer.mjs';

const gitEnv = { PATH: '/usr/bin:/bin', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', LC_ALL: 'C' };
const roots = [];
function fixture() {
  const base = mkdtempSync(join(tmpdir(), 'ow-page-writer-'));
  roots.push(base);
  chmodSync(base, 0o700);
  const release = join(base, 'release');
  mkdirSync(join(release, 'dist', 'cli'), { recursive: true, mode: 0o700 });
  const executable = join(release, 'dist', 'cli', 'cli.js');
  writeFileSync(executable, '// pinned fake upstream\n', { mode: 0o600 });
  const fakeBwrap = join(release, 'fake-bwrap');
  writeFileSync(fakeBwrap, '#!/bin/sh\nexit 0\n', { mode: 0o700 });
  const workspaceRoot = join(base, 'repo');
  mkdirSync(workspaceRoot, { mode: 0o700 });
  execFileSync('/usr/bin/git', ['init', '-q', workspaceRoot], { env: { ...gitEnv, HOME: base }, stdio: 'ignore', timeout: 5000 });
  chmodSync(workspaceRoot, 0o700);
  mkdirSync(join(workspaceRoot, 'openwiki'), { mode: 0o700 });
  const configPath = join(base, 'gateway.json');
  const bytes = '// pinned fake upstream\n';
  writeFileSync(configPath, JSON.stringify({
    schema: 1,
    listen: { transport: 'unix', socketPath: join(base, 'read.sock') },
    upstream: {
      node: executable, releaseDir: release, executable,
    },
    sandbox: { bwrap: fakeBwrap },
    workspaces: { alpha: { root: workspaceRoot } },
  }), { mode: 0o600 });
  return { base, workspaceRoot, config: loadConfig(configPath) };
}

after(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });

function fakeChild({ closeOnTerm = true } = {}) {
  const child = new EventEmitter();
  child.signals = [];
  child.kill = (signal) => {
    child.signals.push(signal);
    if (signal === 'SIGKILL' || (signal === 'SIGTERM' && closeOnTerm)) setImmediate(() => child.emit('close', 0, null));
  };
  return child;
}

test('writer builds a shell-free ADMIN sandbox invocation for openwiki only', async () => {
  const fx = fixture();
  let captured;
  const child = fakeChild();
  const writer = createAdminPageWriter(fx.config, 'alpha', {
    spawnImpl: (file, args, options) => { captured = { file, args, options }; setImmediate(() => child.emit('close', 0, null)); return child; },
  });
  assert.deepEqual(await writer.writePage({ path: '/openwiki/guide/start.md' }, '# Start\n'), {
    path: '/openwiki/guide/start.md', bytes: 8,
  });
  assert.equal(captured.file, join(fx.config.upstream.releaseDir, 'fake-bwrap'));
  assert.equal(captured.options.shell, false);
  assert.equal(captured.options.stdio, 'ignore');
  assert.deepEqual(captured.options.env, {
    PATH: `${join(fx.config.upstream.releaseDir, 'dist', 'cli', 'bin')}:/usr/bin:/bin`, HOME: '/home/openwiki', TMPDIR: '/tmp',
    OPENWIKI_CONFIG_DIR: '/home/openwiki/.openwiki', LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8',
  });
  assert.ok(captured.args.includes('--unshare-net'));
  assert.ok(captured.args.includes('--ro-bind') && captured.args.includes(fx.workspaceRoot));
  const wiki = join(fx.workspaceRoot, 'openwiki');
  const bindIndex = captured.args.findIndex((arg, index) => arg === '--bind' && captured.args[index + 1] === wiki);
  assert.ok(bindIndex >= 0, 'only openwiki is mounted writable');
  const commandIndex = captured.args.indexOf('--') + 1;
  assert.equal(captured.args[commandIndex], fx.config.upstream.node);
  assert.equal(captured.args[commandIndex + 1], '-e');
  assert.equal(captured.args[commandIndex + 3], join(fx.workspaceRoot, 'openwiki', 'guide', 'start.md'));
  assert.equal(captured.args[commandIndex + 4], '# Start\n');
  assert.match(captured.args[commandIndex + 2], /O_NOFOLLOW/u);
});

test('rejects traversal, symlink-like segments, NUL and oversized content before spawn', async () => {
  const fx = fixture();
  let spawnCount = 0;
  const writer = createAdminPageWriter(fx.config, 'alpha', { spawnImpl: () => { spawnCount++; return fakeChild(); } });
  for (const page of ['/openwiki/../secret.md', '/openwiki/a//b.md', '/openwiki/a/./b.md', '/openwiki/a\\b.md', '/openwiki/a.txt']) {
    await assert.rejects(writer.writePage({ path: page }, 'content'), { code: 'INVALID_PAGE_PATH' });
  }
  await assert.rejects(writer.writePage({ path: '/openwiki/a.md' }, 'bad\0content'), { code: 'INVALID_PAGE_CONTENT' });
  await assert.rejects(writer.writePage({ path: '/openwiki/a.md' }, 'x'.repeat(1024 * 1024 + 1)), { code: 'INVALID_PAGE_CONTENT' });
  assert.equal(spawnCount, 0);
});

test('backs up an existing wiki page before replacing it during update', async () => {
  const fx = fixture();
  const wiki = join(fx.workspaceRoot, 'openwiki');
  const page = join(wiki, 'guide.md');
  writeFileSync(page, '# User edits\n', { mode: 0o600 });
  const writer = createAdminPageWriter(fx.config, 'alpha', {
    spawnImpl: (_file, args, options) => {
      const child = fakeChild();
      const separator = args.indexOf('--');
      try {
        execFileSync(process.execPath, args.slice(separator + 2), { cwd: fx.workspaceRoot, env: options.env, timeout: 5000 });
        setImmediate(() => child.emit('close', 0, null));
      } catch {
        setImmediate(() => child.emit('close', 1, null));
      }
      return child;
    },
  });
  await writer.writePage({ path: '/openwiki/guide.md' }, '# Generated update\n');
  assert.equal(readFileSync(page, 'utf8'), '# Generated update\n');
  const backupDir = join(wiki, '.ds4-studio-backups');
  const backupName = createHash('sha256').update('# User edits\n').digest('hex') + '.bak';
  assert.equal(readFileSync(join(backupDir, backupName), 'utf8'), '# User edits\n');
});

test('timeout escalates TERM to KILL and reports the bounded timeout', async () => {
  const fx = fixture();
  const child = fakeChild({ closeOnTerm: false });
  const writer = createAdminPageWriter(fx.config, 'alpha', { spawnImpl: () => child, timeoutMs: 20 });
  await assert.rejects(writer.writePage({ path: '/openwiki/a.md' }, 'content'), { code: 'WRITE_TIMEOUT' });
  assert.deepEqual(child.signals, ['SIGTERM', 'SIGKILL']);
});

test('abort sends TERM and waits for child close', async () => {
  const fx = fixture();
  const child = fakeChild();
  const writer = createAdminPageWriter(fx.config, 'alpha', { spawnImpl: () => child });
  const controller = new AbortController();
  const pending = writer.writePage({ path: '/openwiki/a.md' }, 'content', { signal: controller.signal });
  setImmediate(() => controller.abort());
  await assert.rejects(pending, { code: 'ABORT_ERR' });
  assert.deepEqual(child.signals, ['SIGTERM']);
});
