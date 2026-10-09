// WP2 of piano.esecutivo.integrazione.opendots.v2.md (§6.2, §6.3, §7): the
// ingress contract for identified runs on server-owned threads, used by the
// AG-UI gateway in WP3.  Transport-free: the gateway maps `emit` to its
// stream; here only the order of checks and the run lifecycle.
//
// Order (plan §6.2):
//   1. schema and limits                          (parseRunInput)
//   2. thread ownership; lookup of an existing run and request-hash compare
//      -> identical retry joins/replays it, even if the revision moved or the
//         profile changed since; a different hash is 409 RUN_ID_CONFLICT
//   3. new run only: transcript reconciliation and baseRevision
//   4. admission (busy 409) and, under the lease, atomic accept of the user
//      message and the run, with the profile frozen for the run
//   5. the turn (AgentRunService, the single loop)
//
// Plus the owner-scoped run endpoints: status and cancel.

import { AgentAdmissionError } from "../agentAdmission.mjs";
import { parseRunInput } from "./threadStore.mjs";

// The native engine stays legacy-only until its own gate (plan §5, §12 WP2):
// a new run on a native profile is refused, never silently switched to JS.
export function createRunIngress({ admission, store, service, freezeProfile = () => ({}), resolveEngine = () => "js", checkpointSession = null }) {
  for (const [name, value] of Object.entries({ admission, store, service })) {
    if (!value) throw new TypeError(`createRunIngress: ${name} is required`);
  }

  async function startRun({ ownerId, input, emit, signal }) {
    const parsed = parseRunInput(input);
    const { threadId, runId, requestHash, baseRevision, messages } = parsed;
    const sessionKey = store.sessionKeyOf(ownerId, threadId);
    const identity = { ownerId, threadId, runId, requestHash, retainEvents: true };

    const existing = store.findRun(ownerId, threadId, runId);
    if (existing && existing.requestHash !== requestHash) {
      throw new AgentAdmissionError("RUN_ID_CONFLICT", "runId already belongs to a different request");
    }
    let prepare;
    let body;
    let checkpointHook = null;
    if (existing) {
      // Retry of an accepted run: no reconciliation, no revision check, no
      // new append.  The admission joins or replays it; a run retired from the
      // live registry is reported, never dispatched again.
      try {
        admission.lookup(identity);
      } catch {
        throw new AgentAdmissionError("RUN_REPLAY_UNAVAILABLE", "run already accepted; its events are no longer replayable");
      }
      const dot = existing.frozen?.dot ?? null;
      body = { message: messages[messages.length - 1].content, request: dot?.profile ?? {}, dot };
    } else {
      if (resolveEngine() === "native") {
        throw new AgentAdmissionError("CAPABILITY_UNAVAILABLE", "the native engine is available only in the legacy UI", 409);
      }
      const message = store.reconcile(ownerId, threadId, messages);
      const current = store.getThread(ownerId, threadId).revision;
      if (current !== baseRevision) {
        throw new AgentAdmissionError("REVISION_CONFLICT", `baseRevision ${baseRevision} is stale (current ${current})`);
      }
      const dot = typeof store.resolveThreadDot === "function" ? store.resolveThreadDot(ownerId, threadId) : null;
      body = { message: message.content, request: dot?.profile ?? {}, dot };
      const frozenProfile = freezeProfile(dot);
      const frozen = { ...frozenProfile, model: dot?.profile?.model ?? frozenProfile.model ?? null, dot };
      prepare = () => store.acceptRun(ownerId, threadId, {
        runId, requestHash, message, baseRevision, frozen
      });
      if (typeof checkpointSession === "function") {
        checkpointHook = () => checkpointSession({ ownerId, threadId, runId, sessionKey, frozen });
      }
    }

    const outcome = await service.runAgentTurn({
      body,
      sessionKey,
      admissionIdentity: identity,
      prepare,
      checkpointSession: checkpointHook
    }, emit, signal);
    let run = null;
    try { run = admission.lookup(identity); } catch { run = null; }
    return Object.freeze({ outcome, run });
  }

  function runStatus({ ownerId, threadId, runId }) {
    try {
      return admission.lookup({ ownerId, threadId, runId });
    } catch (error) {
      if (error.code !== "RUN_NOT_FOUND") throw error;
      // Pruned from the live registry: the store still knows it.
      const stored = store.findRun(ownerId, threadId, runId);
      if (!stored) throw error;
      return Object.freeze({ ownerId, threadId, runId, state: "unknown_retired", replayable: false });
    }
  }

  function cancelRun({ ownerId, threadId, runId }) {
    return admission.cancel({ ownerId, threadId, runId }, "cancelled by owner");
  }

  return Object.freeze({ startRun, runStatus, cancelRun });
}

// Express handlers for GET /api/runs/:runId and POST /api/runs/:runId/cancel.
// threadId travels in the query/body: runs are scoped by owner and thread.
export function createRunRoutes({ ingress, identity }) {
  const fail = (res, error) => {
    if (error instanceof AgentAdmissionError) return res.status(error.status).json({ error: error.message, code: error.code });
    throw error;
  };
  return Object.freeze({
    status(req, res) {
      try {
        const ownerId = identity.ownerOf(req, res);
        const run = ingress.runStatus({ ownerId, threadId: String(req.query?.threadId ?? ""), runId: req.params.runId });
        return res.json({ run });
      } catch (error) {
        return fail(res, error);
      }
    },
    cancel(req, res) {
      try {
        identity.requireOrigin(req);
        const ownerId = identity.ownerOf(req, res);
        const result = ingress.cancelRun({ ownerId, threadId: String(req.body?.threadId ?? ""), runId: req.params.runId });
        return res.status(result.terminal ? 200 : 202).json(result);
      } catch (error) {
        return fail(res, error);
      }
    }
  });
}
