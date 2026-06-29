/**
 * Crawl summarizer — turns a crawl result manifest into bounded, structured
 * text for the agent.  The agent must synthesize from this, never paste it back
 * verbatim, so per-page content is truncated rather than dumped wholesale.
 */

import { critiqueLine } from "./sourceCritic.mjs";

const DEFAULT_MAX_CHARS_PER_PAGE = 2000;
const DEFAULT_MAX_PAGES = 20;

/**
 * @param {object} manifest crawl result_manifest ({ pages: [{ url, state, title?, content? }] })
 * @param {{ maxCharsPerPage?: number, maxPages?: number, forDisplay?: boolean }} [opts]
 *   forDisplay: render a clean human-readable extract for the chat (strips
 *   markdown links/images, drops the model-synthesis directive and critique).
 * @returns {string}
 */
export function summarizeCrawlManifest(manifest, opts = {}) {
  const forDisplay = Boolean(opts.forDisplay);
  const maxCharsPerPage = Number.isFinite(opts.maxCharsPerPage)
    ? Math.max(0, opts.maxCharsPerPage)
    : DEFAULT_MAX_CHARS_PER_PAGE;
  const maxPages = Number.isInteger(opts.maxPages) ? opts.maxPages : DEFAULT_MAX_PAGES;

  const allPages = Array.isArray(manifest?.pages) ? manifest.pages : [];
  const pages = allPages.slice(0, maxPages);

  const shown = allPages.length > pages.length ? ` (showing first ${pages.length})` : "";
  const header = forDisplay
    ? `Crawled ${allPages.length} page${allPages.length !== 1 ? "s" : ""}${shown}:`
    : `Crawled ${allPages.length} page${allPages.length !== 1 ? "s" : ""}${shown}` +
      ". Synthesize an answer from the excerpts below — do not paste them back verbatim.";
  const lines = [header];

  for (let i = 0; i < pages.length; i++) {
    const page = pages[i] || {};
    lines.push("");
    lines.push(`--- Page ${i + 1}/${pages.length} ---`);
    lines.push(`URL: ${page.url || "unknown"}`);
    lines.push(`State: ${page.state || "unknown"}`);
    if (page.title) lines.push(`Title: ${page.title}`);
    const raw = typeof page.content === "string" ? page.content : "";
    if (!forDisplay) lines.push(critiqueLine({ url: page.url, content: raw }));
    const content = forDisplay ? cleanMarkdown(raw) : raw;
    if (content) {
      lines.push("");
      // Display shows the full cleaned text (no truncation marker); the agent
      // path caps length to keep tool output bounded.
      lines.push(forDisplay ? content : truncate(content, maxCharsPerPage));
    }
  }

  return lines.join("\n");
}

// Strip noise for human display: markdown images, link URLs (keep link text),
// and collapse runs of blank lines.
function cleanMarkdown(text) {
  return text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")      // images ![alt](url) -> gone
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")    // links [text](url) -> text
    .replace(/^\s*```[^\n]*$/gm, "")            // code-fence markers (keep inner text inline, no separate box)
    .replace(/^\s*\|.*\|\s*$/gm, "")            // raw table rows (noise)
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function truncate(text, maxChars) {
  if (text.length <= maxChars) return text;
  const omitted = text.length - maxChars;
  return `${text.slice(0, maxChars)}\n…[truncated ${omitted} chars]`;
}
