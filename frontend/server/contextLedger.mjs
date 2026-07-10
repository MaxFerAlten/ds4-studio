import fs from "node:fs/promises";
import crypto from "node:crypto";
import { sessionLedgerPath, safeContextKey } from "./contextPaths.mjs";
import { appendJsonlCapped, DEFAULT_MAX_EVENTS } from "./contextJsonl.mjs";

const ALLOWED_TYPES = new Set([
  "user_goal", "tool_call", "tool_result", "decision", "open_question",
  "claim", "file_read", "error", "loop_guard", "context_preflight"
]);

function eventId() {
  return `evt_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
}

export function normalizeContextEvent(sessionKey, event = {}) {
  const type = ALLOWED_TYPES.has(event.type) ? event.type : "tool_result";
  return {
    id: event.id || eventId(),
    at: event.at || new Date().toISOString(),
    sessionKeyHash: safeContextKey(sessionKey),
    type,
    source: String(event.source || "agent").slice(0, 80),
    target: event.target ? String(event.target).slice(0, 300) : null,
    summary: String(event.summary || "").replace(/\s+/g, " ").trim().slice(0, 1200),
    evidenceIds: Array.isArray(event.evidenceIds) ? event.evidenceIds.slice(0, 20) : [],
    blobIds: Array.isArray(event.blobIds) ? event.blobIds.slice(0, 20) : [],
    meta: event.meta && typeof event.meta === "object" ? event.meta : {}
  };
}

export async function appendContextEvent(sessionKey, event, { maxEvents = DEFAULT_MAX_EVENTS } = {}) {
  const normalized = normalizeContextEvent(sessionKey, event);
  await appendJsonlCapped(sessionLedgerPath(sessionKey), normalized, maxEvents);
  return normalized;
}

export async function readContextEvents(sessionKey, { limit = 200 } = {}) {
  const file = sessionLedgerPath(sessionKey);
  let text = "";
  try {
    text = await fs.readFile(file, "utf8");
  } catch (err) {
    if (err?.code === "ENOENT") return [];
    throw err;
  }
  const rows = text.split(/\r?\n/).filter(Boolean);
  return rows.slice(Math.max(0, rows.length - limit)).map((line) => JSON.parse(line));
}
