// Non-regression test for ChatPanel extraction from App.jsx
// Must pass identically before and after refactoring.

import assert from "node:assert/strict";
import { test } from "node:test";

// Test the pure functions used by ChatPanel
import {
  appendAssistantDelta,
  replaceAssistantMessage,
  appendAssistantNotice,
  appendTransientNotice,
  parseSseData
} from "../appLogic.mjs";
import {
  createDeltaBatcher,
  streamFailureNotice,
  withAgentPriming,
  formatNativeAgentNotice,
  parseAgentInput,
  buildAgentPrimingPreamble
} from "../utils.mjs";

// ── Message helpers ────────────────────────────────────────────────────

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

test("replaceAssistantMessage replaces last assistant message", () => {
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

test("appendTransientNotice pushes new message with agentNotice flag", () => {
  const messages = [{ role: "user", content: "hi" }];
  const result = appendTransientNotice("transient")(messages);
  assert.equal(result.length, 2);
  assert.equal(result[1].agentNotice, true);
});

// ── SSE parsing ───────────────────────────────────────────────────────

test("parseSseData joins all data: lines, stripping the prefix", () => {
  assert.equal(parseSseData("event: message\ndata: {\"hello\":\"world\"}"), '{"hello":"world"}');
  assert.equal(parseSseData("data: line1\ndata: line2"), "line1\nline2");
});

test("parseSseData returns empty string for blocks without data lines", () => {
  assert.equal(parseSseData("no data field"), "");
});

// ── Delta batcher ─────────────────────────────────────────────────────

test("createDeltaBatcher coalesces content and reasoning", () => {
  const flushed = [];
  const batcher = createDeltaBatcher(
    (content, reasoning) => flushed.push({ content, reasoning }),
    { delayMs: 40, setTimeoutFn: setTimeout, clearTimeoutFn: clearTimeout }
  );
  batcher.push("hel", "rea");
  batcher.push("lo", "son");
  assert.deepEqual(flushed, []);
  // flush immediately for test
  batcher.flush();
  assert.deepEqual(flushed, [{ content: "hello", reasoning: "reason" }]);
});

test("createDeltaBatcher flush emits pending delta", () => {
  const flushed = [];
  const batcher = createDeltaBatcher(
    (content, reasoning) => flushed.push({ content, reasoning }),
    { setTimeoutFn: setTimeout, clearTimeoutFn: clearTimeout }
  );
  batcher.push("a", "");
  assert.equal(batcher.flush(), true);
  assert.deepEqual(flushed, [{ content: "a", reasoning: "" }]);
});

test("createDeltaBatcher cancel drops buffered delta", () => {
  const flushed = [];
  const batcher = createDeltaBatcher(
    (content, reasoning) => flushed.push({ content, reasoning }),
    { setTimeoutFn: setTimeout, clearTimeoutFn: clearTimeout }
  );
  batcher.push("lost", "reasoning");
  batcher.cancel();
  assert.equal(batcher.flush(), false);
  assert.deepEqual(flushed, []);
});

// ── Stream failure notice ─────────────────────────────────────────────

test("streamFailureNotice explains backend termination", () => {
  assert.equal(
    streamFailureNotice(new Error('{"error":"terminated"}')),
    "Stream failed: backend connection ended. Wait for Healthy, then retry."
  );
});

test("streamFailureNotice passes through other errors", () => {
  assert.equal(
    streamFailureNotice(new Error("connection lost")),
    "Stream failed: connection lost"
  );
});

// ── Agent commands ───────────────────────────────────────────────────

test("parseAgentInput parses control commands", () => {
  assert.deepEqual(parseAgentInput("/agent start", false), {
    type: "control",
    action: "start"
  });
});

test("parseAgentInput parses native commands in agent mode", () => {
  assert.deepEqual(parseAgentInput("/help", true), { type: "native", command: "/help" });
});

test("parseAgentInput ignores slash commands outside agent mode", () => {
  assert.equal(parseAgentInput("/save", false), null);
});

test("parseAgentInput parses pony controls", () => {
  assert.deepEqual(parseAgentInput("/pony", true), { type: "pony", action: "status" });
});

test("formatNativeAgentNotice formats success with data", () => {
  assert.equal(
    formatNativeAgentNotice("/list", { ok: true, message: "Saved.", data: [{ sha: "abc" }] }, 200),
    "**/list** (HTTP 200)\n\nSaved.\n\n```json\n[\n  {\n    \"sha\": \"abc\"\n  }\n]\n```"
  );
});

// ── Agent priming ────────────────────────────────────────────────────

test("buildAgentPrimingPreamble returns empty for empty history", () => {
  assert.equal(buildAgentPrimingPreamble([]), "");
});

test("buildAgentPrimingPreamble serialises multi-turn history", () => {
  const preamble = buildAgentPrimingPreamble([
    { role: "user", content: "ciao" },
    { role: "assistant", content: "salve" }
  ]);
  assert.match(preamble, /<chat_history>/);
  assert.match(preamble, /## User/);
  assert.match(preamble, /## Assistant/);
});

test("withAgentPriming wraps request when preamble exists", () => {
  const wrapped = withAgentPriming(
    [{ role: "user", content: "file.md" }],
    "validami con sage"
  );
  assert.match(wrapped, /<chat_history>/);
  assert.match(wrapped, /New user request:/);
});
