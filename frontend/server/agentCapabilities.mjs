/**
 * Capability registry — single source of truth for which runtime tools the
 * agent actually has, derived from config. Replaces scattered hardcoded flags
 * (e.g. the planner's `capabilities: { crawl: true }`) and drives the
 * "Available runtime tools" section of the system prompt so the model is told
 * what it can do instead of guessing.
 */

/**
 * @param {object} config server config
 * @returns {{ webSearch: boolean, crawl: boolean, sage: boolean, history: boolean, researchSearch: boolean }}
 */
export function getAgentCapabilities(config = {}) {
  return {
    webSearch: true, // web_search/web_read are always registered tools
    crawl: Boolean(config.crawl?.host), // crawl service is configured/spawned
    sage: true, // sage tool always available
    history: true, // chat_history_search operates on the live transcript
    researchSearch: Boolean(config.research?.search?.enabled)
  };
}

const LABELS = {
  webSearch: "web_search / web_read — search the web and read pages",
  crawl: "crawl — fetch & extract page content via the crawl service",
  researchSearch: "research_discover — ranked, deduped, enriched research sources",
  history: "chat_history_search — search this conversation for prior links/actions/claims",
  sage: "sage — symbolic/numeric math via SageMath"
};

/** Build the system-prompt section listing the enabled runtime tools. */
export function capabilitiesPromptSection(capabilities = {}) {
  const enabled = Object.keys(LABELS).filter((key) => capabilities[key]);
  if (!enabled.length) return "";
  const lines = ["Available runtime tools (use them yourself; do not ask the user to run them):"];
  for (const key of enabled) lines.push(`- ${LABELS[key]}`);
  return lines.join("\n");
}
