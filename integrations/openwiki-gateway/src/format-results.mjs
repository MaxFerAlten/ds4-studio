import { LIMITS } from './validators.mjs';

export class UpstreamResultError extends Error {
  constructor(code) {
    super(code);
    this.name = 'UpstreamResultError';
    this.code = code;
  }
}

function fail(code) {
  throw new UpstreamResultError(code);
}

function unwrap(result) {
  if (!result || typeof result !== 'object' || Array.isArray(result) || result.isError === true) fail('upstream_error');
  const data = result.structuredContent;
  if (!data || typeof data !== 'object' || Array.isArray(data)) fail('malformed_upstream');
  return data;
}

function safeString(value, code = 'malformed_upstream') {
  if (typeof value !== 'string') fail(code);
  return sanitizedText(value);
}

export function sanitizedText(value) {
  if (typeof value !== 'string') throw new TypeError('text must be a string');
  return value
    .replaceAll(/\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1b\\)|[@-_])/gu, '')
    .replaceAll(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/gu, '')
    .replaceAll(/<\|[^|\n]{1,80}\|>/gu, '[protocol marker removed]');
}

export function clipUtf8(text, maxBytes) {
  if (typeof text !== 'string' || !Number.isSafeInteger(maxBytes) || maxBytes < 0) throw new TypeError('invalid clipping input');
  if (Buffer.byteLength(text, 'utf8') <= maxBytes) return { text, truncated: false };
  const marker = '\n[TRUNCATED]';
  const markerBytes = Buffer.byteLength(marker);
  const budget = Math.max(0, maxBytes - markerBytes);
  let output = '';
  let used = 0;
  for (const point of text) {
    const size = Buffer.byteLength(point, 'utf8');
    if (used + size > budget) break;
    output += point;
    used += size;
  }
  if (maxBytes >= markerBytes) output += marker;
  return { text: output, truncated: true };
}

function quote(text) {
  return text.split('\n').map((line) => `> ${line}`).join('\n');
}

function parseRef(ref) {
  if (typeof ref !== 'string') fail('malformed_upstream');
  const hash = ref.indexOf('#');
  if (hash <= 0 || hash === ref.length - 1 || ref.indexOf('#', hash + 1) !== -1) fail('malformed_ref');
  const page = ref.slice(0, hash);
  const anchor = ref.slice(hash + 1);
  if (/[\\\u0000-\u001f]/u.test(page) || page.startsWith('/') || page.split('/').some((part) => !part || part === '.' || part === '..') ||
      [...anchor].length > LIMITS.anchorChars || /[\u0000-\u001f\u200b-\u200f\u202a-\u202e\ufeff]/u.test(anchor)) fail('malformed_ref');
  return { page, anchor };
}

function statusText(data) {
  if (data.status === 'workspace_required') fail('workspace_required');
  if (data.status === 'stale') return 'Status: stale (the source may have changed).';
  return '';
}

function emit(text, maxBytes) {
  const clipped = clipUtf8(text, maxBytes);
  return clipped.text;
}

export function formatSearch(result, { workspaceId } = {}) {
  const data = unwrap(result);
  const status = statusText(data);
  if (!Array.isArray(data.results)) fail('malformed_upstream');
  const seen = new Set();
  const rows = [];
  for (const item of data.results.slice(0, LIMITS.searchLimit)) {
    if (!item || typeof item !== 'object' || item.kind !== 'section' || !Array.isArray(item.ref) || item.ref.length !== 1) fail('malformed_upstream');
    if (item.wiki !== undefined && (typeof item.wiki !== 'string' || item.wiki !== workspaceId)) fail('linked_wiki');
    const { page, anchor } = parseRef(item.ref[0]);
    const key = `${item.wiki ?? ''}\0${page}\0${anchor}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push(`## ${page}#${anchor}\n${quote(safeString(item.content))}`);
  }
  const body = [status, ...rows].filter(Boolean).join('\n\n') || 'No matching wiki sections.';
  return emit(`Untrusted OpenWiki search results (workspace ${workspaceId ?? 'selected'}):\n${body}`, LIMITS.searchOutputBytes);
}

export function formatRead(result, { workspaceId } = {}) {
  const data = unwrap(result);
  const status = statusText(data);
  if (typeof data.page !== 'string' || !Array.isArray(data.sections) || data.sections.length > LIMITS.readSections) fail('malformed_upstream');
  if (data.wiki !== undefined && (typeof data.wiki !== 'string' || data.wiki !== workspaceId)) fail('linked_wiki');
  const rows = data.sections.map((section) => {
    if (!section || typeof section !== 'object' || typeof section.section !== 'string' || !section.section ||
        [...section.section].length > LIMITS.anchorChars) fail('malformed_upstream');
    return `## ${data.page}#${sanitizedText(section.section)}\n${quote(safeString(section.content))}`;
  });
  const body = [status, ...rows].filter(Boolean).join('\n\n') || 'No wiki sections returned.';
  return emit(`Untrusted OpenWiki page content (workspace ${workspaceId ?? 'selected'}):\n${body}`, LIMITS.readOutputBytes);
}
