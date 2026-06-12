export function parseAgentInput(text, agentMode) {
  if (typeof text !== "string") return null;
  const trimmed = text.trim();
  if (!trimmed) return null;

  const control = trimmed.match(/^\/agent\s+(start|stop|status)\s*$/i);
  if (control) {
    return { type: "control", action: control[1].toLowerCase() };
  }

  const alias = trimmed.match(/^\/agent\s+(\S+)(?:\s+([\s\S]*))?$/i);
  if (alias) {
    const name = alias[1].toLowerCase();
    const args = alias[2]?.trim();
    return {
      type: "native",
      command: `/${name}${args ? ` ${args}` : ""}`
    };
  }

  if (/^\/agent$/i.test(trimmed)) return null;
  if (agentMode && /^\/\S/.test(trimmed)) {
    return { type: "native", command: trimmed };
  }
  return null;
}

export function formatNativeAgentNotice(command, payload = {}, status) {
  const label = String(command || "command");
  let content = String(
    payload.message || payload.error || "Native agent command failed."
  );
  if (payload.data !== undefined && payload.data !== null) {
    content += `\n\n\`\`\`json\n${JSON.stringify(payload.data, null, 2)}\n\`\`\``;
  }
  return `**${label}** (HTTP ${status})\n\n${content}`;
}
