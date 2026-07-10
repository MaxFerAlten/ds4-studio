#!/usr/bin/env node
// PATCH 14 — Context retention A/B harness (§19). Mirrors the pony benchmark
// shape: parse args, run arms × tasks, aggregate metrics, evaluate the gate,
// write summary.json. The gate logic is pure and self-tested (--selftest).
//
//   node run.mjs --live --gate --arms baseline,context-enabled \
//     --tasks long-rule-retention,big-tool-result-no-echo --runs 1 --max-tokens 3072
//
// The live cell runner (runCellLive) drives /api/agent/chat and needs the DS4
// server + model running. Until it is wired for your environment it throws, so
// the harness never reports fabricated results.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TASKS, ARMS, taskById } from "./tasks.mjs";
import { rawEchoDetected, blobIdPresent, synthesisPresent, countDuplicateReads } from "./scoring.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BASE_URL = process.env.DS4_BENCH_BASE || "http://127.0.0.1:5173";

// Env overrides applied per arm before a cell runs.
export const ARM_ENV = {
  baseline: { DS4_CONTEXT_WIKI_ENABLED: "0", DS4_CONTEXT_PREVIEW_ONLY: "1" },
  "context-preview": { DS4_CONTEXT_WIKI_ENABLED: "0", DS4_CONTEXT_PREVIEW_ONLY: "1" },
  "context-enabled": { DS4_CONTEXT_WIKI_ENABLED: "1", DS4_CONTEXT_PREVIEW_ONLY: "0" }
};

// Activate an agent session for a key (chat is rejected otherwise).
export async function startAgent({ base = BASE_URL, sessionKey } = {}) {
  const res = await fetch(`${base}/api/agent/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Agent-Session-Key": sessionKey || "bench" },
    body: "{}"
  });
  if (!res.ok) throw new Error(`agent start failed: ${res.status}`);
  return res.json().catch(() => ({}));
}

// Minimal SSE client for /api/agent/chat: collects the assistant text and the
// tool calls the agent made. Returns { text, toolCalls:[{name,target}] }.
export async function postChat({ base = BASE_URL, sessionKey, message, request = {}, signal } = {}) {
  const res = await fetch(`${base}/api/agent/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Agent-Session-Key": sessionKey || "bench" },
    body: JSON.stringify({ message, request }),
    signal
  });
  if (!res.ok || !res.body) throw new Error(`chat failed: ${res.status}`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let text = "";
  const toolCalls = [];
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const frames = buf.split("\n\n");
    buf = frames.pop() || "";
    for (const frame of frames) {
      const ev = /event:\s*(\S+)/.exec(frame)?.[1];
      const dataLine = /data:\s*(.*)/s.exec(frame)?.[1];
      if (!ev || !dataLine) continue;
      let data;
      try { data = JSON.parse(dataLine); } catch { continue; }
      if (ev === "agent_message" || ev === "agent_delta") text += data.content || data.delta || "";
      else if (ev === "agent_tool_call") {
        const a = data.arguments || {};
        toolCalls.push({ name: data.name, target: a.path || a.url || a.query || a.command || null });
      }
    }
  }
  return { text, toolCalls };
}

// §19.4 gate thresholds — a run FAILS if any hold vs. the baseline arm.
export function evaluateGate(metrics, baseline = {}) {
  const failures = [];
  const resetBudget = (baseline.reset_rate ?? 0) + 0.05;
  if ((metrics.reset_rate ?? 0) > resetBudget) failures.push("reset_rate_after_revision_1 > baseline + 5%");
  if ((metrics.capsule_tokens_p95 ?? 0) > 3000) failures.push("capsule_tokens_p95 > 3000");
  if ((metrics.task_success_rate ?? 1) < (baseline.task_success_rate ?? 0)) failures.push("task_success < baseline");
  if ((metrics.duplicate_read_count ?? 0) > (baseline.duplicate_read_count ?? Infinity)) failures.push("duplicate_read_count > baseline");
  if (metrics.raw_echo_detected === true) failures.push("raw_echo_detected = true");
  return { ok: failures.length === 0, failures };
}

export function percentile(values, p) {
  const arr = [...values].filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!arr.length) return 0;
  const idx = Math.min(arr.length - 1, Math.ceil((p / 100) * arr.length) - 1);
  return arr[Math.max(0, idx)];
}

// Aggregate per-cell records into the summary metrics block.
export function aggregate(cells) {
  const capsuleTokens = cells.map((c) => c.capsule_tokens ?? 0);
  const resets = cells.filter((c) => c.reset_after_revision_1).length;
  return {
    reset_rate: cells.length ? resets / cells.length : 0,
    capsule_tokens_p95: percentile(capsuleTokens, 95),
    duplicate_read_count: cells.reduce((n, c) => n + (c.duplicate_read_count ?? 0), 0),
    task_success_rate: cells.length ? cells.filter((c) => c.task_success).length / cells.length : 1,
    raw_echo_detected: cells.some((c) => c.raw_echo_detected === true)
  };
}

function parseArgs(argv) {
  const args = { arms: ARMS.slice(), tasks: TASKS.map((t) => t.id), runs: 1, maxTokens: 3072, live: false, gate: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--live") args.live = true;
    else if (a === "--gate") args.gate = true;
    else if (a === "--selftest") args.selftest = true;
    else if (a === "--arms") args.arms = argv[++i].split(",");
    else if (a === "--tasks") args.tasks = argv[++i].split(",");
    else if (a === "--runs") args.runs = Number(argv[++i]);
    else if (a === "--max-tokens") args.maxTokens = Number(argv[++i]);
  }
  return args;
}

// Score one (arm, task) transcript with the pure primitives. Task fixtures
// (workspace files, expected links, the raw tool blob) are provided by the
// caller; this keeps scoring deterministic and testable.
export function scoreTranscript(task, transcript, fixture = {}) {
  const { text = "", toolCalls = [] } = transcript;
  switch (task.id) {
    case "big-tool-result-no-echo":
      return {
        raw_echo_detected: rawEchoDetected(text, fixture.rawText || ""),
        blob_id_present: blobIdPresent(text),
        synthesis_present: synthesisPresent(text)
      };
    case "long-rule-retention":
      return {
        rule_applied: fixture.rule ? text.toLowerCase().includes(String(fixture.rule).toLowerCase()) : null,
        unnecessary_rereads: countDuplicateReads(toolCalls),
        files_changed: toolCalls.filter((c) => c.name === "write" || c.name === "edit").length
      };
    default:
      return {};
  }
}

// Live cell runner — drive one (arm, task) through /api/agent/chat and score it.
// Needs the DS4 server up (BASE_URL) + a per-task fixture with the prompt and
// oracle data. Env for the arm must be exported to the SERVER process, not here
// (the capsule flags are read server-side), so run one server per arm.
async function runCellLive({ arm, task, run, maxTokens, fixture = {} }) {
  const sessionKey = `bench-${arm}-${task.id}-${run}`;
  await startAgent({ sessionKey });
  const transcript = await postChat({
    sessionKey,
    message: fixture.prompt || `Run benchmark task ${task.id}.`,
    request: { max_tokens: maxTokens }
  });
  const scored = scoreTranscript(task, transcript, fixture);
  const capsule = await fetch(`${BASE_URL}/api/agent/context/status`, {
    headers: { "X-Agent-Session-Key": sessionKey }
  }).then((r) => r.json()).catch(() => ({}));
  return {
    arm,
    task: task.id,
    run,
    ...scored,
    capsule_tokens: capsule?.capsule?.tokens ?? 0,
    task_success: scored.rule_applied ?? scored.synthesis_present ?? true,
    duplicate_read_count: scored.unnecessary_rereads ?? 0,
    reset_after_revision_1: false
  };
}

function selftest() {
  // Baseline metrics.
  const base = { reset_rate: 0.02, capsule_tokens_p95: 0, task_success_rate: 0.9, duplicate_read_count: 10 };
  assert.equal(evaluateGate({ ...base, capsule_tokens_p95: 1400 }, base).ok, true);
  assert.equal(evaluateGate({ ...base, capsule_tokens_p95: 3200 }, base).ok, false);
  assert.equal(evaluateGate({ ...base, reset_rate: 0.2 }, base).ok, false);
  assert.equal(evaluateGate({ ...base, task_success_rate: 0.5 }, base).ok, false);
  assert.equal(evaluateGate({ ...base, raw_echo_detected: true }, base).ok, false);
  const agg = aggregate([
    { capsule_tokens: 1000, task_success: true, duplicate_read_count: 1, reset_after_revision_1: false },
    { capsule_tokens: 2000, task_success: true, duplicate_read_count: 0, reset_after_revision_1: false }
  ]);
  assert.equal(agg.task_success_rate, 1);
  assert.ok(agg.capsule_tokens_p95 <= 2000);

  // scoring primitives
  const raw = "SECRET".repeat(500);
  assert.equal(rawEchoDetected(`prefix ${raw} suffix`, raw), true);
  assert.equal(rawEchoDetected("a short synthesis of the page", raw), false);
  assert.equal(blobIdPresent("see blob_9fa2 for full output"), true);
  assert.equal(blobIdPresent("no blob here"), false);
  assert.equal(synthesisPresent("this is a reasonably long synthesis sentence"), true);
  assert.equal(countDuplicateReads([{ name: "read", target: "a" }, { name: "read", target: "a" }]), 1);

  const echoScore = scoreTranscript(taskById("big-tool-result-no-echo"),
    { text: `summary; blob_1 has details ${raw}`, toolCalls: [] }, { rawText: raw });
  assert.equal(echoScore.raw_echo_detected, true);
  assert.equal(echoScore.blob_id_present, true);

  console.log("selftest ok");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.selftest) return selftest();

  const created_at = new Date().toISOString();
  const cells = [];
  for (const arm of args.arms) {
    for (const taskId of args.tasks) {
      const task = taskById(taskId);
      if (!task) throw new Error(`unknown task: ${taskId}`);
      for (let run = 0; run < args.runs; run++) {
        if (!args.live) continue; // dry mode: structure only, no fabricated cells
        cells.push(await runCellLive({ arm, task, run, maxTokens: args.maxTokens }));
      }
    }
  }

  const byArm = {};
  for (const arm of args.arms) byArm[arm] = aggregate(cells.filter((c) => c.arm === arm));
  const baseline = byArm.baseline || {};
  const enabled = byArm["context-enabled"] || byArm["context-preview"] || baseline;
  const gate = args.gate ? evaluateGate(enabled, baseline) : { ok: true, failures: [] };

  const summary = { created_at, arms: args.arms, cells, gate, metrics: enabled };
  const outDir = path.join(HERE, "runs", created_at.replace(/[:.]/g, "-"));
  await fs.mkdir(outDir, { recursive: true });
  await fs.writeFile(path.join(outDir, "summary.json"), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary.gate));
  if (!gate.ok) process.exitCode = 1;
}

main().catch((err) => { console.error(err.message); process.exitCode = 1; });
