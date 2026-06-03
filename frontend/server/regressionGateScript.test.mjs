import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const SERVER_DIR = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_DIR = path.resolve(SERVER_DIR, "..");
const PROJECT_ROOT = path.resolve(FRONTEND_DIR, "..");
const GATE_SCRIPT = path.join(PROJECT_ROOT, "tests", "ds4-studio", "regression_gate.sh");

async function writeTempFile(prefix, content) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  const file = path.join(dir, "input.txt");
  await fs.writeFile(file, content);
  return file;
}

async function writeBaseline(overrides = {}) {
  const values = {
    DS4_EXPECT_CUDA_Q8_F16_CACHE_MB: "11264",
    DS4_EXPECT_CUDA_Q8_F16_CACHE_RESERVE_MB: "512",
    DS4_EXPECT_CUDA_COPY_MODEL_CHUNKED: "1",
    DS4_REGRESSION_CONC: "4",
    DS4_REGRESSION_REQS: "20",
    DS4_REGRESSION_MAX_TOKENS: "32",
    DS4_REGRESSION_MODEL: "ds4",
    DS4_BASELINE_TTFB_P95_SEC: "10",
    DS4_BASELINE_TOTAL_P95_SEC: "20",
    DS4_ALLOWED_SLOWDOWN_PCT: "10",
    DS4_MIN_OK_REQUESTS: "20",
    DS4_MAX_HTTP_503: "0",
    DS4_MAX_FAILED_REQUESTS: "0",
    ...overrides
  };
  const body = Object.entries(values).map(([key, value]) => `${key}=${value}\n`).join("");
  return writeTempFile("ds4-baseline-", body);
}

function runGate(args, env = {}) {
  return spawnSync("bash", [GATE_SCRIPT, ...args], {
    cwd: PROJECT_ROOT,
    env: { ...process.env, ...env },
    encoding: "utf8"
  });
}

test("regression gate accepts healthy frontend status with tuned GPU env", async () => {
  const baseline = await writeBaseline();
  const status = await writeTempFile("ds4-status-", JSON.stringify({
    running: true,
    healthy: true,
    backendBase: "http://127.0.0.1:8002",
    config: {
      server: {
        env: {
          DS4_CUDA_Q8_F16_CACHE_MB: "11264",
          DS4_CUDA_Q8_F16_CACHE_RESERVE_MB: "512",
          DS4_CUDA_COPY_MODEL_CHUNKED: "1"
        }
      }
    }
  }));

  const result = runGate(["--check-status-json", status], { BASELINE_FILE: baseline });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /frontend status healthy/);
});

test("regression gate rejects frontend status before backend is healthy", async () => {
  const baseline = await writeBaseline();
  const status = await writeTempFile("ds4-status-", JSON.stringify({
    running: true,
    healthy: false,
    backendBase: "http://127.0.0.1:8002",
    config: { server: { env: {} } }
  }));

  const result = runGate(["--check-status-json", status], { BASELINE_FILE: baseline });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr + result.stdout, /healthy/);
});

test("regression gate accepts server metrics JSON", async () => {
  const metrics = await writeTempFile("ds4-metrics-", JSON.stringify({
    queued_jobs: 0,
    max_queued_jobs: 8,
    total_requests: 10,
    completed_requests: 10,
    rejected_jobs: 0,
    total_send_failures: 0,
    total_stream_stalls: 0,
    sse_frame_count: 42,
    send_all_calls: 50,
    last_prefill_sec: 0.6,
    last_decode_sec: 3.2,
    last_ttft_sec: 0.6,
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
  }));

  const result = runGate(["--check-metrics-json", metrics]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /metrics JSON ok/);
});

test("regression gate rejects metrics JSON without KV counters", async () => {
  const metrics = await writeTempFile("ds4-metrics-", JSON.stringify({
    queued_jobs: 0,
    max_queued_jobs: 8,
    total_requests: 10,
    completed_requests: 10,
    rejected_jobs: 0,
    total_send_failures: 0,
    total_stream_stalls: 0,
    sse_frame_count: 42,
    send_all_calls: 50,
    last_prefill_sec: 0.6,
    last_decode_sec: 3.2,
    last_ttft_sec: 0.6,
    last_prompt_tokens: 21,
    last_completion_tokens: 32,
    last_cached_tokens: 0
  }));

  const result = runGate(["--check-metrics-json", metrics]);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr + result.stdout, /kv_cache_enabled/);
});

test("regression gate rejects metrics JSON without MTP counters", async () => {
  const metrics = await writeTempFile("ds4-metrics-", JSON.stringify({
    queued_jobs: 0,
    max_queued_jobs: 8,
    total_requests: 10,
    completed_requests: 10,
    rejected_jobs: 0,
    total_send_failures: 0,
    total_stream_stalls: 0,
    sse_frame_count: 42,
    send_all_calls: 50,
    last_prefill_sec: 0.6,
    last_decode_sec: 3.2,
    last_ttft_sec: 0.6,
    last_prompt_tokens: 21,
    last_completion_tokens: 32,
    last_cached_tokens: 0,
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
  }));

  const result = runGate(["--check-metrics-json", metrics]);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr + result.stdout, /mtp_enabled/);
});

test("regression gate rejects metrics JSON missing counters", async () => {
  const metrics = await writeTempFile("ds4-metrics-", JSON.stringify({
    queued_jobs: 0
  }));

  const result = runGate(["--check-metrics-json", metrics]);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr + result.stdout, /missing numeric fields/);
});

test("regression gate accepts server load summary within performance baseline", async () => {
  const baseline = await writeBaseline();
  const summary = await writeTempFile("ds4-summary-", [
    "ok_requests=20",
    "http_503=0",
    "failed_requests=0",
    "ttfb_p50=6.0",
    "ttfb_p95=10.8",
    "total_p50=13.0",
    "total_p95=21.5",
    "out=/tmp/ds4-load.tsv",
    ""
  ].join("\n"));

  const result = runGate(["--check-summary", summary], { BASELINE_FILE: baseline });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /performance summary within baseline/);
});

test("regression gate rejects slower server load total p95", async () => {
  const baseline = await writeBaseline();
  const summary = await writeTempFile("ds4-summary-", [
    "ok_requests=20",
    "http_503=0",
    "failed_requests=0",
    "ttfb_p50=6.0",
    "ttfb_p95=10.8",
    "total_p50=13.0",
    "total_p95=23.0",
    "out=/tmp/ds4-load.tsv",
    ""
  ].join("\n"));

  const result = runGate(["--check-summary", summary], { BASELINE_FILE: baseline });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr + result.stdout, /total_p95/);
});
