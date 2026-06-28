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

function formatCrawlManifest(manifest) {
  const pages = Array.isArray(manifest?.pages) ? manifest.pages : [];
  const succeeded = manifest?.all_succeeded === true;
  const status = succeeded ? 'all succeeded' : 'partially succeeded';

  const lines = [`Crawl result: ${pages.length} page${pages.length !== 1 ? 's' : ''} (${status})`];

  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    lines.push('');
    lines.push(`--- Page ${i + 1}/${pages.length} ---`);
    lines.push(`URL: ${page.url || 'unknown'}`);
    lines.push(`State: ${page.state || 'unknown'}`);
    if (page.content) {
      lines.push('');
      lines.push(page.content);
    }
  }

  return lines.join('\n');
}

function crawlFailure(status, message) {
  return {
    status,
    ok: false,
    payload: { ok: false, command: "crawl", message, active: true },
    contentType: "application/json"
  };
}

async function responseJson(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return { message: text || `HTTP ${response.status}` };
  }
}

async function proxyCrawlCommand(fetchImpl, command, signal, options) {
  const match = /^\/crawl\s+start\s+(\S+)\s*$/i.exec(command.trim());
  if (!match) return crawlFailure(400, "usage: /crawl start <url>");

  let url;
  try {
    url = new URL(match[1]);
  } catch {
    return crawlFailure(400, "crawl requires a valid URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return crawlFailure(400, "crawl URL must use http or https");
  }

  const headers = { "Content-Type": "application/json" };
  if (options.crawlToken) headers.Authorization = `Bearer ${options.crawlToken}`;
  const create = await fetchImpl(`${options.crawlBaseUrl}/jobs`, {
    method: "POST",
    headers,
    body: JSON.stringify({ url: url.href }),
    signal
  });
  const created = await responseJson(create);
  if (!create.ok) {
    return crawlFailure(create.status, created?.detail || created?.message || "crawl request failed");
  }
  const jobId = typeof created?.job_id === "string" ? created.job_id : "";
  if (!jobId) return crawlFailure(502, "crawl service did not return a job_id");

  const maxPolls = Number.isInteger(options.maxPolls) ? options.maxPolls : 120;
  const pollIntervalMs = Number.isFinite(options.pollIntervalMs)
    ? Math.max(0, options.pollIntervalMs)
    : 1000;
  for (let attempt = 0; attempt < maxPolls; attempt += 1) {
    const statusResponse = await fetchImpl(
      `${options.crawlBaseUrl}/jobs/${encodeURIComponent(jobId)}`,
      { method: "GET", headers, signal }
    );
    const statusPayload = await responseJson(statusResponse);
    if (!statusResponse.ok) {
      return crawlFailure(
        statusResponse.status,
        statusPayload?.detail || statusPayload?.message || "crawl status failed"
      );
    }

    if (statusPayload?.state === "succeeded" ||
        statusPayload?.state === "partially_succeeded") {
      const manifest = statusPayload.result_manifest;
      if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
        return crawlFailure(502, "crawl completed without a valid result_manifest");
      }
      return {
        status: 200,
        ok: true,
        payload: {
          ok: true,
          command: "crawl",
          message: formatCrawlManifest(manifest),
          active: true
        },
        contentType: "application/json"
      };
    }
    if (statusPayload?.state === "failed" || statusPayload?.state === "cancelled") {
      const detail = statusPayload?.error?.message || statusPayload?.error ||
        `crawl ${statusPayload.state}`;
      return crawlFailure(502, String(detail));
    }
    if (pollIntervalMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }
  }
  return crawlFailure(504, "crawl timed out");
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
