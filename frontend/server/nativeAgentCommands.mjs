import { crawlUrl } from "./crawlClient.mjs";
import { summarizeCrawlManifest } from "./crawlSummarizer.mjs";

const LEGACY_NATIVE_COMMANDS = new Set([
  "save",
  "list",
  "switch",
  "strip",
  "new",
  "compact"
]);

export function isAgentSlashCommand(message) {
  return typeof message === "string" && /^\/\S/.test(message.trim());
}

export function canonicalLegacyCommand(name, body = {}) {
  const command = String(name || "").toLowerCase();
  if (!LEGACY_NATIVE_COMMANDS.has(command)) return null;
  if (command === "switch" || command === "strip") {
    const sha = String(body?.sha || "").trim();
    return sha ? `/${command} ${sha}` : null;
  }
  return `/${command}`;
}

export function nativeCommandEvents(payload = {}, ok = payload.ok !== false) {
  const active = payload.active !== false;
  let message = String(payload.message || payload.error || "Native agent command failed.");
  if (payload.data !== undefined && payload.data !== null) {
    message += `\n\n\`\`\`json\n${JSON.stringify(payload.data, null, 2)}\n\`\`\``;
  }
  if (!ok || payload.ok === false) {
    return [
      { event: "agent_error", data: { error: message } },
      { event: "agent_done", data: { finish_reason: "error", active } }
    ];
  }
  return [
    ...(message ? [{ event: "agent_text", data: { content: message } }] : []),
    { event: "agent_done", data: { finish_reason: "command", active } }
  ];
}

function crawlFailure(status, message) {
  return {
    status,
    ok: false,
    payload: { ok: false, command: "crawl", message, active: true },
    contentType: "application/json"
  };
}

async function proxyCrawlCommand(fetchImpl, command, signal, options) {
  const match = /^\/crawl\s+start\s+(\S+)\s*$/i.exec(command.trim());
  if (!match) return crawlFailure(400, "usage: /crawl start <url>");

  const res = await crawlUrl(fetchImpl, {
    baseUrl: options.crawlBaseUrl,
    token: options.crawlToken,
    url: match[1],
    signal,
    maxPolls: options.maxPolls,
    pollIntervalMs: options.pollIntervalMs
  });
  if (!res.ok) return crawlFailure(res.status, res.message);

  return {
    status: 200,
    ok: true,
    payload: {
      ok: true,
      command: "crawl",
      message: summarizeCrawlManifest(res.manifest, { forDisplay: true }),
      active: true
    },
    contentType: "application/json"
  };
}

export async function proxyNativeAgentCommand(
  fetchImpl,
  baseUrl,
  command,
  signal,
  options = {}
) {
  if (options.crawlBaseUrl && /^\/crawl(?:\s|$)/i.test(command.trim())) {
    return proxyCrawlCommand(fetchImpl, command, signal, options);
  }

  const response = await fetchImpl(`${baseUrl}/api/native-agent/command`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ command }),
    signal
  });
  const text = await response.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    payload = {
      ok: false,
      message: text || `Wrapper HTTP ${response.status}`,
      active: true
    };
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    payload = {
      ok: false,
      message: `Wrapper HTTP ${response.status}`,
      active: true
    };
  }
  if (typeof payload.active !== "boolean") payload.active = true;
  return {
    status: response.status,
    ok: response.ok && payload.ok !== false,
    payload,
    contentType: response.headers.get("content-type") || "application/json"
  };
}
