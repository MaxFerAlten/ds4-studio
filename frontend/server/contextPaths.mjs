import crypto from "node:crypto";
import path from "node:path";

const CONTEXT_ROOT = path.resolve("data", "agent-context");

export function safeContextKey(value) {
  return crypto.createHash("sha1").update(String(value || "default")).digest("hex");
}

export function workspaceHash(workspace) {
  return safeContextKey(path.resolve(String(workspace || process.cwd())));
}

export function contextRoot() {
  return CONTEXT_ROOT;
}

export function sessionContextDir(sessionKey) {
  return path.join(CONTEXT_ROOT, "sessions", safeContextKey(sessionKey));
}

export function projectContextDir(workspace) {
  return path.join(CONTEXT_ROOT, "projects", workspaceHash(workspace));
}

export function sessionLedgerPath(sessionKey) {
  return path.join(sessionContextDir(sessionKey), "ledger.jsonl");
}

export function sessionEvidencePath(sessionKey) {
  return path.join(sessionContextDir(sessionKey), "evidence.jsonl");
}

export function sessionCapsulePath(sessionKey) {
  return path.join(sessionContextDir(sessionKey), "capsule.md");
}

export function sessionCapsuleMetaPath(sessionKey) {
  return path.join(sessionContextDir(sessionKey), "capsule-meta.json");
}

export function sessionTelemetryPath(sessionKey) {
  return path.join(sessionContextDir(sessionKey), "telemetry.jsonl");
}
