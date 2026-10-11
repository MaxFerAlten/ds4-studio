export const LIMITS = Object.freeze({
  requestBytes: 8 * 1024,
  queryCodePoints: 1200,
  pathHints: 8,
  pathChars: 250,
  searchLimit: 5,
  readSections: 3,
  anchorChars: 200,
  searchOutputBytes: 4096,
  readOutputBytes: 12288,
});

const idRe = /^[a-z0-9][a-z0-9-]{0,63}$/u;
const forbiddenPathChars = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/u;

export class RequestValidationError extends Error {
  constructor(code) {
    super(code);
    this.name = 'RequestValidationError';
    this.code = code;
  }
}

function bad(code) {
  throw new RequestValidationError(code);
}

function record(x, code = 'body') {
  if (!x || typeof x !== 'object' || Array.isArray(x) || Object.getPrototypeOf(x) !== Object.prototype) bad(code);
}

function assertExactKeys(x, allowed) {
  if (Object.keys(x).some((key) => !allowed.includes(key))) bad('unknown_key');
}

function validateCommon(x, keys) {
  record(x);
  assertExactKeys(x, keys);
  if (x.protocol !== 'ds4-openwiki.v1') bad('protocol');
  if (typeof x.workspaceId !== 'string' || !idRe.test(x.workspaceId)) bad('workspaceId');
  if (x.requestId !== undefined &&
      (typeof x.requestId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/u.test(x.requestId))) bad('requestId');
}

export function validateRepoRelativePath(path) {
  if (typeof path !== 'string' || path.length === 0 || [...path].length > LIMITS.pathChars ||
      forbiddenPathChars.test(path) || path.includes('\\') || path.startsWith('/') ||
      path.startsWith('~') || /^[A-Za-z]:/u.test(path)) bad('path');
  const parts = path.split('/');
  if (parts.some((part) => part === '' || part === '.' || part === '..')) bad('path');
  return path;
}

export function requireSearchRequest(x) {
  validateCommon(x, ['protocol', 'workspaceId', 'requestId', 'query', 'paths', 'limit']);
  if (typeof x.query !== 'string' || !x.query.trim() || /[\u0000-\u001f\u007f-\u009f]/u.test(x.query) ||
      [...x.query].length > LIMITS.queryCodePoints) bad('query');
  if (x.limit !== undefined && (!Number.isInteger(x.limit) || x.limit < 1 || x.limit > LIMITS.searchLimit)) bad('limit');
  if (x.paths !== undefined) {
    if (!Array.isArray(x.paths) || x.paths.length > LIMITS.pathHints) bad('paths');
    x.paths.forEach(validateRepoRelativePath);
  }
  return Object.freeze({
    protocol: x.protocol,
    workspaceId: x.workspaceId,
    ...(x.requestId === undefined ? {} : { requestId: x.requestId }),
    query: x.query.trim(),
    ...(x.paths === undefined ? {} : { paths: [...x.paths] }),
    limit: x.limit ?? 3,
  });
}

export function requireReadRequest(x) {
  validateCommon(x, ['protocol', 'workspaceId', 'requestId', 'page', 'sections']);
  if (typeof x.page !== 'string' || !x.page || x.page.includes('#') || [...x.page].length > LIMITS.pathChars) bad('page');
  validateRepoRelativePath(x.page);
  if (!Array.isArray(x.sections) || x.sections.length < 1 || x.sections.length > LIMITS.readSections) bad('sections');
  const seen = new Set();
  const sections = x.sections.map((section) => {
    if (typeof section !== 'string' || !section || [...section].length > LIMITS.anchorChars ||
        forbiddenPathChars.test(section) || section.includes('\n') || section.includes('\r')) bad('sections');
    if (seen.has(section)) bad('sections');
    seen.add(section);
    return section;
  });
  return Object.freeze({
    protocol: x.protocol,
    workspaceId: x.workspaceId,
    ...(x.requestId === undefined ? {} : { requestId: x.requestId }),
    page: x.page,
    sections,
  });
}
