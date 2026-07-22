async function requestJson(url, { method = "GET", body, token, fetchImpl = fetch } = {}) {
  const headers = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetchImpl(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.message || data.error || `request failed: ${response.status}`);
    error.code = data.error || "EVOLUTION_REQUEST_FAILED";
    error.status = response.status;
    throw error;
  }
  return data;
}

export function listEvolutionRuns({ cursor, limit = 50, fetchImpl = fetch } = {}) {
  const query = new URLSearchParams({ limit: String(limit) });
  if (cursor) query.set("cursor", cursor);
  return requestJson(`/api/evolution/runs?${query}`, { fetchImpl });
}

export function createEvolutionRun(task, token, { fetchImpl = fetch } = {}) {
  return requestJson("/api/evolution/runs", { method: "POST", body: task, token, fetchImpl });
}

export function fetchEvolutionRun(runId, { fetchImpl = fetch } = {}) {
  return requestJson(`/api/evolution/runs/${encodeURIComponent(runId)}`, { fetchImpl });
}

export function startEvolutionRun(runId, token, { fetchImpl = fetch } = {}) {
  return requestJson(`/api/evolution/runs/${encodeURIComponent(runId)}/start`, { method: "POST", body: {}, token, fetchImpl });
}

export function cancelEvolutionRun(runId, token, { fetchImpl = fetch } = {}) {
  return requestJson(`/api/evolution/runs/${encodeURIComponent(runId)}/cancel`, { method: "POST", body: {}, token, fetchImpl });
}

export function fetchEvolutionRevision(runId, revision, { fetchImpl = fetch } = {}) {
  return requestJson(`/api/evolution/runs/${encodeURIComponent(runId)}/revisions/${revision}`, { fetchImpl });
}

export function approveEvolutionRevision(runId, revision, review, token, { fetchImpl = fetch } = {}) {
  return requestJson(`/api/evolution/runs/${encodeURIComponent(runId)}/revisions/${revision}/approve`, { method: "POST", body: review, token, fetchImpl });
}

export function rejectEvolutionRevision(runId, revision, reviewer, token, { fetchImpl = fetch } = {}) {
  return requestJson(`/api/evolution/runs/${encodeURIComponent(runId)}/revisions/${revision}/reject`, { method: "POST", body: { reviewer }, token, fetchImpl });
}

export function rollbackEvolutionRevision(runId, revision, reviewer, token, { fetchImpl = fetch } = {}) {
  return requestJson(`/api/evolution/runs/${encodeURIComponent(runId)}/revisions/${revision}/rollback`, { method: "POST", body: { reviewer }, token, fetchImpl });
}

export function openEvolutionStream(runId, afterSequence, onEvent, { EventSourceImpl = EventSource } = {}) {
  const stream = new EventSourceImpl(`/api/evolution/runs/${encodeURIComponent(runId)}/stream?afterSequence=${afterSequence || 0}`);
  stream.addEventListener("message", (message) => {
    try { onEvent(JSON.parse(message.data)); } catch { /* malformed events are ignored */ }
  });
  return stream;
}
