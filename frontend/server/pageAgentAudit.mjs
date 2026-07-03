/**
 * PageAgent Audit — writes a JSONL audit record for every page_action.
 * Records are stored in data/pageagent-runs/<sessionId>/<timestamp>.jsonl
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const FRONTEND_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PROJECT_ROOT = path.resolve(FRONTEND_ROOT, "..");

/**
 * Write an audit record for a page action.
 * @param {object} record
 * @param {string} record.ts - ISO timestamp
 * @param {string} record.sessionId - Session identifier
 * @param {string} record.tool - Tool name (page_action)
 * @param {string} record.url - Target URL
 * @param {string} record.action - Action performed
 * @param {string} record.target - Target element
 * @param {string} [record.beforeHash] - SHA-1 before action
 * @param {string} [record.afterHash] - SHA-1 after action
 * @param {boolean} record.ok - Whether the action succeeded
 * @param {number} record.durationMs - Duration in milliseconds
 * @param {object} record.safety - Safety classification result
 * @returns {Promise<void>}
 */
export async function writeAuditRecord(record) {
  const auditDir = path.join(PROJECT_ROOT, "data", "pageagent-runs");
  const sessionDir = path.join(auditDir, String(record.sessionId || "default"));
  const fileName = `${formatTimestamp(record.ts)}.jsonl`;

  await fs.mkdir(sessionDir, { recursive: true });

  const line = JSON.stringify(record);
  await fs.appendFile(path.join(sessionDir, fileName), line + "\n", "utf8");
}

/**
 * Format an ISO timestamp into a file-safe YYYYMMDD-HHMMSS string.
 * @param {string} iso
 * @returns {string}
 */
function formatTimestamp(iso) {
  if (!iso) {
    const now = new Date();
    return `${now.toISOString().slice(0, 10).replace(/-/g, "")}-${now.toISOString().slice(11, 19).replace(/:/g, "")}`;
  }
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    const now = new Date();
    return `${now.toISOString().slice(0, 10).replace(/-/g, "")}-${now.toISOString().slice(11, 19).replace(/:/g, "")}`;
  }
  return `${d.toISOString().slice(0, 10).replace(/-/g, "")}-${d.toISOString().slice(11, 19).replace(/:/g, "")}`;
}

/**
 * Build an audit record object for a page action.
 * @param {object} params
 * @returns {object}
 */
export function buildAuditRecord(params = {}) {
  return {
    ts: params.ts || new Date().toISOString(),
    sessionId: params.sessionId || "unknown",
    tool: "page_action",
    url: params.url || "http://127.0.0.1:5173",
    action: params.action || "",
    target: params.target || "",
    beforeHash: params.beforeHash || "",
    afterHash: params.afterHash || "",
    ok: Boolean(params.ok),
    durationMs: params.durationMs || 0,
    safety: params.safety || {}
  };
}
