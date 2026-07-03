/**
 * PageAgent Safety — classifies UI actions as safe, sensitive, or destructive.
 * Used by page_action to gate actions before execution.
 */

const DESTRUCTIVE_WORDS = new Set(["delete", "remove", "drop", "pay", "purchase", "publish", "submit", "confirm", "trash", "wipe"]);
const SENSITIVE_WORDS = new Set(["password", "otp", "2fa", "secret", "token", "pin"]);

/**
 * Check if text contains a word from the given set as a standalone word
 * (delimited by spaces or string boundaries, not hyphenated compounds).
 * @param {string} text
 * @param {Set<string>} wordSet
 * @returns {boolean}
 */
function containsWord(text, wordSet) {
  // Split into words by space and hyphen boundaries
  const words = text.split(/[\s-]+/);
  for (const w of words) {
    const clean = w.replace(/^[^a-zA-Z0-9]+|[^a-zA-Z0-9]+$/g, "");
    if (wordSet.has(clean.toLowerCase())) return true;
  }
  return false;
}

/**
 * Classify a page action target for safety.
 * @param {{ action: string, target: string, value?: string, elementText?: string }} params
 * @returns {{ allowed: boolean, reason?: string, requireConfirmation?: boolean }}
 */
export function classifyPageAction({ action, target, value, elementText }) {
  // Check target, elementText, and value for destructive/sensitive words.
  // The target data-agent-id is included as a safety measure against
  // obviously destructive element identifiers (e.g. "delete-button").
  const textToCheck = `${target || ""} ${elementText || ""} ${value || ""}`.trim();

  // Destructive words in element text or value
  if (textToCheck && containsWord(textToCheck, DESTRUCTIVE_WORDS)) {
    return {
      allowed: false,
      reason: "destructive_action_requires_confirmation",
      requireConfirmation: true
    };
  }

  // Sensitive input detection — check element text and value
  if (action === "input" && textToCheck && containsWord(textToCheck, SENSITIVE_WORDS)) {
    return {
      allowed: false,
      reason: "sensitive_input_blocked"
    };
  }

  return { allowed: true };
}

/**
 * Check if a URL origin is in the allowed list.
 * @param {string} url
 * @param {string[]} allowedOrigins
 * @returns {boolean}
 */
export function isAllowedOrigin(url, allowedOrigins = []) {
  if (!url || !Array.isArray(allowedOrigins)) return false;
  try {
    const parsed = new URL(url);
    return allowedOrigins.some((allowed) => {
      const a = new URL(allowed);
      return parsed.origin === a.origin;
    });
  } catch {
    return false;
  }
}

/**
 * Check if an action type requires user confirmation.
 * @param {string} action
 * @param {{ requireConfirmation?: boolean }} targetInfo
 * @returns {boolean}
 */
export function requiresConfirmation(action, targetInfo = {}) {
  if (targetInfo.requireConfirmation) return true;
  const confirmActions = new Set(["submit", "send", "publish", "delete", "remove"]);
  return confirmActions.has(action);
}

/**
 * Check if a target is a sensitive input type.
 * @param {{ action: string, target: string, elementText?: string }} targetInfo
 * @returns {boolean}
 */
export function isSensitiveInput(targetInfo) {
  if (targetInfo.action !== "input") return false;
  const combined = `${targetInfo.target} ${targetInfo.elementText || ""}`;
  return containsWord(combined, SENSITIVE_WORDS);
}

/**
 * Full validation of a page action before execution.
 * @param {{ action: string, target: string, value?: string }} args
 * @param {{ allowedOrigins?: string[], url?: string, requireConfirmation?: boolean }} context
 * @returns {{ ok: boolean, error?: { code: string, message: string, recoverable: boolean, suggestion: string } }}
 */
export function validatePageAction(args, context = {}) {
  const { action, target } = args || {};
  const elementText = context.elementText || "";

  // Missing args check
  if (!args || !action || !target) {
    return {
      ok: false,
      error: {
        code: "PAGEAGENT_INVALID_ARGS",
        message: "Action and target are required.",
        recoverable: true,
        suggestion: "Provide both action and target parameters."
      }
    };
  }

  // Invalid action check
  const VALID_ACTIONS = ["click", "input", "select", "scroll", "wait"];
  if (!VALID_ACTIONS.includes(action)) {
    return {
      ok: false,
      error: {
        code: "PAGEAGENT_INVALID_ACTION",
        message: `Invalid action '${action}'. Must be one of: ${VALID_ACTIONS.join(", ")}.`,
        recoverable: true,
        suggestion: `Choose a valid action: ${VALID_ACTIONS.join(", ")}.`
      }
    };
  }

  // Origin check
  const url = context.url;
  const allowedOrigins = context.allowedOrigins;
  if (url && Array.isArray(allowedOrigins) && allowedOrigins.length > 0) {
    if (!isAllowedOrigin(url, allowedOrigins)) {
      return {
        ok: false,
        error: {
          code: "PAGEAGENT_ORIGIN_DENIED",
          message: `Origin '${new URL(url).origin}' is not allowed.`,
          recoverable: false,
          suggestion: "Add the origin to pageAgent.allowedOrigins in config."
        }
      };
    }
  }

  // Safety classification
  const classification = classifyPageAction({ action, target, value: args.value, elementText });
  if (!classification.allowed) {
    return {
      ok: false,
      error: {
        code: classification.reason === "destructive_action_requires_confirmation"
          ? "PAGEAGENT_DESTRUCTIVE_CONFIRMATION_REQUIRED"
          : "PAGEAGENT_SENSITIVE_INPUT_BLOCKED",
        message: classification.reason === "destructive_action_requires_confirmation"
          ? `Target '${target}' appears destructive. User confirmation is required.`
          : `Sensitive input blocked on target '${target}'.`,
        recoverable: classification.reason === "destructive_action_requires_confirmation",
        suggestion: classification.reason === "destructive_action_requires_confirmation"
          ? "Ask the user for explicit confirmation before proceeding."
          : "Remove sensitive keywords from the input value."
      }
    };
  }

  return { ok: true };
}
