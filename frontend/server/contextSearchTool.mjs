import { readContextEvents } from "./contextLedger.mjs";
import { readContextEvidence } from "./contextEvidence.mjs";

export const CONTEXT_SEARCH_TOOL = {
  type: "function",
  function: {
    name: "context_search",
    description: "Search compact DS4 session context ledger and evidence. Use when the current capsule references prior decisions, evidence ids, files, or unresolved context that is not in the active prompt.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string" },
        limit: { type: "integer", minimum: 1, maximum: 20 }
      },
      required: ["query"]
    }
  }
};

function score(text, terms) {
  const hay = String(text || "").toLowerCase();
  return terms.reduce((n, term) => n + (hay.includes(term) ? 1 : 0), 0);
}

export async function contextSearch({ sessionKey, query, limit = 10 }) {
  const q = String(query || "").trim();
  if (!q) return { status: "error", error: "query is required", results: [] };
  const lim = Math.min(Math.max(Number(limit) || 10, 1), 20);
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);

  const events = await readContextEvents(sessionKey, { limit: 300 });
  const evidence = await readContextEvidence(sessionKey, { limit: 100 });

  const rows = [];
  for (const e of events) {
    const s = score(`${e.summary} ${e.target || ""}`, terms);
    if (s > 0) rows.push({ kind: e.type, id: e.id, summary: e.summary, evidenceIds: e.evidenceIds || [], _s: s });
  }
  for (const ev of evidence) {
    const s = score(`${ev.summary} ${ev.target || ""}`, terms);
    if (s > 0) rows.push({ kind: ev.kind, id: ev.id, summary: ev.summary, evidenceIds: [], _s: s });
  }
  rows.sort((a, b) => b._s - a._s);
  return { status: "ok", results: rows.slice(0, lim).map(({ _s, ...r }) => r) };
}
