/**
 * PageAgent event types for DS4 Studio UI integration.
 * These events are dispatched by the PageAgent client and consumed by UI components.
 */

export const PAGEAGENT_EVENTS = {
  STATUS_CHANGE: "pageagent_status",
  ACTIVITY: "pageagent_activity",
  RESULT: "pageagent_result",
  ERROR: "pageagent_error"
};

/**
 * Dispatch a PageAgent event on the given element (or document).
 * @param {string} type event type from PAGEAGENT_EVENTS
 * @param {object} detail event payload
 * @param {EventTarget} [target] dispatch target, defaults to document
 */
export function dispatchPageAgentEvent(type, detail, target) {
  const event = new CustomEvent(type, {
    bubbles: true,
    detail
  });
  (target || document).dispatchEvent(event);
}
