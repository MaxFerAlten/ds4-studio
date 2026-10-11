// Strict administrative configuration for the OpenWiki gateway (WP03).
//
// The config is written by the operator, never by the user prompt or the LLM.
// Every check fails closed: an unexpected key, type, owner, mode or path is a
// startup error, never a warning. Only Node built-ins are used.
//
// Accepted shape (schema 1):
//
//   {
//     "schema": 1,
//     "listen":   { "transport": "unix", "socketPath": "/abs/gateway.sock" },
//     "upstream": {
//       "node":           "/abs/bin/node",
//       "releaseDir":     "/abs/releases/<id>/package",
//       "executable":     "/abs/releases/<id>/package/dist/cli/cli.js",
//       "expectedSha256": "<legacy field accepted but ignored>"
//     },
//     "sandbox":    { "bwrap": "/usr/bin/bwrap" },        // optional
//     "workspaces": { "<id>": { "root": "/abs/git/top-level" } }   // 1..16
//   }
//
// Linked wiki workspaces are disabled in the MVP: OpenWiki can search several
// linked repositories from one request, and filtering results afterwards is
// too late because the unauthorized read already happened. Any linking key is
// rejected here, and the sandbox (safe-paths.mjs) exposes exactly one root.

import { execFileSync } from 'node:child_process';
import {
  closeSync,
  constants as fsConstants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, normalize, relative, sep } from 'node:path';

export const CONFIG_SCHEMA = 1;
export const MAX_WORKSPACES = 16;
export const WORKSPACE_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

const MAX_CONFIG_BYTES = 64 * 1024;
const MAX_JSON_DEPTH = 16;
// sun_path is 108 bytes on Linux, including the terminating NUL.
const MAX_SOCKET_PATH_BYTES = 107;
const DEFAULT_BWRAP = '/usr/bin/bwrap';
const DEFAULT_GIT = '/usr/bin/git';
const GIT_TIMEOUT_MS = 5000;

const TOP_LEVEL_KEYS = ['schema', 'listen', 'upstream', 'sandbox', 'workspaces'];
const LISTEN_KEYS = ['transport', 'socketPath'];
const UPSTREAM_KEYS = ['node', 'releaseDir', 'executable', 'expectedSha256'];
const SANDBOX_KEYS = ['bwrap'];
const WORKSPACE_KEYS = ['root'];
// Keys that would enable OpenWiki linked/multi-repo search. Reported with a
// dedicated message so operators know the feature is off, not misspelled.
const LINKING_KEYS = new Set([
  'linked',
  'links',
  'linkedWikis',
  'linkedWorkspaces',
  'wikiWorkspaces',
  'workspaceLinks',
  'members',
  'wikis',
]);

export class ConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ConfigError';
  }
}

function fail(message) {
  throw new ConfigError(message);
}

// --- strict JSON ----------------------------------------------------------

/**
 * Parse JSON text like JSON.parse, but reject duplicate object keys (which
 * JSON.parse silently resolves to the last value) and nesting deeper than
 * MAX_JSON_DEPTH. Objects are created with a null prototype.
 */
export function parseJsonStrict(text) {
  if (typeof text !== 'string') fail('config text must be a string');
  const ws = /[ \t\n\r]*/y;
  const str = /"(?:[^"\\\u0000-\u001f]|\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4}))*"/y;
  const num = /-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/y;
  let i = 0;

  const skip = () => {
    ws.lastIndex = i;
    ws.exec(text);
    i = ws.lastIndex;
  };
  const token = (re) => {
    re.lastIndex = i;
    const m = re.exec(text);
    if (!m) fail(`invalid JSON at offset ${i}`);
    i = re.lastIndex;
    return m[0];
  };
  const value = (depth) => {
    if (depth > MAX_JSON_DEPTH) fail('config JSON nested too deeply');
    skip();
    const c = text[i];
    if (c === '{') {
      i += 1;
      const out = Object.create(null);
      skip();
      if (text[i] === '}') {
        i += 1;
        return out;
      }
      for (;;) {
        skip();
        const key = JSON.parse(token(str));
        if (Object.hasOwn(out, key)) fail(`duplicate JSON key: ${JSON.stringify(key)}`);
        skip();
        if (text[i] !== ':') fail(`invalid JSON at offset ${i}`);
        i += 1;
        out[key] = value(depth + 1);
        skip();
        if (text[i] === ',') {
          i += 1;
          continue;
        }
        if (text[i] === '}') {
          i += 1;
          return out;
        }
        fail(`invalid JSON at offset ${i}`);
      }
    }
    if (c === '[') {
      i += 1;
      const out = [];
      skip();
      if (text[i] === ']') {
        i += 1;
        return out;
      }
      for (;;) {
        out.push(value(depth + 1));
        skip();
        if (text[i] === ',') {
          i += 1;
          continue;
        }
        if (text[i] === ']') {
          i += 1;
          return out;
        }
        fail(`invalid JSON at offset ${i}`);
      }
    }
    if (c === '"') return JSON.parse(token(str));
    for (const [lit, v] of [['true', true], ['false', false], ['null', null]]) {
      if (text.startsWith(lit, i)) {
        i += lit.length;
        return v;
      }
    }
    return Number(token(num));
  };

  const result = value(0);
  skip();
  if (i !== text.length) fail(`trailing data in JSON at offset ${i}`);
  return result;
}

// --- path and ownership helpers --------------------------------------------

/** True when `candidate` equals `root` or lies below it, by path components. */
export function isWithin(root, candidate) {
  const rel = relative(root, candidate);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

/** True when either path contains the other. */
export function pathsOverlap(a, b) {
  return isWithin(a, b) || isWithin(b, a);
}

/** Require an absolute, already-normalized path without NUL or control chars. */
export function assertAbsolutePath(value, what) {
  if (typeof value !== 'string' || value.length === 0) fail(`${what} must be a non-empty string`);
  if (/[\u0000-\u001f\u007f]/.test(value)) fail(`${what} contains control characters`);
  if (value.includes('\\')) fail(`${what} must not contain backslashes`);
  if (!isAbsolute(value)) fail(`${what} must be an absolute path`);
  if (normalize(value) !== value || (value.length > 1 && value.endsWith('/'))) {
    fail(`${what} must be a normalized absolute path`);
  }
  return value;
}

/**
 * Reject a stat result not owned by `uid` (or by one of `extraOwners`), or
 * writable by group/world.
 */
export function assertOwnerAndMode(st, uid, what, extraOwners = []) {
  if (st.uid !== uid && !extraOwners.includes(st.uid)) {
    fail(`${what} is owned by uid ${st.uid}, expected ${uid}`);
  }
  if ((st.mode & 0o022) !== 0) {
    fail(`${what} is group- or world-writable (mode ${(st.mode & 0o7777).toString(8)})`);
  }
}

function lstatOrFail(path, what) {
  try {
    return lstatSync(path);
  } catch (err) {
    fail(`${what} not accessible: ${err.code ?? err.message}`);
  }
}

function realpathOrFail(path, what) {
  try {
    return realpathSync(path);
  } catch (err) {
    fail(`${what} not resolvable: ${err.code ?? err.message}`);
  }
}

/**
 * Open a regular file without following a final symlink, verify the opened
 * inode matches the lstat'ed path (no swap between the two), check owner and
 * mode, and return its bytes.
 */
function readRegularFileNoFollow(path, what, uid, { maxBytes = Infinity, extraOwners = [] } = {}) {
  const pre = lstatOrFail(path, what);
  if (pre.isSymbolicLink()) fail(`${what} must not be a symlink`);
  if (!pre.isFile()) fail(`${what} must be a regular file`);
  let fd;
  try {
    fd = openSync(path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW | fsConstants.O_NONBLOCK);
  } catch (err) {
    fail(`${what} cannot be opened: ${err.code ?? err.message}`);
  }
  try {
    const st = fstatSync(fd);
    if (!st.isFile() || st.dev !== pre.dev || st.ino !== pre.ino) fail(`${what} changed while opening`);
    assertOwnerAndMode(st, uid, what, extraOwners);
    if (st.size > maxBytes) fail(`${what} exceeds ${maxBytes} bytes`);
    return { bytes: readFileSync(fd), stat: st };
  } finally {
    closeSync(fd);
  }
}

function requireObject(value, what, allowed) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail(`${what} must be an object`);
  for (const key of Object.keys(value)) {
    if (LINKING_KEYS.has(key)) fail(`${what}.${key}: linked wiki workspaces are disabled in the MVP`);
    if (!allowed.includes(key)) fail(`${what}: unknown key ${JSON.stringify(key)}`);
  }
  return value;
}

// --- git -------------------------------------------------------------------

/**
 * Return `git rev-parse --show-toplevel` for `dir`, canonicalized. Runs git
 * with an argv array (shell=false), a fixed PATH and no user/system config so
 * the repository cannot be redirected by GIT_DIR or config includes.
 */
export function gitTopLevel(dir, { git = DEFAULT_GIT } = {}) {
  let out;
  try {
    out = execFileSync(git, ['-C', dir, 'rev-parse', '--show-toplevel'], {
      encoding: 'utf8',
      shell: false,
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: 64 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        PATH: '/usr/bin:/bin',
        LC_ALL: 'C',
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_CONFIG_GLOBAL: '/dev/null',
        GIT_TERMINAL_PROMPT: '0',
      },
    });
  } catch (err) {
    fail(`git rev-parse --show-toplevel failed for ${dir}: ${err.code ?? err.status ?? err.message}`);
  }
  const top = out.endsWith('\n') ? out.slice(0, -1) : out;
  if (!top || top.includes('\n')) fail(`unexpected git top-level output for ${dir}`);
  return realpathOrFail(top, 'git top-level');
}

// --- section validators ------------------------------------------------------

function parseListen(raw) {
  const listen = requireObject(raw, 'listen', LISTEN_KEYS);
  if (listen.transport !== 'unix') fail('listen.transport must be "unix" (unix-only MVP)');
  const socketPath = assertAbsolutePath(listen.socketPath, 'listen.socketPath');
  if (Buffer.byteLength(socketPath) > MAX_SOCKET_PATH_BYTES) {
    fail(`listen.socketPath exceeds ${MAX_SOCKET_PATH_BYTES} bytes`);
  }
  return Object.freeze({ transport: 'unix', socketPath });
}

function parseUpstream(raw, uid) {
  const up = requireObject(raw, 'upstream', UPSTREAM_KEYS);
  for (const key of ['node', 'releaseDir', 'executable']) {
    if (up[key] === undefined) fail(`upstream.${key} is required`);
  }

  const releaseDir = assertAbsolutePath(up.releaseDir, 'upstream.releaseDir');
  const relStat = lstatOrFail(releaseDir, 'upstream.releaseDir');
  if (relStat.isSymbolicLink() || !relStat.isDirectory()) fail('upstream.releaseDir must be a real directory');
  if (realpathOrFail(releaseDir, 'upstream.releaseDir') !== releaseDir) {
    fail('upstream.releaseDir must be canonical (no symlinked components)');
  }
  assertOwnerAndMode(relStat, uid, 'upstream.releaseDir');

  const executable = assertAbsolutePath(up.executable, 'upstream.executable');
  if (!isWithin(releaseDir, executable) || executable === releaseDir) {
    fail('upstream.executable must be inside upstream.releaseDir');
  }
  if (realpathOrFail(dirname(executable), 'upstream.executable directory') !== dirname(executable)) {
    fail('upstream.executable must not traverse symlinked directories');
  }
  const stat = lstatOrFail(executable, 'upstream.executable');
  if (stat.isSymbolicLink()) fail('upstream.executable must not be a symlink');
  if (!stat.isFile()) fail('upstream.executable must be a regular file');
  assertOwnerAndMode(stat, uid, 'upstream.executable');

  // The interpreter may be a distro or nvm symlink; pin its canonical target.
  const nodeConfigured = assertAbsolutePath(up.node, 'upstream.node');
  const node = realpathOrFail(nodeConfigured, 'upstream.node');
  const nodeStat = lstatOrFail(node, 'upstream.node');
  if (!nodeStat.isFile()) fail('upstream.node must resolve to a regular file');
  assertOwnerAndMode(nodeStat, uid, 'upstream.node', [0]);

  return Object.freeze({
    node,
    releaseDir,
    releaseIdentity: Object.freeze({ dev: relStat.dev, ino: relStat.ino }),
    executable,
    executableIdentity: Object.freeze({ dev: stat.dev, ino: stat.ino }),
  });
}

function parseSandbox(raw, uid) {
  const sb = raw === undefined ? Object.create(null) : requireObject(raw, 'sandbox', SANDBOX_KEYS);
  const bwrap = assertAbsolutePath(sb.bwrap ?? DEFAULT_BWRAP, 'sandbox.bwrap');
  const st = lstatOrFail(bwrap, 'sandbox.bwrap');
  if (st.isSymbolicLink()) fail('sandbox.bwrap must not be a symlink');
  if (!st.isFile()) fail('sandbox.bwrap must be a regular file');
  assertOwnerAndMode(st, uid, 'sandbox.bwrap', [0]);
  return Object.freeze({ bwrap });
}

/** Validate an operator- or command-selected repository before any mutation. */
export function validateWorkspaceRoot(configuredRoot, {
  uid = process.getuid(),
  git = DEFAULT_GIT,
  userHome = homedir(),
} = {}) {
  const label = 'workspace root';
  const configured = assertAbsolutePath(configuredRoot, label);
  const root = realpathOrFail(configured, label);
  const st = lstatOrFail(root, label);
  if (!st.isDirectory()) fail(`${label} is not a directory`);
  const home = realpathOrFail(userHome, 'user home');
  if (root === '/' || isWithin(root, home)) {
    fail(`${label} must not be the filesystem root, the user home or one of its ancestors`);
  }
  return Object.freeze({ root, dev: st.dev, ino: st.ino, uid: st.uid, mode: st.mode & 0o7777 });
}

function parseWorkspace(id, raw, { uid, git, userHome }) {
  if (!WORKSPACE_ID_PATTERN.test(id)) fail(`invalid workspace ID ${JSON.stringify(id)}`);
  const entry = requireObject(raw, `workspaces.${id}`, WORKSPACE_KEYS);
  const workspace = validateWorkspaceRoot(entry.root, { uid, git, userHome });
  return Object.freeze({ id, ...workspace });
}

function parseWorkspaces(raw, ctx, upstream) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) fail('workspaces must be an object');
  const ids = Object.keys(raw);
  if (ids.length < 1 || ids.length > MAX_WORKSPACES) fail(`workspaces must contain 1..${MAX_WORKSPACES} entries`);
  const out = Object.create(null);
  const list = [];
  for (const id of ids) {
    if (LINKING_KEYS.has(id)) fail(`workspaces.${id}: linked wiki workspaces are disabled in the MVP`);
    const ws = parseWorkspace(id, raw[id], ctx);
    for (const other of list) {
      if (pathsOverlap(other.root, ws.root)) fail(`workspaces ${other.id} and ${id} overlap`);
    }
    for (const [what, path] of [['upstream.releaseDir', upstream.releaseDir], ['upstream.node', upstream.node]]) {
      if (pathsOverlap(ws.root, path)) fail(`workspaces.${id}.root overlaps ${what}`);
    }
    list.push(ws);
    out[id] = ws;
  }
  return Object.freeze(out);
}

// --- public API ------------------------------------------------------------

/**
 * Load and validate the gateway config at absolute path `file`.
 *
 * Options (for tests and embedding; production uses the defaults):
 *   uid       expected owner of config, roots and release (default getuid())
 *   git       absolute git binary used for the top-level check
 *   userHome  home directory that no mount may expose (default os.homedir())
 *
 * Returns a deeply frozen object; `workspaces` is a null-prototype map of
 * id -> { id, root, dev, ino, uid, mode }. Throws ConfigError on any problem.
 */
export function loadConfig(file, { uid = process.getuid(), git = DEFAULT_GIT, userHome = homedir() } = {}) {
  assertAbsolutePath(file, 'config path');
  const parent = lstatOrFail(dirname(file), 'config directory');
  if (!parent.isDirectory()) fail('config directory is not a directory');
  assertOwnerAndMode(parent, uid, 'config directory', [0]);
  const { bytes } = readRegularFileNoFollow(file, 'config file', uid, { maxBytes: MAX_CONFIG_BYTES });

  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes);
  } catch {
    fail('config file is not valid UTF-8');
  }
  const raw = parseJsonStrict(text);
  requireObject(raw, 'config', TOP_LEVEL_KEYS);
  if (raw.schema !== CONFIG_SCHEMA) fail(`unsupported config schema ${JSON.stringify(raw.schema)}`);

  const home = realpathOrFail(userHome, 'user home');
  const listen = parseListen(raw.listen);
  const upstream = parseUpstream(raw.upstream, uid);
  const sandbox = parseSandbox(raw.sandbox, uid);
  const workspaces = parseWorkspaces(raw.workspaces, { uid, git, userHome: home }, upstream);

  return Object.freeze({ schema: CONFIG_SCHEMA, file, uid, userHome: home, listen, upstream, sandbox, workspaces });
}

/** Return the workspace for an allowlisted ID, or throw. No fallback. */
export function getWorkspace(config, id) {
  if (typeof id !== 'string' || !WORKSPACE_ID_PATTERN.test(id)) fail('invalid workspace ID');
  if (!Object.hasOwn(config.workspaces, id)) fail(`workspace ${JSON.stringify(id)} is not allowlisted`);
  return config.workspaces[id];
}

/**
 * Re-check upstream before each spawn: same release directory and executable
 * identities, still regular files and not symlinks.
 */
export function verifyUpstream(config) {
  const up = config.upstream;
  const rel = lstatOrFail(up.releaseDir, 'upstream.releaseDir');
  if (rel.isSymbolicLink() || rel.dev !== up.releaseIdentity.dev || rel.ino !== up.releaseIdentity.ino) {
    fail('upstream.releaseDir identity changed since startup');
  }
  const stat = lstatOrFail(up.executable, 'upstream.executable');
  if (stat.isSymbolicLink()) fail('upstream.executable must not be a symlink');
  if (!stat.isFile()) fail('upstream.executable must be a regular file');
  assertOwnerAndMode(stat, config.uid, 'upstream.executable');
  if (stat.dev !== up.executableIdentity.dev || stat.ino !== up.executableIdentity.ino) {
    fail('upstream.executable identity changed since startup');
  }
  return true;
}
