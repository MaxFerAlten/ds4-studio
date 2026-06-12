import assert from "node:assert/strict";
import { test } from "node:test";
import { formatNativeAgentNotice, parseAgentInput } from "./agentCommands.mjs";

test("parses agent control commands independently of agent mode", () => {
  assert.deepEqual(parseAgentInput("/agent start", false), {
    type: "control",
    action: "start"
  });
  assert.deepEqual(parseAgentInput(" /AGENT STOP ", true), {
    type: "control",
    action: "stop"
  });
  assert.deepEqual(parseAgentInput("/agent status", false), {
    type: "control",
    action: "status"
  });
});

test("parses every direct native command while agent mode is active", () => {
  const commands = [
    "/help",
    "/save",
    "/compact",
    "/list",
    "/switch abc",
    "/del abc",
    "/strip abc",
    "/history",
    "/history 10",
    "/power 80",
    "/new",
    "/quit",
    "/exit"
  ];
  for (const command of commands) {
    assert.deepEqual(parseAgentInput(command, true), {
      type: "native",
      command
    });
  }
});

test("does not intercept direct native commands outside agent mode", () => {
  assert.equal(parseAgentInput("/save", false), null);
  assert.equal(parseAgentInput("/unknown", false), null);
});

test("canonicalizes agent aliases and preserves arguments", () => {
  assert.deepEqual(parseAgentInput("/agent save", false), {
    type: "native",
    command: "/save"
  });
  assert.deepEqual(parseAgentInput("/agent HISTORY 10", true), {
    type: "native",
    command: "/history 10"
  });
  assert.deepEqual(parseAgentInput("/agent switch AbC123", true), {
    type: "native",
    command: "/switch AbC123"
  });
  assert.deepEqual(parseAgentInput("/agent unknown value", true), {
    type: "native",
    command: "/unknown value"
  });
});

test("intercepts unknown slash commands only in active agent mode", () => {
  assert.deepEqual(parseAgentInput(" /unknown value ", true), {
    type: "native",
    command: "/unknown value"
  });
  assert.equal(parseAgentInput("plain text", true), null);
  assert.equal(parseAgentInput("/agent", true), null);
});

test("formats native command success with structured data", () => {
  assert.equal(
    formatNativeAgentNotice("/list", {
      ok: true,
      message: "Saved sessions.",
      data: [{ sha: "abc" }]
    }, 200),
    "**/list** (HTTP 200)\n\nSaved sessions.\n\n```json\n[\n  {\n    \"sha\": \"abc\"\n  }\n]\n```"
  );
});

test("formats native command errors without requiring JSON data", () => {
  assert.equal(
    formatNativeAgentNotice("/power 0", {
      ok: false,
      message: "unknown or invalid native agent command"
    }, 400),
    "**/power 0** (HTTP 400)\n\nunknown or invalid native agent command"
  );
});
