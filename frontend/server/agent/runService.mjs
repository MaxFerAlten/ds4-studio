// WP1 of piano.esecutivo.integrazione.opendots.v2.md (§5): AgentRunService.
//
// One entry point for an agent turn, shared by the legacy route
// POST /api/agent/chat and, later, by the AG-UI gateway.  The service knows
// no `res.write`, no Express request and no AG-UI type: it receives the turn
// input, an `emit(type, data)` callback and an AbortSignal, and it returns
// the outcome.  It does not run a loop of its own: `runJsTurn` is the DS4 JS
// loop and `runNativeTurn` the native-wrapper forwarding, both injected by
// the server (index.mjs), which keeps owning sessions, policies, gates and
// the authoritative buffers.
//
// emit(type, data) types, in the order a turn can produce them:
//   "run_started"     the turn was accepted; the transport opens its stream
//                     (legacy: SSE headers, keepalive, client-abort wiring).
//                     Events below only follow it.
//   "agent_*"         public DS4 events (agent_text, agent_tool_call, ...),
//                     data exactly as the legacy SSE carries it.
//   "native_forward"  native engine: the upstream request is about to start;
//                     the transport may arm its own client-abort wiring.
//   "native_response" native engine: { status, headers } of the upstream
//                     stream, before its first chunk.
//   "native_chunk"    native engine: one raw upstream chunk (bytes), passed
//                     through untouched.
//
// Outcomes (the returned value):
//   { kind: "rejected", status, body }  refused before any stream was opened;
//                                       the transport answers HTTP status/JSON.
//   { kind: "command", events, ok }     a local command answer (slash, /pony,
//                                       /compact, session commands): a complete
//                                       list of { event, data } with no model call.
//   { kind: "streamed" }                the turn ran after "run_started"; its
//                                       terminal event (agent_done/agent_error)
//                                       was emitted by the loop.
//   { kind: "native_streamed" }         the native upstream stream was relayed.

// WP2: with an admission the turn runs under the shared lease.  The caller
// passes `admissionIdentity` ({ ownerId, threadId, runId, requestHash,
// retainEvents }) built from server-side state; without one the turn gets a
// fresh, non-replayable identity.  `prepare` is the atomic accept of the run
// (undone if the turn is refused).  A duplicate of a live or finished run
// replays its recorded events instead of dispatching again.  After a
// cancelled or timed-out turn `confirmRuntimeStopped` must prove the runtime
// is idle, otherwise the lease stays in recovery.

import { randomUUID } from "node:crypto";
import { AgentAdmissionError } from "../agentAdmission.mjs";

const NATIVE_TIMEOUT_ERROR = "Native agent stream timeout";

export const AGENT_RUN_OUTCOME = Object.freeze({
  REJECTED: "rejected",
  COMMAND: "command",
  STREAMED: "streamed",
  NATIVE_STREAMED: "native_streamed"
});

// Fields the service accepts, nothing else: the request body as received
// (the loop keeps reading message/messages/request from it exactly as the
// route did), the session key the transport resolved, the per-request debug
// opt-in and the signal of the incoming request (forwarded to the calls that
// used req.signal).
export function agentTurnInput({ body, sessionKey, debug = false, requestSignal } = {}) {
  return Object.freeze({
    body,
    sessionKey: String(sessionKey ?? ""),
    debug: debug === true,
    requestSignal
  });
}

export function createAgentRunService({
  resolveEngine,
  runJsTurn,
  runNativeTurn,
  admission = null,
  confirmRuntimeStopped = null
} = {}) {
  for (const [name, fn] of Object.entries({ resolveEngine, runJsTurn, runNativeTurn })) {
    if (typeof fn !== "function") throw new TypeError(`createAgentRunService: ${name} must be a function`);
  }
  if (admission && typeof admission.execute !== "function") throw new TypeError("createAgentRunService: admission must expose execute");

  async function dispatch(input, emit, signal) {
    const run = resolveEngine() === "native" ? runNativeTurn : runJsTurn;
    return run(input, emit, signal);
  }

  async function admittedTurn(input, emit, ctx, checkpointSession = null) {
    // Engine frozen once per run (plan §6.1).
    const engine = resolveEngine();
    let timedOut = false;
    let deliveryBarrier = Promise.resolve();
    const forwardEvent = (type, data) => {
      if (type === "agent_error" && data?.error === NATIVE_TIMEOUT_ERROR) timedOut = true;
      ctx.emit(type, data);
      const delivery = emit(type, data);
      if (delivery && typeof delivery.then === "function") {
        deliveryBarrier = deliveryBarrier.then(() => delivery);
        deliveryBarrier.catch(() => {});
      }
      return delivery;
    };
    const value = await (engine === "native" ? runNativeTurn : runJsTurn)(input, forwardEvent, ctx.signal);
    await deliveryBarrier;
    if (value?.kind !== AGENT_RUN_OUTCOME.REJECTED && !ctx.signal.aborted && typeof checkpointSession === "function") {
      await checkpointSession({ engine, sessionKey: input.sessionKey, ownerId: ctx.ownerId, threadId: ctx.threadId, runId: ctx.runId });
    }
    if (value?.kind === AGENT_RUN_OUTCOME.REJECTED) ctx.markRejected();
    if ((ctx.signal.aborted || timedOut) && confirmRuntimeStopped) {
      let stopped = false;
      try { stopped = await confirmRuntimeStopped({ engine }); } catch { stopped = false; }
      if (!stopped) ctx.requireRecovery(`${engine} runtime stop not confirmed after ${timedOut ? "timeout" : "cancel"}`);
    }
    return value;
  }

  return Object.freeze({
    // Engine is resolved per turn, as the route did: a config change applies
    // to the next turn, never to one already running.
    engine() {
      return resolveEngine();
    },
    async runAgentTurn(options, emit, signal) {
      if (typeof emit !== "function") throw new TypeError("runAgentTurn: emit must be a function");
      if (!signal || typeof signal.addEventListener !== "function") {
        throw new TypeError("runAgentTurn: signal must be an AbortSignal");
      }
      const input = agentTurnInput(options);
      if (!admission) return dispatch(input, emit, signal);

      const supplied = options?.admissionIdentity;
      const anonymous = randomUUID();
      const identity = supplied || { ownerId: "anonymous", threadId: "anonymous", runId: anonymous, requestHash: anonymous };

      try {
        const admitted = await admission.execute(identity, (ctx) => admittedTurn(input, emit, ctx, supplied ? options?.checkpointSession : null), {
          signal,
          prepare: options?.prepare,
          retainEvents: Boolean(supplied?.retainEvents),
          onEvent: (event) => emit(event.type, event.data)
        });
        return admitted.value;
      } catch (error) {
        if (error instanceof AgentAdmissionError) {
          return {
            kind: AGENT_RUN_OUTCOME.REJECTED,
            status: error.status,
            body: { error: error.message, code: error.code }
          };
        }
        throw error;
      }
    }
  });
}
