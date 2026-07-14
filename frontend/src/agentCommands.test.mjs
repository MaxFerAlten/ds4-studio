import assert from "node:assert/strict";
import { test } from "node:test";
import { formatNativeAgentNotice, parseAgentInput } from "./utils.mjs";

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
    "/exit",
    "/crawl start https://example.com"
  ];
  for (const command of commands) {
    assert.deepEqual(parseAgentInput(command, true), {
      type: "native",
      command
    });
  }
});

test("does not intercept direct native commands outside agent mode except crawl", () => {
  assert.equal(parseAgentInput("/save", false), null);
  assert.equal(parseAgentInput("/unknown", false), null);
  assert.deepEqual(parseAgentInput("/crawl start https://example.com", false), {
    type: "native",
    command: "/crawl start https://example.com"
  });
});

test("parses pony controls only as agent-scoped commands", () => {
  assert.deepEqual(parseAgentInput("/pony", true), { type: "pony", action: "status" });
  assert.deepEqual(parseAgentInput("/pony status", true), { type: "pony", action: "status" });
  assert.deepEqual(parseAgentInput("/pony start", true), { type: "pony", action: "set", mode: "full" });
  assert.deepEqual(parseAgentInput("/pony stop", true), { type: "pony", action: "set", mode: "off" });
  assert.deepEqual(parseAgentInput("/pony ultra", true), { type: "pony", action: "set", mode: "ultra" });
  assert.deepEqual(parseAgentInput("/pony banana", true), { type: "pony", action: "invalid", mode: "banana" });
  assert.deepEqual(parseAgentInput("/pony start", false), { type: "pony", action: "inactive" });
});

test("routes sage policy controls through the native command endpoint", () => {
  for (const action of ["start", "stop", "status"]) {
    const command = `/sage-pol ${action}`;
    assert.deepEqual(parseAgentInput(command, false), {
      type: "native",
      command
    });
    assert.deepEqual(parseAgentInput(command.toUpperCase(), true), {
      type: "native",
      command
    });
  }
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

test("parses /pageagent status", () => {
  assert.deepEqual(parseAgentInput("/pageagent status", false), {
    type: "pageagent",
    action: "status"
  });
  assert.deepEqual(parseAgentInput(" /PAGEAGENT STATUS ", true), {
    type: "pageagent",
    action: "status"
  });
});

test("parses /pageagent stop", () => {
  assert.deepEqual(parseAgentInput("/pageagent stop", false), {
    type: "pageagent",
    action: "stop"
  });
});

test("parses /pageagent run with task", () => {
  assert.deepEqual(parseAgentInput("/pageagent run apri History", false), {
    type: "pageagent",
    action: "run",
    task: "apri History"
  });
});

test("parses /ui as alias for pageagent run", () => {
  assert.deepEqual(parseAgentInput("/ui apri History", false), {
    type: "pageagent",
    action: "run",
    task: "apri History",
    alias: "ui"
  });
  assert.deepEqual(parseAgentInput("/ui imposta temperature a 0", true), {
    type: "pageagent",
    action: "run",
    task: "imposta temperature a 0",
    alias: "ui"
  });
});

test("/pageagent commands work independently of agent mode", () => {
  assert.deepEqual(parseAgentInput("/pageagent status", false), {
    type: "pageagent",
    action: "status"
  });
  assert.deepEqual(parseAgentInput("/pageagent stop", true), {
    type: "pageagent",
    action: "stop"
  });
  assert.deepEqual(parseAgentInput("/ui apri Research", false), {
    type: "pageagent",
    action: "run",
    task: "apri Research",
    alias: "ui"
  });
});

test("parses /pageagent start and /pageagent on", () => {
  assert.deepEqual(parseAgentInput("/pageagent start", false), {
    type: "pageagent",
    action: "set",
    enabled: true
  });
  assert.deepEqual(parseAgentInput("/pageagent on", true), {
    type: "pageagent",
    action: "set",
    enabled: true
  });
  assert.deepEqual(parseAgentInput(" /PAGEAGENT START ", false), {
    type: "pageagent",
    action: "set",
    enabled: true
  });
});

test("parses /pageagent off", () => {
  assert.deepEqual(parseAgentInput("/pageagent off", false), {
    type: "pageagent",
    action: "set",
    enabled: false
  });
  assert.deepEqual(parseAgentInput(" /pageagent OFF ", true), {
    type: "pageagent",
    action: "set",
    enabled: false
  });
});
