import {
  closeSync, constants, fstatSync, openSync, readSync,
} from 'node:fs';
import { isAbsolute } from 'node:path';
import { resolveInRoot } from '../../integrations/openwiki-gateway/src/safe-paths.mjs';
import { validateWorkspaceRoot } from '../../integrations/openwiki-gateway/src/config.mjs';

const DEFAULT_FILES = Object.freeze([
  'README.md', 'README', 'package.json', 'pyproject.toml', 'Cargo.toml', 'go.mod',
  'Makefile', 'src/index.js', 'src/index.ts', 'src/main.py', 'src/main.rs', 'src/main.go',
]);
const MAX_FILES = 16;
const MAX_TOTAL_BYTES = 128 * 1024;
const MAX_FILE_BYTES = 32 * 1024;
const MAX_READ_LINES = 160;
const TEXT_EXTENSIONS = new Set(['.md', '.txt', '.json', '.yaml', '.yml', '.toml', '.mjs', '.c', '.h', '.py', '.rs', '.go', '.js', '.jsx', '.ts', '.tsx', '.sh', '.sql', '.css', '.html']);
const EXCLUDED_PARTS = new Set(['.git', 'node_modules', 'vendor', 'dist', 'build', '.venv', '.cache']);
const SENSITIVE_PATH = /(?:^|\/)(?:\.env(?:\.[^/]*)?|[^/]*(?:secret|credential|password|token|private[_-]?key)[^/]*|id_rsa|id_ed25519|authorized_keys)(?:\/|$)|\.(?:pem|key|p12|pfx)$/iu;

function fail(code, message) {
  throw Object.assign(new Error(message), { code });
}

function safeHint(value) {
  if (typeof value !== 'string' || value.length < 1 || value.length > 1024 || value.includes('\0') ||
      value.includes('\\') || isAbsolute(value) || /[\u0001-\u001f\u007f-\u009f]/u.test(value)) return false;
  const parts = value.split('/');
  const basename = parts.at(-1);
  const extension = basename.includes('.') ? `.${basename.split('.').at(-1).toLowerCase()}` : '';
  return parts.every((part) => part && part !== '.' && part !== '..' && !EXCLUDED_PARTS.has(part)) &&
    (TEXT_EXTENSIONS.has(extension) || ['README', 'Makefile', 'Dockerfile'].includes(basename)) && !SENSITIVE_PATH.test(value);
}

function candidatePaths(job) {
  const seeds = Array.isArray(job?.seedPaths) ? job.seedPaths : [];
  const related = Array.isArray(job?.relatedPages) ? job.relatedPages : [];
  return [...new Set([...seeds, ...related, ...DEFAULT_FILES])].filter(safeHint).slice(0, MAX_FILES);
}

function readBoundedFile(workspace, hint, limit) {
  const resolved = resolveInRoot(workspace, hint);
  let fd;
  try {
    fd = openSync(resolved.absolute, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size < 0 || stat.size > limit) return null;
    const bytes = Buffer.alloc(limit + 1);
    const length = readSync(fd, bytes, 0, bytes.length, 0);
    if (length > limit || bytes.subarray(0, length).includes(0)) return null;
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes.subarray(0, length));
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/** Read only bounded, non-secret repository files for the OpenWiki planner/generator. */
export function createOpenWikiRepositoryContext({ validateRoot = validateWorkspaceRoot } = {}) {
  if (typeof validateRoot !== 'function') throw new TypeError('validateRoot must be a function');
  return async function readContext({ root, job, signal } = {}) {
    if (signal?.aborted) throw signal.reason ?? Object.assign(new Error('context read aborted'), { code: 'ABORTED' });
    if (typeof root !== 'string' || !isAbsolute(root)) fail('INVALID_ROOT', 'context root must be absolute');
    const validated = validateRoot(root);
    if (validated.root !== root) fail('INVALID_ROOT', 'context root must be canonical');
    const workspace = { ...validated, id: 'openwiki-context' };
    const files = [];
    let totalBytes = 0;
    for (const hint of candidatePaths(job)) {
      if (signal?.aborted) throw signal.reason ?? Object.assign(new Error('context read aborted'), { code: 'ABORTED' });
      try {
        const remaining = Math.min(MAX_FILE_BYTES, MAX_TOTAL_BYTES - totalBytes);
        if (remaining <= 0) break;
        const content = readBoundedFile(workspace, hint, remaining);
        if (content === null) continue;
        const bytes = Buffer.byteLength(content, 'utf8');
        totalBytes += bytes;
        files.push({ path: hint, content: content.split('\n').slice(0, MAX_READ_LINES).join('\n') });
      } catch (error) {
        if (signal?.aborted) throw signal.reason ?? error;
        // Missing/unreadable seed paths are omitted; traversal and unsafe links fail closed per file.
      }
    }
    return { files, omittedCount: Math.max(0, candidatePaths(job).length - files.length), totalBytes };
  };
}

export { DEFAULT_FILES as OPENWIKI_CONTEXT_DEFAULT_FILES };
export default createOpenWikiRepositoryContext;
