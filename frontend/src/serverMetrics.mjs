// Every counter the panel knows how to draw. The backend does not have to
// supply them all: ds4_server_runtime.c emits the kv-cache and slot family and
// sets compat_counters_available=false for the rest, so requiring the whole set
// threw away readings that were perfectly good.
const ALL_METRIC_KEYS = [
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

// The smallest set that means "this really is a metrics payload". Anything
// beyond it is drawn when present and skipped when not.
const CORE_METRIC_KEYS = ["queued_jobs", "kv_cache_enabled", "kv_cache_entries"];

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
  return CORE_METRIC_KEYS.every((key) => numberValue(metrics[key]) !== null);
}

/** Counters the panel can draw but this backend did not send. */
export function missingMetricKeys(metrics) {
  if (!metrics || typeof metrics !== "object") return ALL_METRIC_KEYS.slice();
  return ALL_METRIC_KEYS.filter((key) => numberValue(metrics[key]) === null);
}

/** True when the backend says outright that it keeps no request counters. */
export function metricsDegraded(metrics) {
  return metrics?.compat_counters_available === false || missingMetricKeys(metrics).length > 0;
}

export function metricRows(metrics) {
  if (!metricsAvailable(metrics)) return [];
  const has = (...keys) => keys.some((key) => numberValue(metrics[key]) !== null);
  // A row whose counters the backend never sent is dropped rather than drawn as
  // a dash: a panel of placeholders hides the readings that are real.
  const rows = [
    has("queued_jobs", "max_queued_jobs") && {
      label: "Queue",
      value: `${integerLabel(metrics.queued_jobs)} / ${integerLabel(metrics.max_queued_jobs)}`,
      kind: metrics.queued_jobs > 0 ? "warn" : "plain"
    },
    has("slot_count", "busy_slots") && {
      label: "Slots",
      value: `${integerLabel(metrics.busy_slots)} / ${integerLabel(metrics.slot_count)}`,
      kind: "plain"
    },
    has("completed_requests", "total_requests") && {
      label: "Requests",
      value: `${integerLabel(metrics.completed_requests)} / ${integerLabel(metrics.total_requests)}`,
      kind: "plain"
    },
    has("rejected_jobs") && {
      label: "Rejected",
      value: integerLabel(metrics.rejected_jobs),
      kind: metrics.rejected_jobs > 0 ? "bad" : "plain"
    },
    has("total_send_failures") && {
      label: "Send failures",
      value: integerLabel(metrics.total_send_failures),
      kind: metrics.total_send_failures > 0 ? "bad" : "plain"
    },
    has("total_stream_stalls") && {
      label: "Stream stalls",
      value: integerLabel(metrics.total_stream_stalls),
      kind: metrics.total_stream_stalls > 0 ? "warn" : "plain"
    },
    has("sse_frame_count") && { label: "SSE frames", value: integerLabel(metrics.sse_frame_count), kind: "plain" },
    has("send_all_calls") && { label: "Send calls", value: integerLabel(metrics.send_all_calls), kind: "plain" },
    has("last_ttft_sec") && { label: "TTFT", value: secondsLabel(metrics.last_ttft_sec), kind: "plain" },
    has("last_prefill_sec") && { label: "Prefill", value: secondsLabel(metrics.last_prefill_sec), kind: "plain" },
    has("last_decode_sec") && { label: "Decode", value: secondsLabel(metrics.last_decode_sec), kind: "plain" },
    has("last_prompt_tokens") && { label: "Prompt tokens", value: integerLabel(metrics.last_prompt_tokens), kind: "plain" },
    has("last_completion_tokens") && { label: "Completion tokens", value: integerLabel(metrics.last_completion_tokens), kind: "plain" },
    has("last_cached_tokens") && { label: "Cached tokens", value: integerLabel(metrics.last_cached_tokens), kind: "plain" },
    has("mtp_enabled") && { label: "MTP", value: metrics.mtp_enabled ? "on" : "off", kind: "plain" },
    has("mtp_accept_rate") && { label: "MTP accept", value: percentLabel(metrics.mtp_accept_rate), kind: "plain" },
    has("mtp_drafted_tokens") && { label: "MTP drafted", value: integerLabel(metrics.mtp_drafted_tokens), kind: "plain" },
    has("mtp_accepted_tokens") && { label: "MTP accepted", value: integerLabel(metrics.mtp_accepted_tokens), kind: "plain" },
    has("mtp_verify_ms") && { label: "MTP verify", value: millisecondsLabel(metrics.mtp_verify_ms), kind: "plain" },
    has("kv_cache_enabled") && {
      label: "KV cache",
      value: metrics.kv_cache_enabled ? "on" : "off",
      kind: metrics.kv_cache_enabled ? "plain" : "warn"
    },
    has("kv_cache_entries") && { label: "KV entries", value: integerLabel(metrics.kv_cache_entries), kind: "plain" },
    has("kv_cache_bytes", "kv_cache_budget_bytes") && {
      label: "KV size",
      value: `${bytesLabel(metrics.kv_cache_bytes)} / ${bytesLabel(metrics.kv_cache_budget_bytes)}`,
      kind: "plain"
    },
    has("kv_cache_full_scans") && { label: "KV scans", value: integerLabel(metrics.kv_cache_full_scans), kind: "plain" },
    has("kv_cache_disk_hits") && { label: "KV hits", value: integerLabel(metrics.kv_cache_disk_hits), kind: "plain" },
    has("kv_cache_disk_misses") && {
      label: "KV misses",
      value: integerLabel(metrics.kv_cache_disk_misses),
      kind: metrics.kv_cache_disk_misses > 0 ? "warn" : "plain"
    },
    has("kv_cache_disk_loaded_tokens") && { label: "KV load tokens", value: integerLabel(metrics.kv_cache_disk_loaded_tokens), kind: "plain" },
    has("kv_cache_last_load_tokens", "kv_cache_last_load_ms") && {
      label: "KV last load",
      value: `${integerLabel(metrics.kv_cache_last_load_tokens)} \u00b7 ${millisecondsLabel(metrics.kv_cache_last_load_ms)}`,
      kind: "plain"
    },
    has("kv_cache_store_successes", "kv_cache_store_failures") && {
      label: "KV stores",
      value: `${integerLabel(metrics.kv_cache_store_successes)} / ${integerLabel(metrics.kv_cache_store_failures)}`,
      kind: metrics.kv_cache_store_failures > 0 ? "warn" : "plain"
    },
    has("kv_cache_last_store_tokens") && { label: "KV last store", value: integerLabel(metrics.kv_cache_last_store_tokens), kind: "plain" }
  ];
  return rows.filter(Boolean);
}

export function metricsSummary(metrics) {
  if (!metricsAvailable(metrics)) return "Metrics unavailable";
  return `Queue ${integerLabel(metrics.queued_jobs)}/${integerLabel(metrics.max_queued_jobs)} ` +
    `· completed ${integerLabel(metrics.completed_requests)}/${integerLabel(metrics.total_requests)} ` +
    `· last decode ${secondsLabel(metrics.last_decode_sec)}`;
}
