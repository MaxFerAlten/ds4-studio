/**
 * PageAgent Tool — server-side tool implementations for page_snapshot and
 * page_action. page_action now includes safety classification and audit logging.
 */

import { buildUiSnapshot, formatSnapshot } from "./pageBrowserBridge.mjs";
import { validatePageAction, classifyPageAction } from "./pageAgentSafety.mjs";
import { buildAuditRecord, writeAuditRecord } from "./pageAgentAudit.mjs";

/**
 * Execute page_snapshot — read a guarded snapshot of the current DS4 Studio UI.
 * @param {object} args
 * @param {string} [args.url] - Optional URL override
 * @param {boolean} [args.includeControls] - Include visible controls list
 * @param {object} options - Tool options (uiState, etc.)
 * @returns {Promise<{ content: string, isError: boolean }>}
 */
export async function toolPageSnapshot(args = {}, options = {}) {
  const url = typeof args?.url === "string" ? args.url : undefined;
  const includeControls = Boolean(args?.includeControls);

  const snapshot = buildUiSnapshot({
    url,
    includeControls,
    uiState: options.uiState || {}
  });

  const content = formatSnapshot(snapshot);
  return { content, isError: false };
}

/**
 * Execute page_action — perform one guarded UI action with safety checks and audit.
 * @param {object} args
 * @param {string} args.action - Action type (click, input, select, scroll, wait)
 * @param {string} args.target - Target element identifier
 * @param {string} [args.value] - Value for input/select
 * @param {boolean} [args.requireConfirmation] - Require user confirmation
 * @param {object} options - Tool options
 * @returns {Promise<{ content: string, isError: boolean }>}
 */
export async function toolPageAction(args = {}, options = {}) {
  const action = typeof args?.action === "string" ? args.action : "";
  const target = typeof args?.target === "string" ? args.target : "";
  const value = typeof args?.value === "string" ? args.value : "";
  const requireConfirmation = Boolean(args?.requireConfirmation);

  // Validate action via safety module
  const validation = validatePageAction(
    { action, target, value },
    {
      url: options.url,
      allowedOrigins: options.allowedOrigins,
      requireConfirmation
    }
  );

  if (!validation.ok) {
    const err = validation.error;
    const errorContent = [
      `Tool error: ${err.code}`,
      err.message,
      "",
      "Recovery:",
      err.suggestion
    ].join("\n");
    return { content: errorContent, isError: true };
  }

  // Safety classification
  const safety = classifyPageAction({ action, target, value });

  // Build audit record (fire-and-forget — don't block on write)
  const auditRecord = buildAuditRecord({
    ts: new Date().toISOString(),
    sessionId: options.sessionId || "unknown",
    url: options.url || "http://127.0.0.1:5173",
    action,
    target,
    beforeHash: "placeholder-before",
    afterHash: "placeholder-after",
    ok: true,
    durationMs: 0,
    safety
  });
  writeAuditRecord(auditRecord).catch(() => {}); // silent background write

  // MVP: return a placeholder result. Real implementation will bridge to
  // the client-side PageAgent or a browser tab.
  return {
    content: [
      `Action: ${action}`,
      `Target: ${target}`,
      ...(value ? [`Value: ${value}`] : []),
      `Result: ok`,
      `Before hash: placeholder-before`,
      `After hash: placeholder-after`,
      `Observed change: (MVP — no real DOM interaction yet)`,
      "",
      `Safety: ${safety.allowed ? "passed" : `blocked (${safety.reason})`}`
    ].join("\n"),
    isError: false
  };
}
