// Supervisor for the sandboxed OpenWiki MCP child (WP04b, plan §5.6-§5.7).
//
// One McpSupervisor owns at most one child for exactly one allowlisted
// workspace. The child is always the bubblewrap invocation built by
// safe-paths.mjs (argv array, shell=false via the SDK stdio transport), with
// --clearenv so nothing from the gateway environment reaches OpenWiki except
// the sandbox whitelist.
//
//   stopped --start()--> starting --handshake ok--> ready --stop()/fault--> stopped
//                           \--any failure (child closed)--> stopped
//
// Startup fails closed on: missing/uncertified manifest, handshake deadline,
// protocol version != certified, missing required tool, schema fingerprint !=
// certified, any stdout/protocol error or early child exit. The child is
// killed on every failed start.
//
// Every upstream interaction holds the CircuitBreaker lease (single flight).
// Calls have an absolute deadline; on deadline or caller abort the SDK sends
// notifications/cancelled and the child is killed anyway, because a child that
// ignores cancellation would otherwise keep working behind the single-flight
// slot. There is no automatic retry and no automatic restart: after a child
// is retired the owner calls start() again.

import { createHash } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import { CircuitBreaker, LEASE_KINDS, OUTCOMES } from './circuit-breaker.mjs';
import { getWorkspace } from './config.mjs';
import { buildSandboxInvocation, buildAdminSandboxInvocation } from './safe-paths.mjs';

export const SUPERVISOR_STATES = Object.freeze({
  STOPPED: 'stopped',
  STARTING: 'starting',
  READY: 'ready',
  STOPPING: 'stopping',
});

export const ACCESS_MODES = Object.freeze({
  READ: 'read',
  ADMIN: 'admin',
});

export const REQUIRED_TOOLS = Object.freeze(['openwiki_read', 'openwiki_search']);
// Begin/finish/submit never leave the READ gateway; unknown tools are also denied.
export const READ_ONLY_TOOLS = Object.freeze([
  'openwiki_list_wikis',
  'openwiki_list_workspaces',
  'openwiki_read',
  'openwiki_search',
]);
// Pinned generation lifecycle tools (OWG-04): denied in READ and reserved for the
// separate ADMIN supervisor.
export const PINNED_LIFECYCLE_TOOLS = Object.freeze([
  'openwiki_begin',
  'openwiki_submit_plan',
  'openwiki_next_page',
  'openwiki_inspect_page_claims',
  'openwiki_submit_page',
  'openwiki_finish',
]);

export const SUPERVISOR_DEFAULTS = Object.freeze({
  handshakeTimeoutMs: 8_000,
  callTimeoutsMs: Object.freeze({ search: 2_000, read: 3_000, list: 2_000, admin: 5_000 }),
  healthTimeoutMs: 2_000,
  stopGraceMs: 1_000,
  stderrMaxBytes: 16 * 1024,
});

const READ_ONLY_SET = new Set(READ_ONLY_TOOLS);
const PINNED_LIFECYCLE_SET = new Set(PINNED_LIFECYCLE_TOOLS);
const TOOL_DEADLINE_KEY = Object.freeze({
  openwiki_search: 'search',
  openwiki_read: 'read',
  openwiki_list_workspaces: 'list',
  openwiki_list_wikis: 'list',
  openwiki_begin: 'admin',
  openwiki_submit_plan: 'admin',
  openwiki_next_page: 'admin',
  openwiki_inspect_page_claims: 'admin',
  openwiki_submit_page: 'admin',
  openwiki_finish: 'admin',
});
const FINGERPRINT_PATTERN = /^[0-9a-f]{64}$/;
const MAX_ARGUMENT_BYTES = 64 * 1024;
const MAX_CANONICAL_DEPTH = 64;
const STDOUT_MAX_BYTES = 8 * 1024 * 1024;
const KILL_WAIT_MS = 2_000;
const CLIENT_INFO = Object.freeze({ name: 'ds4-openwiki-gateway', version: '0.1.0' });
// Server-sent JSON-RPC errors that are about the request, not child health.
const CONTENT_ERROR_CODES = new Set([ErrorCode.InvalidRequest, ErrorCode.MethodNotFound, ErrorCode.InvalidParams]);
const OPTION_KEYS = new Set([
  'config',
  'workspaceId',
  'manifest',
  'commandArgs',
  'expectedProtocolVersion',
  'expectedSchemaFingerprint',
  'breaker',
  'handshakeTimeoutMs',
  'callTimeoutsMs',
  'healthTimeoutMs',
  'stopGraceMs',
  'stderrMaxBytes',
  'accessMode',
]);

// Error codes and how an upstream interaction failing with them is settled:
// outcome null = neutral release, kill = retire the child before freeing the slot.
const FAILURE_POLICY = Object.freeze({
  DEADLINE_EXCEEDED: { outcome: OUTCOMES.INFRASTRUCTURE, kill: true },
  ABORTED: { outcome: null, kill: true },
  PROTOCOL_ERROR: { outcome: OUTCOMES.INFRASTRUCTURE, kill: true },
  CHILD_EXITED: { outcome: OUTCOMES.INFRASTRUCTURE, kill: true },
  MISSING_TOOL: { outcome: OUTCOMES.INFRASTRUCTURE, kill: true },
  SCHEMA_MISMATCH: { outcome: OUTCOMES.INFRASTRUCTURE, kill: true },
  UPSTREAM_ERROR: { outcome: OUTCOMES.INFRASTRUCTURE, kill: false },
  CONTENT_ERROR: { outcome: OUTCOMES.CONTENT, kill: false },
});

/**
 * Error codes (content-free messages; never the query or tool output):
 *   start:  NOT_CERTIFIED, MANIFEST_MISMATCH, INVALID_STATE, SANDBOX_FAILED,
 *           SPAWN_FAILED, HANDSHAKE_TIMEOUT, PROTOCOL_MISMATCH, MISSING_TOOL,
 *           SCHEMA_MISMATCH, PROTOCOL_ERROR, CHILD_EXITED, STOPPED
 *   calls:  TOOL_NOT_ALLOWED, INVALID_ARGUMENTS, TOOL_UNAVAILABLE, NOT_READY,
 *           DEADLINE_EXCEEDED, ABORTED, STALE_GENERATION, CHILD_EXITED,
 *           PROTOCOL_ERROR, UPSTREAM_ERROR, CONTENT_ERROR, SCHEMA_MISMATCH,
 *           MISSING_TOOL
 * Breaker refusals are thrown as CircuitBreakerError (CIRCUIT_OPEN,
 * PROBE_REQUIRED, UPSTREAM_BUSY). Start failures carry `stderrTail`.
 */
export class McpSupervisorError extends Error {
  constructor(code, message, { cause, stderrTail } = {}) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'McpSupervisorError';
    this.code = code;
    if (stderrTail !== undefined) this.stderrTail = stderrTail;
  }
}

function supervisorError(code, message, options) {
  return new McpSupervisorError(code, message, options);
}

// --- schema fingerprint ------------------------------------------------------

/**
 * Canonical JSON: object keys sorted recursively (code-unit order), array
 * order preserved, undefined properties dropped. Rejects values JSON cannot
 * represent faithfully (non-finite numbers, bigint, functions, cycles/depth).
 */
export function canonicalJson(value, depth = 0) {
  if (depth > MAX_CANONICAL_DEPTH) throw new TypeError('value nested too deeply for canonical JSON');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('canonical JSON does not allow non-finite numbers');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item === undefined ? null : item, depth + 1)).join(',')}]`;
  }
  if (typeof value === 'object') {
    const keys = Object.keys(value).filter((key) => value[key] !== undefined).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key], depth + 1)}`).join(',')}}`;
  }
  throw new TypeError(`canonical JSON does not allow ${typeof value}`);
}

/**
 * SHA-256 (lowercase hex) of the canonical JSON of the full tool entries as
 * returned by tools/list, sorted by name. Throws TypeError on a malformed list
 * or duplicate tool names.
 */
export function computeSchemaFingerprint(tools) {
  if (!Array.isArray(tools)) throw new TypeError('tools must be an array');
  const seen = new Set();
  for (const tool of tools) {
    if (tool === null || typeof tool !== 'object' || typeof tool.name !== 'string' || tool.name === '') {
      throw new TypeError('every tool must be an object with a non-empty name');
    }
    if (seen.has(tool.name)) throw new TypeError(`duplicate tool name ${JSON.stringify(tool.name)}`);
    seen.add(tool.name);
  }
  const sorted = [...tools].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return createHash('sha256').update(canonicalJson(sorted)).digest('hex');
}

// --- helpers -------------------------------------------------------------------

function positiveIntegerAtMost(value, max, name) {
  if (!Number.isSafeInteger(value) || value < 1 || value > max) {
    throw new TypeError(`${name} must be an integer in 1..${max}`);
  }
  return value;
}

// Rejects with signal.reason as soon as the signal aborts, even if `promise`
// never settles (an SDK path that ignores the signal cannot outlive the deadline).
function withAbort(promise, signal) {
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (err) => {
        signal.removeEventListener('abort', onAbort);
        reject(err);
      },
    );
  });
}

function waitAtMost(promise, ms) {
  let timer;
  return Promise.race([promise, new Promise((resolve) => (timer = setTimeout(resolve, ms)))]).finally(() =>
    clearTimeout(timer),
  );
}

// bwrap applies --clearenv/--setenv while parsing, before exec'ing the child,
// so the SDK's inherited defaults (USER, SHELL, TERM, ...) and any provider or
// cloud secret in the gateway environment never reach OpenWiki.
function sandboxArgs(inv) {
  const envArgs = ['--clearenv'];
  for (const [key, value] of Object.entries(inv.env)) envArgs.push('--setenv', key, value);
  return [...envArgs, ...inv.args];
}

function cloneArguments(args) {
  if (args === undefined) return {};
  const proto = args === null || typeof args !== 'object' ? undefined : Object.getPrototypeOf(args);
  if (proto !== Object.prototype && proto !== null) {
    throw supervisorError('INVALID_ARGUMENTS', 'tool arguments must be a plain object');
  }
  let json;
  try {
    json = JSON.stringify(args);
  } catch {
    throw supervisorError('INVALID_ARGUMENTS', 'tool arguments must be JSON-serializable');
  }
  if (Buffer.byteLength(json) > MAX_ARGUMENT_BYTES) {
    throw supervisorError('INVALID_ARGUMENTS', `tool arguments exceed ${MAX_ARGUMENT_BYTES} bytes`);
  }
  return JSON.parse(json);
}

// Maps a rejected upstream interaction to a McpSupervisorError.
function classifyFailure(err, child) {
  if (err instanceof McpSupervisorError) return err;
  if (child.fault) return child.fault;
  if (err instanceof McpError) {
    if (err.code === ErrorCode.ConnectionClosed) return supervisorError('CHILD_EXITED', 'MCP child closed', { cause: err });
    if (err.code === ErrorCode.RequestTimeout) {
      return supervisorError('DEADLINE_EXCEEDED', 'MCP request deadline exceeded', { cause: err });
    }
    if (CONTENT_ERROR_CODES.has(err.code)) {
      return supervisorError('CONTENT_ERROR', `MCP request rejected (code ${err.code})`, { cause: err });
    }
    return supervisorError('UPSTREAM_ERROR', `MCP upstream error (code ${err.code})`, { cause: err });
  }
  return supervisorError('PROTOCOL_ERROR', 'invalid MCP response', { cause: err });
}

// Validates a tools/list result against the certified surface. Returns the
// tool map and fingerprint, or throws a McpSupervisorError.
function validateToolList(result, expectedFingerprint) {
  if (result.nextCursor !== undefined) {
    throw supervisorError('PROTOCOL_ERROR', 'paginated tools/list is not supported');
  }
  let fingerprint;
  try {
    fingerprint = computeSchemaFingerprint(result.tools);
  } catch (err) {
    throw supervisorError('PROTOCOL_ERROR', 'malformed tools/list result', { cause: err });
  }
  const tools = new Map(result.tools.map((tool) => [tool.name, Object.freeze(structuredClone(tool))]));
  for (const name of REQUIRED_TOOLS) {
    if (!tools.has(name)) throw supervisorError('MISSING_TOOL', `required tool ${name} is missing`);
  }
  if (fingerprint !== expectedFingerprint) {
    throw supervisorError('SCHEMA_MISMATCH', 'tool schema fingerprint does not match the certified manifest');
  }
  return { tools, fingerprint };
}

// --- supervisor ------------------------------------------------------------------

export class McpSupervisor {
  #config;
  #workspace;
  #manifest;
  #commandArgs;
  #expectedProtocolVersion;
  #expectedFingerprint;
  #breaker;
  #handshakeTimeoutMs;
  #callTimeoutsMs;
  #healthTimeoutMs;
  #stopGraceMs;
  #stderrMaxBytes;
  #accessMode;

  #state = SUPERVISOR_STATES.STOPPED;
  #generation = 0;
  #child = null;
  #tools = null;
  #protocolVersion = null;
  #fingerprint = null;
  #lastError = null;
  #inFlight = null; // { tool, promise } of the single upstream interaction
  #startPromise = null;
  #startAbort = null;
  #stopPromise = null;

  /**
   * options:
   *   config                     loadConfig() result
   *   workspaceId                the single allowlisted workspace this child serves
   *   manifest                   certified manifest { certified: true, protocolVersion,
   *                              schemaFingerprint } or null (then start() refuses)
   *   commandArgs                fixed operator-pinned CLI arguments; never request input
   *   expectedProtocolVersion    required string; must equal manifest.protocolVersion
   *   expectedSchemaFingerprint  required 64-hex; must equal manifest.schemaFingerprint
   *   breaker                    CircuitBreaker instance (default: new CircuitBreaker())
   *   handshakeTimeoutMs         <= 8000; callTimeoutsMs { search <= 2000, read <= 3000,
   *                              list <= 2000, admin <= 5000 }; healthTimeoutMs <= 2000 (tests shorten them)
   *   stopGraceMs, stderrMaxBytes
   *   accessMode                 'read' (default) | 'admin' — internal only, not from HTTP/config/env
   * Throws TypeError on bad options and ConfigError for a non-allowlisted workspace.
   */
  constructor(options = {}) {
    for (const key of Object.keys(options)) {
      if (!OPTION_KEYS.has(key)) throw new TypeError(`unknown supervisor option: ${key}`);
    }
    const o = { ...SUPERVISOR_DEFAULTS, ...options };
    if (o.config === null || typeof o.config !== 'object') throw new TypeError('config is required');
    this.#config = o.config;
    this.#workspace = getWorkspace(o.config, o.workspaceId);
    if (typeof o.expectedProtocolVersion !== 'string' || o.expectedProtocolVersion === '') {
      throw new TypeError('expectedProtocolVersion is required');
    }
    if (typeof o.expectedSchemaFingerprint !== 'string' || !FINGERPRINT_PATTERN.test(o.expectedSchemaFingerprint)) {
      throw new TypeError('expectedSchemaFingerprint must be 64 lowercase hex characters');
    }
    this.#expectedProtocolVersion = o.expectedProtocolVersion;
    this.#expectedFingerprint = o.expectedSchemaFingerprint;
    this.#manifest = o.manifest === undefined ? null : o.manifest;
    const commandArgs = o.commandArgs ?? [];
    if (!Array.isArray(commandArgs) || commandArgs.length > 16 || commandArgs.some((arg) =>
      typeof arg !== 'string' || arg.length > 256 || arg.includes('\u0000'))) {
      throw new TypeError('commandArgs must be an array of at most 16 bounded strings without NUL');
    }
    this.#commandArgs = Object.freeze([...commandArgs]);
    this.#breaker = o.breaker ?? new CircuitBreaker();
    if (!(this.#breaker instanceof CircuitBreaker)) throw new TypeError('breaker must be a CircuitBreaker');

    // Validate and store accessMode (internal only, not exposed to HTTP/config/env)
    const mode = o.accessMode ?? ACCESS_MODES.READ;
    if (mode !== ACCESS_MODES.READ && mode !== ACCESS_MODES.ADMIN) {
      throw new TypeError(`accessMode must be 'read' or 'admin'`);
    }
    this.#accessMode = mode;

    const d = SUPERVISOR_DEFAULTS;
    this.#handshakeTimeoutMs = positiveIntegerAtMost(o.handshakeTimeoutMs, d.handshakeTimeoutMs, 'handshakeTimeoutMs');
    const calls = { ...d.callTimeoutsMs, ...o.callTimeoutsMs };
    for (const key of Object.keys(calls)) {
      if (!Object.hasOwn(d.callTimeoutsMs, key)) throw new TypeError(`unknown callTimeoutsMs key: ${key}`);
      positiveIntegerAtMost(calls[key], d.callTimeoutsMs[key], `callTimeoutsMs.${key}`);
    }
    this.#callTimeoutsMs = Object.freeze(calls);
    this.#healthTimeoutMs = positiveIntegerAtMost(o.healthTimeoutMs, d.healthTimeoutMs, 'healthTimeoutMs');
    this.#stopGraceMs = positiveIntegerAtMost(o.stopGraceMs, 10_000, 'stopGraceMs');
    this.#stderrMaxBytes = positiveIntegerAtMost(o.stderrMaxBytes, 1024 * 1024, 'stderrMaxBytes');
  }

  /**
   * Content-free state for health endpoints and tests:
   *   { state, generation, workspaceId, protocolVersion, schemaFingerprint,
   *     tools: string[], inFlight: string|null, lastError: string|null,
   *     stderr: { retainedBytes, droppedBytes }, breaker: breaker.snapshot() }
   */
  snapshot() {
    const child = this.#child;
    return {
      state: this.#state,
      generation: this.#generation,
      workspaceId: this.#workspace.id,
      protocolVersion: this.#protocolVersion,
      schemaFingerprint: this.#fingerprint,
      tools: this.#tools === null ? [] : [...this.#tools.keys()].sort(),
      inFlight: this.#inFlight === null ? null : this.#inFlight.tool,
      lastError: this.#lastError,
      stderr: {
        retainedBytes: child === null ? 0 : child.stderrBytes,
        droppedBytes: child === null ? 0 : child.stderrDropped,
      },
      breaker: this.#breaker.snapshot(),
    };
  }

  /**
   * Spawn the sandboxed child and complete the MCP handshake (initialize +
   * tools/list) within handshakeTimeoutMs. Resolves with snapshot() once
   * ready; a concurrent start() shares the pending attempt and start() while
   * ready resolves immediately. Rejects with McpSupervisorError and leaves the
   * supervisor stopped with no child on any failure.
   */
  start() {
    if (this.#state === SUPERVISOR_STATES.READY) return Promise.resolve(this.snapshot());
    if (this.#state === SUPERVISOR_STATES.STARTING) return this.#startPromise;
    if (this.#state === SUPERVISOR_STATES.STOPPING) {
      return Promise.reject(supervisorError('INVALID_STATE', 'supervisor is stopping'));
    }
    this.#state = SUPERVISOR_STATES.STARTING;
    this.#lastError = null;
    const attempt = this.#doStart();
    this.#startPromise = attempt;
    const clear = () => {
      if (this.#startPromise === attempt) this.#startPromise = null;
    };
    attempt.then(clear, clear);
    return attempt;
  }

  /**
   * Stop the child. With drain (default) the in-flight interaction finishes or
   * hits its own deadline first, then stdin is closed and the child gets
   * stopGraceMs before SIGKILL. With { drain: false } the child is killed at
   * once and the in-flight call rejects with STALE_GENERATION. Idempotent;
   * concurrent calls share one promise. Resolves with snapshot().
   */
  stop({ drain = true } = {}) {
    if (this.#stopPromise !== null) return this.#stopPromise;
    if (this.#state === SUPERVISOR_STATES.STOPPED && this.#child === null) return Promise.resolve(this.snapshot());
    this.#state = SUPERVISOR_STATES.STOPPING;
    const run = (async () => {
      this.#startAbort?.abort(supervisorError('STOPPED', 'supervisor stopped during startup'));
      if (this.#startPromise !== null) await this.#startPromise.catch(() => {});
      if (!drain && this.#child !== null) await this.#retireChild(this.#child, { force: true, reason: null });
      if (this.#inFlight !== null) await this.#inFlight.promise.catch(() => {});
      if (this.#child !== null) await this.#retireChild(this.#child, { force: false, reason: null });
      this.#state = SUPERVISOR_STATES.STOPPED;
      return this.snapshot();
    })();
    this.#stopPromise = run;
    const clear = () => {
      if (this.#stopPromise === run) this.#stopPromise = null;
    };
    run.then(clear, clear);
    return run;
  }

  /**
   * Explicit upstream health probe: tools/list only (never a search/read
   * query) under the breaker's probe lease, so it is the only call admitted in
   * HALF_OPEN; its outcome closes or re-opens the breaker. Also re-checks the
   * certified tool surface. Resolves { ok: true, generation, toolCount }.
   * Throws CircuitBreakerError, NOT_READY or a classified McpSupervisorError.
   */
  async healthCheck({ signal } = {}) {
    if (signal?.aborted) throw supervisorError('ABORTED', 'health check aborted before start');
    const child = this.#requireReady();
    const lease = this.#breaker.acquire(LEASE_KINDS.PROBE);
    return this.#exclusive(lease, child, 'tools/list', this.#healthTimeoutMs, signal, async (requestOptions) => {
      const result = await child.client.listTools(undefined, requestOptions);
      const { tools } = validateToolList(result, this.#expectedFingerprint);
      return { outcome: OUTCOMES.SUCCESS, value: { ok: true, generation: child.generation, toolCount: tools.size } };
    });
  }

  /**
   * Call one read-only tool (openwiki_search, openwiki_read,
   * openwiki_list_workspaces, openwiki_list_wikis). Anything else, including
   * the six pinned lifecycle tools (openwiki_begin, openwiki_submit_plan,
   * openwiki_next_page, openwiki_inspect_page_claims, openwiki_submit_page,
   * openwiki_finish), is rejected with TOOL_NOT_ALLOWED before any MCP
   * traffic. Only available in READ access mode. Deadline: search 2s, read 3s,
   * list 2s (absolute); `signal` aborts early. No retry. Resolves
   *   { generation, tool, isError, content, structuredContent }
   * where isError marks a tool-level content error (breaker CONTENT).
   * Throws CircuitBreakerError or McpSupervisorError.
   */
  async callReadOnly(name, args, { signal } = {}) {
    if (this.#accessMode !== ACCESS_MODES.READ) {
      throw supervisorError('TOOL_NOT_ALLOWED', 'callReadOnly is only available in READ access mode');
    }
    if (typeof name !== 'string' || PINNED_LIFECYCLE_SET.has(name) || !READ_ONLY_SET.has(name)) {
      throw supervisorError('TOOL_NOT_ALLOWED', 'tool is not in the read-only allowlist');
    }
    const params = { name, arguments: cloneArguments(args) };
    if (signal?.aborted) throw supervisorError('ABORTED', 'call aborted before start');
    const child = this.#requireReady();
    if (!this.#tools.has(name)) throw supervisorError('TOOL_UNAVAILABLE', `tool ${name} is not offered by upstream`);
    const lease = this.#breaker.acquire(LEASE_KINDS.REQUEST);
    const timeoutMs = this.#callTimeoutsMs[TOOL_DEADLINE_KEY[name]];
    return this.#exclusive(lease, child, name, timeoutMs, signal, async (requestOptions) => {
      const result = await child.client.callTool(params, undefined, requestOptions);
      const isError = result.isError === true;
      return {
        outcome: isError ? OUTCOMES.CONTENT : OUTCOMES.SUCCESS,
        value: {
          generation: child.generation,
          tool: name,
          isError,
          content: result.content,
          structuredContent: result.structuredContent,
        },
      };
    });
  }

  /**
   * Call one pinned lifecycle tool (openwiki_begin, openwiki_submit_plan,
   * openwiki_next_page, openwiki_inspect_page_claims, openwiki_submit_page,
   * openwiki_finish). Only available in ADMIN access mode. Anything else is
   * rejected with TOOL_NOT_ALLOWED before any MCP traffic. Deadline: admin 5s
   * (absolute); `signal` aborts early. No retry. Resolves
   *   { generation, tool, isError, content, structuredContent }
   * where isError marks a tool-level content error (breaker CONTENT).
   * Throws CircuitBreakerError or McpSupervisorError.
   */
  async callAdmin(name, args, { signal } = {}) {
    if (this.#accessMode !== ACCESS_MODES.ADMIN) {
      throw supervisorError('TOOL_NOT_ALLOWED', 'callAdmin is only available in ADMIN access mode');
    }
    if (typeof name !== 'string' || !PINNED_LIFECYCLE_SET.has(name)) {
      throw supervisorError('TOOL_NOT_ALLOWED', 'tool is not in the pinned lifecycle allowlist');
    }
    const params = { name, arguments: cloneArguments(args) };
    if (signal?.aborted) throw supervisorError('ABORTED', 'call aborted before start');
    const child = this.#requireReady();
    if (!this.#tools.has(name)) throw supervisorError('TOOL_UNAVAILABLE', `tool ${name} is not offered by upstream`);
    const lease = this.#breaker.acquire(LEASE_KINDS.REQUEST);
    const timeoutMs = this.#callTimeoutsMs[TOOL_DEADLINE_KEY[name]];
    return this.#exclusive(lease, child, name, timeoutMs, signal, async (requestOptions) => {
      const result = await child.client.callTool(params, undefined, requestOptions);
      const isError = result.isError === true;
      return {
        outcome: isError ? OUTCOMES.CONTENT : OUTCOMES.SUCCESS,
        value: {
          generation: child.generation,
          tool: name,
          isError,
          content: result.content,
          structuredContent: result.structuredContent,
        },
      };
    });
  }

  // --- internals -------------------------------------------------------------

  #requireReady() {
    if (this.#state !== SUPERVISOR_STATES.READY || this.#child === null) {
      throw supervisorError('NOT_READY', `supervisor is ${this.#state}`);
    }
    return this.#child;
  }

  #checkManifest() {
    const m = this.#manifest;
    if (m === null || typeof m !== 'object' || m.certified !== true) {
      throw supervisorError('NOT_CERTIFIED', 'no certified OpenWiki manifest; refusing to start');
    }
    if (m.protocolVersion !== this.#expectedProtocolVersion || m.schemaFingerprint !== this.#expectedFingerprint) {
      throw supervisorError('MANIFEST_MISMATCH', 'expected protocol/schema do not match the certified manifest');
    }
  }

  async #doStart() {
    let child = null;
    const deadline = new AbortController();
    this.#startAbort = deadline;
    const timer = setTimeout(
      () => deadline.abort(supervisorError('HANDSHAKE_TIMEOUT', 'MCP handshake deadline exceeded')),
      this.#handshakeTimeoutMs,
    );
    try {
      this.#checkManifest();
      let inv;
      try {
        const builder = this.#accessMode === ACCESS_MODES.ADMIN
          ? buildAdminSandboxInvocation
          : buildSandboxInvocation;
        inv = builder(this.#config, this.#workspace.id, {
          argv: [this.#config.upstream.node, this.#config.upstream.executable, ...this.#commandArgs],
        });
      } catch (err) {
        throw supervisorError('SANDBOX_FAILED', `sandbox unavailable: ${err.message}`, { cause: err });
      }
      if (!inv.args.includes('--die-with-parent')) {
        throw supervisorError('SANDBOX_FAILED', 'sandbox invocation lacks --die-with-parent');
      }
      child = this.#spawnChild(inv);
      this.#child = child;

      const requestOptions = { signal: deadline.signal, timeout: this.#handshakeTimeoutMs };
      const guarded = (promise) => Promise.race([withAbort(promise, deadline.signal), child.faultPromise]);
      try {
        await guarded(child.client.connect(child.transport, requestOptions));
      } catch (err) {
        if (err instanceof McpSupervisorError) throw err;
        throw child.fault ?? supervisorError('PROTOCOL_ERROR', 'MCP initialize failed', { cause: err });
      }
      if (child.fault) throw child.fault;
      if (child.protocolVersion !== this.#expectedProtocolVersion) {
        throw supervisorError('PROTOCOL_MISMATCH', 'negotiated MCP protocol version is not the certified one');
      }
      let listed;
      try {
        listed = await guarded(child.client.listTools(undefined, requestOptions));
      } catch (err) {
        throw classifyFailure(err, child);
      }
      const { tools, fingerprint } = validateToolList(listed, this.#expectedFingerprint);
      if (child.fault) throw child.fault;
      if (this.#state !== SUPERVISOR_STATES.STARTING || this.#child !== child) {
        throw supervisorError('STOPPED', 'supervisor stopped during startup');
      }
      this.#tools = tools;
      this.#fingerprint = fingerprint;
      this.#protocolVersion = child.protocolVersion;
      this.#state = SUPERVISOR_STATES.READY;
      return this.snapshot();
    } catch (err) {
      const failure =
        err instanceof McpSupervisorError ? err : supervisorError('SPAWN_FAILED', 'MCP child start failed', { cause: err });
      if (child !== null) {
        failure.stderrTail = child.stderrTail();
        await this.#retireChild(child, { force: true, reason: failure.code });
      }
      this.#lastError = failure.code;
      if (this.#state === SUPERVISOR_STATES.STARTING) this.#state = SUPERVISOR_STATES.STOPPED;
      throw failure;
    } finally {
      clearTimeout(timer);
      if (this.#startAbort === deadline) this.#startAbort = null;
    }
  }

  #spawnChild(inv) {
    const transport = new StdioClientTransport({
      command: inv.file,
      args: sandboxArgs(inv),
      env: { ...inv.env },
      stderr: 'pipe',
      cwd: '/',
      maxBufferSize: STDOUT_MAX_BYTES,
    });
    const client = new Client(CLIENT_INFO, { capabilities: {} });
    let resolveExit;
    let rejectFault;
    const child = {
      generation: ++this.#generation,
      transport,
      client,
      pid: null,
      protocolVersion: null,
      exited: false,
      exitPromise: new Promise((resolve) => (resolveExit = resolve)),
      fault: null,
      faultPromise: new Promise((_, reject) => (rejectFault = reject)),
      retiring: null,
      stderrChunks: [],
      stderrBytes: 0,
      stderrDropped: 0,
      stderrTail: () => Buffer.concat(child.stderrChunks).toString('utf8'),
    };
    child.faultPromise.catch(() => {});

    // Drain stderr continuously, keeping only the newest stderrMaxBytes.
    transport.stderr.on('data', (chunk) => {
      child.stderrChunks.push(chunk);
      child.stderrBytes += chunk.length;
      while (child.stderrBytes > this.#stderrMaxBytes) {
        const excess = child.stderrBytes - this.#stderrMaxBytes;
        const head = child.stderrChunks[0];
        if (head.length <= excess) {
          child.stderrChunks.shift();
          child.stderrBytes -= head.length;
          child.stderrDropped += head.length;
        } else {
          child.stderrChunks[0] = head.subarray(excess);
          child.stderrBytes -= excess;
          child.stderrDropped += excess;
        }
      }
    });
    // The SDK reports the negotiated version to transports that want it; the
    // stdio transport does not, so this hook is ours alone.
    transport.setProtocolVersion = (version) => {
      child.protocolVersion = version;
    };
    // Record the bwrap PID as soon as it exists: the SDK forgets it on close().
    const startTransport = transport.start.bind(transport);
    transport.start = async () => {
      await startTransport();
      child.pid = transport.pid;
    };
    const fault = (code, message, cause) => {
      if (child.fault !== null || child.retiring !== null) return;
      child.fault = supervisorError(code, message, { cause });
      rejectFault(child.fault);
      if (this.#child === child && this.#state === SUPERVISOR_STATES.READY) {
        void this.#retireChild(child, { force: true, reason: code });
      }
    };
    client.onerror = (err) => fault('PROTOCOL_ERROR', 'MCP stdout/protocol error', err);
    client.onclose = () => {
      child.exited = true;
      resolveExit();
      fault('CHILD_EXITED', 'MCP child exited');
    };
    return child;
  }

  // Detach `child` (bumping the generation), then close it: graceful stdin
  // EOF first unless forced, SIGKILL to bwrap otherwise or after the grace
  // period. bwrap --die-with-parent and its PID namespace take the sandboxed
  // process tree down with it. Idempotent per child.
  #retireChild(child, { force, reason }) {
    if (child.retiring !== null) return child.retiring;
    child.retiring = (async () => {
      if (this.#child === child) {
        this.#child = null;
        this.#generation += 1;
        this.#tools = null;
        this.#fingerprint = null;
        this.#protocolVersion = null;
        if (reason !== null) this.#lastError = reason;
        if (this.#state === SUPERVISOR_STATES.READY) this.#state = SUPERVISOR_STATES.STOPPED;
      }
      if (child.pid === null) child.pid = child.transport.pid;
      if (child.pid === null && !child.exited) {
        // Never spawned (or spawn failed): nothing to kill.
        await child.client.close().catch(() => {});
        return;
      }
      if (!force && !child.exited) {
        void child.client.close().catch(() => {});
        await waitAtMost(child.exitPromise, this.#stopGraceMs);
      }
      if (!child.exited) {
        try {
          process.kill(child.pid, 'SIGKILL');
        } catch {
          // Already gone.
        }
        void child.client.close().catch(() => {});
        await waitAtMost(child.exitPromise, KILL_WAIT_MS);
      }
    })();
    return child.retiring;
  }

  // Runs one upstream interaction holding `lease`: absolute deadline, caller
  // abort, stale-generation check, breaker settlement, and child retirement
  // before the slot is freed when the failure policy requires it.
  #exclusive(lease, child, tool, timeoutMs, signal, operation) {
    const generation = this.#generation;
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(supervisorError('DEADLINE_EXCEEDED', 'MCP request deadline exceeded')),
      timeoutMs,
    );
    const onCallerAbort = () => controller.abort(supervisorError('ABORTED', 'request aborted by caller'));
    signal?.addEventListener('abort', onCallerAbort, { once: true });

    const promise = (async () => {
      let outcome = null;
      let killReason = null;
      try {
        let settled;
        let failure = null;
        try {
          settled = await withAbort(
            operation({ signal: controller.signal, timeout: timeoutMs, maxTotalTimeout: timeoutMs }),
            controller.signal,
          );
        } catch (err) {
          failure = err;
        }
        if (this.#generation !== generation || this.#child !== child) {
          // The child was retired under us; never hand out its result.
          if (child.fault) {
            outcome = OUTCOMES.INFRASTRUCTURE;
            throw child.fault;
          }
          throw supervisorError('STALE_GENERATION', 'MCP child changed during the request', {
            cause: failure ?? undefined,
          });
        }
        if (failure === null) {
          outcome = settled.outcome;
          return settled.value;
        }
        const error = controller.signal.aborted ? controller.signal.reason : classifyFailure(failure, child);
        const policy = FAILURE_POLICY[error.code] ?? FAILURE_POLICY.PROTOCOL_ERROR;
        outcome = policy.outcome;
        if (policy.kill) killReason = error.code;
        throw error;
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onCallerAbort);
        if (killReason !== null) await this.#retireChild(child, { force: true, reason: killReason });
        // A child retired by a fault or stop() must be gone before the slot frees.
        if (child.retiring !== null) await child.retiring;
        if (outcome === null) lease.release();
        else lease.settle(outcome);
      }
    })();

    const entry = { tool, promise };
    this.#inFlight = entry;
    const clear = () => {
      if (this.#inFlight === entry) this.#inFlight = null;
    };
    promise.then(clear, clear);
    return promise;
  }
}
