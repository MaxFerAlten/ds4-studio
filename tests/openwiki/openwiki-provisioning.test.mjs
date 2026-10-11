// WP02 provisioning checks. Every fixture is synthetic and lives in a temp
// dir: no OpenWiki checkout, network, install or real MCP server is used.
// Run: node --test tests/openwiki/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync,
  symlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const VERIFY = join(repoRoot, 'scripts', 'openwiki-verify-upstream.sh');
const INSTALL = join(repoRoot, 'scripts', 'openwiki-install-release.sh');
const ENGINE = '>=22.22.0';

const sha256 = (data) => createHash('sha256').update(data).digest('hex');
const tmp = (prefix) => mkdtempSync(join(tmpdir(), prefix));

function run(script, args, env = {}) {
  const r = spawnSync('bash', [script, ...args], {
    encoding: 'utf8',
    env: { ...process.env, OPENWIKI_NODE: process.execPath, OPENWIKI_SOURCE: '', ...env },
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

function writeLock(dir, lock) {
  const file = join(dir, 'upstream-lock.json');
  writeFileSync(file, JSON.stringify(lock));
  return file;
}

// --- Source fixtures --------------------------------------------------------

const SUPPORTED_SOURCES = {
  'package.json': JSON.stringify({
    name: 'openwiki', version: '0.7.1', license: 'MIT',
    engines: { node: ENGINE }, bin: { openwiki: './dist/cli/cli.js' },
  }),
  'pnpm-lock.yaml': "lockfileVersion: '9.0'\n",
  'src/cli/commands.ts':
    'if (argv[0] === "mcp") { return parseMcpCommand(argv.slice(1)); }\n' +
    'if (arg === "--host" || arg.startsWith("--host=")) {}\n',
  'src/cli/integrations.ts': 'producerActor: target?.producerActor ?? command.host,\n',
  'src/integrations/core/protocol.ts':
    'const HOST_ID_PATTERN = /^[a-z0-9-]{1,64}$/u;\n| "openwiki_search"\n| "openwiki_read"\n',
  'src/integrations/mcp/stdio.ts': 'await server.connect(new StdioServerTransport());\n',
};

const gitEnv = {
  ...process.env,
  GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 'fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
  GIT_COMMITTER_NAME: 'fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
};
const git = (cwd, ...args) => {
  const r = spawnSync('git', ['-c', 'commit.gpgsign=false', ...args], { cwd, env: gitEnv, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
};

// Creates a committed source checkout and a lock pinning it.
function makeSource(overrides = {}) {
  const root = tmp('ow-src-');
  const src = join(root, 'src');
  const files = { ...SUPPORTED_SOURCES, ...overrides };
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(dirname(join(src, rel)), { recursive: true });
    writeFileSync(join(src, rel), body);
  }
  git(src, 'init', '-q');
  git(src, 'add', '-A');
  git(src, 'commit', '-q', '-m', 'fixture');
  const lock = {
    git_commit: git(src, 'rev-parse', 'HEAD'),
    package: { name: 'openwiki', version: '0.7.1', node_engine: ENGINE, package_manager: 'pnpm@11.25.0' },
    untracked_paths: [],
    sha256: Object.fromEntries(
      ['package.json', 'pnpm-lock.yaml', 'src/integrations/mcp/stdio.ts'].map((f) => [f, sha256(files[f])]),
    ),
  };
  return { root, src, lock };
}

test('source: clean pinned checkout with MCP support verifies', () => {
  const { root, src, lock } = makeSource();
  const r = run(VERIFY, ['--source', src, '--lock', writeLock(root, lock)]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /static check only/);
  assert.equal(r.stdout, '');
});

test('source: dirty checkout fails closed', () => {
  const { root, src, lock } = makeSource();
  writeFileSync(join(src, 'untracked.txt'), 'x');
  const r = run(VERIFY, ['--source', src, '--lock', writeLock(root, lock)]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /untracked path is not allowlisted/);
});

test('source: permits only explicitly allowlisted untracked paths', () => {
  const { root, src, lock } = makeSource();
  mkdirSync(join(src, '.claude', 'skills'), { recursive: true });
  writeFileSync(join(src, '.claude', 'skills', 'local.md'), 'preserved local file');
  const allowed = writeLock(root, { ...lock, untracked_paths: ['.claude/skills/'] });
  const result = run(VERIFY, ['--source', src, '--lock', allowed]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /lock-allowlisted untracked paths/);

  writeFileSync(join(src, 'unexpected.txt'), 'not allowlisted');
  const rejected = run(VERIFY, ['--source', src, '--lock', allowed]);
  assert.equal(rejected.status, 1);
  assert.match(rejected.stderr, /untracked path is not allowlisted/);
});

test('source: rejects tracked changes even when lock-listed untracked paths are present', () => {
  const { root, src, lock } = makeSource();
  writeFileSync(join(src, '.local.txt'), 'allowlisted');
  writeFileSync(join(src, 'package.json'), 'modified tracked manifest');
  const allowed = writeLock(root, { ...lock, untracked_paths: ['.local.txt'] });
  const result = run(VERIFY, ['--source', src, '--lock', allowed]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /tracked changes are not permitted/);
});

test('source: rejects malformed or escaping untracked path allowlists', () => {
  for (const untrackedPaths of [null, 'local.txt', [''], ['/tmp/escape'], ['../escape']]) {
    const { root, src, lock } = makeSource();
    writeFileSync(join(src, 'unlisted.txt'), 'forces lock allowlist validation');
    const file = writeLock(root, { ...lock, untracked_paths: untrackedPaths });
    const result = run(VERIFY, ['--source', src, '--lock', file]);
    assert.equal(result.status, 1, JSON.stringify(untrackedPaths));
    assert.match(result.stderr, /untracked_paths must be a safe array/);
  }
});

test('source: legacy digest metadata is ignored', () => {
  for (const unsafePath of ['/tmp/outside', '../outside']) {
    const { root, src, lock } = makeSource();
    const file = writeLock(root, {
      ...lock,
      sha256: { ...lock.sha256, [unsafePath]: 'a'.repeat(64) },
    });
    const result = run(VERIFY, ['--source', src, '--lock', file]);
    assert.equal(result.status, 0, `${unsafePath}: ${result.stderr}`);
  }
});

test('source: commit different from the pin fails closed', () => {
  const { root, src, lock } = makeSource();
  const r = run(VERIFY, ['--source', src, '--lock', writeLock(root, { ...lock, git_commit: 'f'.repeat(40) })]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /!= pinned/);
});

test('source: package version and legacy file digest do not gate the checkout', () => {
  const { root, src, lock } = makeSource({ 'package.json': JSON.stringify({
    name: 'openwiki', version: '99.0.0', license: 'MIT',
    engines: { node: ENGINE }, bin: { openwiki: './dist/cli/cli.js' },
  }) });
  const sums = { ...lock.sha256, 'pnpm-lock.yaml': '0'.repeat(64) };
  const packagePin = { ...lock.package };
  delete packagePin.version;
  const r = run(VERIFY, ['--source', src, '--lock', writeLock(root, {
    ...lock, package: packagePin, sha256: sums,
  })]);
  assert.equal(r.status, 0, r.stderr);
});

test('source: revision without stdio MCP is a STOP (exit 3)', () => {
  const { root, src, lock } = makeSource({ 'src/integrations/mcp/stdio.ts': 'export {};\n' });
  const r = run(VERIFY, ['--source', src, '--lock', writeLock(root, lock)]);
  assert.equal(r.status, 3);
  assert.match(r.stderr, /STOP: .*stdio transport/);
});

test('source: host pattern rejecting ds4-studio is a STOP (exit 3)', () => {
  const { root, src, lock } = makeSource({
    'src/integrations/core/protocol.ts':
      'const HOST_ID_PATTERN = /^[a-z]{1,8}$/u;\n| "openwiki_search"\n| "openwiki_read"\n',
  });
  const r = run(VERIFY, ['--source', src, '--lock', writeLock(root, lock)]);
  assert.equal(r.status, 3);
  assert.match(r.stderr, /HOST_ID_PATTERN accepting ds4-studio/);
});

// --- Node compatibility -----------------------------------------------------

for (const version of ['20.19.0', '22.21.9']) {
  test(`node ${version} is rejected before any other check`, () => {
    const dir = tmp('ow-node-');
    const fakeNode = join(dir, 'node');
    writeFileSync(fakeNode, `#!/bin/sh\necho ${version}\n`);
    chmodSync(fakeNode, 0o755);
    const lock = writeLock(dir, { git_commit: 'a'.repeat(40), package: { version: '0.7.1', node_engine: ENGINE } });
    const r = run(VERIFY, ['--source', dir, '--lock', lock], { OPENWIKI_NODE: fakeNode });
    assert.equal(r.status, 1);
    assert.match(r.stderr, new RegExp(`Node ${version.replace(/\./g, '\\.')} .* incompatible`));
  });
}

// Node stub that reports `version` and delegates everything else to this Node,
// so a fully valid source fixture isolates the version gate as the only cause.
function versionedNode(version) {
  const file = join(tmp('ow-node-'), 'node');
  writeFileSync(file, `#!/bin/sh
if [ "$1" = -p ] && [ "$2" = process.versions.node ]; then printf '%s\\n' '${version}'; exit 0; fi
exec '${process.execPath}' "$@"
`);
  chmodSync(file, 0o755);
  return file;
}

for (const version of ['22.22.0', '22.22.1', '23.0.0']) {
  test(`node ${version} meets ${ENGINE} and verifies a valid source`, () => {
    const { root, src, lock } = makeSource();
    const r = run(VERIFY, ['--source', src, '--lock', writeLock(root, lock)], { OPENWIKI_NODE: versionedNode(version) });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stderr, new RegExp(`node ${version.replace(/\./g, '\\.')} .* satisfies >=22\\.22\\.0`));
  });
}

for (const version of ['22.21.99', '22.9.0', '21.99.99', '0.0.0']) {
  test(`node ${version} is below ${ENGINE} and rejected on a valid source`, () => {
    const { root, src, lock } = makeSource();
    const r = run(VERIFY, ['--source', src, '--lock', writeLock(root, lock)], { OPENWIKI_NODE: versionedNode(version) });
    assert.equal(r.status, 1);
    assert.match(r.stderr, new RegExp(`Node ${version.replace(/\./g, '\\.')} .* incompatible`));
  });
}

for (const version of ['', 'not-a-version', 'v22.22.0', '22.22', '22.22.0-rc.1', '22.22.08', '022.22.0', '9999999999.0.0']) {
  test(`node version ${JSON.stringify(version)} is invalid and rejected on a valid source`, () => {
    const { root, src, lock } = makeSource();
    const r = run(VERIFY, ['--source', src, '--lock', writeLock(root, lock)], { OPENWIKI_NODE: versionedNode(version) });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /cannot read Node version/);
  });
}

test('node: non-executable OPENWIKI_NODE is rejected', () => {
  const { root, src, lock } = makeSource();
  const file = join(root, 'node');
  writeFileSync(file, '');
  const r = run(VERIFY, ['--source', src, '--lock', writeLock(root, lock)], { OPENWIKI_NODE: file });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /not executable/);
});

// --- Release fixtures -------------------------------------------------------

const FAKE_MCP = (banner) => `
if (process.argv.slice(2).join(" ") !== "mcp --host ds4-studio") process.exit(64);
${banner ? 'console.log("openwiki ready");' : ''}
const rl = require("node:readline").createInterface({ input: process.stdin });
const out = (m) => process.stdout.write(JSON.stringify(m) + "\\n");
rl.on("line", (line) => {
  const msg = JSON.parse(line);
  if (msg.method === "initialize") out({ jsonrpc: "2.0", id: msg.id, result: {
    protocolVersion: msg.params.protocolVersion, capabilities: { tools: {} },
    serverInfo: { name: "fake-openwiki", version: "0" } } });
  else if (msg.method === "tools/list") out({ jsonrpc: "2.0", id: msg.id, result: { tools: [
    { name: "openwiki_search", inputSchema: { type: "object" } },
    { name: "openwiki_read", inputSchema: { type: "object" } }] } });
});
rl.on("close", () => process.exit(0));
`;

// Builds releases/<id>/{package,manifest.json} the way the installer does.
function makeRelease({ banner = false, manifestOverrides = {} } = {}) {
  const root = tmp('ow-rel-');
  const commit = 'b'.repeat(40);
  const release = join(root, 'releases', 'fixture-release');
  const pkg = join(release, 'package');
  mkdirSync(join(pkg, 'dist', 'cli'), { recursive: true });
  const exe = FAKE_MCP(banner);
  writeFileSync(join(pkg, 'dist', 'cli', 'cli.js'), exe);
  writeFileSync(join(pkg, 'package.json'), '{"name":"openwiki","version":"0.7.1"}\n');
  const digest = run(VERIFY, ['--print-tree-digest', pkg]);
  assert.equal(digest.status, 0, digest.stderr);
  const manifest = {
    schema: 'ds4-openwiki-release-manifest-v1',
    integration: 'ds4-openwiki-mcp-gateway',
    releaseId: 'fixture-release',
    openwikiCommit: commit,
    openwikiVersion: '0.7.1',
    openwikiExecutable: 'dist/cli/cli.js',
    openwikiExecutableSha256: sha256(exe),
    releaseTreeSha256: digest.stdout.trim(),
    nodeAbi: process.versions.modules,
    platform: `${process.platform}-${process.arch}`,
    mcpCommand: ['mcp', '--host', 'ds4-studio'],
    mcpTools: ['openwiki_search', 'openwiki_read'],
    telemetryDisabled: true,
    ...manifestOverrides,
  };
  writeFileSync(join(release, 'manifest.json'), JSON.stringify(manifest));
  const lock = writeLock(root, { git_commit: commit, package: { version: '0.7.1', node_engine: ENGINE } });
  return { release, pkg, lock };
}

test('release: untampered release verifies', () => {
  const { release, lock } = makeRelease();
  const r = run(VERIFY, ['--release', release, '--lock', lock]);
  assert.equal(r.status, 0, r.stderr);
});

test('release: executable changes are accepted when entrypoint remains present', () => {
  const { release, pkg, lock } = makeRelease();
  writeFileSync(join(pkg, 'dist', 'cli', 'cli.js'), FAKE_MCP(false) + '\n// tampered\n');
  const r = run(VERIFY, ['--release', release, '--lock', lock]);
  assert.equal(r.status, 0, r.stderr);
});

test('release: dependency tree changes do not gate the release', () => {
  const { release, pkg, lock } = makeRelease();
  mkdirSync(join(pkg, 'node_modules', 'dep'), { recursive: true });
  writeFileSync(join(pkg, 'node_modules', 'dep', 'index.js'), 'module.exports = 1;\n');
  const r = run(VERIFY, ['--release', release, '--lock', lock]);
  assert.equal(r.status, 0, r.stderr);
});

test('release: OpenWiki version is informational while Node ABI remains enforced', () => {
  const { release, lock } = makeRelease({ manifestOverrides: { openwikiVersion: '99.0.0' } });
  const r = run(VERIFY, ['--release', release, '--lock', lock]);
  assert.equal(r.status, 0, r.stderr);
});

test('release: built for another Node ABI is rejected', () => {
  const { release, lock } = makeRelease({ manifestOverrides: { nodeAbi: '1' } });
  const r = run(VERIFY, ['--release', release, '--lock', lock]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Node runtime \(ABI\/platform\)/);
});

// --- Tree digest symlinks ---------------------------------------------------

function makeLinkTree(links) {
  const dir = join(tmp('ow-tree-'), 'package');
  mkdirSync(join(dir, 'sub'), { recursive: true });
  writeFileSync(join(dir, 'sub', 'a.js'), 'same\n');
  writeFileSync(join(dir, 'sub', 'b.js'), 'same\n');
  for (const [path, target] of Object.entries(links)) symlinkSync(target, join(dir, path));
  return dir;
}

const treeDigest = (dir) => run(VERIFY, ['--print-tree-digest', dir]);

test('tree digest: internal symlink is stable and survives a move', () => {
  const dir = makeLinkTree({ 'sub/link.js': 'a.js', 'up.js': 'sub/../sub/b.js', 'dirlink': 'sub' });
  const first = treeDigest(dir);
  assert.equal(first.status, 0, first.stderr);
  assert.match(first.stdout.trim(), /^[0-9a-f]{64}$/);
  assert.equal(treeDigest(dir).stdout, first.stdout);
  const moved = join(tmp('ow-tree-moved-'), 'package');
  cpSync(dir, moved, { recursive: true, verbatimSymlinks: true });
  assert.equal(readlinkSync(join(moved, 'sub', 'link.js')), 'a.js');
  const again = treeDigest(moved);
  assert.equal(again.status, 0, again.stderr);
  assert.equal(again.stdout, first.stdout);
});

test('tree digest: changing only a symlink target changes the digest', () => {
  const toA = treeDigest(makeLinkTree({ 'link.js': 'sub/a.js' }));
  const toB = treeDigest(makeLinkTree({ 'link.js': 'sub/b.js' }));
  assert.equal(toA.status, 0, toA.stderr);
  assert.equal(toB.status, 0, toB.stderr);
  assert.notEqual(toA.stdout.trim(), toB.stdout.trim());
});

test('tree digest: symlinks leaving the tree are refused', () => {
  const outside = tmp('ow-outside-');
  writeFileSync(join(outside, 'secret.js'), 'x\n');
  const cases = [
    [{ 'abs.js': join(outside, 'secret.js') }, /empty or absolute target/],
    [{ 'up.js': '../outside.js' }, /escapes the tree/],
    [{ 'sub/up.js': '../../package/sub/a.js' }, /escapes the tree/],
    [{ 'sub/deep.js': 'x/../../../y' }, /escapes the tree/],
    // Lexically inside, but `self` resolves to the root so `self/..` is its parent.
    [{ self: '.', 'chain.js': 'self/..' }, /resolves outside the tree/],
  ];
  for (const [links, error] of cases) {
    const r = treeDigest(makeLinkTree(links));
    assert.equal(r.status, 1, JSON.stringify(links));
    assert.equal(r.stdout, '', JSON.stringify(links));
    assert.match(r.stderr, error, JSON.stringify(links));
  }
});

// Runs the verifier in its own process group and SIGKILLs the whole group at
// the deadline, so a resolver that never terminates fails the test instead of
// hanging it.
function runBounded(args, timeoutMs = 10_000) {
  return new Promise((resolve) => {
    const child = spawn('bash', [VERIFY, ...args], {
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, OPENWIKI_NODE: process.execPath, OPENWIKI_SOURCE: '' },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (d) => { stdout += d; });
    child.stderr.setEncoding('utf8').on('data', (d) => { stderr += d; });
    const timer = setTimeout(() => {
      try { process.kill(-child.pid, 'SIGKILL'); } catch {}
      child.stdout.destroy();
      child.stderr.destroy();
      resolve({ status: null, stdout, stderr, timedOut: true });
    }, timeoutMs);
    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({ status: null, stdout, stderr: stderr + e.message, timedOut: false });
    });
    child.on('close', (status) => {
      clearTimeout(timer);
      resolve({ status, stdout, stderr, timedOut: false });
    });
  });
}

test('tree digest: symlink loops are refused in bounded time', { timeout: 60_000 }, async () => {
  const cases = [
    { self: 'self' },
    { a: 'b', b: 'a' },
    // Each lap adds a `..`: an unbounded resolver never stops.
    { self: 'chain', chain: 'self/..' },
    { 'sub/grow': 'grow/x' },
  ];
  for (const links of cases) {
    const r = await runBounded(['--print-tree-digest', makeLinkTree(links)]);
    assert.equal(r.timedOut, false, `hung on ${JSON.stringify(links)}`);
    assert.equal(r.status, 1, JSON.stringify(links));
    assert.equal(r.stdout, '', JSON.stringify(links));
    assert.match(r.stderr, /symlink loop/, JSON.stringify(links));
  }
});

test('tree digest: dangling symlinks are refused', { timeout: 60_000 }, async () => {
  const cases = [
    { 'missing.js': 'sub/nope.js' },
    { 'through.js': 'sub/a.js/x' },
    // Lexically `sub/a.js`, but the kernel needs `nope` to exist first.
    { 'sub/via-missing.js': 'nope/../a.js' },
  ];
  for (const links of cases) {
    const r = await runBounded(['--print-tree-digest', makeLinkTree(links)]);
    assert.equal(r.timedOut, false, `hung on ${JSON.stringify(links)}`);
    assert.equal(r.status, 1, JSON.stringify(links));
    assert.equal(r.stdout, '', JSON.stringify(links));
    assert.match(r.stderr, /dangling/, JSON.stringify(links));
  }
});

test('tree digest: NUL-separated records keep newline filenames unambiguous', () => {
  const hA = sha256('A\n');
  const hX = sha256('X\n');
  const plain = join(tmp('ow-nl-'), 'package');
  mkdirSync(plain, { recursive: true });
  writeFileSync(join(plain, 'a'), 'A\n');
  writeFileSync(join(plain, 'b'), 'X\n');
  // A single file whose path spells the record of `a` and the head of `b`'s.
  // The `/` makes it `b` inside a directory named `a <hA>\nF .`; directories
  // emit no record, so the digest sees only `./${forgedName}`.
  const forgedName = `a ${hA}\nF ./b`;
  const forged = join(tmp('ow-nl-'), 'package');
  mkdirSync(join(forged, `a ${hA}\nF .`), { recursive: true });
  writeFileSync(join(forged, forgedName), 'X\n');

  // Under the old `F <path> <sha256>\n` records both trees hashed the same bytes.
  const lines = (recs) => recs.map(([p, h]) => `F ${p} ${h}\n`).join('');
  assert.equal(lines([[`./${forgedName}`, hX]]), lines([['./a', hA], ['./b', hX]]));

  const nul = (recs) => sha256(recs.map(([p, h]) => `F\0${p}\0${h}\0`).join(''));
  const p = treeDigest(plain);
  const f = treeDigest(forged);
  assert.equal(p.status, 0, p.stderr);
  assert.equal(f.status, 0, f.stderr);
  assert.equal(p.stdout.trim(), nul([['./a', hA], ['./b', hX]]));
  assert.equal(f.stdout.trim(), nul([[`./${forgedName}`, hX]]));
  assert.notEqual(f.stdout, p.stdout);

  assert.equal(treeDigest(forged).stdout, f.stdout);
  const moved = join(tmp('ow-nl-moved-'), 'package');
  cpSync(forged, moved, { recursive: true });
  assert.equal(treeDigest(moved).stdout, f.stdout);
});

// --- MCP stdout hygiene (fake server; proves the checker, not OpenWiki) -----

test('smoke: clean JSON-RPC stdout passes handshake and tools/list', () => {
  const { release, lock } = makeRelease();
  const r = run(VERIFY, ['--release', release, '--lock', lock, '--smoke']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /handshake ok, protocolVersion 2025-06-18, tools openwiki_search,openwiki_read/);
});

test('smoke: non JSON-RPC stdout is rejected as contamination', () => {
  const { release, lock } = makeRelease({ banner: true });
  const r = run(VERIFY, ['--release', release, '--lock', lock, '--smoke']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /stdout contamination/);
});

// --- Installer opt-in -------------------------------------------------------

test('install: refuses to run without --confirm and creates nothing', () => {
  const home = join(tmp('ow-home-'), 'ds4-openwiki');
  const r = run(INSTALL, ['--home', home]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /opt-in/);
  assert.equal(existsSync(home), false);
});

test('install: STOP from source verification propagates and installs nothing', () => {
  const { root, src, lock } = makeSource({ 'src/integrations/mcp/stdio.ts': 'export {};\n' });
  const home = join(root, 'ds4-openwiki');
  const r = run(INSTALL, ['--confirm', '--source', src, '--lock', writeLock(root, lock), '--home', home]);
  assert.equal(r.status, 3);
  assert.equal(existsSync(home), false);
  assert.equal(readFileSync(join(src, 'src/integrations/mcp/stdio.ts'), 'utf8'), 'export {};\n');
});

// --- Installer idempotency and ownership ------------------------------------

// Toolchain stub: `node` delegates to this Node; the `corepack` next to it fakes
// the pinned pnpm, a no-op install and a build writing dist/cli/cli.js. Nothing
// is fetched and every write lands in the staging dir under the temp home.
function makeToolchain() {
  const dir = tmp('ow-bin-');
  const node = join(dir, 'node');
  writeFileSync(node, `#!/bin/sh\nexec '${process.execPath}' "$@"\n`);
  writeFileSync(join(dir, 'corepack'), `#!/bin/sh
[ "$1" = pnpm ] || exit 64
case "$2" in
  --version) echo 11.25.0 ;;
  install) ;;
  run) [ "$3" = build ] || exit 64; mkdir -p dist/cli && printf 'console.log("fixture build");\\n' > dist/cli/cli.js ;;
  *) exit 64 ;;
esac
`);
  chmodSync(node, 0o755);
  chmodSync(join(dir, 'corepack'), 0o755);
  return node;
}

// Recursive listing with content digests and mtimes: any rewrite shows up.
function snapshot(dir) {
  return readdirSync(dir, { recursive: true }).sort().map((rel) => {
    const p = join(dir, rel);
    const st = lstatSync(p);
    const kind = st.isSymbolicLink() ? `L ${readlinkSync(p)}` : st.isFile() ? `F ${sha256(readFileSync(p))}` : 'D';
    return `${rel} ${kind} ${st.mtimeMs}`;
  });
}

function installFixture() {
  const { root, src, lock } = makeSource();
  const node = makeToolchain();
  const lockFile = writeLock(root, lock);
  const install = (home, ...extra) =>
    run(INSTALL, ['--confirm', '--source', src, '--lock', lockFile, '--home', home, ...extra], { OPENWIKI_NODE: node });
  return { root, src, install };
}

// Installs once into a scratch home to learn the deterministic release id.
function releaseIdFor(fx) {
  const home = join(fx.root, 'scratch-home');
  const r = fx.install(home);
  assert.equal(r.status, 0, r.stderr);
  const ids = readdirSync(join(home, 'releases'));
  assert.equal(ids.length, 1);
  assert.match(ids[0], /^[0-9a-f]{40}-node\d+-[a-z0-9-]+$/);
  return { id: ids[0], release: join(home, 'releases', ids[0]) };
}

test('install: second run with the same pin reuses the verified release unchanged', () => {
  const fx = installFixture();
  const home = join(fx.root, 'ds4-openwiki');
  const first = fx.install(home);
  assert.equal(first.status, 0, first.stderr);
  const [id] = readdirSync(join(home, 'releases'));
  const manifest = JSON.parse(readFileSync(join(home, 'releases', id, 'manifest.json'), 'utf8'));
  assert.equal(manifest.releaseId, id);
  assert.equal(manifest.mcpSmoke, 'not-run');
  const before = snapshot(home);

  const second = fx.install(home);
  assert.equal(second.status, 0, second.stderr);
  assert.match(second.stderr, /already present, verifying instead of overwriting/);
  assert.deepEqual(snapshot(home), before);
  assert.equal(git(fx.src, 'status', '--porcelain', '--untracked-files=all'), '');
});

test('install: --activate twice keeps current on the same release', () => {
  const fx = installFixture();
  const home = join(fx.root, 'ds4-openwiki');
  const first = fx.install(home, '--activate');
  assert.equal(first.status, 0, first.stderr);
  const [id] = readdirSync(join(home, 'releases'));
  assert.equal(readlinkSync(join(home, 'current')), `releases/${id}`);
  const releases = snapshot(join(home, 'releases'));

  const second = fx.install(home, '--activate');
  assert.equal(second.status, 0, second.stderr);
  assert.equal(readlinkSync(join(home, 'current')), `releases/${id}`);
  assert.deepEqual(snapshot(join(home, 'releases')), releases);
  assert.deepEqual(readdirSync(home).sort(), ['current', 'releases']);
});

test('upgrade: contract drift fails closed and the prior pinned release can be restored', () => {
  const sourceN = makeSource({ 'src/cli/commands.ts': `${SUPPORTED_SOURCES['src/cli/commands.ts']}\n// release N\n` });
  const sourceN1 = makeSource({ 'src/cli/commands.ts': `${SUPPORTED_SOURCES['src/cli/commands.ts']}\n// release N+1\n` });
  const drifted = makeSource({ 'src/integrations/mcp/stdio.ts': 'export {}; // transport contract removed\n' });
  const node = makeToolchain();
  const lockN = writeLock(sourceN.root, sourceN.lock);
  const lockN1 = writeLock(sourceN1.root, sourceN1.lock);
  const lockDrifted = writeLock(drifted.root, drifted.lock);
  const home = join(sourceN.root, 'ds4-openwiki');
  const install = (source, lock, ...extra) => run(
    INSTALL,
    ['--confirm', '--source', source, '--lock', lock, '--home', home, ...extra],
    { OPENWIKI_NODE: node },
  );

  const initial = install(sourceN.src, lockN, '--activate');
  assert.equal(initial.status, 0, initial.stderr);
  const releaseN = readlinkSync(join(home, 'current'));

  const upgraded = install(sourceN1.src, lockN1, '--activate');
  assert.equal(upgraded.status, 0, upgraded.stderr);
  const releaseN1 = readlinkSync(join(home, 'current'));
  assert.notEqual(releaseN1, releaseN, 'new pin activates a distinct immutable release');
  assert.ok(existsSync(join(home, releaseN, 'manifest.json')));
  assert.ok(existsSync(join(home, releaseN1, 'manifest.json')));

  const rejected = install(drifted.src, lockDrifted, '--activate');
  assert.equal(rejected.status, 3, rejected.stderr);
  assert.match(rejected.stderr, /STOP: .*stdio transport/);
  assert.equal(readlinkSync(join(home, 'current')), releaseN1, 'contract drift leaves active release untouched');

  const rollback = install(sourceN.src, lockN, '--activate');
  assert.equal(rollback.status, 0, rollback.stderr);
  assert.equal(readlinkSync(join(home, 'current')), releaseN, 'reinstalling the prior pin restores release N');
  assert.ok(existsSync(join(home, releaseN1, 'manifest.json')), 'rollback preserves N+1 for diagnosis');
});

test('install: existing release dir not produced by the gateway is left untouched', () => {
  const fx = installFixture();
  const { id } = releaseIdFor(fx);
  const home = join(fx.root, 'ds4-openwiki');
  mkdirSync(join(home, 'releases', id), { recursive: true });
  writeFileSync(join(home, 'releases', id, 'foreign.txt'), 'not ours\n');
  const before = snapshot(home);

  const r = fx.install(home, '--activate');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /existing release does not verify; left untouched/);
  assert.deepEqual(snapshot(home), before);
});

test('install: symlinked release path is refused even if its target verifies', () => {
  const fx = installFixture();
  const { id, release } = releaseIdFor(fx);
  const outside = join(fx.root, 'elsewhere', id);
  cpSync(release, outside, { recursive: true });
  const home = join(fx.root, 'ds4-openwiki');
  mkdirSync(join(home, 'releases'), { recursive: true });
  symlinkSync(outside, join(home, 'releases', id));
  const before = [snapshot(home), snapshot(outside)];

  const r = fx.install(home, '--activate');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /refusing symlinked release path/);
  assert.deepEqual([snapshot(home), snapshot(outside)], before);
});

test('install: non-symlink current is refused before anything is built', () => {
  const fx = installFixture();
  const home = join(fx.root, 'ds4-openwiki');
  mkdirSync(join(home, 'current'), { recursive: true });
  writeFileSync(join(home, 'current', 'mine.txt'), 'user data\n');
  const before = snapshot(home);

  const r = fx.install(home, '--activate');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /refusing to replace non-symlink/);
  assert.deepEqual(snapshot(home), before);
  assert.equal(existsSync(join(home, 'releases')), false);
});
