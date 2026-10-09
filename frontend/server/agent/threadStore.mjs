// WP2 of piano.esecutivo.integrazione.opendots.v2.md (§6.1, §6.2): provisional
// thread/run store and validation of the client transcript.
//
// In memory, one process.  WP4 replaces the persistence with SQLite; the
// contract is already the final one:
//   - threadId and ds4SessionKey are server-minted and owner-scoped; the
//     browser only ever sees threadId;
//   - a run and its user message are accepted atomically (one synchronous
//     step: revision check, append, run record) and undone together if the
//     run is refused before anything reached the client;
//   - the client `messages` array is never the working context: known ids are
//     checked against the stored history (role, content, order), exactly one
//     new user message is accepted, everything else is refused.

import { randomUUID } from "node:crypto";
import { AgentAdmissionError, opaqueId } from "../agentAdmission.mjs";
import { hashRequest } from "../agentIdentity.mjs";

export const SERVER_SESSION_PREFIX = "ds4t_";

export const RUN_INPUT_LIMITS = Object.freeze({
  maxMessages: 200,
  maxMessageBytes: 64 * 1024,
  maxTotalBytes: 1024 * 1024,
  maxForwardedPropsBytes: 4096
});

const RUN_INPUT_KEYS = new Set(["threadId", "runId", "messages", "tools", "context", "state", "forwardedProps"]);
const MESSAGE_KEYS = new Set(["id", "role", "content"]);
const FORWARDED_DS4_KEYS = new Set(["baseRevision"]);
const KNOWN_ROLES = new Set(["user", "assistant", "system", "developer", "tool"]);

function invalid(message, code = "INVALID_RUN_INPUT") {
  return new AgentAdmissionError(code, message, 400);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function onlyKeys(value, allowed, where) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw invalid(`${where}: property "${key}" is not allowed`);
  }
}

// Schema and limits only; no store access.  Returns the parsed input and the
// request hash used for idempotency (plan §6.2: new message, base revision,
// authorized parameters).
export function parseRunInput(input, limits = RUN_INPUT_LIMITS) {
  if (!isPlainObject(input)) throw invalid("run input must be a JSON object");
  onlyKeys(input, RUN_INPUT_KEYS, "run input");
  const threadId = opaqueId(input.threadId, "threadId");
  const runId = opaqueId(input.runId, "runId");
  for (const name of ["tools", "context"]) {
    if (input[name] !== undefined && (!Array.isArray(input[name]) || input[name].length)) {
      throw invalid(`${name} must be empty in this version`);
    }
  }
  if (input.state !== undefined && (!isPlainObject(input.state) || Object.keys(input.state).length)) {
    throw invalid("state cannot carry session or permission changes");
  }

  let baseRevision;
  if (input.forwardedProps !== undefined) {
    if (!isPlainObject(input.forwardedProps)) throw invalid("forwardedProps must be an object");
    if (Buffer.byteLength(JSON.stringify(input.forwardedProps)) > limits.maxForwardedPropsBytes) {
      throw invalid("forwardedProps too large");
    }
    onlyKeys(input.forwardedProps, new Set(["ds4"]), "forwardedProps");
    const ds4 = input.forwardedProps.ds4;
    if (ds4 !== undefined) {
      if (!isPlainObject(ds4)) throw invalid("forwardedProps.ds4 must be an object");
      onlyKeys(ds4, FORWARDED_DS4_KEYS, "forwardedProps.ds4");
      baseRevision = ds4.baseRevision;
    }
  }
  if (!Number.isSafeInteger(baseRevision) || baseRevision < 0) {
    throw invalid("forwardedProps.ds4.baseRevision must be a non-negative integer");
  }

  if (!Array.isArray(input.messages) || input.messages.length < 1 || input.messages.length > limits.maxMessages) {
    throw invalid(`messages must hold 1-${limits.maxMessages} entries`);
  }
  const seen = new Set();
  let total = 0;
  const messages = input.messages.map((message, index) => {
    if (!isPlainObject(message)) throw invalid(`messages[${index}] must be an object`);
    onlyKeys(message, MESSAGE_KEYS, `messages[${index}]`);
    const id = opaqueId(message.id, `messages[${index}].id`);
    if (seen.has(id)) throw invalid(`messages[${index}].id is duplicated`);
    seen.add(id);
    if (!KNOWN_ROLES.has(message.role)) throw invalid(`messages[${index}].role is not supported`);
    if (typeof message.content !== "string") throw invalid(`messages[${index}].content must be a string`);
    const bytes = Buffer.byteLength(message.content);
    if (bytes > limits.maxMessageBytes) throw invalid(`messages[${index}].content too large`);
    total += bytes;
    return Object.freeze({ id, role: message.role, content: message.content });
  });
  if (total > limits.maxTotalBytes) throw invalid("messages too large");

  const candidate = messages[messages.length - 1];
  const requestHash = hashRequest({
    threadId, runId, baseRevision,
    message: { id: candidate.id, role: candidate.role, content: candidate.content }
  });
  return Object.freeze({ threadId, runId, baseRevision, messages: Object.freeze(messages), requestHash });
}

export function createThreadStore({ startSession = () => {}, mintId = () => randomUUID() } = {}) {
  const threads = new Map();

  function requireThread(ownerId, threadId) {
    const thread = threads.get(threadId);
    // Unknown and foreign threads answer the same: no existence leak.
    if (!thread || thread.ownerId !== ownerId) throw new AgentAdmissionError("THREAD_NOT_FOUND", "thread not found", 404);
    return thread;
  }

  function publicThread(thread) {
    return Object.freeze({
      threadId: thread.threadId,
      revision: thread.revision,
      messages: Object.freeze(thread.messages.map((m) => Object.freeze({ ...m })))
    });
  }

  // The stored history decides; the client array is only checked against it.
  function reconcile(thread, messages) {
    const positions = new Map(thread.messages.map((m, index) => [m.id, index]));
    const fresh = [];
    let previous = -1;
    for (const message of messages) {
      const position = positions.get(message.id);
      if (position === undefined) {
        fresh.push(message);
        continue;
      }
      if (fresh.length) throw new AgentAdmissionError("TRANSCRIPT_MISMATCH", "known messages must precede the new one");
      const stored = thread.messages[position];
      if (stored.role !== message.role || stored.content !== message.content) {
        throw new AgentAdmissionError("TRANSCRIPT_MISMATCH", `message ${message.id} differs from the stored history`);
      }
      if (previous >= 0 && position !== previous + 1) {
        throw new AgentAdmissionError("TRANSCRIPT_MISMATCH", "known messages must be a contiguous window of the history");
      }
      previous = position;
    }
    if (fresh.length === 0) {
      throw new AgentAdmissionError("MESSAGE_ALREADY_ACCEPTED", "the request carries no new user message");
    }
    if (fresh.length > 1) throw new AgentAdmissionError("TRANSCRIPT_MISMATCH", "only one new message is accepted per run", 400);
    const [message] = fresh;
    if (message.role !== "user") throw new AgentAdmissionError("TRANSCRIPT_MISMATCH", "the new message must have role user", 400);
    if (!message.content.trim()) throw invalid("the new user message is empty");
    return message;
  }

  return Object.freeze({
    createThread(ownerId) {
      opaqueId(ownerId, "ownerId");
      const threadId = `thr_${mintId()}`;
      const ds4SessionKey = `${SERVER_SESSION_PREFIX}${mintId()}`;
      const thread = { threadId, ownerId, ds4SessionKey, revision: 0, messages: [], runs: new Map() };
      startSession(ds4SessionKey);
      threads.set(threadId, thread);
      return publicThread(thread);
    },
    getThread(ownerId, threadId) {
      return publicThread(requireThread(ownerId, threadId));
    },
    // Internal: the binding never leaves the server.
    sessionKeyOf(ownerId, threadId) {
      return requireThread(ownerId, threadId).ds4SessionKey;
    },
    findRun(ownerId, threadId, runId) {
      const run = requireThread(ownerId, threadId).runs.get(runId);
      return run ? Object.freeze({ ...run }) : null;
    },
    reconcile(ownerId, threadId, messages) {
      return reconcile(requireThread(ownerId, threadId), messages);
    },
    // Atomic: revision check, message append and run record in one
    // synchronous step.  Returns the rollback for a run refused before
    // anything reached the client.
    acceptRun(ownerId, threadId, { runId, requestHash, message, baseRevision, frozen = {} }) {
      const thread = requireThread(ownerId, threadId);
      if (thread.runs.has(runId)) throw new AgentAdmissionError("RUN_ID_CONFLICT", "runId already registered");
      if (thread.revision !== baseRevision) {
        throw new AgentAdmissionError("REVISION_CONFLICT", `baseRevision ${baseRevision} is stale (current ${thread.revision})`);
      }
      if (thread.messages.some((m) => m.id === message.id)) {
        throw new AgentAdmissionError("MESSAGE_ALREADY_ACCEPTED", "message id already in the thread");
      }
      const stored = Object.freeze({ id: message.id, role: "user", content: message.content, runId });
      thread.messages.push(stored);
      thread.revision++;
      const acceptedRevision = thread.revision;
      thread.runs.set(runId, Object.freeze({
        runId, requestHash, userMessageId: message.id, baseRevision, acceptedRevision, frozen: Object.freeze({ ...frozen })
      }));
      return () => {
        thread.runs.delete(runId);
        const index = thread.messages.indexOf(stored);
        if (index >= 0) thread.messages.splice(index, 1);
        if (thread.revision === acceptedRevision) thread.revision = baseRevision;
      };
    },
    // Assistant output of the run, appended after the terminal (projection is
    // WP3/WP4; here only to keep revisions honest for the next run).
    appendAssistant(ownerId, threadId, { id, content, runId }) {
      const thread = requireThread(ownerId, threadId);
      thread.messages.push(Object.freeze({ id: opaqueId(id, "message id"), role: "assistant", content: String(content), runId }));
      thread.revision++;
      return thread.revision;
    }
  });
}
