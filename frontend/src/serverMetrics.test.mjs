import assert from "node:assert/strict";
import test from "node:test";
import {
  metricRows,
  metricsAvailable,
  metricsSummary,
  secondsLabel
} from "./serverMetrics.mjs";

test("secondsLabel formats server timing values compactly", () => {
  assert.equal(secondsLabel(0.622858), "623 ms");
  assert.equal(secondsLabel(3.209799), "3.21 s");
  assert.equal(secondsLabel(null), "-");
});

test("metricsAvailable requires core server metric counters", () => {
  assert.equal(metricsAvailable(null), false);
  assert.equal(metricsAvailable({ queued_jobs: 0 }), false);
  assert.equal(metricsAvailable({
    queued_jobs: 0,
    max_queued_jobs: 8,
    total_requests: 10,
    completed_requests: 10,
    rejected_jobs: 0,
    total_send_failures: 0,
    total_stream_stalls: 0,
    sse_frame_count: 40,
    send_all_calls: 50,
    last_prefill_sec: 0.5,
    last_decode_sec: 3.2,
    last_ttft_sec: 0.5,
    last_prompt_tokens: 21,
    last_completion_tokens: 32,
    last_cached_tokens: 0,
    mtp_enabled: 0,
    mtp_drafted_tokens: 0,
    mtp_accepted_tokens: 0,
    mtp_accept_rate: 0,
    mtp_verify_ms: 0,
    kv_cache_enabled: 1,
    kv_cache_entries: 2,
    kv_cache_bytes: 4096,
    kv_cache_budget_bytes: 8192,
    kv_cache_full_scans: 3,
    kv_cache_disk_hits: 4,
    kv_cache_disk_misses: 5,
    kv_cache_disk_loaded_tokens: 6000,
    kv_cache_store_successes: 6,
    kv_cache_store_failures: 1,
    kv_cache_last_load_tokens: 2048,
    kv_cache_last_load_ms: 375.0,
    kv_cache_last_store_tokens: 4096
  }), true);
});

test("metricRows returns stable UI rows grouped for scanning", () => {
  const rows = metricRows({
    queued_jobs: 1,
    max_queued_jobs: 8,
    total_requests: 12,
    completed_requests: 11,
    rejected_jobs: 1,
    total_send_failures: 0,
    total_stream_stalls: 2,
    sse_frame_count: 120,
    send_all_calls: 140,
    last_prefill_sec: 0.622858,
    last_decode_sec: 3.209799,
    last_ttft_sec: 0.622858,
    last_prompt_tokens: 21,
    last_completion_tokens: 32,
    last_cached_tokens: 0,
    mtp_enabled: 1,
    mtp_drafted_tokens: 128,
    mtp_accepted_tokens: 96,
    mtp_accept_rate: 0.75,
    mtp_verify_ms: 42.4,
    kv_cache_enabled: 1,
    kv_cache_entries: 2,
    kv_cache_bytes: 4096,
    kv_cache_budget_bytes: 8192,
    kv_cache_full_scans: 3,
    kv_cache_disk_hits: 4,
    kv_cache_disk_misses: 5,
    kv_cache_disk_loaded_tokens: 6000,
    kv_cache_store_successes: 6,
    kv_cache_store_failures: 1,
    kv_cache_last_load_tokens: 2048,
    kv_cache_last_load_ms: 375.0,
    kv_cache_last_store_tokens: 4096
  });

  assert.deepEqual(rows.map((row) => [row.label, row.value, row.kind]), [
    ["Queue", "1 / 8", "warn"],
    ["Requests", "11 / 12", "plain"],
    ["Rejected", "1", "bad"],
    ["Send failures", "0", "plain"],
    ["Stream stalls", "2", "warn"],
    ["SSE frames", "120", "plain"],
    ["Send calls", "140", "plain"],
    ["TTFT", "623 ms", "plain"],
    ["Prefill", "623 ms", "plain"],
    ["Decode", "3.21 s", "plain"],
    ["Prompt tokens", "21", "plain"],
    ["Completion tokens", "32", "plain"],
    ["Cached tokens", "0", "plain"],
    ["MTP", "on", "plain"],
    ["MTP accept", "75.0%", "plain"],
    ["MTP drafted", "128", "plain"],
    ["MTP accepted", "96", "plain"],
    ["MTP verify", "42 ms", "plain"],
    ["KV cache", "on", "plain"],
    ["KV entries", "2", "plain"],
    ["KV size", "4.0 KiB / 8.0 KiB", "plain"],
    ["KV scans", "3", "plain"],
    ["KV hits", "4", "plain"],
    ["KV misses", "5", "warn"],
    ["KV load tokens", "6000", "plain"],
    ["KV last load", "2048 · 375 ms", "plain"],
    ["KV stores", "6 / 1", "warn"],
    ["KV last store", "4096", "plain"]
  ]);
});

test("metricsSummary reports the current worker and request state", () => {
  assert.equal(metricsSummary(null), "Metrics unavailable");
  assert.equal(metricsSummary({
    queued_jobs: 0,
    max_queued_jobs: 8,
    total_requests: 12,
    completed_requests: 12,
    rejected_jobs: 0,
    total_send_failures: 0,
    total_stream_stalls: 0,
    sse_frame_count: 120,
    send_all_calls: 140,
    last_prefill_sec: 0.622858,
    last_decode_sec: 3.209799,
    last_ttft_sec: 0.622858,
    last_prompt_tokens: 21,
    last_completion_tokens: 32,
    last_cached_tokens: 0,
    mtp_enabled: 0,
    mtp_drafted_tokens: 0,
    mtp_accepted_tokens: 0,
    mtp_accept_rate: 0,
    mtp_verify_ms: 0,
    kv_cache_enabled: 1,
    kv_cache_entries: 2,
    kv_cache_bytes: 4096,
    kv_cache_budget_bytes: 8192,
    kv_cache_full_scans: 3,
    kv_cache_disk_hits: 4,
    kv_cache_disk_misses: 0,
    kv_cache_disk_loaded_tokens: 6000,
    kv_cache_store_successes: 6,
    kv_cache_store_failures: 0,
    kv_cache_last_load_tokens: 2048,
    kv_cache_last_load_ms: 375.0,
    kv_cache_last_store_tokens: 4096
  }), "Queue 0/8 · completed 12/12 · last decode 3.21 s");
});
