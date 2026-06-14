export const RESEARCH_EVENT_TYPES = Object.freeze([
  "research_started",
  "node_started",
  "node_stream_delta",
  "node_completed",
  "plan_generated",
  "feedback_required",
  "feedback_received",
  "document_added",
  "search_started",
  "search_platform_selected",
  "search_provider_completed",
  "search_provider_warning",
  "source_enriched",
  "search_completed",
  "source_found",
  "research_step_started",
  "research_step_completed",
  "report_delta",
  "report_completed",
  "research_completed",
  "research_error",
  "research_cancelled"
]);

const TYPE_SET = new Set(RESEARCH_EVENT_TYPES);

export function makeEvent(state, type, content = {}, nodeName = null) {
  if (!TYPE_SET.has(type)) throw new Error(`unknown research event type: ${type}`);
  state.seq += 1;
  return {
    type,
    sessionId: state.sessionId,
    threadId: state.threadId,
    nodeName,
    seq: state.seq,
    ts: new Date().toISOString(),
    content
  };
}

export function serializeEvent(event) {
  return `${JSON.stringify(event)}\n`;
}

export function parseEventLines(ndjson) {
  return String(ndjson || "")
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));
}
