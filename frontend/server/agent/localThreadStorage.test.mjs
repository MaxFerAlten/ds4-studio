import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { openLocalThreadStorage, probeNodeSqlite } from "./localThreadStorage.mjs";
import { createDurablePublicEventWriter } from "./durablePublicEventWriter.mjs";
import { OWNER_COOKIE, createAgentIdentity } from "../agentIdentity.mjs";

const available = (await probeNodeSqlite()).ok;
const sqliteTest = available ? test : test.skip;

sqliteTest("thread deletion is owner-scoped, rejects active runs, cascades history, and stops its session", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ds4-local-delete-"));
  const stopped = [];
  const started = [];
  let id = 0;
  const opened = await openLocalThreadStorage({
    databasePath: join(dir, "threads.sqlite"),
    startSession: (sessionKey) => started.push(sessionKey),
    stopSession: (sessionKey) => stopped.push(sessionKey),
    mintId: () => `delete-${++id}`
  });
  try {
    const thread = opened.store.createThread("owner-a", { title: "Elimina me" });
    assert.throws(() => opened.store.deleteThread("owner-b", thread.threadId), { code: "THREAD_NOT_FOUND" });
    const undo = opened.store.acceptRun("owner-a", thread.threadId, {
      runId: "active-delete-run", requestHash: "delete-hash",
      message: { id: "delete-message", role: "user", content: "in corso" },
      baseRevision: 0, frozen: { engine: "js" }
    });
    assert.throws(() => opened.store.deleteThread("owner-a", thread.threadId), { code: "THREAD_RUN_ACTIVE" });
    undo();
    assert.deepEqual(opened.store.deleteThread("owner-a", thread.threadId), { threadId: thread.threadId, deleted: true });
    assert.equal(opened.store.countThreads(), 0);
    assert.deepEqual(stopped, started);
    assert.throws(() => opened.store.getThread("owner-a", thread.threadId), { code: "THREAD_NOT_FOUND" });
  } finally {
    opened.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

sqliteTest("durable threads recover without rerunning and preserve owner secret and event cursor", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ds4-local-threads-"));
  const dbPath = join(dir, "threads.sqlite");
  const backupPath = join(dir, "backup.sqlite");
  let id = 0;
  const opened = await openLocalThreadStorage({ databasePath: dbPath, mintId: () => `id${++id}` });
  try {
    const ownerSecret = opened.store.getOrCreateOwnerSecret();
    const firstIdentity = createAgentIdentity({ secret: ownerSecret });
    const responseHeaders = new Map();
    const firstRequest = { headers: { cookie: "" } };
    const firstResponse = { headersSent: false, getHeader: (key) => responseHeaders.get(key), setHeader: (key, value) => responseHeaders.set(key, value) };
    const stableOwner = firstIdentity.ownerOf(firstRequest, firstResponse);
    const ownerCookie = responseHeaders.get("Set-Cookie").split(";")[0];
    const thread = opened.store.createThread("owner-test");
    const undo = opened.store.acceptRun("owner-test", thread.threadId, {
      runId: "run1", requestHash: "hash1", message: { id: "msg1", role: "user", content: "hello" }, baseRevision: 0, frozen: { engine: "js" }
    });
    assert.equal(opened.store.getThread("owner-test", thread.threadId).revision, 1);
    assert.throws(() => opened.store.appendPublicEvents("owner-test", thread.threadId, "missing", [{ mapperVersion: 1, payload: { type: "bad" } }]));
    const delivered = [];
    const writer = createDurablePublicEventWriter({
      store: opened.store, ownerId: "owner-test", threadId: thread.threadId, runId: "run1",
      batchDelayMs: 1, deliver: (payload, cursor) => {
        assert.equal(opened.store.replayPublicEvents("owner-test", thread.threadId, { after: cursor - 1 })[0]?.cursor, cursor);
        delivered.push({ payload, cursor });
      }
    });
    await writer.enqueue({ type: "delta", text: "persist first" });
    await writer.close();
    assert.deepEqual(delivered, [{ payload: { type: "delta", text: "persist first" }, cursor: 1 }]);
    assert.deepEqual(opened.store.replayPublicEvents("owner-test", thread.threadId, { after: 0 }), [
      { cursor: 1, runId: "run1", mapperVersion: 1, payload: { type: "delta", text: "persist first" } }
    ]);
    const lostDelivery = createDurablePublicEventWriter({
      store: opened.store, ownerId: "owner-test", threadId: thread.threadId, runId: "run1",
      batchBytes: 1, deliver: () => { throw new Error("client disconnected after commit"); }
    });
    await assert.rejects(lostDelivery.enqueue({ type: "delta", text: "recover me" }), /client disconnected/);
    assert.deepEqual(opened.store.replayPublicEvents("owner-test", thread.threadId, { after: 1 }).map((event) => event.payload.text), ["recover me"]);
    undo();
    assert.equal(opened.store.countRuns(), 1, "run with durable events cannot be rolled back as an unaccepted run");
    opened.store.appendAssistant("owner-test", thread.threadId, { id: "public-assistant", content: "durable public answer", runId: "run1" });
    opened.store.saveCheckpoint("owner-test", thread.threadId, {
      engine: "js", profile: { model: "test-model" },
      checkpoint: { version: 1, messages: [{ role: "assistant", content: "compacted runtime summary" }] }
    });
    await opened.backup(backupPath);
    opened.close();

    const restoredBindings = [];
    const restored = await openLocalThreadStorage({ databasePath: dbPath, startSession: () => {}, restoreSession: (...args) => restoredBindings.push(args), mintId: () => `id${++id}` });
    try {
      assert.deepEqual(restored.store.getOrCreateOwnerSecret(), ownerSecret);
      assert.equal(createAgentIdentity({ secret: restored.store.getOrCreateOwnerSecret() }).ownerOf({ headers: { cookie: `${OWNER_COOKIE}=${ownerCookie.split("=")[1]}` } }), stableOwner);
      assert.equal(restored.interruptedRuns, 1);
      assert.equal(restored.store.findRun("owner-test", thread.threadId, "run1").state, "interrupted_recovery");
      assert.equal(restored.store.replayPublicEvents("owner-test", thread.threadId, { after: 0 }).length, 2);
      assert.equal(restored.store.replayPublicEvents("owner-test", thread.threadId, { after: 1 }).length, 1);
      assert.equal(restoredBindings.length, 1);
      assert.deepEqual(restored.store.getThread("owner-test", thread.threadId).messages.map((message) => message.content), ["hello", "durable public answer"]);
      assert.deepEqual(restoredBindings[0][1].checkpoint, { version: 1, messages: [{ role: "assistant", content: "compacted runtime summary" }] });
    } finally { restored.close(); }

    const backup = await openLocalThreadStorage({ databasePath: backupPath, mintId: () => `id${++id}` });
    try {
      assert.equal(backup.store.countThreads(), 1);
      assert.equal(backup.db.prepare("PRAGMA quick_check").get().quick_check, "ok");
    } finally { backup.close(); }
  } finally {
    try { opened.close(); } catch {}
    rmSync(dir, { recursive: true, force: true });
  }
});

sqliteTest("migration is idempotent and transaction rollback preserves the thread revision", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ds4-local-threads-"));
  const dbPath = join(dir, "threads.sqlite");
  const first = await openLocalThreadStorage({ databasePath: dbPath, mintId: (() => { let n = 0; return () => `m${++n}`; })() });
  try {
    const thread = first.store.createThread("owner-test");
    const undo = first.store.acceptRun("owner-test", thread.threadId, {
      runId: "run1", requestHash: "hash1", message: { id: "msg1", role: "user", content: "hello" }, baseRevision: 0
    });
    undo();
    assert.equal(first.store.getThread("owner-test", thread.threadId).revision, 0);
    assert.equal(first.store.countRuns(), 0);
  } finally { first.close(); }
  const second = await openLocalThreadStorage({ databasePath: dbPath });
  try { assert.equal(second.store.countThreads(), 1); } finally {
    second.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("writer bounds pending deliveries and never emits when persistence fails", async () => {
  let release;
  const paused = new Promise((resolve) => { release = resolve; });
  const writer = createDurablePublicEventWriter({
    store: { appendPublicEvents: () => [{ cursor: 1, payload: { text: "x" } }] },
    ownerId: "o", threadId: "t", runId: "r", batchBytes: 1, maxBufferedBytes: 20,
    deliver: async () => paused
  });
  const pending = writer.enqueue({ text: "x" });
  await assert.rejects(writer.enqueue({ text: "y" }), { code: "PUBLIC_EVENT_BACKPRESSURE" });
  release();
  await pending;
  await writer.close();

  let emitted = false;
  const failed = createDurablePublicEventWriter({
    store: { appendPublicEvents: () => { throw new Error("disk full"); } },
    ownerId: "o", threadId: "t", runId: "r", batchBytes: 1,
    deliver: () => { emitted = true; }
  });
  await assert.rejects(failed.enqueue({ text: "x" }), /disk full/);
  await assert.rejects(failed.close(), /disk full/);
  assert.equal(emitted, false);
});

sqliteTest("storage refuses a directory accessible to other local users", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ds4-local-threads-perms-"));
  try {
    chmodSync(dir, 0o755);
    await assert.rejects(openLocalThreadStorage({ databasePath: join(dir, "threads.sqlite") }), { code: "LOCAL_THREADS_DIRECTORY_PERMISSIONS" });
  } finally {
    chmodSync(dir, 0o700);
    rmSync(dir, { recursive: true, force: true });
  }
});

sqliteTest("event projection and cancelled terminal update history and run atomically", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ds4-local-threads-terminal-"));
  const storage = await openLocalThreadStorage({ databasePath: join(dir, "threads.sqlite") });
  try {
    const thread = storage.store.createThread("owner-test");
    storage.store.acceptRun("owner-test", thread.threadId, {
      runId: "run-cancel", requestHash: "hash", message: { id: "user-cancel", role: "user", content: "stop" }, baseRevision: 0
    });
    storage.store.appendPublicEvents("owner-test", thread.threadId, "run-cancel", [
      { mapperVersion: 1, payload: { type: "RUN_STARTED" } },
      { mapperVersion: 1, payload: { type: "TEXT_MESSAGE_START", messageId: "assistant-cancel" } },
      { mapperVersion: 1, payload: { type: "TEXT_MESSAGE_CONTENT", messageId: "assistant-cancel", delta: "partial" } },
      { mapperVersion: 1, payload: { type: "RUN_FINISHED", outcome: { type: "cancelled" } } }
    ]);
    assert.equal(storage.store.findRun("owner-test", thread.threadId, "run-cancel").state, "cancelled");
    assert.equal(storage.store.getThread("owner-test", thread.threadId).revision, 2);
    assert.deepEqual(storage.store.getThread("owner-test", thread.threadId).messages.at(-1), {
      id: "assistant-cancel", role: "assistant", content: "partial", state: "interrupted", runId: "run-cancel"
    });
  } finally {
    storage.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

sqliteTest("WP5 thread library paginates, archives, exports and imports idempotently per owner", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ds4-thread-library-"));
  const storage = await openLocalThreadStorage({ databasePath: join(dir, "threads.sqlite"), mintId: (() => { let n = 0; return () => `wp5-${++n}`; })(), now: (() => { let n = 100; return () => ++n; })() });
  try {
    const first = storage.store.createThread("owner-a", { title: "Uno" });
    const second = storage.store.createThread("owner-a", { title: "Due" });
    storage.store.createThread("owner-b", { title: "Privato" });
    assert.deepEqual(storage.store.listThreads("owner-a", { limit: 1 }).threads.map((thread) => thread.title), ["Due"]);
    const page = storage.store.listThreads("owner-a", { limit: 1 });
    assert.equal(storage.store.listThreads("owner-a", { limit: 1, after: page.nextCursor }).threads[0].threadId, first.threadId);
    assert.throws(() => storage.store.getThread("owner-a", storage.store.listThreads("owner-b").threads[0].threadId), { code: "THREAD_NOT_FOUND" });
    const legacy = { source: "ds4.session", title: "Vecchia sessione", messages: [{ id: "legacy-1", role: "user", content: "Ciao" }, { id: "legacy-2", role: "assistant", content: "Salve" }] };
    const imported = storage.store.importLegacyThread("owner-a", legacy);
    const repeated = storage.store.importLegacyThread("owner-a", legacy);
    assert.equal(imported.imported, true);
    assert.equal(repeated.imported, false);
    assert.equal(repeated.thread.threadId, imported.thread.threadId);
    assert.deepEqual(imported.thread.messages.map((message) => message.content), ["Ciao", "Salve"]);
    assert.equal(storage.store.exportThread("owner-a", imported.thread.threadId).format, "ds4-thread-v1");
    storage.store.archiveThread("owner-a", second.threadId);
    assert.equal(storage.store.listThreads("owner-a").threads.some((thread) => thread.threadId === second.threadId), false);
    assert.equal(storage.store.listThreads("owner-a", { includeArchived: true }).threads.some((thread) => thread.threadId === second.threadId), true);
    const active = storage.store.createThread("owner-a");
    storage.store.acceptRun("owner-a", active.threadId, { runId: "active-run", requestHash: "hash", message: { id: "active-message", role: "user", content: "in corso" }, baseRevision: 0 });
    assert.throws(() => storage.store.archiveThread("owner-a", active.threadId), { code: "THREAD_RUN_ACTIVE" });
  } finally { storage.close(); rmSync(dir, { recursive: true, force: true }); }
});

sqliteTest("schema versions 1 through 4 upgrade through v6 and retain existing threads", async () => {
  for (const version of [1, 2, 3, 4]) {
    const dir = mkdtempSync(join(tmpdir(), `ds4-migrate-v${version}-`));
    const path = join(dir, "threads.sqlite");
    const capability = await probeNodeSqlite();
    const db = new capability.sqlite.DatabaseSync(path);
    db.exec(`CREATE TABLE threads(thread_id TEXT PRIMARY KEY,owner_id TEXT NOT NULL,ds4_session_key TEXT NOT NULL UNIQUE,${version >= 4 ? "title TEXT NOT NULL DEFAULT ''," : ""}revision INTEGER NOT NULL DEFAULT 0,created_at INTEGER NOT NULL,archived_at INTEGER);`);
    db.exec(`CREATE TABLE runs(run_id TEXT NOT NULL,thread_id TEXT NOT NULL,request_hash TEXT NOT NULL,user_message_id TEXT NOT NULL,base_revision INTEGER NOT NULL,accepted_revision INTEGER NOT NULL,frozen_json TEXT NOT NULL,state TEXT NOT NULL,outcome_json TEXT,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,PRIMARY KEY(thread_id,run_id));`);
    db.exec(`CREATE TABLE thread_messages(thread_id TEXT NOT NULL,seq INTEGER NOT NULL,message_id TEXT NOT NULL,role TEXT NOT NULL,content TEXT NOT NULL${version >= 2 ? ",state TEXT NOT NULL DEFAULT 'complete'" : ""},run_id TEXT,created_at INTEGER NOT NULL,PRIMARY KEY(thread_id,seq));`);
    if (version === 3) db.exec(`CREATE TABLE thread_runtime_bindings(thread_id TEXT PRIMARY KEY,binding_revision INTEGER NOT NULL DEFAULT 0,engine TEXT NOT NULL,profile_json TEXT NOT NULL,checkpoint_version INTEGER NOT NULL,checkpoint_json TEXT NOT NULL,restore_state TEXT NOT NULL DEFAULT 'ready',updated_at INTEGER NOT NULL);`);
    if (version === 4) {
      db.exec(`CREATE TABLE thread_runtime_bindings(thread_id TEXT PRIMARY KEY,binding_revision INTEGER NOT NULL DEFAULT 0,engine TEXT NOT NULL,profile_json TEXT NOT NULL,checkpoint_version INTEGER NOT NULL,checkpoint_json TEXT NOT NULL,restore_state TEXT NOT NULL DEFAULT 'ready',updated_at INTEGER NOT NULL);`);
      db.exec(`CREATE TABLE thread_imports(owner_id TEXT NOT NULL,source TEXT NOT NULL,digest TEXT NOT NULL,thread_id TEXT NOT NULL,imported_at INTEGER NOT NULL,PRIMARY KEY(owner_id,source,digest));`);
    }
    db.exec(`INSERT INTO threads(thread_id,owner_id,ds4_session_key,revision,created_at) VALUES ('thr_keep','owner-a','ds4t_keep',0,10); PRAGMA user_version=${version};`);
    db.close();
    const migrated = await openLocalThreadStorage({ databasePath: path });
    try {
      assert.equal(migrated.db.prepare("PRAGMA user_version").get().user_version, 6);
      assert.equal(migrated.store.getThread("owner-a", "thr_keep").title, "");
      assert.equal(migrated.db.prepare("SELECT COUNT(*) AS n FROM thread_imports").get().n, 0);
      assert.ok(migrated.db.prepare("SELECT 1 FROM thread_runtime_bindings LIMIT 1").all());
    } finally { migrated.close(); rmSync(dir, { recursive: true, force: true }); }
  }
});

sqliteTest("versioned Dots pin profiles, skills, tool scopes and approved Pages to a thread", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ds4-dot-store-"));
  const storage = await openLocalThreadStorage({ databasePath: join(dir, "threads.sqlite") });
  try {
    const thread = storage.store.createThread("owner-a");
    const pageDraft = storage.store.proposePageDraft("owner-a", thread.threadId, { slug: "dot-notes", title: "Dot notes", content: "Scoped context" });
    const page = storage.store.decidePageDraft("owner-a", thread.threadId, pageDraft.draftId, { decision: "approve", candidateHash: pageDraft.candidateHash }).page;
    const dot = storage.store.createDot("owner-a", { name: "Research", instructions: "Use concise citations.", skills: ["metacognition"], allowedTools: ["read", "search"], allowedPageIds: [page.pageId], profile: { model: "local-model", temperature: 0.2 } });
    assert.equal(dot.revision, 1);
    const bound = storage.store.bindThreadDot("owner-a", thread.threadId, dot.dotId, dot.revision);
    assert.equal(bound.hash, dot.hash);
    assert.deepEqual(bound.pages.map((item) => item.content), ["Scoped context"]);
    const changed = storage.store.updateDot("owner-a", dot.dotId, { baseRevision: 1, name: "Research", instructions: "Different version.", skills: ["structure"], allowedTools: ["list"], allowedPageIds: [], profile: { model: "other-model" } });
    assert.equal(changed.revision, 2);
    assert.equal(storage.store.resolveThreadDot("owner-a", thread.threadId).revision, 1, "an existing thread stays pinned to its Dot revision");
    assert.throws(() => storage.store.bindThreadDot("owner-b", thread.threadId, dot.dotId, 2), { code: "THREAD_NOT_FOUND" });
    storage.store.acceptRun("owner-a", thread.threadId, { runId: "dot-run", requestHash: "hash", message: { id: "dot-message", role: "user", content: "run" }, baseRevision: 0 });
    assert.throws(() => storage.store.bindThreadDot("owner-a", thread.threadId, dot.dotId, 2), { code: "DOT_THREAD_TRANSITION_REQUIRED" });
    assert.throws(() => storage.store.createDot("owner-a", { name: "Unsafe", allowedTools: ["sage"] }), { code: "DOT_TOOL_UNAVAILABLE" });
    assert.throws(() => storage.store.resolveThreadDot("owner-b", thread.threadId), { code: "THREAD_NOT_FOUND" });
  } finally { storage.close(); rmSync(dir, { recursive: true, force: true }); }
});

sqliteTest("page drafts stay private until one owner/thread/hash-bound approval applies them once", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ds4-page-drafts-"));
  const storage = await openLocalThreadStorage({ databasePath: join(dir, "threads.sqlite") });
  try {
    const thread = storage.store.createThread("owner-a");
    const otherThread = storage.store.createThread("owner-a");
    const draft = storage.store.proposePageDraft("owner-a", thread.threadId, { slug: "local-guide", title: "Local guide", content: "Draft body" });
    assert.equal(storage.store.listPages("owner-a").length, 0);
    assert.throws(() => storage.store.decidePageDraft("owner-a", otherThread.threadId, draft.draftId, { decision: "approve", candidateHash: draft.candidateHash }), { code: "PAGE_DRAFT_NOT_FOUND" });
    assert.throws(() => storage.store.decidePageDraft("owner-a", thread.threadId, draft.draftId, { decision: "approve", candidateHash: "0".repeat(64) }), { code: "PAGE_DRAFT_HASH_MISMATCH" });
    const result = storage.store.decidePageDraft("owner-a", thread.threadId, draft.draftId, { decision: "approve", candidateHash: draft.candidateHash });
    assert.equal(result.applied, true);
    assert.equal(result.page.content, "Draft body");
    assert.throws(() => storage.store.decidePageDraft("owner-a", thread.threadId, draft.draftId, { decision: "approve", candidateHash: draft.candidateHash }), { code: "PAGE_DRAFT_REPLAY" });
    assert.throws(() => storage.store.getPage("owner-b", result.page.pageId), { code: "PAGE_NOT_FOUND" });
    const declined = storage.store.proposePageDraft("owner-a", thread.threadId, { slug: "declined-page", title: "Declined", content: "Must not persist" });
    const decision = storage.store.decidePageDraft("owner-a", thread.threadId, declined.draftId, { decision: "decline", candidateHash: declined.candidateHash });
    assert.equal(decision.applied, false);
    assert.equal(storage.store.listPages("owner-a").length, 1);
    const stale = storage.store.proposePageDraft("owner-a", thread.threadId, { pageId: result.page.pageId, baseRevision: 1, slug: "local-guide", title: "Changed", content: "Stale candidate" });
    const next = storage.store.proposePageDraft("owner-a", thread.threadId, { pageId: result.page.pageId, baseRevision: 1, slug: "local-guide", title: "Current", content: "Current candidate" });
    storage.store.decidePageDraft("owner-a", thread.threadId, next.draftId, { decision: "approve", candidateHash: next.candidateHash });
    assert.throws(() => storage.store.decidePageDraft("owner-a", thread.threadId, stale.draftId, { decision: "approve", candidateHash: stale.candidateHash }), { code: "PAGE_DRAFT_STALE" });
  } finally { storage.close(); rmSync(dir, { recursive: true, force: true }); }
});

sqliteTest("10,000-message history is read in bounded pages and reconcile checks indexed IDs", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ds4-thread-history-page-"));
  const storage = await openLocalThreadStorage({ databasePath: join(dir, "threads.sqlite") });
  try {
    const thread = storage.store.createThread("owner-a");
    storage.db.exec("BEGIN");
    const insert = storage.db.prepare("INSERT INTO thread_messages(thread_id,seq,message_id,role,content,state,run_id,created_at) VALUES (?,?,?,?,?,'complete',NULL,?)");
    for (let seq = 1; seq <= 10_000; seq += 1) insert.run(thread.threadId, seq, `history-${seq}`, seq % 2 ? "user" : "assistant", `messaggio ${seq}`, seq);
    storage.db.prepare("UPDATE threads SET revision=10000 WHERE thread_id=?").run(thread.threadId);
    storage.db.exec("COMMIT");

    const page = storage.store.getThreadPage("owner-a", thread.threadId, { limit: 199 });
    assert.equal(page.messages.length, 199);
    assert.equal(page.messages[0].seq, 9802);
    assert.equal(page.messages.at(-1).seq, 10000);
    assert.equal(page.previousCursor, 9802);
    const previous = storage.store.getThreadPage("owner-a", thread.threadId, { before: page.previousCursor, limit: 199 });
    assert.equal(previous.messages.length, 199);
    assert.equal(previous.messages.at(-1).seq, 9801);
    assert.equal(Object.hasOwn(storage.store.listThreads("owner-a").threads[0], "messages"), false);
    const transcript = page.messages.map(({ id, role, content }) => ({ id, role, content }));
    transcript.push({ id: "next-user", role: "user", content: "prosegui" });
    assert.equal(storage.store.reconcile("owner-a", thread.threadId, transcript).id, "next-user");
  } finally { storage.close(); rmSync(dir, { recursive: true, force: true }); }
});
