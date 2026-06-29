/**
 * Crawl client — submits a URL to the crawl service and polls until the job
 * finishes, returning the raw result manifest.  Shared by the /crawl native
 * command (full dump) and the agent `crawl` tool (summarized).
 */

function fail(status, message) {
  return { ok: false, status, message };
}

/**
 * @param {typeof fetch} fetchImpl
 * @param {{ baseUrl: string, token?: string, url: string, signal?: AbortSignal,
 *           maxPolls?: number, pollIntervalMs?: number }} opts
 * @returns {Promise<{ ok: true, manifest: object } | { ok: false, status: number, message: string }>}
 */
export async function crawlUrl(fetchImpl, opts) {
  const { baseUrl, token, url, signal } = opts;
  if (!baseUrl) return fail(400, "crawl service is not configured");

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return fail(400, "crawl requires a valid URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return fail(400, "crawl URL must use http or https");
  }

  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;

  const create = await fetchImpl(`${baseUrl}/jobs`, {
    method: "POST",
    headers,
    body: JSON.stringify({ url: parsed.href }),
    signal
  });
  const created = await readJson(create);
  if (!create.ok) {
    return fail(create.status, created?.detail || created?.message || "crawl request failed");
  }
  const jobId = typeof created?.job_id === "string" ? created.job_id : "";
  if (!jobId) return fail(502, "crawl service did not return a job_id");

  const maxPolls = Number.isInteger(opts.maxPolls) ? opts.maxPolls : 120;
  const pollIntervalMs = Number.isFinite(opts.pollIntervalMs) ? Math.max(0, opts.pollIntervalMs) : 1000;
  for (let attempt = 0; attempt < maxPolls; attempt += 1) {
    const statusResponse = await fetchImpl(
      `${baseUrl}/jobs/${encodeURIComponent(jobId)}`,
      { method: "GET", headers, signal }
    );
    const statusPayload = await readJson(statusResponse);
    if (!statusResponse.ok) {
      return fail(statusResponse.status, statusPayload?.detail || statusPayload?.message || "crawl status failed");
    }
    if (statusPayload?.state === "succeeded" || statusPayload?.state === "partially_succeeded") {
      const manifest = statusPayload.result_manifest;
      if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
        return fail(502, "crawl completed without a valid result_manifest");
      }
      return { ok: true, manifest };
    }
    if (statusPayload?.state === "failed" || statusPayload?.state === "cancelled") {
      const detail = statusPayload?.error?.message || statusPayload?.error || `crawl ${statusPayload.state}`;
      return fail(502, String(detail));
    }
    if (pollIntervalMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }
  }
  return fail(504, "crawl timed out");
}

async function readJson(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return { message: text || `HTTP ${response.status}` };
  }
}
