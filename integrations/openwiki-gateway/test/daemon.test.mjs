import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { certifyRuntimeContract } from '../src/daemon.mjs';

const compatibility = JSON.parse(readFileSync(new URL('../compatibility-v0.7.2.json', import.meta.url), 'utf8'));
const pinned = compatibility.upstream;
const releaseManifest = {
  releaseId: 'runtime-release-id',
  openwikiVersion: '0.7.2',
  openwikiCommit: pinned.commit,
  nodeAbi: process.versions.modules,
  platform: `${process.platform}-${process.arch}`,
  nodeEngine: pinned.nodeEngine,
  openwikiExecutableSha256: 'ignored-digest',
  mcpCommand: ['mcp', '--host', 'ds4-studio'],
  mcpProtocolVersion: null,
  schemaFingerprint: null,
};
const config = {
  upstream: {
    releaseDir: '/tmp/runtime-release-id/package',
  },
};

test('certifies only the pinned release, MCP command, protocol, and schema', () => {
  assert.deepEqual(certifyRuntimeContract(config, releaseManifest, compatibility), {
    manifest: {
      certified: true,
      protocolVersion: compatibility.mcp.protocolVersion,
      schemaFingerprint: compatibility.mcp.schemaFingerprint,
    },
    expectedProtocolVersion: compatibility.mcp.protocolVersion,
    expectedSchemaFingerprint: compatibility.mcp.schemaFingerprint,
    commandArgs: ['mcp', '--host', 'ds4-studio'],
  });
});
test('release version and executable hashes are informational, not runtime gates', () => {
  const informationalDrift = {
    ...releaseManifest,
    openwikiVersion: '9.9.9',
    openwikiExecutableSha256: 'changed-digest',
  };
  assert.equal(certifyRuntimeContract(config, informationalDrift, compatibility).manifest.certified, true);
});

test('fails closed on source commit, release identity, command, protocol, or schema drift', () => {
  const cases = [
    [{ ...releaseManifest, releaseId: 'other' }, compatibility],
    [{ ...releaseManifest, openwikiCommit: '0'.repeat(40) }, compatibility],
    [{ ...releaseManifest, nodeAbi: '0' }, compatibility],
    [{ ...releaseManifest, platform: 'other-arch' }, compatibility],
    [{ ...releaseManifest, mcpCommand: ['mcp', '--host', 'other'] }, compatibility],
    [{ ...releaseManifest, mcpProtocolVersion: '2025-06-18' }, compatibility],
    [{ ...releaseManifest, schemaFingerprint: '0'.repeat(64) }, compatibility],
  ];
  for (const [manifest, contract] of cases) {
    assert.throws(() => certifyRuntimeContract(config, manifest, contract), { code: 'CONTRACT_MISMATCH' });
  }
});
