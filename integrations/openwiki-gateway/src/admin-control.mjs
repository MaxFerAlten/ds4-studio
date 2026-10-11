import { timingSafeEqual } from 'node:crypto';
import { lstatSync } from 'node:fs';
import { createServer, connect } from 'node:net';
import { basename, dirname, extname, join } from 'node:path';
import { parseJsonStrict } from './config.mjs';
import { listenUnix, unlinkOwnedSocket } from './http-server.mjs';
import { PINNED_LIFECYCLE_TOOLS } from './mcp-supervisor.mjs';

export const ADMIN_CONTROL_TOOLS = PINNED_LIFECYCLE_TOOLS;

const ADMIN_TOOL_SET = new Set(ADMIN_CONTROL_TOOLS);
const MAX_REQUEST_BYTES = 128 * 1024;
const MAX_RESPONSE_BYTES = 512 * 1024;
const MAX_CONNECTION_MS = 7_000;
const MAX_IDLE_MS = 2_000;
const MAX_CLIENTS = 8;
const SOCKET_PATH_MAX_BYTES = 107;

function fail(code, message) {
  throw Object.assign(new Error(message), { code });
}

function validateToken(token) {
  if (!Buffer.isBuffer(token) || token.length !== 32) {
    fail('ADMIN_AUTH_CONFIG', 'ADMIN control requires a 32-byte token');
  }
}

function validateSocketPath(socketPath) {
  if (typeof socketPath !== 'string' || !socketPath.startsWith('/') ||
      Buffer.byteLength(socketPath) > SOCKET_PATH_MAX_BYTES || socketPath.includes('\0')) {
    fail('ADMIN_SOCKET_CONFIG', 'ADMIN socket path is invalid');
  }
  let dir;
  try { dir = lstatSync(dirname(socketPath)); }
  catch { fail('ADMIN_SOCKET_CONFIG', 'ADMIN socket directory is unavailable'); }
  if (dir.isSymbolicLink() || !dir.isDirectory() || dir.uid !== process.getuid() ||
      (dir.mode & 0o022) !== 0) {
    fail('ADMIN_SOCKET_CONFIG', 'ADMIN socket directory has unsafe owner, type, or mode');
  }
}

function parseRequest(raw) {
  let request;
  try { request = parseJsonStrict(raw); }
  catch { fail('ADMIN_INVALID_REQUEST', 'ADMIN request is invalid JSON'); }
  const keys = Object.keys(request ?? {}).sort();
  if (!request || typeof request !== 'object' || Array.isArray(request) ||
      typeof request.id !== 'string' || !/^[a-f0-9-]{1,64}$/u.test(request.id) ||
      typeof request.token !== 'string') {
    fail('ADMIN_INVALID_REQUEST', 'ADMIN request shape or operation is not allowed');
  }
  if (keys.join(',') === 'id,kind,token' && request.kind === 'health') return request;
  if (keys.join(',') !== 'args,id,token,tool' || typeof request.tool !== 'string' ||
      !ADMIN_TOOL_SET.has(request.tool) || !request.args || typeof request.args !== 'object' || Array.isArray(request.args)) {
    fail('ADMIN_INVALID_REQUEST', 'ADMIN request shape or operation is not allowed');
  }
  return request;
}

function sameToken(encoded, expected) {
  if (!/^[A-Za-z0-9_-]{43}$/u.test(encoded)) return false;
  const supplied = Buffer.from(encoded, 'base64url');
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

function responseLine(value) {
  const line = `${JSON.stringify(value)}\n`;
  if (Buffer.byteLength(line) > MAX_RESPONSE_BYTES) {
    return `${JSON.stringify({ id: value.id, error: { code: 'ADMIN_RESPONSE_TOO_LARGE' } })}\n`;
  }
  return line;
}

/**
 * Dedicated authenticated Unix socket for the separate OpenWiki ADMIN worker.
 * This server is intentionally not an HTTP handler and exposes only pinned
 * lifecycle calls. The owning process starts/stops the worker with OS signals.
 */
export async function startAdminControlServer({
  socketPath,
  token,
  supervisor,
  connectionTimeoutMs = MAX_CONNECTION_MS,
  idleTimeoutMs = MAX_IDLE_MS,
}) {
  validateToken(token);
  validateSocketPath(socketPath);
  if (!Number.isSafeInteger(connectionTimeoutMs) || connectionTimeoutMs < 1 ||
      connectionTimeoutMs > MAX_CONNECTION_MS || !Number.isSafeInteger(idleTimeoutMs) ||
      idleTimeoutMs < 1 || idleTimeoutMs > MAX_IDLE_MS) {
    fail('ADMIN_CONTROL_CONFIG', 'ADMIN connection deadlines are invalid');
  }
  if (!supervisor || typeof supervisor.start !== 'function' ||
      typeof supervisor.stop !== 'function' || typeof supervisor.callAdmin !== 'function' ||
      typeof supervisor.snapshot !== 'function') {
    throw new TypeError('ADMIN control requires an ADMIN supervisor');
  }

  await supervisor.start();
  if (supervisor.snapshot().state !== 'ready') {
    await supervisor.stop().catch(() => {});
    fail('NOT_READY', 'ADMIN supervisor did not become ready');
  }

  const sockets = new Set();
  let closing = null;
  let shutdown = null;
  const server = createServer((socket) => {
    if (sockets.size >= MAX_CLIENTS) { socket.destroy(); return; }
    sockets.add(socket);
    socket.setTimeout(idleTimeoutMs, () => socket.destroy());
    const abort = new AbortController();
    socket.once('close', () => {
      sockets.delete(socket);
      abort.abort();
    });
    let bytes = 0;
    let chunks = [];
    let handled = false;
    const absoluteDeadline = setTimeout(() => socket.destroy(), connectionTimeoutMs);
    socket.once('close', () => clearTimeout(absoluteDeadline));
    socket.on('error', () => {
      abort.abort();
      sockets.delete(socket);
    });
    socket.on('data', async (chunk) => {
      if (handled) { socket.destroy(); return; }
      bytes += chunk.length;
      if (bytes > MAX_REQUEST_BYTES) {
        handled = true;
        socket.end(responseLine({ id: null, error: { code: 'ADMIN_REQUEST_TOO_LARGE' } }));
        return;
      }
      chunks.push(chunk);
      const data = Buffer.concat(chunks, bytes);
      const newline = data.indexOf(0x0a);
      if (newline === -1) return;
      handled = true;
      if (newline !== data.length - 1 || data.indexOf(0x0a, newline + 1) !== -1) {
        socket.end(responseLine({ id: null, error: { code: 'ADMIN_INVALID_REQUEST' } }));
        return;
      }
      chunks = [];
      let request;
      try {
        request = parseRequest(new TextDecoder('utf-8', { fatal: true }).decode(data.subarray(0, newline)));
        if (!sameToken(request.token, token)) fail('ADMIN_UNAUTHORIZED', 'ADMIN authentication failed');
        // The idle deadline protects request framing only. Once a complete,
        // authenticated request is dispatched, the absolute deadline bounds it.
        socket.setTimeout(0);
        if (request.kind === 'health') {
          socket.end(responseLine({ id: request.id, result: { state: supervisor.snapshot().state } }));
          return;
        }
        const args = JSON.parse(JSON.stringify(request.args));
        // Compatibility with an already running DS4 controller that still
        // serializes per-page instructions as text. Upstream requires string[].
        if (request.tool === 'openwiki_submit_plan' && Array.isArray(args.pages)) {
          for (const page of args.pages) {
            if (page && typeof page.instructions === 'string') page.instructions = [page.instructions];
          }
        }
        const result = await supervisor.callAdmin(request.tool, args, { signal: abort.signal });
        if (!abort.signal.aborted && !socket.destroyed) {
          socket.end(responseLine({ id: request.id, result }));
        }
      } catch (error) {
        if (!abort.signal.aborted && !socket.destroyed) {
          const code = /^[A-Z][A-Z0-9_]{0,63}$/u.test(error?.code ?? '') ? error.code : 'ADMIN_ERROR';
          socket.end(responseLine({ id: request?.id ?? null, error: { code } }));
        }
      }
    });
  });
  server.on('error', () => { if (shutdown) void shutdown().catch(() => {}); });

  let socketIdentity;
  const oldUmask = process.umask(0o177);
  try { socketIdentity = await listenUnix(server, socketPath); }
  catch (error) {
    await supervisor.stop().catch(() => {});
    throw error;
  } finally {
    process.umask(oldUmask);
  }

  const close = () => {
    if (closing) return closing;
    closing = (async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      await unlinkOwnedSocket(socketIdentity);
      await supervisor.stop();
    })();
    return closing;
  };
  shutdown = close;
  return Object.freeze({
    server,
    socketPath,
    close,
  });
}

/** Derive a sibling socket path without reusing the READ gateway pathname. */
export function adminSocketPathFor(readSocketPath) {
  if (typeof readSocketPath !== 'string' || !readSocketPath.startsWith('/')) {
    fail('ADMIN_SOCKET_CONFIG', 'READ socket path is invalid');
  }
  const ext = extname(readSocketPath);
  const name = basename(readSocketPath, ext);
  const socketPath = join(dirname(readSocketPath), `${name}.admin.sock`);
  if (Buffer.byteLength(socketPath) > SOCKET_PATH_MAX_BYTES) {
    fail('ADMIN_SOCKET_CONFIG', 'derived ADMIN socket path is too long');
  }
  return socketPath;
}

function sendAdminRequest({ socketPath, token, request, requestId, timeoutMs, signal }) {
  if (signal?.aborted) return Promise.reject(Object.assign(new Error('ADMIN request aborted'), { code: 'ABORT_ERR' }));
  return new Promise((resolve, reject) => {
    const socket = connect({ path: socketPath });
    const timer = setTimeout(() => socket.destroy(Object.assign(new Error('ADMIN request timed out'), { code: 'ADMIN_TIMEOUT' })), timeoutMs);
    let data = Buffer.alloc(0);
    let settled = false;
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    };
    const failOnce = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const onAbort = () => socket.destroy(Object.assign(new Error('ADMIN request aborted'), { code: 'ABORT_ERR' }));
    signal?.addEventListener('abort', onAbort, { once: true });
    socket.once('error', failOnce);
    socket.once('close', () => {
      cleanup();
      if (!settled) {
        settled = true;
        reject(Object.assign(new Error('ADMIN socket closed without a response'), { code: 'ADMIN_NO_RESPONSE' }));
      }
    });
    socket.once('connect', () => socket.write(request));
    socket.on('data', (chunk) => {
      data = Buffer.concat([data, chunk]);
      if (data.length > MAX_RESPONSE_BYTES) {
        socket.destroy(Object.assign(new Error('ADMIN response is too large'), { code: 'ADMIN_RESPONSE_TOO_LARGE' }));
        return;
      }
      const newline = data.indexOf(0x0a);
      if (newline === -1) return;
      if (newline !== data.length - 1) {
        socket.destroy(Object.assign(new Error('ADMIN response framing is invalid'), { code: 'ADMIN_INVALID_RESPONSE' }));
        return;
      }
      try {
        const response = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(data.subarray(0, newline)));
        if (response.id === null && response.error && /^[A-Z][A-Z0-9_]{0,63}$/u.test(response.error.code ?? '')) {
          settled = true;
          cleanup();
          socket.end();
          reject(Object.assign(new Error(response.error.code), { code: response.error.code }));
          return;
        }
        if (response.id !== requestId) throw Object.assign(new Error('ADMIN response ID mismatch'), { code: 'ADMIN_INVALID_RESPONSE' });
        if (settled) return;
        settled = true;
        cleanup();
        socket.end();
        if (response.error) reject(Object.assign(new Error(response.error.code), { code: response.error.code }));
        else resolve(response.result);
      } catch (error) { failOnce(error); socket.destroy(); }
    });
  });
}

/** Client for the private ADMIN socket. Callers must keep token bytes in memory. */
export function callAdminSocket({ socketPath, token, tool, args, timeoutMs = MAX_CONNECTION_MS }, { signal } = {}) {
  validateToken(token);
  if (!ADMIN_TOOL_SET.has(tool) || !args || typeof args !== 'object' || Array.isArray(args)) {
    return Promise.reject(Object.assign(new Error('ADMIN operation is not allowed'), { code: 'ADMIN_INVALID_REQUEST' }));
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_CONNECTION_MS) {
    return Promise.reject(Object.assign(new Error('ADMIN timeout is invalid'), { code: 'ADMIN_INVALID_REQUEST' }));
  }
  const requestId = `${process.pid}-${Date.now().toString(16)}`;
  const request = Buffer.from(`${JSON.stringify({
    id: requestId,
    token: token.toString('base64url'),
    tool,
    args,
  })}\n`);
  if (request.length > MAX_REQUEST_BYTES) {
    return Promise.reject(Object.assign(new Error('ADMIN request is too large'), { code: 'ADMIN_REQUEST_TOO_LARGE' }));
  }
  return sendAdminRequest({ socketPath, token, request, requestId, timeoutMs, signal });
}

/** Authenticated readiness probe which never calls an OpenWiki lifecycle tool. */
export function pingAdminSocket({ socketPath, token, timeoutMs = 1000 }) {
  validateToken(token);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_CONNECTION_MS) {
    return Promise.reject(Object.assign(new Error('ADMIN timeout is invalid'), { code: 'ADMIN_INVALID_REQUEST' }));
  }
  const requestId = `${process.pid}-${Date.now().toString(16)}`;
  const request = Buffer.from(`${JSON.stringify({ id: requestId, kind: 'health', token: token.toString('base64url') })}\n`);
  return sendAdminRequest({ socketPath, token, request, requestId, timeoutMs });
}
