#!/usr/bin/env node
// WP14 of convergenza.loop.md — measure tool calls on the DS4 wrapper in
// server mode versus the native agent (plan §17).
//
// For 10 tool-forcing prompts, in stream and non-stream form, POST
// /v1/chat/completions with the real JS tool catalog
// (frontend/server/agentToolCatalog.mjs) plus EVIDENCE_GUARD_TOOL, and record
// per request: finish_reason, number of tool_calls, JSON validity of every
// arguments payload, presence of reasoning_content, and
// usage.prompt_tokens_details.cached_tokens.
//
// Then repeat the same prompts against the native agent
// (POST /api/native-agent/chat, SSE) and count executed tool calls from the
// agent_tool_call events of the stream.
//
// Criterion (plan §17): valid tool calls in server mode must be >= native on
// the same prompts.  Fewer means STOP: report, do not proceed to WP16/WP17.
//
// Usage:
//   node scripts/probe_ds4_tools.mjs [--server-base URL] [--native-url URL]
//        [--only N] [--server-only] [--native-only] [--timeout-ms MS]
//        [--out FILE]
//
// Defaults assume the wrapper serving both faces on its HTTP port.

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { AGENT_TOOLS, EVIDENCE_GUARD_TOOL } from "../frontend/server/agentToolCatalog.mjs";

const here = dirname(fileURLToPath(import.meta.url));

function arg(name, fallback = undefined) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--")
    ? process.argv[i + 1]
    : fallback;
}
const flag = (name) => process.argv.includes(`--${name}`);

const SERVER_BASE = arg("server-base", "http://127.0.0.1:8732");
const NATIVE_URL = arg("native-url", `${SERVER_BASE}/api/native-agent/chat`);
const ONLY = Number(arg("only", "0"));
const TIMEOUT_MS = Number(arg("timeout-ms", "120000"));
const OUT = arg("out", join(here, "..", "docs", "convergenza", "wp14-raw.json"));

// Ten prompts that should each force the named tool.  The expected tool is
// not sent to the model; it is only the label for the report table.
const SCENARIOS = [
  { tool: "read", prompt: "Use the read tool to read scripts/probe_ds4_tools.mjs and tell me its first line." },
  { tool: "read", prompt: "Read the file package.json at start_line 1 and report the value of the name field." },
  { tool: "web_search", prompt: "Use web_search with query 'llama.cpp server chat completions tools' and give me the title of the first result." },
  { tool: "web_search", prompt: "Search the web for 'OpenAI chat completions tool_calls finish_reason' and list two results." },
  { tool: "bash", prompt: "Run the bash tool with command 'echo probe-wp14' and report exactly what it printed." },
  { tool: "bash", prompt: "Use bash to run 'wc -l scripts/probe_ds4_tools.mjs' and tell me the number." },
  { tool: "evidence_guard", prompt: "Call evidence_guard with action open, id EFA-901, claim 'probe claim' and report the tool answer." },
  { tool: "evidence_guard", prompt: "Call evidence_guard with action status and report the tool answer." },
  { tool: "list", prompt: "Use the list tool on the directory scripts and tell me whether probe_ds4_tools.mjs appears." },
  { tool: "bash", prompt: "With the bash tool run 'date -u +%Y' and report only the year." }
];

const TOOLS = [...AGENT_TOOLS, EVIDENCE_GUARD_TOOL];

function validJson(value) {
  try {
    const parsed = JSON.parse(value);
    return parsed !== null && typeof parsed === "object";
  } catch {
    return false;
  }
}

async function chatOnce({ prompt, stream, label }) {
  const rec = {
    label,
    tool_expected: null,
    mode: stream ? "stream" : "non-stream",
    ok: false,
    finish_reason: null,
    tool_calls: 0,
    args_valid: null,
    tool_names: [],
    reasoning_content_present: false,
    cached_tokens: null,
    prompt_tokens: null,
    error: null
  };
  const body = {
    messages: [{ role: "user", content: prompt }],
    tools: TOOLS,
    stream,
    max_tokens: 256
  };
  try {
    const res = await fetch(`${SERVER_BASE}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });
    if (!res.ok) {
      rec.error = `HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`;
      return rec;
    }
    if (stream) {
      // Accumulate deltas: finish_reason, tool_calls fragments by index,
      // reasoning_content, usage (final chunk when stream_options asks it).
      const toolAcc = new Map();
      let finish = null;
      let usage = null;
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let nl;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (payload === "[DONE]") continue;
          let chunk;
          try { chunk = JSON.parse(payload); } catch { continue; }
          if (chunk.usage) usage = chunk.usage;
          const choice = chunk.choices && chunk.choices[0];
          if (!choice) continue;
          if (choice.finish_reason) finish = choice.finish_reason;
          const delta = choice.delta || {};
          if (delta.reasoning_content) rec.reasoning_content_present = true;
          for (const tc of delta.tool_calls || []) {
            const slot = toolAcc.get(tc.index ?? 0) || { name: "", args: "" };
            if (tc.function?.name) slot.name += tc.function.name;
            if (tc.function?.arguments) slot.args += tc.function.arguments;
            toolAcc.set(tc.index ?? 0, slot);
          }
        }
      }
      rec.finish_reason = finish;
      rec.tool_calls = toolAcc.size;
      for (const slot of toolAcc.values()) {
        rec.tool_names.push(slot.name);
        rec.args_valid = validJson(slot.args);
      }
      if (toolAcc.size === 0) rec.args_valid = null;
      if (usage) {
        rec.prompt_tokens = usage.prompt_tokens ?? null;
        rec.cached_tokens = usage.prompt_tokens_details?.cached_tokens ?? null;
      }
    } else {
      const json = await res.json();
      const choice = json.choices && json.choices[0];
      rec.finish_reason = choice?.finish_reason ?? null;
      const calls = choice?.message?.tool_calls || [];
      rec.tool_calls = calls.length;
      for (const tc of calls) {
        rec.tool_names.push(tc.function?.name || "");
        rec.args_valid = validJson(tc.function?.arguments || "");
      }
      if (calls.length === 0) rec.args_valid = null;
      rec.reasoning_content_present = Boolean(choice?.message?.reasoning_content);
      const usage = json.usage;
      if (usage) {
        rec.prompt_tokens = usage.prompt_tokens ?? null;
        rec.cached_tokens = usage.prompt_tokens_details?.cached_tokens ?? null;
      }
    }
    rec.ok = true;
  } catch (err) {
    rec.error = String(err?.message || err);
  }
  return rec;
}

async function nativeOnce({ prompt, label }) {
  const rec = {
    label,
    backend: "native",
    ok: false,
    tool_calls_executed: 0,
    finish_reason: null,
    error: null
  };
  try {
    const res = await fetch(NATIVE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: prompt, stream: true }),
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });
    if (!res.ok) {
      rec.error = `HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`;
      return rec;
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let event = "";
    let text = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        // The event type rides on its own "event:" line, not inside data.
        if (line.startsWith("event:")) { event = line.slice(6).trim(); continue; }
        if (!line.startsWith("data:")) continue;
        let evt;
        try { evt = JSON.parse(line.slice(5)); } catch { continue; }
        const type = evt.type || event;
        if (type === "agent_tool_call") rec.tool_calls_executed += 1;
        if (type === "agent_text") text += evt.content || "";
        if (type === "agent_done") rec.finish_reason = evt.finish_reason ?? null;
      }
    }
    // The native agent emits no agent_tool_call event: each executed tool is
    // announced in the text stream as a "🛠️ <action>" line.
    if (!rec.tool_calls_executed) {
      rec.tool_calls_executed = (text.match(/^\s*🛠/gmu) || []).length;
    }
    rec.tool_lines = (text.match(/^\s*🛠[^\n]*/gmu) || []).map((l) => l.trim().slice(0, 120));
    rec.ok = true;
  } catch (err) {
    rec.error = String(err?.message || err);
  }
  return rec;
}

const scenarios = ONLY > 0 ? SCENARIOS.slice(0, ONLY) : SCENARIOS;
const results = { server: [], native: [] };

if (!flag("native-only")) {
  for (let i = 0; i < scenarios.length; i++) {
    const s = scenarios[i];
    const stream = i % 2 === 0; // alternate: five stream, five non-stream
    const rec = await chatOnce({ prompt: s.prompt, stream, label: `${i + 1}/${s.tool}` });
    rec.tool_expected = s.tool;
    results.server.push(rec);
    console.log(`[server] ${rec.label} mode=${rec.mode} finish=${rec.finish_reason} tool_calls=${rec.tool_calls} args_valid=${rec.args_valid} reasoning=${rec.reasoning_content_present} cached=${rec.cached_tokens}${rec.error ? ` ERROR=${rec.error}` : ""}`);
  }
}

if (!flag("server-only")) {
  for (let i = 0; i < scenarios.length; i++) {
    const s = scenarios[i];
    const rec = await nativeOnce({ prompt: s.prompt, label: `${i + 1}/${s.tool}` });
    results.native.push(rec);
    console.log(`[native] ${rec.label} executed=${rec.tool_calls_executed} finish=${rec.finish_reason}${rec.error ? ` ERROR=${rec.error}` : ""}`);
  }
}

const serverValid = results.server.filter((r) => r.tool_calls > 0 && r.args_valid !== false).length;
const nativeWithCalls = results.native.filter((r) => r.tool_calls_executed > 0).length;
results.summary = {
  server_requests: results.server.length,
  server_requests_with_valid_tool_calls: serverValid,
  native_requests_with_executed_tool_calls: nativeWithCalls,
  criterion: "server_valid >= native_calls",
  pass: results.native.length === 0 ? "not-measured" : serverValid >= nativeWithCalls
};

writeFileSync(OUT, JSON.stringify(results, null, 2));
console.log(`\nsummary: ${JSON.stringify(results.summary)}`);
console.log(`raw: ${OUT}`);
