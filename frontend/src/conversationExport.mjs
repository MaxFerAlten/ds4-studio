function normalizeMathBody(math) {
  return math.trim().replace(/\|/g, "\\vert ");
}

function normalizeTextMath(segment) {
  const withDisplayMath = segment.replace(/\\\[([\s\S]*?)\\\]/g, (_, math) => {
    const body = normalizeMathBody(math);
    return body ? `\n\n$$\n${body}\n$$\n\n` : "";
  });
  const withInlineMath = withDisplayMath.replace(/\\\(([\s\S]*?)\\\)/g, (_, math) => `$${normalizeMathBody(math)}$`);
  const withDollarDisplayMath = withInlineMath.replace(/\$\$([\s\S]*?)\$\$/g, (_, math) => {
    const body = normalizeMathBody(math);
    return body ? `\n\n$$\n${body}\n$$\n\n` : "";
  });
  const withDollarInlineMath = withDollarDisplayMath.replace(/(^|[^$])\$([^$\n]+?)\$(?!\$)/g, (_, prefix, math) => {
    const body = normalizeMathBody(math);
    return body ? `${prefix}$${body}$` : `${prefix}$$`;
  });
  return withDollarInlineMath.replace(/\n{3,}/g, "\n\n");
}

const MATH_FENCE_LANGS = new Set(["latex", "tex", "math", "katex"]);
const MATH_DELIM_RE = /\\\[|\\\(|\$\$|(^|[^$])\$[^$\n]+\$/;

export function normalizeObsidianMath(content) {
  if (!content) return "";

  const output = [];
  const textBuffer = [];
  const lines = String(content).match(/[^\n]*\n|[^\n]+/g) || [];
  let inFence = false;
  let fenceChar = "";
  let fenceLength = 0;
  let fenceIsMath = false;
  let mathFenceBody = [];

  function flushText() {
    if (!textBuffer.length) return;
    output.push(normalizeTextMath(textBuffer.join("")));
    textBuffer.length = 0;
  }

  function emitMathFenceBody() {
    const body = mathFenceBody.join("");
    mathFenceBody = [];
    if (!body.trim()) return;
    if (MATH_DELIM_RE.test(body)) {
      textBuffer.push(body);
      textBuffer.push("\n");
    } else {
      textBuffer.push(`\n\n$$\n${body.replace(/\n+$/, "")}\n$$\n\n`);
    }
  }

  for (const rawLine of lines) {
    const line = rawLine.endsWith("\n") ? rawLine.slice(0, -1) : rawLine;
    const openingFence = line.match(/^[ \t]*(`{3,}|~{3,})\s*([A-Za-z0-9_+-]+)?/);

    if (!inFence && openingFence) {
      const lang = (openingFence[2] || "").toLowerCase();
      fenceChar = openingFence[1][0];
      fenceLength = openingFence[1].length;
      fenceIsMath = MATH_FENCE_LANGS.has(lang);
      inFence = true;
      if (!fenceIsMath) {
        flushText();
        output.push(rawLine);
      }
      continue;
    }

    if (inFence) {
      const closingFence = line.match(/^[ \t]*(`{3,}|~{3,})[ \t]*$/);
      const closing = Boolean(
        closingFence && closingFence[1][0] === fenceChar && closingFence[1].length >= fenceLength
      );
      if (fenceIsMath) {
        if (closing) {
          emitMathFenceBody();
          inFence = false;
          fenceIsMath = false;
        } else {
          mathFenceBody.push(rawLine);
        }
      } else {
        output.push(rawLine);
        if (closing) inFence = false;
      }
      continue;
    }

    textBuffer.push(rawLine);
  }

  if (inFence && fenceIsMath) emitMathFenceBody();
  flushText();
  return output.join("").trim();
}

function roleTitle(role) {
  if (role === "assistant") return "Assistant";
  if (role === "user") return "User";
  return role ? `${role[0].toUpperCase()}${role.slice(1)}` : "Message";
}

function toolCallName(call) {
  return call?.name || call?.function?.name || "unknown";
}

function toolCallArguments(call) {
  const raw = call?.arguments ?? call?.function?.arguments ?? {};
  if (typeof raw === "string") return raw;
  return JSON.stringify(raw, null, 2);
}

function fenceBlock(content, language = "") {
  const raw = String(content || "");
  const longest = Math.max(3, ...Array.from(raw.matchAll(/`+/g), (match) => match[0].length + 1));
  const fence = "`".repeat(longest);
  return `${fence}${language}\n${raw}\n${fence}`;
}

function toolCallsMarkdown(toolCalls) {
  if (!Array.isArray(toolCalls) || !toolCalls.length) return "";
  return toolCalls
    .map((call) => {
      const name = toolCallName(call);
      const id = call?.id ? `\n\ncall_id: \`${call.id}\`` : "";
      return `### Tool Call: ${name}${id}\n\n${fenceBlock(toolCallArguments(call), "json")}`;
    })
    .join("\n\n");
}

function toolResultMarkdown(message) {
  const parts = [];
  if (message.tool_call_id) parts.push(`tool_call_id: \`${message.tool_call_id}\``);
  parts.push(fenceBlock(message.content || "", "text"));
  return parts.join("\n\n");
}

const META_MARKER_RE = /<!--\s*ds4-meta:\s*(\{[\s\S]*?\})\s*-->/;

export function exportConversationMarkdown(messages, { includeReasoning = false, metadata = null } = {}) {
  const blocks = ["# DS4 Conversation"];

  for (const message of messages || []) {
    // Client-side notices (agent mode toggles, error banners) are UI-only and
    // must not be serialised as assistant turns: they would corrupt the
    // transcript if it were ever re-injected into a backend conversation.
    if (message.agentNotice) continue;

    const content = normalizeObsidianMath(message.content || "");
    const reasoning = normalizeObsidianMath(message.reasoning || "");
    const toolCalls = toolCallsMarkdown(message.tool_calls);
    if (!content && !toolCalls && (!includeReasoning || !reasoning)) continue;

    const title = message.role === "tool" && message.name
      ? `Tool: ${message.name}`
      : roleTitle(message.role);
    const parts = [`## ${title}`];
    if (includeReasoning && reasoning) parts.push(`### Reasoning\n\n${reasoning}`);
    if (toolCalls) parts.push(toolCalls);
    if (message.role === "tool") parts.push(toolResultMarkdown(message));
    else if (content) parts.push(content);
    blocks.push(parts.join("\n\n"));
  }

  let out = `${blocks.join("\n\n---\n\n")}\n`;
  if (metadata && typeof metadata === "object") {
    out += `\n<!-- ds4-meta: ${JSON.stringify(metadata)} -->\n`;
  }
  return out;
}

export function parseConversationMetadata(markdown) {
  const raw = String(markdown || "");
  const match = raw.match(META_MARKER_RE);
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

function roleFromTitle(title) {
  const normalized = String(title || "").trim().toLowerCase();
  if (normalized === "assistant") return "assistant";
  if (normalized === "user") return "user";
  if (normalized === "tool" || normalized.startsWith("tool:")) return "tool";
  return normalized || "message";
}

export function parseConversationMarkdown(markdown) {
  const raw = String(markdown || "").replace(META_MARKER_RE, "").trim();
  if (!raw) return [];

  const blocks = raw.split(/\n\s*---\s*\n/g);
  return blocks
    .map((block) => block.trim())
    .filter((block) => /^##\s+/m.test(block))
    .map((block) => {
      const match = block.match(/^##\s+(.+?)\s*\n+([\s\S]*)$/);
      if (!match) return null;
      const role = roleFromTitle(match[1]);
      let body = match[2].trim();
      let reasoning = "";

      if (body.startsWith("### Reasoning")) {
        const reasoningBody = body.replace(/^### Reasoning\s*\n+/, "");
        const splitAt = reasoningBody.indexOf("\n\n");
        if (splitAt === -1) {
          reasoning = reasoningBody.trim();
          body = "";
        } else {
          reasoning = reasoningBody.slice(0, splitAt).trim();
          body = reasoningBody.slice(splitAt + 2).trim();
        }
      }

      return { role, content: body, reasoning };
    })
    .filter(Boolean);
}

export function markdownFileName(date = new Date()) {
  const stamp = date.toISOString().slice(0, 19).replace("T", "-").replaceAll(":", "-");
  return `ds4-conversation-${stamp}.md`;
}
