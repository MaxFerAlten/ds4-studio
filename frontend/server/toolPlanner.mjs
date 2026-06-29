/**
 * Tool planner — deterministic, conservative.
 *
 * Today it covers one failure mode: the user explicitly asks to crawl/open
 * links, and the agent (left to the model) used to reply "run /crawl yourself"
 * instead of doing it.  When intent is unambiguous we return crawl actions so
 * the loop can run them; otherwise we return [] and tool choice stays with the
 * model.
 *
 * The web_search/research branch from the plan is intentionally deferred — the
 * model already drives web_search well, and forcing it here would fight it.
 */

import { extractUrls } from "./agentTaskState.mjs";

function mentionsCrawlAllUnopened(text) {
  return /link_found_not_opened|link non aperti|link trovati|tutti i link|all the links|every link|each link/.test(text)
    && /crawl|apri|leggi|estrai|naviga|open|read|fetch/.test(text);
}

function asksToOpenOrCrawl(text) {
  return /crawl|apri|leggi|estrai|visita|naviga|open|read|fetch/.test(text);
}

// A bare confirmation ("sì", "ok procedi", "go ahead") — the whole short
// message is just affirmation words, so it confirms the pending crawl rather
// than asking a new question. The word cap avoids firing on "sì, ma cerca".
const AFFIRM_WORDS = new Set([
  "sì", "si", "ok", "okay", "yes", "yep", "yeah", "sure", "certo", "d'accordo",
  "procedi", "prosegui", "vai", "fallo", "proceed", "go", "ahead", "do", "it"
]);
function isAffirmative(text) {
  const words = String(text || "").toLowerCase().replace(/[.!,?;:]/g, " ").split(/\s+/).filter(Boolean);
  return words.length > 0 && words.length <= 3 && words.every((w) => AFFIRM_WORDS.has(w));
}

/**
 * @param {{ userText: string, taskState: { unresolvedLinks: () => {url:string}[] },
 *           capabilities?: { crawl?: boolean } }} input
 * @returns {{ tool: string, args: object }[]}
 */
export function planTools({ userText, taskState, capabilities = {} }) {
  const text = String(userText || "").toLowerCase();
  if (!capabilities.crawl) return [];

  if (mentionsCrawlAllUnopened(text)) {
    return (taskState?.unresolvedLinks?.() || []).map((link) => ({
      tool: "crawl",
      args: { url: link.url, purpose: "open previously found link" }
    }));
  }

  // "sì / procedi" confirms a pending crawl of links found earlier (§18.7) —
  // execute it instead of bouncing an authorization request back to the user.
  if (isAffirmative(text)) {
    return (taskState?.unresolvedLinks?.() || []).map((link) => ({
      tool: "crawl",
      args: { url: link.url, purpose: "confirmed pending crawl" }
    }));
  }

  const urls = extractUrls(userText);
  if (urls.length && asksToOpenOrCrawl(text)) {
    return urls.map((url) => ({
      tool: "crawl",
      args: { url, purpose: "user requested URL" }
    }));
  }

  return [];
}
