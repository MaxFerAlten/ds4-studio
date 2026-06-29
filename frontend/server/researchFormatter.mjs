/**
 * Research source formatter — turns ranked web sources (from
 * ResearchSearchService.gather) into bounded, structured text for the agent.
 * Like the crawl summarizer, it caps content so the agent synthesizes and cites
 * rather than pasting raw source dumps back to the user.
 */

import { critiqueLine } from "./sourceCritic.mjs";

const DEPTH_LIMITS = { shallow: 5, normal: 10, deep: 20 };
const DEFAULT_SNIPPET_CHARS = 500;

function truncate(text, maxChars) {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n…[truncated ${text.length - maxChars} chars]`;
}

function isPrimary(source) {
  return Boolean(source.citable) || source.qualityTier === "primary" || source.sourceType === "primary";
}

/**
 * @param {object[]} sources web sources (toWebSource shape)
 * @param {{ depth?: string, requirePrimarySources?: boolean, snippetChars?: number }} [opts]
 * @returns {string}
 */
export function formatResearchSources(sources, opts = {}) {
  const all = Array.isArray(sources) ? sources : [];
  const limit = DEPTH_LIMITS[opts.depth] || DEPTH_LIMITS.normal;
  const snippetChars = Number.isFinite(opts.snippetChars) ? Math.max(0, opts.snippetChars) : DEFAULT_SNIPPET_CHARS;

  let selected = all;
  let note = "";
  if (opts.requirePrimarySources) {
    const primary = all.filter(isPrimary);
    if (primary.length) selected = primary;
    else note = " (no primary sources found — showing all)";
  }
  selected = selected.slice(0, limit);

  if (!selected.length) return "research_discover found no sources.";

  const lines = [
    `Found ${all.length} source${all.length !== 1 ? "s" : ""}${note}; showing ${selected.length} ranked. ` +
      "Synthesize and cite these — do not paste them back verbatim."
  ];
  selected.forEach((source, i) => {
    lines.push("");
    lines.push(`[${i + 1}] ${source.title || "(untitled)"}`);
    lines.push(`URL: ${source.url || "unknown"}`);
    const meta = [
      source.provider && `provider: ${source.provider}`,
      source.qualityTier && `tier: ${source.qualityTier}`,
      source.publishedAt && `date: ${source.publishedAt}`
    ].filter(Boolean);
    if (meta.length) lines.push(meta.join(" · "));
    const text = String(source.content || source.snippet || "").trim();
    lines.push(critiqueLine({ url: source.url, content: text }));
    if (text) lines.push(truncate(text, snippetChars));
  });
  return lines.join("\n");
}
