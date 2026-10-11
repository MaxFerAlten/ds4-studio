// Host runtime for OpenWiki generation (OWG). Composes the verified config,
// the OS sandbox probe, the ADMIN worker, the confined page writer and the
// generation controller behind a small start/run/stop/status API. Model calls
// stay with the caller-supplied DS4 adapter (`generate`).

import { chmodSync, existsSync, lstatSync, mkdirSync, readdirSync, realpathSync, rmdirSync } from 'node:fs';
import { join } from 'node:path';
import { createAdminPageWriter } from './admin-page-writer.mjs';
import { createAdminWorkerManager } from './admin-worker-manager.mjs';
import { loadConfig, validateWorkspaceRoot } from './config.mjs';
import { assertSandboxUsable } from './safe-paths.mjs';
import { createWikiGenerationController, validateWikiGenerationMetadata } from './wiki-generation-controller.mjs';

export const RUNTIME_STATES = Object.freeze({
  STOPPED: 'stopped', STARTING: 'starting', READY: 'ready', RUNNING: 'running', STOPPING: 'stopping',
});

const DEFAULT_FACTORIES = Object.freeze({
  loadConfig,
  validateWorkspaceRoot,
  assertSandboxUsable,
  createAdminWorkerManager,
  createAdminPageWriter,
  createWikiGenerationController,
});
const OPENWIKI_DIR = 'openwiki';

function fail(code, message, cause) {
  throw Object.assign(new Error(message, cause === undefined ? undefined : { cause }), { code });
}

function errorCode(error) {
  return typeof error?.code === 'string' && error.code.length <= 64 ? error.code : 'RUNTIME_ERROR';
}

function lstatMaybe(path) {
  try { return lstatSync(path); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

// Init never overwrites: any existing entry (directory, file or symlink) is refused.
function assertOpenwikiAbsent(dir) {
  if (lstatMaybe(dir)) fail('OPENWIKI_DIR_EXISTS', 'init refuses an existing openwiki path; use update');
}

function createOpenwikiDir(dir, uid) {
  try { mkdirSync(dir, { mode: 0o700 }); }
  catch (error) {
    if (error.code === 'EEXIST') fail('OPENWIKI_DIR_EXISTS', 'init refuses an existing openwiki path; use update');
    fail('OPENWIKI_DIR_CREATE_FAILED', 'could not create the openwiki directory', error);
  }
  // mkdir honours umask; pin the exact private mode on the entry we just created.
  chmodSync(dir, 0o700);
  const st = lstatSync(dir);
  if (st.isSymbolicLink() || !st.isDirectory() || st.uid !== uid || (st.mode & 0o777) !== 0o700) {
    fail('OPENWIKI_DIR_UNSAFE', 'created openwiki directory does not meet requirements');
  }
}

function assertOpenwikiUsable(dir, uid) {
  const st = lstatMaybe(dir);
  if (!st) fail('OPENWIKI_DIR_MISSING', 'update requires an existing openwiki directory; use init');
  if (st.isSymbolicLink() || !st.isDirectory()) fail('OPENWIKI_DIR_UNSAFE', 'openwiki must be a real directory, not a symlink');
  if (st.uid !== uid || (st.mode & 0o022) !== 0) {
    fail('OPENWIKI_DIR_UNSAFE', 'openwiki directory must be owned by this user and not group/world writable');
  }
  if (realpathSync(dir) !== dir) fail('OPENWIKI_DIR_UNSAFE', 'openwiki directory path is not canonical');
}

/**
 * @param {{configPath:string, stateStore:{get:Function, save:Function}, generate:Function,
 *   readContext?:Function, onProgress?:Function, limits?:object, configOptions?:object,
 *   managerOptions?:object, writerOptions?:object, factories?:object}} options
 * `stateStore` is an injected createWikiGenerationStateStore instance.
 * `generate` is the current DS4 request/session adapter (see the controller).
 * `factories` replaces individual collaborators for offline tests.
 */
export function createWikiGenerationRuntime({
  configPath,
  stateStore,
  generate,
  readContext,
  onProgress,
  limits,
  configOptions = {},
  managerOptions = {},
  writerOptions = {},
  factories = {},
} = {}) {
  if (typeof configPath !== 'string' || !configPath.startsWith('/')) throw new TypeError('configPath must be an absolute path');
  if (!stateStore || typeof stateStore.get !== 'function' || typeof stateStore.save !== 'function') {
    throw new TypeError('stateStore must provide get and save');
  }
  if (typeof generate !== 'function') throw new TypeError('generate is required');
  for (const [key, value] of Object.entries(factories)) {
    if (!Object.hasOwn(DEFAULT_FACTORIES, key)) throw new TypeError(`unknown factory: ${key}`);
    if (typeof value !== 'function') throw new TypeError(`factory ${key} must be a function`);
  }
  const f = { ...DEFAULT_FACTORIES, ...factories };

  let state = RUNTIME_STATES.STOPPED;
  let config = null;
  let workspace = null;
  let manager = null;
  let controller = null;
  let startPromise = null;
  let stopPromise = null;
  let active = null; // { kind, startedAt, abort: AbortController, promise }
  const writerTasks = new Set();
  let lastError = null;
  let lastResult = null;

  async function teardown() {
    const current = manager;
    manager = null;
    controller = null;
    config = null;
    workspace = null;
    if (current) await current.close();
  }

  async function start() {
    if (state === RUNTIME_STATES.READY || state === RUNTIME_STATES.RUNNING) return status();
    if (startPromise) return startPromise;
    const pendingStop = stopPromise;
    startPromise = (async () => {
      if (pendingStop) { try { await pendingStop; } catch {} }
      state = RUNTIME_STATES.STARTING;
      const loaded = f.loadConfig(configPath, configOptions);
      const ids = Object.keys(loaded?.workspaces ?? {});
      if (ids.length !== 1) fail('WORKSPACE_SELECTION_INVALID', 'generation runtime requires exactly one configured workspace');
      const selected = loaded.workspaces[ids[0]];
      if (!selected || typeof selected.root !== 'string') fail('WORKSPACE_SELECTION_INVALID', 'configured workspace has no root');
      // Refuse to start anything unconfined.
      f.assertSandboxUsable(loaded, ids[0]);
      config = loaded;
      workspace = Object.freeze({ id: ids[0], root: selected.root, dev: selected.dev, ino: selected.ino });
      manager = f.createAdminWorkerManager({ configPath, ...managerOptions });
      const writer = f.createAdminPageWriter(config, workspace.id, writerOptions);
      const trackedWriter = {
        writePage(job, markdown, options) {
          const task = Promise.resolve().then(() => writer.writePage(job, markdown, options));
          writerTasks.add(task);
          const clear = () => writerTasks.delete(task);
          task.then(clear, clear);
          return task;
        },
      };
      controller = f.createWikiGenerationController({
        callAdmin: (tool, args, options) => manager.call(tool, args, options),
        generate,
        writePage: (job, markdown, { signal } = {}) => trackedWriter.writePage(job, markdown, { signal }),
        ...(readContext ? { readContext } : {}),
        ...(onProgress ? { onProgress } : {}),
        stateStore,
      }, limits);
      state = RUNTIME_STATES.READY;
      lastError = null;
      return status();
    })().catch(async (error) => {
      lastError = errorCode(error);
      try { await teardown(); } catch {}
      state = RUNTIME_STATES.STOPPED;
      throw error;
    }).finally(() => { startPromise = null; });
    return startPromise;
  }

  function preflightRoot(root) {
    if (typeof root !== 'string' || root.includes('\0')) fail('INVALID_ROOT', 'root must be a path string');
    const validated = f.validateWorkspaceRoot(root, configOptions);
    if (!validated || validated.root !== workspace.root || validated.root !== root ||
        (workspace.dev !== undefined && (validated.dev !== workspace.dev || validated.ino !== workspace.ino))) {
      fail('WORKSPACE_ROOT_MISMATCH', 'root does not match the configured workspace');
    }
    return validated.root;
  }

  async function run({ kind, root, stateKey, metadata, modelContext, signal } = {}) {
    if (state !== RUNTIME_STATES.READY) {
      fail(state === RUNTIME_STATES.RUNNING ? 'RUNTIME_BUSY' : 'RUNTIME_NOT_STARTED',
        state === RUNTIME_STATES.RUNNING ? 'a generation run is already active' : 'runtime is not started');
    }
    if (kind !== 'init' && kind !== 'update') fail('INVALID_KIND', 'kind must be init or update');
    if (signal !== undefined && !(signal instanceof AbortSignal)) fail('INVALID_SIGNAL', 'signal must be an AbortSignal');
    if (typeof stateKey !== 'string' || stateKey.length < 1 || stateKey.length > 1024 || stateKey.includes('\0')) {
      fail('STATE_KEY_INVALID', 'stateKey must be a non-empty session/workspace key no longer than 1024 characters');
    }
    validateWikiGenerationMetadata(metadata);
    if (signal?.aborted) fail('ABORTED', 'generation aborted before start');

    // Every check above and here precedes the first filesystem or upstream mutation.
    const canonicalRoot = preflightRoot(root);
    const wikiDir = join(canonicalRoot, OPENWIKI_DIR);
    const previous = await stateStore.get(stateKey);
    if (previous && previous.root !== canonicalRoot) fail('STATE_ROOT_MISMATCH', 'stateKey is already associated with a different repository');
    const recoverableEmptyInit = kind === 'init' && previous?.root === canonicalRoot && !previous.runId &&
      ['starting', 'failed'].includes(previous.phase) && existsSync(wikiDir) && readdirSync(wikiDir).length === 0;
    const resumableInit = (kind === 'init' && previous?.root === canonicalRoot && previous.runId &&
      ['planning', 'generating', 'failed', 'aborting'].includes(previous.phase)) || recoverableEmptyInit;
    if (kind === 'init') {
      if (existsSync(wikiDir)) {
        if (!resumableInit) assertOpenwikiAbsent(wikiDir);
        assertOpenwikiUsable(wikiDir, config.uid ?? process.getuid());
      }
    }
    else assertOpenwikiUsable(wikiDir, config.uid ?? process.getuid());

    const abort = new AbortController();
    const linked = signal ? AbortSignal.any([signal, abort.signal]) : abort.signal;
    state = RUNTIME_STATES.RUNNING;
    lastResult = null;

    let created = false;
    const promise = (async () => {
      if (typeof generate.probeModel !== 'function') {
        fail('MODEL_TOOL_CALL_UNSUPPORTED', 'active DS4 model cannot be checked for structured tool calling');
      }
      await generate.probeModel({ modelContext, signal: linked });
      controller.reset();
      return controller.run({ kind, root: canonicalRoot, stateKey, metadata, modelContext, signal: linked,
        prepareWorkspace: () => {
          if (kind === 'init' && !existsSync(wikiDir)) {
            createOpenwikiDir(wikiDir, config.uid ?? process.getuid());
            created = true;
          }
          // The ADMIN sandbox can only bind-mount the dedicated wiki output
          // directory. Start it after init has created that directory; plain
          // `/openwiki start` must not create workspace content as a side effect.
          return manager.start();
        } });
    })();
    active = { kind, stateKey, startedAt: Date.now(), abort, promise };
    try {
      const result = await promise;
      lastError = null;
      lastResult = Object.freeze({ kind, runId: result.runId ?? null, pageCount: result.pageCount,
        totalTextBytes: result.totalTextBytes, noop: result.noop === true });
      return result;
    } catch (error) {
      lastError = errorCode(error);
      // Only an empty directory created by this run is removed; pages are never deleted.
      await Promise.allSettled([...writerTasks]);
      if (created) { try { rmdirSync(wikiDir); } catch {} }
      throw error;
    } finally {
      active = null;
      if (state === RUNTIME_STATES.RUNNING) state = RUNTIME_STATES.READY;
    }
  }

  async function stop() {
    if (stopPromise) return stopPromise;
    if (state === RUNTIME_STATES.STOPPED && !startPromise) return status();
    stopPromise = (async () => {
      if (startPromise) { try { await startPromise; } catch {} }
      state = RUNTIME_STATES.STOPPING;
      const running = active;
      if (running) {
        running.abort.abort(Object.assign(new Error('runtime stopping'), { code: 'RUNTIME_STOPPING' }));
        try { await running.promise; } catch {}
      }
      await Promise.allSettled([...writerTasks]);
      try { await teardown(); }
      catch (error) { lastError = errorCode(error); throw error; }
      finally { state = RUNTIME_STATES.STOPPED; }
      return status();
    })().finally(() => { stopPromise = null; });
    return stopPromise;
  }

  function cancel(stateKey) {
    if (!active || active.stateKey !== stateKey) return false;
    if (!active.abort.signal.aborted) active.abort.abort(Object.assign(new Error('generation cancelled by session'), { code: 'RUNTIME_CANCELLED' }));
    return true;
  }

  // Fixed field list: no token, socket path, config path, prompts, metadata or model context.
  function status() {
    const generation = controller?.snapshot();
    return Object.freeze({
      state,
      workspaceId: workspace?.id ?? null,
      root: workspace?.root ?? null,
      admin: manager ? manager.snapshot().state : 'stopped',
      activeRun: active ? Object.freeze({ kind: active.kind, startedAt: new Date(active.startedAt).toISOString(),
        aborted: active.abort.signal.aborted }) : null,
      generation: generation ? Object.freeze({ state: generation.state, runId: generation.runId, kind: generation.kind,
        pageCount: generation.pageCount, totalTextBytes: generation.totalTextBytes }) : null,
      lastResult,
      lastError,
    });
  }

  return Object.freeze({ start, run, cancel, stop, status, RUNTIME_STATES });
}

export default createWikiGenerationRuntime;
