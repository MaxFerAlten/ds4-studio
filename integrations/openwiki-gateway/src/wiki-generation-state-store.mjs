// Small, private, atomic state store for resumable OpenWiki runs.
// It deliberately accepts metadata only; prompts, source text and page bodies
// are excluded by the strict record schema.

import { createHash, randomBytes } from 'node:crypto';
import {
  closeSync, constants, fstatSync, fsyncSync, lstatSync, mkdirSync,
  openSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';

const MAX_STATE_BYTES = 16 * 1024;
const PHASES = new Set(['starting', 'planning', 'generating', 'completed', 'failed', 'aborting']);
const FIELDS = new Set([
  'schema', 'root', 'baseCommit', 'dirtyAtStart', 'engine', 'model', 'openwikiVersion',
  'runId', 'jobId', 'phase', 'createdAt', 'updatedAt',
]);

function fail(code, message) {
  throw Object.assign(new Error(message), { code });
}

function validateKey(key) {
  if (typeof key !== 'string' || key.length < 1 || key.length > 1024 || key.includes('\0')) {
    fail('STATE_KEY_INVALID', 'state key must be a non-empty string of at most 1024 characters');
  }
  return createHash('sha256').update(key, 'utf8').digest('hex');
}

function validateTimestamp(value, field) {
  if (typeof value !== 'string' || value.length > 40 || !Number.isFinite(Date.parse(value)) ||
      new Date(value).toISOString() !== value) {
    fail('STATE_RECORD_INVALID', `${field} must be an ISO timestamp`);
  }
}

function boundedString(value, field, max = 512) {
  if (typeof value !== 'string' || value.length < 1 || value.length > max || /[\u0000-\u001f\u007f]/u.test(value)) {
    fail('STATE_RECORD_INVALID', `${field} must be bounded text`);
  }
}

function validateRecord(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    fail('STATE_RECORD_INVALID', 'state record must be an object');
  }
  for (const field of Object.keys(record)) {
    if (!FIELDS.has(field)) fail('STATE_RECORD_INVALID', `state record field ${field} is not allowed`);
  }
  if (Object.keys(record).length !== FIELDS.size || record.schema !== 1 ||
      typeof record.root !== 'string' || !isAbsolute(record.root) || record.root.includes('\0') ||
      typeof record.dirtyAtStart !== 'boolean' || !PHASES.has(record.phase)) {
    fail('STATE_RECORD_INVALID', 'state record is incomplete or has invalid schema, root, dirty flag, or phase');
  }
  if (record.baseCommit !== null && (typeof record.baseCommit !== 'string' || !/^[a-f0-9]{40,64}$/iu.test(record.baseCommit))) {
    fail('STATE_RECORD_INVALID', 'baseCommit must be null or a hexadecimal commit id');
  }
  boundedString(record.engine, 'engine', 100);
  boundedString(record.model, 'model', 200);
  boundedString(record.openwikiVersion, 'openwikiVersion', 100);
  for (const field of ['runId', 'jobId']) {
    if (record[field] !== null) boundedString(record[field], field, 256);
  }
  validateTimestamp(record.createdAt, 'createdAt');
  validateTimestamp(record.updatedAt, 'updatedAt');
  if (Date.parse(record.updatedAt) < Date.parse(record.createdAt)) {
    fail('STATE_RECORD_INVALID', 'updatedAt cannot precede createdAt');
  }
  const serialized = JSON.stringify(record);
  if (Buffer.byteLength(serialized, 'utf8') > MAX_STATE_BYTES) {
    fail('STATE_RECORD_TOO_LARGE', `state record exceeds ${MAX_STATE_BYTES} bytes`);
  }
  return serialized;
}

function ensurePrivateDirectory(stateDir) {
  const absolute = resolve(stateDir);
  if (!isAbsolute(absolute)) fail('STATE_DIR_INVALID', 'stateDir must be absolute');
  const parts = absolute.split(sep).filter(Boolean);
  let current = sep;
  for (const part of parts) {
    current = join(current, part);
    try {
      const stat = lstatSync(current);
      if (stat.isSymbolicLink() || !stat.isDirectory()) fail('STATE_DIR_UNSAFE', 'state directory path contains a symlink or non-directory');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      mkdirSync(current, { mode: 0o700 });
    }
  }
  if (realpathSync(absolute) !== absolute) fail('STATE_DIR_UNSAFE', 'state directory path is not canonical');
  const stat = lstatSync(absolute);
  if (!stat.isDirectory() || stat.uid !== process.getuid() || (stat.mode & 0o077) !== 0) {
    fail('STATE_DIR_UNSAFE', 'state directory must be owned by this user and private (0700)');
  }
  return absolute;
}

function validateStateFile(path) {
  let stat;
  try { stat = lstatSync(path); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  if (stat.isSymbolicLink() || !stat.isFile() || stat.uid !== process.getuid() ||
      (stat.mode & 0o077) !== 0 || stat.size > MAX_STATE_BYTES) {
    fail('STATE_FILE_UNSAFE', 'state file must be a private, owned, bounded regular file');
  }
  return stat;
}

function readState(path) {
  const stat = validateStateFile(path);
  if (!stat) return null;
  let fd;
  try {
    fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const opened = fstatSync(fd);
    if (!opened.isFile() || opened.uid !== process.getuid() || (opened.mode & 0o077) !== 0 || opened.size > MAX_STATE_BYTES) {
      fail('STATE_FILE_UNSAFE', 'opened state file changed or is unsafe');
    }
    const record = JSON.parse(readFileSync(fd, 'utf8'));
    validateRecord(record);
    return record;
  } catch (error) {
    if (error?.code === 'STATE_FILE_UNSAFE' || error?.code === 'STATE_RECORD_INVALID' || error?.code === 'STATE_RECORD_TOO_LARGE') throw error;
    fail('STATE_FILE_INVALID', 'state file is unreadable or invalid JSON');
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

export function createWikiGenerationStateStore({ stateDir } = {}) {
  if (typeof stateDir !== 'string' || !isAbsolute(stateDir) || stateDir.includes('\0')) {
    fail('STATE_DIR_INVALID', 'stateDir must be an absolute path');
  }
  const directory = ensurePrivateDirectory(stateDir);
  const pathFor = (key) => join(directory, `${validateKey(key)}.json`);

  // A single writer owns each session key. Atomic rename protects readers
  // from partial files; concurrent saves intentionally use last-writer-wins.
  return Object.freeze({
    async get(key) {
      return readState(pathFor(key));
    },
    async save(key, record) {
      const path = pathFor(key);
      const serialized = validateRecord(record);
      validateStateFile(path);
      const temporary = join(directory, `.tmp-${randomBytes(12).toString('hex')}`);
      let fd;
      try {
        fd = openSync(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0), 0o600);
        writeFileSync(fd, serialized, 'utf8');
        fsyncSync(fd);
        closeSync(fd);
        fd = undefined;
        renameSync(temporary, path);
        const dirFd = openSync(directory, constants.O_RDONLY);
        try { fsyncSync(dirFd); } finally { closeSync(dirFd); }
      } catch (error) {
        if (error?.code === 'STATE_FILE_UNSAFE') throw error;
        fail('STATE_WRITE_FAILED', 'could not atomically persist OpenWiki state');
      } finally {
        if (fd !== undefined) closeSync(fd);
        try { unlinkSync(temporary); } catch {}
      }
      return record;
    },
    async remove(key) {
      const path = pathFor(key);
      const stat = validateStateFile(path);
      if (!stat) return false;
      unlinkSync(path);
      return true;
    },
  });
}
