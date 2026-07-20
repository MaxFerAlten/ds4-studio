// Non-regression test for App.jsx logic
// Tests the pure functions and constants extracted into appLogic.mjs.
// These must match the current App.jsx behavior exactly.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import {
  readAgentSessionKey,
  AGENT_HEADERS,
  STARTUP_GROUPS,
  FIELD_LABELS,
  STARTUP_HELP,
  STARTUP_PLACEHOLDERS,
  REQUEST_HELP,
  REQUEST_PLACEHOLDERS,
  STRATEGY_OPTIONS,
  AGENT_COMMANDS,
  CHECKBOX_FIELDS,
  TEXT_FIELDS,
  ENV_FIELDS,
  fieldType,
  startupHelp,
  serverFieldValue,
  requestHelp,
  appendAssistantDelta,
  replaceAssistantMessage,
  appendAssistantNotice,
  appendTransientNotice,
  buildChatMessages,
  parseSseData,
  formatMetric,
  initialExportSettings,
  SESSION_STORAGE_KEY,
  readStoredSession,
  writeStoredSession,
  clearStoredSession,
  requestFreshNativeAgentSession
} from "./appLogic.mjs";

test("agent mode transition is visible and blocks chat until initialization completes", async () => {
  const source = await readFile(new URL("./App.jsx", import.meta.url), "utf8");
  const start = source.indexOf("async function toggleAgentMode");
  const end = source.indexOf("async function callNativeAgentCommand", start);
  const block = source.slice(start, end);

  assert.match(source, /const \[agentTransitionBusy, setAgentTransitionBusy\] = useState\(false\)/);
  assert.match(source, /const canSend = Boolean\([\s\S]*?!agentTransitionBusy[\s\S]*?\)/);
  assert.match(block, /Agent Mode initialization in progress/);
  assert.match(block, /setAgentTransitionBusy\(true\)/);
  assert.match(block, /finally\s*\{\s*setAgentTransitionBusy\(false\)/);
});

// ── Data constants ───────────────────────────────────────────────────────

test("STARTUP_GROUPS has expected structure", () => {
  assert.ok(Array.isArray(STARTUP_GROUPS));
  for (const group of STARTUP_GROUPS) {
    assert.ok(typeof group[0] === "string");
    assert.ok(Array.isArray(group[1]));
  }
});

test("FIELD_LABELS covers all startup groups keys", () => {
  const allKeys = STARTUP_GROUPS.flatMap((g) => g[1]);
  for (const key of allKeys) {
    assert.ok(FIELD_LABELS[key], `Missing FIELD_LABELS for ${key}`);
  }
});

test("STARTUP_HELP covers all startup keys", () => {
  const allKeys = STARTUP_GROUPS.flatMap((g) => g[1]);
  for (const key of allKeys) {
    assert.ok(STARTUP_HELP[key], `Missing STARTUP_HELP for ${key}`);
  }
});

test("STARTUP_PLACEHOLDERS only defines a subset; missing keys fall back to '' in JSX", () => {
  assert.equal(STARTUP_PLACEHOLDERS.binary, "./ds4-server");
  assert.equal(STARTUP_PLACEHOLDERS.model, "ds4flash.gguf");
  assert.equal(STARTUP_PLACEHOLDERS.threads, "0 = auto");
  assert.equal(STARTUP_PLACEHOLDERS.mtpDraft, undefined);
  assert.equal(STARTUP_PLACEHOLDERS.ctx, undefined);
});

test("REQUEST_HELP covers all request fields", () => {
  const requestKeys = Object.keys(REQUEST_HELP);
  assert.ok(requestKeys.length > 0);
  for (const key of requestKeys) {
    assert.ok(typeof REQUEST_HELP[key] === "string");
  }
});

test("REQUEST_PLACEHOLDERS covers all request fields", () => {
  const requestKeys = Object.keys(REQUEST_PLACEHOLDERS);
  for (const key of requestKeys) {
    assert.ok(REQUEST_PLACEHOLDERS[key] !== undefined, `Missing placeholder for ${key}`);
  }
});

test("STRATEGY_OPTIONS has expected values", () => {
  assert.ok(Array.isArray(STRATEGY_OPTIONS));
  for (const opt of STRATEGY_OPTIONS) {
    assert.ok(typeof opt.key === "string");
    assert.ok(typeof opt.title === "string");
    assert.ok(typeof opt.description === "string");
    assert.ok(typeof opt.disabled === "boolean");
  }
});

test("AGENT_COMMANDS has expected structure", () => {
  assert.ok(Array.isArray(AGENT_COMMANDS));
  for (const cmd of AGENT_COMMANDS) {
    assert.ok(typeof cmd.name === "string");
    assert.ok(typeof cmd.desc === "string");
  }
});

test("CHECKBOX_FIELDS, TEXT_FIELDS, ENV_FIELDS are Sets", () => {
  assert.ok(CHECKBOX_FIELDS instanceof Set);
  assert.ok(TEXT_FIELDS instanceof Set);
  assert.ok(ENV_FIELDS instanceof Set);
});

// ── Pure functions ──────────────────────────────────────────────────────

test("fieldType returns correct type for known keys", () => {
  for (const key of CHECKBOX_FIELDS) {
    assert.equal(fieldType(key), "checkbox");
  }
  assert.equal(fieldType("backend"), "select");
  for (const key of TEXT_FIELDS) {
    assert.equal(fieldType(key), "text");
  }
  assert.equal(fieldType("unknown_key"), "number");
});

test("startupHelp returns help text for known keys", () => {
  const allKeys = STARTUP_GROUPS.flatMap((g) => g[1]);
  for (const key of allKeys) {
    const help = startupHelp(key);
    assert.ok(typeof help === "string", `startupHelp(${key}) should be string`);
    assert.ok(help.length > 0, `startupHelp(${key}) should not be empty`);
  }
  // Falls back to FIELD_LABELS for keys without explicit STARTUP_HELP
  assert.equal(startupHelp("mtpDraft"), STARTUP_HELP.mtpDraft);
  assert.equal(startupHelp("nonexistent"), "nonexistent");
});

test("serverFieldValue extracts value from server config", () => {
  const server = {
    model: "ds4flash.gguf",
    env: { DS4_CUDA_Q8_F16_CACHE_MB: "11264" }
  };
  assert.equal(serverFieldValue(server, "model"), "ds4flash.gguf");
  assert.equal(serverFieldValue(server, "DS4_CUDA_Q8_F16_CACHE_MB"), "11264");
  assert.equal(serverFieldValue(server, "nonexistent"), undefined);
});

test("requestHelp returns help for known keys", () => {
  const keys = Object.keys(REQUEST_HELP);
  for (const key of keys) {
    const help = requestHelp(key);
    assert.ok(typeof help === "string", `requestHelp(${key}) should be string`);
    assert.ok(help.length > 0, `requestHelp(${key}) should not be empty`);
  }
  // Falls back to key itself for unknown keys
  assert.equal(requestHelp("nonexistent"), "nonexistent");
});

test("appendAssistantDelta appends content and reasoning to last assistant message", () => {
  const messages = [
    { role: "user", content: "hello" },
    { role: "assistant", content: "", reasoning: "" }
  ];
  const result = appendAssistantDelta(" world", " deep")(messages);
  assert.equal(result[0].role, "user");
  assert.equal(result[1].content, " world");
  assert.equal(result[1].reasoning, " deep");
});

test("appendAssistantDelta creates new array (immutable)", () => {
  const messages = [
    { role: "user", content: "hello" },
    { role: "assistant", content: "", reasoning: "" }
  ];
  const result = appendAssistantDelta(" world", "")(messages);
  assert.notEqual(result, messages);
});

test("replaceAssistantMessage replaces last assistant message with new content", () => {
  const messages = [
    { role: "user", content: "hi" },
    { role: "assistant", content: "old", reasoning: "old_reason" }
  ];
  const result = replaceAssistantMessage("new_content", "new_reason")(messages);
  assert.equal(result[1].content, "new_content");
  assert.equal(result[1].reasoning, "new_reason");
});

test("appendAssistantNotice adds notice to last assistant message", () => {
  const messages = [{ role: "user", content: "hi" }, { role: "assistant", content: "existing" }];
  const result = appendAssistantNotice("notice text")(messages);
  assert.equal(result.length, 2);
  assert.equal(result[1].content, "existing\n\nnotice text");
});

test("appendTransientNotice pushes a new assistant message with agentNotice", () => {
  const messages = [{ role: "user", content: "hi" }];
  const result = appendTransientNotice("transient")(messages);
  assert.equal(result.length, 2);
  assert.equal(result[1].role, "assistant");
  assert.equal(result[1].content, "transient");
  assert.equal(result[1].agentNotice, true);
});

test("parseSseData joins all data: lines, stripping the prefix", () => {
  // Original behavior: collects every line starting with "data:", slices 5 chars,
  // trimStart, removes trailing \r, joins with \n.
  assert.equal(parseSseData("event: message\ndata: {\"hello\":\"world\"}"), '{"hello":"world"}');
  assert.equal(parseSseData("data: line1\ndata: line2"), "line1\nline2");
});

test("parseSseData returns empty string when no data lines present", () => {
  assert.equal(parseSseData("no data field"), "");
});

test("formatMetric formats values with suffix", () => {
  assert.equal(formatMetric(1234, " Hz"), "1234 Hz");
  assert.equal(formatMetric(500, " Hz"), "500 Hz");
  assert.equal(formatMetric(0, " Hz"), "0 Hz");
  assert.equal(formatMetric(null, " Hz"), "N/A");
  assert.equal(formatMetric(undefined, " Hz"), "N/A");
  assert.equal(formatMetric("", " Hz"), "N/A");
});

test("initialExportSettings returns false/unsaved when no window/localStorage", () => {
  const prev = globalThis.window;
  delete globalThis.window;
  const settings = initialExportSettings();
  assert.equal(settings.includeReasoning, false);
  assert.equal(settings.saved, false);
  if (prev !== undefined) globalThis.window = prev;
});

test("SESSION_STORAGE_KEY is a constant string", () => {
  assert.equal(typeof SESSION_STORAGE_KEY, "string");
  assert.equal(SESSION_STORAGE_KEY, "ds4.session");
});

test("readStoredSession returns default session when storage is empty", () => {
  const storage = { getItem: () => null };
  const session = readStoredSession(storage);
  assert.ok(Array.isArray(session.messages));
  assert.equal(session.fileName, null);
});

test("readStoredSession parses stored JSON session via window.localStorage", () => {
  const stored = JSON.stringify({ messages: [{ role: "user", content: "saved" }], fileName: "test.md" });
  const prev = globalThis.window;
  globalThis.window = { localStorage: { getItem: () => stored } };
  const session = readStoredSession();
  assert.equal(session.fileName, "test.md");
  assert.equal(session.messages[0].content, "saved");
  if (prev !== undefined) globalThis.window = prev; else delete globalThis.window;
});

test("writeStoredSession stores session to window.localStorage (fileName||null, messages||[])", () => {
  let written = null;
  const prev = globalThis.window;
  globalThis.window = { localStorage: { setItem: (key, value) => { written = value; } } };
  writeStoredSession({ fileName: "s.md", messages: [{ role: "user", content: "x" }] });
  const parsed = JSON.parse(written);
  assert.equal(parsed.fileName, "s.md");
  assert.equal(parsed.messages[0].content, "x");
  writeStoredSession({ fileName: undefined, messages: undefined });
  const parsed2 = JSON.parse(written);
  assert.equal(parsed2.fileName, null);
  assert.deepEqual(parsed2.messages, []);
  if (prev !== undefined) globalThis.window = prev; else delete globalThis.window;
});

test("clearStoredSession removes session from window.localStorage", () => {
  let removed = null;
  const prev = globalThis.window;
  globalThis.window = { localStorage: { removeItem: (key) => { removed = key; } } };
  clearStoredSession();
  assert.equal(removed, "ds4.session");
  if (prev !== undefined) globalThis.window = prev; else delete globalThis.window;
});

// ── buildChatMessages ────────────────────────────────────────────────────

test("buildChatMessages prepends a non-empty system message", () => {
  const out = buildChatMessages(
    [{ role: "user", content: "ciao" }],
    { system: "be terse" }
  );
  assert.deepEqual(out, [
    { role: "system", content: "be terse" },
    { role: "user", content: "ciao" }
  ]);
});

test("buildChatMessages omits a blank/whitespace system message", () => {
  assert.deepEqual(
    buildChatMessages([{ role: "user", content: "ciao" }], { system: "   " }),
    [{ role: "user", content: "ciao" }]
  );
  assert.deepEqual(
    buildChatMessages([{ role: "user", content: "ciao" }]),
    [{ role: "user", content: "ciao" }]
  );
});

test("buildChatMessages drops the empty trailing assistant placeholder", () => {
  const out = buildChatMessages([
    { role: "user", content: "ciao" },
    { role: "assistant", content: "" }
  ]);
  assert.deepEqual(out, [{ role: "user", content: "ciao" }]);
});

test("buildChatMessages keeps assistant turns that have content", () => {
  const out = buildChatMessages([
    { role: "user", content: "ciao" },
    { role: "assistant", content: "hello" },
    { role: "user", content: "again" }
  ]);
  assert.deepEqual(out, [
    { role: "user", content: "ciao" },
    { role: "assistant", content: "hello" },
    { role: "user", content: "again" }
  ]);
});

test("buildChatMessages excludes transient agentNotice messages (no error echo loop)", () => {
  const out = buildChatMessages([
    { role: "user", content: "ciao" },
    { role: "assistant", content: "Stream failed: wrapper is busy", agentNotice: true },
    { role: "user", content: "ciao" }
  ]);
  // The "Stream failed" banner must NOT be resent into the prompt.
  assert.deepEqual(out, [
    { role: "user", content: "ciao" },
    { role: "user", content: "ciao" }
  ]);
});

test("buildChatMessages tolerates null/undefined entries", () => {
  const out = buildChatMessages([
    null,
    { role: "user", content: "ciao" },
    undefined
  ]);
  assert.deepEqual(out, [{ role: "user", content: "ciao" }]);
});

// ── requestFreshNativeAgentSession ──────────────────────────────────────

test("requestFreshNativeAgentSession sends a silent native /new", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        ok: true,
        active: true,
        command: "new"
      })
    };
  };

  const payload = await requestFreshNativeAgentSession(
    fetchImpl,
    { "X-Agent-Session-Key": "test-session" }
  );

  assert.equal(payload.active, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "/api/native-agent/command");
  assert.equal(calls[0].options.method, "POST");
  assert.equal(
    calls[0].options.headers["Content-Type"],
    "application/json"
  );
  assert.equal(
    calls[0].options.headers["X-Agent-Session-Key"],
    "test-session"
  );
  assert.deepEqual(
    JSON.parse(calls[0].options.body),
    { command: "/new" }
  );
});

test("requestFreshNativeAgentSession never calls agent stop", async () => {
  const urls = [];
  const fetchImpl = async (url) => {
    urls.push(url);
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ ok: true, active: true })
    };
  };

  await requestFreshNativeAgentSession(fetchImpl, {});
  assert.deepEqual(urls, ["/api/native-agent/command"]);
  assert.ok(!urls.includes("/api/agent/stop"));
});

test("requestFreshNativeAgentSession rejects non-2xx", async () => {
  const fetchImpl = async () => ({
    ok: false,
    status: 500,
    text: async () => "Internal Server Error"
  });

  await assert.rejects(
    () => requestFreshNativeAgentSession(fetchImpl, {}),
    /Internal Server Error/
  );
});

test("requestFreshNativeAgentSession rejects payload ok:false", async () => {
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ ok: false, active: true, message: "fail" })
  });

  await assert.rejects(
    () => requestFreshNativeAgentSession(fetchImpl, {}),
    /fail/
  );
});

test("requestFreshNativeAgentSession rejects payload active:false", async () => {
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ ok: true, active: false, message: "not ready" })
  });

  await assert.rejects(
    () => requestFreshNativeAgentSession(fetchImpl, {}),
    /not ready/
  );
});
