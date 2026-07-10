import fs from "node:fs/promises";
import { sessionTelemetryPath, safeContextKey } from "./contextPaths.mjs";
import { appendJsonlCapped, DEFAULT_MAX_EVENTS } from "./contextJsonl.mjs";

const MAX_STR = 300;
// Fields that could carry raw/capsule content — never persisted to telemetry.
const FORBIDDEN_KEYS = new Set(["text", "capsuleText", "content", "capsule"]);

export function sanitizeTelemetryEvent(sessionKey, event = {}) {
  const out = {
    event: "context_preflight",
    at: new Date().toISOString(),
    sessionKeyHash: safeContextKey(sessionKey)
  };
  for (const [key, value] of Object.entries(event)) {
    if (FORBIDDEN_KEYS.has(key)) continue;
    if (key === "at" || key === "sessionKeyHash") continue;
    if (typeof value === "string") {
      out[key] = value.slice(0, MAX_STR);
    } else if (Array.isArray(value)) {
      out[key] = value.map((v) => (typeof v === "string" ? v.slice(0, MAX_STR) : v)).slice(0, 40);
    } else {
      out[key] = value;
    }
  }
  return out;
}

export async function appendContextTelemetry(sessionKey, event, { enabled = true, maxEvents = DEFAULT_MAX_EVENTS } = {}) {
  if (!enabled) return null;
  const sanitized = sanitizeTelemetryEvent(sessionKey, event);
  await appendJsonlCapped(sessionTelemetryPath(sessionKey), sanitized, maxEvents);
  return sanitized;
}

export async function readContextTelemetry(sessionKey, { limit = 200 } = {}) {
  const file = sessionTelemetryPath(sessionKey);
  let text = "";
  try {
    text = await fs.readFile(file, "utf8");
  } catch (err) {
    if (err?.code === "ENOENT") return [];
    throw err;
  }
  const rows = text.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
  return rows.slice(Math.max(0, rows.length - limit));
}
