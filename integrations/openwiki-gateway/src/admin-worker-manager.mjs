// Host process ownership for the OpenWiki ADMIN worker (OWG-04).
//
// This module owns the lifecycle of a separate admin-daemon process. It creates
// a 32-byte authentication token, passes it via a private file descriptor (fd 3),
// spawns the daemon with a minimal environment, verifies the derived ADMIN socket
// ownership/mode, and provides a client API for the pinned lifecycle tools.

import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { closeSync, lstatSync, mkdtempSync, openSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.mjs';
import { adminSocketPathFor, callAdminSocket, pingAdminSocket } from './admin-control.mjs';

const ADMIN_DAEMON_ENTRY = fileURLToPath(new URL('./admin-daemon.mjs', import.meta.url));
const MAX_STARTUP_WAIT_MS = 10_000;
const MAX_SHUTDOWN_WAIT_MS = 5_000;
const MAX_ADMIN_CALL_MS = 7_000;
const TOKEN_BYTES = 32;
const SIGNAL_WAIT_MS = 1_000;

function fail(code, message) {
  throw Object.assign(new Error(message), { code });
}

function waitAtMost(promise, ms) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error('timeout'), { code: 'TIMEOUT' })), ms);
  })]).finally(() => clearTimeout(timer));
}

function readTokenFromFile(path) {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.size !== TOKEN_BYTES || (stat.mode & 0o077) !== 0) {
    fail('ADMIN_TOKEN_INVALID', 'token file must be a private 32-byte regular file');
  }
  const token = readFileSync(path);
  if (token.length !== TOKEN_BYTES) fail('ADMIN_TOKEN_INVALID', 'token must contain exactly 32 bytes');
  return token;
}

function deriveAdminSocket(config) {
  return adminSocketPathFor(config.listen.socketPath);
}

function verifyAdminSocket(socketPath) {
  const st = lstatSync(socketPath);
  if (!st.isSocket() || st.uid !== process.getuid() || (st.mode & 0o777) !== 0o600) {
    fail('ADMIN_SOCKET_INVALID', 'derived ADMIN socket has unsafe ownership, type, or mode');
  }
  return true;
}

/**
 * Create a manager for the ADMIN worker process.
 *
 * @param {Object} options
 * @param {string} options.configPath - Absolute path to the gateway config file
 * @param {Object} [options.env] - Must be empty; ADMIN worker environment is fixed
 * @param {Function} [options.spawnImpl] - Override spawn for tests (default: child_process.spawn)
 * @param {number} [options.startupTimeoutMs] - Max time to wait for daemon ready (default: 10000)
 * @param {number} [options.shutdownTimeoutMs] - Max time to wait for daemon exit (default: 5000)
 * @returns {Object} Manager with start, call, close, snapshot
 */
export function createAdminWorkerManager({
  configPath,
  env,
  spawnImpl = spawn,
  startupTimeoutMs = MAX_STARTUP_WAIT_MS,
  shutdownTimeoutMs = MAX_SHUTDOWN_WAIT_MS,
  callTimeoutMs = MAX_ADMIN_CALL_MS,
} = {}) {
  if (typeof configPath !== 'string' || !configPath.startsWith('/')) {
    fail('INVALID_CONFIG', 'configPath must be an absolute path');
  }
  if (env !== undefined && (!env || typeof env !== 'object' || Array.isArray(env) || Object.keys(env).length > 0)) {
    fail('INVALID_ENV', 'ADMIN worker environment is fixed and cannot be extended');
  }
  if (!Number.isSafeInteger(startupTimeoutMs) || startupTimeoutMs < 1 || startupTimeoutMs > MAX_STARTUP_WAIT_MS) {
    fail('INVALID_CONFIG', `startupTimeoutMs must be 1..${MAX_STARTUP_WAIT_MS}`);
  }
  if (!Number.isSafeInteger(shutdownTimeoutMs) || shutdownTimeoutMs < 1 || shutdownTimeoutMs > MAX_SHUTDOWN_WAIT_MS) {
    fail('INVALID_CONFIG', `shutdownTimeoutMs must be 1..${MAX_SHUTDOWN_WAIT_MS}`);
  }
  if (!Number.isSafeInteger(callTimeoutMs) || callTimeoutMs < 1 || callTimeoutMs > MAX_ADMIN_CALL_MS) {
    fail('INVALID_CONFIG', `callTimeoutMs must be 1..${MAX_ADMIN_CALL_MS}`);
  }
  let config = null;
  let token = null;
  let tokenPath = null;
  let tokenDir = null;
  let child = null;
  let adminSocketPath = null;
  let childExited = false;
  let childExitPromise = null;
  let resolveChildExit = null;
  let closing = false;
  let startPromise = null;

  async function loadAndValidateConfig() {
    config = loadConfig(configPath);
    const workspaceIds = Object.keys(config.workspaces);
    if (workspaceIds.length !== 1) {
      fail('INVALID_CONFIG', 'ADMIN worker config must have exactly one workspace');
    }
    adminSocketPath = deriveAdminSocket(config);
    return config;
  }

  async function createTokenFile() {
    tokenDir = mkdtempSync(join(tmpdir(), 'ow-admin-token-'), { mode: 0o700 });
    tokenPath = join(tokenDir, 'token');
    token = randomBytes(TOKEN_BYTES);
    const fd = openSync(tokenPath, 'w', 0o600);
    try {
      writeFileSync(fd, token);
    } finally {
      closeSync(fd);
    }
    // Verify the file we just created
    const st = lstatSync(tokenPath);
    if (!st.isFile() || st.uid !== process.getuid() || st.size !== TOKEN_BYTES || (st.mode & 0o077) !== 0) {
      await cleanupTokenFile();
      fail('ADMIN_TOKEN_CREATE', 'created token file does not meet requirements');
    }
  }

  async function cleanupTokenFile() {
    if (tokenPath) {
      try { unlinkSync(tokenPath); } catch {}
      tokenPath = null;
    }
    if (tokenDir) {
      try { rmSync(tokenDir, { recursive: true, force: true }); } catch {}
      tokenDir = null;
    }
  }

  function makeChildExitPromise() {
    childExitPromise = new Promise((resolve) => {
      resolveChildExit = resolve;
    });
  }

  async function spawnDaemon() {
    if (!token) fail('ADMIN_INTERNAL', 'token not initialized');
    if (!config) fail('ADMIN_INTERNAL', 'config not loaded');

    const minimalEnv = {
      PATH: '/usr/bin:/bin',
      DS4_OPENWIKI_CONFIG: configPath,
      DS4_OPENWIKI_ADMIN_TOKEN_FD: '3',
      LC_ALL: 'C',
    };

    // Pass token on fd 3 by opening the token file and passing its fd as stdio[3]
    const tokenFdForChild = openSync(tokenPath, 'r');
    let childProcess;
    try {
      childProcess = spawnImpl(process.execPath, [ADMIN_DAEMON_ENTRY], {
        env: minimalEnv,
        stdio: ['ignore', 'ignore', 'ignore', tokenFdForChild], // fd 3 = token file
        shell: false,
      });
    } finally {
      closeSync(tokenFdForChild);
    }

    child = childProcess;
    childExited = false;
    makeChildExitPromise();

    child.on('exit', (code, signal) => {
      childExited = true;
      resolveChildExit?.({ code, signal });
    });

    child.on('error', (err) => {
      childExited = true;
      resolveChildExit?.({ error: err });
    });

    // Unlink token pathname immediately after spawn (retain bytes only in parent memory)
    await cleanupTokenFile();
  }

  async function waitForReady() {
    if (!adminSocketPath) fail('ADMIN_INTERNAL', 'admin socket path not derived');

    const deadline = Date.now() + startupTimeoutMs;
    let lastError = null;

    while (Date.now() < deadline) {
      try {
        verifyAdminSocket(adminSocketPath);
        const response = await pingAdminSocket({ socketPath: adminSocketPath, token, timeoutMs: 500 });
        if (response?.state !== 'ready') fail('ADMIN_NOT_READY', 'ADMIN worker did not report ready');
        return; // Ready
      } catch (err) {
        lastError = err;
        await new Promise((r) => setTimeout(r, 50));
      }
    }
    fail('ADMIN_STARTUP_TIMEOUT', `ADMIN worker did not become ready within ${startupTimeoutMs}ms: ${lastError?.message ?? 'unknown'}`);
  }

  async function start() {
    if (startPromise) return startPromise;
    if (child && !childExited) return; // Already running

    startPromise = (async () => {
      await loadAndValidateConfig();
      await createTokenFile();
      await spawnDaemon();
      await waitForReady();
    })().catch(async (err) => {
      await close();
      throw err;
    }).finally(() => {
      startPromise = null;
    });

    return startPromise;
  }

  async function call(tool, args, { signal } = {}) {
    if (!adminSocketPath) fail('ADMIN_NOT_STARTED', 'ADMIN worker not started');
    if (!token) fail('ADMIN_NOT_STARTED', 'ADMIN token not available');
    return callAdminSocket({ socketPath: adminSocketPath, token, tool, args, timeoutMs: callTimeoutMs }, { signal });
  }

  async function close() {
    if (closing) return;
    closing = true;

    if (child && !childExited) {
      try {
        child.kill('SIGTERM');
      } catch {}
      try {
        await waitAtMost(childExitPromise, shutdownTimeoutMs);
      } catch {
        try { child.kill('SIGKILL'); } catch {}
        try {
          await waitAtMost(childExitPromise, SIGNAL_WAIT_MS);
        } catch {
          closing = false;
          fail('ADMIN_REAP_TIMEOUT', `ADMIN worker did not exit within ${SIGNAL_WAIT_MS}ms after SIGKILL`);
        }
      }
    }

    await cleanupTokenFile();

    child = null;
    config = null;
    token = null;
    adminSocketPath = null;
    childExited = false;
    childExitPromise = null;
    resolveChildExit = null;
    closing = false;
  }

  function snapshot() {
    return Object.freeze({
      state: child && !childExited ? 'running' : 'stopped',
      configPath,
      adminSocketPath,
      hasToken: token !== null,
      childPid: child?.pid ?? null,
      childExited,
    });
  }

  return Object.freeze({ start, call, close, snapshot });
}

// Re-export for tests
export { fail, waitAtMost, readTokenFromFile, deriveAdminSocket, verifyAdminSocket };
