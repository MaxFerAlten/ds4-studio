import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.mjs';
import { startGateway } from './index.mjs';
import { McpSupervisor } from './mcp-supervisor.mjs';

const COMPATIBILITY_FILE = fileURLToPath(new URL('../compatibility-v0.7.2.json', import.meta.url));
const PINNED_MCP_COMMAND = Object.freeze(['mcp', '--host', 'ds4-studio']);
const MAX_MANIFEST_BYTES = 16 * 1024;

function nodeVersionAtLeast(actual, minimum) {
  const parse = (value) => /^(\d+)\.(\d+)\.(\d+)$/.exec(value)?.slice(1).map(Number);
  const a = parse(actual);
  const b = parse(minimum);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return true;
}

function fail(code, message) {
  throw Object.assign(new Error(message), { code });
}

function readProtectedJson(path, uid, what) {
  let stat;
  try { stat = lstatSync(path); }
  catch { fail('INVALID_CONFIG', `${what} is unavailable`); }
  if (stat.isSymbolicLink() || !stat.isFile() || (stat.uid !== uid && stat.uid !== 0) ||
      (stat.mode & 0o022) !== 0 || stat.size > MAX_MANIFEST_BYTES) {
    fail('INVALID_CONFIG', `${what} has unsafe ownership, type, mode, or size`);
  }
  try { return JSON.parse(readFileSync(path, 'utf8')); }
  catch { fail('INVALID_CONFIG', `${what} is invalid JSON`); }
}

export function certifyRuntimeContract(config, releaseManifest, compatibility) {
  const pinned = compatibility?.upstream;
  const mcp = compatibility?.mcp;
  const releaseId = basename(dirname(config?.upstream?.releaseDir ?? ''));
  const command = releaseManifest?.mcpCommand;
  const commandMatches = Array.isArray(command) && command.length === PINNED_MCP_COMMAND.length &&
    command.every((value, index) => value === PINNED_MCP_COMMAND[index]);
  if (!pinned || !mcp || !releaseId ||
      releaseManifest?.releaseId !== releaseId ||
      releaseManifest?.openwikiCommit !== pinned.commit ||
      releaseManifest?.nodeAbi !== process.versions.modules ||
      releaseManifest?.platform !== `${process.platform}-${process.arch}` ||
      releaseManifest?.nodeEngine !== pinned.nodeEngine ||
      !nodeVersionAtLeast(process.versions.node, pinned.nodeEngine?.replace(/^>=/, '')) ||
      !commandMatches ||
      typeof mcp.protocolVersion !== 'string' || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/u.test(mcp.protocolVersion) ||
      typeof mcp.schemaFingerprint !== 'string' || !/^[0-9a-f]{64}$/u.test(mcp.schemaFingerprint) ||
      (releaseManifest.mcpProtocolVersion != null && releaseManifest.mcpProtocolVersion !== mcp.protocolVersion) ||
      (releaseManifest.schemaFingerprint != null && releaseManifest.schemaFingerprint !== mcp.schemaFingerprint)) {
    fail('CONTRACT_MISMATCH', 'release does not match the pinned OpenWiki compatibility contract');
  }
  return Object.freeze({
    manifest: Object.freeze({ certified: true, protocolVersion: mcp.protocolVersion, schemaFingerprint: mcp.schemaFingerprint }),
    expectedProtocolVersion: mcp.protocolVersion,
    expectedSchemaFingerprint: mcp.schemaFingerprint,
    commandArgs: Object.freeze([...command]),
  });
}

export async function startConfiguredGateway({ env = process.env } = {}) {
  const configPath = env.DS4_OPENWIKI_CONFIG;
  if (typeof configPath !== 'string' || !isAbsolute(configPath)) {
    fail('INVALID_CONFIG', 'DS4_OPENWIKI_CONFIG must name an absolute config path');
  }
  const config = loadConfig(configPath);
  const workspaceIds = Object.keys(config.workspaces);
  if (workspaceIds.length !== 1) {
    fail('INVALID_CONFIG', 'this gateway process must have exactly one configured workspace');
  }
  const releaseManifestPath = join(dirname(config.upstream.releaseDir), 'manifest.json');
  const releaseManifest = readProtectedJson(releaseManifestPath, config.uid, 'release manifest');
  const compatibility = readProtectedJson(COMPATIBILITY_FILE, config.uid, 'compatibility contract');
  const contract = certifyRuntimeContract(config, releaseManifest, compatibility);
  const mcp = new McpSupervisor({
    config,
    workspaceId: workspaceIds[0],
    ...contract,
  });
  return startGateway({ config, mcp });
}

async function run() {
  const gateway = await startConfiguredGateway();
  let stopping = null;
  const stop = (signal) => {
    if (stopping) return stopping;
    process.stdout.write(`ds4-openwiki-gateway: stopping (${signal})\n`);
    stopping = gateway.close().catch((error) => {
      const message = `ds4-openwiki-gateway: shutdown failed (${error?.code ?? 'error'}); exiting to preserve the socket pathname\n`;
      process.stderr.write(message, () => process.exit(1));
    });
    return stopping;
  };
  process.once('SIGINT', () => { void stop('SIGINT'); });
  process.once('SIGTERM', () => { void stop('SIGTERM'); });
  process.stdout.write(`ds4-openwiki-gateway: ready (${gateway.server.address()?.address ?? 'unix socket'})\n`);
}

if (process.argv[1] && realpathSync(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  run().catch((error) => {
    process.stderr.write(`ds4-openwiki-gateway: startup failed (${error?.code ?? 'error'})\n`);
    process.exitCode = 1;
  });
}
