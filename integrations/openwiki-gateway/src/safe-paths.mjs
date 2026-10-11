// Workspace path confinement and OS sandbox for the OpenWiki child (WP03).
//
// Two layers, both fail closed:
//
// 1. Gateway-side resolution (`resolveInRoot`): model-supplied path hints are
//    relative, component-checked and resolved with lstat/realpath against an
//    allowlisted root whose identity (dev/inode/realpath/owner/mode) is
//    re-verified before and after every resolution.
//
// 2. Child-side confinement (`buildSandboxInvocation`): the upstream process
//    runs under bubblewrap with a fresh mount namespace in which only the
//    selected workspace root, the pinned release and the runtime are mounted,
//    read-only. Other workspaces, the user home and OpenWiki's linked-wiki
//    registry simply do not exist inside the sandbox, so a linked search or a
//    symlink swap cannot read them. The gateway never runs the child without it.

import { execFileSync, spawnSync } from 'node:child_process';
import { lstatSync, opendirSync, readlinkSync, realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertAbsolutePath,
  assertOwnerAndMode,
  getWorkspace,
  isWithin,
  pathsOverlap,
  verifyUpstream,
} from './config.mjs';

export const MAX_HINT_LENGTH = 1024;
export const SANDBOX_HOME = '/home/openwiki';
export const SANDBOX_TMP = '/tmp';
export const SANDBOX_OPENWIKI_CONFIG_DIR = `${SANDBOX_HOME}/.openwiki`;

const SYSTEM_RO_DIRS = ['/usr'];
// Merged-/usr symlinks on most distros; real directories on older ones.
const SYSTEM_LINK_OR_DIRS = ['/bin', '/sbin', '/lib', '/lib32', '/lib64', '/libx32'];
// Dynamic loader configuration only; no account, network or TLS data.
const SYSTEM_RO_FILES = ['/etc/ld.so.cache', '/etc/ld.so.conf', '/etc/ld.so.conf.d', '/etc/localtime'];
const RESERVED_ENV = new Set(['PATH', 'HOME', 'TMPDIR', 'OPENWIKI_CONFIG_DIR', 'LANG', 'LC_ALL']);
const ENV_KEY_PATTERN = /^[A-Z][A-Z0-9_]{0,63}$/;
const PROBE_TIMEOUT_MS = 5000;
const HOST_ADAPTER = fileURLToPath(new URL('./upstream-host-adapter.mjs', import.meta.url));

// Lookalikes of '.', '/', '\' and invisible/bidi controls that could make a
// hint display differently from how it resolves.
const CONFUSABLE_PATTERN =
  /[ ․‥…。﹒．⁄∕╱⧸／∖╲⧵⧹﹨＼​-‏‪-‮⁠-⁤⁦-⁩﻿]/;

export class PathError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PathError';
  }
}

function fail(message) {
  throw new PathError(message);
}

// --- hint validation ---------------------------------------------------------

/**
 * Validate an untrusted relative path hint and return its components.
 * Rejects: empty, too long, NUL, CR/LF and other controls, backslash, drive
 * letters, absolute or `~` paths, empty/`.`/`..` components and known
 * Unicode confusables.
 */
export function validateRelativeHint(hint) {
  if (typeof hint !== 'string' || hint.length === 0) fail('path hint must be a non-empty string');
  if (hint.length > MAX_HINT_LENGTH) fail(`path hint exceeds ${MAX_HINT_LENGTH} characters`);
  if (hint.includes('\u0000')) fail('path hint contains NUL');
  if (/[\r\n]/.test(hint)) fail('path hint contains CR/LF');
  if (/[\u0001-\u001f\u007f-\u009f]/.test(hint)) fail('path hint contains control characters');
  if (hint.includes('\\')) fail('path hint contains a backslash');
  if (/^[A-Za-z]:/.test(hint)) fail('path hint contains a drive letter');
  if (hint.startsWith('/')) fail('path hint must be relative');
  if (hint.startsWith('~')) fail('path hint must not reference a home directory');
  if (CONFUSABLE_PATTERN.test(hint)) fail('path hint contains confusable Unicode characters');
  const parts = hint.split('/');
  for (const part of parts) {
    if (part === '' || part === '.' || part === '..') fail('path hint contains an empty, "." or ".." component');
  }
  return parts;
}

// --- root identity ------------------------------------------------------------

/**
 * Verify that the workspace root is still the directory validated at startup:
 * not a symlink, same dev/inode and same canonical path (no swapped ancestor).
 */
export function assertRootIdentity(workspace) {
  let st;
  let real;
  try {
    st = lstatSync(workspace.root);
    real = realpathSync(workspace.root);
  } catch (err) {
    fail(`workspace ${workspace.id} root is gone: ${err.code ?? err.message}`);
  }
  if (st.isSymbolicLink() || !st.isDirectory()) fail(`workspace ${workspace.id} root was replaced`);
  if (st.dev !== workspace.dev || st.ino !== workspace.ino) fail(`workspace ${workspace.id} root identity changed`);
  if (real !== workspace.root) fail(`workspace ${workspace.id} root path no longer canonical`);
  return true;
}

// --- resolution ---------------------------------------------------------------

/**
 * Resolve an untrusted relative hint inside `workspace` (from getWorkspace).
 * Walks component by component with lstat; a symlink is followed only if its
 * canonical target stays inside the root. The target must exist. Root identity
 * is checked before and after the walk so a concurrent swap is detected.
 *
 * Returns { workspaceId, root, relative, absolute } with canonical paths.
 */
export function resolveInRoot(workspace, hint) {
  const parts = validateRelativeHint(hint);
  assertRootIdentity(workspace);
  const { root } = workspace;
  let current = root;
  for (const part of parts) {
    const next = join(current, part);
    let st;
    try {
      st = lstatSync(next);
    } catch (err) {
      fail(`path hint does not resolve: ${err.code ?? err.message}`);
    }
    if (st.isSymbolicLink()) {
      let target;
      try {
        target = realpathSync(next);
      } catch (err) {
        fail(`symlink in path hint does not resolve: ${err.code ?? err.message}`);
      }
      if (!isWithin(root, target)) fail('symlink in path hint escapes the workspace root');
      current = target;
    } else {
      current = next;
    }
  }
  let absolute;
  try {
    absolute = realpathSync(current);
  } catch (err) {
    fail(`path hint does not resolve: ${err.code ?? err.message}`);
  }
  if (!isWithin(root, absolute)) fail('path hint escapes the workspace root');
  assertRootIdentity(workspace);
  return Object.freeze({ workspaceId: workspace.id, root, relative: relative(root, absolute) || '.', absolute });
}

// --- sandbox --------------------------------------------------------------------

function lstatMaybe(path) {
  try {
    return lstatSync(path);
  } catch (error) {
    return null;
  }
}

/** Directory to mount for the interpreter, or null when /usr already covers it. */
function runtimeDirFor(node) {
  if (SYSTEM_RO_DIRS.some((dir) => isWithin(dir, node))) return null;
  const binDir = dirname(node);
  return basename(binDir) === 'bin' ? dirname(binDir) : binDir;
}

function assertMountAllowed(source, config, selectedId) {
  if (isWithin(source, config.userHome)) fail(`sandbox mount ${source} would expose the user home`);
  for (const ws of Object.values(config.workspaces)) {
    if (ws.id !== selectedId && pathsOverlap(source, ws.root)) {
      fail(`sandbox mount ${source} would expose workspace ${ws.id}`);
    }
  }
}

function assertBwrap(config) {
  if (process.platform !== 'linux') fail('OS sandbox requires Linux bubblewrap');
  const { bwrap } = config.sandbox;
  const st = lstatMaybe(bwrap);
  if (!st || st.isSymbolicLink() || !st.isFile()) fail(`bubblewrap not available at ${bwrap}`);
  try {
    assertOwnerAndMode(st, config.uid, 'sandbox.bwrap', [0]);
  } catch (err) {
    fail(err.message);
  }
  return bwrap;
}

/**
 * Build the bubblewrap invocation that runs `argv` for exactly one allowlisted
 * workspace. Nothing is spawned here; the caller must use
 *   spawn(inv.file, inv.args, { env: inv.env, shell: false, ... })
 *
 * Mount namespace (everything else is absent):
 *   /usr, /bin|/lib* links, loader config   read-only (system runtime)
 *   /proc, /dev                             private (new PID namespace)
 *   /tmp, $HOME=/home/openwiki              private tmpfs, discarded on exit
 *   node runtime dir (if outside /usr)      read-only
 *   upstream.releaseDir                     read-only
 *   selected workspace root                 read-only, cwd
 * Namespaces: all unshared incl. network; dies with the gateway; new session.
 *
 * `argv` defaults to [upstream.node, upstream.executable]; argv[0] must live in
 * the runtime or release mounts. `extraEnv` may add variables but never
 * override the reserved ones. Re-verifies root identity and the pinned
 * executable first. Throws PathError (or ConfigError) instead of degrading.
 */
function validateAdminWriteRoot(ws) {
  const path = join(ws.root, 'openwiki');
  const st = lstatMaybe(path);
  if (!st) fail('ADMIN sandbox requires <workspace>/openwiki to be created explicitly by the controller');
  if (st.isSymbolicLink() || !st.isDirectory()) fail('ADMIN sandbox write root must be a real directory');
  if (st.dev !== ws.dev || st.uid !== process.getuid() || (st.mode & 0o022) !== 0) {
    fail('ADMIN sandbox write root must be on the workspace filesystem, owned by DS4 and not group/world writable');
  }
  let real;
  try {
    real = realpathSync(path);
  } catch (err) {
    fail(`ADMIN sandbox write root is not resolvable: ${err.code ?? err.message}`);
  }
  if (real !== path) fail('ADMIN sandbox write root path is not canonical');
  // A writable bind mount also grants write access to any regular-file inode
  // reachable through it. Refuse pre-existing hard links so a wiki entry can
  // never be an alias for a source file elsewhere in the repository. As with
  // the gateway's other path checks, this assumes no hostile same-UID process
  // mutates the host directory concurrently between validation and spawn.
  const pending = [path];
  let inspected = 0;
  while (pending.length) {
    const dir = pending.pop();
    let handle;
    try { handle = opendirSync(dir); }
    catch (err) { fail(`ADMIN sandbox write root cannot be inspected: ${err.code ?? err.message}`); }
    try {
      for (let entry = handle.readSync(); entry; entry = handle.readSync()) {
        if (++inspected > 100_000) fail('ADMIN sandbox write root contains too many entries to validate safely');
        const child = join(dir, entry.name);
        const item = lstatMaybe(child);
        if (!item) fail('ADMIN sandbox write root changed during validation');
        if (item.isDirectory()) pending.push(child);
        else if (item.isFile() && item.nlink > 1) {
          fail('ADMIN sandbox write root contains a hard-linked file');
        }
      }
    } finally { handle.closeSync(); }
  }
  return Object.freeze({ path, dev: st.dev, ino: st.ino, uid: st.uid, mode: st.mode });
}

function assertAdminWriteRootIdentity(ws, expected) {
  const current = validateAdminWriteRoot(ws);
  if (current.dev !== expected.dev || current.ino !== expected.ino ||
      current.uid !== expected.uid || current.mode !== expected.mode) {
    fail('ADMIN sandbox write root identity changed');
  }
}

// A linked worktree's .git file points outside the workspace to shared Git
// metadata. Mount only the selected worktree, refs and objects read-only.
function externalGitMetadataMounts(ws, config) {
  let output;
  try {
    output = execFileSync('/usr/bin/git', ['-C', ws.root, 'rev-parse', '--path-format=absolute', '--git-dir', '--git-common-dir'], {
      encoding: 'utf8', timeout: PROBE_TIMEOUT_MS, stdio: ['ignore', 'pipe', 'ignore'],
      env: { PATH: '/usr/bin:/bin', LC_ALL: 'C', GIT_OPTIONAL_LOCKS: '0', GIT_CONFIG_NOSYSTEM: '1',
        GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' },
    });
  } catch {
    // Keep directory-only workspaces startable; generation itself reports the
    // upstream Git requirement. Only Git worktrees need an extra mount.
    const gitEntry = lstatMaybe(join(ws.root, '.git'));
    if (gitEntry?.isFile()) fail('linked worktree Git metadata could not be resolved');
    return [];
  }
  const [gitDir, commonDir, ...extra] = output.trimEnd().split(/\r?\n/u);
  if (extra.length || !gitDir || !commonDir || !isAbsolute(gitDir) || !isAbsolute(commonDir)) {
    fail('Git returned invalid worktree metadata paths');
  }
  let canonicalGitDir;
  let canonicalCommonDir;
  try {
    canonicalGitDir = realpathSync(gitDir);
    canonicalCommonDir = realpathSync(commonDir);
  } catch {
    fail('Git worktree metadata is not accessible');
  }
  if (canonicalGitDir !== gitDir || canonicalCommonDir !== commonDir) {
    fail('Git worktree metadata paths must be canonical');
  }
  if (isWithin(ws.root, commonDir)) return [];

  const commonStat = lstatMaybe(commonDir);
  const gitDirStat = lstatMaybe(gitDir);
  const worktreesDir = join(commonDir, 'worktrees');
  if (!commonStat || commonStat.isSymbolicLink() || !commonStat.isDirectory() ||
      basename(commonDir) !== '.git' || !isWithin(worktreesDir, gitDir) ||
      commonStat.uid !== config.uid || (commonStat.mode & 0o002) !== 0 ||
      !gitDirStat || gitDirStat.isSymbolicLink() || !gitDirStat.isDirectory() ||
      gitDirStat.uid !== config.uid || (gitDirStat.mode & 0o002) !== 0) {
    fail('external Git metadata must be an owned, non-world-writable common .git directory');
  }
  // Do not expose the common .git root, which also contains hooks, config,
  // logs and metadata for every sibling worktree.
  const candidates = [gitDir, join(commonDir, 'objects'), join(commonDir, 'refs'),
    join(commonDir, 'HEAD'), join(commonDir, 'packed-refs')];
  return candidates.filter((path) => {
    if (!isWithin(commonDir, path)) fail('Git metadata mount escaped the common .git directory');
    const st = lstatMaybe(path);
    if (!st) return false;
    if (st.isSymbolicLink() || (!st.isDirectory() && !st.isFile()) || st.uid !== config.uid || (st.mode & 0o002) !== 0) {
      fail('Git metadata mount must be an owned, non-world-writable file or directory');
    }
    let real;
    try { real = realpathSync(path); } catch { fail('Git metadata mount path is not accessible'); }
    if (real !== path) fail('Git metadata mount path is not canonical');
    return true;
  });
}

function buildSandboxInvocationWithPolicy(config, workspaceId, { argv, extraEnv = {}, adminWriteRoot = false } = {}) {
  if (typeof workspaceId !== 'string') fail('sandbox requires exactly one workspace ID');
  const bwrap = assertBwrap(config);
  const ws = getWorkspace(config, workspaceId);
  assertRootIdentity(ws);
  verifyUpstream(config);

  const writableRoot = adminWriteRoot ? validateAdminWriteRoot(ws) : null;
  const gitMetadataMounts = externalGitMetadataMounts(ws, config);

  const { node, releaseDir, executable } = config.upstream;
  const runtimeDir = runtimeDirFor(node);
  if (writableRoot && [runtimeDir, releaseDir].some((dir) => dir && pathsOverlap(writableRoot.path, dir))) {
    fail('ADMIN sandbox write root overlaps the runtime or pinned release');
  }
  if (gitMetadataMounts.some((mount) => [runtimeDir, releaseDir, ws.root].some((dir) => dir && pathsOverlap(mount, dir)))) {
    fail('external Git metadata overlaps another sandbox mount');
  }
  const command = argv ?? [node, executable];
  if (!Array.isArray(command) || command.length === 0) fail('argv must be a non-empty array');
  for (const arg of command) {
    if (typeof arg !== 'string' || arg.includes('\u0000')) fail('argv entries must be strings without NUL');
  }
  assertAbsolutePath(command[0], 'argv[0]');
  let program;
  try {
    program = realpathSync(command[0]);
  } catch (err) {
    fail(`argv[0] not resolvable: ${err.code ?? err.message}`);
  }
  const programRoots = [...SYSTEM_RO_DIRS, releaseDir, ...(runtimeDir ? [runtimeDir] : [])];
  if (!programRoots.some((dir) => isWithin(dir, program))) fail('argv[0] must be inside the runtime or release mounts');
  const adaptHost = adminWriteRoot && program === node;
  const launchCommand = adaptHost ? [command[0], '--import', HOST_ADAPTER, ...command.slice(1)] : command;

  const env = {
    PATH: runtimeDir ? `${runtimeDir}/bin:/usr/bin:/bin` : '/usr/bin:/bin',
    HOME: SANDBOX_HOME,
    TMPDIR: SANDBOX_TMP,
    // Points OpenWiki at an empty private directory: no wiki-workspaces.json
    // registry, hence no linked wikis, regardless of the host ~/.openwiki.
    OPENWIKI_CONFIG_DIR: SANDBOX_OPENWIKI_CONFIG_DIR,
    LANG: 'C.UTF-8',
    LC_ALL: 'C.UTF-8',
  };
  for (const [key, value] of Object.entries(extraEnv)) {
    if (!ENV_KEY_PATTERN.test(key) || RESERVED_ENV.has(key)) fail(`extraEnv key ${key} not allowed`);
    if (typeof value !== 'string' || value.includes('\u0000')) fail(`extraEnv ${key} must be a string without NUL`);
    env[key] = value;
  }
  if (adaptHost) env.DS4_OPENWIKI_RELEASE_DIR = releaseDir;

  const mounts = [];
  const args = ['--unshare-all', '--unshare-net', '--die-with-parent', '--new-session'];
  for (const dir of SYSTEM_RO_DIRS) {
    assertMountAllowed(dir, config, ws.id);
    mounts.push(dir);
    args.push('--ro-bind', dir, dir);
  }
  for (const path of SYSTEM_LINK_OR_DIRS) {
    const st = lstatMaybe(path);
    if (!st) continue;
    if (st.isSymbolicLink()) {
      args.push('--symlink', readlinkSync(path), path);
    } else if (st.isDirectory()) {
      assertMountAllowed(path, config, ws.id);
      mounts.push(path);
      args.push('--ro-bind', path, path);
    }
  }
  for (const path of SYSTEM_RO_FILES) args.push('--ro-bind-try', path, path);
  args.push('--proc', '/proc', '--dev', '/dev', '--tmpfs', SANDBOX_TMP, '--tmpfs', SANDBOX_HOME);
  // Bound after the tmpfs mounts so roots living under /tmp stay visible.
  for (const dir of [runtimeDir, releaseDir, ws.root]) {
    if (!dir) continue;
    assertMountAllowed(dir, config, ws.id);
    mounts.push(dir);
    args.push('--ro-bind', dir, dir);
  }
  for (const path of gitMetadataMounts) {
    assertMountAllowed(path, config, ws.id);
    mounts.push(path);
    args.push('--ro-bind', path, path);
  }
  if (writableRoot) {
    assertMountAllowed(writableRoot.path, config, ws.id);
    args.push('--bind', writableRoot.path, writableRoot.path);
    // Detect replacement during argument construction before handing paths to bwrap.
    assertAdminWriteRootIdentity(ws, writableRoot);
  }
  if (adaptHost) {
    assertMountAllowed(HOST_ADAPTER, config, ws.id);
    args.push('--ro-bind', HOST_ADAPTER, HOST_ADAPTER);
  }
  args.push('--chdir', ws.root, '--', ...launchCommand);

  return Object.freeze({
    file: bwrap,
    args: Object.freeze(args),
    env: Object.freeze(env),
    mounts: Object.freeze(mounts),
    writableDirs: Object.freeze(writableRoot ? [writableRoot.path] : []),
    workspaceId: ws.id,
    root: ws.root,
  });
}

/** Build the read-only sandbox used by the regular OpenWiki READ gateway. */
export function buildSandboxInvocation(config, workspaceId, options = {}) {
  const { argv, extraEnv } = options;
  return buildSandboxInvocationWithPolicy(config, workspaceId, { argv, extraEnv });
}

/**
 * Build an ADMIN sandbox that keeps the selected repository read-only except
 * for its pre-created, canonical <workspace>/openwiki directory. The caller
 * must create that directory only after an explicit init request and path
 * preflight; this builder never creates or mutates host paths.
 */
export function buildAdminSandboxInvocation(config, workspaceId, options = {}) {
  return buildSandboxInvocationWithPolicy(config, workspaceId, { ...options, adminWriteRoot: true });
}

/**
 * Prove the sandbox actually starts on this host for `workspaceId` by running
 * the pinned node inside it. Throws PathError when bubblewrap, user
 * namespaces or any prerequisite is missing, so callers can refuse to start
 * the upstream instead of running it unconfined.
 */
export function assertSandboxUsable(config, workspaceId, { timeoutMs = PROBE_TIMEOUT_MS } = {}) {
  const probe = 'process.stdout.write(process.cwd() === process.argv[1] ? "ok" : "bad-cwd")';
  const ws = getWorkspace(config, workspaceId);
  const inv = buildSandboxInvocation(config, workspaceId, { argv: [config.upstream.node, '-e', probe, ws.root] });
  const res = spawnSync(inv.file, inv.args, {
    env: inv.env,
    shell: false,
    timeout: timeoutMs,
    // SIGKILL cannot be trapped by bwrap; its death tears down the private PID
    // namespace (--unshare-all, --die-with-parent), so no descendant survives.
    killSignal: 'SIGKILL',
    encoding: 'utf8',
    maxBuffer: 64 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (res.error || res.status !== 0 || res.stdout !== 'ok') {
    const reason = res.error?.code ?? `exit ${res.status ?? res.signal}`;
    fail(`OS sandbox unusable (${reason}): ${String(res.stderr ?? '').slice(0, 500).trim()}`);
  }
  return true;
}
