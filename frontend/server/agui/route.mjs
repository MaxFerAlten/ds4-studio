// WP3 of piano.esecutivo.integrazione.opendots.v2.md (§6.2, §6.3, §8.1, §11,
// ADR-002): the AG-UI POC gateway.
//
//   GET  /api/agui/capability           what the new UI may do; answered also
//                                       with the flag off (enabled:false)
//   POST /api/agui/thread               the owner's thread (created on first call,
//                                       reopened from SQLite when enabled)
//   POST /api/agui/agent                RunAgentInput -> runIngress.startRun ->
//                                       AgentRunService (the one DS4 loop) ->
//                                       AG-UI SSE
//   GET  /api/agui/runs/:runId/events   persistent replay when enabled, otherwise
//                                       the bounded in-memory recorder
//
// Status and cancel stay the WP2 owner-scoped GET /api/runs/:runId and
// POST /api/runs/:runId/cancel: the gateway has no cancel authority of its own.
//
// Order: local-only check -> flag/SDK -> Origin -> AG-UI schema
// (RunAgentInputSchema) -> DS4 projection -> startRun (WP2 order: hash,
// reconciliation, baseRevision, admission).  Every refusal before the turn is
// HTTP JSON; once RUN_STARTED is written, the only way out is the single
// terminal of the mapper.  Every event is validated with EventSchemas before
// encoding (ADR-002.5); SSE only (ADR-002.9).

import { createHash } from "node:crypto";
import { AgentAdmissionError } from "../agentAdmission.mjs";
import { listDotToolOptions } from "../agent/dotStore.mjs";
import { AGENT_RUN_OUTCOME } from "../agent/runService.mjs";
import { parseRunInput } from "../agent/threadStore.mjs";
import { createDurablePublicEventWriter } from "../agent/durablePublicEventWriter.mjs";
import { AGUI_MAPPER_VERSION, createAguiMapper } from "./mapper.mjs";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);
const RUN_INPUT_KEYS = new Set([
  "threadId", "runId", "parentRunId", "state", "messages", "tools", "context", "forwardedProps", "protocolVersion", "resume"
]);
const PUBLIC_ROLES = new Set(["user", "assistant"]);

class GatewayError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function hostnameOf(hostHeader) {
  const host = String(hostHeader || "").trim().toLowerCase();
  if (host.startsWith("[")) return host.slice(1, host.indexOf("]"));
  return host.replace(/:\d+$/, "");
}

// Loopback peer and loopback Host: no LAN client, and no DNS-rebound name
// pointing a remote page at 127.0.0.1 (plan §11; LAN needs its own opt-in).
export function isLoopbackRequest(req) {
  const address = String(req.socket?.remoteAddress || "");
  const peer = address === "::1" || /^(?:::ffff:)?127\./.test(address);
  return peer && LOOPBACK_HOSTS.has(hostnameOf(req.headers?.host));
}

// AG-UI RunAgentInput (already schema-checked) -> the DS4 run input of
// runIngress.  Only public user/assistant text travels; tool messages, tool
// calls, resume and parent runs are refused instead of dropped, so the server
// never guesses what the client meant.
export function projectRunInput(raw, parsed) {
  for (const key of Object.keys(raw)) {
    if (!RUN_INPUT_KEYS.has(key)) throw new GatewayError(400, "INVALID_RUN_INPUT", `run input: property "${key}" is not allowed`);
  }
  if (parsed.protocolVersion !== undefined && !/^1\.0(?:\.|$)/.test(String(parsed.protocolVersion))) {
    throw new GatewayError(400, "PROTOCOL_VERSION_UNSUPPORTED", `protocolVersion ${parsed.protocolVersion} is not 1.0`);
  }
  if (Array.isArray(parsed.resume) && parsed.resume.length) {
    throw new GatewayError(400, "RESUME_UNSUPPORTED", "interrupt/resume is disabled until WP7");
  }
  if (parsed.parentRunId !== undefined) throw new GatewayError(400, "PARENT_RUN_UNSUPPORTED", "parentRunId is not supported");
  const messages = parsed.messages.map((message, index) => {
    if (!PUBLIC_ROLES.has(message.role)) throw new GatewayError(400, "UNSUPPORTED_MESSAGE", `messages[${index}]: role ${message.role} is not accepted`);
    if (Array.isArray(message.toolCalls) && message.toolCalls.length) {
      throw new GatewayError(400, "UNSUPPORTED_MESSAGE", `messages[${index}]: tool calls are server-owned`);
    }
    if (typeof message.content !== "string") throw new GatewayError(400, "UNSUPPORTED_MESSAGE", `messages[${index}]: content must be text`);
    return { id: message.id, role: message.role, content: message.content };
  });
  const out = { threadId: parsed.threadId, runId: parsed.runId, messages, tools: parsed.tools, context: parsed.context };
  if (parsed.state !== undefined && parsed.state !== null) out.state = parsed.state;
  if (parsed.forwardedProps !== undefined) out.forwardedProps = parsed.forwardedProps;
  return out;
}

export function createAguiGateway({
  flags,
  sdk = null,
  sdkError = null,
  ingress,
  store,
  identity,
  recorder,
  engine = () => "js",
  keepaliveMs = 15000,
  maxBufferedBytes = 1024 * 1024
}) {
  for (const [name, value] of Object.entries({ flags, ingress, store, identity, recorder })) {
    if (!value) throw new TypeError(`createAguiGateway: ${name} is required`);
  }
  const threadOfOwner = new Map();

  if (flags.durableHistory && typeof store.appendPublicEvents !== "function") {
    throw new TypeError("durable history requires a persistent thread store");
  }

  function unavailableReason() {
    if (!flags.aguiEnabled) return "AGUI_DISABLED";
    if (!sdk) return sdkError?.code || "AGUI_SDK_MISSING";
    if (engine() !== "js") return "CAPABILITY_UNAVAILABLE";
    return null;
  }

  function fail(res, error) {
    if (error instanceof GatewayError || error instanceof AgentAdmissionError) {
      return res.status(error.status).json({ error: error.message, code: error.code });
    }
    throw error;
  }

  // Shared preamble of the gateway routes; capability has its own.
  function guard(req, { mutating }) {
    if (!isLoopbackRequest(req)) throw new GatewayError(403, "AGUI_LOCAL_ONLY", "the AG-UI POC accepts loopback requests only");
    const reason = unavailableReason();
    if (reason === "AGUI_DISABLED") throw new GatewayError(404, reason, "the AG-UI POC is disabled");
    if (reason === "CAPABILITY_UNAVAILABLE") throw new GatewayError(409, reason, "the native engine is available only in the legacy UI");
    if (reason) throw new GatewayError(503, reason, sdkError?.message || "AG-UI SDK not available");
    if (mutating) identity.requireOrigin(req);
  }

  function publicThread(thread) {
    const result = {
      threadId: thread.threadId,
      title: thread.title || "",
      revision: thread.revision,
      archivedAt: thread.archivedAt ?? null,
      createdAt: thread.createdAt,
      preview: thread.preview || "",
      previousCursor: thread.previousCursor ?? null
    };
    if (Array.isArray(thread.messages)) result.messages = thread.messages.map((m) => ({ id: m.id, seq: m.seq, role: m.role, content: m.content }));
    return result;
  }

  function capability(req, res) {
    if (!isLoopbackRequest(req)) return res.status(403).json({ error: "loopback only", code: "AGUI_LOCAL_ONLY" });
    const reason = unavailableReason();
    return res.json({
      enabled: reason === null,
      reason,
      protocolVersion: "1.0",
      mapperVersion: AGUI_MAPPER_VERSION,
      engine: engine(),
      threads: flags.durableHistory ? "local" : "single",
      nativeMultiThread: flags.nativeMultiThread === true,
      durableHistory: flags.durableHistory === true,
      localOnly: true
    });
  }

  function thread(req, res) {
    try {
      guard(req, { mutating: true });
      const ownerId = identity.ownerOf(req, res);
      const known = threadOfOwner.get(ownerId) ?? store.findThreadForOwner?.(ownerId)?.threadId;
      if (known) return res.json(publicThread(typeof store.getThreadPage === "function" ? store.getThreadPage(ownerId, known) : store.getThread(ownerId, known)));
      const created = store.createThread(ownerId);
      threadOfOwner.set(ownerId, created.threadId);
      return res.json(publicThread(created));
    } catch (error) {
      return fail(res, error);
    }
  }

  function listThreads(req, res) {
    try {
      guard(req, { mutating: false });
      const ownerId = identity.ownerOf(req, res);
      if (typeof store.listThreads !== "function") throw new GatewayError(409, "THREAD_LIBRARY_UNAVAILABLE", "durable local threads are not enabled");
      const limit = req.query?.limit === undefined ? 50 : Number(req.query.limit);
      const after = req.query?.after || null;
      const includeArchived = req.query?.includeArchived === "true";
      const page = store.listThreads(ownerId, { after, limit, includeArchived });
      return res.json({ ...page, threads: page.threads.map(publicThread) });
    } catch (error) { return fail(res, error); }
  }

  function createThread(req, res) {
    try {
      guard(req, { mutating: true });
      const ownerId = identity.ownerOf(req, res);
      if (typeof store.listThreads !== "function") throw new GatewayError(409, "THREAD_LIBRARY_UNAVAILABLE", "durable local threads are not enabled");
      const title = typeof req.body?.title === "string" ? req.body.title : "";
      const created = store.createThread(ownerId, { title });
      threadOfOwner.set(ownerId, created.threadId);
      return res.status(201).json(publicThread(created));
    } catch (error) { return fail(res, error); }
  }

  function getThread(req, res) {
    try {
      guard(req, { mutating: false });
      const ownerId = identity.ownerOf(req, res);
      const threadId = String(req.params.threadId || "");
      if (req.query?.limit !== undefined && typeof store.getThreadPage === "function") {
        const rawBefore = req.query.before;
        const before = rawBefore === undefined ? null : Number(rawBefore);
        const limit = Number(req.query.limit);
        return res.json(publicThread(store.getThreadPage(ownerId, threadId, { before, limit })));
      }
      return res.json(publicThread(store.getThread(ownerId, threadId)));
    } catch (error) { return fail(res, error); }
  }

  function archiveThread(req, res) {
    try {
      guard(req, { mutating: true });
      const ownerId = identity.ownerOf(req, res);
      if (typeof store.archiveThread !== "function") throw new GatewayError(409, "THREAD_LIBRARY_UNAVAILABLE", "durable local threads are not enabled");
      return res.json(publicThread(store.archiveThread(ownerId, String(req.params.threadId || ""))));
    } catch (error) { return fail(res, error); }
  }

  function deleteThread(req, res) {
    try {
      guard(req, { mutating: true });
      const ownerId = identity.ownerOf(req, res);
      if (typeof store.deleteThread !== "function") throw new GatewayError(409, "THREAD_LIBRARY_UNAVAILABLE", "durable local threads are not enabled");
      return res.json(store.deleteThread(ownerId, String(req.params.threadId || "")));
    } catch (error) { return fail(res, error); }
  }

  function exportThread(req, res) {
    try {
      guard(req, { mutating: false });
      const ownerId = identity.ownerOf(req, res);
      if (typeof store.exportThread !== "function") throw new GatewayError(409, "THREAD_LIBRARY_UNAVAILABLE", "durable local threads are not enabled");
      return res.json(store.exportThread(ownerId, String(req.params.threadId || "")));
    } catch (error) { return fail(res, error); }
  }

  function importLegacy(req, res) {
    try {
      guard(req, { mutating: true });
      const ownerId = identity.ownerOf(req, res);
      if (typeof store.importLegacyThread !== "function") throw new GatewayError(409, "THREAD_LIBRARY_UNAVAILABLE", "durable local threads are not enabled");
      if (!req.body || typeof req.body !== "object" || Array.isArray(req.body) || !Array.isArray(req.body.messages)) {
        throw new GatewayError(400, "INVALID_LEGACY_IMPORT", "ds4.session must contain a messages array");
      }
      const rawMessages = Array.isArray(req.body?.messages) ? req.body.messages : [];
      if (Buffer.byteLength(JSON.stringify(req.body ?? {})) > 1024 * 1024) throw new GatewayError(413, "LEGACY_IMPORT_TOO_LARGE", "legacy import exceeds 1 MiB");
      if (rawMessages.length > 200) throw new GatewayError(413, "LEGACY_IMPORT_TOO_LARGE", "legacy import exceeds 200 messages");
      const warnings = [];
      const messages = [];
      for (const [index, message] of rawMessages.entries()) {
        if (!message || !["user", "assistant"].includes(message.role)) { warnings.push(`messaggio ${index + 1}: ruolo o contenuto tool escluso`); continue; }
        let content = typeof message.content === "string" ? message.content : "";
        if (!content && Array.isArray(message.content)) {
          content = message.content.filter((part) => part?.type === "text" && typeof part.text === "string").map((part) => part.text).join("");
          if (message.content.some((part) => part?.type !== "text")) warnings.push(`messaggio ${index + 1}: parti non testuali escluse`);
        }
        if (!content) { warnings.push(`messaggio ${index + 1}: nessun testo importabile`); continue; }
        const originalId = typeof message.id === "string" ? message.id : `legacy-${index}`;
        const id = `msg_${createHash("sha256").update(`${index}:${originalId}`).digest("hex").slice(0, 24)}`;
        messages.push({ id, role: message.role, content: content.slice(0, 64 * 1024) });
      }
      const legacyTitle = typeof req.body.title === "string" ? req.body.title : req.body.fileName;
      const title = typeof legacyTitle === "string" ? legacyTitle.slice(0, 240) : "Importazione ds4.session";
      const result = store.importLegacyThread(ownerId, { source: "ds4.session", title, messages });
      threadOfOwner.set(ownerId, result.thread.threadId);
      return res.status(result.imported ? 201 : 200).json({ ...result, warnings });
    } catch (error) { return fail(res, error); }
  }

  function listPages(req, res) {
    try {
      guard(req, { mutating: false });
      const ownerId = identity.ownerOf(req, res);
      if (typeof store.listPages !== "function") throw new GatewayError(409, "WORKSPACE_PAGES_UNAVAILABLE", "local durable threads are not enabled");
      const threadId = String(req.query?.threadId ?? "");
      if (!threadId) throw new GatewayError(400, "THREAD_REQUIRED", "threadId is required");
      return res.json({ pages: store.listPages(ownerId), drafts: store.listPageDrafts(ownerId, threadId) });
    } catch (error) { return fail(res, error); }
  }

  function getPage(req, res) {
    try {
      guard(req, { mutating: false });
      const ownerId = identity.ownerOf(req, res);
      if (typeof store.getPage !== "function") throw new GatewayError(409, "WORKSPACE_PAGES_UNAVAILABLE", "local durable threads are not enabled");
      return res.json(store.getPage(ownerId, String(req.params.pageId || "")));
    } catch (error) { return fail(res, error); }
  }

  function proposePageDraft(req, res) {
    try {
      guard(req, { mutating: true });
      const ownerId = identity.ownerOf(req, res);
      if (typeof store.proposePageDraft !== "function") throw new GatewayError(409, "WORKSPACE_PAGES_UNAVAILABLE", "local durable threads are not enabled");
      const body = req.body ?? {};
      const draft = store.proposePageDraft(ownerId, String(body.threadId || ""), {
        pageId: body.pageId ?? null, baseRevision: body.baseRevision ?? 0,
        action: body.action ?? "upsert", slug: body.slug ?? "", title: body.title ?? "", content: body.content ?? ""
      });
      return res.status(201).json(draft);
    } catch (error) { return fail(res, error); }
  }

  function decidePageDraft(req, res) {
    try {
      guard(req, { mutating: true });
      const ownerId = identity.ownerOf(req, res);
      if (typeof store.decidePageDraft !== "function") throw new GatewayError(409, "WORKSPACE_PAGES_UNAVAILABLE", "local durable threads are not enabled");
      const body = req.body ?? {};
      return res.json(store.decidePageDraft(ownerId, String(body.threadId || ""), String(req.params.draftId || ""), {
        decision: body.decision, candidateHash: body.candidateHash
      }));
    } catch (error) { return fail(res, error); }
  }

  function listDots(req, res) {
    try {
      guard(req, { mutating: false });
      const ownerId = identity.ownerOf(req, res);
      if (typeof store.listDots !== "function") throw new GatewayError(409, "DOTS_UNAVAILABLE", "durable local workspaces are not enabled");
      const threadId = String(req.query?.threadId ?? "");
      return res.json({ dots: store.listDots(ownerId), tools: listDotToolOptions(), binding: threadId ? store.resolveThreadDot(ownerId, threadId) : null });
    } catch (error) { return fail(res, error); }
  }

  function createDot(req, res) {
    try {
      guard(req, { mutating: true });
      const ownerId = identity.ownerOf(req, res);
      if (typeof store.createDot !== "function") throw new GatewayError(409, "DOTS_UNAVAILABLE", "durable local workspaces are not enabled");
      if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) throw new GatewayError(400, "INVALID_DOT", "Dot must be an object");
      const { name, ...preset } = req.body;
      return res.status(201).json(store.createDot(ownerId, { name, ...preset }));
    } catch (error) { return fail(res, error); }
  }

  function updateDot(req, res) {
    try {
      guard(req, { mutating: true });
      const ownerId = identity.ownerOf(req, res);
      if (typeof store.updateDot !== "function") throw new GatewayError(409, "DOTS_UNAVAILABLE", "durable local workspaces are not enabled");
      return res.json(store.updateDot(ownerId, String(req.params.dotId || ""), req.body ?? {}));
    } catch (error) { return fail(res, error); }
  }

  function bindThreadDot(req, res) {
    try {
      guard(req, { mutating: true });
      const ownerId = identity.ownerOf(req, res);
      if (typeof store.bindThreadDot !== "function") throw new GatewayError(409, "DOTS_UNAVAILABLE", "durable local workspaces are not enabled");
      const body = req.body ?? {};
      return res.json({ binding: store.bindThreadDot(ownerId, String(req.params.threadId || ""), body.dotId == null ? null : String(body.dotId), body.revision) });
    } catch (error) { return fail(res, error); }
  }

  function runEvents(req, res) {
    try {
      guard(req, { mutating: false });
      const ownerId = identity.ownerOf(req, res);
      if (flags.durableHistory) {
        const threadId = String(req.query?.threadId ?? "");
        const rawAfter = req.query?.after;
        const after = rawAfter === undefined ? 0 : Number(rawAfter);
        if (!Number.isSafeInteger(after) || after < 0) throw new GatewayError(400, "INVALID_REPLAY_CURSOR", "after must be a non-negative integer cursor");
        if (!store.findRun(ownerId, threadId, req.params.runId)) return res.status(404).json({ error: "run not found", code: "RUN_NOT_FOUND" });
        const events = store.replayPublicEvents(ownerId, threadId, { after, runId: req.params.runId });
        return res.json({ runId: req.params.runId, cursor: events.at(-1)?.cursor ?? after, events: events.map(({ cursor, mapperVersion, payload }) => ({ cursor, mapperVersion, event: payload })) });
      }
      const entry = recorder.get(ownerId, String(req.query?.threadId ?? ""), req.params.runId);
      if (!entry) return res.status(404).json({ error: "run not found", code: "RUN_NOT_FOUND" });
      return res.json(entry);
    } catch (error) {
      return fail(res, error);
    }
  }

  async function agent(req, res) {
    let input;
    let ownerId;
    try {
      guard(req, { mutating: true });
      const raw = req.body;
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new GatewayError(400, "INVALID_RUN_INPUT", "run input must be a JSON object");
      const parsed = sdk.RunAgentInputSchema.safeParse(raw);
      if (!parsed.success) {
        throw new GatewayError(400, "INVALID_RUN_INPUT", `RunAgentInput schema: ${parsed.error.issues.length} issue(s), first at ${parsed.error.issues[0]?.path?.join(".") || "(root)"}`);
      }
      input = projectRunInput(raw, parsed.data);
      ownerId = identity.ownerOf(req, res);
    } catch (error) {
      return fail(res, error);
    }

    const { threadId, runId } = input;
    const { EventType, EventSchemas, EventEncoder } = sdk;
    const encoder = new EventEncoder({ accept: "text/event-stream" });
    let replayOnly = false;
    if (flags.durableHistory) {
      try {
        const parsed = parseRunInput(input);
        const existing = store.findRun(ownerId, threadId, runId);
        if (existing) {
          if (existing.requestHash !== parsed.requestHash) throw new GatewayError(409, "RUN_ID_CONFLICT", "runId already belongs to a different request");
          if (["finished", "cancelled", "failed"].includes(existing.state)) {
            const events = store.replayPublicEvents(ownerId, threadId, { after: 0, runId });
            res.writeHead(200, { "Content-Type": encoder.getContentType(), "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" });
            for (const item of events) {
              EventSchemas.parse(item.payload);
              res.write(encoder.encodeSSE(item.payload));
            }
            res.end();
            return undefined;
          }
          // A live duplicate joins the in-memory admission stream. It must not
          // append a second copy of those public events to durable history.
          replayOnly = true;
        }
      } catch (error) {
        return fail(res, error);
      }
    }
    const mapper = createAguiMapper({ EventType, threadId, runId });
    const cancel = new AbortController();
    let opened = false;
    let recording = null;
    let keepalive = null;
    let failure = null;
    let terminalWritten = false;
    let publishBarrier = Promise.resolve();

    const durableWriter = flags.durableHistory && !replayOnly ? createDurablePublicEventWriter({
      store, ownerId, threadId, runId, mapperVersion: AGUI_MAPPER_VERSION,
      deliver: (event) => deliver(event)
    }) : null;

    const writable = () => !res.writableEnded && !res.destroyed;
    const deliver = (event) => {
      EventSchemas.parse(event);
      recording.record(event);
      if (event.type === EventType.RUN_FINISHED || event.type === EventType.RUN_ERROR) terminalWritten = true;
      if (!writable()) return;
      res.write(encoder.encodeSSE(event));
      // A consumer that does not drain is cut off: the run is cancelled
      // (plan §8.2), never buffered without bound.
      if (res.writableLength > maxBufferedBytes) cancel.abort("slow_consumer");
    };
    const write = (events) => {
      for (const event of events) deliver(event);
    };
    const publish = (events) => {
      if (!durableWriter) return write(events);
      const pending = [];
      for (const event of events) {
        EventSchemas.parse(event);
        pending.push(durableWriter.enqueue(event));
      }
      if (pending.length) {
        publishBarrier = publishBarrier.then(() => Promise.all(pending)).catch((error) => {
          failure = { code: error.code || "LOCAL_STORAGE_FAILED", message: error.message };
          cancel.abort("storage_failed");
          throw error;
        });
        publishBarrier.catch(() => {});
      }
      return publishBarrier;
    };
    const open = () => {
      if (opened) return;
      opened = true;
      res.writeHead(200, {
        "Content-Type": encoder.getContentType(),
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no"
      });
      // Losing the stream cancels the run, as in the baseline (plan §7).
      res.on("close", () => { if (!res.writableEnded) cancel.abort("client_disconnect"); });
      keepalive = setInterval(() => { if (writable()) res.write(": keepalive\n\n"); }, keepaliveMs);
      keepalive.unref?.();
      recording = recorder.begin(ownerId, threadId, runId);
      publish(mapper.start());
    };
    const emit = (type, data) => {
      if (failure) return;
      try {
        open();
        publish(mapper.map(type, data));
        return publishBarrier;
      } catch (error) {
        // A mapper/schema defect stops the turn; the terminal reports it.
        failure = { code: "AGUI_MAPPING_FAILED", message: error.message };
        cancel.abort("mapping_failed");
      }
    };

    let result = null;
    try {
      result = await ingress.startRun({ ownerId, input, emit, signal: cancel.signal });
    } catch (error) {
      if (!opened) {
        clearInterval(keepalive);
        return fail(res, error);
      }
      failure ??= { code: error.code || "DS4_INTERNAL_ERROR", message: error.message };
    }

    const outcome = result?.outcome;
    let commandOk = null;
    try {
      if (outcome?.kind === AGENT_RUN_OUTCOME.REJECTED && !opened) {
        return res.status(outcome.status).json(outcome.body);
      }
      open();
      if (outcome?.kind === AGENT_RUN_OUTCOME.REJECTED) {
        failure ??= { code: outcome.body?.code || "DS4_REJECTED", message: outcome.body?.error || "run rejected" };
      } else if (outcome?.kind === AGENT_RUN_OUTCOME.COMMAND) {
        for (const item of outcome.events || []) emit(item.event, item.data);
        commandOk = outcome.ok !== false;
      } else if (outcome?.kind === AGENT_RUN_OUTCOME.NATIVE_STREAMED) {
        failure ??= { code: "CAPABILITY_UNAVAILABLE", message: "native stream is not mapped by the AG-UI POC" };
      }

      const run = result?.run;
      const cancelled = !failure && (run?.state === "cancelled" || run?.cancelRequested === true ||
        (cancel.signal.aborted && cancel.signal.reason !== "mapping_failed"));

      // Public projection of what this run published, in the same microtask
      // chain as the end of the turn (no I/O can interleave): the next run's
      // baseRevision and transcript check see it.  A replayed duplicate finds
      // its messages already there.
      let revision = null;
      if (store.findRun(ownerId, threadId, runId)) {
        if (durableWriter) {
          revision = store.revisionAfterRun(ownerId, threadId, runId);
        } else {
          const present = new Set(store.getThread(ownerId, threadId).messages.map((m) => m.id));
          for (const message of mapper.messages()) {
            if (!present.has(message.id)) store.appendAssistant(ownerId, threadId, { ...message, runId });
          }
          revision = store.getThread(ownerId, threadId).revision;
        }
      }
      const before = revision === null ? [] : [{ type: EventType.CUSTOM, name: "ds4.thread", value: { v: AGUI_MAPPER_VERSION, threadId, revision } }];
      publish(mapper.finish({ cancelled, failure, commandOk }, before));
      if (durableWriter) await durableWriter.close();
    } catch (error) {
      // Last resort: a defect after the stream opened still ends in one
      // schema-valid terminal, never in HTML or a second terminal.
      if (!opened) throw error;
      if (!terminalWritten && writable()) {
        res.write(encoder.encodeSSE({ type: EventType.RUN_ERROR, message: String(error.message).slice(0, 512), code: "AGUI_MAPPING_FAILED" }));
      }
    } finally {
      clearInterval(keepalive);
      if (durableWriter && !durableWriter.failed) {
        try { await durableWriter.close(); } catch {}
      }
      if (opened && !res.writableEnded) res.end();
    }
    return undefined;
  }

  return Object.freeze({ capability, thread, listThreads, createThread, getThread, archiveThread, deleteThread, exportThread, importLegacy, listPages, getPage, proposePageDraft, decidePageDraft, listDots, createDot, updateDot, bindThreadDot, agent, runEvents });
}

// Mounts the routes.  The capability route is always there; the others
// answer 404 AGUI_DISABLED while the flag is off.
export function mountAguiRoutes(app, gateway, { asyncHandler = (fn) => fn } = {}) {
  app.get("/api/agui/capability", gateway.capability);
  app.post("/api/agui/thread", gateway.thread);
  app.get("/api/agui/threads", gateway.listThreads);
  app.post("/api/agui/threads", gateway.createThread);
  app.get("/api/agui/threads/:threadId", gateway.getThread);
  app.post("/api/agui/threads/:threadId/archive", gateway.archiveThread);
  app.delete("/api/agui/threads/:threadId", gateway.deleteThread);
  app.get("/api/agui/threads/:threadId/export", gateway.exportThread);
  app.post("/api/agui/import/legacy", gateway.importLegacy);
  app.get("/api/agui/pages", gateway.listPages);
  app.get("/api/agui/pages/:pageId", gateway.getPage);
  app.post("/api/agui/pages/drafts", gateway.proposePageDraft);
  app.post("/api/agui/pages/drafts/:draftId/decision", gateway.decidePageDraft);
  app.get("/api/agui/dots", gateway.listDots);
  app.post("/api/agui/dots", gateway.createDot);
  app.put("/api/agui/dots/:dotId", gateway.updateDot);
  app.put("/api/agui/threads/:threadId/dot", gateway.bindThreadDot);
  app.post("/api/agui/agent", asyncHandler(gateway.agent));
  app.get("/api/agui/runs/:runId/events", gateway.runEvents);
}
