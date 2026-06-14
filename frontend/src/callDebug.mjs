// API client for the Call Debug tab: lists and clears the server's recorded
// outbound calls (ds4-server model + Deep Research providers).

export async function fetchCallDebug({ limit = 200, fetchImpl = fetch } = {}) {
  const res = await fetchImpl(`/api/call-debug?limit=${encodeURIComponent(limit)}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `request failed: ${res.status}`);
  return {
    enabled: Boolean(data.enabled),
    entries: Array.isArray(data.entries) ? data.entries : []
  };
}

export async function clearCallDebug({ fetchImpl = fetch } = {}) {
  const res = await fetchImpl("/api/call-debug", { method: "DELETE" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `request failed: ${res.status}`);
  return true;
}
