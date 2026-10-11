import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { createWikiGenerationRuntime } from '../../integrations/openwiki-gateway/src/wiki-generation-runtime.mjs';
import { createWikiGenerationStateStore } from '../../integrations/openwiki-gateway/src/wiki-generation-state-store.mjs';
import { loadConfig as loadOpenWikiConfig } from '../../integrations/openwiki-gateway/src/config.mjs';
import { startConfiguredGateway } from '../../integrations/openwiki-gateway/src/daemon.mjs';
import { assertOpenWikiReady, readOpenWikiConfig } from './openwikiAgentTools.mjs';
import { collectOpenWikiRunMetadata, collectOpenWikiWorkspaceSnapshot } from './openwikiRunMetadata.mjs';

const MAX_WORKSPACE_CHANGE_SESSIONS = 64;

function fail(code, message, cause) {
  throw Object.assign(new Error(message, cause === undefined ? undefined : { cause }), { code });
}

function validSessionKey(key) {
  return typeof key === 'string' && key.length > 0 && key.length <= 256 && !key.includes('\0');
}

function stateKeyFor(sessionKey, root) {
  const rootHash = createHash('sha256').update(root, 'utf8').digest('hex');
  return `${sessionKey}:${rootHash}`;
}

/** Process-level runtime registry; a single configured ADMIN socket is shared by sessions. */
export function createOpenWikiGenerationService({
  env = process.env,
  generate,
  readContext,
  onProgress,
  factories = {},
} = {}) {
  if (typeof generate !== 'function') throw new TypeError('generate is required');
  if (readContext !== undefined && typeof readContext !== 'function') throw new TypeError('readContext must be a function');
  const createRuntime = factories.createRuntime ?? createWikiGenerationRuntime;
  const createStateStore = factories.createStateStore ?? createWikiGenerationStateStore;
  const collectMetadata = factories.collectMetadata ?? collectOpenWikiRunMetadata;
  const collectWorkspaceSnapshot = factories.collectWorkspaceSnapshot ?? collectOpenWikiWorkspaceSnapshot;
  const payloadModel = factories.payloadModel ?? ((request) => request?.model || '');
  const loadGatewayConfig = factories.loadGatewayConfig ?? loadOpenWikiConfig;
  const makeReadConfig = factories.readOpenWikiConfig ?? readOpenWikiConfig;
  const assertReadReady = factories.assertOpenWikiReady ?? assertOpenWikiReady;
  const startReadGateway = factories.startReadGateway ?? startConfiguredGateway;
  if (typeof createRuntime !== 'function' || typeof createStateStore !== 'function' ||
      typeof collectMetadata !== 'function' || typeof collectWorkspaceSnapshot !== 'function' || typeof payloadModel !== 'function' ||
      typeof loadGatewayConfig !== 'function' || typeof makeReadConfig !== 'function' ||
      typeof assertReadReady !== 'function' || typeof startReadGateway !== 'function') {
    throw new TypeError('service factories must be functions');
  }

  let runtime = null;
  let configuredWorkspaceId = null;
  let startPromise = null;
  let readGateway = null;
  let ownsReadGateway = false;
  let activeReadConfig = null;
  const sessions = new Set();
  const lastWorkspaceChanges = new Map();

  async function ensureReadGateway(configPath) {
    const config = loadGatewayConfig(configPath);
    const ids = Object.keys(config.workspaces ?? {});
    if (ids.length !== 1 || ids[0] !== configuredWorkspaceId) {
      fail('WORKSPACE_SELECTION_INVALID', 'gateway must contain only the configured OpenWiki workspace');
    }
    activeReadConfig = makeReadConfig({
      DS4_OPENWIKI_MODE: 'on',
      DS4_OPENWIKI_SOCKET: config.listen.socketPath,
      DS4_OPENWIKI_WORKSPACE: configuredWorkspaceId,
    });
    if (!activeReadConfig.enabled) fail('OPENWIKI_READ_CONFIG_INVALID', 'READ gateway configuration is invalid');
    try {
      await assertReadReady(activeReadConfig);
      return;
    } catch {}

    try {
      readGateway = await startReadGateway({ env: { DS4_OPENWIKI_CONFIG: configPath } });
      ownsReadGateway = true;
    } catch (startError) {
      try {
        await assertReadReady(activeReadConfig);
        readGateway = null;
        ownsReadGateway = false;
        return;
      } catch {
        activeReadConfig = null;
        fail('OPENWIKI_READ_START_FAILED', 'could not start or reuse the READ gateway', startError);
      }
    }
    try { await assertReadReady(activeReadConfig); }
    catch (error) {
      if (ownsReadGateway) { try { await readGateway.close(); } catch {} }
      readGateway = null;
      ownsReadGateway = false;
      activeReadConfig = null;
      fail('OPENWIKI_READ_NOT_READY', 'READ gateway did not become ready', error);
    }
  }

  async function closeOwnedReadGateway() {
    const current = ownsReadGateway ? readGateway : null;
    readGateway = null;
    ownsReadGateway = false;
    activeReadConfig = null;
    if (current) await current.close();
  }

  function getRuntime() {
    if (runtime) return runtime;
    const configPath = env.DS4_OPENWIKI_CONFIG;
    configuredWorkspaceId = env.DS4_OPENWIKI_WORKSPACE;
    if (typeof configPath !== 'string' || !path.isAbsolute(configPath) || typeof configuredWorkspaceId !== 'string' ||
        !/^[a-z0-9][a-z0-9-]{0,63}$/u.test(configuredWorkspaceId)) {
      fail('OPENWIKI_NOT_CONFIGURED', 'protected OpenWiki configuration is unavailable');
    }
    const stateHome = typeof env.XDG_STATE_HOME === 'string' && path.isAbsolute(env.XDG_STATE_HOME)
      ? env.XDG_STATE_HOME : path.join(os.homedir(), '.local', 'state');
    const stateDir = path.join(stateHome, 'ds4-studio', 'openwiki', 'generation');
    const stateStore = createStateStore({ stateDir });
    runtime = createRuntime({ configPath, stateStore, generate, ...(readContext ? { readContext } : {}), ...(onProgress ? { onProgress } : {}) });
    return runtime;
  }

  async function start(sessionKey) {
    if (!validSessionKey(sessionKey)) fail('SESSION_KEY_INVALID', 'Agent session identity is invalid');
    const current = getRuntime();
    if (startPromise) {
      const status = await startPromise;
      sessions.add(sessionKey);
      return Object.freeze({ ...status, enabled: true });
    }
    startPromise = (async () => {
      const configPath = env.DS4_OPENWIKI_CONFIG;
      await ensureReadGateway(configPath);
      let status;
      try {
        status = await current.start();
      } catch (error) {
        await current.stop().catch(() => {});
        await closeOwnedReadGateway().catch(() => {});
        throw error;
      }
      if (status.workspaceId !== configuredWorkspaceId) {
        await current.stop().catch(() => {});
        await closeOwnedReadGateway().catch(() => {});
        fail('WORKSPACE_SELECTION_INVALID', 'configured OpenWiki workspace ID does not match the gateway');
      }
      sessions.add(sessionKey);
      return Object.freeze({ ...status, enabled: true });
    })().finally(() => { startPromise = null; });
    return startPromise;
  }

  async function run({ sessionKey, kind, root, request, engine, modelContext, signal } = {}) {
    if (!validSessionKey(sessionKey) || !sessions.has(sessionKey)) fail('OPENWIKI_NOT_STARTED', 'OpenWiki is not started for this Agent session');
    const current = getRuntime();
    const status = current.status();
    if (typeof root !== 'string' || root !== status.root) fail('WORKSPACE_ROOT_MISMATCH', 'requested root does not match the configured OpenWiki workspace');
    const metadata = await collectMetadata({ root, engine, model: payloadModel(request), signal });
    const before = await collectWorkspaceSnapshot({ root, signal });
    const key = stateKeyFor(sessionKey, root);
    lastWorkspaceChanges.delete(sessionKey);
    let result;
    let runError;
    try {
      result = await current.run({ kind, root, stateKey: key, metadata, modelContext: modelContext ?? { request }, signal });
    } catch (error) { runError = error; }
    let workspaceChanges;
    try {
      const after = await collectWorkspaceSnapshot({ root });
      const beforeByPath = new Map(before.map((entry) => [entry.path, entry]));
      const afterByPath = new Map(after.map((entry) => [entry.path, entry]));
      const paths = new Set([...beforeByPath.keys(), ...afterByPath.keys()]);
      let changedPathCount = 0;
      for (const filePath of paths) {
        const beforeEntry = beforeByPath.get(filePath);
        const afterEntry = afterByPath.get(filePath);
        if (beforeEntry && afterEntry && JSON.stringify(beforeEntry) !== JSON.stringify(afterEntry)) changedPathCount++;
      }
      workspaceChanges = Object.freeze({
        preexistingPathCount: beforeByPath.size,
        changedPathCount,
        addedPathCount: [...afterByPath.keys()].filter((filePath) => !beforeByPath.has(filePath)).length,
        removedPathCount: [...beforeByPath.keys()].filter((filePath) => !afterByPath.has(filePath)).length,
        truncated: false,
      });
    } catch (snapshotError) {
      workspaceChanges = Object.freeze({ preexistingPathCount: before.length, changedPathCount: 0,
        addedPathCount: 0, removedPathCount: 0, truncated: true,
        errorCode: typeof snapshotError?.code === 'string' ? snapshotError.code : 'GIT_METADATA_FAILED' });
    }
    lastWorkspaceChanges.set(sessionKey, workspaceChanges);
    while (lastWorkspaceChanges.size > MAX_WORKSPACE_CHANGE_SESSIONS) {
      const oldestSessionKey = lastWorkspaceChanges.keys().next().value;
      if (oldestSessionKey === undefined) break;
      lastWorkspaceChanges.delete(oldestSessionKey);
    }
    if (runError) throw runError;
    return Object.freeze({ ...result, workspaceChanges });
  }

  async function stop(sessionKey) {
    if (!validSessionKey(sessionKey)) fail('SESSION_KEY_INVALID', 'Agent session identity is invalid');
    if (startPromise) { try { await startPromise; } catch {} }
    sessions.delete(sessionKey);
    if (!runtime) return Object.freeze({ state: 'stopped', enabled: false });
    const status = runtime.status();
    if (status.root) runtime.cancel(stateKeyFor(sessionKey, status.root));
    if (sessions.size === 0) {
      try { await runtime.stop(); }
      finally { await closeOwnedReadGateway(); }
    }
    return Object.freeze({ ...runtime.status(), enabled: false });
  }

  function status(sessionKey) {
    if (!validSessionKey(sessionKey)) fail('SESSION_KEY_INVALID', 'Agent session identity is invalid');
    return Object.freeze({ ...(runtime?.status() ?? { state: 'stopped', root: null, workspaceId: null, admin: 'stopped' }),
      enabled: sessions.has(sessionKey), workspaceChanges: lastWorkspaceChanges.get(sessionKey) ?? null });
  }

  function hasActiveSessions() { return sessions.size > 0; }

  function readConfig(sessionKey) {
    if (!validSessionKey(sessionKey) || !sessions.has(sessionKey) || !activeReadConfig) {
      return makeReadConfig({ DS4_OPENWIKI_MODE: 'off' });
    }
    return activeReadConfig;
  }

  async function invalidateRead() {
    activeReadConfig = null;
    await closeOwnedReadGateway();
  }

  async function resetConfiguration() {
    if (sessions.size > 0) fail('OPENWIKI_SESSION_ACTIVE', 'OpenWiki sessions must be stopped before changing configuration');
    if (startPromise) { try { await startPromise; } catch {} }
    if (runtime) await runtime.stop();
    await closeOwnedReadGateway();
    runtime = null;
    configuredWorkspaceId = null;
    activeReadConfig = null;
    lastWorkspaceChanges.clear();
  }

  async function close() {
    sessions.clear();
    if (startPromise) { try { await startPromise; } catch {} }
    if (runtime) await runtime.stop();
    await closeOwnedReadGateway();
  }

  return Object.freeze({ start, run, stop, status, readConfig, invalidateRead, resetConfiguration, hasActiveSessions, close });
}

export default createOpenWikiGenerationService;
