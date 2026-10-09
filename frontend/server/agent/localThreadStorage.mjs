// WP4 durable local thread/run store. Uses Node's built-in synchronous SQLite;
// it is opt-in and requires the online backup API from the WP0 ADR.
import { chmodSync, mkdirSync, statSync } from "node:fs";
import { dirname } from "node:path";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { AgentAdmissionError, opaqueId } from "../agentAdmission.mjs";
import { SERVER_SESSION_PREFIX, RUN_INPUT_LIMITS } from "./threadStore.mjs";
import { createWorkspacePageStore, migrateWorkspacePageSchema } from "./workspacePageStore.mjs";
import { createDotStore, migrateDotSchema } from "./dotStore.mjs";

export const LOCAL_THREAD_SCHEMA_VERSION = 6;
export const LOCAL_THREAD_EVENT_LIMITS = Object.freeze({ batchBytes: 4096, batchDelayMs: 50, maxBufferedBytes: 1024 * 1024 });
const RUN_STATES = new Set(["accepted", "running", "cancelling", "finished", "cancelled", "failed", "interrupted_recovery"]);

export async function probeNodeSqlite() {
  try {
    const sqlite = await import("node:sqlite");
    if (typeof sqlite.DatabaseSync !== "function" || typeof sqlite.backup !== "function") {
      return Object.freeze({ ok: false, code: "LOCAL_THREADS_REQUIRES_NODE_SQLITE", error: `${process.version}: node:sqlite backup API unavailable` });
    }
    return Object.freeze({ ok: true, sqlite });
  } catch (error) {
    return Object.freeze({ ok: false, code: "LOCAL_THREADS_REQUIRES_NODE_SQLITE", error: `${process.version}: ${error.code || error.message}` });
  }
}

function transaction(db, operation) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const value = operation();
    db.exec("COMMIT");
    return value;
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch {}
    throw error;
  }
}

function migrate(db) {
  const version = db.prepare("PRAGMA user_version").get().user_version;
  if (version > LOCAL_THREAD_SCHEMA_VERSION) {
    throw Object.assign(new Error(`database schema ${version} is newer than supported ${LOCAL_THREAD_SCHEMA_VERSION}`), { code: "LOCAL_THREADS_SCHEMA_NEWER" });
  }
  if (version === 0) transaction(db, () => {
    db.exec(`
      CREATE TABLE threads (
        thread_id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL,
        ds4_session_key TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL DEFAULT '',
        revision INTEGER NOT NULL DEFAULT 0 CHECK(revision >= 0),
        created_at INTEGER NOT NULL,
        archived_at INTEGER
      );
      CREATE INDEX threads_owner_created ON threads(owner_id, created_at DESC);
      CREATE TABLE runs (
        run_id TEXT NOT NULL,
        thread_id TEXT NOT NULL,
        request_hash TEXT NOT NULL,
        user_message_id TEXT NOT NULL,
        base_revision INTEGER NOT NULL,
        accepted_revision INTEGER NOT NULL,
        frozen_json TEXT NOT NULL,
        state TEXT NOT NULL,
        outcome_json TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY(thread_id, run_id),
        UNIQUE(run_id, thread_id),
        FOREIGN KEY(thread_id) REFERENCES threads(thread_id) ON DELETE CASCADE
      );
      CREATE TABLE thread_messages (
        thread_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        message_id TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('user','assistant')),
        content TEXT NOT NULL,
        state TEXT NOT NULL DEFAULT 'complete' CHECK(state IN ('streaming','complete','interrupted')),
        run_id TEXT,
        created_at INTEGER NOT NULL,
        PRIMARY KEY(thread_id, seq),
        UNIQUE(thread_id, message_id),
        FOREIGN KEY(thread_id) REFERENCES threads(thread_id) ON DELETE CASCADE,
        FOREIGN KEY(run_id, thread_id) REFERENCES runs(run_id, thread_id)
      );
      CREATE TABLE public_events (
        thread_id TEXT NOT NULL,
        thread_seq INTEGER NOT NULL,
        run_id TEXT,
        mapper_version INTEGER NOT NULL,
        payload_json TEXT NOT NULL,
        payload_bytes INTEGER NOT NULL CHECK(payload_bytes >= 0),
        created_at INTEGER NOT NULL,
        PRIMARY KEY(thread_id, thread_seq),
        FOREIGN KEY(thread_id) REFERENCES threads(thread_id) ON DELETE CASCADE,
        FOREIGN KEY(run_id, thread_id) REFERENCES runs(run_id, thread_id)
      );
      CREATE INDEX public_events_run_seq ON public_events(thread_id, run_id, thread_seq);
      CREATE TABLE thread_runtime_bindings (
        thread_id TEXT PRIMARY KEY,
        binding_revision INTEGER NOT NULL DEFAULT 0 CHECK(binding_revision >= 0),
        engine TEXT NOT NULL,
        profile_json TEXT NOT NULL,
        checkpoint_version INTEGER NOT NULL,
        checkpoint_json TEXT NOT NULL,
        restore_state TEXT NOT NULL DEFAULT 'ready',
        updated_at INTEGER NOT NULL,
        FOREIGN KEY(thread_id) REFERENCES threads(thread_id) ON DELETE CASCADE
      );
      CREATE TABLE thread_imports (
        owner_id TEXT NOT NULL,
        source TEXT NOT NULL,
        digest TEXT NOT NULL,
        thread_id TEXT NOT NULL,
        imported_at INTEGER NOT NULL,
        PRIMARY KEY(owner_id, source, digest),
        FOREIGN KEY(thread_id) REFERENCES threads(thread_id) ON DELETE CASCADE
      );
      CREATE TABLE storage_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      PRAGMA user_version = 4;
    `);
  });
  else {
    let current = version;
    if (current === 1) {
      transaction(db, () => {
        db.exec("ALTER TABLE thread_messages ADD COLUMN state TEXT NOT NULL DEFAULT 'complete' CHECK(state IN ('streaming','complete','interrupted'));");
        db.exec(`CREATE TABLE thread_runtime_bindings (thread_id TEXT PRIMARY KEY, binding_revision INTEGER NOT NULL DEFAULT 0 CHECK(binding_revision >= 0), engine TEXT NOT NULL, profile_json TEXT NOT NULL, checkpoint_version INTEGER NOT NULL, checkpoint_json TEXT NOT NULL, restore_state TEXT NOT NULL DEFAULT 'ready', updated_at INTEGER NOT NULL, FOREIGN KEY(thread_id) REFERENCES threads(thread_id) ON DELETE CASCADE);`);
        db.exec("PRAGMA user_version = 3;");
      });
      current = 3;
    }
    if (current === 2) {
      transaction(db, () => {
        db.exec(`CREATE TABLE thread_runtime_bindings (thread_id TEXT PRIMARY KEY, binding_revision INTEGER NOT NULL DEFAULT 0 CHECK(binding_revision >= 0), engine TEXT NOT NULL, profile_json TEXT NOT NULL, checkpoint_version INTEGER NOT NULL, checkpoint_json TEXT NOT NULL, restore_state TEXT NOT NULL DEFAULT 'ready', updated_at INTEGER NOT NULL, FOREIGN KEY(thread_id) REFERENCES threads(thread_id) ON DELETE CASCADE);`);
        db.exec("PRAGMA user_version = 3;");
      });
      current = 3;
    }
    if (current === 3) transaction(db, () => {
      db.exec("ALTER TABLE threads ADD COLUMN title TEXT NOT NULL DEFAULT '';");
      db.exec("CREATE TABLE thread_imports (owner_id TEXT NOT NULL, source TEXT NOT NULL, digest TEXT NOT NULL, thread_id TEXT NOT NULL, imported_at INTEGER NOT NULL, PRIMARY KEY(owner_id, source, digest), FOREIGN KEY(thread_id) REFERENCES threads(thread_id) ON DELETE CASCADE);");
      db.exec("PRAGMA user_version = 4;");
    });
  }
}

function threadError() {
  return new AgentAdmissionError("THREAD_NOT_FOUND", "thread not found", 404);
}

function ensurePrivateDirectory(directory) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  if ((statSync(directory).mode & 0o077) !== 0) {
    throw Object.assign(new Error(`local thread storage directory must be private (0700): ${directory}`), { code: "LOCAL_THREADS_DIRECTORY_PERMISSIONS" });
  }
}

export function createLocalThreadStore({ db, startSession = () => {}, restoreSession = () => {}, stopSession = () => {}, mintId = () => randomUUID(), now = () => Date.now() } = {}) {
  if (!db) throw new TypeError("createLocalThreadStore: db is required");

  function requireThread(ownerId, threadId) {
    const row = db.prepare("SELECT * FROM threads WHERE thread_id=? AND owner_id=?").get(threadId, ownerId);
    if (!row) throw threadError();
    return row;
  }
  function messagesFor(threadId) {
    return db.prepare("SELECT message_id AS id, role, content, state, run_id AS runId FROM thread_messages WHERE thread_id=? ORDER BY seq").all(threadId).map((row) => ({ ...row }));
  }
  function publicThreadSummary(row) {
    return Object.freeze({ threadId: row.thread_id, title: row.title || "", revision: row.revision, archivedAt: row.archived_at ?? null, createdAt: row.created_at, preview: row.preview || "" });
  }
  function publicThread(row) {
    return Object.freeze({ ...publicThreadSummary(row), messages: Object.freeze(messagesFor(row.thread_id).map((m) => Object.freeze(m))) });
  }
  function nextMessageSeq(threadId) {
    return db.prepare("SELECT COALESCE(MAX(seq),0)+1 AS seq FROM thread_messages WHERE thread_id=?").get(threadId).seq;
  }
  const pageStore = createWorkspacePageStore({ db, requireThread, mintId, now });
  const dotStore = createDotStore({ db, requireThread, getPage: pageStore.getPage, mintId, now });

  return Object.freeze({
    ...pageStore,
    ...dotStore,
    createThread(ownerId, { title = "" } = {}) {
      opaqueId(ownerId, "ownerId");
      if (typeof title !== "string" || Buffer.byteLength(title) > 240) throw new AgentAdmissionError("INVALID_THREAD_TITLE", "thread title must be text up to 240 bytes", 400);
      const threadId = `thr_${mintId()}`;
      const ds4SessionKey = `${SERVER_SESSION_PREFIX}${mintId()}`;
      transaction(db, () => db.prepare("INSERT INTO threads(thread_id,owner_id,ds4_session_key,title,revision,created_at) VALUES (?,?,?,?,0,?)").run(threadId, ownerId, ds4SessionKey, title.trim(), now()));
      try { startSession(ds4SessionKey); }
      catch (error) {
        transaction(db, () => db.prepare("DELETE FROM threads WHERE thread_id=?").run(threadId));
        throw error;
      }
      return publicThread(requireThread(ownerId, threadId));
    },
    findThreadForOwner(ownerId) {
      const row = db.prepare("SELECT * FROM threads WHERE owner_id=? AND archived_at IS NULL ORDER BY created_at DESC, thread_id DESC LIMIT 1").get(ownerId);
      return row ? publicThreadSummary(row) : null;
    },
    listThreads(ownerId, { after = null, limit = 50, includeArchived = false } = {}) {
      opaqueId(ownerId, "ownerId");
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new AgentAdmissionError("INVALID_THREAD_PAGE", "limit must be between 1 and 100", 400);
      if (after !== null && typeof after !== "string") throw new AgentAdmissionError("INVALID_THREAD_PAGE", "after must be a thread id", 400);
      let rows;
      if (after) {
        const cursor = db.prepare("SELECT created_at,thread_id FROM threads WHERE owner_id=? AND thread_id=?").get(ownerId, after);
        if (!cursor) throw new AgentAdmissionError("INVALID_THREAD_PAGE", "cursor is not an owned thread", 400);
        rows = db.prepare(`SELECT t.*,(SELECT content FROM thread_messages m WHERE m.thread_id=t.thread_id AND m.role='user' ORDER BY seq DESC LIMIT 1) AS preview FROM threads t WHERE owner_id=? AND (? OR archived_at IS NULL) AND (created_at<? OR (created_at=? AND thread_id<?)) ORDER BY created_at DESC,thread_id DESC LIMIT ?`)
          .all(ownerId, includeArchived ? 1 : 0, cursor.created_at, cursor.created_at, cursor.thread_id, limit + 1);
      } else {
        rows = db.prepare(`SELECT t.*,(SELECT content FROM thread_messages m WHERE m.thread_id=t.thread_id AND m.role='user' ORDER BY seq DESC LIMIT 1) AS preview FROM threads t WHERE owner_id=? AND (? OR archived_at IS NULL) ORDER BY created_at DESC,thread_id DESC LIMIT ?`)
          .all(ownerId, includeArchived ? 1 : 0, limit + 1);
      }
      const hasMore = rows.length > limit;
      const page = rows.slice(0, limit).map(publicThreadSummary);
      return Object.freeze({ threads: Object.freeze(page), nextCursor: hasMore ? page.at(-1)?.threadId ?? null : null });
    },
    getThreadPage(ownerId, threadId, { before = null, limit = 199 } = {}) {
      const thread = requireThread(ownerId, threadId);
      if (!Number.isInteger(limit) || limit < 1 || limit > 199 || (before !== null && (!Number.isSafeInteger(before) || before < 1))) {
        throw new AgentAdmissionError("INVALID_MESSAGE_PAGE", "message cursor or limit is invalid", 400);
      }
      const rows = before === null
        ? db.prepare("SELECT seq,message_id AS id,role,content,state,run_id AS runId FROM thread_messages WHERE thread_id=? ORDER BY seq DESC LIMIT ?").all(threadId, limit + 1)
        : db.prepare("SELECT seq,message_id AS id,role,content,state,run_id AS runId FROM thread_messages WHERE thread_id=? AND seq<? ORDER BY seq DESC LIMIT ?").all(threadId, before, limit + 1);
      const hasMore = rows.length > limit;
      const messages = rows.slice(0, limit).reverse().map((row) => Object.freeze({ ...row }));
      return Object.freeze({ ...publicThreadSummary(thread), messages: Object.freeze(messages), previousCursor: hasMore ? messages[0]?.seq ?? null : null });
    },
    archiveThread(ownerId, threadId) {
      return transaction(db, () => {
        requireThread(ownerId, threadId);
        if (db.prepare("SELECT 1 FROM runs WHERE thread_id=? AND state IN ('accepted','running','cancelling') LIMIT 1").get(threadId)) {
          throw new AgentAdmissionError("THREAD_RUN_ACTIVE", "a thread with an active run cannot be archived", 409);
        }
        db.prepare("UPDATE threads SET archived_at=COALESCE(archived_at,?) WHERE thread_id=? AND owner_id=?").run(now(), threadId, ownerId);
        return publicThreadSummary(requireThread(ownerId, threadId));
      });
    },
    deleteThread(ownerId, threadId) {
      const deleted = transaction(db, () => {
        const thread = requireThread(ownerId, threadId);
        if (db.prepare("SELECT 1 FROM runs WHERE thread_id=? AND state IN ('accepted','running','cancelling') LIMIT 1").get(threadId)) {
          throw new AgentAdmissionError("THREAD_RUN_ACTIVE", "a thread with an active run cannot be deleted", 409);
        }
        db.prepare("DELETE FROM threads WHERE thread_id=? AND owner_id=?").run(threadId, ownerId);
        return Object.freeze({ threadId, sessionKey: thread.ds4_session_key });
      });
      stopSession(deleted.sessionKey);
      return Object.freeze({ threadId: deleted.threadId, deleted: true });
    },
    exportThread(ownerId, threadId) {
      const thread = publicThread(requireThread(ownerId, threadId));
      const imports = db.prepare("SELECT source,digest,imported_at AS importedAt FROM thread_imports WHERE owner_id=? AND thread_id=? ORDER BY imported_at").all(ownerId, threadId);
      return Object.freeze({ format: "ds4-thread-v1", exportedAt: now(), thread: Object.freeze({ ...thread }), provenance: Object.freeze(imports.map((item) => Object.freeze(item))) });
    },
    importLegacyThread(ownerId, { source = "ds4.session", title = "", messages = [] } = {}) {
      opaqueId(ownerId, "ownerId");
      if (source !== "ds4.session" || typeof title !== "string" || !Array.isArray(messages)) throw new AgentAdmissionError("INVALID_LEGACY_IMPORT", "legacy import payload is invalid", 400);
      const digest = createHash("sha256").update(JSON.stringify({ source, title, messages })).digest("hex");
      const existing = db.prepare("SELECT thread_id FROM thread_imports WHERE owner_id=? AND source=? AND digest=?").get(ownerId, source, digest);
      if (existing) return Object.freeze({ thread: publicThread(requireThread(ownerId, existing.thread_id)), imported: false, digest });
      const created = this.createThread(ownerId, { title: title || "Importazione ds4.session" });
      try {
        transaction(db, () => {
          for (const message of messages) {
            if (!message || !["user", "assistant"].includes(message.role) || typeof message.content !== "string") continue;
            const id = opaqueId(message.id, "legacy message id");
            db.prepare("INSERT OR IGNORE INTO thread_messages(thread_id,seq,message_id,role,content,state,run_id,created_at) VALUES (?,?,?, ?,?,'complete',NULL,?)")
              .run(created.threadId, nextMessageSeq(created.threadId), id, message.role, message.content, now());
          }
          db.prepare("INSERT INTO thread_imports(owner_id,source,digest,thread_id,imported_at) VALUES (?,?,?,?,?)").run(ownerId, source, digest, created.threadId, now());
          db.prepare("UPDATE threads SET revision=1 WHERE thread_id=?").run(created.threadId);
        });
      } catch (error) {
        transaction(db, () => db.prepare("DELETE FROM threads WHERE thread_id=? AND owner_id=?").run(created.threadId, ownerId));
        throw error;
      }
      return Object.freeze({ thread: this.getThread(ownerId, created.threadId), imported: true, digest });
    },
    getThread(ownerId, threadId) { return publicThread(requireThread(ownerId, threadId)); },
    revisionAfterRun(ownerId, threadId, runId) {
      const thread = requireThread(ownerId, threadId);
      return db.prepare("SELECT 1 FROM runs WHERE thread_id=? AND run_id=?").get(threadId, runId) ? thread.revision + 1 : null;
    },
    saveCheckpoint(ownerId, threadId, { engine = "js", profile = {}, checkpoint } = {}) {
      if (engine !== "js") throw new AgentAdmissionError("CHECKPOINT_ENGINE_UNSUPPORTED", "only JS session checkpoints are supported", 409);
      if (!checkpoint || checkpoint.version !== 1 || !Array.isArray(checkpoint.messages)) throw new AgentAdmissionError("INVALID_SESSION_CHECKPOINT", "checkpoint version 1 with messages is required", 400);
      const profileJson = JSON.stringify(profile);
      const checkpointJson = JSON.stringify(checkpoint);
      if (Buffer.byteLength(checkpointJson) > 16 * 1024 * 1024) throw new AgentAdmissionError("SESSION_CHECKPOINT_TOO_LARGE", "session checkpoint exceeds 16 MiB", 413);
      return transaction(db, () => {
        requireThread(ownerId, threadId);
        db.prepare(`INSERT INTO thread_runtime_bindings(thread_id,binding_revision,engine,profile_json,checkpoint_version,checkpoint_json,restore_state,updated_at)
          VALUES (?,1,?,?,1,?,'ready',?)
          ON CONFLICT(thread_id) DO UPDATE SET binding_revision=binding_revision+1,engine=excluded.engine,profile_json=excluded.profile_json,checkpoint_version=excluded.checkpoint_version,checkpoint_json=excluded.checkpoint_json,restore_state='ready',updated_at=excluded.updated_at`)
          .run(threadId, engine, profileJson, checkpointJson, now());
        return db.prepare("SELECT binding_revision FROM thread_runtime_bindings WHERE thread_id=?").get(threadId).binding_revision;
      });
    },
    loadCheckpoint(ownerId, threadId) {
      requireThread(ownerId, threadId);
      const row = db.prepare("SELECT binding_revision,engine,profile_json,checkpoint_version,checkpoint_json,restore_state FROM thread_runtime_bindings WHERE thread_id=?").get(threadId);
      return row ? Object.freeze({ bindingRevision: row.binding_revision, engine: row.engine, profile: JSON.parse(row.profile_json), checkpointVersion: row.checkpoint_version, checkpoint: JSON.parse(row.checkpoint_json), restoreState: row.restore_state }) : null;
    },
    sessionKeyOf(ownerId, threadId) { return requireThread(ownerId, threadId).ds4_session_key; },
    findRun(ownerId, threadId, runId) {
      requireThread(ownerId, threadId);
      const row = db.prepare("SELECT * FROM runs WHERE thread_id=? AND run_id=?").get(threadId, runId);
      return row ? Object.freeze({
        runId: row.run_id, requestHash: row.request_hash, userMessageId: row.user_message_id,
        baseRevision: row.base_revision, acceptedRevision: row.accepted_revision,
        frozen: Object.freeze(JSON.parse(row.frozen_json)), state: row.state
      }) : null;
    },
    reconcile(ownerId, threadId, messages) {
      requireThread(ownerId, threadId);
      const fresh = [];
      let previousSeq = null;
      for (const message of messages) {
        const stored = db.prepare("SELECT seq,role,content FROM thread_messages WHERE thread_id=? AND message_id=?").get(threadId, message.id);
        if (!stored) { fresh.push(message); continue; }
        if (fresh.length) throw new AgentAdmissionError("TRANSCRIPT_MISMATCH", "known messages must precede the new one");
        if (stored.role !== message.role || stored.content !== message.content) throw new AgentAdmissionError("TRANSCRIPT_MISMATCH", `message ${message.id} differs from the stored history`);
        if (previousSeq !== null && stored.seq !== previousSeq + 1) throw new AgentAdmissionError("TRANSCRIPT_MISMATCH", "known messages must be a contiguous window of the history");
        previousSeq = stored.seq;
      }
      if (!fresh.length) throw new AgentAdmissionError("MESSAGE_ALREADY_ACCEPTED", "the request carries no new user message");
      if (fresh.length > 1) throw new AgentAdmissionError("TRANSCRIPT_MISMATCH", "only one new message is accepted per run", 400);
      if (fresh[0].role !== "user") throw new AgentAdmissionError("TRANSCRIPT_MISMATCH", "the new message must have role user", 400);
      if (!fresh[0].content.trim()) throw new AgentAdmissionError("INVALID_RUN_INPUT", "the new user message is empty", 400);
      return fresh[0];
    },
    acceptRun(ownerId, threadId, { runId, requestHash, message, baseRevision, frozen = {} }) {
      const stored = Object.freeze({ id: message.id, role: "user", content: message.content, runId });
      const acceptedRevision = transaction(db, () => {
        const thread = requireThread(ownerId, threadId);
        if (db.prepare("SELECT 1 FROM runs WHERE thread_id=? AND run_id=?").get(threadId, runId)) throw new AgentAdmissionError("RUN_ID_CONFLICT", "runId already registered");
        if (thread.revision !== baseRevision) throw new AgentAdmissionError("REVISION_CONFLICT", `baseRevision ${baseRevision} is stale (current ${thread.revision})`);
        if (db.prepare("SELECT 1 FROM thread_messages WHERE thread_id=? AND message_id=?").get(threadId, message.id)) throw new AgentAdmissionError("MESSAGE_ALREADY_ACCEPTED", "message id already in the thread");
        const nextRevision = thread.revision + 1;
        db.prepare("INSERT INTO runs(run_id,thread_id,request_hash,user_message_id,base_revision,accepted_revision,frozen_json,state,created_at,updated_at) VALUES (?,?,?,?,?,?,?,'accepted',?,?)")
          .run(runId, threadId, requestHash, message.id, baseRevision, nextRevision, JSON.stringify(frozen), now(), now());
        db.prepare("INSERT INTO thread_messages(thread_id,seq,message_id,role,content,state,run_id,created_at) VALUES (?,?,?,'user',?,'complete',?,?)")
          .run(threadId, nextMessageSeq(threadId), message.id, message.content, runId, now());
        db.prepare("UPDATE threads SET revision=? WHERE thread_id=?").run(nextRevision, threadId);
        return nextRevision;
      });
      let rolledBack = false;
      return () => {
        if (rolledBack) return;
        rolledBack = true;
        transaction(db, () => {
          if (db.prepare("SELECT 1 FROM public_events WHERE thread_id=? AND run_id=? LIMIT 1").get(threadId, runId)) return;
          db.prepare("DELETE FROM thread_messages WHERE thread_id=? AND message_id=? AND run_id=?").run(threadId, message.id, runId);
          db.prepare("DELETE FROM runs WHERE thread_id=? AND run_id=?").run(threadId, runId);
          db.prepare("UPDATE threads SET revision=? WHERE thread_id=? AND revision=?").run(baseRevision, threadId, acceptedRevision);
        });
      };
    },
    appendAssistant(ownerId, threadId, { id, content, runId }) {
      const messageId = opaqueId(id, "message id");
      return transaction(db, () => {
        requireThread(ownerId, threadId);
        db.prepare("INSERT INTO thread_messages(thread_id,seq,message_id,role,content,state,run_id,created_at) VALUES (?,?,?,'assistant',?,'complete',?,?)")
          .run(threadId, nextMessageSeq(threadId), messageId, String(content), runId, now());
        db.prepare("UPDATE threads SET revision=revision+1 WHERE thread_id=?").run(threadId);
        return db.prepare("SELECT revision FROM threads WHERE thread_id=?").get(threadId).revision;
      });
    },
    setRunState(ownerId, threadId, runId, state, outcome = null) {
      if (!RUN_STATES.has(state)) throw new AgentAdmissionError("INVALID_RUN_STATE", "unknown run state", 400);
      return transaction(db, () => {
        requireThread(ownerId, threadId);
        const result = db.prepare("UPDATE runs SET state=?,outcome_json=?,updated_at=? WHERE thread_id=? AND run_id=?")
          .run(state, outcome === null ? null : JSON.stringify(outcome), now(), threadId, runId);
        if (!result.changes) throw new AgentAdmissionError("RUN_NOT_FOUND", "run not found", 404);
      });
    },
    appendPublicEvents(ownerId, threadId, runId, events) {
      if (!Array.isArray(events) || events.length === 0) return [];
      return transaction(db, () => {
        requireThread(ownerId, threadId);
        if (runId !== null && !db.prepare("SELECT 1 FROM runs WHERE thread_id=? AND run_id=?").get(threadId, runId)) {
          throw new AgentAdmissionError("RUN_NOT_FOUND", "run not found", 404);
        }
        let seq = db.prepare("SELECT COALESCE(MAX(thread_seq),0) AS seq FROM public_events WHERE thread_id=?").get(threadId).seq;
        const insert = db.prepare("INSERT INTO public_events(thread_id,thread_seq,run_id,mapper_version,payload_json,payload_bytes,created_at) VALUES (?,?,?,?,?,?,?)");
        const saved = [];
        const startAssistant = db.prepare("INSERT INTO thread_messages(thread_id,seq,message_id,role,content,state,run_id,created_at) VALUES (?,?,?,'assistant','','streaming',?,?)");
        const appendAssistantDelta = db.prepare("UPDATE thread_messages SET content=content||? WHERE thread_id=? AND message_id=? AND run_id=? AND role='assistant' AND state='streaming'");
        let terminal = false;
        for (const event of events) {
          if (terminal) throw new AgentAdmissionError("EVENT_AFTER_RUN_TERMINAL", "no event may follow a run terminal", 400);
          if (!event || !Number.isSafeInteger(event.mapperVersion) || event.mapperVersion < 1 || !event.payload || typeof event.payload !== "object") {
            throw new AgentAdmissionError("INVALID_PUBLIC_EVENT", "public event requires a mapper version and object payload", 400);
          }
          const payloadJson = JSON.stringify(event.payload);
          const payloadBytes = Buffer.byteLength(payloadJson);
          if (payloadBytes > RUN_INPUT_LIMITS.maxTotalBytes) throw new AgentAdmissionError("PUBLIC_EVENT_TOO_LARGE", "public event exceeds storage limit", 413);
          seq += 1;
          insert.run(threadId, seq, runId, event.mapperVersion, payloadJson, payloadBytes, now());
          const payload = event.payload;
          if (payload.type === "RUN_STARTED") {
            db.prepare("UPDATE runs SET state='running',updated_at=? WHERE thread_id=? AND run_id=?").run(now(), threadId, runId);
          } else if (payload.type === "TEXT_MESSAGE_START" && typeof payload.messageId === "string") {
            startAssistant.run(threadId, nextMessageSeq(threadId), payload.messageId, runId, now());
          } else if (payload.type === "TEXT_MESSAGE_CONTENT" && typeof payload.messageId === "string" && typeof payload.delta === "string") {
            const updated = appendAssistantDelta.run(payload.delta, threadId, payload.messageId, runId);
            if (!updated.changes) throw new AgentAdmissionError("PUBLIC_PROJECTION_MISMATCH", "assistant delta has no open message", 500);
          } else if (payload.type === "TEXT_MESSAGE_END" && typeof payload.messageId === "string") {
            db.prepare("UPDATE thread_messages SET state='complete' WHERE thread_id=? AND message_id=? AND run_id=? AND role='assistant'").run(threadId, payload.messageId, runId);
          }
          if (payload.type === "RUN_FINISHED" || payload.type === "RUN_ERROR") {
            if (terminal) throw new AgentAdmissionError("DUPLICATE_RUN_TERMINAL", "a batch cannot contain multiple terminal events", 400);
            terminal = true;
            const state = payload.type === "RUN_ERROR" ? "failed" : payload.outcome?.type === "cancelled" ? "cancelled" : "finished";
            db.prepare("UPDATE thread_messages SET state=? WHERE thread_id=? AND run_id=? AND role='assistant' AND state IN ('streaming','complete')")
              .run(state === "finished" ? "complete" : "interrupted", threadId, runId);
            db.prepare("UPDATE runs SET state=?,outcome_json=?,updated_at=? WHERE thread_id=? AND run_id=?")
              .run(state, JSON.stringify(payload), now(), threadId, runId);
            db.prepare("UPDATE threads SET revision=revision+1 WHERE thread_id=?").run(threadId);
          }
          saved.push(Object.freeze({ cursor: seq, runId, mapperVersion: event.mapperVersion, payload: JSON.parse(payloadJson) }));
        }
        return saved;
      });
    },
    replayPublicEvents(ownerId, threadId, { after = 0, limit = 500, runId = undefined } = {}) {
      requireThread(ownerId, threadId);
      if (!Number.isSafeInteger(after) || after < 0 || !Number.isInteger(limit) || limit < 1 || limit > 2000) {
        throw new AgentAdmissionError("INVALID_REPLAY_CURSOR", "replay cursor or limit is invalid", 400);
      }
      const rows = runId === undefined
        ? db.prepare("SELECT thread_seq,run_id,mapper_version,payload_json FROM public_events WHERE thread_id=? AND thread_seq>? ORDER BY thread_seq LIMIT ?").all(threadId, after, limit)
        : db.prepare("SELECT thread_seq,run_id,mapper_version,payload_json FROM public_events WHERE thread_id=? AND run_id=? AND thread_seq>? ORDER BY thread_seq LIMIT ?").all(threadId, runId, after, limit);
      return Object.freeze(rows.map((row) => Object.freeze({ cursor: row.thread_seq, runId: row.run_id, mapperVersion: row.mapper_version, payload: JSON.parse(row.payload_json) })));
    },
    getOrCreateOwnerSecret() {
      return transaction(db, () => {
        const found = db.prepare("SELECT value FROM storage_meta WHERE key='owner_secret'").get();
        if (found) return Buffer.from(found.value, "base64url");
        const secret = randomBytes(32);
        db.prepare("INSERT INTO storage_meta(key,value) VALUES ('owner_secret',?)").run(secret.toString("base64url"));
        return secret;
      });
    },
    restoreSessions() {
      const rows = db.prepare(`SELECT t.ds4_session_key,b.engine,b.profile_json,b.checkpoint_version,b.checkpoint_json,b.restore_state
        FROM threads t LEFT JOIN thread_runtime_bindings b ON b.thread_id=t.thread_id ORDER BY t.created_at`).all();
      for (const row of rows) {
        startSession(row.ds4_session_key);
        if (row.checkpoint_json && row.engine === "js" && row.checkpoint_version === 1 && row.restore_state === "ready") {
          restoreSession(row.ds4_session_key, { engine: row.engine, profile: JSON.parse(row.profile_json), checkpoint: JSON.parse(row.checkpoint_json) });
        }
      }
      return rows.length;
    },
    recoverInterruptedRuns() {
      return transaction(db, () => {
        const result = db.prepare("UPDATE runs SET state='interrupted_recovery',updated_at=? WHERE state NOT IN ('finished','cancelled','failed','interrupted_recovery')").run(now());
        db.prepare("UPDATE thread_messages SET state='interrupted' WHERE state='streaming'").run();
        return result.changes;
      });
    },
    countThreads() { return db.prepare("SELECT COUNT(*) AS count FROM threads").get().count; },
    countRuns() { return db.prepare("SELECT COUNT(*) AS count FROM runs").get().count; },
    close() { db.close(); }
  });
}

export async function openLocalThreadStorage({ databasePath, startSession, restoreSession, stopSession, mintId, now } = {}) {
  if (typeof databasePath !== "string" || !databasePath) throw new TypeError("openLocalThreadStorage: databasePath is required");
  const capability = await probeNodeSqlite();
  if (!capability.ok) throw Object.assign(new Error(capability.error), { code: capability.code });
  ensurePrivateDirectory(dirname(databasePath));
  const db = new capability.sqlite.DatabaseSync(databasePath);
  try {
    chmodSync(databasePath, 0o600);
    db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=250; PRAGMA synchronous=FULL;");
    migrate(db);
    migrateWorkspacePageSchema(db);
    migrateDotSchema(db);
    const store = createLocalThreadStore({ db, startSession, restoreSession, stopSession, mintId, now });
    const restoredSessions = store.restoreSessions();
    const interruptedRuns = store.recoverInterruptedRuns();
    return Object.freeze({
      db, store, sqlite: capability.sqlite, restoredSessions, interruptedRuns,
      async backup(destination) {
        ensurePrivateDirectory(dirname(destination));
        const result = await capability.sqlite.backup(db, destination);
        chmodSync(destination, 0o600);
        return result;
      },
      close() { db.close(); }
    });
  } catch (error) {
    try { db.close(); } catch {}
    throw error;
  }
}
