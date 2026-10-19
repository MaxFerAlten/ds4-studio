import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sidecarRequest, SidecarError } from '../src/client.mjs';

function serve(handler) {
  const dir = mkdtempSync(join(tmpdir(), 'h2ds4-node-'));
  const sock = join(dir, 's.sock');
  const srv = http.createServer(handler);
  return new Promise((r) => srv.listen(sock, () => r({ srv, sock })));
}

test('sends protocol header, idempotency key, parses JSON', async () => {
  const seen = [];
  const { srv, sock } = await serve((req, res) => {
    seen.push(req.headers);
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ ok: true }));
  });
  try {
    assert.deepEqual(await sidecarRequest(sock, '/v1/capabilities'), { ok: true });
    await sidecarRequest(sock, '/v1/experiments', { a: 1 }, { idempotencyKey: 'same' });
    assert.equal(seen[0]['x-h2ds4-protocol'], '1');
    assert.equal(seen[1]['idempotency-key'], 'same');
  } finally { srv.close(); }
});

test('maps error bodies and rejects non-JSON and oversize responses', async () => {
  let mode = 'err';
  const { srv, sock } = await serve((_req, res) => {
    if (mode === 'err') { res.statusCode = 422; res.setHeader('Content-Type', 'application/json'); res.end('{"error":"POLICY_DENIED"}'); }
    else if (mode === 'html') { res.setHeader('Content-Type', 'text/html'); res.end('<x>'); }
    else { res.setHeader('Content-Type', 'application/json'); res.end('"' + 'x'.repeat(2 * 1048576) + '"'); }
  });
  try {
    await assert.rejects(sidecarRequest(sock, '/x'), (e) => e instanceof SidecarError && e.code === 'POLICY_DENIED' && e.status === 422);
    mode = 'html';
    await assert.rejects(sidecarRequest(sock, '/x'), (e) => e.code === 'PROTOCOL_ERROR');
    mode = 'big';
    await assert.rejects(sidecarRequest(sock, '/x'), (e) => e.code === 'RESPONSE_TOO_LARGE');
  } finally { srv.close(); }
});
