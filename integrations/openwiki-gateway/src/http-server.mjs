import http from 'node:http';
import { lstat, chmod, unlink } from 'node:fs/promises';
import { ConfigError, getWorkspace } from './config.mjs';
import { validateRepoRelativePath, requireSearchRequest, requireReadRequest, RequestValidationError, LIMITS } from './validators.mjs';
import { formatSearch, formatRead, UpstreamResultError } from './format-results.mjs';
import { McpSupervisorError } from './mcp-supervisor.mjs';

const MAX_BODY = LIMITS.requestBytes;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/u;

function requestId(value) { return typeof value === 'string' && SAFE_ID.test(value) ? value : 'unknown'; }
function json(res, status, payload, id) {
  const body = Buffer.from(JSON.stringify(payload));
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': body.length,
    'X-DS4-OW-Protocol': '1', 'X-DS4-OW-Request-Id': id, Connection: 'close' });
  res.end(body);
}
function text(res, body, id) {
  const bytes = Buffer.from(body, 'utf8');
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Length': bytes.length,
    'X-DS4-OW-Protocol': '1', 'X-DS4-OW-Request-Id': id, Connection: 'close' });
  res.end(bytes);
}
function errorCode(err) {
  if (err instanceof RequestValidationError) return [400, 'INVALID_INPUT'];
  if (err instanceof ConfigError) return [403, 'WORKSPACE_DENIED'];
  if (err instanceof UpstreamResultError) return [502, err.code];
  if (err instanceof McpSupervisorError) {
    if (err.code === 'ABORTED') return [499, 'CANCELLED'];
    if (err.code === 'NOT_READY' || err.code === 'TOOL_UNAVAILABLE') return [503, 'SERVICE_UNAVAILABLE'];
    if (err.code === 'DEADLINE_EXCEEDED') return [504, 'UPSTREAM_TIMEOUT'];
    return [502, 'UPSTREAM_ERROR'];
  }
  if (err?.code === 'NOT_READY') return [503, 'SERVICE_UNAVAILABLE'];
  if (err?.code === 'HTTP_INPUT') return [err.status ?? 400, err.publicCode ?? 'INVALID_INPUT'];
  return [500, 'INTERNAL_ERROR'];
}

async function readJson(req) {
  req.setTimeout(5_000, () => req.destroy());
  const ct = req.headers['content-type'];
  if (typeof ct !== 'string' || !/^application\/json(?:\s*;\s*charset=utf-8)?$/iu.test(ct)) throw httpError(415, 'INVALID_INPUT');
  if (req.headers['transfer-encoding'] !== undefined || Array.isArray(req.headers['content-length'])) throw httpError(400, 'INVALID_INPUT');
  const rawLength = req.headers['content-length'];
  if (typeof rawLength !== 'string' || !/^(?:0|[1-9][0-9]*)$/u.test(rawLength)) throw httpError(411, 'INVALID_INPUT');
  const length = Number(rawLength);
  if (!Number.isSafeInteger(length) || length > MAX_BODY) throw httpError(413, 'INVALID_INPUT');
  const chunks = []; let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > MAX_BODY || total > length) throw httpError(413, 'INVALID_INPUT');
    chunks.push(chunk);
  }
  if (total !== length) throw httpError(400, 'INVALID_INPUT');
  let decoded;
  try { decoded = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, total)); }
  catch { throw httpError(400, 'INVALID_INPUT'); }
  try { return JSON.parse(decoded); } catch { throw httpError(400, 'INVALID_INPUT'); }
}
function httpError(status, publicCode) { return Object.assign(new Error(publicCode), { code: 'HTTP_INPUT', status, publicCode }); }

export function createHttpServer({ config, mcp, telemetry = null }) {
  if (!config || !mcp) throw new TypeError('config and mcp are required');
  return http.createServer(async (req, res) => {
    const id = requestId(req.headers['x-request-id']);
    telemetry?.record('requests');
    const abort = new AbortController();
    const disconnected = () => { if (!res.writableEnded) abort.abort(); };
    req.once('aborted', disconnected); res.once('close', disconnected);
    try {
      if (req.method === 'GET' && (req.url === '/health/live' || req.url === '/health/ready')) {
        const ready = mcp.snapshot ? mcp.snapshot().state === 'ready' : mcp.ready === true;
        const live = req.url === '/health/live';
        json(res, live ? 200 : ready ? 200 : 503, { status: live ? 'live' : ready ? 'ready' : 'unavailable', protocol: 1 }, id);
        return;
      }
      const search = req.method === 'POST' && req.url === '/v1/wiki/search';
      const read = req.method === 'POST' && req.url === '/v1/wiki/read';
      if (!search && !read) throw httpError(404, 'INVALID_INPUT');
      if (req.headers['x-ds4-ow-protocol'] !== '1') throw httpError(400, 'INVALID_INPUT');
      const ready = mcp.snapshot ? mcp.snapshot().state === 'ready' : mcp.ready === true;
      if (!ready) throw Object.assign(new Error('not ready'), { code: 'NOT_READY' });
      const body = await readJson(req);
      const parsed = search ? requireSearchRequest(body) : requireReadRequest(body);
      const ws = getWorkspace(config, parsed.workspaceId);
      const args = search
        ? { root: ws.root, query: parsed.query, ...(parsed.paths ? { paths: parsed.paths.map(validateRepoRelativePath) } : {}), limit: parsed.limit }
        : { root: ws.root, page: parsed.page, sections: parsed.sections };
      const tool = search ? 'openwiki_search' : 'openwiki_read';
      const result = await mcp.callReadOnly(tool, args, { signal: abort.signal });
      if (abort.signal.aborted || res.destroyed) return;
      text(res, search ? formatSearch(result, { workspaceId: parsed.workspaceId }) : formatRead(result, { workspaceId: parsed.workspaceId }), id);
      telemetry?.record('success');
    } catch (err) {
      const [status, code] = errorCode(err);
      telemetry?.record(status === 400 || status === 403 || status === 404 || status === 411 || status === 413 || status === 415 ? 'rejected' : status === 499 ? 'cancelled' : 'upstreamFailure');
      if (!res.destroyed && !res.writableEnded) json(res, status, { error: code }, id);
    } finally {
      req.removeListener('aborted', disconnected); res.removeListener('close', disconnected);
    }
  });
}

/** Listen only on the configured Unix socket, fail closed on unsafe stale paths. */
export async function listenUnix(server, socketPath) {
  try {
    const st = await lstat(socketPath);
    if (!st.isSocket() || st.uid !== process.getuid() || (st.mode & 0o022) !== 0) throw new Error('unsafe existing socket path');
    await unlink(socketPath);
  } catch (err) { if (err.code !== 'ENOENT') throw err; }
  await new Promise((resolve, reject) => {
    const onError = (err) => { server.removeListener('listening', onListening); reject(err); };
    const onListening = () => { server.removeListener('error', onError); resolve(); };
    server.once('error', onError); server.once('listening', onListening); server.listen(socketPath);
  });
  await chmod(socketPath, 0o600);
  const st = await lstat(socketPath);
  if (!st.isSocket() || st.uid !== process.getuid() || (st.mode & 0o777) !== 0o600) {
    await new Promise((resolve) => server.close(resolve));
    throw new Error('Unix socket permissions could not be secured');
  }
  return Object.freeze({ socketPath, dev: st.dev, ino: st.ino });
}

export async function unlinkOwnedSocket(identity) {
  try {
    const st = await lstat(identity.socketPath);
    if (st.isSocket() && st.uid === process.getuid() && st.dev === identity.dev && st.ino === identity.ino) await unlink(identity.socketPath);
  } catch (err) { if (err.code !== 'ENOENT') throw err; }
}
