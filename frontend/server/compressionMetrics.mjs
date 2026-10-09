export function createCompressionMetrics() {
  const totals = {
    events: 0,
    originalBytes: 0,
    compressedBytes: 0,
    blobCount: 0,
    retrieveCount: 0,
    lastStrategy: "",
    lastBlobId: ""
  };

  return {
    recordCompression(compression) {
      if (!compression?.changed || !compression.text) return false;
      totals.events += 1;
      totals.originalBytes += Number(compression.originalBytes) || 0;
      totals.compressedBytes += Number(compression.compressedBytes) || 0;
      if (compression.blobId) {
        totals.blobCount += 1;
        totals.lastBlobId = String(compression.blobId);
      }
      totals.lastStrategy = String(compression.strategy || "");
      return true;
    },

    recordRetrieve(success) {
      if (!success) return false;
      totals.retrieveCount += 1;
      return true;
    },

    snapshot({ enabled = false, source = "node-js" } = {}) {
      return {
        ok: true,
        active: false,
        ...totals,
        enabled: Boolean(enabled),
        source
      };
    }
  };
}

export function createCompressionMetricsHandler({
  getEngine,
  getBackendBase,
  isEnabled,
  metrics,
  fetchImpl = globalThis.fetch,
  timeoutMs = 1000
} = {}) {
  if (typeof getEngine !== "function") throw new TypeError("getEngine is required");
  if (typeof getBackendBase !== "function") throw new TypeError("getBackendBase is required");
  if (typeof isEnabled !== "function") throw new TypeError("isEnabled is required");
  if (!metrics || typeof metrics.snapshot !== "function") throw new TypeError("metrics is required");
  if (typeof fetchImpl !== "function") throw new TypeError("fetchImpl is required");

  return async function compressionMetricsHandler(_req, res) {
    if (getEngine() !== "native") {
      return res.json(metrics.snapshot({ enabled: isEnabled(), source: "node-js" }));
    }

    const backendBase = getBackendBase();
    if (!backendBase) {
      return res.status(503).json({
        ok: false,
        source: "wrapper-native",
        error: "Native compression metrics are unavailable: wrapper backend is not configured."
      });
    }

    let response;
    try {
      response = await fetchImpl(`${backendBase}/api/agent/compression-metrics`, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(timeoutMs)
      });
    } catch (error) {
      return res.status(502).json({
        ok: false,
        source: "wrapper-native",
        error: `Native compression metrics request failed: ${String(error?.message || error)}`
      });
    }

    const text = await response.text();
    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
    if (!response.ok) {
      return res.status(response.status).json({
        ok: false,
        source: "wrapper-native",
        error: payload?.error || `Wrapper returned HTTP ${response.status}.`
      });
    }
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return res.status(502).json({
        ok: false,
        source: "wrapper-native",
        error: "Wrapper returned invalid compression metrics."
      });
    }

    return res.json({ ...payload, source: "wrapper-native" });
  };
}
