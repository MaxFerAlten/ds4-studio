import fs from "node:fs/promises";
import crypto from "node:crypto";
import { sessionEvidencePath } from "./contextPaths.mjs";
import { appendJsonlCapped, DEFAULT_MAX_EVENTS } from "./contextJsonl.mjs";

// §23.4 privacy stop: never persist secret-like content into evidence/ledger.
export function looksSecretLike(text) {
  return /(BEGIN PRIVATE KEY|Authorization:\s*Bearer|API_KEY\s*=|password\s*=|token\s*=)/i.test(String(text || ""));
}

export function makeEvidenceId() {
  return `ev_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
}

export function summarizeToolResultForEvidence({ tool, args, resultText, compressedText, blobIds = [] }) {
  const target = args?.path || args?.url || args?.query || args?.command || null;
  const raw = String(compressedText || resultText || "");
  const trimmed = raw.replace(/\s+/g, " ").slice(0, 800).trim();
  const summary = looksSecretLike(raw) ? "[redacted: secret-like content omitted]" : trimmed;
  return {
    id: makeEvidenceId(),
    at: new Date().toISOString(),
    kind: inferKind(tool),
    source: String(tool || "tool"),
    target: target ? String(target).slice(0, 300) : null,
    quality: resultText ? "derived" : "unverified",
    summary,
    claims: [],
    limitations: blobIds.length ? ["Full output stored in blob store; summary is lossy."] : [],
    blobIds,
    stale: false,
    meta: {}
  };
}

function inferKind(tool) {
  if (tool === "read") return "file_read";
  if (/crawl/i.test(tool || "")) return "crawl";
  if (/search/i.test(tool || "")) return "search";
  if (/pageagent/i.test(tool || "")) return "pageagent";
  if (/gitnexus/i.test(tool || "")) return "gitnexus";
  return "tool_result";
}

export async function appendContextEvidence(sessionKey, item, { maxEvents = DEFAULT_MAX_EVENTS } = {}) {
  await appendJsonlCapped(sessionEvidencePath(sessionKey), item, maxEvents);
  return item;
}

/**
 * Mark prior evidence items stale when their target is superseded (e.g. a file
 * is written/edited after being read). Rewrites the JSONL in place; returns the
 * number of items flipped. Only touches the given kinds (default: read/crawl
 * snapshots) so write/edit evidence for the same target stays authoritative.
 */
export async function markEvidenceStaleByTarget(sessionKey, target, { kinds = ["file_read", "crawl"] } = {}) {
  if (!target) return 0;
  const file = sessionEvidencePath(sessionKey);
  let text = "";
  try {
    text = await fs.readFile(file, "utf8");
  } catch (err) {
    if (err?.code === "ENOENT") return 0;
    throw err;
  }
  const kindSet = new Set(kinds);
  let flipped = 0;
  const rows = text.split(/\r?\n/).filter(Boolean).map((line) => {
    const item = JSON.parse(line);
    if (!item.stale && item.target === target && kindSet.has(item.kind)) {
      item.stale = true;
      flipped++;
    }
    return item;
  });
  if (flipped) await fs.writeFile(file, `${rows.map((r) => JSON.stringify(r)).join("\n")}\n`, "utf8");
  return flipped;
}

export async function readContextEvidence(sessionKey, { limit = 100 } = {}) {
  const file = sessionEvidencePath(sessionKey);
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
