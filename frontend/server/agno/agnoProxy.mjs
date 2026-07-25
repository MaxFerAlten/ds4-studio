/**
 * Proxy helpers for forwarding requests between the DS4 Node server and Agno AgentOS.
 * Exports allow-listed functions rather than a catch-all proxy.
 */

import { readRequestBody, requestHeadersForProxy } from "../proxy.mjs";

/**
 * Forward an SSE event stream from AgentOS to the browser.
 * Uses backpressure-aware piping and client disconnect handling.
 */
export async function forwardEventStream(upstream, res, { signal } = {}) {
  if (!upstream.body) {
    res.end();
    return;
  }
  const reader = upstream.body.getReader();
  const pump = async () => {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(value);
      }
    } catch (err) {
      // Stream error — upstream or client disconnected
    } finally {
      res.end();
    }
  };
  pump().catch(() => {
    res.end();
  });
}

/**
 * Proxy a POST request to AgentOS with body forwarding.
 * Used for creating runs and cancelling runs.
 */
export async function proxyPostToAgno(baseUrl, path, req, res, { signal, fetchImpl = fetch } = {}) {
  const body = await readRequestBody(req);
  const headers = requestHeadersForProxy(req, body);
  try {
    const upstream = await fetchImpl(`${baseUrl}${path}`, {
      method: "POST",
      headers,
      body,
      signal,
    });
    if (!upstream.ok) {
      const errBody = await upstream.json().catch(() => ({ error: "proxy error" }));
      res.status(upstream.status).json(errBody);
      return;
    }
    const result = await upstream.json();
    res.json(result);
  } catch (err) {
    res.status(502).json({ error: "DS4_BACKEND_UNAVAILABLE" });
  }
}
