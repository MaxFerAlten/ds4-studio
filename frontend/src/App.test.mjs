// Non-regression test for App.jsx logic
// Tests the pure functions and constants extracted into appLogic.mjs.
// These must match the current App.jsx behavior exactly.

import assert from "node:assert/strict";
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
  jsonFetch,
  appendAssistantDelta,
  replaceAssistantMessage,
  appendAssistantNotice,
  appendTransientNotice,
  parseSseData,
  formatMetric,
  initialExportSettings,
  SESSION_STORAGE_KEY,
  readStoredSession,
  writeStoredSession,
  clearStoredSession
} from "./appLogic.mjs";

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

test("STARTUP_PLACEHOLDERS covers all startup keys", () => {
  const allKeys = STARTUP_GROUPS.flatMap((g) => g[1]);
  for (const key of allKeys) {
    assert.ok(STARTUP_PLACEHOLDERS[key] !== undefined, `Missing STARTUP_PLACEHOLDERS for ${key}`);
  }
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

test("jsonFetch wraps fetch with JSON parsing and error handling", async () => {
  // Use a relative URL with a mock fetch that doesn't actually hit the network
  let calledUrl = null;
  const mockFetch = async (url, options) => {
    calledUrl = url;
    return {
      ok: true,
      status: 200,
      json: async () => ({ hello: "world" }),
      text: async () => ""
    };
  };
  globalThis.fetch = mockFetch;
  const result = await jsonFetch("/api/test");
  assert.deepEqual(result, { hello: "world" });
  assert.equal(calledUrl, "/api/test");
});

test("jsonFetch throws on non-ok status", async () => {
  const mockFetch = async (url, options) => ({
    ok: false,
    status: 500,
    json: async () => ({ error: "server error" }),
    text: async () => ""
  });
  globalThis.fetch = mockFetch;
  await assert.rejects(
    () => jsonFetch("/api/test"),
    /server error/
  );
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

test("parseSseData parses SSE protocol correctly", () => {
  const block = "event: message\ndata: {\"hello\":\"world\"}\n\n";
  const parsed = parseSseData(block);
  assert.equal(parsed, '{"hello":"world"}');
});

test("parseSseData returns null for incomplete blocks", () => {
  assert.equal(parseSseData("no data field"), null);
});

test("formatMetric formats values with suffix", () => {
  assert.equal(formatMetric(1234, " Hz"), "1234 Hz");
  assert.equal(formatMetric(500, " Hz"), "500 Hz");
  assert.equal(formatMetric(0, " Hz"), "0 Hz");
  assert.equal(formatMetric(null, " Hz"), "N/A");
  assert.equal(formatMetric(undefined, " Hz"), "N/A");
  assert.equal(formatMetric("", " Hz"), "N/A");
});

test("initialExportSettings returns default settings", () => {
  const settings = initialExportSettings();
  assert.ok(typeof settings.includeReasoning === "boolean");
  assert.ok(typeof settings.saved === "boolean");
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

test("readStoredSession parses stored JSON session", () => {
  const stored = JSON.stringify({ messages: [{ role: "user", content: "saved" }], fileName: "test.md" });
  const storage = { getItem: () => stored };
  const session = readStoredSession(storage);
  assert.equal(session.fileName, "test.md");
  assert.equal(session.messages[0].content, "saved");
});

test("writeStoredSession stores session to storage", () => {
  let written = null;
  const storage = { setItem: (key, value) => { written = value; } };
  writeStoredSession({ fileName: "s.md", messages: [{ role: "user", content: "x" }] }, storage);
  const parsed = JSON.parse(written);
  assert.equal(parsed.fileName, "s.md");
  assert.equal(parsed.messages[0].content, "x");
});

test("clearStoredSession removes session from storage", () => {
  let removed = null;
  const storage = { removeItem: (key) => { removed = key; } };
  clearStoredSession(storage);
  assert.equal(removed, "ds4.session");
});
