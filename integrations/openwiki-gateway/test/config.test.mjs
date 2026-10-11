// WP03 config validation. Every fixture lives in a private temp directory;
// nothing reads or writes the user checkout, and git runs without user config.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigError, getWorkspace, loadConfig, parseJsonStrict, validateWorkspaceRoot, verifyUpstream } from '../src/config.mjs';

const GIT_ENV = { PATH: '/usr/bin:/bin', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', LC_ALL: 'C' };
const bases = [];
after(() => {
  for (const base of bases) rmSync(base, { recursive: true, force: true });
});

function initRepo(dir) {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  execFileSync('/usr/bin/git', ['init', '-q', dir], { env: { ...GIT_ENV, HOME: dir }, stdio: 'ignore', timeout: 5000 });
  chmodSync(dir, 0o700);
  return dir;
}

function makeFixture(ids = ['alpha']) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'ow-wp03-cfg-')));
  bases.push(base);
  chmodSync(base, 0o700);
  const release = join(base, 'release');
  mkdirSync(join(release, 'dist', 'cli'), { recursive: true, mode: 0o700 });
  const exe = join(release, 'dist', 'cli', 'cli.js');
  writeFileSync(exe, '// fake pinned upstream\n', { mode: 0o600 });
  const roots = Object.fromEntries(ids.map((id) => [id, initRepo(join(base, `ws-${id}`))]));
  const etc = join(base, 'etc');
  mkdirSync(etc, { mode: 0o700 });
  const file = join(etc, 'gateway.json');
  const doc = {
    schema: 1,
    listen: { transport: 'unix', socketPath: join(base, 'gw.sock') },
    upstream: { node: process.execPath, releaseDir: release, executable: exe },
    workspaces: Object.fromEntries(ids.map((id) => [id, { root: roots[id] }])),
  };
  const write = (value = doc) => {
    writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value), { mode: 0o600 });
    chmodSync(file, 0o600);
    return file;
  };
  write();
  return { base, release, exe, roots, file, doc, write };
}

const clone = (v) => JSON.parse(JSON.stringify(v));
const rejects = (fn, pattern) => assert.throws(fn, (err) => err instanceof ConfigError && pattern.test(err.message));

test('valid config loads with canonical roots and frozen result', () => {
  const fx = makeFixture(['alpha', 'beta']);
  const cfg = loadConfig(fx.file);
  assert.equal(cfg.schema, 1);
  assert.equal(cfg.listen.transport, 'unix');
  assert.equal(getWorkspace(cfg, 'alpha').root, fx.roots.alpha);
  assert.equal(getWorkspace(cfg, 'beta').root, fx.roots.beta);
  assert.ok(Object.isFrozen(cfg) && Object.isFrozen(cfg.workspaces) && Object.isFrozen(cfg.workspaces.alpha));
  assert.equal(verifyUpstream(cfg), true);
  assert.throws(() => getWorkspace(cfg, 'gamma'), ConfigError);
  assert.throws(() => getWorkspace(cfg, 'ALPHA'), ConfigError);
});

test('legacy executable digest is accepted but is not enforced', () => {
  const fx = makeFixture();
  const config = clone(fx.doc);
  config.upstream.expectedSha256 = '0'.repeat(64);
  const loaded = loadConfig(fx.write(config));
  writeFileSync(fx.exe, '// content changed in place\n');
  assert.equal(verifyUpstream(loaded), true);
});

test('schema, transport and socket path are strict', () => {
  const fx = makeFixture();
  rejects(() => loadConfig(fx.write({ ...fx.doc, schema: 2 })), /schema/);
  rejects(() => loadConfig(fx.write({ ...fx.doc, listen: { transport: 'tcp', socketPath: '/x.sock' } })), /unix/);
  rejects(() => loadConfig(fx.write({ ...fx.doc, listen: { transport: 'unix', socketPath: 'rel.sock' } })), /absolute/);
  rejects(() => loadConfig(fx.write({ ...fx.doc, listen: { transport: 'unix', socketPath: '/a/../b.sock' } })), /normalized/);
  rejects(() => loadConfig(fx.write({ ...fx.doc, listen: { transport: 'unix', socketPath: `/${'s'.repeat(120)}` } })), /bytes/);
  rejects(() => loadConfig(fx.write({ ...fx.doc, extra: true })), /unknown key/);
});

test('JSON duplicate keys and trailing data are rejected', () => {
  assert.throws(() => parseJsonStrict('{"a":1,"a":2}'), /duplicate/);
  assert.throws(() => parseJsonStrict('{"a":1} x'), /trailing/);
  assert.deepEqual({ ...parseJsonStrict('{"a":[1,"x",true,null]}') }, { a: [1, 'x', true, null] });
  const fx = makeFixture();
  const text = JSON.stringify(fx.doc).replace('"schema":1', '"schema":1,"schema":1');
  rejects(() => loadConfig(fx.write(text)), /duplicate/);
});

test('upstream executable must be a regular file inside the pinned release directory', () => {
  const fx = makeFixture();
  const link = join(fx.release, 'dist', 'cli', 'link.js');
  symlinkSync(fx.exe, link);
  const viaLink = clone(fx.doc);
  viaLink.upstream.executable = link;
  rejects(() => loadConfig(fx.write(viaLink)), /symlink/);

  const outside = clone(fx.doc);
  outside.upstream.executable = fx.file;
  rejects(() => loadConfig(fx.write(outside)), /inside upstream.releaseDir/);
});

test('replacing executable inode after startup is detected', () => {
  const fx = makeFixture();
  const cfg = loadConfig(fx.file);
  const replacement = `${fx.exe}.replacement`;
  writeFileSync(replacement, '// replacement\n', { mode: 0o600 });
  renameSync(replacement, fx.exe);
  rejects(() => verifyUpstream(cfg), /identity changed/);
});

test('workspace allowlist: 1..16 entries and lowercase IDs', () => {
  const fx = makeFixture();
  rejects(() => loadConfig(fx.write({ ...fx.doc, workspaces: {} })), /1\.\.16/);
  const many = Object.fromEntries(Array.from({ length: 17 }, (_, i) => [`w${i}`, { root: fx.roots.alpha }]));
  rejects(() => loadConfig(fx.write({ ...fx.doc, workspaces: many })), /1\.\.16/);
  for (const id of ['Alpha', '-a', 'a_b', 'a'.repeat(65), 'a/b']) {
    rejects(() => loadConfig(fx.write({ ...fx.doc, workspaces: { [id]: { root: fx.roots.alpha } } })), /workspace ID/);
  }
});

test('workspace must exist and is canonicalized without Git requirements', () => {
  const fx = makeFixture();
  rejects(() => loadConfig(fx.write({ ...fx.doc, workspaces: { a: { root: join(fx.base, 'nope') } } })), /not resolvable/);

  const sub = join(fx.roots.alpha, 'sub');
  mkdirSync(sub, { mode: 0o700 });
  assert.equal(loadConfig(fx.write({ ...fx.doc, workspaces: { a: { root: sub } } })).workspaces.a.root, sub);

  const plain = join(fx.base, 'plain');
  mkdirSync(plain, { mode: 0o700 });
  assert.equal(loadConfig(fx.write({ ...fx.doc, workspaces: { a: { root: plain } } })).workspaces.a.root, plain);

  const alias = join(fx.base, 'alias');
  symlinkSync(fx.roots.alpha, alias);
  const cfg = loadConfig(fx.write({ ...fx.doc, workspaces: { a: { root: alias } } }));
  assert.equal(cfg.workspaces.a.root, fx.roots.alpha, 'root is stored as realpath');

  rejects(() => loadConfig(fx.write({ ...fx.doc, workspaces: { a: { root: 'rel/path' } } })), /absolute/);
  rejects(() => loadConfig(fx.write({ ...fx.doc, workspaces: { a: { root: `${fx.roots.alpha}/../ws-alpha` } } })), /normalized/);
});

test('runtime workspace preflight accepts directories and canonicalizes aliases', () => {
  const fx = makeFixture();
  const result = validateWorkspaceRoot(fx.roots.alpha);
  assert.equal(result.root, fx.roots.alpha);
  assert.equal(result.dev > 0, true);
  assert.equal(result.ino > 0, true);

  const alias = join(fx.base, 'root alias');
  symlinkSync(fx.roots.alpha, alias);
  assert.equal(validateWorkspaceRoot(alias).root, fx.roots.alpha);

  const sub = join(fx.roots.alpha, 'nested');
  mkdirSync(sub, { mode: 0o700 });
  assert.equal(validateWorkspaceRoot(sub).root, sub);

  const plain = join(fx.base, 'plain directory');
  mkdirSync(plain, { mode: 0o700 });
  assert.equal(validateWorkspaceRoot(plain).root, plain);
  assert.throws(() => validateWorkspaceRoot(`${fx.roots.alpha}/../ws-alpha`), /normalized/);
  assert.throws(() => validateWorkspaceRoot(fx.roots.alpha, { userHome: fx.roots.alpha }), /user home/);
});

test('runtime workspace preflight accepts Git worktrees with a .git file', () => {
  const fx = makeFixture();
  const repo = fx.roots.alpha;
  writeFileSync(join(repo, 'seed.txt'), 'seed\n', { mode: 0o600 });
  execFileSync('/usr/bin/git', ['-C', repo, 'add', 'seed.txt'], {
    env: { ...GIT_ENV, HOME: fx.base }, stdio: 'ignore', timeout: 5_000,
  });
  execFileSync('/usr/bin/git', [
    '-C', repo, '-c', 'user.name=OpenWiki Test', '-c', 'user.email=openwiki-test@invalid',
    'commit', '-qm', 'seed',
  ], { env: { ...GIT_ENV, HOME: fx.base }, stdio: 'ignore', timeout: 5_000 });
  const worktree = join(fx.base, 'linked worktree');
  execFileSync('/usr/bin/git', ['-C', repo, 'worktree', 'add', '--detach', worktree], {
    env: { ...GIT_ENV, HOME: fx.base }, stdio: 'ignore', timeout: 5_000,
  });
  chmodSync(worktree, 0o700);
  assert.equal(validateWorkspaceRoot(worktree).root, worktree);
});

test('nested or overlapping workspaces are rejected', () => {
  const fx = makeFixture(['alpha']);
  const nested = initRepo(join(fx.roots.alpha, 'nested'));
  rejects(() => loadConfig(fx.write({ ...fx.doc, workspaces: { a: { root: fx.roots.alpha }, b: { root: nested } } })), /overlap/);
});

test('owner and mode: config, its directory and root', () => {
  const fx = makeFixture();
  rejects(() => loadConfig(fx.file, { uid: process.getuid() + 1 }), /owned by uid/);

  chmodSync(fx.file, 0o620);
  rejects(() => loadConfig(fx.file), /group- or world-writable/);
  chmodSync(fx.file, 0o602);
  rejects(() => loadConfig(fx.file), /group- or world-writable/);
  chmodSync(fx.file, 0o600);

  chmodSync(join(fx.base, 'etc'), 0o770);
  rejects(() => loadConfig(fx.file), /config directory/);
  chmodSync(join(fx.base, 'etc'), 0o700);

  chmodSync(fx.roots.alpha, 0o770);
  assert.ok(loadConfig(fx.file));
  chmodSync(fx.roots.alpha, 0o700);
  assert.ok(loadConfig(fx.file));
});

test('config file symlink is rejected', () => {
  const fx = makeFixture();
  const link = join(fx.base, 'etc', 'link.json');
  symlinkSync(fx.file, link);
  rejects(() => loadConfig(link), /symlink/);
});

test('linked wiki workspaces are disabled in the MVP', () => {
  const fx = makeFixture(['alpha', 'beta']);
  const flagged = clone(fx.doc);
  flagged.workspaces.alpha.linked = true;
  rejects(() => loadConfig(fx.write(flagged)), /linked wiki workspaces are disabled/);

  const members = clone(fx.doc);
  members.workspaces.alpha.wikis = ['beta'];
  rejects(() => loadConfig(fx.write(members)), /linked wiki workspaces are disabled/);

  rejects(() => loadConfig(fx.write({ ...fx.doc, linkedWorkspaces: { all: ['alpha', 'beta'] } })), /disabled/);
});
