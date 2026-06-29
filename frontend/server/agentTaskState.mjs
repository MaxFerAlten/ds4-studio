/**
 * Agent task state — derived (not stored) from the conversation transcript.
 *
 * The only thing the planner needs today is "which links did we surface but not
 * yet open?".  Deriving that from the messages array avoids a parallel mutable
 * store that both the SSE agent path and the native wrapper path would have to
 * keep in sync.
 */

// URLs run together with surrounding text; trailing punctuation is stripped.
const URL_RE = /\bhttps?:\/\/[^\s<>()[\]"'`]+/gi;

export function extractUrls(text) {
  const out = [];
  const seen = new Set();
  for (const match of String(text || "").matchAll(URL_RE)) {
    const url = match[0].replace(/[.,;:!?)\]}>"'`]+$/, "");
    if (url && !seen.has(url)) {
      seen.add(url);
      out.push(url);
    }
  }
  return out;
}

function normalizeUrl(url) {
  try {
    return new URL(url).href;
  } catch {
    return String(url);
  }
}

function messageText(message) {
  const content = message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((part) => (typeof part === "string" ? part : part?.text || "")).join(" ");
  }
  return "";
}

// Links the agent already acted on: the url argument of any prior crawl/web_read
// tool call in the transcript.
function openedUrls(messages) {
  const opened = new Set();
  for (const message of messages) {
    const calls = Array.isArray(message?.tool_calls) ? message.tool_calls : [];
    for (const call of calls) {
      const name = call?.function?.name;
      if (name !== "crawl" && name !== "web_read") continue;
      try {
        const args = JSON.parse(call.function.arguments || "{}");
        if (args.url) opened.add(normalizeUrl(args.url));
      } catch {
        /* ignore unparseable tool args */
      }
    }
  }
  return opened;
}

/**
 * URLs surfaced in user/assistant messages that have not yet been opened.
 * @returns {{ url: string }[]}
 */
export function unresolvedLinks(messages = []) {
  const opened = openedUrls(messages);
  const out = [];
  const seen = new Set();
  for (const message of messages) {
    // Only links the user pasted or the assistant deliberately surfaced —
    // not raw tool-result dumps (asset/tracking URLs would be noise).
    if (message?.role !== "user" && message?.role !== "assistant") continue;
    for (const url of extractUrls(messageText(message))) {
      const norm = normalizeUrl(url);
      if (opened.has(norm) || seen.has(norm)) continue;
      seen.add(norm);
      out.push({ url });
    }
  }
  return out;
}

export function createTaskState(messages = []) {
  return { unresolvedLinks: () => unresolvedLinks(messages) };
}
