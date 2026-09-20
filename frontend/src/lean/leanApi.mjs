async function requestJson(url, { method = "GET", body, fetchImpl = fetch } = {}) {
  const headers = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const response = await fetchImpl(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.message || data.error || `request failed: ${response.status}`);
    error.code = data.error || "LEAN_REQUEST_FAILED";
    error.status = response.status;
    throw error;
  }
  return data;
}

export function fetchLeanStatus({ fetchImpl = fetch } = {}) {
  return requestJson("/api/lean/status", { fetchImpl });
}

export function fetchLeanHistory({ sessionId, fetchImpl = fetch } = {}) {
  const url = sessionId
    ? `/api/lean/history/${encodeURIComponent(sessionId)}`
    : "/api/lean/history";
  return requestJson(url, { fetchImpl });
}
