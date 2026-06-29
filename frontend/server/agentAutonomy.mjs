/**
 * Autonomy policy — classifies actions as safe-to-run vs needs-confirmation, so
 * the agent stops replying "Authorize?" for read-only work it was already asked
 * to do (§15). Read/search/crawl/summarize are non-destructive and run freely;
 * write/edit/delete/publish/send are outward-facing or destructive and gate.
 */

// Read-only / non-destructive tools — run without asking.
export const SAFE_TOOLS = new Set([
  "web_search", "web_read", "crawl", "research_discover",
  "chat_history_search", "read", "list", "search", "sage"
]);

// Action types that must be confirmed before running.
export const CONFIRM_TYPES = new Set([
  "write", "edit", "delete", "bash_destructive", "publish", "send"
]);

/** @param {{ type?: string }} action */
export function requiresConfirmation(action = {}) {
  return CONFIRM_TYPES.has(action.type);
}

export function isSafeTool(name) {
  return SAFE_TOOLS.has(name);
}

/** System-prompt directive that encodes the policy for the model. */
export function autonomyPromptSection() {
  return [
    "Autonomy policy:",
    `- Run these read-only tools immediately, without asking permission: ${[...SAFE_TOOLS].join(", ")}.`,
    "- If the user already asked you to search / read / open / crawl, just do it and synthesize — never reply \"Authorize?\" or ask the user to run the tool.",
    `- Ask for confirmation only before destructive or outward-facing actions: ${[...CONFIRM_TYPES].join(", ")}.`
  ].join("\n");
}
