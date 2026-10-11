import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, constants, fstatSync, lstatSync, openSync, opendirSync, readFileSync, readlinkSync } from 'node:fs';
import { join } from 'node:path';

const GIT_TIMEOUT_MS = 5_000;
const GIT_STATUS_MAX_BYTES = 256 * 1024;
const OPENWIKI_SNAPSHOT_MAX_FILES = 2048;
const OPENWIKI_SNAPSHOT_MAX_FILE_BYTES = 4 * 1024 * 1024;
const OPENWIKI_SNAPSHOT_MAX_TOTAL_BYTES = 64 * 1024 * 1024;

function fail(code, message, cause) {
  throw Object.assign(new Error(message, cause === undefined ? undefined : { cause }), { code });
}

function runGit(execFileImpl, git, root, args, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason ?? Object.assign(new Error('metadata collection aborted'), { code: 'ABORTED' }));
    execFileImpl(git, ['-C', root, ...args], {
      encoding: 'buffer', maxBuffer: GIT_STATUS_MAX_BYTES, timeout: GIT_TIMEOUT_MS, signal,
      windowsHide: true,
    }, (error, stdout, stderr) => {
      if (error) return reject(Object.assign(error, { stderr }));
      resolve(stdout);
    });
  });
}

/** Capture only bounded Git metadata; file contents and diffs are never read or persisted. */
export async function collectOpenWikiRunMetadata({
  root,
  engine,
  model,
  openwikiVersion = '0.7.1',
  signal,
  git = '/usr/bin/git',
  execFileImpl = execFile,
} = {}) {
  if (typeof root !== 'string' || !root.startsWith('/') || root.includes('\0')) fail('INVALID_ROOT', 'metadata root must be absolute');
  for (const [key, value, max] of [['engine', engine, 100], ['model', model, 200], ['openwikiVersion', openwikiVersion, 100]]) {
    if (typeof value !== 'string' || !value || value.length > max || /[\u0000-\u001f\u007f]/u.test(value)) {
      fail('METADATA_INVALID', `${key} must be bounded text`);
    }
  }
  if (typeof execFileImpl !== 'function' || typeof git !== 'string' || !git.startsWith('/')) {
    fail('METADATA_CONFIG_INVALID', 'Git executable must be absolute');
  }

  let head;
  try {
    head = (await runGit(execFileImpl, git, root, ['rev-parse', '--verify', 'HEAD'], signal)).toString('utf8').trim();
  } catch (error) {
    if (error?.code === 'ABORTED' || signal?.aborted) throw signal?.reason ?? error;
    if (error?.code === 128) head = '';
    else fail('GIT_METADATA_FAILED', 'could not read repository HEAD', error);
  }
  if (head && !/^[a-f0-9]{40,64}$/iu.test(head)) fail('GIT_METADATA_INVALID', 'repository HEAD is not a commit id');

  let status;
  try {
    status = await runGit(execFileImpl, git, root, ['status', '--porcelain=v1', '-z', '--untracked-files=all'], signal);
  } catch (error) {
    if (error?.code === 'ABORTED' || signal?.aborted) throw signal?.reason ?? error;
    fail('GIT_METADATA_FAILED', 'could not read repository status', error);
  }
  return Object.freeze({ baseCommit: head || null, dirtyAtStart: status.length > 0, engine, model, openwikiVersion });
}

/** Snapshot bounded path/status/size/hash metadata under openwiki/; file contents never leave memory. */
export async function collectOpenWikiWorkspaceSnapshot({
  root,
  signal,
  git = '/usr/bin/git',
  execFileImpl = execFile,
  maxPaths = 2048,
} = {}) {
  if (typeof root !== 'string' || !root.startsWith('/') || root.includes('\0')) fail('INVALID_ROOT', 'metadata root must be absolute');
  if (typeof execFileImpl !== 'function' || typeof git !== 'string' || !git.startsWith('/') ||
      !Number.isSafeInteger(maxPaths) || maxPaths < 1 || maxPaths > 10_000) {
    fail('METADATA_CONFIG_INVALID', 'Git snapshot configuration is invalid');
  }
  let status;
  try {
    status = await runGit(execFileImpl, git, root,
      ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--', 'openwiki/'], signal);
  } catch (error) {
    if (error?.code === 'ABORTED' || signal?.aborted) throw signal?.reason ?? error;
    fail('GIT_METADATA_FAILED', 'could not snapshot OpenWiki path status', error);
  }
  const statusByPath = new Map();
  let offset = 0;
  while (offset < status.length) {
    const end = status.indexOf(0, offset);
    if (end < 0) fail('GIT_METADATA_INVALID', 'OpenWiki status is not NUL terminated');
    const entry = status.subarray(offset, end).toString('utf8');
    if (entry.length < 4 || entry[2] !== ' ') fail('GIT_METADATA_INVALID', 'OpenWiki status entry is malformed');
    const filePath = entry.slice(3);
    if (!filePath.startsWith('openwiki/')) fail('GIT_METADATA_INVALID', 'OpenWiki status escaped the scoped path');
    statusByPath.set(filePath, entry.slice(0, 2));
    if (statusByPath.size > maxPaths) fail('GIT_METADATA_TOO_LARGE', 'OpenWiki status exceeds the path limit');
    offset = end + 1;
    if (/[RC]/u.test(entry.slice(0, 2))) {
      const renameEnd = status.indexOf(0, offset);
      if (renameEnd < 0) fail('GIT_METADATA_INVALID', 'OpenWiki rename status is incomplete');
      offset = renameEnd + 1;
    }
  }
  const wikiRoot = join(root, 'openwiki');
  let wikiStat;
  try { wikiStat = lstatSync(wikiRoot); }
  catch (error) { if (error.code === 'ENOENT') return Object.freeze([...statusByPath].map(([path, status]) => Object.freeze({ path, status }))); throw error; }
  if (wikiStat.isSymbolicLink() || !wikiStat.isDirectory()) fail('OPENWIKI_SNAPSHOT_UNSAFE', 'openwiki path is not a regular directory');
  let totalBytes = 0;
  let entryCount = 0;
  const snapshotByPath = new Map();
  const walk = (directory, relativeDirectory = 'openwiki', depth = 0) => {
    if (depth > 64) fail('OPENWIKI_SNAPSHOT_TOO_LARGE', 'openwiki directory nesting exceeds the snapshot depth limit');
    const dir = opendirSync(directory);
    try {
      let item;
      while ((item = dir.readSync()) !== null) {
        const name = item.name;
        const absolute = join(directory, name);
        const filePath = `${relativeDirectory}/${name}`;
        entryCount++;
        if (entryCount > Math.min(maxPaths, OPENWIKI_SNAPSHOT_MAX_FILES) || Buffer.byteLength(filePath) > 4096) {
          fail('OPENWIKI_SNAPSHOT_TOO_LARGE', 'openwiki contains too many or overly long entries to snapshot safely');
        }
        const stat = lstatSync(absolute);
        if (stat.isDirectory() && !stat.isSymbolicLink()) {
          walk(absolute, filePath, depth + 1);
          continue;
        }
        if (stat.isSymbolicLink()) {
          const target = readlinkSync(absolute);
          snapshotByPath.set(filePath, Object.freeze({ path: filePath, status: statusByPath.get(filePath) ?? '  ', kind: 'symlink',
            size: Buffer.byteLength(target), sha256: createHash('sha256').update(target).digest('hex') }));
          continue;
        }
        if (!stat.isFile()) {
          snapshotByPath.set(filePath, Object.freeze({ path: filePath, status: statusByPath.get(filePath) ?? '  ', kind: 'special', size: 0, sha256: null }));
          continue;
        }
        if (stat.size > OPENWIKI_SNAPSHOT_MAX_FILE_BYTES || totalBytes + stat.size > OPENWIKI_SNAPSHOT_MAX_TOTAL_BYTES) {
          fail('OPENWIKI_SNAPSHOT_TOO_LARGE', 'openwiki exceeds the bounded snapshot byte limit');
        }
        const fd = openSync(absolute, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
        try {
          const opened = fstatSync(fd);
          if (!opened.isFile() || opened.dev !== stat.dev || opened.ino !== stat.ino || opened.size !== stat.size) {
            fail('OPENWIKI_SNAPSHOT_CHANGED', 'openwiki changed while its bounded snapshot was being collected');
          }
          const bytes = readFileSync(fd);
          const finalStat = fstatSync(fd);
          if (finalStat.size !== opened.size || finalStat.mtimeMs !== opened.mtimeMs) {
            fail('OPENWIKI_SNAPSHOT_CHANGED', 'openwiki changed while its bounded snapshot was being collected');
          }
          totalBytes += bytes.length;
          snapshotByPath.set(filePath, Object.freeze({ path: filePath, status: statusByPath.get(filePath) ?? '  ', kind: 'file',
            size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }));
        } finally { closeSync(fd); }
      }
    } finally { dir.closeSync(); }
  };
  walk(wikiRoot);
  for (const [filePath, status] of statusByPath) {
    if (!snapshotByPath.has(filePath)) snapshotByPath.set(filePath, Object.freeze({ path: filePath, status, kind: 'deleted', size: 0, sha256: null }));
  }
  return Object.freeze([...snapshotByPath.values()].sort((a, b) => a.path.localeCompare(b.path)));
}

export default collectOpenWikiRunMetadata;
