import { toolPageSnapshot, toolPageAction } from "./pageAgentTool.mjs";

const ACTION_KEYWORDS = {
  click: ["click", "press", "tap", "submit", "send", "choose", "select option"],
  input: ["type", "write", "enter", "fill", "input", "set value"],
  select: ["select", "pick", "choose from", "dropdown"],
  scroll: ["scroll", "scroll down", "scroll up"],
  wait: ["wait", "pause", "delay"]
};

function inferAction(task) {
  const lower = task.toLowerCase();
  for (const [action, keywords] of Object.entries(ACTION_KEYWORDS)) {
    for (const kw of keywords) {
      if (lower.includes(kw)) return action;
    }
  }
  return "click";
}

function inferTarget(task) {
  const lower = task.toLowerCase();
  const patterns = [
    /(?:click|press|tap|submit|send)\s+(?:the\s+)?(?:on\s+)?["']?(.+?)["']?(?:\s+button)?(?:\s|$)/i,
    /(?:type|write|enter|fill)\s+(?:in\s+)?(?:the\s+)?["']?(.+?)["']?(?:\s+(?:input|field|box))?/i,
    /(?:on|at|into)\s+(?:the\s+)?["']?(.+?)["']?/i,
    /["'](.+?)["']/
  ];
  for (const pat of patterns) {
    const m = lower.match(pat);
    if (m && m[1] && m[1].trim()) return m[1].trim();
  }
  return task.replace(/^(click|press|tap|submit|send|type|write|enter|fill|scroll|wait)\s+/i, "").trim() || task;
}

function inferValue(task) {
  const patterns = [
    /(?:type|write|enter|fill)\s+(?:the\s+)?(?:text|value|string\s+)?["']?(.+?)["']?\s+(?:in|into|on)\s/i,
    /["'](.+?)["']/
  ];
  for (const pat of patterns) {
    const m = task.match(pat);
    if (m && m[1] && m[1].trim()) return m[1].trim();
  }
  return "";
}

function parseTask(task) {
  if (!task || typeof task !== "string") return null;
  return {
    action: inferAction(task),
    target: inferTarget(task),
    value: inferValue(task)
  };
}

export async function toolPageTask(args = {}, options = {}) {
  const task = typeof args?.task === "string" ? args.task : "";
  if (!task.trim()) {
    return { content: "Tool error: page_task requires a task description", isError: true };
  }

  const parts = [];
  parts.push(`Task: ${task}`);
  parts.push("");

  const snapshot = await toolPageSnapshot({ includeControls: true }, options);
  if (snapshot.isError) {
    return { content: "Tool error: page_task failed to take initial snapshot", isError: true };
  }
  parts.push("--- Initial UI State ---");
  parts.push(snapshot.content);
  parts.push("");

  const parsed = parseTask(task);
  if (!parsed) {
    parts.push("Could not parse task into actions.");
    parts.push("");
    parts.push("--- Final UI State ---");
    const finalSnapshot = await toolPageSnapshot({ includeControls: false }, options);
    parts.push(finalSnapshot.content);
    return { content: parts.join("\n"), isError: false };
  }

  parts.push(`Planned action: ${parsed.action} on "${parsed.target}"${parsed.value ? ` with value "${parsed.value}"` : ""}`);
  parts.push("");

  const actionResult = await toolPageAction(
    { action: parsed.action, target: parsed.target, value: parsed.value },
    options
  );
  parts.push("--- Action Result ---");
  parts.push(actionResult.content);
  parts.push("");

  parts.push("--- Final UI State ---");
  const finalSnapshot = await toolPageSnapshot({ includeControls: false }, options);
  parts.push(finalSnapshot.content);

  return { content: parts.join("\n"), isError: false };
}
