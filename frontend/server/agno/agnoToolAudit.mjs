/**
 * JSONL audit writer for Agno tool executions.
 *
 * One shared daily file (UTC date) at data/agno/tool-audit/<YYYY-MM-DD>.jsonl,
 * appended to via fs.appendFile — no in-memory buffering, every write()
 * lands on disk before it resolves.
 *
 * Records never carry raw arguments, for any tool: only a stable sha256
 * digest of the argument object. This is a deliberate universal rule (not
 * a bash/write/edit special case) since tool arguments may contain file
 * contents, shell commands, or other sensitive text worth keeping out of a
 * retained audit trail.
 */
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

// This file lives in frontend/server/agno/, one level deeper than the
// frontend/server/pageAgentAudit.mjs precedent this mirrors, hence "../..".
const FRONTEND_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const PROJECT_ROOT = path.resolve(FRONTEND_ROOT, "..");
const DEFAULT_AUDIT_DIR = path.join(PROJECT_ROOT, "data", "agno", "tool-audit");

export class AgnoToolAudit {
  constructor({ auditDir = DEFAULT_AUDIT_DIR } = {}) {
    this.auditDir = auditDir;
  }

  /**
   * @param {object} record
   * @param {string} record.toolName
   * @param {string} [record.sessionId]
   * @param {string} [record.runId]
   * @param {object} [record.args] - digested, never written verbatim
   * @param {boolean} [record.isError]
   * @param {boolean} [record.guarded]
   * @param {number} [record.durationMs]
   * @param {string} [record.content] - used only to derive contentBytes
   * @param {number} [record.contentBytes] - takes precedence over record.content if given
   * @param {string} [record.ts] - ISO timestamp; defaults to now
   */
  async write(record = {}) {
    const ts = record.ts || new Date().toISOString();
    const line = JSON.stringify({
      ts,
      runId: record.runId ?? null,
      sessionId: record.sessionId ?? null,
      toolName: record.toolName ?? null,
      argumentDigest: digestArgs(record.args),
      isError: Boolean(record.isError),
      guarded: Boolean(record.guarded),
      durationMs: Number.isFinite(record.durationMs) ? record.durationMs : null,
      contentBytes: resolveContentBytes(record.content, record.contentBytes)
    });

    await fs.mkdir(this.auditDir, { recursive: true });
    await fs.appendFile(path.join(this.auditDir, `${utcDate(ts)}.jsonl`), `${line}\n`, "utf8");
  }
}

function utcDate(ts) {
  const d = new Date(ts);
  return Number.isNaN(d.getTime())
    ? new Date().toISOString().slice(0, 10)
    : d.toISOString().slice(0, 10);
}

function resolveContentBytes(content, explicitBytes) {
  if (Number.isFinite(explicitBytes)) return explicitBytes;
  if (typeof content === "string") return Buffer.byteLength(content, "utf8");
  return 0;
}

/** sha256:<hex> digest of a stable (key-sorted) JSON stringification of args. */
export function digestArgs(args) {
  const hash = crypto.createHash("sha256").update(stableStringify(args ?? {}), "utf8").digest("hex");
  return `sha256:${hash}`;
}

function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
}
