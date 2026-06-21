export function parseAgentInput(text, agentMode) {
  if (typeof text !== "string") return null;
  const trimmed = text.trim();
  if (!trimmed) return null;

  const control = trimmed.match(/^\/agent\s+(start|stop|status)\s*$/i);
  if (control) {
    return { type: "control", action: control[1].toLowerCase() };
  }

  const pony = trimmed.match(/^\/pony(?:\s+(\S+))?\s*$/i);
  if (pony) {
    if (!agentMode) return { type: "pony", action: "inactive" };
    const arg = (pony[1] || "status").toLowerCase();
    if (arg === "status") return { type: "pony", action: "status" };
    if (arg === "start") return { type: "pony", action: "set", mode: "full" };
    if (arg === "stop") return { type: "pony", action: "set", mode: "off" };
    if (["off", "lite", "full", "ultra"].includes(arg)) return { type: "pony", action: "set", mode: arg };
    return { type: "pony", action: "invalid", mode: arg };
  }

  // SageMath control commands — work only when agent mode is active
  const sageControl = trimmed.match(/^\/sage\s+(start|stop|status)\s*$/i);
  if (sageControl) {
    return { type: "sageControl", action: sageControl[1].toLowerCase() };
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
