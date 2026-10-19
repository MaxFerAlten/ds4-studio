// UDS client for the h2ds4 sidecar (plan §33.1). Lives in the external repository only:
// it is not imported or injected into the DS4 Node server.
import http from 'node:http';
import { randomUUID } from 'node:crypto';

const MAX_RESPONSE = 1048576;

export class SidecarError extends Error {
  constructor(code, status, detail = '') {
    super(code);
    this.code = code;
    this.status = status;
    this.detail = detail;
  }
}

// One logical request. Pass the SAME idempotencyKey when retrying a POST with the same body.
export function sidecarRequest(socketPath, path, body = undefined, {
  timeoutMs = 5000, idempotencyKey = undefined, adminToken = undefined, signal = undefined,
} = {}) {
  const method = body === undefined ? 'GET' : 'POST';
  const data = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
  const headers = { 'X-H2DS4-Protocol': '1', 'X-Request-Id': randomUUID() };
  if (data) {
    headers['Content-Type'] = 'application/json';
    headers['Content-Length'] = String(data.length);
    headers['Idempotency-Key'] = idempotencyKey ?? randomUUID();
  }
  if (adminToken) headers.Authorization = `Bearer ${adminToken}`;
  return new Promise((resolve, reject) => {
    const req = http.request({ socketPath, path, method, headers, timeout: timeoutMs, signal }, (res) => {
      const ctype = String(res.headers['content-type'] ?? '').split(';')[0];
      if (ctype !== 'application/json') {
        res.resume();
        reject(new SidecarError('PROTOCOL_ERROR', res.statusCode, 'non-JSON response'));
        return;
      }
      const chunks = [];
      let total = 0;
      res.on('data', (b) => {
        total += b.length;
        if (total > MAX_RESPONSE) { req.destroy(new SidecarError('RESPONSE_TOO_LARGE', res.statusCode)); return; }
        chunks.push(b);
      });
      res.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
        catch { reject(new SidecarError('PROTOCOL_ERROR', res.statusCode, 'invalid JSON')); return; }
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new SidecarError(parsed.error ?? 'SIDECAR_ERROR', res.statusCode, parsed.detail ?? ''));
        } else resolve(parsed);
      });
    });
    req.once('timeout', () => req.destroy(new SidecarError('TIMEOUT', 0)));
    req.once('error', reject);
    if (data) req.write(data);
    req.end();
  });
}
