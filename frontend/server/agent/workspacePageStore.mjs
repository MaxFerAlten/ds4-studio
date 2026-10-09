import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { AgentAdmissionError, opaqueId } from "../agentAdmission.mjs";

function transaction(db, operation) {
  db.exec("BEGIN IMMEDIATE");
  try { const value = operation(); db.exec("COMMIT"); return value; }
  catch (error) { try { db.exec("ROLLBACK"); } catch {} throw error; }
}

function pageError(code, message, status = 400) { return new AgentAdmissionError(code, message, status); }
function validSlug(value) { return typeof value === "string" && /^[a-z0-9](?:[a-z0-9-]{0,62})$/.test(value); }
function hashMatches(expected, supplied) {
  return typeof expected === "string" && typeof supplied === "string" && /^[a-f0-9]{64}$/.test(expected) && /^[a-f0-9]{64}$/.test(supplied) &&
    timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(supplied, "hex"));
}

export function migrateWorkspacePageSchema(db) {
  const version = db.prepare("PRAGMA user_version").get().user_version;
  if (version > 6) throw Object.assign(new Error(`database schema ${version} is newer than supported 6`), { code: "LOCAL_THREADS_SCHEMA_NEWER" });
  if (version >= 5) return;
  transaction(db, () => {
    db.exec(`
      CREATE TABLE workspace_pages (
        owner_id TEXT NOT NULL, page_id TEXT NOT NULL, slug TEXT NOT NULL, title TEXT NOT NULL,
        content TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision > 0),
        created_by_thread_id TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
        archived_at INTEGER, PRIMARY KEY(owner_id,page_id), UNIQUE(owner_id,slug),
        FOREIGN KEY(created_by_thread_id) REFERENCES threads(thread_id) ON DELETE CASCADE
      );
      CREATE INDEX workspace_pages_owner_updated ON workspace_pages(owner_id,updated_at DESC,page_id);
      CREATE TABLE workspace_page_versions (
        owner_id TEXT NOT NULL, page_id TEXT NOT NULL, revision INTEGER NOT NULL,
        thread_id TEXT NOT NULL, action TEXT NOT NULL CHECK(action IN ('upsert','delete')),
        candidate_hash TEXT NOT NULL, slug TEXT NOT NULL, title TEXT NOT NULL, content TEXT NOT NULL,
        created_at INTEGER NOT NULL, PRIMARY KEY(owner_id,page_id,revision),
        FOREIGN KEY(owner_id,page_id) REFERENCES workspace_pages(owner_id,page_id) ON DELETE CASCADE,
        FOREIGN KEY(thread_id) REFERENCES threads(thread_id) ON DELETE CASCADE
      );
      CREATE TABLE workspace_page_drafts (
        owner_id TEXT NOT NULL, draft_id TEXT NOT NULL, thread_id TEXT NOT NULL, page_id TEXT NOT NULL,
        base_revision INTEGER NOT NULL CHECK(base_revision >= 0), action TEXT NOT NULL CHECK(action IN ('upsert','delete')),
        candidate_hash TEXT NOT NULL, candidate_json TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('pending','approved','rejected','stale')),
        created_at INTEGER NOT NULL, decided_at INTEGER, PRIMARY KEY(owner_id,draft_id),
        FOREIGN KEY(thread_id) REFERENCES threads(thread_id) ON DELETE CASCADE
      );
      CREATE INDEX workspace_page_drafts_owner_status ON workspace_page_drafts(owner_id,status,created_at DESC);
      PRAGMA user_version = 5;
    `);
  });
}

export function createWorkspacePageStore({ db, requireThread, mintId = () => randomUUID(), now = () => Date.now() }) {
  function getPage(ownerId, pageId) {
    const row = db.prepare(`SELECT page_id AS pageId,slug,title,content,revision,created_by_thread_id AS createdByThreadId,
      created_at AS createdAt,updated_at AS updatedAt,archived_at AS archivedAt FROM workspace_pages WHERE owner_id=? AND page_id=?`).get(ownerId, pageId);
    if (!row) throw pageError("PAGE_NOT_FOUND", "page not found", 404);
    const versions = db.prepare(`SELECT revision,thread_id AS threadId,action,candidate_hash AS candidateHash,created_at AS createdAt
      FROM workspace_page_versions WHERE owner_id=? AND page_id=? ORDER BY revision DESC LIMIT 50`).all(ownerId, pageId);
    return Object.freeze({ ...row, versions: Object.freeze(versions.map(Object.freeze)) });
  }
  return Object.freeze({
    listPages(ownerId) {
      opaqueId(ownerId, "ownerId");
      return Object.freeze(db.prepare(`SELECT page_id AS pageId,slug,title,revision,created_at AS createdAt,updated_at AS updatedAt,
        substr(content,1,180) AS preview FROM workspace_pages WHERE owner_id=? AND archived_at IS NULL ORDER BY updated_at DESC,page_id`).all(ownerId).map(Object.freeze));
    },
    getPage(ownerId, pageId) { opaqueId(ownerId, "ownerId"); opaqueId(pageId, "pageId"); return getPage(ownerId, pageId); },
    proposePageDraft(ownerId, threadId, { pageId = null, baseRevision = 0, action = "upsert", slug = "", title = "", content = "" } = {}) {
      opaqueId(ownerId, "ownerId"); requireThread(ownerId, threadId);
      if (!Number.isSafeInteger(baseRevision) || baseRevision < 0 || !["upsert", "delete"].includes(action)) throw pageError("INVALID_PAGE_DRAFT", "page draft action or base revision is invalid");
      let current = null;
      if (pageId !== null) {
        opaqueId(pageId, "pageId");
        current = db.prepare("SELECT slug,title,content,revision,archived_at FROM workspace_pages WHERE owner_id=? AND page_id=?").get(ownerId, pageId);
        if (!current) throw pageError("PAGE_NOT_FOUND", "page not found", 404);
        if (current.revision !== baseRevision || current.archived_at !== null) throw pageError("PAGE_REVISION_CONFLICT", "page revision is stale", 409);
      } else if (action !== "upsert" || baseRevision !== 0) throw pageError("INVALID_PAGE_DRAFT", "only a new page can omit pageId");
      const targetId = pageId ?? `page_${mintId()}`;
      if (action === "delete") ({ slug, title, content } = current);
      else if (!validSlug(slug) || typeof title !== "string" || !title.trim() || Buffer.byteLength(title) > 240 || typeof content !== "string" || Buffer.byteLength(content) > 262144) {
        throw pageError("INVALID_PAGE_CONTENT", "page requires a safe slug, title ≤240 bytes, and content ≤256 KiB");
      }
      const candidate = Object.freeze({ pageId: targetId, action, slug, title: title.trim(), content, baseRevision });
      const candidateJson = JSON.stringify(candidate);
      const candidateHash = createHash("sha256").update(candidateJson).digest("hex");
      const draftId = `draft_${mintId()}`;
      const createdAt = now();
      transaction(db, () => {
        if (action === "upsert" && db.prepare("SELECT 1 FROM workspace_pages WHERE owner_id=? AND slug=? AND page_id<>?").get(ownerId, slug, targetId)) throw pageError("PAGE_SLUG_CONFLICT", "slug already exists", 409);
        db.prepare(`INSERT INTO workspace_page_drafts(owner_id,draft_id,thread_id,page_id,base_revision,action,candidate_hash,candidate_json,status,created_at)
          VALUES (?,?,?,?,?,?,?,?,'pending',?)`).run(ownerId, draftId, threadId, targetId, baseRevision, action, candidateHash, candidateJson, createdAt);
      });
      return Object.freeze({ draftId, threadId, candidateHash, candidate, status: "pending", createdAt });
    },
    listPageDrafts(ownerId, threadId) {
      opaqueId(ownerId, "ownerId"); requireThread(ownerId, threadId);
      const rows = db.prepare(`SELECT draft_id AS draftId,thread_id AS threadId,page_id AS pageId,base_revision AS baseRevision,action,
        candidate_hash AS candidateHash,candidate_json AS candidate,status,created_at AS createdAt,decided_at AS decidedAt
        FROM workspace_page_drafts WHERE owner_id=? AND thread_id=? ORDER BY created_at DESC LIMIT 100`).all(ownerId, threadId);
      return Object.freeze(rows.map((row) => Object.freeze({ ...row, candidate: JSON.parse(row.candidate) })));
    },
    decidePageDraft(ownerId, threadId, draftId, { decision, candidateHash } = {}) {
      opaqueId(ownerId, "ownerId"); requireThread(ownerId, threadId);
      opaqueId(draftId, "draftId");
      if (!["approve", "decline"].includes(decision)) throw pageError("INVALID_PAGE_DECISION", "decision must be approve or decline");
      let stale = false;
      const result = transaction(db, () => {
        const draft = db.prepare("SELECT * FROM workspace_page_drafts WHERE owner_id=? AND draft_id=? AND thread_id=?").get(ownerId, draftId, threadId);
        if (!draft) throw pageError("PAGE_DRAFT_NOT_FOUND", "draft not found", 404);
        if (!hashMatches(draft.candidate_hash, candidateHash)) throw pageError("PAGE_DRAFT_HASH_MISMATCH", "decision hash does not match the reviewed draft", 409);
        if (draft.status !== "pending") throw pageError("PAGE_DRAFT_REPLAY", "draft already has a terminal decision", 409);
        const candidate = JSON.parse(draft.candidate_json);
        const current = db.prepare("SELECT * FROM workspace_pages WHERE owner_id=? AND page_id=?").get(ownerId, draft.page_id);
        if ((draft.base_revision === 0 && current) || (draft.base_revision > 0 && (!current || current.revision !== draft.base_revision || current.archived_at !== null))) {
          db.prepare("UPDATE workspace_page_drafts SET status='stale',decided_at=? WHERE owner_id=? AND draft_id=? AND status='pending'").run(now(), ownerId, draftId);
          stale = true; return null;
        }
        const decidedAt = now();
        if (decision === "decline") {
          db.prepare("UPDATE workspace_page_drafts SET status='rejected',decided_at=? WHERE owner_id=? AND draft_id=? AND status='pending'").run(decidedAt, ownerId, draftId);
          return Object.freeze({ decision, applied: false, draftId, candidateHash: draft.candidate_hash, decidedAt });
        }
        const revision = draft.base_revision + 1;
        if (draft.action === "delete") db.prepare("UPDATE workspace_pages SET revision=?,archived_at=?,updated_at=? WHERE owner_id=? AND page_id=? AND revision=?").run(revision, decidedAt, decidedAt, ownerId, draft.page_id, draft.base_revision);
        else if (draft.base_revision === 0) db.prepare(`INSERT INTO workspace_pages(owner_id,page_id,slug,title,content,revision,created_by_thread_id,created_at,updated_at)
          VALUES (?,?,?,?,?,1,?,?,?)`).run(ownerId, draft.page_id, candidate.slug, candidate.title, candidate.content, threadId, decidedAt, decidedAt);
        else db.prepare(`UPDATE workspace_pages SET slug=?,title=?,content=?,revision=?,updated_at=?,archived_at=NULL
          WHERE owner_id=? AND page_id=? AND revision=?`).run(candidate.slug, candidate.title, candidate.content, revision, decidedAt, ownerId, draft.page_id, draft.base_revision);
        db.prepare(`INSERT INTO workspace_page_versions(owner_id,page_id,revision,thread_id,action,candidate_hash,slug,title,content,created_at)
          VALUES (?,?,?,?,?,?,?,?,?,?)`).run(ownerId, draft.page_id, revision, threadId, draft.action, draft.candidate_hash, candidate.slug, candidate.title, candidate.content, decidedAt);
        db.prepare("UPDATE workspace_page_drafts SET status='approved',decided_at=? WHERE owner_id=? AND draft_id=? AND status='pending'").run(decidedAt, ownerId, draftId);
        return Object.freeze({ decision, applied: true, page: getPage(ownerId, draft.page_id), receipt: Object.freeze({ draftId, threadId, pageId: draft.page_id, decision, candidateHash: draft.candidate_hash, revision, decidedAt }) });
      });
      if (stale) throw pageError("PAGE_DRAFT_STALE", "page changed after this draft was created", 409);
      return result;
    }
  });
}
