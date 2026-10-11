// Executes page writes through the verified ADMIN bubblewrap policy.
import { spawn } from 'node:child_process';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { buildAdminSandboxInvocation } from './safe-paths.mjs';

const MAX_PAGE_BYTES = 1024 * 1024;
const MAX_TIMEOUT_MS = 30_000;
const TERM_GRACE_MS = 250;
const KILL_WAIT_MS = 1_000;
const PAGE_PATH = /^\/openwiki\/[A-Za-z0-9._/-]{1,240}\.md$/u;

const WRITE_SCRIPT = String.raw`
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const [pageArg, markdown] = process.argv.slice(1);
const root = process.cwd();
const wiki = path.resolve(root, 'openwiki');
const target = path.resolve(pageArg);
const rel = path.relative(wiki, target);
if (!rel || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) throw new Error('path outside openwiki');
const parts = rel.split(path.sep);
let current = wiki;
for (const segment of parts.slice(0, -1)) {
  current = path.join(current, segment);
  try {
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('unsafe parent path');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    fs.mkdirSync(current, { mode: 0o700 });
  }
}
const parent = fs.realpathSync(current);
if (parent !== wiki && !parent.startsWith(wiki + path.sep)) throw new Error('parent escaped openwiki');
let original = null;
try {
  const sourceFd = fs.openSync(target, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    const stat = fs.fstatSync(sourceFd);
    if (!stat.isFile() || stat.nlink !== 1 || stat.uid !== process.getuid()) throw new Error('unsafe existing wiki page');
    original = fs.readFileSync(sourceFd);
  } finally { fs.closeSync(sourceFd); }
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
if (original !== null) {
  const backupDir = path.join(wiki, '.ds4-studio-backups');
  try { fs.mkdirSync(backupDir, { mode: 0o700 }); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  const backupStat = fs.lstatSync(backupDir);
  if (backupStat.isSymbolicLink() || !backupStat.isDirectory() || backupStat.uid !== process.getuid() || (backupStat.mode & 0o077) !== 0) {
    throw new Error('unsafe wiki backup directory');
  }
  const digest = crypto.createHash('sha256').update(original).digest('hex');
  const backupPath = path.join(backupDir, digest + '.bak');
  try {
    const backupFd = fs.openSync(backupPath, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW || 0), 0o600);
    try { fs.writeFileSync(backupFd, original); fs.fsyncSync(backupFd); } finally { fs.closeSync(backupFd); }
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const existing = fs.readFileSync(backupPath);
    if (!existing.equals(original)) throw new Error('wiki backup hash collision');
  }
}
const flags = fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_TRUNC | (fs.constants.O_NOFOLLOW || 0);
const fd = fs.openSync(target, flags, 0o600);
try { fs.writeFileSync(fd, markdown, 'utf8'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
`;

function fail(code, message) {
  throw Object.assign(new Error(message), { code });
}

function validatePage(job, markdown) {
  const page = job?.path;
  if (typeof page !== 'string' || !PAGE_PATH.test(page) || page.includes('\\')) {
    fail('INVALID_PAGE_PATH', 'page path must be a canonical /openwiki/*.md path');
  }
  const segments = page.slice('/openwiki/'.length).split('/');
  if (segments.some((part) => !part || part === '.' || part === '..')) {
    fail('INVALID_PAGE_PATH', 'page path contains an unsafe segment');
  }
  if (typeof markdown !== 'string' || markdown.includes('\0') || Buffer.byteLength(markdown, 'utf8') > MAX_PAGE_BYTES) {
    fail('INVALID_PAGE_CONTENT', `Markdown must be text no larger than ${MAX_PAGE_BYTES} bytes`);
  }
  return page;
}

function runChild(invocation, { spawnImpl, timeoutMs, signal }) {
  if (signal?.aborted) return Promise.reject(Object.assign(new Error('page write aborted'), { code: 'ABORT_ERR' }));
  return new Promise((resolvePromise, reject) => {
    let child;
    try {
      child = spawnImpl(invocation.file, invocation.args, {
        env: invocation.env,
        shell: false,
        stdio: 'ignore',
      });
    } catch (error) {
      reject(error);
      return;
    }
    let settled = false;
    let stopReason = null;
    let termTimer = null;
    let killTimer = null;
    const timeout = setTimeout(() => stop(Object.assign(new Error('sandbox page write timed out'), { code: 'WRITE_TIMEOUT' })), timeoutMs);
    const cleanup = () => {
      clearTimeout(timeout);
      clearTimeout(termTimer);
      clearTimeout(killTimer);
      signal?.removeEventListener('abort', onAbort);
    };
    const finish = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolvePromise();
    };
    const stop = (reason) => {
      if (stopReason || settled) return;
      stopReason = reason;
      try { child.kill('SIGTERM'); } catch {}
      termTimer = setTimeout(() => {
        if (settled) return;
        try { child.kill('SIGKILL'); } catch {}
        killTimer = setTimeout(() => finish(Object.assign(
          new Error('sandbox writer did not exit after SIGKILL'), { code: 'WRITER_REAP_TIMEOUT', cause: stopReason },
        )), KILL_WAIT_MS);
      }, TERM_GRACE_MS);
    };
    const onAbort = () => stop(Object.assign(new Error('page write aborted'), { code: 'ABORT_ERR' }));
    signal?.addEventListener('abort', onAbort, { once: true });
    child.once('error', (error) => finish(stopReason ?? Object.assign(new Error('sandbox writer could not start'), { code: 'WRITER_SPAWN_FAILED', cause: error })));
    child.once('close', (code, signalCode) => {
      if (stopReason) finish(stopReason);
      else if (code === 0) finish();
      else finish(Object.assign(new Error(`sandbox writer exited (${code ?? signalCode ?? 'unknown'})`), { code: 'SANDBOX_WRITE_FAILED' }));
    });
  });
}

export function createAdminPageWriter(config, workspaceId, {
  spawnImpl = spawn,
  timeoutMs = 10_000,
} = {}) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_TIMEOUT_MS) {
    fail('INVALID_WRITER_CONFIG', `timeoutMs must be 1..${MAX_TIMEOUT_MS}`);
  }
  return Object.freeze({
    async writePage(job, markdown, { signal } = {}) {
      const page = validatePage(job, markdown);
      if (signal !== undefined && !(signal instanceof AbortSignal)) fail('INVALID_SIGNAL', 'signal must be an AbortSignal');
      const workspace = config?.workspaces?.[workspaceId];
      if (!workspace || typeof workspace.root !== 'string' || !isAbsolute(workspace.root)) {
        fail('INVALID_WORKSPACE', 'ADMIN writer workspace is unavailable');
      }
      const pagePath = resolve(workspace.root, page.slice(1));
      const pageRelativeToRoot = relative(workspace.root, pagePath);
      if (!pageRelativeToRoot.startsWith(`openwiki${sep}`) || pagePath !== resolve(workspace.root, page.slice(1))) {
        fail('INVALID_PAGE_PATH', 'page path is outside the OpenWiki directory');
      }
      const invocation = buildAdminSandboxInvocation(config, workspaceId, {
        argv: [config.upstream.node, '-e', WRITE_SCRIPT, pagePath, markdown],
      });
      await runChild(invocation, { spawnImpl, timeoutMs, signal });
      return { path: page, bytes: Buffer.byteLength(markdown, 'utf8') };
    },
  });
}
