#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { TASKS, taskById } from "./tasks.mjs";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../..");
const HERE = path.join(ROOT, "benchmarks/agentic/pony");
const RUNS = path.join(HERE, "runs");
const SMOKE_TASKS = "native-date-filter,url-search-params,pony-command-parser";
const DEFAULT_CELL_TIMEOUT_MS = 8 * 60 * 1000;
const DEFAULT_COOLDOWN_MS = 2000;
const DEFAULT_MAX_TOKENS = 3072;

function parseArgs(argv) {
  const out = {
    runs: 1,
    arms: "baseline,pony-full",
    tasks: "all",
    baseUrl: "http://127.0.0.1:5173",
    gate: false,
    cellTimeoutMs: DEFAULT_CELL_TIMEOUT_MS,
    cooldownMs: DEFAULT_COOLDOWN_MS,
    maxTokens: DEFAULT_MAX_TOKENS,
    failFast: false
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--selftest") out.selftest = true;
    else if (arg === "--live") out.live = true;
    else if (arg === "--gate") out.gate = true;
    else if (arg === "--smoke") out.smoke = true;
    else if (arg === "--fail-fast") out.failFast = true;
    else if (arg === "--base-url") out.baseUrl = argv[++i];
    else if (arg === "--runs") out.runs = Number(argv[++i]) || 1;
    else if (arg === "--arms") out.arms = argv[++i];
    else if (arg === "--tasks") out.tasks = argv[++i];
    else if (arg === "--summary") out.summary = argv[++i];
    else if (arg === "--cell-timeout-ms") out.cellTimeoutMs = Number(argv[++i]) || DEFAULT_CELL_TIMEOUT_MS;
    else if (arg === "--cooldown-ms") out.cooldownMs = Number(argv[++i]) || 0;
    else if (arg === "--max-tokens") out.maxTokens = Number(argv[++i]) || DEFAULT_MAX_TOKENS;
    else if (arg === "--help" || arg === "-h") out.help = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (out.smoke && out.tasks === "all") out.tasks = SMOKE_TASKS;
  if (out.smoke) out.runs = Math.max(1, Math.min(out.runs, 1));
  return out;
}

function usage() {
  console.log(`Usage:
  node benchmarks/agentic/pony/run.mjs --selftest
  node benchmarks/agentic/pony/run.mjs --live --smoke [--gate] [--base-url http://127.0.0.1:5173]
  node benchmarks/agentic/pony/run.mjs --live [--gate] [--base-url http://127.0.0.1:5173] [--arms baseline,pony-full] [--tasks all|id,id] [--runs N]
       [--cell-timeout-ms 480000] [--cooldown-ms 2000] [--max-tokens 3072] [--fail-fast]
  node benchmarks/agentic/pony/run.mjs --summary benchmarks/agentic/pony/runs/<stamp>/summary.json --gate

Safe defaults: live cells time out after ${DEFAULT_CELL_TIMEOUT_MS}ms, cool down ${DEFAULT_COOLDOWN_MS}ms between cells,
and use max_tokens=${DEFAULT_MAX_TOKENS}. --smoke runs ${SMOKE_TASKS} only.
`);
}

function rmrf(p) { fs.rmSync(p, { recursive: true, force: true }); }
function mkdirp(p) { fs.mkdirSync(p, { recursive: true }); }
function writeJson(file, value) { mkdirp(path.dirname(file)); fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`); }
function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms || 0))); }

function git(workdir, args) {
  const r = spawnSync("git", args, { cwd: workdir, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr || r.stdout}`);
  return r.stdout;
}

function initGit(workdir) {
  git(workdir, ["init", "-q"]);
  git(workdir, ["add", "-A"]);
  git(workdir, ["-c", "user.email=pony-gate@local", "-c", "user.name=pony-gate", "commit", "-q", "-m", "base", "--no-verify"]);
}

function diffStats(workdir) {
  git(workdir, ["add", "-A"]);
  const out = git(workdir, ["diff", "--cached", "--numstat", "HEAD"]);
  let added = 0, deleted = 0, files = 0, srcFiles = 0, testFiles = 0;
  const changed = [];
  for (const line of out.trim().split(/\r?\n/).filter(Boolean)) {
    const [a, d, file] = line.split("\t");
    if (a === "-") continue;
    const add = Number(a) || 0;
    const del = Number(d) || 0;
    files += 1; added += add; deleted += del;
    const isTest = /(^|\/)(test|tests)\//.test(file) || /(^|\/).*\.test\./.test(file);
    if (isTest) testFiles += 1; else srcFiles += 1;
    changed.push({ file, added: add, deleted: del, isTest });
  }
  return { added, deleted, files, srcFiles, testFiles, changed };
}

async function selftest() {
  let failures = 0;
  for (const task of TASKS) {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), `pony-${task.id}-`));
    try {
      task.setup(base);
      const empty = await task.check(base).catch((err) => ({ correct: false, safe: false, reason: err.message }));
      task.good(base);
      const good = await task.check(base).catch((err) => ({ correct: false, safe: false, reason: err.message }));
      rmrf(base);

      const badDir = fs.mkdtempSync(path.join(os.tmpdir(), `pony-${task.id}-bad-`));
      task.setup(badDir);
      task.bad?.(badDir);
      const bad = await task.check(badDir).catch(() => ({ correct: false, safe: false, reason: "bad threw" }));
      rmrf(badDir);

      const ok = !empty.correct && good.correct && good.safe && !(bad.correct && bad.safe);
      console.log(`${ok ? "ok" : "XX"} ${task.id} empty=${empty.correct}/${empty.safe} good=${good.correct}/${good.safe} bad=${bad.correct}/${bad.safe} :: ${good.reason}`);
      if (!ok) failures += 1;
    } finally {
      rmrf(base);
    }
  }
  return failures;
}

function selectedTasks(spec) {
  if (!spec || spec === "all") return TASKS;
  return spec.split(",").map((id) => {
    const task = taskById(id.trim());
    if (!task) throw new Error(`unknown task: ${id}`);
    return task;
  });
}

function armMode(arm) {
  if (arm === "baseline" || arm === "pony-off") return "off";
  const m = arm.match(/^pony-(lite|full|ultra)$/);
  if (m) return m[1];
  throw new Error(`unknown arm: ${arm}`);
}

async function postJson(baseUrl, pathName, body, sessionKey, { timeoutMs = 30000 } = {}) {
  const res = await fetch(`${baseUrl}${pathName}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Agent-Session-Key": sessionKey },
    body: JSON.stringify(body || {}),
    signal: AbortSignal.timeout(timeoutMs)
  });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { error: text }; }
  if (!res.ok) throw new Error(`${pathName} HTTP ${res.status}: ${data.error || text}`);
  return data;
}

async function getJson(baseUrl, pathName, sessionKey, { timeoutMs = 10000 } = {}) {
  const res = await fetch(`${baseUrl}${pathName}`, {
    headers: { "X-Agent-Session-Key": sessionKey },
    signal: AbortSignal.timeout(timeoutMs)
  });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { error: text }; }
  if (!res.ok) throw new Error(`${pathName} HTTP ${res.status}: ${data.error || text}`);
  return data;
}

async function waitForReady(baseUrl, sessionKey, { timeoutMs = 120000, intervalMs = 2000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastError = "";
  while (Date.now() < deadline) {
    try {
      await getJson(baseUrl, "/api/agent/status", sessionKey, { timeoutMs: Math.min(5000, intervalMs) });
      try {
        const status = await getJson(baseUrl, "/api/wrapper/status", sessionKey, { timeoutMs: Math.min(5000, intervalMs) });
        if (status?.busy === false || status?.state === "ready") return status;
      } catch {
        return null; // wrapper disabled or endpoint absent; frontend is reachable.
      }
    } catch (err) {
      lastError = err.message || String(err);
    }
    await sleep(intervalMs);
  }
  throw new Error(`DS4 Studio not ready before live cell: ${lastError || "timeout"}`);
}

async function readAgentSse(res) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const events = [];
  let text = "";
  let error = "";
  let usage = null;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const blocks = buffer.split(/\r?\n\r?\n/);
    buffer = blocks.pop() || "";
    for (const block of blocks) {
      let event = "message";
      const lines = [];
      for (const line of block.split(/\r?\n/)) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) lines.push(line.slice(5).trimStart());
      }
      if (!lines.length) continue;
      let data;
      try { data = JSON.parse(lines.join("\n")); } catch { data = { raw: lines.join("\n") }; }
      events.push({ event, data });
      if (event === "agent_text") text += data.content || "";
      if (event === "agent_error") error += data.error || "";
      if (event === "agent_usage") usage = data;
    }
  }
  return { events, text, error, usage };
}

async function resetNativeAgentIfAvailable(baseUrl, sessionKey, timeoutMs) {
  try {
    await postJson(baseUrl, "/api/native-agent/command", { command: "/new" }, sessionKey, { timeoutMs });
  } catch {
    // JS-agent mode does not expose native-agent commands; no reset needed there.
  }
}

async function runAgent({ baseUrl, sessionKey, arm, task, workdir, maxTokens, cellTimeoutMs }) {
  await postJson(baseUrl, "/api/agent/start", {}, sessionKey, { timeoutMs: cellTimeoutMs });
  await resetNativeAgentIfAvailable(baseUrl, sessionKey, Math.min(cellTimeoutMs, 5 * 60 * 1000));
  const mode = armMode(arm);
  if (mode !== "off") await postJson(baseUrl, "/api/agent/pony", { mode }, sessionKey, { timeoutMs: 30000 });
  const rel = path.relative(ROOT, workdir).replaceAll(path.sep, "/");
  const message = [
    `Work only inside ${rel}. Do not edit files outside that directory.`,
    task.prompt,
    "Keep the diff as small as safely possible. Do not install dependencies unless the task explicitly requires it.",
    "When done, stop and summarize briefly."
  ].join("\n\n");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`cell timeout after ${cellTimeoutMs}ms`)), cellTimeoutMs);
  let res;
  try {
    res = await fetch(`${baseUrl}/api/agent/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Agent-Session-Key": sessionKey },
      body: JSON.stringify({
        message,
        request: { max_tokens: maxTokens, temperature: 0, top_p: 1, top_k: 1, min_p: 0, thinking: false }
      }),
      signal: controller.signal
    });
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
  if (!res.ok) {
    clearTimeout(timer);
    throw new Error(`/api/agent/chat HTTP ${res.status}: ${await res.text()}`);
  }
  try {
    const out = await readAgentSse(res);
    clearTimeout(timer);
    await postJson(baseUrl, "/api/agent/stop", {}, sessionKey, { timeoutMs: 60000 }).catch(() => {});
    return out;
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

function persistSummary(runRoot, results) {
  const summary = summarize(results);
  writeJson(path.join(runRoot, "summary.json"), summary);
  return summary;
}

async function liveRun(opts) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const runRoot = path.join(RUNS, stamp);
  mkdirp(runRoot);
  const arms = opts.arms.split(",").map((s) => s.trim()).filter(Boolean);
  const tasks = selectedTasks(opts.tasks);
  const results = [];
  let summary = persistSummary(runRoot, results);

  for (const task of tasks) {
    for (const arm of arms) {
      for (let run = 1; run <= opts.runs; run++) {
        const workdir = path.join(runRoot, task.id, arm, `run-${run}`);
        rmrf(workdir); mkdirp(workdir);
        task.setup(workdir);
        initGit(workdir);
        const sessionKey = `pony_gate_${stamp}_${task.id}_${arm}_${run}`;
        const started = Date.now();
        let agent = { events: [], text: "", error: "", usage: null };
        let check = { correct: false, safe: false, reason: "not run" };
        let error = "";
        try {
          await waitForReady(opts.baseUrl, sessionKey, { timeoutMs: Math.min(opts.cellTimeoutMs, 120000) });
          agent = await runAgent({
            baseUrl: opts.baseUrl,
            sessionKey,
            arm,
            task,
            workdir,
            maxTokens: opts.maxTokens,
            cellTimeoutMs: opts.cellTimeoutMs
          });
          check = await task.check(workdir);
        } catch (err) {
          error = err.message || String(err);
          await postJson(opts.baseUrl, "/api/agent/stop", {}, sessionKey, { timeoutMs: 60000 }).catch(() => {});
        }
        const metrics = diffStats(workdir);
        const record = {
          task: task.id,
          kind: task.kind,
          arm,
          run,
          workdir: path.relative(ROOT, workdir).replaceAll(path.sep, "/"),
          ok: Boolean(check.correct && check.safe && !error && !agent.error),
          correct: Boolean(check.correct),
          safe: Boolean(check.safe),
          reason: check.reason,
          error: error || agent.error || "",
          elapsed_ms: Date.now() - started,
          usage: agent.usage,
          metrics
        };
        results.push(record);
        writeJson(path.join(workdir, "_pony_result.json"), record);
        summary = persistSummary(runRoot, results);
        console.log(`${record.ok ? "ok" : "XX"} ${task.id} ${arm} #${run} loc+${metrics.added} files=${metrics.files} ${record.reason}${record.error ? ` ERROR ${record.error}` : ""}`);
        if (opts.failFast && !record.ok) {
          console.log(`summary: ${path.relative(ROOT, path.join(runRoot, "summary.json"))}`);
          return summary;
        }
        if (opts.cooldownMs > 0) await sleep(opts.cooldownMs);
      }
    }
  }
  summary = persistSummary(runRoot, results);
  console.log(`summary: ${path.relative(ROOT, path.join(runRoot, "summary.json"))}`);
  return summary;
}

function median(xs) {
  const a = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!a.length) return null;
  return a[Math.floor(a.length / 2)];
}

function summarize(results) {
  const cells = {};
  for (const r of results) {
    const key = `${r.task}::${r.arm}`;
    cells[key] ||= { task: r.task, kind: r.kind, arm: r.arm, runs: 0, ok: 0, safe: 0, correct: 0, loc: [], files: [], toolCalls: [] };
    const c = cells[key];
    c.runs += 1;
    c.ok += r.ok ? 1 : 0;
    c.safe += r.safe ? 1 : 0;
    c.correct += r.correct ? 1 : 0;
    c.loc.push(r.metrics.added);
    c.files.push(r.metrics.files);
    c.toolCalls.push(r.events?.length || 0);
  }
  for (const c of Object.values(cells)) {
    c.ok_rate = c.ok / c.runs;
    c.safe_rate = c.safe / c.runs;
    c.correct_rate = c.correct / c.runs;
    c.median_loc = median(c.loc);
    c.median_files = median(c.files);
    delete c.loc; delete c.files; delete c.toolCalls;
  }
  return { created_at: new Date().toISOString(), results, cells: Object.values(cells), gate: gate(Object.values(cells)) };
}

function gate(cells) {
  const failures = [];
  const by = new Map(cells.map((c) => [`${c.task}::${c.arm}`, c]));
  for (const pony of cells.filter((c) => c.arm.startsWith("pony-") && c.arm !== "pony-off")) {
    if (pony.ok_rate < 1) failures.push(`${pony.task}/${pony.arm}: correctness or safety failed`);
    const base = by.get(`${pony.task}::baseline`) || by.get(`${pony.task}::pony-off`);
    if (!base) continue;
    if (pony.safe_rate < base.safe_rate) failures.push(`${pony.task}/${pony.arm}: safe_rate below baseline`);
    if (["overbuild", "native", "stdlib", "debt"].includes(pony.kind) && base.median_loc !== null && pony.median_loc !== null) {
      if (pony.median_loc > base.median_loc) failures.push(`${pony.task}/${pony.arm}: larger median LOC than baseline (${pony.median_loc} > ${base.median_loc})`);
    }
  }
  return { ok: failures.length === 0, failures };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help || (!opts.selftest && !opts.live && !opts.summary)) { usage(); return 0; }
  if (opts.selftest) return await selftest();
  let summary;
  if (opts.summary) summary = JSON.parse(fs.readFileSync(opts.summary, "utf8"));
  else summary = await liveRun(opts);
  if (opts.gate) {
    const verdict = summary.gate || gate(summary.cells || []);
    if (!verdict.ok) {
      for (const f of verdict.failures) console.error(`gate: ${f}`);
      return 1;
    }
    console.log("gate: ok");
  }
  return 0;
}

main().then((code) => { process.exitCode = code; }).catch((err) => { console.error(err.stack || err.message); process.exitCode = 1; });
