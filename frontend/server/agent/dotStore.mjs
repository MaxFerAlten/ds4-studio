import { createHash, randomUUID } from "node:crypto";
import { AgentAdmissionError, opaqueId } from "../agentAdmission.mjs";
import { AGENT_TOOL_BY_NAME, AGENT_TOOL_NAMES } from "../agentToolCatalog.mjs";

const DOT_DENIED_TOOLS = new Set(["sage", "lean_check", "retrieve_context_blob", "page_snapshot", "page_action", "page_task"]);
const DOT_DENIED_SKILLS = new Set(["sage", "lean", "evidence-first-analysis"]);
const PROFILE_KEYS = new Set(["model", "temperature", "top_p", "top_k", "min_p", "max_tokens", "thinking", "reasoning_effort"]);
const SKILL_NAME = /^[a-z0-9](?:[a-z0-9-]{0,62})$/;

export function listDotToolOptions() {
  return Object.freeze(AGENT_TOOL_NAMES
    .filter((name) => !DOT_DENIED_TOOLS.has(name))
    .map((name) => Object.freeze({ id: name, description: AGENT_TOOL_BY_NAME.get(name)?.function?.description ?? "" })));
}

function transaction(db, operation) {
  db.exec("BEGIN IMMEDIATE");
  try { const value = operation(); db.exec("COMMIT"); return value; }
  catch (error) { try { db.exec("ROLLBACK"); } catch {} throw error; }
}

function dotError(code, message, status = 400) { return new AgentAdmissionError(code, message, status); }
function digest(value) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }

function normalizePreset(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw dotError("INVALID_DOT", "Dot must be an object");
  const keys = new Set(["instructions", "skills", "allowedTools", "allowedPageIds", "profile"]);
  if (Object.keys(input).some((key) => !keys.has(key))) throw dotError("INVALID_DOT", "Dot contains an unknown field");
  const instructions = input.instructions ?? "";
  if (typeof instructions !== "string" || Buffer.byteLength(instructions) > 8192) throw dotError("INVALID_DOT", "Dot instructions must be text up to 8 KiB");
  const skills = input.skills ?? [];
  if (!Array.isArray(skills) || skills.length > 32 || skills.some((name) => typeof name !== "string" || !SKILL_NAME.test(name) || DOT_DENIED_SKILLS.has(name)) || new Set(skills).size !== skills.length) {
    throw dotError("DOT_SKILL_UNAVAILABLE", "Dot skills must be unique isolated skill names");
  }
  const allowedTools = input.allowedTools ?? [];
  if (!Array.isArray(allowedTools) || allowedTools.length > 32 || allowedTools.some((name) => typeof name !== "string" || !AGENT_TOOL_NAMES.includes(name) || DOT_DENIED_TOOLS.has(name)) || new Set(allowedTools).size !== allowedTools.length) {
    throw dotError("DOT_TOOL_UNAVAILABLE", "Dot contains an unknown, shared-state, or non-scoped tool");
  }
  const allowedPageIds = input.allowedPageIds ?? [];
  if (!Array.isArray(allowedPageIds) || allowedPageIds.length > 32 || allowedPageIds.some((id) => typeof id !== "string") || new Set(allowedPageIds).size !== allowedPageIds.length) {
    throw dotError("INVALID_DOT", "Dot page scope must contain unique page ids");
  }
  const profile = input.profile ?? {};
  if (!profile || typeof profile !== "object" || Array.isArray(profile) || Object.keys(profile).some((key) => !PROFILE_KEYS.has(key))) throw dotError("INVALID_DOT_PROFILE", "Dot profile contains an unsupported field");
  const normalizedProfile = {};
  if (profile.model !== undefined) {
    if (typeof profile.model !== "string" || !profile.model.trim() || Buffer.byteLength(profile.model) > 240) throw dotError("INVALID_DOT_PROFILE", "model must be non-empty text up to 240 bytes");
    normalizedProfile.model = profile.model.trim();
  }
  for (const key of ["temperature", "top_p", "top_k", "min_p"]) {
    if (profile[key] !== undefined) {
      const value = Number(profile[key]);
      if (!Number.isFinite(value) || value < 0 || value > (key === "temperature" || key === "top_p" ? 2 : 100)) throw dotError("INVALID_DOT_PROFILE", `${key} is outside its supported range`);
      normalizedProfile[key] = value;
    }
  }
  if (profile.max_tokens !== undefined) {
    if (!Number.isSafeInteger(profile.max_tokens) || profile.max_tokens < 1 || profile.max_tokens > 131072) throw dotError("INVALID_DOT_PROFILE", "max_tokens is outside its supported range");
    normalizedProfile.max_tokens = profile.max_tokens;
  }
  if (profile.thinking !== undefined && typeof profile.thinking !== "boolean") throw dotError("INVALID_DOT_PROFILE", "thinking must be a boolean");
  if (profile.thinking !== undefined) normalizedProfile.thinking = profile.thinking;
  if (profile.reasoning_effort !== undefined) {
    if (typeof profile.reasoning_effort !== "string" || !["low", "medium", "high"].includes(profile.reasoning_effort)) throw dotError("INVALID_DOT_PROFILE", "reasoning_effort must be low, medium, or high");
    normalizedProfile.reasoning_effort = profile.reasoning_effort;
  }
  return Object.freeze({ instructions, skills: Object.freeze([...skills].sort()), allowedTools: Object.freeze([...allowedTools].sort()), allowedPageIds: Object.freeze([...allowedPageIds].sort()), profile: Object.freeze(normalizedProfile) });
}

export function migrateDotSchema(db) {
  const version = db.prepare("PRAGMA user_version").get().user_version;
  if (version > 6) throw Object.assign(new Error(`database schema ${version} is newer than supported 6`), { code: "LOCAL_THREADS_SCHEMA_NEWER" });
  if (version === 6) return;
  if (version !== 5) throw Object.assign(new Error(`Dot schema requires workspace schema v5, found ${version}`), { code: "LOCAL_THREADS_SCHEMA_ORDER" });
  transaction(db, () => db.exec(`
    CREATE TABLE workspace_dots (
      owner_id TEXT NOT NULL, dot_id TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision > 0),
      name TEXT NOT NULL, preset_json TEXT NOT NULL, preset_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, archived_at INTEGER,
      PRIMARY KEY(owner_id,dot_id), UNIQUE(owner_id,name)
    );
    CREATE TABLE workspace_dot_versions (
      owner_id TEXT NOT NULL, dot_id TEXT NOT NULL, revision INTEGER NOT NULL,
      preset_json TEXT NOT NULL, preset_hash TEXT NOT NULL, created_at INTEGER NOT NULL,
      PRIMARY KEY(owner_id,dot_id,revision),
      FOREIGN KEY(owner_id,dot_id) REFERENCES workspace_dots(owner_id,dot_id) ON DELETE CASCADE
    );
    CREATE TABLE thread_dot_bindings (
      owner_id TEXT NOT NULL, thread_id TEXT NOT NULL, dot_id TEXT NOT NULL,
      dot_revision INTEGER NOT NULL, bound_at INTEGER NOT NULL, PRIMARY KEY(thread_id),
      FOREIGN KEY(thread_id) REFERENCES threads(thread_id) ON DELETE CASCADE,
      FOREIGN KEY(owner_id,dot_id,dot_revision) REFERENCES workspace_dot_versions(owner_id,dot_id,revision)
    );
    CREATE INDEX workspace_dots_owner_updated ON workspace_dots(owner_id,updated_at DESC,dot_id);
    PRAGMA user_version = 6;
  `));
}

export function createDotStore({ db, requireThread, getPage = null, mintId = () => randomUUID(), now = () => Date.now() }) {
  function publicDot(row) {
    const preset = JSON.parse(row.preset_json);
    return Object.freeze({ dotId: row.dot_id, name: row.name, revision: row.revision, hash: row.preset_hash, ...preset, createdAt: row.created_at, updatedAt: row.updated_at });
  }
  function version(ownerId, dotId, revision) {
    const row = db.prepare("SELECT * FROM workspace_dot_versions WHERE owner_id=? AND dot_id=? AND revision=?").get(ownerId, dotId, revision);
    if (!row) throw dotError("DOT_NOT_FOUND", "Dot version not found", 404);
    return row;
  }
  return Object.freeze({
    createDot(ownerId, { name, ...input } = {}) {
      opaqueId(ownerId, "ownerId");
      if (typeof name !== "string" || !name.trim() || Buffer.byteLength(name) > 120) throw dotError("INVALID_DOT_NAME", "Dot name must be text up to 120 bytes");
      const preset = normalizePreset(input); const presetJson = JSON.stringify(preset); const presetHash = digest(preset);
      const dotId = `dot_${mintId()}`; const timestamp = now();
      transaction(db, () => {
        if (db.prepare("SELECT 1 FROM workspace_dots WHERE owner_id=? AND name=?").get(ownerId, name.trim())) throw dotError("DOT_NAME_CONFLICT", "Dot name already exists", 409);
        db.prepare("INSERT INTO workspace_dots(owner_id,dot_id,revision,name,preset_json,preset_hash,created_at,updated_at) VALUES (?,?,1,?,?,?,?,?)").run(ownerId, dotId, name.trim(), presetJson, presetHash, timestamp, timestamp);
        db.prepare("INSERT INTO workspace_dot_versions(owner_id,dot_id,revision,preset_json,preset_hash,created_at) VALUES (?,?,1,?,?,?)").run(ownerId, dotId, presetJson, presetHash, timestamp);
      });
      return publicDot(db.prepare("SELECT * FROM workspace_dots WHERE owner_id=? AND dot_id=?").get(ownerId, dotId));
    },
    listDots(ownerId) {
      opaqueId(ownerId, "ownerId");
      return Object.freeze(db.prepare("SELECT * FROM workspace_dots WHERE owner_id=? AND archived_at IS NULL ORDER BY updated_at DESC,dot_id").all(ownerId).map(publicDot));
    },
    getDot(ownerId, dotId) {
      opaqueId(ownerId, "ownerId"); opaqueId(dotId, "dotId");
      const row = db.prepare("SELECT * FROM workspace_dots WHERE owner_id=? AND dot_id=? AND archived_at IS NULL").get(ownerId, dotId);
      if (!row) throw dotError("DOT_NOT_FOUND", "Dot not found", 404);
      return publicDot(row);
    },
    updateDot(ownerId, dotId, { baseRevision, name, ...input } = {}) {
      opaqueId(ownerId, "ownerId"); opaqueId(dotId, "dotId");
      if (!Number.isSafeInteger(baseRevision) || baseRevision < 1) throw dotError("INVALID_DOT_REVISION", "baseRevision must be positive");
      if (typeof name !== "string" || !name.trim() || Buffer.byteLength(name) > 120) throw dotError("INVALID_DOT_NAME", "Dot name must be text up to 120 bytes");
      const preset = normalizePreset(input); const presetJson = JSON.stringify(preset); const presetHash = digest(preset); const timestamp = now();
      transaction(db, () => {
        const row = db.prepare("SELECT revision FROM workspace_dots WHERE owner_id=? AND dot_id=? AND archived_at IS NULL").get(ownerId, dotId);
        if (!row) throw dotError("DOT_NOT_FOUND", "Dot not found", 404);
        if (row.revision !== baseRevision) throw dotError("DOT_REVISION_CONFLICT", "Dot changed since it was opened", 409);
        if (db.prepare("SELECT 1 FROM workspace_dots WHERE owner_id=? AND name=? AND dot_id<>?").get(ownerId, name.trim(), dotId)) throw dotError("DOT_NAME_CONFLICT", "Dot name already exists", 409);
        const next = baseRevision + 1;
        db.prepare("UPDATE workspace_dots SET revision=?,name=?,preset_json=?,preset_hash=?,updated_at=? WHERE owner_id=? AND dot_id=? AND revision=?").run(next, name.trim(), presetJson, presetHash, timestamp, ownerId, dotId, baseRevision);
        db.prepare("INSERT INTO workspace_dot_versions(owner_id,dot_id,revision,preset_json,preset_hash,created_at) VALUES (?,?,?,?,?,?)").run(ownerId, dotId, next, presetJson, presetHash, timestamp);
      });
      return this.getDot(ownerId, dotId);
    },
    bindThreadDot(ownerId, threadId, dotId, revision) {
      const thread = requireThread(ownerId, threadId);
      if (thread.revision !== 0) throw dotError("DOT_THREAD_TRANSITION_REQUIRED", "a Dot cannot be changed after a thread has started; create a new thread", 409);
      if (dotId === null) { transaction(db, () => db.prepare("DELETE FROM thread_dot_bindings WHERE owner_id=? AND thread_id=?").run(ownerId, threadId)); return null; }
      opaqueId(dotId, "dotId");
      const preset = version(ownerId, dotId, revision);
      const dot = db.prepare("SELECT archived_at FROM workspace_dots WHERE owner_id=? AND dot_id=?").get(ownerId, dotId);
      if (!dot || dot.archived_at !== null) throw dotError("DOT_NOT_FOUND", "Dot not found", 404);
      transaction(db, () => db.prepare(`INSERT INTO thread_dot_bindings(owner_id,thread_id,dot_id,dot_revision,bound_at) VALUES (?,?,?,?,?)
        ON CONFLICT(thread_id) DO UPDATE SET dot_id=excluded.dot_id,dot_revision=excluded.dot_revision,bound_at=excluded.bound_at WHERE owner_id=excluded.owner_id`)
        .run(ownerId, threadId, dotId, preset.revision, now()));
      return this.resolveThreadDot(ownerId, threadId);
    },
    resolveThreadDot(ownerId, threadId) {
      requireThread(ownerId, threadId);
      const binding = db.prepare("SELECT dot_id,dot_revision FROM thread_dot_bindings WHERE owner_id=? AND thread_id=?").get(ownerId, threadId);
      if (!binding) return null;
      const row = version(ownerId, binding.dot_id, binding.dot_revision);
      const dot = db.prepare("SELECT name FROM workspace_dots WHERE owner_id=? AND dot_id=?").get(ownerId, binding.dot_id);
      if (!dot) throw dotError("DOT_NOT_FOUND", "bound Dot was removed", 404);
      const preset = JSON.parse(row.preset_json);
      const pages = [];
      if (preset.allowedPageIds.length && typeof getPage !== "function") throw dotError("DOT_PAGE_SCOPE_UNAVAILABLE", "page scope is not available", 409);
      let totalBytes = 0;
      for (const pageId of preset.allowedPageIds) {
        const page = getPage(ownerId, pageId);
        if (page.archivedAt !== null) throw dotError("DOT_PAGE_UNAVAILABLE", "a scoped page is archived", 409);
        totalBytes += Buffer.byteLength(page.content);
        if (totalBytes > 65536) throw dotError("DOT_PAGE_CONTEXT_TOO_LARGE", "scoped page context exceeds 64 KiB", 413);
        pages.push(Object.freeze({ pageId: page.pageId, revision: page.revision, title: page.title, content: page.content }));
      }
      return Object.freeze({ dotId: binding.dot_id, revision: binding.dot_revision, name: dot.name, hash: row.preset_hash, ...preset, pages: Object.freeze(pages) });
    }
  });
}
