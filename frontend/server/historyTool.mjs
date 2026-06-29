/**
 * History tool — makes the chat transcript queryable instead of a one-shot
 * text preamble. Lets the agent recover prior links, pending actions, tool
 * results, and claims when the user says "those", "the links", "before",
 * "every LINK_FOUND_NOT_OPENED" — without asking the user to repeat them.
 */

import { extractUrls } from "./agentTaskState.mjs";
import { extractClaims } from "./evidenceStore.mjs";

const PENDING_RE = /LINK_FOUND_NOT_OPENED|da aprire|non aperti|link trovati|to crawl|to open/i;

function messageText(message) {
  const content = message?.content;
  let base = "";
  if (typeof content === "string") base = content;
  else if (Array.isArray(content)) base = content.map((p) => (typeof p === "string" ? p : p?.text || "")).join(" ");
  const reasoning = message?.reasoning || message?.reasoning_content || "";
  return `${base}\n${reasoning}`.trim();
}

function contextAround(text, needle, span = 120) {
  const at = text.indexOf(needle);
  if (at < 0) return text.slice(0, span);
  return text.slice(Math.max(0, at - span), at + needle.length + span).trim();
}

function truncate(text, max) {
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}

/**
 * @param {object[]} messages chat transcript
 * @param {{ query?: string, kind?: string, maxResults?: number }} [opts]
 * @returns {{ index, role, kind, url?, text }[]}
 */
export function searchChatHistory(messages = [], { query, kind = "all", maxResults = 10 } = {}) {
  const q = String(query || "").toLowerCase();
  const wantLinks = kind === "links" || kind === "all";
  const wantPending = kind === "pending_actions" || kind === "all";
  const wantTool = kind === "tool_results" || kind === "all";
  const wantClaims = kind === "claims" || kind === "all";
  const rows = [];
  const seenLinks = new Set();

  messages.forEach((msg, index) => {
    const text = messageText(msg);
    if (!text) return;
    const lower = text.toLowerCase();

    if (wantLinks) {
      for (const url of extractUrls(text)) {
        if (seenLinks.has(url)) continue; // dedupe links across the whole history
        seenLinks.add(url);
        rows.push({ index, role: msg.role, kind: "link", url, text: contextAround(text, url) });
      }
    }
    if (wantPending && PENDING_RE.test(text)) {
      rows.push({ index, role: msg.role, kind: "pending_action", text: text.slice(0, 500) });
    }
    if (wantTool && msg.role === "tool" && (!q || lower.includes(q))) {
      rows.push({ index, role: msg.role, kind: "tool_result", text: text.slice(0, 500) });
    }
    if (wantClaims && msg.role === "assistant") {
      for (const c of extractClaims(text, { max: 3 })) {
        if (!q || c.claim.toLowerCase().includes(q)) {
          rows.push({ index, role: msg.role, kind: "claim", text: c.claim });
        }
      }
    }
    if (kind === "all" && q && lower.includes(q)) {
      rows.push({ index, role: msg.role, kind: "match", text: text.slice(0, 500) });
    }
  });

  return rows.slice(0, maxResults);
}

export function formatHistoryResults(rows, { query } = {}) {
  if (!rows.length) return `No matching chat history${query ? ` for "${query}"` : ""}.`;
  const lines = [`Found ${rows.length} history item${rows.length !== 1 ? "s" : ""}:`];
  for (const r of rows) {
    if (r.kind === "link") lines.push(`- [link] (#${r.index} ${r.role}) ${r.url}`);
    else lines.push(`- [${r.kind}] (#${r.index} ${r.role}) ${truncate(r.text, 200)}`);
  }
  return lines.join("\n");
}
