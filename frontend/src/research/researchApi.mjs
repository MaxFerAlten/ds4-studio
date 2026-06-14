async function postJson(url, body, fetchImpl) {
  const res = await fetchImpl(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `request failed: ${res.status}`);
  return data;
}

export async function startResearch(query, { fetchImpl = fetch } = {}) {
  return postJson("/api/research/start", { query }, fetchImpl);
}

export async function createResearchSession(query, { fetchImpl = fetch } = {}) {
  return postJson("/api/research/session", { query }, fetchImpl);
}

export async function launchResearch(sessionId, { fetchImpl = fetch } = {}) {
  return postJson("/api/research/start", { sessionId }, fetchImpl);
}

export async function uploadResearchDocument(sessionId, file, { fetchImpl = fetch } = {}) {
  const form = new FormData();
  form.append("file", file);
  const res = await fetchImpl(`/api/research/${sessionId}/documents`, {
    method: "POST",
    body: form
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `upload failed: ${res.status}`);
  return data;
}

export function researchExportUrl(sessionId, format = "md") {
  return `/api/research/export/${sessionId}?format=${format}`;
}

export async function sendFeedback(sessionId, action, plan = undefined, { fetchImpl = fetch } = {}) {
  return postJson("/api/research/feedback", { sessionId, action, plan }, fetchImpl);
}

export async function cancelResearch(sessionId, { fetchImpl = fetch } = {}) {
  return postJson("/api/research/cancel", { sessionId }, fetchImpl);
}

export async function fetchResearchState(sessionId, { fetchImpl = fetch } = {}) {
  const res = await fetchImpl(`/api/research/state/${sessionId}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `request failed: ${res.status}`);
  return data;
}

export async function listResearchSessions({ fetchImpl = fetch } = {}) {
  const res = await fetchImpl("/api/research/sessions");
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `request failed: ${res.status}`);
  return data.sessions || [];
}

export function openResearchStream(sessionId, onEvent, { EventSourceImpl = EventSource, lastSeq = 0 } = {}) {
  const es = new EventSourceImpl(`/api/research/stream/${sessionId}?lastSeq=${lastSeq}`);
  es.addEventListener("research_event", (msg) => {
    let event;
    try {
      event = JSON.parse(msg.data);
    } catch {
      return;
    }
    onEvent(event);
  });
  return es;
}
