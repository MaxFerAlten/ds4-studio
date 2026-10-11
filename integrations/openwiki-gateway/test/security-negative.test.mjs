// WP03 security-negative tests: traversal, symlink escape/swap, root identity
// and OS confinement of the child. Everything runs inside private temp dirs;
// the sandboxed child has no network namespace. The confinement test FAILS
// (does not skip) when bubblewrap cannot run: the WP03 gate is not met then.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { getWorkspace, isWithin, loadConfig } from '../src/config.mjs';
import {
  PathError,
  SANDBOX_HOME,
  assertRootIdentity,
  assertSandboxUsable,
  buildAdminSandboxInvocation,
  buildSandboxInvocation,
  resolveInRoot,
  validateRelativeHint,
} from '../src/safe-paths.mjs';

const GIT_ENV = { PATH: '/usr/bin:/bin', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', LC_ALL: 'C' };
const CHILD_TIMEOUT_MS = 4000;
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

// Fake upstream child: reports what it can see as JSON. Lives in the release
// dir so it is mounted inside the sandbox like the real cli.js would be.
const FAKE_CHILD = `
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
const [allowed, viaSymlink, denied, deniedDir, configFile, hostHome, hostPid] = process.argv.slice(2);
const probe = (fn) => { try { return { ok: true, value: fn() }; } catch (e) { return { ok: false, code: e.code }; } };
process.stdout.write(JSON.stringify({
  allowed: probe(() => readFileSync(allowed, 'utf8')),
  viaSymlink: probe(() => readFileSync(viaSymlink, 'utf8')),
  denied: probe(() => readFileSync(denied, 'utf8')),
  deniedDir: probe(() => readdirSync(deniedDir)),
  config: probe(() => readFileSync(configFile, 'utf8')),
  hostHome: probe(() => readdirSync(hostHome)),
  hostOpenWiki: existsSync(hostHome + '/.openwiki'),
  hostPidVisible: existsSync('/proc/' + hostPid),
  writeRoot: probe(() => writeFileSync(allowed + '.w', 'x')),
  writeHome: probe(() => writeFileSync(process.env.HOME + '/scratch', 'x')),
  linkRegistry: existsSync(process.env.OPENWIKI_CONFIG_DIR + '/wiki-workspaces.json'),
  home: process.env.HOME,
  cwd: process.cwd(),
  interfaces: Object.keys(networkInterfaces()),
}));
`;

function makeFixture() {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'ow-wp03-sec-')));
  bases.push(base);
  chmodSync(base, 0o700);
  const release = join(base, 'release');
  mkdirSync(join(release, 'dist', 'cli'), { recursive: true, mode: 0o700 });
  const exe = join(release, 'dist', 'cli', 'cli.js');
  writeFileSync(exe, '// fake pinned upstream\n', { mode: 0o600 });
  const child = join(release, 'fake-child.mjs');
  writeFileSync(child, FAKE_CHILD, { mode: 0o600 });

  const alpha = initRepo(join(base, 'ws-alpha'));
  const beta = initRepo(join(base, 'ws-beta'));
  mkdirSync(join(alpha, 'docs'), { mode: 0o700 });
  writeFileSync(join(alpha, 'docs', 'readme.md'), 'ALPHA-VISIBLE\n', { mode: 0o600 });
  writeFileSync(join(beta, 'secret.txt'), 'BETA-SECRET\n', { mode: 0o600 });
  const outside = join(base, 'outside');
  mkdirSync(outside, { mode: 0o700 });
  writeFileSync(join(outside, 'secret.txt'), 'OUTSIDE-SECRET\n', { mode: 0o600 });

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
      workspaces: { alpha: { root: alpha }, beta: { root: beta } },
    }),
    { mode: 0o600 },
  );
  chmodSync(file, 0o600);
  return { base, release, child, alpha, beta, outside, file, config: loadConfig(file) };
}

const pathError = (pattern) => (err) => err instanceof PathError && pattern.test(err.message);

test('hint validation rejects traversal, absolute, NUL, drive, backslash, CRLF, confusables', () => {
  const cases = [
    ['', /non-empty/],
    ['../x', /"\.\."/],
    ['a/../../x', /"\.\."/],
    ['a/./b', /"\."/],
    ['a//b', /empty/],
    ['a/', /empty/],
    ['/etc/passwd', /relative/],
    ['~/x', /home/],
    ['a\u0000b', /NUL/],
    ['a\r\nb', /CR\/LF/],
    ['a\nb', /CR\/LF/],
    ['a\\b', /backslash/],
    ['..\\x', /backslash/],
    ['C:/x', /drive/],
    ['c:x', /drive/],
    ['a\u2215b', /confusable/],
    ['\uff0e\uff0e/x', /confusable/],
    ['a\u202eb', /confusable/],
    ['a\u001bb', /control/],
    ['x'.repeat(1025), /exceeds/],
  ];
  for (const [hint, pattern] of cases) {
    assert.throws(() => validateRelativeHint(hint), pathError(pattern), JSON.stringify(hint));
  }
  assert.deepEqual(validateRelativeHint('docs/readme.md'), ['docs', 'readme.md']);
  assert.throws(() => validateRelativeHint(42), PathError);
});

test('resolveInRoot stays inside the root and follows only internal symlinks', () => {
  const fx = makeFixture();
  const ws = getWorkspace(fx.config, 'alpha');
  const ok = resolveInRoot(ws, 'docs/readme.md');
  assert.equal(ok.absolute, join(fx.alpha, 'docs', 'readme.md'));
  assert.equal(ok.relative, join('docs', 'readme.md'));

  symlinkSync(join(fx.alpha, 'docs'), join(fx.alpha, 'internal'));
  assert.equal(resolveInRoot(ws, 'internal/readme.md').absolute, join(fx.alpha, 'docs', 'readme.md'));

  symlinkSync(join(fx.beta, 'secret.txt'), join(fx.alpha, 'to-beta'));
  assert.throws(() => resolveInRoot(ws, 'to-beta'), pathError(/escapes/));
  symlinkSync(fx.outside, join(fx.alpha, 'out-dir'));
  assert.throws(() => resolveInRoot(ws, 'out-dir/secret.txt'), pathError(/escapes/));
  symlinkSync(join(fx.alpha, 'missing'), join(fx.alpha, 'dangling'));
  assert.throws(() => resolveInRoot(ws, 'dangling'), pathError(/does not resolve/));
  assert.throws(() => resolveInRoot(ws, 'nope.txt'), pathError(/does not resolve/));
  // A prefix-sharing sibling must not pass a string startsWith check.
  const sibling = `${fx.alpha}-evil`;
  mkdirSync(sibling, { mode: 0o700 });
  writeFileSync(join(sibling, 'x'), 'x');
  symlinkSync(join(sibling, 'x'), join(fx.alpha, 'prefix'));
  assert.throws(() => resolveInRoot(ws, 'prefix'), pathError(/escapes/));
});

test('subdirectory swapped to an outside symlink is rejected on next resolution', () => {
  const fx = makeFixture();
  const ws = getWorkspace(fx.config, 'alpha');
  assert.ok(resolveInRoot(ws, 'docs/readme.md'));
  renameSync(join(fx.alpha, 'docs'), join(fx.base, 'docs-moved'));
  writeFileSync(join(fx.outside, 'readme.md'), 'OUTSIDE\n');
  symlinkSync(fx.outside, join(fx.alpha, 'docs'));
  assert.throws(() => resolveInRoot(ws, 'docs/readme.md'), pathError(/escapes/));
});

test('root swapped after startup (symlink or new dir) fails identity revalidation', () => {
  const fx = makeFixture();
  const ws = getWorkspace(fx.config, 'alpha');
  assert.equal(assertRootIdentity(ws), true);

  renameSync(fx.alpha, `${fx.alpha}.orig`);
  symlinkSync(fx.beta, fx.alpha);
  assert.throws(() => resolveInRoot(ws, 'secret.txt'), pathError(/replaced|identity|canonical/));
  assert.throws(() => buildSandboxInvocation(fx.config, 'alpha'), pathError(/replaced|identity|canonical/));

  rmSync(fx.alpha);
  initRepo(fx.alpha);
  assert.throws(() => resolveInRoot(ws, '.git'), pathError(/identity/));

  rmSync(fx.alpha, { recursive: true });
  renameSync(`${fx.alpha}.orig`, fx.alpha);
  assert.ok(resolveInRoot(ws, 'docs/readme.md'));
  chmodSync(fx.alpha, 0o770);
  // Workspace selection accepts ordinary shared directories; inode/canonical
  // checks above still detect replacement. Only the writable wiki is private.
  assert.ok(resolveInRoot(ws, 'docs/readme.md'));
  chmodSync(fx.alpha, 0o700);
});

test('sandbox invocation selects exactly one workspace and mounts nothing forbidden', () => {
  const fx = makeFixture();
  assert.throws(() => buildSandboxInvocation(fx.config, ['alpha', 'beta']), pathError(/exactly one/));
  assert.throws(() => buildSandboxInvocation(fx.config, 'gamma'), /not allowlisted/);
  assert.throws(() => buildSandboxInvocation(fx.config, 'alpha', { argv: ['node'] }), /absolute/);
  assert.throws(() => buildSandboxInvocation(fx.config, 'alpha', { argv: [join(fx.alpha, 'x')] }), PathError);
  assert.throws(() => buildSandboxInvocation(fx.config, 'alpha', { extraEnv: { HOME: '/x' } }), pathError(/not allowed/));

  const inv = buildSandboxInvocation(fx.config, 'alpha');
  const readOnlyInv = buildSandboxInvocation(fx.config, 'alpha', { adminWriteRoot: true });
  assert.deepEqual(readOnlyInv.writableDirs, [], 'READ builder must ignore ADMIN-only options');
  assert.equal(readOnlyInv.args.includes('--bind'), false, 'READ builder must never add writable binds');
  const home = realpathSync(homedir());
  for (const flag of ['--unshare-all', '--unshare-net', '--die-with-parent', '--new-session']) {
    assert.ok(inv.args.includes(flag), flag);
  }
  assert.ok(!inv.args.includes(fx.beta), 'other workspace never mounted');
  assert.ok(!inv.args.includes(home), 'user home never mounted');
  for (const source of inv.mounts) {
    assert.ok(!isWithin(source, home), `${source} would expose home`);
    assert.ok(!isWithin(source, fx.beta) && !isWithin(fx.beta, source), `${source} would expose beta`);
  }
  assert.deepEqual(inv.args.slice(-3), ['--', fx.config.upstream.node, fx.config.upstream.executable]);
  assert.equal(inv.env.HOME, SANDBOX_HOME);
  assert.ok(!Object.keys(inv.env).some((k) => /KEY|TOKEN|SECRET/.test(k)));
});

test('sandbox mounts linked-worktree Git metadata read-only', () => {
  const fx = makeFixture();
  const repo = fx.alpha;
  writeFileSync(join(repo, 'seed.txt'), 'seed\n', { mode: 0o600 });
  execFileSync('/usr/bin/git', ['-C', repo, 'add', 'seed.txt'], {
    env: { ...GIT_ENV, HOME: fx.base }, stdio: 'ignore', timeout: 5000,
  });
  execFileSync('/usr/bin/git', [
    '-C', repo, '-c', 'user.name=OpenWiki Test', '-c', 'user.email=openwiki-test@invalid', 'commit', '-qm', 'seed',
  ], { env: { ...GIT_ENV, HOME: fx.base }, stdio: 'ignore', timeout: 5000 });
  const worktree = join(fx.base, 'linked worktree');
  execFileSync('/usr/bin/git', ['-C', repo, 'worktree', 'add', '--detach', worktree], {
    env: { ...GIT_ENV, HOME: fx.base }, stdio: 'ignore', timeout: 5000,
  });
  chmodSync(worktree, 0o700);
  const rawConfig = JSON.parse(readFileSync(fx.file, 'utf8'));
  rawConfig.workspaces = { alpha: { root: worktree } };
  writeFileSync(fx.file, JSON.stringify(rawConfig), { mode: 0o600 });
  chmodSync(fx.file, 0o600);
  const config = loadConfig(fx.file);
  const commonGitDir = execFileSync('/usr/bin/git', [
    '-C', worktree, 'rev-parse', '--path-format=absolute', '--git-common-dir',
  ], { encoding: 'utf8', env: { ...GIT_ENV, HOME: fx.base }, stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 }).trim();

  const invocation = buildSandboxInvocation(config, 'alpha', {
    argv: ['/usr/bin/git', '-C', worktree, 'rev-parse', '--show-toplevel'],
  });
  assert.ok(invocation.mounts.includes(join(commonGitDir, 'objects')),
    JSON.stringify({ commonGitDir, worktree, configRoot: config.workspaces.alpha.root, mounts: invocation.mounts }));
  assert.ok(invocation.mounts.includes(join(commonGitDir, 'refs')));
  assert.ok(invocation.mounts.some((path) => path.startsWith(`${join(commonGitDir, 'worktrees')}${sep}`)));
  assert.ok(!invocation.mounts.includes(commonGitDir), 'common .git root is not exposed');
  assert.ok(!invocation.mounts.includes(join(commonGitDir, 'config')), 'shared Git config is not exposed');
  const gitResult = spawnSync(invocation.file, invocation.args, {
    encoding: 'utf8', env: invocation.env, timeout: CHILD_TIMEOUT_MS,
  });
  assert.equal(gitResult.error, undefined, gitResult.error?.message);
  assert.equal(gitResult.status, 0, gitResult.stderr);
  assert.equal(gitResult.stdout.trim(), worktree);
  assert.deepEqual(invocation.writableDirs, []);
});

test('bwrap child sees the authorized root and never the other root', { timeout: 10000 }, () => {
  const fx = makeFixture();
  // Fails closed here when bubblewrap or user namespaces are unavailable.
  assert.equal(assertSandboxUsable(fx.config, 'alpha'), true);

  symlinkSync(join(fx.beta, 'secret.txt'), join(fx.alpha, 'to-beta'));
  const home = realpathSync(homedir());
  const inv = buildSandboxInvocation(fx.config, 'alpha', {
    argv: [
      fx.config.upstream.node,
      fx.child,
      join(fx.alpha, 'docs', 'readme.md'),
      join(fx.alpha, 'to-beta'),
      join(fx.beta, 'secret.txt'),
      fx.beta,
      fx.file,
      home,
      String(process.pid),
    ],
  });
  const res = spawnSync(inv.file, inv.args, {
    env: inv.env,
    shell: false,
    timeout: CHILD_TIMEOUT_MS,
    // bwrap is spawned directly (no shell); SIGKILL on timeout plus its PID
    // namespace and --die-with-parent leave no residual children.
    killSignal: 'SIGKILL',
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  assert.equal(res.error, undefined, String(res.error));
  assert.equal(res.status, 0, res.stderr);
  const seen = JSON.parse(res.stdout);

  assert.deepEqual(seen.allowed, { ok: true, value: 'ALPHA-VISIBLE\n' }, 'authorized root readable');
  assert.equal(seen.cwd, fx.alpha);
  assert.equal(seen.denied.ok, false, 'other workspace file must not be visible');
  assert.equal(seen.denied.code, 'ENOENT');
  assert.equal(seen.deniedDir.ok, false, 'other workspace dir must not exist');
  assert.equal(seen.viaSymlink.ok, false, 'symlink into the other root resolves to nothing');
  assert.equal(seen.config.ok, false, 'gateway config not visible');
  assert.equal(seen.writeRoot.ok, false, 'authorized root is read-only');
  assert.equal(seen.writeHome.ok, true, 'private HOME is writable');
  assert.equal(seen.home, SANDBOX_HOME);
  assert.equal(seen.hostOpenWiki, false, 'host ~/.openwiki not visible');
  assert.equal(seen.hostPidVisible, false, 'host gateway/test process must not be visible in the child PID namespace');
  assert.equal(seen.linkRegistry, false, 'no linked-wiki registry inside the sandbox');
  assert.ok(seen.interfaces.every((name) => name === 'lo'), `network interfaces: ${seen.interfaces}`);

  // The host home may only appear as the skeleton path of a runtime mount
  // (e.g. nvm); nothing else from it may be listed.
  const allowedTop = new Set(
    inv.mounts.filter((m) => isWithin(home, m) && m !== home).map((m) => relative(home, m).split(sep)[0]),
  );
  if (seen.hostHome.ok) {
    for (const entry of seen.hostHome.value) assert.ok(allowedTop.has(entry), `home entry leaked: ${entry}`);
  }

  // The host side still has the secret: the absence above is confinement.
  assert.equal(readFileSync(join(fx.beta, 'secret.txt'), 'utf8'), 'BETA-SECRET\n');
});

test('ADMIN bwrap sandbox allows writes only in the pre-created openwiki directory', { timeout: 10000 }, () => {
  const fx = makeFixture();
  const wikiRoot = join(fx.alpha, 'openwiki');
  assert.throws(() => buildAdminSandboxInvocation(fx.config, 'alpha'), pathError(/created explicitly/));
  mkdirSync(wikiRoot, { mode: 0o700 });
  writeFileSync(join(fx.alpha, 'source.md'), 'SOURCE-READABLE\n', { mode: 0o600 });

  const probe = `
    import { readFileSync, writeFileSync } from 'node:fs';
    import { join } from 'node:path';
    const [root, wiki, other, beta] = process.argv.slice(1);
    const attempt = (fn) => { try { fn(); return 'ok'; } catch (e) { return e.code; } };
    const result = {
      source: readFileSync(join(root, 'source.md'), 'utf8'),
      wikiWrite: attempt(() => writeFileSync(join(wiki, 'page.md'), 'generated')),
      siblingWrite: attempt(() => writeFileSync(join(root, 'generated.md'), 'no')),
      traversalWrite: attempt(() => writeFileSync(join(wiki, '..', 'traversal.md'), 'no')),
      gitWrite: attempt(() => writeFileSync(join(root, '.git', 'admin-probe'), 'no')),
      otherWorkspaceWrite: attempt(() => writeFileSync(join(beta, 'admin-probe'), 'no')),
      outsideWrite: attempt(() => writeFileSync(join(other, 'admin-probe'), 'no')),
    };
    process.stdout.write(JSON.stringify(result));
  `;
  const inv = buildAdminSandboxInvocation(fx.config, 'alpha', {
    argv: [process.execPath, '-e', probe, fx.alpha, wikiRoot, fx.outside, fx.beta],
  });
  assert.deepEqual(inv.writableDirs, [wikiRoot]);
  assert.ok(inv.args.includes('--ro-bind') && inv.args.includes(fx.alpha));
  assert.ok(inv.args.includes('--bind') && inv.args.includes(wikiRoot));
  const res = spawnSync(inv.file, inv.args, {
    env: inv.env,
    shell: false,
    timeout: CHILD_TIMEOUT_MS,
    killSignal: 'SIGKILL',
    encoding: 'utf8',
    maxBuffer: 64 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  assert.equal(res.error, undefined, String(res.error));
  assert.equal(res.status, 0, res.stderr);
  assert.deepEqual(JSON.parse(res.stdout), {
    source: 'SOURCE-READABLE\n',
    wikiWrite: 'ok',
    siblingWrite: 'EROFS',
    traversalWrite: 'EROFS',
    gitWrite: 'EROFS',
    otherWorkspaceWrite: 'ENOENT',
    outsideWrite: 'ENOENT',
  });
  assert.equal(readFileSync(join(wikiRoot, 'page.md'), 'utf8'), 'generated');
  assert.equal(readFileSync(join(fx.alpha, 'source.md'), 'utf8'), 'SOURCE-READABLE\n');
  assert.equal(existsSync(join(fx.alpha, 'generated.md')), false);
  assert.equal(existsSync(join(fx.alpha, 'traversal.md')), false);
});

test('ADMIN host adapter skips standalone setup and preserves an empty wiki mount', { timeout: 10000 }, () => {
  const fx = makeFixture();
  const release = fx.config.upstream.releaseDir;
  mkdirSync(join(release, 'dist', 'ingestion'), { recursive: true });
  mkdirSync(join(release, 'dist', 'agent'), { recursive: true });
  writeFileSync(join(release, 'package.json'), '{"type":"module"}');
  const setupSource = `
    import { writeFile } from 'node:fs/promises';
    export async function ensureCodeModeRepoSetup(cwd, options = {}) {
      await writeFile(cwd + '/AGENTS.md', 'standalone setup');
    }
    export const unrelatedExport = 'preserved';
  `;
  const replacementSource = `
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
export async function beginRepositoryWikiReplacement(rootDir) {
    const wikiDir = path.join(rootDir, 'openwiki');
    const backupParent = await mkdtemp(path.join(tmpdir(), "openwiki-init-"));
    return { kind: 'standalone', backupParent };
}
function createNoopReplacement() { return { kind: 'noop' }; }
  `;
  const setup = join(release, 'dist', 'ingestion', 'code-mode.js');
  const replacement = join(release, 'dist', 'agent', 'wiki-replacement.js');
  writeFileSync(setup, setupSource);
  writeFileSync(replacement, replacementSource);
  const wiki = join(fx.alpha, 'openwiki');
  mkdirSync(wiki, { mode: 0o700 });
  const inode = lstatSync(wiki).ino;
  const probe = `
    import { existsSync, writeFileSync } from 'node:fs';
    const setup = await import(${JSON.stringify(setup)});
    const replacement = await import(${JSON.stringify(replacement)});
    await setup.ensureCodeModeRepoSetup(${JSON.stringify(fx.alpha)}, { createWorkflow: true });
    const empty = await replacement.beginRepositoryWikiReplacement(${JSON.stringify(fx.alpha)});
    writeFileSync(${JSON.stringify(join(wiki, 'page.md'))}, '# Page');
    const populated = await replacement.beginRepositoryWikiReplacement(${JSON.stringify(fx.alpha)});
    console.log(JSON.stringify({ empty: empty.kind, populated: populated.kind,
      unrelated: setup.unrelatedExport, agents: existsSync(${JSON.stringify(join(fx.alpha, 'AGENTS.md'))}) }));
  `;
  const invocation = buildAdminSandboxInvocation(fx.config, 'alpha', {
    argv: [process.execPath, '--input-type=module', '-e', probe],
  });
  const result = spawnSync(invocation.file, invocation.args, {
    env: invocation.env, encoding: 'utf8', timeout: CHILD_TIMEOUT_MS, maxBuffer: 64 * 1024,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    empty: 'noop', populated: 'standalone', unrelated: 'preserved', agents: false,
  });
  assert.equal(lstatSync(wiki).ino, inode);
  assert.equal(readFileSync(setup, 'utf8'), setupSource);
  assert.equal(readFileSync(replacement, 'utf8'), replacementSource);
  const readOnly = buildSandboxInvocation(fx.config, 'alpha');
  assert.equal(readOnly.args.includes('--import'), false);
});

test('ADMIN sandbox refuses a symlinked or group-writable openwiki root', () => {
  const fx = makeFixture();
  symlinkSync(fx.outside, join(fx.alpha, 'openwiki'));
  assert.throws(() => buildAdminSandboxInvocation(fx.config, 'alpha'), pathError(/real directory/));
  rmSync(join(fx.alpha, 'openwiki'));
  mkdirSync(join(fx.alpha, 'openwiki'), { mode: 0o700 });
  chmodSync(join(fx.alpha, 'openwiki'), 0o770);
  assert.throws(() => buildAdminSandboxInvocation(fx.config, 'alpha'), pathError(/workspace filesystem.*owned.*group\/world writable/));
});

test('ADMIN sandbox refuses hard-linked files inside the writable wiki root', () => {
  const fx = makeFixture();
  const wikiRoot = join(fx.alpha, 'openwiki');
  mkdirSync(wikiRoot, { mode: 0o700 });
  writeFileSync(join(fx.alpha, 'source.md'), 'SOURCE-MUST-STAY-READ-ONLY\n', { mode: 0o600 });
  linkSync(join(fx.alpha, 'source.md'), join(wikiRoot, 'alias.md'));
  const config = { ...fx.config, sandbox: Object.freeze({ bwrap: process.execPath }) };
  assert.throws(() => buildAdminSandboxInvocation(config, 'alpha'), pathError(/hard-linked file/));
  assert.equal(readFileSync(join(fx.alpha, 'source.md'), 'utf8'), 'SOURCE-MUST-STAY-READ-ONLY\n');
});

test('ADMIN sandbox blocks writes through symlinks inside openwiki/ to source or outside files', { timeout: 10000 }, () => {
  const fx = makeFixture();
  const wikiRoot = join(fx.alpha, 'openwiki');
  mkdirSync(wikiRoot, { mode: 0o700 });
  writeFileSync(join(fx.alpha, 'source.md'), 'SOURCE-READABLE\n', { mode: 0o600 });

  // Create symlinks inside openwiki/ pointing to source and outside files
  symlinkSync(join(fx.alpha, 'source.md'), join(wikiRoot, 'link-to-source'));
  symlinkSync(join(fx.outside, 'secret.txt'), join(wikiRoot, 'link-to-outside'));

  const probe = `
    import { readFileSync, writeFileSync } from 'node:fs';
    import { join } from 'node:path';
    const [root, wiki, other] = process.argv.slice(1);
    const attempt = (fn) => { try { fn(); return 'ok'; } catch (e) { return e.code; } };
    const result = {
      sourceRead: readFileSync(join(root, 'source.md'), 'utf8'),
      // Write through symlink to source file (in read-only workspace root)
      symlinkToSourceWrite: attempt(() => writeFileSync(join(wiki, 'link-to-source'), 'evil')),
      // Write through symlink to outside file (not mounted at all)
      symlinkToOutsideWrite: attempt(() => writeFileSync(join(wiki, 'link-to-outside'), 'evil')),
      // Direct write to openwiki/ (should still work)
      wikiWrite: attempt(() => writeFileSync(join(wiki, 'page.md'), 'generated')),
    };
    process.stdout.write(JSON.stringify(result));
  `;
  const inv = buildAdminSandboxInvocation(fx.config, 'alpha', {
    argv: [process.execPath, '-e', probe, fx.alpha, wikiRoot, fx.outside],
  });
  assert.deepEqual(inv.writableDirs, [wikiRoot]);
  const res = spawnSync(inv.file, inv.args, {
    env: inv.env,
    shell: false,
    timeout: CHILD_TIMEOUT_MS,
    killSignal: 'SIGKILL',
    encoding: 'utf8',
    maxBuffer: 64 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  assert.equal(res.error, undefined, String(res.error));
  assert.equal(res.status, 0, res.stderr);
  const seen = JSON.parse(res.stdout);
  // Source file is readable
  assert.equal(seen.sourceRead, 'SOURCE-READABLE\n');
  // Writing through symlink to source file fails (target is in read-only mount)
  assert.equal(seen.symlinkToSourceWrite, 'EROFS', 'symlink to source must be read-only');
  // Writing through symlink to outside file fails (target not mounted)
  assert.equal(seen.symlinkToOutsideWrite, 'ENOENT', 'symlink to outside must not be accessible');
  // Direct write to openwiki/ still works
  assert.equal(seen.wikiWrite, 'ok');
  assert.equal(readFileSync(join(wikiRoot, 'page.md'), 'utf8'), 'generated');
  // Source file unchanged
  assert.equal(readFileSync(join(fx.alpha, 'source.md'), 'utf8'), 'SOURCE-READABLE\n');
  // Outside file unchanged
  assert.equal(readFileSync(join(fx.outside, 'secret.txt'), 'utf8'), 'OUTSIDE-SECRET\n');
});

test('missing bubblewrap fails closed', () => {
  const fx = makeFixture();
  const broken = { ...fx.config, sandbox: Object.freeze({ bwrap: join(fx.base, 'no-bwrap') }) };
  assert.throws(() => buildSandboxInvocation(broken, 'alpha'), pathError(/bubblewrap not available/));
  assert.throws(() => assertSandboxUsable(broken, 'alpha'), pathError(/bubblewrap not available/));
});
