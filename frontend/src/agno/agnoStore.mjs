export function initialAgnoRun() {
  return Object.freeze({
    runId: null,
    status: "idle",
    lastSeq: -1,
    content: "",
    reasoning: "",
    toolCalls: [],
    diagnostics: [],
    error: null,
    terminal: false,
  });
}

export function applyAgnoEvent(view, event) {
  if (view.terminal) return view;
  if (!Number.isSafeInteger(event?.seq) || event.seq <= view.lastSeq) return view;

  const next = { ...view, lastSeq: event.seq, runId: event.run_id ?? view.runId };

  switch (event.type) {
    case "run_subscribed":
      break;
    case "run_started":
      next.status = "running";
      break;
    case "model_waiting":
      next.status = "queued";
      break;
    case "model_started":
      next.status = "running";
      break;
    case "content_delta":
      next.content = view.content + (event.content ?? "");
      break;
    case "reasoning_delta":
      next.reasoning = view.reasoning + (event.content ?? "");
      break;
    case "tool_call":
    case "tool_result":
      next.toolCalls = [...view.toolCalls, { type: event.type, targetId: event.target_id, content: event.content }];
      break;
    case "diagnostic_event":
      next.diagnostics = [...view.diagnostics, event.content];
      break;
    case "run_completed":
      next.status = "completed";
      next.terminal = true;
      break;
    case "run_failed":
      next.status = "failed";
      next.error = event.content;
      next.terminal = true;
      break;
    case "run_cancelled":
      next.status = "cancelled";
      next.terminal = true;
      break;
    default:
      break;
  }

  return Object.freeze(next);
}
