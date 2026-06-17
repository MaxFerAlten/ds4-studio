import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { parseEventLines, serializeEvent } from "./researchEvents.mjs";
import { buildIndex, chunkDocument } from "./researchRag.mjs";

const SESSION_ID_PATTERN = /^rs_[a-f0-9]{12}$/;
const ENGINES = new Set(["local", "gemini", "prism"]);

export function newSessionId() {
  return `rs_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

export function normalizeResearchEngine(engine) {
  return ENGINES.has(engine) ? engine : "local";
}

export function initialState(query, { sessionId = newSessionId(), now = new Date(), engine = "local" } = {}) {
  const ts = now.toISOString();
  return {
    sessionId,
    threadId: sessionId,
    engine: normalizeResearchEngine(engine),
    interactionId: null,
    status: "running",
    query,
    createdAt: ts,
    updatedAt: ts,
    seq: 0,
    iteration: 0,
    planIterations: 0,
    currentPlan: null,
    optimizedQueries: [],
    observations: [],
    sources: [],
    documents: [],
    finalReport: null,
    reflectionAttempts: 0,
    reflectionHint: "",
    nodes: {},
    feedback: null,
    error: null
  };
}

export class ResearchStateStore {
  constructor({ rootDir }) {
    if (!rootDir) throw new Error("rootDir is required");
    this.rootDir = rootDir;
  }

  sessionDir(sessionId) {
    if (!SESSION_ID_PATTERN.test(String(sessionId))) {
      throw Object.assign(new Error(`invalid sessionId: ${sessionId}`), { status: 400 });
    }
    return path.join(this.rootDir, "sessions", sessionId);
  }

  statePath(sessionId) {
    return path.join(this.sessionDir(sessionId), "state.json");
  }

  eventsPath(sessionId) {
    return path.join(this.sessionDir(sessionId), "events.ndjson");
  }

  async createSession(query, options = {}) {
    const state = initialState(query, options);
    await fs.mkdir(this.sessionDir(state.sessionId), { recursive: true });
    await this.saveState(state);
    return state;
  }

  async loadState(sessionId) {
    const raw = await fs.readFile(this.statePath(sessionId), "utf8").catch((err) => {
      if (err.code === "ENOENT") return null;
      throw err;
    });
    return raw === null ? null : JSON.parse(raw);
  }

  async saveState(state) {
    state.updatedAt = new Date().toISOString();
    const target = this.statePath(state.sessionId);
    const tmp = `${target}.tmp`;
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(tmp, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    await fs.rename(tmp, target);
    return state;
  }

  async appendEvent(event) {
    await fs.appendFile(this.eventsPath(event.sessionId), serializeEvent(event), "utf8");
  }

  async readEvents(sessionId) {
    const raw = await fs.readFile(this.eventsPath(sessionId), "utf8").catch((err) => {
      if (err.code === "ENOENT") return "";
      throw err;
    });
    return raw ? parseEventLines(raw) : [];
  }

  async listSessions() {
    const dir = path.join(this.rootDir, "sessions");
    const entries = await fs.readdir(dir).catch((err) => {
      if (err.code === "ENOENT") return [];
      throw err;
    });
    const summaries = await Promise.all(
      entries
        .filter((name) => SESSION_ID_PATTERN.test(name))
        .map(async (sessionId) => {
          const state = await this.loadState(sessionId).catch(() => null);
          if (
            !state ||
            state.sessionId !== sessionId ||
            typeof state.query !== "string" ||
            typeof state.status !== "string" ||
            typeof state.createdAt !== "string" ||
            typeof state.updatedAt !== "string"
          ) {
            return null;
          }
          return {
            sessionId,
            query: state.query,
            status: state.status,
            engine: normalizeResearchEngine(state.engine),
            createdAt: state.createdAt,
            updatedAt: state.updatedAt
          };
        })
    );
    return summaries
      .filter(Boolean)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.sessionId.localeCompare(a.sessionId));
  }

  // --- per-session document store (RAG corpus) -----------------------------

  documentsDir(sessionId) {
    return path.join(this.sessionDir(sessionId), "documents");
  }

  manifestPath(sessionId) {
    return path.join(this.documentsDir(sessionId), "manifest.json");
  }

  // Ingest already-extracted markdown into the session's RAG corpus: chunk it,
  // persist the chunks, and record it in the manifest. Returns the new doc.
  async addDocument(sessionId, { name, markdown }) {
    if (!markdown || !String(markdown).trim()) {
      throw Object.assign(new Error("document markdown is empty"), { status: 400 });
    }
    const dir = this.documentsDir(sessionId);
    await fs.mkdir(dir, { recursive: true });
    const manifest = await this.loadManifest(sessionId);
    const docId = `doc${String(manifest.length).padStart(3, "0")}`;
    const chunks = chunkDocument(markdown, { docId });
    await fs.writeFile(
      path.join(dir, `${docId}.chunks.json`),
      `${JSON.stringify(chunks)}\n`,
      "utf8"
    );
    const entry = {
      docId,
      name: name || docId,
      chunkCount: chunks.length,
      addedAt: new Date().toISOString()
    };
    manifest.push(entry);
    const tmp = `${this.manifestPath(sessionId)}.tmp`;
    await fs.writeFile(tmp, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    await fs.rename(tmp, this.manifestPath(sessionId));
    return entry;
  }

  async loadManifest(sessionId) {
    const raw = await fs.readFile(this.manifestPath(sessionId), "utf8").catch((err) => {
      if (err.code === "ENOENT") return "[]";
      throw err;
    });
    return JSON.parse(raw);
  }

  async loadDocuments(sessionId) {
    return this.loadManifest(sessionId);
  }

  // Concatenate every persisted chunk across all documents in the session.
  async loadAllChunks(sessionId) {
    const manifest = await this.loadManifest(sessionId);
    const all = [];
    for (const doc of manifest) {
      const raw = await fs
        .readFile(path.join(this.documentsDir(sessionId), `${doc.docId}.chunks.json`), "utf8")
        .catch((err) => {
          if (err.code === "ENOENT") return "[]";
          throw err;
        });
      for (const chunk of JSON.parse(raw)) all.push(chunk);
    }
    return all;
  }

  // Build a fresh BM25 index over all chunks, or null if the corpus is empty.
  async loadRagIndex(sessionId) {
    const chunks = await this.loadAllChunks(sessionId);
    if (!chunks.length) return null;
    return { index: buildIndex(chunks), chunks };
  }
}
