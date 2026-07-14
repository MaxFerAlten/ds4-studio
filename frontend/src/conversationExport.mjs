import { normalizeObsidianMath } from "./obsidianMath.mjs";
import { resolveSageMarkdownImageLinks } from "./sage/sageArtifactLinks.mjs";

export { normalizeObsidianMath } from "./obsidianMath.mjs";

/**
 * Detect if a single line looks like a native-agent shell transcript line.
 * We look for clear shell indicators: the native-agent tool icon prefix,
 * shell redirects to /dev/null, or pipes followed by shell commands.
 * Lines starting with bare "$ " are ambiguous with inline math and are
 * NOT treated as shell transcript to avoid false positives.
 */
function looksLikeShellTranscriptLine(line) {
  // Starts with the native-agent tool icon followed by a shell command
  if (/^\s*🛠️\s*\$/.test(line)) return true;
  // Contains shell redirect to /dev/null (e.g. "2>/dev/null" or "2> /dev/null")
  if (/\s2>\s*[\/]dev[\/]null(\s|$)/.test(line)) return true;
  // Contains a pipe followed by a shell command word
  if (/\s\|\s*(grep|head|tail|awk|sed|cat|wc|sort|uniq|find)\b/.test(line)) return true;
  return false;
}

/**
 * Detect if a block of text contains shell/tool transcript lines that must
 * NOT be passed through normalizeObsidianMath.
 */
function looksLikeRawToolTranscript(content) {
  return String(content || "")
    .split(/\r?\n/)
    .some(looksLikeShellTranscriptLine);
}

/**
 * Normalize export text while protecting shell/tool transcript content.
 * - role="tool" / role="function" messages are always kept raw.
 * - Messages flagged with rawToolTranscript are kept raw.
 * - Messages whose content looks like a raw tool transcript are kept raw.
 * - All other content passes through normalizeObsidianMath as before.
 */
function normalizeExportText(message, fieldName) {
  const text = String(message?.[fieldName] || "");
  if (!text) return "";

  // Tool/function messages: never normalize
  if (message.role === "tool" || message.role === "function") {
    return text;
  }

  // Messages explicitly marked as raw tool transcript
  if (message.rawToolTranscript) {
    return text;
  }

  // Auto-detect shell transcript lines in assistant content
  if (looksLikeRawToolTranscript(text)) {
    return text;
  }

  return normalizeObsidianMath(text);
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

function toolCallsMarkdown(toolCalls, { hideSage = false } = {}) {
  if (!Array.isArray(toolCalls) || !toolCalls.length) return "";
  const filtered = hideSage ? toolCalls.filter((call) => toolCallName(call) !== "sage") : toolCalls;
  if (!filtered.length) return "";
  return filtered
    .map((call) => {
      const name = toolCallName(call);
      const id = call?.id ? `\n\ncall_id: \`${call.id}\`` : "";
      return `### Tool Call: ${name}${id}\n\n${fenceBlock(toolCallArguments(call), "json")}`;
    })
    .join("\n\n");
}

function toolResultMarkdown(message, { hideSage = false } = {}) {
  if (hideSage && message.name === "sage") return "";
  const parts = [];
  if (message.tool_call_id) parts.push(`tool_call_id: \`${message.tool_call_id}\``);
  parts.push(fenceBlock(message.content || "", "text"));
  return parts.join("\n\n");
}

const META_MARKER_RE = /<!--\s*ds4-meta:\s*(\{[\s\S]*?\})\s*-->/;

/**
 * Render a single message's content for a given export mode.
 * "obsidian" mode applies KaTeX normalization (with shell transcript protection).
 * "raw" mode returns the content unchanged.
 */
function renderContent(message, fieldName, mode) {
  if (mode === "raw") {
    return String(message?.[fieldName] || "");
  }
  return normalizeExportText(message, fieldName);
}

export function exportConversationMarkdown(messages, opts = {}) {
  return buildConversationMarkdown(messages, { ...opts, mode: "obsidian" });
}

/**
 * Export a conversation as raw Markdown suitable for debug/resume.
 * No KaTeX normalization is applied; all content is preserved as-is.
 */
export function exportConversationMarkdownRaw(messages, opts = {}) {
  return buildConversationMarkdown(messages, {
    ...opts,
    mode: "raw",
    hideCompactSageTrace: opts.hideCompactSageTrace ?? false
  });
}

function latestSageArtifacts(sageActivities, runId = null) {
  if (runId && sageActivities?.[runId]?.runId === runId) {
    const artifacts = sageActivities[runId].artifacts;
    return Array.isArray(artifacts) ? artifacts : [];
  }
  const activities = Object.values(
    sageActivities && typeof sageActivities === "object" ? sageActivities : {}
  );
  for (let index = activities.length - 1; index >= 0; index--) {
    const artifacts = activities[index]?.artifacts;
    if (Array.isArray(artifacts) && artifacts.length) return artifacts;
  }
  return [];
}

function sageArtifactUrlsFromMarkdown(markdown) {
  return Array.from(
    String(markdown || "").matchAll(/!\[[^\]]*\]\((\/api\/sage\/artifacts\/[^)\s]+)\)/g),
    (match) => match[1]
  );
}

function artifactLooksLikeImage(artifact) {
  const mediaType = String(artifact?.mediaType || "").toLowerCase();
  if (mediaType.startsWith("image/")) return true;
  return /\.(?:png|svg|jpe?g|gif|webp)(?:$|[?#])/i.test(String(artifact?.name || artifact?.url || ""));
}

function bytesToBase64(bytes) {
  const BufferCtor = globalThis.Buffer;
  if (BufferCtor?.from) return BufferCtor.from(bytes).toString("base64");
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  if (typeof globalThis.btoa !== "function") {
    throw new Error("Base64 encoding is unavailable in this environment");
  }
  return globalThis.btoa(binary);
}

async function artifactDataUrl(artifact, fetchImpl) {
  if (String(artifact.url || "").startsWith("data:image/")) return artifact.url;
  if (typeof fetchImpl !== "function") throw new Error("Image fetch is unavailable");
  const response = await fetchImpl(artifact.url);
  if (!response?.ok) {
    throw new Error(`Unable to embed Sage artifact: ${artifact.name || artifact.url}`);
  }
  const mediaType = String(
    artifact.mediaType || response.headers?.get?.("content-type") || "application/octet-stream"
  ).split(";", 1)[0].trim().toLowerCase();
  if (!mediaType.startsWith("image/")) {
    throw new Error(`Sage artifact is not an image: ${artifact.name || artifact.url}`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  return `data:${mediaType};base64,${bytesToBase64(bytes)}`;
}

export async function exportProfessionalMarkdown(
  messages,
  { sageActivities = {}, fetchImpl = globalThis.fetch } = {}
) {
  const editorial = [...(Array.isArray(messages) ? messages : [])]
    .reverse()
    .find((message) => (
      message?.role === "assistant" &&
      !message.agentNotice &&
      typeof message.content === "string" &&
      message.content.trim()
    ));
  if (!editorial) throw new Error("No editorial assistant response is available for export");

  let body = resolveSageMarkdownImageLinks(normalizeExportText(editorial, "content")).trim();
  if (!/^#\s+/m.test(body)) body = `# Elaborato matematico\n\n${body}`;

  const artifacts = new Map();
  for (const artifact of latestSageArtifacts(sageActivities, editorial.sageRunId)) {
    if (artifact?.url && artifactLooksLikeImage(artifact)) artifacts.set(artifact.url, artifact);
  }
  for (const url of sageArtifactUrlsFromMarkdown(body)) {
    if (!artifacts.has(url)) {
      const encodedName = url.split("/").pop() || "grafico";
      let name = encodedName;
      try { name = decodeURIComponent(encodedName); } catch {}
      artifacts.set(url, { name, url });
    }
  }

  const appended = [];
  for (const artifact of artifacts.values()) {
    const referenced = body.includes(artifact.url);
    const dataUrl = await artifactDataUrl(artifact, fetchImpl);
    body = body.split(artifact.url).join(dataUrl);
    if (!referenced) {
      const alt = String(artifact.name || "Grafico").replace(/[\[\]\r\n]/g, " ");
      appended.push(`![${alt}](${dataUrl})`);
    }
  }
  if (appended.length) body += `\n\n## Grafici\n\n${appended.join("\n\n")}`;
  return `${body.trim()}\n`;
}

function buildConversationMarkdown(messages, { includeReasoning = false, metadata = null, mode = "obsidian", hideCompactSageTrace = true } = {}) {
  const blocks = [mode === "raw" ? "# DS4 Conversation (raw)" : "# DS4 Conversation"];

  for (const message of messages || []) {
    // Client-side notices (agent mode toggles, error banners) are UI-only and
    // must not be serialised as assistant turns: they would corrupt the
    // transcript if it were ever re-injected into a backend conversation.
    // Exception: notices flagged `exportable` (e.g. /crawl results) carry real
    // content the user wants in the export.
    if (message.agentNotice && !message.exportable) continue;
    if (hideCompactSageTrace && message.role === "tool" && message.name === "sage") continue;

    const content = renderContent(message, "content", mode);
    const reasoning = renderContent(message, "reasoning", mode);
    const toolCalls = toolCallsMarkdown(message.tool_calls, { hideSage: hideCompactSageTrace });
    if (!content && !toolCalls && (!includeReasoning || !reasoning)) continue;

    const title = message.role === "tool" && message.name
      ? `Tool: ${message.name}`
      : roleTitle(message.role);
    const parts = [`## ${title}`];
    if (includeReasoning && reasoning) parts.push(`### Reasoning\n\n${reasoning}`);
    if (toolCalls) parts.push(toolCalls);
    if (message.role === "tool") {
      const resultMd = toolResultMarkdown(message, { hideSage: hideCompactSageTrace });
      if (resultMd) parts.push(resultMd);
    } else if (content) parts.push(content);
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

      // Messages parsed from a Markdown export are historical archives, not
      // operational tool transcript. Mark them so the agent chat endpoint and
      // buildChatMessages can exclude them from the active prompt context.
      return { role, content: body, reasoning, fromArchive: true };
    })
    .filter(Boolean);
}

export function markdownFileName(date = new Date()) {
  const stamp = date.toISOString().slice(0, 19).replace("T", "-").replaceAll(":", "-");
  return `ds4-conversation-${stamp}.md`;
}

export function professionalMarkdownFileName(date = new Date()) {
  const stamp = date.toISOString().slice(0, 19).replace("T", "-").replaceAll(":", "-");
  return `ds4-elaborato-pro-${stamp}.md`;
}
