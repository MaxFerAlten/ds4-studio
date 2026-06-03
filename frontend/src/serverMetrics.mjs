const REQUIRED_METRIC_KEYS = [
  "queued_jobs",
  "max_queued_jobs",
  "total_requests",
  "completed_requests",
  "rejected_jobs",
  "total_send_failures",
  "total_stream_stalls",
  "sse_frame_count",
  "send_all_calls",
  "last_prefill_sec",
  "last_decode_sec",
  "last_ttft_sec",
  "last_prompt_tokens",
  "last_completion_tokens",
  "last_cached_tokens",
  "mtp_enabled",
  "mtp_drafted_tokens",
  "mtp_accepted_tokens",
  "mtp_accept_rate",
  "mtp_verify_ms",
  "kv_cache_enabled",
  "kv_cache_entries",
  "kv_cache_bytes",
  "kv_cache_budget_bytes",
  "kv_cache_full_scans",
  "kv_cache_disk_hits",
  "kv_cache_disk_misses",
  "kv_cache_disk_loaded_tokens",
  "kv_cache_store_successes",
  "kv_cache_store_failures",
  "kv_cache_last_load_tokens",
  "kv_cache_last_load_ms",
  "kv_cache_last_store_tokens"
];

function numberValue(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function integerLabel(value) {
  const n = numberValue(value);
  return n === null ? "-" : String(n);
}

export function secondsLabel(value) {
  const n = numberValue(value);
  if (n === null) return "-";
  if (n < 1) return `${Math.round(n * 1000)} ms`;
  return `${n.toFixed(2)} s`;
}

export function millisecondsLabel(value) {
  const n = numberValue(value);
  if (n === null) return "-";
  if (n < 1000) return `${Math.round(n)} ms`;
  return `${(n / 1000).toFixed(2)} s`;
}

export function bytesLabel(value) {
  const n = numberValue(value);
  if (n === null) return "-";
  if (n < 1024) return `${Math.round(n)} B`;
  const units = ["KiB", "MiB", "GiB", "TiB"];
  let scaled = n / 1024;
  let unit = units[0];
  for (let i = 1; i < units.length && scaled >= 1024; i++) {
    scaled /= 1024;
    unit = units[i];
  }
  return `${scaled.toFixed(1)} ${unit}`;
}

function percentLabel(value) {
  const n = numberValue(value);
  return n === null ? "-" : `${(n * 100).toFixed(1)}%`;
}

export function metricsAvailable(metrics) {
  if (!metrics || typeof metrics !== "object") return false;
  return REQUIRED_METRIC_KEYS.every((key) => typeof metrics[key] === "number" && Number.isFinite(metrics[key]));
}

export function metricRows(metrics) {
  if (!metricsAvailable(metrics)) return [];
  return [
    {
      label: "Queue",
      value: `${integerLabel(metrics.queued_jobs)} / ${integerLabel(metrics.max_queued_jobs)}`,
      kind: metrics.queued_jobs > 0 ? "warn" : "plain"
    },
    {
      label: "Requests",
      value: `${integerLabel(metrics.completed_requests)} / ${integerLabel(metrics.total_requests)}`,
      kind: "plain"
    },
    {
      label: "Rejected",
      value: integerLabel(metrics.rejected_jobs),
      kind: metrics.rejected_jobs > 0 ? "bad" : "plain"
    },
    {
      label: "Send failures",
      value: integerLabel(metrics.total_send_failures),
      kind: metrics.total_send_failures > 0 ? "bad" : "plain"
    },
    {
      label: "Stream stalls",
      value: integerLabel(metrics.total_stream_stalls),
      kind: metrics.total_stream_stalls > 0 ? "warn" : "plain"
    },
    { label: "SSE frames", value: integerLabel(metrics.sse_frame_count), kind: "plain" },
    { label: "Send calls", value: integerLabel(metrics.send_all_calls), kind: "plain" },
    { label: "TTFT", value: secondsLabel(metrics.last_ttft_sec), kind: "plain" },
    { label: "Prefill", value: secondsLabel(metrics.last_prefill_sec), kind: "plain" },
    { label: "Decode", value: secondsLabel(metrics.last_decode_sec), kind: "plain" },
    { label: "Prompt tokens", value: integerLabel(metrics.last_prompt_tokens), kind: "plain" },
    { label: "Completion tokens", value: integerLabel(metrics.last_completion_tokens), kind: "plain" },
    { label: "Cached tokens", value: integerLabel(metrics.last_cached_tokens), kind: "plain" },
    { label: "MTP", value: metrics.mtp_enabled ? "on" : "off", kind: "plain" },
    { label: "MTP accept", value: percentLabel(metrics.mtp_accept_rate), kind: "plain" },
    { label: "MTP drafted", value: integerLabel(metrics.mtp_drafted_tokens), kind: "plain" },
    { label: "MTP accepted", value: integerLabel(metrics.mtp_accepted_tokens), kind: "plain" },
    { label: "MTP verify", value: millisecondsLabel(metrics.mtp_verify_ms), kind: "plain" },
    {
      label: "KV cache",
      value: metrics.kv_cache_enabled ? "on" : "off",
      kind: metrics.kv_cache_enabled ? "plain" : "warn"
    },
    { label: "KV entries", value: integerLabel(metrics.kv_cache_entries), kind: "plain" },
    {
      label: "KV size",
      value: `${bytesLabel(metrics.kv_cache_bytes)} / ${bytesLabel(metrics.kv_cache_budget_bytes)}`,
      kind: "plain"
    },
    { label: "KV scans", value: integerLabel(metrics.kv_cache_full_scans), kind: "plain" },
    { label: "KV hits", value: integerLabel(metrics.kv_cache_disk_hits), kind: "plain" },
    {
      label: "KV misses",
      value: integerLabel(metrics.kv_cache_disk_misses),
      kind: metrics.kv_cache_disk_misses > 0 ? "warn" : "plain"
    },
    { label: "KV load tokens", value: integerLabel(metrics.kv_cache_disk_loaded_tokens), kind: "plain" },
    {
      label: "KV last load",
      value: `${integerLabel(metrics.kv_cache_last_load_tokens)} · ${millisecondsLabel(metrics.kv_cache_last_load_ms)}`,
      kind: "plain"
    },
    {
      label: "KV stores",
      value: `${integerLabel(metrics.kv_cache_store_successes)} / ${integerLabel(metrics.kv_cache_store_failures)}`,
      kind: metrics.kv_cache_store_failures > 0 ? "warn" : "plain"
    },
    { label: "KV last store", value: integerLabel(metrics.kv_cache_last_store_tokens), kind: "plain" }
  ];
}

export function metricsSummary(metrics) {
  if (!metricsAvailable(metrics)) return "Metrics unavailable";
  return `Queue ${integerLabel(metrics.queued_jobs)}/${integerLabel(metrics.max_queued_jobs)} ` +
    `· completed ${integerLabel(metrics.completed_requests)}/${integerLabel(metrics.total_requests)} ` +
    `· last decode ${secondsLabel(metrics.last_decode_sec)}`;
}
