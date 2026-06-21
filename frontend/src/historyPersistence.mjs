export function historyHasPersistableAssistant(messages) {
  return (messages || []).some((message) => {
    if (!message || message.agentNotice || message.role !== "assistant") return false;
    if (typeof message.content === "string" && message.content.length > 0) return true;
    if (typeof message.reasoning === "string" && message.reasoning.length > 0) return true;
    if (typeof message.reasoning_content === "string" && message.reasoning_content.length > 0) return true;
    return Array.isArray(message.tool_calls) && message.tool_calls.length > 0;
  });
}

export function sessionHasAgentMetadata(session) {
  return Boolean(session?.metadata?.agentMode);
}

export function sessionsExposeMetadata(sessions) {
  return (sessions || []).some((session) =>
    Object.prototype.hasOwnProperty.call(session || {}, "metadata")
  );
}
