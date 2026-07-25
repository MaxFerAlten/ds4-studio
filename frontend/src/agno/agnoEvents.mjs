const EVENT_TYPES = [
  "run_subscribed",
  "run_started",
  "model_waiting",
  "model_started",
  "content_delta",
  "reasoning_delta",
  "tool_call",
  "tool_result",
  "step_started",
  "step_completed",
  "run_completed",
  "run_failed",
  "run_cancelled",
  "diagnostic_event",
];

export function parseAgnoEventData(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function openAgnoRunEvents(runId, onEvent, { lastSeq = 0, EventSourceImpl = EventSource } = {}) {
  const stream = new EventSourceImpl(`/api/agno/runs/${encodeURIComponent(runId)}/events?lastSeq=${lastSeq}`);
  for (const type of EVENT_TYPES) {
    stream.addEventListener(type, (message) => {
      const event = parseAgnoEventData(message.data);
      if (event) onEvent(event);
    });
  }
  return stream;
}
