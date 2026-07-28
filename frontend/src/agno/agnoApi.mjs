async function requestJson(url, { method = "GET", body, fetchImpl = fetch } = {}) {
  const headers = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const response = await fetchImpl(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.message || data.error || `request failed: ${response.status}`);
    error.code = data.error || "AGNO_REQUEST_FAILED";
    error.status = response.status;
    throw error;
  }
  return data;
}

export function fetchAgnoStatus({ fetchImpl = fetch } = {}) {
  return requestJson("/api/agno/status", { fetchImpl });
}

export function startAgno({ fetchImpl = fetch } = {}) {
  return requestJson("/api/agno/start", { method: "POST", body: {}, fetchImpl });
}

export function stopAgno({ fetchImpl = fetch } = {}) {
  return requestJson("/api/agno/stop", { method: "POST", body: {}, fetchImpl });
}

export function restartAgno({ fetchImpl = fetch } = {}) {
  return requestJson("/api/agno/restart", { method: "POST", body: {}, fetchImpl });
}

export function fetchAgnoCatalog({ fetchImpl = fetch } = {}) {
  return requestJson("/api/agno/catalog", { fetchImpl });
}

export function createAgnoRun(payload, { fetchImpl = fetch } = {}) {
  return requestJson("/api/agno/runs", { method: "POST", body: payload, fetchImpl });
}

export function fetchAgnoRuns({ fetchImpl = fetch } = {}) {
  return requestJson("/api/agno/runs", { fetchImpl });
}

export function fetchAgnoRun(runId, { fetchImpl = fetch } = {}) {
  return requestJson(`/api/agno/runs/${encodeURIComponent(runId)}`, { fetchImpl });
}

export function cancelAgnoRun(runId, { fetchImpl = fetch } = {}) {
  return requestJson(`/api/agno/runs/${encodeURIComponent(runId)}/cancel`, { method: "POST", body: {}, fetchImpl });
}

export function ensureAgnoUi({ fetchImpl = fetch } = {}) {
  return requestJson("/api/agno/agent-ui/ensure", { method: "POST", body: {}, fetchImpl });
}

export function stopAgnoUi({ fetchImpl = fetch } = {}) {
  return requestJson("/api/agno/agent-ui/stop", { method: "POST", body: {}, fetchImpl });
}
