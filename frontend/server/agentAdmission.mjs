// WP2 of piano.esecutivo.integrazione.opendots.v2.md (§6.2, §7): the single
// arbiter of the DS4 runtime resource.
//
// One process-wide lease, busy-reject 409, no queue.  Every ingress that can
// reach the model/runtime (agent runs, ordinary chat proxy, structured calls,
// model/session/profile controls) acquires it through this module:
//
//   execute(identity, op)    an identified run: idempotent on
//                            owner/thread/runId + requestHash, replayable,
//                            cancellable by its owner.
//   exclusive(label, op)     an anonymous unit of work (proxy call, control,
//                            structured call): same lease, no idempotency.
//   joinActive(op)           a child call that arrives over HTTP from the
//                            runtime itself while a run holds the lease (the
//                            native agent calling /api/sage/exec).
//
// Work started inside a run (same async context) inherits the lease instead of
// re-acquiring it, so nested calls never deadlock.  The ownership token is the
// AsyncLocalStorage context: it is never a field a client can set.
//
// The lease is released only when the operation has settled, i.e. after the
// backend fetch, tools and compaction of the run have returned.  An operation
// that cannot prove the runtime stopped calls requireRecovery(): the run
// keeps the lease in "interrupted_recovery" until resolveRecovery().

import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

export class AgentAdmissionError extends Error {
  constructor(code, message, status = 409) {
    super(message);
    this.name = "AgentAdmissionError";
    this.code = code;
    this.status = status;
  }
}

export const RUN_STATE = Object.freeze({
  RUNNING: "running",
  CANCELLING: "cancelling",
  FINISHED: "finished",
  CANCELLED: "cancelled",
  FAILED: "failed",
  RECOVERY: "interrupted_recovery"
});

const HOLDING = new Set([RUN_STATE.RUNNING, RUN_STATE.CANCELLING, RUN_STATE.RECOVERY]);

const ID_PATTERN = /^[A-Za-z0-9._:@~-]{1,200}$/;

export function opaqueId(value, name) {
  if (typeof value !== "string" || !ID_PATTERN.test(value)) {
    throw new AgentAdmissionError("INVALID_IDENTITY", `${name} must be an opaque id ([A-Za-z0-9._:@~-], 1-200 chars)`, 400);
  }
  return value;
}

function keyOf(ownerId, threadId, runId) {
  return JSON.stringify([ownerId, threadId, runId]);
}

function cloneValue(value) {
  if (Buffer.isBuffer(value)) return Buffer.from(value);
  if (value instanceof Uint8Array) return new Uint8Array(value);
  if (value instanceof Headers) return new Headers(value);
  if (Array.isArray(value)) return value.map(cloneValue);
  if (value && typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    if (prototype === Object.prototype || prototype === null) {
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneValue(item)]));
    }
  }
  return value;
}

function sizeOf(value) {
  if (value instanceof Uint8Array) return value.byteLength;
  if (value instanceof Headers) return 1024;
  try { return Buffer.byteLength(JSON.stringify(value) ?? ""); } catch { return 1024; }
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  promise.catch(() => {});
  return { promise, resolve, reject };
}

export function createAgentAdmission({
  maxRetainedRuns = 128,
  maxEventBytesPerRun = 8 * 1024 * 1024,
  now = () => Date.now()
} = {}) {
  if (!Number.isInteger(maxRetainedRuns) || maxRetainedRuns < 1) {
    throw new TypeError("maxRetainedRuns must be a positive integer");
  }

  const context = new AsyncLocalStorage();
  const runs = new Map();
  let active = null;

  function release(run) {
    if (active === run) active = null;
  }

  function prune() {
    for (const [key, run] of runs) {
      if (runs.size <= maxRetainedRuns) break;
      if (!HOLDING.has(run.state)) runs.delete(key);
    }
  }

  function publicRun(run) {
    return Object.freeze({
      ownerId: run.ownerId,
      threadId: run.threadId,
      runId: run.runId,
      label: run.label,
      state: run.state,
      cancelRequested: run.cancelRequested,
      cancelReason: run.cancelReason,
      recoveryReason: run.recoveryReason,
      eventCount: run.eventCount,
      replayable: run.retainEvents && !run.eventsTruncated,
      startedAt: run.startedAt,
      endedAt: run.endedAt
    });
  }

  function find(identity, { requestHash } = {}) {
    const ownerId = opaqueId(identity?.ownerId, "ownerId");
    const threadId = opaqueId(identity?.threadId, "threadId");
    const runId = opaqueId(identity?.runId, "runId");
    const run = runs.get(keyOf(ownerId, threadId, runId));
    // Same answer for "absent" and "owned by someone else": no existence leak.
    if (!run) throw new AgentAdmissionError("RUN_NOT_FOUND", "run not found", 404);
    if (requestHash !== undefined && run.requestHash !== requestHash) {
      throw new AgentAdmissionError("RUN_ID_CONFLICT", "runId already belongs to a different request");
    }
    return run;
  }

  function contextFor(run) {
    return Object.freeze({
      ownerId: run.ownerId,
      threadId: run.threadId,
      runId: run.runId,
      signal: run.controller.signal,
      emit(type, data) {
        if (!HOLDING.has(run.state)) return false;
        run.eventCount++;
        if (run.retainEvents && !run.eventsTruncated) {
          run.eventBytes += sizeOf(data);
          if (run.eventBytes > maxEventBytesPerRun) {
            run.eventsTruncated = true;
            run.events.length = 0;
          } else {
            run.events.push({ type: String(type), data: cloneValue(data) });
          }
        }
        for (const listener of [...run.listeners]) {
          try { listener({ type: String(type), data: cloneValue(data) }); } catch {}
        }
        return true;
      },
      // The operation refused the turn before anything was accepted (no
      // session, invalid input): nothing is recorded and prepare() is undone.
      markRejected() {
        run.rejected = true;
      },
      requireRecovery(reason) {
        run.recoveryRequired = String(reason || "runtime teardown not confirmed");
      }
    });
  }

  function requestCancel(run, reason) {
    if (run.cancelRequested) return;
    run.cancelRequested = true;
    run.cancelReason = String(reason || "cancelled");
    if (run.state === RUN_STATE.RUNNING) run.state = RUN_STATE.CANCELLING;
    run.controller.abort(run.cancelReason);
  }

  function replayInto(run, onEvent) {
    if (typeof onEvent !== "function") return () => {};
    for (const event of run.events) onEvent({ type: event.type, data: cloneValue(event.data) });
    if (!HOLDING.has(run.state)) return () => {};
    run.listeners.add(onEvent);
    return () => run.listeners.delete(onEvent);
  }

  async function join(existing, onEvent) {
    if (!existing.retainEvents || existing.eventsTruncated) {
      throw new AgentAdmissionError("RUN_REPLAY_UNAVAILABLE", "run exists but its events are not replayable");
    }
    const kind = HOLDING.has(existing.state) ? "duplicate" : "replay";
    const unsubscribe = replayInto(existing, onEvent);
    try {
      const value = await existing.completion.promise;
      return Object.freeze({ kind, value, run: publicRun(existing) });
    } finally {
      unsubscribe();
    }
  }

  async function admit(ownerId, threadId, runId, requestHash, operation, options) {
    const { signal, prepare, onEvent, retainEvents = true, label = "run" } = options;
    const key = keyOf(ownerId, threadId, runId);
    const existing = runs.get(key);
    if (existing) {
      if (existing.requestHash !== requestHash) {
        throw new AgentAdmissionError("RUN_ID_CONFLICT", "runId already belongs to a different request");
      }
      return join(existing, onEvent);
    }

    if (active) {
      if (active.state === RUN_STATE.RECOVERY) {
        throw new AgentAdmissionError("RUNTIME_RECOVERY_REQUIRED", `runtime stop not confirmed: ${active.recoveryReason}`);
      }
      throw new AgentAdmissionError("INFERENCE_BUSY", "another inference is active");
    }
    if (signal?.aborted) throw new AgentAdmissionError("RUN_CANCELLED", "run cancelled before admission");

    const run = {
      ownerId, threadId, runId, requestHash, label, state: RUN_STATE.RUNNING,
      events: [], eventBytes: 0, eventCount: 0, eventsTruncated: false, retainEvents,
      listeners: new Set(), controller: new AbortController(), completion: deferred(),
      result: undefined, error: undefined, rejected: false, recoveryRequired: null,
      recoveryReason: undefined, cancelRequested: false, cancelReason: undefined,
      startedAt: now(), endedAt: undefined, terminalState: undefined
    };
    // Synchronous from the busy check to here: no await can interleave.
    runs.set(key, run);
    active = run;
    const forwardAbort = () => requestCancel(run, "client_disconnect");
    signal?.addEventListener("abort", forwardAbort, { once: true });

    // Terminal bookkeeping, before the caller or any joined duplicate sees
    // the outcome.  The lease is released here, after the operation settled.
    const settle = (terminalState, discard, rollback) => {
      signal?.removeEventListener("abort", forwardAbort);
      run.terminalState = terminalState;
      run.endedAt = now();
      if (discard) {
        // Refused before anything was accepted: no record, staged input undone.
        runs.delete(key);
        if (rollback) {
          try { rollback(); } catch {}
        }
      }
      if (run.recoveryRequired) {
        run.state = RUN_STATE.RECOVERY;
        run.recoveryReason = run.recoveryRequired;
      } else {
        run.state = terminalState;
        release(run);
      }
      run.listeners.clear();
      prune();
    };

    let rollback;
    let value;
    try {
      if (prepare) {
        rollback = prepare(publicRun(run));
        if (rollback !== undefined && typeof rollback !== "function") {
          throw new TypeError("prepare must return a rollback function or undefined");
        }
      }
      value = await context.run(run, () => operation(contextFor(run)));
    } catch (error) {
      run.error = error;
      settle(run.cancelRequested ? RUN_STATE.CANCELLED : RUN_STATE.FAILED, run.eventCount === 0 || run.rejected, rollback);
      run.completion.reject(error);
      throw error;
    }
    run.result = value;
    settle(run.cancelRequested ? RUN_STATE.CANCELLED : RUN_STATE.FINISHED, run.rejected, rollback);
    run.completion.resolve(value);
    return Object.freeze({ kind: run.rejected ? "rejected" : "executed", value, run: publicRun(run) });
  }

  async function execute(identity, operation, options = {}) {
    if (typeof operation !== "function") throw new TypeError("operation must be a function");
    const ownerId = opaqueId(identity?.ownerId, "ownerId");
    const threadId = opaqueId(identity?.threadId, "threadId");
    const runId = opaqueId(identity?.runId, "runId");
    const requestHash = opaqueId(identity?.requestHash, "requestHash");

    const parent = context.getStore();
    if (parent && active === parent) {
      if (ownerId !== parent.ownerId || threadId !== parent.threadId || runId !== parent.runId) {
        throw new AgentAdmissionError("RUN_OWNERSHIP_MISMATCH", "nested work must inherit its parent run");
      }
      return Object.freeze({ kind: "nested", value: await operation(contextFor(parent)), run: publicRun(parent) });
    }
    return admit(ownerId, threadId, runId, requestHash, operation, options);
  }

  // Anonymous exclusive work: inherits the lease inside a run, otherwise
  // acquires it under a fresh, non-replayable identity.
  async function exclusive(label, operation, { ownerId = "system", signal } = {}) {
    if (typeof operation !== "function") throw new TypeError("operation must be a function");
    const parent = context.getStore();
    if (parent && active === parent) {
      return Object.freeze({ kind: "nested", value: await operation(contextFor(parent)), run: publicRun(parent) });
    }
    const id = randomUUID();
    return admit(opaqueId(ownerId, "ownerId"), `exclusive:${String(label).replace(/[^A-Za-z0-9._:@~-]/g, "_")}`, id, id, operation, {
      signal, retainEvents: false, label: String(label)
    });
  }

  // A child call that reaches the server over HTTP from the runtime itself
  // (no async context to inherit).  The caller has already established that
  // the request is a local runtime callback and not a browser.
  async function joinActive(label, operation, options = {}) {
    if (active && active.label === "run" && HOLDING.has(active.state) && active.state !== RUN_STATE.RECOVERY) {
      const run = active;
      return Object.freeze({
        kind: "nested",
        value: await context.run(run, () => operation(contextFor(run))),
        run: publicRun(run)
      });
    }
    return exclusive(label, operation, options);
  }

  function cancel(identity, reason = "cancelled by owner") {
    const run = find(identity);
    if (!HOLDING.has(run.state) || run.state === RUN_STATE.RECOVERY) {
      return Object.freeze({ accepted: false, terminal: !HOLDING.has(run.state), state: run.state });
    }
    requestCancel(run, reason);
    return Object.freeze({ accepted: true, terminal: false, state: run.state });
  }

  // The global backend cancel (/v1/cancel) may only be reached by whoever
  // holds the lease.  Returns true when the caller may forward it.
  function cancelActiveFor(ownerId, reason = "backend cancel by lease owner") {
    if (!active) return true;
    if (active.ownerId !== ownerId) {
      throw new AgentAdmissionError("LEASE_NOT_OWNED", "the active inference belongs to another owner", 409);
    }
    if (active.state !== RUN_STATE.RECOVERY) requestCancel(active, reason);
    return true;
  }

  function resolveRecovery(identity) {
    const run = find(identity);
    if (run.state !== RUN_STATE.RECOVERY) return false;
    run.state = run.terminalState || RUN_STATE.FAILED;
    run.recoveryReason = undefined;
    release(run);
    prune();
    return true;
  }

  function subscribe(identity, listener) {
    if (typeof listener !== "function") throw new TypeError("listener must be a function");
    const run = find(identity);
    if (!run.retainEvents || run.eventsTruncated) {
      throw new AgentAdmissionError("RUN_REPLAY_UNAVAILABLE", "run events are not replayable");
    }
    return replayInto(run, listener);
  }

  return Object.freeze({
    execute,
    exclusive,
    joinActive,
    cancel,
    cancelActiveFor,
    resolveRecovery,
    subscribe,
    isBusy: () => Boolean(active),
    inRun: () => {
      const parent = context.getStore();
      return Boolean(parent && active === parent);
    },
    snapshot: () => active ? publicRun(active) : null,
    activeIdentity: () => active ? Object.freeze({ ownerId: active.ownerId, threadId: active.threadId, runId: active.runId }) : null,
    lookup(identity) {
      return publicRun(find(identity));
    },
    result(identity) {
      const run = find(identity);
      return run.completion.promise;
    }
  });
}
