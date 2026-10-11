import { closeSync, fstatSync, lstatSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.mjs';
import { certifyRuntimeContract } from './daemon.mjs';
import { McpSupervisor, ACCESS_MODES } from './mcp-supervisor.mjs';
import { adminSocketPathFor, startAdminControlServer } from './admin-control.mjs';

const COMPATIBILITY_FILE = fileURLToPath(new URL('../compatibility-v0.7.2.json', import.meta.url));
const MAX_MANIFEST_BYTES = 16 * 1024;

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

function readTokenFromFd(env) {
  if (env.DS4_OPENWIKI_ADMIN_TOKEN_FD !== '3') {
    fail('ADMIN_AUTH_CONFIG', 'ADMIN token must arrive on inherited file descriptor 3');
  }
  try {
    const stat = fstatSync(3);
    if (!stat.isFile() || stat.uid !== process.getuid() || stat.size !== 32 ||
        (stat.mode & 0o077) !== 0) {
      fail('ADMIN_AUTH_CONFIG', 'ADMIN token descriptor must reference a private 32-byte regular file');
    }
    const token = readFileSync(3);
    if (token.length !== 32) fail('ADMIN_AUTH_CONFIG', 'ADMIN token must contain exactly 32 bytes');
    return token;
  } catch (error) {
    if (error?.code === 'ADMIN_AUTH_CONFIG') throw error;
    fail('ADMIN_AUTH_CONFIG', 'ADMIN token descriptor is unavailable');
  } finally {
    try { closeSync(3); } catch {}
  }
}

export async function startConfiguredAdminWorker({ env = process.env, token } = {}) {
  if (!Buffer.isBuffer(token) || token.length !== 32) {
    fail('ADMIN_AUTH_CONFIG', 'ADMIN worker requires a 32-byte token');
  }
  if (typeof env.DS4_OPENWIKI_CONFIG !== 'string' || !isAbsolute(env.DS4_OPENWIKI_CONFIG)) {
    fail('INVALID_CONFIG', 'DS4_OPENWIKI_CONFIG must name an absolute config path');
  }
  const config = loadConfig(env.DS4_OPENWIKI_CONFIG);
  const workspaceIds = Object.keys(config.workspaces);
  if (workspaceIds.length !== 1) {
    fail('INVALID_CONFIG', 'this ADMIN process must have exactly one configured workspace');
  }
  const releaseManifestPath = join(dirname(config.upstream.releaseDir), 'manifest.json');
  const releaseManifest = readProtectedJson(releaseManifestPath, config.uid, 'release manifest');
  const compatibility = readProtectedJson(COMPATIBILITY_FILE, config.uid, 'compatibility contract');
  const contract = certifyRuntimeContract(config, releaseManifest, compatibility);
  const supervisor = new McpSupervisor({
    config,
    workspaceId: workspaceIds[0],
    ...contract,
    accessMode: ACCESS_MODES.ADMIN,
  });
  return startAdminControlServer({
    socketPath: adminSocketPathFor(config.listen.socketPath),
    token,
    supervisor,
  });
}

async function run() {
  const token = readTokenFromFd(process.env);
  const worker = await startConfiguredAdminWorker({ token });
  let stopping = null;
  const stop = (signal) => {
    if (stopping) return stopping;
    process.stdout.write(`ds4-openwiki-admin: stopping (${signal})\n`);
    stopping = worker.close().catch((error) => {
      process.stderr.write(`ds4-openwiki-admin: shutdown failed (${error?.code ?? 'error'})\n`);
      process.exitCode = 1;
    });
    return stopping;
  };
  process.once('SIGINT', () => { void stop('SIGINT'); });
  process.once('SIGTERM', () => { void stop('SIGTERM'); });
  process.stdout.write(`ds4-openwiki-admin: ready (${worker.socketPath})\n`);
}

if (process.argv[1] && realpathSync(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  run().catch((error) => {
    process.stderr.write(`ds4-openwiki-admin: startup failed (${error?.code ?? 'error'})\n`);
    process.exitCode = 1;
  });
}
